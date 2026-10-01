import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function harness(participants = [['Ava', 2], ['Ben', 1]]) {
  const cells = {
    Participants: [['Full Name', 'Entries'], ...participants.map(row => [...row])],
    Winners: [['Full Name']]
  };
  const props = new Map([['SPREADSHEET_ID', 'test-sheet'], ['PUBLIC_ORIGIN', 'https://example.github.io']]);
  const stats = { batches: 0, locks: 0, failAfterApply: false };
  const sheet = (name, id) => ({
    getName: () => name,
    getSheetId: () => id,
    getLastRow: () => cells[name].length,
    getMaxRows: () => 1000,
    getRange(row, col, height, width) {
      return { getValues: () => Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => cells[name][row - 1 + r]?.[col - 1 + c] ?? '')) };
    }
  });
  const sheets = { Participants: sheet('Participants', 1), Winners: sheet('Winners', 2) };
  const spreadsheet = { getId: () => 'test-sheet', getSheetByName: name => sheets[name] };
  const properties = {
    getProperty: key => props.get(key) ?? null,
    setProperty: (key, value) => {
      assert.ok(Buffer.byteLength(value, 'utf8') < 9000, 'Apps Script property value must stay below 9 KB');
      props.set(key, value);
    },
    deleteProperty: key => { props.delete(key); }
  };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({
      waitLock: () => { stats.locks++; }, releaseLock: () => { stats.locks--; }
    }) },
    Sheets: { Spreadsheets: { batchUpdate: ({ requests }) => {
      stats.batches++;
      for (const request of requests) {
        if (!request.updateCells) continue;
        const update = request.updateCells;
        const tab = update.start.sheetId === 1 ? 'Participants' : 'Winners';
        update.rows.forEach((row, offset) => {
          const rowIndex = update.start.rowIndex + offset;
          cells[tab][rowIndex] ||= [];
          row.values.forEach((value, index) => {
            cells[tab][rowIndex][update.start.columnIndex + index] =
              value.userEnteredValue.numberValue ?? value.userEnteredValue.stringValue;
          });
        });
      }
      if (stats.failAfterApply) { stats.failAfterApply = false; throw new Error('Lost response'); }
      return {};
    } } }
  });
  vm.runInContext(source, context);
  return { cells, stats, run: (expression, ...args) => vm.runInContext(expression, context)(...args) };
}

test('Done writes all staged winners and entry changes in one batch', () => {
  const h = harness();
  const base = h.run('getState').participants;
  const winners = [{ name: 'Ava' }, { name: 'Ben' }];
  h.run('commitSession', 'session-01', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.stats.locks, 0);
  assert.equal(h.cells.Participants[1][1], 0);
  assert.equal(h.cells.Participants[2][1], 0);
  assert.deepEqual(h.cells.Winners.slice(1), [['Ava'], ['Ben']]);
  h.run('commitSession', 'session-01', base, winners);
  assert.equal(h.stats.batches, 1);
});

test('sheet edits and a second browser session cannot consume stale entries', () => {
  const h = harness();
  const base = h.run('getState').participants;
  h.cells.Participants[1][1] = 1;
  assert.throws(() => h.run('commitSession', 'session-02', base, [{ name: 'Ava' }]), /sheet changed/);
  assert.equal(h.stats.batches, 0);
  h.cells.Participants[1][1] = 2;
  h.run('commitSession', 'session-03', base, [{ name: 'Ava' }]);
  assert.throws(() => h.run('commitSession', 'session-04', base, [{ name: 'Ben' }]), /sheet changed/);
  assert.equal(h.stats.batches, 1);
});

test('a lost response is recovered without writing a second batch', () => {
  const h = harness();
  const base = h.run('getState').participants;
  const winners = [{ name: 'Ava' }];
  h.stats.failAfterApply = true;
  assert.throws(() => h.run('commitSession', 'session-05', base, winners), /Lost response/);
  h.run('commitSession', 'session-05', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Participants[1][1], 0);
  assert.deepEqual(h.cells.Winners[1], ['Ava']);
});

test('rejects repeat wins or mismatched names before any write', () => {
  const h = harness();
  const base = h.run('getState').participants;
  assert.throws(() => h.run('commitSession', 'session-06', base,
    [{ name: 'Ava' }, { name: 'Ava' }]), /more than once/);
  assert.throws(() => h.run('commitSession', 'session-07', base,
    [{ name: 'Wrong' }]), /does not match/);
  assert.equal(h.stats.batches, 0);
});

test('large sessions split the retry plan into safe property values', () => {
  const people = Array.from({ length: 450 }, (_, index) =>
    [`Participant ${index} with a longer display name`, 2]);
  const h = harness(people);
  const base = h.run('getState').participants;
  const winners = people.map(row => ({ name: row[0] }));
  h.run('commitSession', 'session-large', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Winners.length, 451);
});

test('duplicate full names are rejected regardless of case or surrounding spaces', () => {
  const h = harness([['Ava Smith', 1], [' ava smith ', 2]]);
  assert.throws(() => h.run('getState'), /Duplicate full name/);
});

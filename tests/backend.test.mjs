import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function harness(participants = [['a', 'Ava', 2], ['b', 'Ben', 1]]) {
  const cells = {
    Participants: [['ID', 'Name', 'Entries'], ...participants.map(row => [...row])],
    Winners: [['ID', 'Name']]
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
  const winners = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }, { id: 'a', name: 'Ava' }];
  h.run('commitSession', 'session-01', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.stats.locks, 0);
  assert.equal(h.cells.Participants[1][2], 0);
  assert.equal(h.cells.Participants[2][2], 0);
  assert.deepEqual(h.cells.Winners.slice(1), [['a', 'Ava'], ['b', 'Ben'], ['a', 'Ava']]);
  h.run('commitSession', 'session-01', base, winners);
  assert.equal(h.stats.batches, 1);
});

test('sheet edits and a second browser session cannot consume stale entries', () => {
  const h = harness();
  const base = h.run('getState').participants;
  h.cells.Participants[1][2] = 1;
  assert.throws(() => h.run('commitSession', 'session-02', base, [{ id: 'a', name: 'Ava' }]), /sheet changed/);
  assert.equal(h.stats.batches, 0);
  h.cells.Participants[1][2] = 2;
  h.run('commitSession', 'session-03', base, [{ id: 'a', name: 'Ava' }]);
  assert.throws(() => h.run('commitSession', 'session-04', base, [{ id: 'b', name: 'Ben' }]), /sheet changed/);
  assert.equal(h.stats.batches, 1);
});

test('a lost response is recovered without writing a second batch', () => {
  const h = harness();
  const base = h.run('getState').participants;
  const winners = [{ id: 'a', name: 'Ava' }];
  h.stats.failAfterApply = true;
  assert.throws(() => h.run('commitSession', 'session-05', base, winners), /Lost response/);
  h.run('commitSession', 'session-05', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Participants[1][2], 1);
  assert.deepEqual(h.cells.Winners[1], ['a', 'Ava']);
});

test('rejects extra wins or mismatched names before any write', () => {
  const h = harness();
  const base = h.run('getState').participants;
  assert.throws(() => h.run('commitSession', 'session-06', base,
    [{ id: 'b', name: 'Ben' }, { id: 'b', name: 'Ben' }]), /more wins/);
  assert.throws(() => h.run('commitSession', 'session-07', base,
    [{ id: 'a', name: 'Wrong' }]), /does not match/);
  assert.equal(h.stats.batches, 0);
});

test('large sessions split the retry plan into safe property values', () => {
  const people = Array.from({ length: 450 }, (_, index) =>
    [`id-${index}`, `Participant ${index} with a longer display name`, 2]);
  const h = harness(people);
  const base = h.run('getState').participants;
  const winners = people.map(row => ({ id: row[0], name: row[1] }));
  h.run('commitSession', 'session-large', base, winners);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Winners.length, 451);
});

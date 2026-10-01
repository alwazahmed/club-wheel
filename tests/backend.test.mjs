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
    setProperty: (key, value) => { props.set(key, value); },
    deleteProperty: key => { props.delete(key); }
  };
  const context = vm.createContext({
    SpreadsheetApp: { openById: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({
      waitLock: () => { stats.locks++; }, releaseLock: () => { stats.locks--; }
    }) },
    Utilities: { getUuid: (() => { let id = 0; return () => `draw-${++id}`; })() },
    Sheets: { Spreadsheets: { batchUpdate: ({ requests }) => {
      stats.batches++;
      for (const request of requests) {
        if (request.updateCells) {
          const update = request.updateCells;
          const tab = update.start.sheetId === 1 ? 'Participants' : 'Winners';
          const rowIndex = update.start.rowIndex;
          cells[tab][rowIndex] ||= [];
          update.rows[0].values.forEach((value, index) => {
            cells[tab][rowIndex][update.start.columnIndex + index] =
              value.userEnteredValue.numberValue ?? value.userEnteredValue.stringValue;
          });
        }
      }
      if (stats.failAfterApply) {
        stats.failAfterApply = false;
        throw new Error('Lost response after write');
      }
      return {};
    } } }
  });
  vm.runInContext(source, context);
  vm.runInContext('Math.random = () => 0', context);
  return { context, cells, stats, run: (expression, ...args) =>
    vm.runInContext(expression, context)(...args) };
}

test('each entry occupies one ticket and zero-entry people are excluded', () => {
  const h = harness([['a', 'Ava', 1], ['b', 'Ben', 3], ['c', 'Cal', 0]]);
  const people = h.run('readData_').participants;
  assert.equal(h.run('pickWinner_', people, 0).id, 'a');
  assert.equal(h.run('pickWinner_', people, .249).id, 'a');
  assert.equal(h.run('pickWinner_', people, .25).id, 'b');
  assert.equal(h.run('pickWinner_', people, .999).id, 'b');
});

test('confirmation uses one entry, appends one winner, and repeat winners remain eligible', () => {
  const h = harness();
  const first = h.run('startDraw');
  assert.equal(first.pending.winnerName, 'Ava');
  assert.equal(h.cells.Participants[1][2], 2);
  h.run('confirmDraw', first.pending.drawId);
  assert.equal(h.cells.Participants[1][2], 1);
  assert.deepEqual(h.cells.Winners[1], ['a', 'Ava']);
  const second = h.run('startDraw');
  assert.equal(second.pending.winnerId, 'a');
  h.run('confirmDraw', second.pending.drawId);
  assert.equal(h.cells.Participants[1][2], 0);
  assert.deepEqual(h.cells.Winners[2], ['a', 'Ava']);
  assert.equal(h.stats.batches, 2);
  assert.equal(h.stats.locks, 0);
});

test('two simultaneous starts share one pending draw; duplicate confirm is harmless', () => {
  const h = harness();
  const one = h.run('startDraw');
  const two = h.run('startDraw');
  assert.equal(one.pending.drawId, two.pending.drawId);
  h.run('confirmDraw', one.pending.drawId);
  h.run('confirmDraw', one.pending.drawId);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Participants[1][2], 1);
  assert.equal(h.cells.Winners.length, 2);
});

test('void leaves the sheet unchanged and a stale winner cannot be confirmed', () => {
  const h = harness();
  const first = h.run('startDraw');
  assert.throws(() => h.run('voidDraw', first.pending.drawId, 'no'), /short reason/);
  h.run('voidDraw', first.pending.drawId, 'Wrong prize');
  assert.equal(h.cells.Participants[1][2], 2);
  assert.equal(h.cells.Winners.length, 1);
  const second = h.run('startDraw');
  h.cells.Participants[1][2] = 0;
  assert.throws(() => h.run('confirmDraw', second.pending.drawId), /no entries/);
  assert.equal(h.run('getState').pending.drawId, second.pending.drawId);
  assert.equal(h.stats.batches, 0);
});

test('a lost batch response is recovered without spending a second entry', () => {
  const h = harness();
  const draw = h.run('startDraw');
  h.stats.failAfterApply = true;
  assert.throws(() => h.run('confirmDraw', draw.pending.drawId), /Lost response/);
  assert.equal(h.cells.Participants[1][2], 1);
  assert.deepEqual(h.cells.Winners[1], ['a', 'Ava']);
  h.run('confirmDraw', draw.pending.drawId);
  assert.equal(h.stats.batches, 1);
  assert.equal(h.cells.Participants[1][2], 1);
  assert.equal(h.run('getState').pending, null);
});

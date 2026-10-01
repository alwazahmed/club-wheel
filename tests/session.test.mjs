import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseWinner, projectSession, isValidSession } from '../session.mjs';

const base = [
  { id: 'a', name: 'Ava', entries: 2 },
  { id: 'b', name: 'Ben', entries: 1 },
  { id: 'c', name: 'Cal', entries: 0 }
];

test('weighted draw excludes zero entries and supports a repeat winner', () => {
  assert.equal(chooseWinner(base, 0).id, 'a');
  assert.equal(chooseWinner(base, .66).id, 'a');
  assert.equal(chooseWinner(base, .99).id, 'b');
  const sheet = { participants: base, winners: [], pending: null, totalEntries: 3 };
  const session = { id: 'session-01', baseParticipants: base,
    winners: [{ id: 'a', name: 'Ava' }], pending: null };
  const afterOne = projectSession(sheet, session);
  assert.equal(afterOne.participants[0].entries, 1);
  assert.equal(afterOne.totalEntries, 2);
  assert.equal(chooseWinner(afterOne.participants, 0).id, 'a');
  session.winners.push({ id: 'a', name: 'Ava' });
  assert.equal(projectSession(sheet, session).participants[0].entries, 0);
  assert.equal(isValidSession(session), true);
});

test('staged session validation prevents overspending and bad pending draws', () => {
  const session = { id: 'session-02', baseParticipants: base,
    winners: [{ id: 'b', name: 'Ben' }], pending: null };
  assert.equal(isValidSession(session), true);
  session.winners.push({ id: 'b', name: 'Ben' });
  assert.equal(isValidSession(session), false);
  session.winners.pop();
  session.pending = { winnerId: 'b', winnerName: 'Ben' };
  assert.equal(isValidSession(session), false);
});

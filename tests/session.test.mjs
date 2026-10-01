import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseWinner, projectSession, isValidSession } from '../session.mjs';

const base = [
  { name: 'Ava', entries: 2 },
  { name: 'Ben', entries: 1 },
  { name: 'Cal', entries: 0 }
];

test('weighted draw removes a confirmed winner with every remaining entry', () => {
  assert.equal(chooseWinner(base, 0).name, 'Ava');
  assert.equal(chooseWinner(base, .66).name, 'Ava');
  assert.equal(chooseWinner(base, .99).name, 'Ben');
  const sheet = { participants: base, winners: [], pending: null, totalEntries: 3 };
  const session = { id: 'session-01', baseParticipants: base,
    winners: [{ name: 'Ava' }], pending: null };
  const afterOne = projectSession(sheet, session);
  assert.equal(afterOne.participants[0].entries, 0);
  assert.equal(afterOne.totalEntries, 1);
  assert.equal(chooseWinner(afterOne.participants, 0).name, 'Ben');
  assert.equal(isValidSession(session), true);
  session.winners.push({ name: 'Ava' });
  assert.equal(projectSession(sheet, session).participants[0].entries, 0);
  assert.equal(isValidSession(session), false);
});

test('staged session validation prevents overspending and bad pending draws', () => {
  const session = { id: 'session-02', baseParticipants: base,
    winners: [{ name: 'Ben' }], pending: null };
  assert.equal(isValidSession(session), true);
  session.winners.push({ name: 'Ben' });
  assert.equal(isValidSession(session), false);
  session.winners.pop();
  session.pending = { winnerName: 'Ben' };
  assert.equal(isValidSession(session), false);
});

test('saved browser sessions reject duplicate full names', () => {
  const session = { id: 'session-03', baseParticipants: [
    { name: 'Ava Smith', entries: 1 }, { name: 'ava smith', entries: 1 }
  ], winners: [], pending: null };
  assert.equal(isValidSession(session), false);
});

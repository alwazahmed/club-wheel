import test from 'node:test';
import assert from 'node:assert/strict';
import { TAU, buildSegments, targetRotation } from '../wheel.mjs';

test('slice sizes match remaining entries', () => {
  const slices = buildSegments([
    { name: 'Ava', entries: 1 }, { name: 'Ben', entries: 3 }, { name: 'Cal', entries: 0 }
  ]);
  assert.equal(slices.length, 2);
  assert.equal(slices[0].end - slices[0].start, .25);
  assert.equal(slices[1].end - slices[1].start, .75);
});

test('the chosen slice center lands under the top pointer', () => {
  const slices = buildSegments([{ name: 'Ava', entries: 1 }, { name: 'Ben', entries: 3 }]);
  const end = targetRotation(.4, slices, 'Ben');
  const center = (slices[1].start + slices[1].end) / 2;
  const actual = ((end + center * TAU) % TAU + TAU) % TAU;
  assert.ok(actual < 1e-10 || Math.abs(actual - TAU) < 1e-10);
  assert.ok(end > TAU * 6);
});

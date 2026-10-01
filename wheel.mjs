export const TAU = Math.PI * 2;

export function buildSegments(participants) {
  const eligible = participants.filter(person => person.entries > 0);
  const total = eligible.reduce((sum, person) => sum + person.entries, 0);
  let used = 0;
  return eligible.map((person, index) => {
    const segment = {
      ...person,
      index,
      start: total ? used / total : 0,
      end: total ? (used + person.entries) / total : 0
    };
    used += person.entries;
    return segment;
  });
}

export function targetRotation(current, segments, winnerName, revolutions = 6) {
  const segment = segments.find(item => item.name === winnerName);
  if (!segment) throw new Error('The selected winner is no longer on the wheel. Refresh the game.');
  const center = (segment.start + segment.end) / 2;
  const desired = ((-center * TAU) % TAU + TAU) % TAU;
  const normalized = ((current % TAU) + TAU) % TAU;
  const advance = (desired - normalized + TAU) % TAU;
  return current + revolutions * TAU + advance;
}

export function segmentColor(index) {
  const palette = ['#9ce86c','#ed7192','#67d6e2','#f6bd61','#a594f4','#7cadf2','#f28b6d','#d9db79'];
  return palette[index % palette.length];
}

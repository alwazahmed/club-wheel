export function chooseWinner(participants, random = Math.random()) {
  const eligible = participants.filter(person => Number.isSafeInteger(person.entries) && person.entries > 0);
  const total = eligible.reduce((sum, person) => sum + person.entries, 0);
  if (!Number.isSafeInteger(total) || total < 1 || random < 0 || random >= 1) return null;
  let ticket = Math.floor(random * total);
  for (const person of eligible) {
    ticket -= person.entries;
    if (ticket < 0) return person;
  }
  return null;
}

export function projectSession(sheetState, session) {
  if (!session) return sheetState;
  const used = new Map();
  for (const winner of session.winners) used.set(winner.name, (used.get(winner.name) || 0) + 1);
  const participants = session.baseParticipants.map(person => ({
    ...person,
    entries: person.entries - (used.get(person.name) || 0)
  }));
  return {
    participants,
    winners: [...sheetState.winners, ...session.winners],
    pending: session.pending,
    totalEntries: participants.reduce((sum, person) => sum + person.entries, 0)
  };
}

export function isValidSession(session) {
  if (!session || typeof session.id !== 'string' || !/^[\w-]{8,100}$/.test(session.id) ||
      !Array.isArray(session.baseParticipants) || !Array.isArray(session.winners)) return false;
  const names = new Map();
  for (const person of session.baseParticipants) {
    if (typeof person.name !== 'string' || !person.name.trim() ||
        !Number.isSafeInteger(person.entries) || person.entries < 0) return false;
    const key = person.name.trim().toLocaleLowerCase();
    if (names.has(key)) return false;
    names.set(key, person);
  }
  const counts = new Map();
  for (const winner of session.winners) {
    if (!winner || typeof winner.name !== 'string') return false;
    const person = names.get(winner.name.trim().toLocaleLowerCase());
    if (!person || winner.name !== person.name) return false;
    const count = (counts.get(winner.name) || 0) + 1;
    if (count > person.entries) return false;
    counts.set(winner.name, count);
  }
  return session.pending === null || (session.pending &&
    typeof session.pending.winnerName === 'string' &&
    names.get(session.pending.winnerName.trim().toLocaleLowerCase())?.name === session.pending.winnerName &&
    (counts.get(session.pending.winnerName) || 0) < names.get(session.pending.winnerName.trim().toLocaleLowerCase()).entries);
}

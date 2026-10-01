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
  for (const winner of session.winners) used.set(winner.id, (used.get(winner.id) || 0) + 1);
  const participants = session.baseParticipants.map(person => ({
    ...person,
    entries: person.entries - (used.get(person.id) || 0)
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
  const ids = new Map();
  for (const person of session.baseParticipants) {
    if (typeof person.id !== 'string' || !person.id || ids.has(person.id) ||
        typeof person.name !== 'string' || !person.name ||
        !Number.isSafeInteger(person.entries) || person.entries < 0) return false;
    ids.set(person.id, person);
  }
  const counts = new Map();
  for (const winner of session.winners) {
    const person = ids.get(winner.id);
    if (!person || winner.name !== person.name) return false;
    const count = (counts.get(winner.id) || 0) + 1;
    if (count > person.entries) return false;
    counts.set(winner.id, count);
  }
  return session.pending === null || (session.pending &&
    typeof session.pending.winnerId === 'string' &&
    ids.get(session.pending.winnerId)?.name === session.pending.winnerName &&
    (counts.get(session.pending.winnerId) || 0) < ids.get(session.pending.winnerId).entries);
}

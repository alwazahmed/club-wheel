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
  const removed = new Set(session.winners.map(winner => winner.name));
  const participants = session.baseParticipants.map(person => ({
    ...person,
    entries: removed.has(person.name) ? 0 : person.entries
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
  const winners = new Set();
  for (const winner of session.winners) {
    if (!winner || typeof winner.name !== 'string') return false;
    const person = names.get(winner.name.trim().toLocaleLowerCase());
    if (!person || winner.name !== person.name || person.entries < 1 || winners.has(winner.name)) return false;
    winners.add(winner.name);
  }
  return session.pending === null || (session.pending &&
    typeof session.pending.winnerName === 'string' &&
    names.get(session.pending.winnerName.trim().toLocaleLowerCase())?.name === session.pending.winnerName &&
    !winners.has(session.pending.winnerName) &&
    names.get(session.pending.winnerName.trim().toLocaleLowerCase()).entries > 0);
}

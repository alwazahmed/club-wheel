/** Club Wheel backend. Script properties: SPREADSHEET_ID and PUBLIC_ORIGIN. */
const PARTICIPANTS_TAB = 'Participants';
const WINNERS_TAB = 'Winners';
const COMMIT_PREFIX = 'COMMIT_';

function doGet() {
  const page = HtmlService.createTemplateFromFile('Bridge');
  page.publicOrigin = getPublicOrigin_();
  return page.evaluate().setTitle('Club Wheel Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getState() { return stateFromData_(readData_()); }

/** Save every staged result with a single atomic Sheets batch update. */
function commitSession(sessionId, baseParticipants, winners) {
  return withLock_(function () {
    if (typeof sessionId !== 'string' || !/^[\w-]{8,100}$/.test(sessionId)) {
      throw new Error('Invalid game session. Refresh the page.');
    }
    const properties = PropertiesService.getScriptProperties();
    const key = COMMIT_PREFIX + sessionId;
    const prior = properties.getProperty(key);
    if (prior === 'done') return getState();
    const data = readData_();
    const winnersSheet = data.spreadsheet.getSheetByName(WINNERS_TAB);
    const plan = prior ? readPlan_(properties, key, prior) : createPlan_(data, winnersSheet, baseParticipants, winners);
    if (prior && planMatchesApplied_(data, winnersSheet, plan)) {
      properties.setProperty(key, 'done');
      clearPlan_(properties, key, prior);
      return getState();
    }
    if (!sameParticipants_(data.participants, plan.baseParticipants) ||
        !destinationIsEmpty_(winnersSheet, plan.destinationRow, plan.winners.length)) {
      throw new Error('The sheet changed while winners were staged. No new entries were used. Review the sheet before retrying.');
    }
    if (!prior) writePlan_(properties, key, plan);
    const requests = [];
    const lastDestination = plan.destinationRow + plan.winners.length - 1;
    if (lastDestination > winnersSheet.getMaxRows()) {
      requests.push({ appendDimension: { sheetId: winnersSheet.getSheetId(), dimension: 'ROWS',
        length: lastDestination - winnersSheet.getMaxRows() } });
    }
    plan.updates.forEach(function (item) {
      requests.push({ updateCells: {
        start: { sheetId: data.participantsSheetId, rowIndex: item.row - 1, columnIndex: 1 },
        rows: [{ values: [{ userEnteredValue: { numberValue: item.remaining } }] }],
        fields: 'userEnteredValue'
      } });
    });
    requests.push({ updateCells: {
      start: { sheetId: winnersSheet.getSheetId(), rowIndex: plan.destinationRow - 1, columnIndex: 0 },
      rows: plan.winners.map(function (winner) { return { values: [
        { userEnteredValue: { stringValue: winner.name } }
      ] }; }), fields: 'userEnteredValue'
    } });
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, data.spreadsheet.getId());
    properties.setProperty(key, 'done');
    clearPlan_(properties, key, prior || properties.getProperty(key + '_COUNT'));
    return getState();
  });
}

function writePlan_(properties, key, plan) {
  const json = JSON.stringify(plan);
  const chunks = json.match(/[\s\S]{1,2000}/g) || [];
  if (chunks.length > 100) throw new Error('This game session is too large to save in one batch.');
  chunks.forEach(function (chunk, index) { properties.setProperty(key + '_' + index, chunk); });
  properties.setProperty(key + '_COUNT', String(chunks.length));
  properties.setProperty(key, 'pending:' + chunks.length);
}

function readPlan_(properties, key, marker) {
  const count = Number(marker.slice('pending:'.length));
  if (!marker.startsWith('pending:') || !Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error('The saved commit record needs review. No new entries were used.');
  }
  let json = '';
  for (let index = 0; index < count; index++) {
    const chunk = properties.getProperty(key + '_' + index);
    if (chunk === null) throw new Error('The saved commit record is incomplete. No new entries were used.');
    json += chunk;
  }
  return JSON.parse(json);
}

function clearPlan_(properties, key, marker) {
  const count = Number(String(marker).replace('pending:', ''));
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) return;
  for (let index = 0; index < count; index++) properties.deleteProperty(key + '_' + index);
  properties.deleteProperty(key + '_COUNT');
}

function createPlan_(data, winnersSheet, baseParticipants, winners) {
  if (!Array.isArray(baseParticipants) || !Array.isArray(winners) ||
      winners.length < 1 || winners.length > 1000 ||
      !sameParticipants_(data.participants, baseParticipants)) {
    throw new Error('The sheet changed while winners were staged. No entries were used. Refresh and review the sheet.');
  }
  const byName = new Map();
  data.participants.forEach(function (person) { byName.set(person.name, person); });
  const used = new Map();
  const cleanWinners = winners.map(function (winner) {
    const person = winner && byName.get(winner.name);
    if (!person || winner.name !== person.name) throw new Error('A staged winner does not match the sheet.');
    const count = (used.get(person.name) || 0) + 1;
    if (count > person.entries) throw new Error('A winner has more wins than available entries.');
    used.set(person.name, count);
    return { name: person.name };
  });
  const updates = data.participants.filter(function (person) { return used.has(person.name); })
    .map(function (person) { return { name: person.name, row: person.row, remaining: person.entries - used.get(person.name) }; });
  return { baseParticipants: baseParticipants.map(function (person) {
      return { name: person.name, entries: person.entries };
    }), winners: cleanWinners, updates: updates, destinationRow: winnersSheet.getLastRow() + 1 };
}

function sameParticipants_(actual, expected) {
  return actual.length === expected.length && actual.every(function (person, index) {
    const other = expected[index];
    return other && person.name === other.name && person.entries === other.entries;
  });
}

function destinationIsEmpty_(sheet, firstRow, count) {
  if (firstRow > sheet.getMaxRows()) return true;
  const height = Math.min(count, sheet.getMaxRows() - firstRow + 1);
  return sheet.getRange(firstRow, 1, height, 1).getValues().every(function (row) {
    return row[0] === '';
  });
}

function planMatchesApplied_(data, winnersSheet, plan) {
  const lastRow = plan.destinationRow + plan.winners.length - 1;
  if (lastRow > winnersSheet.getMaxRows()) return false;
  const recorded = winnersSheet.getRange(plan.destinationRow, 1, plan.winners.length, 1).getValues();
  if (!recorded.every(function (row, index) {
    return String(row[0]).trim() === plan.winners[index].name;
  })) return false;
  return plan.updates.every(function (item) {
    const person = data.participants.find(function (candidate) { return candidate.name === item.name; });
    return person && person.row === item.row && person.entries === item.remaining;
  });
}

function stateFromData_(data) {
  return { participants: data.participants.map(function (item) {
      return { name: item.name, entries: item.entries };
    }), winners: data.winners, pending: null,
    totalEntries: data.participants.reduce(function (sum, item) { return sum + item.entries; }, 0) };
}

function readData_() {
  const spreadsheet = getSpreadsheet_();
  const participantsSheet = spreadsheet.getSheetByName(PARTICIPANTS_TAB);
  const winnersSheet = spreadsheet.getSheetByName(WINNERS_TAB);
  if (!participantsSheet || !winnersSheet) throw new Error('The sheet must have Participants and Winners tabs.');
  requireHeaders_(participantsSheet, ['Full Name', 'Entries']);
  requireHeaders_(winnersSheet, ['Full Name']);
  const rows = participantsSheet.getLastRow() > 1
    ? participantsSheet.getRange(2, 1, participantsSheet.getLastRow() - 1, 2).getValues() : [];
  const names = new Set();
  const participants = [];
  rows.forEach(function (row, index) {
    if (row.every(function (cell) { return cell === ''; })) return;
    const name = String(row[0]).trim();
    const entries = row[1];
    if (!name || typeof entries !== 'number' || !Number.isSafeInteger(entries) || entries < 0) {
      throw new Error('Invalid participant on row ' + (index + 2) + '. Use a full name and nonnegative whole number of entries.');
    }
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new Error('Duplicate full name: ' + name);
    names.add(key);
    participants.push({ name: name, entries: entries, row: index + 2 });
  });
  const winnerRows = winnersSheet.getLastRow() > 1
    ? winnersSheet.getRange(2, 1, winnersSheet.getLastRow() - 1, 1).getValues() : [];
  const winners = winnerRows.filter(function (row) { return row[0] !== ''; })
    .map(function (row) { return { name: String(row[0]).trim() }; });
  return { spreadsheet: spreadsheet, participantsSheetId: participantsSheet.getSheetId(), participants: participants, winners: winners };
}

function requireHeaders_(sheet, expected) {
  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  if (expected.some(function (header, index) { return actual[index] !== header; })) {
    throw new Error(sheet.getName() + ' must start with: ' + expected.join(', '));
  }
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Set the SPREADSHEET_ID script property first.');
  return SpreadsheetApp.openById(id);
}

function getPublicOrigin_() {
  const origin = PropertiesService.getScriptProperties().getProperty('PUBLIC_ORIGIN');
  if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
    throw new Error('Set PUBLIC_ORIGIN to the GitHub Pages origin, such as https://username.github.io');
  }
  return origin;
}

function withLock_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return work(); }
  finally { lock.releaseLock(); }
}

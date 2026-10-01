/**
 * Club Wheel backend. Deploy as a web app that executes as the owner and is
 * accessible to anyone. Script properties: SPREADSHEET_ID and PUBLIC_ORIGIN.
 * Enable the Advanced Google service "Google Sheets API" before deployment.
 */

const PARTICIPANTS_TAB = 'Participants';
const WINNERS_TAB = 'Winners';
const PENDING_KEY = 'PENDING_DRAW';
const LAST_CONFIRMED_KEY = 'LAST_CONFIRMED_DRAW';

function doGet() {
  const origin = getPublicOrigin_();
  const page = HtmlService.createTemplateFromFile('Bridge');
  page.publicOrigin = origin;
  return page.evaluate()
    .setTitle('Club Wheel Bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getState() {
  const data = readData_();
  return stateFromData_(data);
}

function startDraw() {
  return withLock_(function () {
    const data = readData_();
    const properties = PropertiesService.getScriptProperties();
    const existing = readPending_(properties);
    if (existing) return stateFromData_(data, existing);

    const winner = pickWinner_(data.participants, Math.random());
    if (!winner) throw new Error('No entries remain. Add entries in the sheet to play again.');

    const pending = {
      drawId: Utilities.getUuid(),
      winnerId: winner.id,
      winnerName: winner.name,
      createdAt: new Date().toISOString()
    };
    properties.setProperty(PENDING_KEY, JSON.stringify(pending));
    return stateFromData_(data, pending);
  });
}

function confirmDraw(drawId) {
  return withLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    let pending = readPending_(properties);
    if (!pending || pending.drawId !== drawId) {
      if (properties.getProperty(LAST_CONFIRMED_KEY) === drawId) return getState();
      throw new Error('This draw is no longer pending. Refresh the game.');
    }

    const data = readData_();
    const spreadsheet = data.spreadsheet;
    const winnersSheet = spreadsheet.getSheetByName(WINNERS_TAB);

    // A previous batch may have succeeded while its response was lost. The
    // fixed destination row lets a retry detect that without another write.
    if (pending.commitRow && pending.commitRow <= winnersSheet.getMaxRows()) {
      const recorded = winnersSheet.getRange(pending.commitRow, 1, 1, 2).getValues()[0];
      if (String(recorded[0]).trim() === pending.winnerId &&
          String(recorded[1]).trim() === pending.winnerName) {
        properties.setProperty(LAST_CONFIRMED_KEY, drawId);
        properties.deleteProperty(PENDING_KEY);
        return getState();
      }
      if (recorded[0] !== '' || recorded[1] !== '') {
        throw new Error('The winners list changed during confirmation. Check the sheet before retrying.');
      }
    }

    const participant = data.participants.find(function (item) {
      return item.id === pending.winnerId;
    });
    if (!participant || participant.name !== pending.winnerName || participant.entries < 1) {
      throw new Error('The selected participant changed or has no entries. Void this draw and spin again.');
    }

    const destinationRow = pending.commitRow || winnersSheet.getLastRow() + 1;
    pending.commitRow = destinationRow;
    properties.setProperty(PENDING_KEY, JSON.stringify(pending));

    const requests = [];
    if (destinationRow > winnersSheet.getMaxRows()) {
      requests.push({ appendDimension: { sheetId: winnersSheet.getSheetId(), dimension: 'ROWS', length: 1 } });
    }
    requests.push({
      updateCells: {
        start: { sheetId: data.participantsSheetId, rowIndex: participant.row - 1, columnIndex: 2 },
        rows: [{ values: [{ userEnteredValue: { numberValue: participant.entries - 1 } }] }],
        fields: 'userEnteredValue'
      }
    });
    requests.push({
      updateCells: {
        start: { sheetId: winnersSheet.getSheetId(), rowIndex: destinationRow - 1, columnIndex: 0 },
        rows: [{ values: [
          { userEnteredValue: { stringValue: participant.id } },
          { userEnteredValue: { stringValue: participant.name } }
        ] }],
        fields: 'userEnteredValue'
      }
    });

    // spreadsheets.batchUpdate applies these cell changes atomically.
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, spreadsheet.getId());
    properties.setProperty(LAST_CONFIRMED_KEY, drawId);
    properties.deleteProperty(PENDING_KEY);
    return getState();
  });
}

function voidDraw(drawId, reason) {
  return withLock_(function () {
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 200) {
      throw new Error('Enter a short reason (3–200 characters) to void the draw.');
    }
    const properties = PropertiesService.getScriptProperties();
    const pending = readPending_(properties);
    if (!pending || pending.drawId !== drawId) {
      throw new Error('This draw is no longer pending. Refresh the game.');
    }
    if (pending.commitRow && pending.commitRow <= getSpreadsheet_().getSheetByName(WINNERS_TAB).getMaxRows()) {
      const winnersSheet = getSpreadsheet_().getSheetByName(WINNERS_TAB);
      const recorded = winnersSheet.getRange(pending.commitRow, 1, 1, 2).getValues()[0];
      if (String(recorded[0]).trim() === pending.winnerId &&
          String(recorded[1]).trim() === pending.winnerName) {
        properties.setProperty(LAST_CONFIRMED_KEY, drawId);
        properties.deleteProperty(PENDING_KEY);
        throw new Error('This draw was already confirmed. Refresh the game.');
      }
    }
    // The reason deliberately is not stored, as requested for the simple sheet.
    properties.deleteProperty(PENDING_KEY);
    return getState();
  });
}

function pickWinner_(participants, randomValue) {
  const eligible = participants.filter(function (person) { return person.entries > 0; });
  const total = eligible.reduce(function (sum, person) { return sum + person.entries; }, 0);
  if (!total) return null;
  if (typeof randomValue !== 'number' || randomValue < 0 || randomValue >= 1) {
    throw new Error('Invalid random value.');
  }
  let ticket = Math.floor(randomValue * total);
  for (let i = 0; i < eligible.length; i++) {
    ticket -= eligible[i].entries;
    if (ticket < 0) return eligible[i];
  }
  throw new Error('Could not select a winner.');
}

function stateFromData_(data, suppliedPending) {
  const pending = suppliedPending === undefined
    ? readPending_(PropertiesService.getScriptProperties())
    : suppliedPending;
  return {
    participants: data.participants.map(function (item) {
      return { id: item.id, name: item.name, entries: item.entries };
    }),
    winners: data.winners,
    pending: pending ? {
      drawId: pending.drawId,
      winnerId: pending.winnerId,
      winnerName: pending.winnerName,
      createdAt: pending.createdAt
    } : null,
    totalEntries: data.participants.reduce(function (sum, item) { return sum + item.entries; }, 0)
  };
}

function readData_() {
  const spreadsheet = getSpreadsheet_();
  const participantsSheet = spreadsheet.getSheetByName(PARTICIPANTS_TAB);
  const winnersSheet = spreadsheet.getSheetByName(WINNERS_TAB);
  if (!participantsSheet || !winnersSheet) {
    throw new Error('The sheet must have Participants and Winners tabs.');
  }
  requireHeaders_(participantsSheet, ['ID', 'Name', 'Entries']);
  requireHeaders_(winnersSheet, ['ID', 'Name']);

  const participantRows = participantsSheet.getLastRow() > 1
    ? participantsSheet.getRange(2, 1, participantsSheet.getLastRow() - 1, 3).getValues() : [];
  const ids = new Set();
  const participants = [];
  participantRows.forEach(function (row, index) {
    if (row.every(function (cell) { return cell === ''; })) return;
    const id = String(row[0]).trim();
    const name = String(row[1]).trim();
    const entries = row[2];
    if (!id || !name || typeof entries !== 'number' || !Number.isSafeInteger(entries) || entries < 0) {
      throw new Error('Invalid participant on row ' + (index + 2) + '. Use an ID, name, and nonnegative whole number of entries.');
    }
    if (ids.has(id)) throw new Error('Duplicate participant ID: ' + id);
    ids.add(id);
    participants.push({ id: id, name: name, entries: entries, row: index + 2 });
  });

  const winnerRows = winnersSheet.getLastRow() > 1
    ? winnersSheet.getRange(2, 1, winnersSheet.getLastRow() - 1, 2).getValues() : [];
  const winners = winnerRows.filter(function (row) { return row[0] !== '' || row[1] !== ''; })
    .map(function (row) { return { id: String(row[0]).trim(), name: String(row[1]).trim() }; });
  return { spreadsheet: spreadsheet, participantsSheetId: participantsSheet.getSheetId(), participants: participants, winners: winners };
}

function requireHeaders_(sheet, expected) {
  const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
  if (expected.some(function (header, index) { return actual[index] !== header; })) {
    throw new Error(sheet.getName() + ' must start with: ' + expected.join(', '));
  }
}

function readPending_(properties) {
  const json = properties.getProperty(PENDING_KEY);
  return json ? JSON.parse(json) : null;
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

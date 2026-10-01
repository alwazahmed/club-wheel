import { TAU, buildSegments, targetRotation, segmentColor } from './wheel.mjs';

const $ = id => document.getElementById(id);
const ui = {
  canvas: $('wheelCanvas'), message: $('message'), setup: $('setupNotice'),
  connection: $('connectionStatus'), players: $('playerCount'), entries: $('entryCount'),
  winnerCount: $('winnerCount'), eligible: $('eligibleCount'), participantList: $('participantList'),
  winnersList: $('winnersList'), drawIdle: $('drawIdle'), drawResult: $('drawResult'),
  winnerName: $('winnerName'), winnerId: $('winnerId'), spin: $('spinButton'),
  decisions: $('decisionButtons'), confirm: $('confirmButton'), void: $('voidButton'),
  refresh: $('refreshButton'), voidDialog: $('voidDialog'), voidForm: $('voidForm'),
  voidReason: $('voidReason'), cancelVoid: $('cancelVoid')
};

let state = { participants: [], winners: [], pending: null, totalEntries: 0 };
const PENDING_DRAW_KEY = 'club-wheel-pending-draw';
let rotation = 0;
let busy = false;
let animating = false;
let connected = false;
let bridgeWindow = null;
let bridgeOrigin = null;
let requestId = 0;
const requests = new Map();
const scriptUrl = window.CLUB_WHEEL_CONFIG && window.CLUB_WHEEL_CONFIG.appsScriptUrl;

function setMessage(message, kind = 'error') {
  ui.message.textContent = message;
  ui.message.className = message ? `message ${kind}` : 'message hidden';
}

function setConnection(isOnline) {
  connected = isOnline;
  ui.connection.textContent = isOnline ? '● CONNECTED' : '● OFFLINE';
  ui.connection.classList.toggle('online', isOnline);
  renderControls();
}

function isGoogleBridgeOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' &&
      (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com' ||
       url.hostname.endsWith('.script.googleusercontent.com') ||
       url.hostname.endsWith('-script.googleusercontent.com'));
  } catch { return false; }
}

function connectBridge() {
  if (!scriptUrl || !/^https:\/\/script\.google\.com\/macros\/s\//.test(scriptUrl)) {
    ui.setup.classList.remove('hidden');
    ui.connection.textContent = '● SETUP NEEDED';
    return;
  }
  window.addEventListener('message', event => {
    if (!isGoogleBridgeOrigin(event.origin) || !event.data || event.data.app !== 'club-wheel') return;
    if (event.data.type === 'ready') {
      bridgeWindow = event.source;
      bridgeOrigin = event.origin;
      bridgeWindow.postMessage({ app: 'club-wheel', type: 'ack' }, bridgeOrigin);
      if (!connected) {
        setConnection(true);
        refreshState();
      }
      return;
    }
    if (event.source !== bridgeWindow || event.origin !== bridgeOrigin || event.data.type !== 'response') return;
    const waiting = requests.get(event.data.id);
    if (!waiting) return;
    requests.delete(event.data.id);
    clearTimeout(waiting.timeout);
    if (event.data.ok) waiting.resolve(event.data.value);
    else waiting.reject(new Error(event.data.error || 'The sheet request failed.'));
  });
  const frame = document.createElement('iframe');
  frame.src = scriptUrl;
  frame.title = 'Google Sheets connection';
  frame.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
  frame.setAttribute('aria-hidden', 'true');
  document.body.appendChild(frame);
  setTimeout(() => {
    if (!connected) setMessage('Could not connect to Google Sheets. Check the Apps Script URL and deployment access.');
  }, 15000);
}

function callBackend(method, ...args) {
  if (!connected || !bridgeWindow) return Promise.reject(new Error('The sheet connection is not ready.'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      requests.delete(id);
      reject(new Error('The sheet request timed out. Refresh and check the current draw before retrying.'));
    }, 30000);
    requests.set(id, { resolve, reject, timeout });
    bridgeWindow.postMessage({ app: 'club-wheel', type: 'request', id, method, args }, bridgeOrigin);
  });
}

function updateState(next) {
  state = next;
  render();
}

function readLocalPending() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_DRAW_KEY) || 'null');
    return pending && typeof pending.drawId === 'string' && typeof pending.winnerId === 'string' &&
      typeof pending.winnerName === 'string' ? pending : null;
  } catch { return null; }
}

function chooseWinner(participants) {
  const eligible = participants.filter(person => Number.isSafeInteger(person.entries) && person.entries > 0);
  const total = eligible.reduce((sum, person) => sum + person.entries, 0);
  if (!Number.isSafeInteger(total) || total < 1) return null;
  let ticket = Math.floor(Math.random() * total);
  for (const person of eligible) {
    ticket -= person.entries;
    if (ticket < 0) return person;
  }
  return null;
}

function render() {
  const eligible = state.participants.filter(person => person.entries > 0);
  ui.players.textContent = String(state.participants.length);
  ui.entries.textContent = state.totalEntries.toLocaleString();
  ui.winnerCount.textContent = String(state.winners.length);
  ui.eligible.textContent = `${eligible.length} eligible`;
  renderPeople(eligible);
  renderWinners();
  renderControls();
  drawWheel();
}

function renderPeople(eligible) {
  ui.participantList.replaceChildren();
  if (!eligible.length) {
    const note = document.createElement('p');
    note.className = 'empty-list';
    note.textContent = 'No entries remain.';
    ui.participantList.append(note);
    return;
  }
  eligible.forEach((person, index) => {
    const row = document.createElement('div'); row.className = 'participant-row';
    const swatch = document.createElement('span'); swatch.className = 'participant-swatch';
    swatch.style.backgroundColor = segmentColor(index);
    const name = document.createElement('span'); name.className = 'participant-name'; name.textContent = person.name;
    const count = document.createElement('span'); count.className = 'participant-entries';
    count.textContent = `${person.entries} ${person.entries === 1 ? 'entry' : 'entries'}`;
    row.append(swatch, name, count);
    ui.participantList.append(row);
  });
}

function renderWinners() {
  ui.winnersList.replaceChildren();
  const recent = state.winners.slice(-8).reverse();
  if (!recent.length) {
    const item = document.createElement('li'); item.className = 'empty-list'; item.textContent = 'No winners yet';
    ui.winnersList.append(item);
    return;
  }
  recent.forEach((person, index) => {
    const item = document.createElement('li');
    const name = document.createElement('span'); name.textContent = person.name;
    const rank = document.createElement('span'); rank.className = 'winner-rank';
    rank.textContent = `#${state.winners.length - index}`;
    item.append(name, rank); ui.winnersList.append(item);
  });
}

function renderControls() {
  const pending = state.pending;
  const showResult = Boolean(pending) && !animating;
  ui.drawIdle.classList.toggle('hidden', showResult);
  ui.drawResult.classList.toggle('hidden', !showResult);
  ui.decisions.classList.toggle('hidden', !showResult);
  ui.spin.classList.toggle('hidden', Boolean(pending) && !animating);
  ui.spin.textContent = animating ? 'SPINNING…' : '✳  SPIN THE WHEEL';
  if (showResult) {
    ui.winnerName.textContent = pending.winnerName;
    ui.winnerId.textContent = `Participant ID: ${pending.winnerId}`;
  }
  ui.spin.disabled = !connected || busy || Boolean(pending) || state.totalEntries < 1;
  ui.confirm.disabled = !connected || busy;
  ui.void.disabled = !connected || busy;
  ui.refresh.disabled = !connected || busy;
  if (!pending && state.totalEntries < 1 && connected) {
    ui.drawIdle.querySelector('h2').textContent = 'All entries have been used.';
    ui.drawIdle.querySelector('p').textContent = 'Add entries in the sheet to play again.';
  } else {
    ui.drawIdle.querySelector('h2').textContent = 'The next name is waiting.';
    ui.drawIdle.querySelector('p').textContent = 'Each remaining entry counts as one chance.';
  }
}

function drawWheel() {
  const canvas = ui.canvas;
  const rect = canvas.getBoundingClientRect();
  const size = Math.max(1, rect.width);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(size * scale);
  if (canvas.width !== pixels || canvas.height !== pixels) { canvas.width = pixels; canvas.height = pixels; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const center = size / 2;
  const radius = center - 2;
  const segments = buildSegments(state.participants);
  if (!segments.length) {
    ctx.fillStyle = '#253450'; ctx.beginPath(); ctx.arc(center, center, radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffffff28'; ctx.lineWidth = 3; ctx.stroke();
    return;
  }
  segments.forEach(segment => {
    const start = -Math.PI / 2 + rotation + segment.start * TAU;
    const end = -Math.PI / 2 + rotation + segment.end * TAU;
    ctx.beginPath(); ctx.moveTo(center, center); ctx.arc(center, center, radius, start, end); ctx.closePath();
    ctx.fillStyle = segmentColor(segment.index); ctx.fill();
    if (segments.length <= 90) { ctx.strokeStyle = '#142039a6'; ctx.lineWidth = 1.6; ctx.stroke(); }
    if (segments.length <= 36 && (segment.end - segment.start) * TAU > .16) {
      const mid = (start + end) / 2;
      ctx.save(); ctx.translate(center, center); ctx.rotate(mid);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(10, Math.min(15, size / 34))}px DM Sans, sans-serif`;
      ctx.fillStyle = '#102137';
      const label = segment.name.length > 14 ? `${segment.name.slice(0, 13)}…` : segment.name;
      ctx.fillText(label, radius - 15, 0, radius * .55);
      ctx.restore();
    }
  });
  ctx.beginPath(); ctx.arc(center, center, radius - 2, 0, TAU);
  ctx.strokeStyle = '#ffffffbb'; ctx.lineWidth = 4; ctx.stroke();
}

function animateTo(winnerId) {
  const finish = targetRotation(rotation, buildSegments(state.participants), winnerId);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    rotation = finish % TAU;
    drawWheel();
    return Promise.resolve();
  }
  const start = rotation;
  const duration = 6100;
  const begun = performance.now();
  return new Promise(resolve => {
    function frame(now) {
      const progress = Math.min(1, (now - begun) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      rotation = start + (finish - start) * eased;
      drawWheel();
      if (progress < 1) requestAnimationFrame(frame);
      else { rotation %= TAU; resolve(); }
    }
    requestAnimationFrame(frame);
  });
}

async function refreshState() {
  if (busy) return;
  try {
    const next = await callBackend('getState');
    next.pending = readLocalPending();
    if (next.pending) {
      const segment = buildSegments(next.participants).find(item => item.id === next.pending.winnerId);
      if (segment) rotation = targetRotation(rotation, buildSegments(next.participants), next.pending.winnerId) % TAU;
    }
    updateState(next);
    setMessage('');
  } catch (error) { setMessage(error.message); }
}

async function spin() {
  if (busy || state.pending || state.totalEntries < 1) return;
  busy = true; animating = true; renderControls(); setMessage('');
  try {
    const winner = chooseWinner(state.participants);
    if (!winner) throw new Error('No entries remain. Refresh from the sheet and try again.');
    state.pending = { drawId: crypto.randomUUID(), winnerId: winner.id, winnerName: winner.name };
    localStorage.setItem(PENDING_DRAW_KEY, JSON.stringify(state.pending));
    render();
    await animateTo(winner.id);
  } catch (error) { setMessage(error.message); }
  finally { animating = false; busy = false; render(); }
}

async function confirm() {
  if (busy || !state.pending) return;
  busy = true; renderControls(); setMessage('');
  try {
    const next = await callBackend('confirmDraw', state.pending.drawId, state.pending.winnerId, state.pending.winnerName);
    localStorage.removeItem(PENDING_DRAW_KEY);
    next.pending = null;
    updateState(next);
    setMessage('Winner confirmed. One entry was used.', 'success');
  } catch (error) { setMessage(error.message); }
  finally { busy = false; renderControls(); }
}

async function voidPending(reason) {
  if (busy || !state.pending) return;
  busy = true; renderControls(); setMessage('');
  try {
    localStorage.removeItem(PENDING_DRAW_KEY);
    state.pending = null;
    render();
    ui.voidDialog.close();
    ui.voidReason.value = '';
    setMessage('Draw voided. No entry was used.', 'success');
  } catch (error) { setMessage(error.message); }
  finally { busy = false; renderControls(); }
}

ui.spin.addEventListener('click', spin);
ui.confirm.addEventListener('click', confirm);
ui.void.addEventListener('click', () => ui.voidDialog.showModal());
ui.refresh.addEventListener('click', refreshState);
ui.cancelVoid.addEventListener('click', () => ui.voidDialog.close());
ui.voidForm.addEventListener('submit', event => {
  event.preventDefault();
  if (ui.voidForm.reportValidity()) voidPending(ui.voidReason.value.trim());
});
new ResizeObserver(drawWheel).observe(ui.canvas);
render();
connectBridge();
setInterval(() => { if (connected && !busy && !ui.voidDialog.open) refreshState(); }, 15000);

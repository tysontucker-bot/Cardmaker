// Sends Take Data sessions to The Parachute's Google Sheet (Trial Log + Goal Log).
// Each session is sent whole, so editing or clearing a box later updates the Sheet too.
// If the internet drops, sessions wait on this device and send when it's back.

const ENDPOINT = "https://script.google.com/macros/s/AKfycbz3MkE3Ev39aRMZK9lkbcgRvSjt1HKmcz75D-PAJa-YOL0qQvZnkIs-2yK8IxQj3bs/exec";
const KEY = "skhqdkxwzat0zmt2qg"; // must match KEY in The Parachute's Code.gs
const OUTBOX = 'cardmaker:parachute-outbox';
const BY_KEY = 'cardmaker:parachute-by';

let students = [];
let staff = [];
let listeners = [];
let sending = false;
let retryTimer = null;
let lastError = '';

const read = () => { try { return JSON.parse(localStorage.getItem(OUTBOX) || '{}'); } catch { return {}; } };
const write = (box) => { try { localStorage.setItem(OUTBOX, JSON.stringify(box)); } catch {} };

function tell() {
  const waiting = Object.keys(read()).length;
  const text = waiting
    ? (lastError ? `⚠ ${waiting} session${waiting === 1 ? '' : 's'} waiting to send to The Parachute` : 'Sending to The Parachute…')
    : '✓ Sent to The Parachute';
  listeners.forEach((fn) => fn(text, !!(waiting && lastError)));
}
export function onLinkStatus(fn) { listeners = [fn]; tell(); }

export function getBy() {
  try { return localStorage.getItem(BY_KEY) || localStorage.getItem('parachute:by') || 'Mr. Tucker'; } catch { return 'Mr. Tucker'; }
}
export function setBy(name) { try { localStorage.setItem(BY_KEY, name); } catch {} }

// Students and staff from The Parachute, so names match its Students tab
export async function loadParachuteNames() {
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set('action', 'setup'); url.searchParams.set('key', KEY);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    const data = JSON.parse(await res.text());
    if (data.ok) {
      students = (data.students || []).map((s) => s.initials);
      staff = data.staff || [];
      try { localStorage.setItem('cardmaker:parachute-names', JSON.stringify({ students, staff })); } catch {}
    }
  } catch {
    try { ({ students, staff } = JSON.parse(localStorage.getItem('cardmaker:parachute-names') || '{"students":[],"staff":[]}')); } catch {}
  }
  return { students, staff };
}
export const parachuteStudents = () => students;
export const parachuteStaff = () => staff;

// session: a Take Data session from live-data.js
export function queueSession(session, arraySize) {
  if (!session || !session.id || !session.student) return;
  const box = read();
  box[session.id] = {
    action: 'cardmakerSession',
    sid: 'cm-' + session.id,
    student: session.student,
    date: session.date,
    program: session.relationshipLabel || '',
    arraySize: Number(session.arraySize || arraySize) || '',
    by: getBy(),
    at: session.updatedAt || Date.now(),
    rows: (session.rows || []).map((r) => ({ target: r.target, trials: r.trials, picked: r.picked || [] }))
  };
  write(box);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(send, 1500); // waits for a pause in tapping
  tell();
}

async function send() {
  if (sending) return;
  sending = true;
  clearTimeout(retryTimer);
  try {
    for (const id of Object.keys(read())) {
      const payload = read()[id];
      if (!payload) continue;
      const res = await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ ...payload, key: KEY }) });
      const data = JSON.parse(await res.text());
      if (!data.ok) throw new Error(data.error || 'error');
      const box = read();
      if (box[id] && box[id].at === payload.at && JSON.stringify(box[id].rows) === JSON.stringify(payload.rows)) delete box[id];
      write(box);
    }
    lastError = '';
  } catch (e) {
    lastError = e.message || 'error';
    retryTimer = setTimeout(send, 30000);
  } finally {
    sending = false;
    if (Object.keys(read()).length && !lastError) retryTimer = setTimeout(send, 500);
    tell();
  }
}

window.addEventListener('online', send);
document.addEventListener('visibilitychange', () => { if (!document.hidden) send(); });
if (Object.keys(read()).length) setTimeout(send, 1000);

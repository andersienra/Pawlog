// Storage layer: shared db (claude runtime or Firebase adapter) or localStorage; write queue,
// live subscriptions, people/attribution, debounced edits, midnight rollover, save indicator.
import { S, curDog, deepMerge, entryId, isPlainObj, normalizeEntry } from './state.js';
import { onReady, render, scheduleRender, toast } from './ui.js';
import { $, COLS, I, LS_DATA, LS_FULL, LS_PHOTOS, SHARED_ROOT, clone, fmt, lsGet, lsSet, sleep, todayStr } from './util.js';

/* =========================================================
   Storage adapter: shared db (pawlog/main/...) or localStorage
   - Whole-doc writes (set) for dogs, behaviors, events, photos, settings.
   - Entries are written as merge patches (update) so two people editing
     the same day keep each other's changes. Patches are coalesced per doc,
     one write in flight per doc, and kept as a local "overlay" until the
     store confirms them so incoming snapshots never roll back unsaved edits.
   ========================================================= */
export let DB = null, ROOT = null;
export const writers = new Map();        // "col/id" -> { running, next: op }
export const pendingEdits = new Map();   // "col/id" -> { timer, fn }
export const unsent = new Map();         // "col/id" -> merged patch not yet queued (debounced)
export const overlay = new Map();        // "col/id" -> merged patch not yet confirmed by the store
export const existing = new Set();       // "col/id" known to exist in the store
export const lastWritten = new Map();
export let activeWrites = 0; export const waitQ = [];
export let localTimer = null; export const localDirty = { data: false, photos: false, full: false };

export function stamp(patch) {
  if (!S.me) return patch;
  const now = Date.now();
  const st = { updatedAt: now, updatedBy: S.me, editors: {} };
  st.editors[S.me] = now;
  return deepMerge(st, patch);
}

export const Store = {
  put(col, id, data) {
    if (!canWrite()) return false;
    S[col][id] = data;
    if (S.mode === 'db') dbQueue(col, id, { kind: 'set', data: clone(data) });
    else if (S.mode === 'local') localSave(col);
    return true;
  },
  del(col, id) {
    if (!canWrite()) return false;
    delete S[col][id];
    const key = col + '/' + id;
    unsent.delete(key); overlay.delete(key);
    const p = pendingEdits.get(key); if (p) { clearTimeout(p.timer); pendingEdits.delete(key); }
    if (S.mode === 'db') dbQueue(col, id, { kind: 'del' });
    else if (S.mode === 'local') localSave(col);
    return true;
  },
  // Merge `patch` into the doc now (locally) and send it after `ms` (debounced) or immediately.
  patch(col, id, patch, create, ms) {
    if (!canWrite()) return false;
    const key = col + '/' + id;
    patch = stamp(patch);
    const cur = S[col][id] ? clone(S[col][id]) : clone(create || {});
    S[col][id] = deepMerge(cur, patch);
    if (S.mode === 'local') {
      if (!ms) { localSave(col); return true; }
      debounced(col, id, () => localSave(col), ms);
      return true;
    }
    overlay.set(key, deepMerge(overlay.get(key) || {}, clone(patch)));
    unsent.set(key, deepMerge(unsent.get(key) || {}, clone(patch)));
    const send = () => {
      const p = unsent.get(key);
      if (!p) return;
      unsent.delete(key);
      dbQueue(col, id, { kind: 'patch', patch: p, create: clone(create || {}) });
    };
    if (ms) debounced(col, id, send, ms);
    else { const pe = pendingEdits.get(key); if (pe) { clearTimeout(pe.timer); pendingEdits.delete(key); } send(); }
    return true;
  }
};

export function canWrite() {
  if (S.readOnly) { toast('You can view but not edit. Ask the owner to share with Editor access.', true); return false; }
  return true;
}

// --- local ---
export function localSave(col) {
  if (col === 'photos') localDirty.photos = true;
  else if (col === 'photoFull') localDirty.full = true;
  else localDirty.data = true;
  setSaveState('saving');
  clearTimeout(localTimer);
  localTimer = setTimeout(localFlush, 250);
}
export function localFlush() {
  clearTimeout(localTimer); localTimer = null;
  if (S.mode !== 'local') return;
  let ok = true;
  if (localDirty.data) {
    ok = lsSet(LS_DATA, JSON.stringify({ dogs: S.dogs, behaviors: S.behaviors, entries: S.entries, events: S.events, settings: S.settings })) && ok;
    localDirty.data = false;
  }
  if (localDirty.photos) { ok = lsSet(LS_PHOTOS, JSON.stringify(S.photos)) && ok; localDirty.photos = false; }
  if (localDirty.full) { ok = lsSet(LS_FULL, JSON.stringify(S.photoFull)) && ok; localDirty.full = false; }
  if (!ok) { setSaveState('error'); toast("Couldn't save on this device. Storage may be full or blocked; export a backup from Settings.", true); }
  else setSaveState(pendingEdits.size ? 'saving' : 'saved');
}
export function startLocal(reason) {
  S.mode = 'local'; S.reason = reason;
  const raw = lsGet(LS_DATA);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      for (const c of COLS) if (c !== 'photos' && d && d[c] && typeof d[c] === 'object') S[c] = d[c];
    } catch (e) { /* corrupted; start fresh */ }
  }
  for (const id in S.entries) S.entries[id] = normalizeEntry(S.entries[id]);
  const p = lsGet(LS_PHOTOS);
  if (p) { try { S.photos = JSON.parse(p) || {}; } catch (e) { S.photos = {}; } }
  const f = lsGet(LS_FULL);
  if (f) { try { S.photoFull = JSON.parse(f) || {}; } catch (e) { S.photoFull = {}; } }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  S.ready = true;
  onReady();
}

// --- db write queue ---
export function release() { activeWrites--; const n = waitQ.shift(); if (n) n(); }
export function combine(prev, op) {
  if (!prev || op.kind === 'set' || op.kind === 'del') return op;
  // op is a patch
  if (prev.kind === 'patch') return { kind: 'patch', patch: deepMerge(prev.patch, op.patch), create: op.create };
  if (prev.kind === 'set') return { kind: 'set', data: deepMerge(prev.data, op.patch) };
  return { kind: 'set', data: deepMerge(clone(op.create || {}), op.patch) }; // after a delete
}
export function dbQueue(col, id, op) {
  const key = col + '/' + id;
  if (op.kind === 'set') {
    const sig = JSON.stringify(op.data);
    if (!writers.has(key) && lastWritten.get(key) === sig) return;
  }
  let w = writers.get(key);
  if (!w) { w = { running: false, next: undefined }; writers.set(key, w); }
  w.next = combine(w.next, op);
  setSaveState('saving');
  if (!w.running) pump(key, col, id, w);
}
export async function pump(key, col, id, w) {
  w.running = true;
  while (w.next !== undefined) {
    const op = w.next; w.next = undefined;
    // Take a slot synchronously when one is free so a pagehide flush starts its writes before the page freezes.
    if (activeWrites < 4) activeWrites++;
    else { await new Promise((r) => waitQ.push(r)); activeWrites++; }
    try {
      await doWrite(col, id, op, key);
      if (op.kind === 'del') { existing.delete(key); lastWritten.set(key, '__del'); }
      else { existing.add(key); if (op.kind === 'set') lastWritten.set(key, JSON.stringify(op.data)); }
    } catch (e) {
      writeFailed(e, col);
    } finally { release(); }
  }
  w.running = false;
  writers.delete(key);
  if (!unsent.has(key) && !pendingEdits.has(key)) overlay.delete(key);
  refreshSaveState();
}
export const FATAL = ['invalid_argument', 'quota_exceeded', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error'];
export async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && FATAL.indexOf(e.code) >= 0) throw e;
    await sleep(500 + Math.random() * 1200);
    return await fn();
  }
}
export async function doWrite(col, id, op, key) {
  const ref = ROOT.collection(col).doc(id);
  if (op.kind === 'del') return withRetry(() => ref.delete());
  if (op.kind === 'set') return withRetry(() => ref.set(op.data));
  // patch: update() if the doc exists, otherwise create it with set(); if another person
  // created it in the meantime, fall back to update() so neither side is lost.
  if (existing.has(key)) {
    try { return await withRetry(() => ref.update(op.patch)); }
    catch (e) { if (!e || e.code !== 'invalid_argument') throw e; existing.delete(key); }
  }
  const snap = await withRetry(() => ref.get());
  if (snap.exists) { existing.add(key); return withRetry(() => ref.update(op.patch)); }
  const body = deepMerge(clone(op.create || {}), op.patch);
  if (S.me && !body.createdBy) { body.createdBy = S.me; body.createdAt = Date.now(); }
  await withRetry(() => ref.set(body));
  existing.add(key);
  // Two people can both see "no doc yet" and both create it; the later set() replaces the earlier one.
  // Re-read shortly after and, if our fields were lost, merge them back with update().
  setTimeout(async () => {
    try {
      const s2 = await ref.get();
      if (!s2.exists) return;
      if (!containsPatch(s2.data(), op.patch)) await ref.update(op.patch);
    } catch (e) { /* the next edit will merge again */ }
  }, 700 + Math.random() * 500);
}
export function containsPatch(doc, patch) {
  for (const k in patch) {
    if (k === 'updatedAt' || k === 'updatedBy' || k === 'editors') continue;
    const v = patch[k];
    if (isPlainObj(v)) { if (!isPlainObj(doc[k]) || !containsPatch(doc[k], v)) return false; }
    else if (JSON.stringify(doc[k]) !== JSON.stringify(v)) return false;
  }
  return true;
}
export let roProbe = false;
export function writeFailed(e, col) {
  const c = e && e.code;
  if (S.accessDenied) return;
  let msg = "Couldn't save your change. Check your connection and try again.";
  if (c === 'quota_exceeded') msg = 'Storage is full. Delete old photos or entries to make room.';
  else if (c === 'invalid_argument') {
    if (S.canWrite === null && col !== 'photos' && col !== 'photofull' && !roProbe) {
      // Platform gave no write-permission answer and a normal write was refused: treat as view-only.
      roProbe = true; setReadOnly(true); return;
    }
    msg = col === 'photos' || col === 'photofull' ? 'That photo is too large to save. Try a smaller one.' : "Couldn't save this change. It may be too large.";
  }
  else if (c === 'revoked' || c === 'not_granted') msg = 'Saving is no longer available on this page. Reload to reconnect.';
  else if (c === 'resource_exhausted') msg = 'Saving too fast. Wait a moment and try again.';
  setSaveState('error');
  toast(msg, true);
}

// --- db subscriptions ---
export const SUB_COLS = ['dogs', 'behaviors', 'entries', 'events', 'photos', 'settings'];
export function startDb(db) {
  S.mode = 'db';
  DB = db;
  ROOT = db.doc(SHARED_ROOT);
  const seen = new Set();
  for (const col of SUB_COLS) subscribe(col, seen, 0);
  setTimeout(() => { if (!S.ready) { S.ready = true; onReady(); } }, 12000);
}
export function subscribe(col, seen, attempt) {
  let unsub = null;
  try {
    unsub = ROOT.collection(col).onSnapshot((snap) => {
      const initial = !seen.has(col);
      let touched = false, todayTouched = false;
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id, key = col + '/' + id;
        if (ch.type === 'removed') {
          existing.delete(key);
          if (writers.has(key) || pendingEdits.has(key)) continue;
          delete S[col][id]; lastWritten.set(key, '__del');
          touched = true;
          continue;
        }
        existing.add(key);
        const d = clone(ch.doc.data());
        if (col === 'entries') {
          const ov = overlay.get(key);
          const before = S.entries[id] ? JSON.stringify(S.entries[id]) : '';
          S.entries[id] = ov ? deepMerge(d, clone(ov)) : d;
          if (JSON.stringify(S.entries[id]) === before) continue;
          if (!initial && S.ready && d.updatedBy && d.updatedBy !== S.me) noteRemoteChange(id, d.updatedBy);
          const dog = curDog();
          if (dog && id === entryId(dog.id, S.date)) todayTouched = true;
        } else {
          if (writers.has(key) || pendingEdits.has(key)) continue;
          S[col][id] = d; lastWritten.set(key, JSON.stringify(d));
        }
        touched = true;
      }
      if (initial) {
        seen.add(col);
        if (seen.size === SUB_COLS.length && !S.ready) { S.ready = true; onReady(); return; }
      }
      if (S.ready && touched) scheduleRender({ todayEntry: todayTouched, col: col });
    }, (err) => {
      const c = err && err.code;
      if (S.accessDenied) { if (!seen.has(col)) seen.add(col); return; }
      if ((c === 'unavailable' || !c) && attempt < 4) setTimeout(() => subscribe(col, seen, attempt + 1), 1500 * (attempt + 1));
      else if (c === 'revoked') toast('Sync is no longer available on this page.', true);
      else toast('Live sync stopped. Reload the page to reconnect.', true);
      if (!seen.has(col)) { seen.add(col); if (seen.size === SUB_COLS.length && !S.ready) { S.ready = true; onReady(); } }
    });
  } catch (e) {
    seen.add(col);
    toast("Couldn't open your saved data.", true);
  }
  return unsub;
}

// "Sam updated today's log" — debounced, only for the day being viewed, never on initial load.
export let remoteToastTimer = null; export const remoteWho = new Set();
export function noteRemoteChange(id, who) {
  const dog = curDog();
  if (!dog || id !== entryId(dog.id, S.date)) return;
  remoteWho.add(who);
  clearTimeout(remoteToastTimer);
  remoteToastTimer = setTimeout(async () => {
    const ids = Array.from(remoteWho); remoteWho.clear();
    await resolveNames(ids);
    const names = ids.map(personName);
    const day = S.date === todayStr() ? 'today’s log' : fmt(S.date, { month: 'short', day: 'numeric' }) + ' log';
    toast((names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + ' updated ' + day);
  }, 1200);
}

// --- people (ids only in data; names resolved at render time) ---
export let namesPending = false;
export async function resolveNames(ids) {
  if (!S.user || !ids.length) return;
  try {
    const ps = await S.user.profiles(ids);
    let changed = false;
    for (const id of ids) {
      const p = ps && ps[id];
      const nm = p ? (p.name || '') : '';
      if (S.names[id] !== nm) { S.names[id] = nm; changed = true; }
      if (p && p.avatarUrl) S.avatars[id] = p.avatarUrl;
    }
    return changed;
  } catch (e) { return false; }
}
export function personName(id) {
  if (!id) return 'Someone';
  if (id === S.me) return 'You';
  return S.names[id] || 'Someone';
}
// Called from render paths: resolve any ids we haven't named yet, then re-render once.
export function wantNames(ids) {
  if (!S.user) return;
  const missing = ids.filter((id) => id && !(id in S.names));
  if (!missing.length || namesPending) return;
  namesPending = true;
  missing.forEach((id) => { S.names[id] = S.names[id] || ''; });
  resolveNames(missing).then(() => { namesPending = false; scheduleRender({}); });
}
export function byLine(e) {
  if (!e || S.mode !== 'db') return '';
  const creator = e.createdBy || null;
  const eds = e.editors ? Object.keys(e.editors).sort((a, b) => e.editors[a] - e.editors[b]) : [];
  const others = eds.filter((x) => x !== creator);
  const ids = (creator ? [creator] : []).concat(others);
  if (!ids.length) return '';
  // Only worth showing when someone other than me is involved.
  if (!ids.some((x) => x !== S.me)) return '';
  wantNames(ids);
  let s = creator ? 'Logged by ' + personName(creator) : 'Logged by ' + personName(others.shift());
  if (others.length) s += ' · edited by ' + others.map(personName).join(', ');
  return s;
}
export function peopleSeen() {
  const ids = new Set();
  if (S.me) ids.add(S.me);
  const add = (x) => { if (typeof x === 'string' && x) ids.add(x); };
  for (const col of SUB_COLS) for (const d of Object.values(S[col])) {
    if (!d) continue;
    add(d.createdBy); add(d.updatedBy);
    if (d.editors) Object.keys(d.editors).forEach(add);
  }
  return Array.from(ids);
}

// --- debounced edits & flush ---
export function debounced(col, id, fn, ms) {
  const key = col + '/' + id;
  const prev = pendingEdits.get(key);
  if (prev) clearTimeout(prev.timer);
  const run = () => { pendingEdits.delete(key); fn(); };
  pendingEdits.set(key, { timer: setTimeout(run, ms || 650), fn: run });
  setSaveState('saving');
}
export function flushPending() {
  for (const [, p] of Array.from(pendingEdits)) { clearTimeout(p.timer); p.fn(); }
  if (S.mode === 'local' && localTimer) localFlush();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); else checkDayRollover(); });
// If the app stays open (or is resumed from the background) past midnight, move "Today" to the new day
// instead of silently writing the new day's log into yesterday's entry.
export let lastToday = todayStr();
export function checkDayRollover() {
  const t = todayStr();
  if (t === lastToday) return;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest && a.closest('#app')) return; // retry later, never mid-typing
  const wasToday = S.date === lastToday;
  lastToday = t;
  if (!S.ready) return;
  flushPending();
  if (wasToday) { S.date = t; S.addingTag = false; }
  render();
}
window.addEventListener('focus', checkDayRollover);
document.addEventListener('focusout', () => setTimeout(checkDayRollover, 80));
setInterval(checkDayRollover, 60000);
// pagehide: everything here is synchronous — debounced patches are queued and their writes are
// started (the write queue takes free slots synchronously), local mode writes localStorage directly.
window.addEventListener('pagehide', flushPending);
window.addEventListener('beforeunload', flushPending);

// --- save indicator ---
export let saveFadeTimer = null;
export function refreshSaveState() {
  if (S.saveState === 'error' && !writers.size) return;
  setSaveState(writers.size || pendingEdits.size || localTimer ? 'saving' : 'saved');
}
export function setSaveState(st) {
  S.saveState = st;
  const el = $('#savestate');
  if (!el) return;
  clearTimeout(saveFadeTimer);
  el.classList.toggle('err', st === 'error');
  el.style.opacity = '1';
  if (st === 'saving') el.innerHTML = 'Saving…';
  else if (st === 'saved') { el.innerHTML = I.check + 'Saved'; saveFadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 1800); }
  else if (st === 'error') el.innerHTML = 'Not saved';
  else el.innerHTML = '';
}

// --- permissions ---
export function setReadOnly(v) {
  S.readOnly = !!v;
  document.body.classList.toggle('ro', S.readOnly);
  if (S.ready) render();
}

// In-memory state (S), per-device prefs, shared settings, entry/event helpers and scoring.
import { Store } from './store.js';
import { DEFAULT_TAGS, LS_PREFS, LS_THEME, addDays, clamp, diffDays, fmt, isDate, lsGet, lsSet, pd, plural, todayStr } from './util.js';

/* =========================================================
   State
   ========================================================= */
export const S = {
  mode: 'loading', reason: '',
  dogs: {}, behaviors: {}, entries: {}, events: {}, photos: {}, settings: {},
  photoFull: {},   // id -> full-size data URL (lazy-loaded in db mode, persisted in local mode)
  ready: false,
  view: 'today', date: todayStr(),
  histMonth: todayStr().slice(0, 7), search: '', histLimit: 20,
  insRange: '30', dowB: null,
  detailsOpen: false, addingTag: false,
  uploading: 0,
  saveState: 'idle', scroll: {},
  me: null, user: null, names: {}, avatars: {}, readOnly: false
};

// Per-person prefs (theme, active dog) stay on this device; shared settings (quick tags) live in the store.
export function prefs() { try { return JSON.parse(lsGet(LS_PREFS) || '{}') || {}; } catch (e) { return {}; } }
export function setPref(k, v) { const p = prefs(); p[k] = v; lsSet(LS_PREFS, JSON.stringify(p)); }
export const settings = () => {
  const shared = S.settings.app || {};
  const p = prefs();
  return {
    quickTags: Array.isArray(shared.quickTags) ? shared.quickTags.slice() : DEFAULT_TAGS.slice(),
    activeDogId: p.activeDogId || shared.activeDogId || null,
    theme: p.theme || lsGet(LS_THEME) || 'system'
  };
};
export function saveQuickTags(list) {
  const cur = S.settings.app || {};
  Store.put('settings', 'app', { quickTags: list, updatedBy: S.me || null, updatedAt: Date.now(), activeDogId: cur.activeDogId || null });
}

// ---- Entry shape helpers. Entries are written field-by-field so concurrent edits merge:
// ratings {behaviorId: n|null}, tags {name: true|false}, photos {photoId: createdAt|null}.
// Older entries (arrays) are still read correctly.
export function ratingsOf(e) {
  const out = {};
  if (e && e.ratings) for (const k in e.ratings) if (typeof e.ratings[k] === 'number') out[k] = e.ratings[k];
  return out;
}
export function tagsOf(e) {
  if (!e || !e.tags) return [];
  if (Array.isArray(e.tags)) return e.tags.slice();
  return Object.keys(e.tags).filter((k) => e.tags[k] === true || typeof e.tags[k] === 'number').sort((a, b) => (typeof e.tags[a] === 'number' ? e.tags[a] : 0) - (typeof e.tags[b] === 'number' ? e.tags[b] : 0));
}
export function photosOf(e) {
  if (!e) return [];
  const out = [];
  if (Array.isArray(e.photoAssetIds)) e.photoAssetIds.forEach((id, i) => out.push([id, i]));
  if (e.photos && typeof e.photos === 'object') for (const k in e.photos) if (e.photos[k] != null && e.photos[k] !== false && !out.some((x) => x[0] === k)) out.push([k, Number(e.photos[k]) || 0]);
  return out.sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}
export function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
export function deepMerge(target, patch) {
  for (const k in patch) {
    const v = patch[k];
    if (isPlainObj(v) && isPlainObj(target[k])) deepMerge(target[k], v);
    else target[k] = isPlainObj(v) ? deepMerge({}, v) : (Array.isArray(v) ? v.slice() : v);
  }
  return target;
}
// Convert a legacy array-shaped entry to the map shape (used on import / local load).
export function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return e;
  const n = Object.assign({}, e);
  if (Array.isArray(n.tags)) { const m = {}; n.tags.forEach((t) => { m[t] = true; }); n.tags = m; }
  if (Array.isArray(n.photoAssetIds)) { const m = Object.assign({}, n.photos || {}); n.photoAssetIds.forEach((id, i) => { m[id] = (n.updatedAt || 0) + i; }); n.photos = m; delete n.photoAssetIds; }
  return n;
}
export const sortedDogs = () => Object.values(S.dogs).filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
export function curDog() {
  const s = settings();
  return S.dogs[s.activeDogId] || sortedDogs()[0] || null;
}
export const dogBehaviors = (dogId, includeArchived) => Object.values(S.behaviors)
  .filter((b) => b && b.dogId === dogId && (includeArchived || !b.archived))
  .sort((a, b) => (a.order || 0) - (b.order || 0));
export const entryId = (dogId, date) => dogId + '_' + date;
export const getEntry = (dogId, date) => S.entries[entryId(dogId, date)] || null;
export function isLogged(e) {
  if (!e) return false;
  return Object.keys(ratingsOf(e)).length > 0 || !!(e.notes && String(e.notes).trim()) || tagsOf(e).length > 0 ||
    photosOf(e).length > 0 || e.walkMinutes != null || e.weight != null || e.meals != null;
}
export function dogEntries(dogId) {
  return Object.values(S.entries).filter((e) => e && e.dogId === dogId && isDate(e.date) && isLogged(e)).sort((a, b) => (a.date < b.date ? 1 : -1));
}
export function goodness(b, r) { return b.higherIsBetter ? r : 11 - r; }
export function entryScore(e) {
  if (!e || !e.ratings) return null;
  const rs = ratingsOf(e);
  let sum = 0, n = 0;
  for (const b of dogBehaviors(e.dogId)) {
    const r = rs[b.id];
    if (typeof r === 'number') { sum += goodness(b, r); n++; }
  }
  return n ? Math.round(((sum / n) - 1) / 9 * 100) : null;
}
export function scoreWord(s) {
  if (s == null) return 'Not rated yet';
  if (s >= 80) return 'Great day';
  if (s >= 62) return 'Good day';
  if (s >= 40) return 'Mixed day';
  return 'Rough day';
}
// g in 0..1 -> color between bad / mid / good
export function mixColor(g, mid) {
  g = clamp(g, 0, 1);
  if (g < 0.5) return 'color-mix(in oklab, var(--bad) ' + Math.round((1 - g * 2) * 100) + '%, var(' + mid + '))';
  return 'color-mix(in oklab, var(--good) ' + Math.round((g * 2 - 1) * 100) + '%, var(' + mid + '))';
}
export const valueColor = (g) => mixColor(g, '--honey');
export const heatColor = (score) => score == null ? 'var(--surface-2)' : 'color-mix(in oklab, ' + mixColor(score / 100, '--neutral') + ' 72%, var(--surface))';

export function streakFor(dogId) {
  const t = todayStr();
  let d = isLogged(getEntry(dogId, t)) ? t : addDays(t, -1);
  let n = 0;
  while (isLogged(getEntry(dogId, d))) { n++; d = addDays(d, -1); if (n > 5000) break; }
  return n;
}

// Which dog is showing is a per-person choice, kept on this device.
export function setActiveDog(id) { setPref('activeDogId', id || null); }

// Health-record reminders (Today shows them, Dog lists them).
export function dueEvents(dogId, withinDays) {
  const t = todayStr();
  return Object.values(S.events).filter((e) => e && e.dogId === dogId && isDate(e.nextDue) && diffDays(t, e.nextDue) <= withinDays)
    .sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
}
export function dueText(nextDue) {
  const n = diffDays(todayStr(), nextDue);
  if (n < 0) return { cls: 'over', txt: 'Overdue by ' + plural(-n, 'day') };
  if (n === 0) return { cls: 'soon', txt: 'Due today' };
  if (n === 1) return { cls: 'soon', txt: 'Due tomorrow' };
  if (n <= 14) return { cls: 'soon', txt: 'Due in ' + n + ' days' };
  return { cls: '', txt: 'Due ' + fmt(nextDue, { month: 'short', day: 'numeric', year: pd(nextDue).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) };
}

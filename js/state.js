// In-memory state (S), per-device prefs, shared settings, entry/event helpers and scoring.
import { Store } from './store.js';
import { DEFAULT_TAGS, EVENT_TYPES, LS_PREFS, LS_THEME, addDays, clamp, diffDays, fmt, isDate, lsGet, lsSet, pd, plural, sv, todayStr } from './util.js';

/* =========================================================
   State
   ========================================================= */
export const S = {
  mode: 'loading', reason: '',
  dogs: {}, behaviors: {}, entries: {}, events: {}, photos: {}, settings: {},
  moments: {}, activities: {}, training: {}, drills: {},   // through-the-day timeline + training log
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

/* =========================================================
   Through-the-day timeline + training log (shared contract, see FEATURE-TIMELINE.md)
   moments/<id>    { id, dogId, date, time:'HH:MM', behaviorId, value:1-10, activity:<type>|null, note }
   activities/<id> { id, dogId, date, time, type, durationMin:number|null, note }
   training/<id>   { id, dogId, date, time, durationMin, location, focus, engagement:1-10|null,
                     drills:{ <drillId>: { result:1|2|3, reps:number|null, note } }, notes }
                   (a drill set to null in the map was removed from the session; skip it)
   drills/<id>     { id, dogId, name, category, order, archived }
   ========================================================= */
// Activity types. icon = key into ACTIVITY_ICONS (inline SVG). 'training' is not an activities doc type,
// but activitiesFor() maps training sessions to type 'training', so it has an icon and label too.
export const ACTIVITY_TYPES = {
  walk: { label: 'Walk', icon: 'walk' },
  meal: { label: 'Meal', icon: 'meal' },
  play: { label: 'Play', icon: 'play' },
  nap: { label: 'Nap', icon: 'nap' },
  daycare: { label: 'Daycare', icon: 'daycare' },
  car: { label: 'Car ride', icon: 'car' },
  visitors: { label: 'Visitors', icon: 'visitors' },
  bath: { label: 'Bath', icon: 'bath' },
  other: { label: 'Other', icon: 'other' }
};
export const TRAINING_TYPE = { label: 'Training', icon: 'training' };
export const ACTIVITY_ICONS = {
  walk: sv('<path d="M7 21c0-3 1-5 1-8a2.5 2.5 0 0 1 5 0c0 3 1 5 1 8"/><path d="M14 21c0-2 .5-3 .5-5a2 2 0 0 1 4 0c0 2 .5 3 .5 5"/><circle cx="10.5" cy="5" r="2"/><circle cx="16.5" cy="9" r="1.6"/>'),
  meal: sv('<path d="M3 11h18a9 9 0 0 1-18 0Z"/><path d="M9 7.5c0-1.4.8-2.2 2-2.5M13.5 7.5c0-2 1-3 2.5-3.5"/>'),
  play: sv('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/>'),
  nap: sv('<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z"/><path d="M15 3h4l-4 4h4"/>'),
  daycare: sv('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>'),
  car: sv('<path d="M3 16v-4l2.2-5h13.6L21 12v4"/><path d="M3 12h18M3 16h2m4 0h6m4 0h2"/><circle cx="7" cy="16.5" r="2"/><circle cx="17" cy="16.5" r="2"/>'),
  visitors: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14a5 5 0 0 1 5 5"/>'),
  bath: sv('<path d="M3 12h18v2a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6Z"/><path d="M6 12V6.5a2.5 2.5 0 0 1 5 0"/><path d="M7 20l-1 2M17 20l1 2"/>'),
  other: sv('<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>'),
  training: EVENT_TYPES.training.icon
};
// Label + icon key for any activity type, including 'training' and unknown keys (shown as Other).
export function activityMeta(type) { return type === 'training' ? TRAINING_TYPE : ACTIVITY_TYPES[type] || ACTIVITY_TYPES.other; }
export const DRILL_CATEGORIES = ['Basics', 'Leash', 'Recall', 'Manners', 'Tricks', 'Custom'];
export const DRILL_SUGGESTIONS = [
  { name: 'Sit', category: 'Basics' }, { name: 'Down', category: 'Basics' }, { name: 'Stay', category: 'Basics' },
  { name: 'Recall', category: 'Recall' }, { name: 'Wait at door', category: 'Manners' }, { name: 'Heel', category: 'Leash' },
  { name: 'Loose-leash walking', category: 'Leash' }, { name: 'Leave it', category: 'Manners' }, { name: 'Drop it', category: 'Manners' },
  { name: 'Place', category: 'Manners' }, { name: 'Settle', category: 'Manners' }, { name: 'Look at me', category: 'Basics' },
  { name: 'Touch', category: 'Basics' }, { name: 'Off', category: 'Manners' }, { name: 'Crate', category: 'Manners' },
  { name: 'Spin', category: 'Tricks' }, { name: 'Paw', category: 'Tricks' }, { name: 'Roll over', category: 'Tricks' }
];
export const DRILL_RESULTS = { 1: 'Struggled', 2: 'Getting there', 3: 'Nailed it' };
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
// 'HH:MM' -> "5:30 PM" in the viewer's locale.
export function fmtTime(t) {
  if (!isTime(t)) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const inRange = (d, from, to) => isDate(d.date) && (!from || d.date >= from) && (!to || d.date <= to);
const byWhen = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
const ofDog = (col, dogId, from, to) => Object.values(S[col]).filter((d) => d && d.dogId === dogId && inRange(d, from, to)).sort(byWhen);
// All three take an optional inclusive 'YYYY-MM-DD' range and return docs sorted by date, then time.
export const momentsFor = (dogId, from, to) => ofDog('moments', dogId, from, to).filter((m) => typeof m.value === 'number');
export const trainingFor = (dogId, from, to) => ofDog('training', dogId, from, to);
// Activities PLUS training sessions mapped to { ...session, type: 'training', trainingId }.
export const activitiesFor = (dogId, from, to) => ofDog('activities', dogId, from, to)
  .concat(trainingFor(dogId, from, to).map((t) => Object.assign({}, t, { type: 'training', trainingId: t.id })))
  .sort(byWhen);
export const drillsFor = (dogId, opts) => Object.values(S.drills)
  .filter((d) => d && d.dogId === dogId && (opts && opts.includeArchived || !d.archived))
  .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)));
// A session's drills as [drillId, { result, reps, note }] pairs, skipping removed (null) ones.
export function sessionDrills(t) {
  const out = [];
  if (t && t.drills && typeof t.drills === 'object') for (const k in t.drills) { const v = t.drills[k]; if (v && typeof v === 'object') out.push([k, v]); }
  return out;
}
// One day's timeline: [{ kind: 'moment'|'activity'|'training', doc }], sorted by time.
export function timelineFor(dogId, date) {
  const items = momentsFor(dogId, date, date).map((d) => ({ kind: 'moment', doc: d }))
    .concat(ofDog('activities', dogId, date, date).map((d) => ({ kind: 'activity', doc: d })))
    .concat(trainingFor(dogId, date, date).map((d) => ({ kind: 'training', doc: d })));
  return items.sort((a, b) => byWhen(a.doc, b.doc));
}
// The behavior a quick "Energy right now" reading goes to: Energy if the dog tracks it, else the first one.
export function defaultMomentBehavior(dogId) {
  const bs = dogBehaviors(dogId);
  return bs.find((b) => /^energy$/i.test(String(b.name).trim())) || bs[0] || null;
}
// Per-day timeline summary for a dog: { 'YYYY-MM-DD': { moments, activities, sessions, drills, text } }.
// text = lowercased notes, focus/location and drill names, for History search.
export function timelineDays(dogId) {
  const out = {};
  const day = (d) => out[d] || (out[d] = { date: d, moments: 0, activities: 0, sessions: 0, drills: 0, parts: [] });
  for (const m of momentsFor(dogId)) { const x = day(m.date); x.moments++; if (m.note) x.parts.push(m.note); }
  for (const a of Object.values(S.activities)) if (a && a.dogId === dogId && isDate(a.date)) { const x = day(a.date); x.activities++; if (a.note) x.parts.push(a.note); }
  for (const t of trainingFor(dogId)) {
    const x = day(t.date); x.sessions++;
    const ds = sessionDrills(t); x.drills += ds.length;
    x.parts.push(t.focus || '', t.location || '', t.notes || '');
    for (const [id, v] of ds) { const d = S.drills[id]; if (d) x.parts.push(d.name); if (v.note) x.parts.push(v.note); }
  }
  for (const k in out) { out[k].text = out[k].parts.filter(Boolean).join('\n'); delete out[k].parts; }
  return out;
}

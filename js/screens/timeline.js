// "Through the day" timeline on Today: moments, activities and training sessions for the viewed day,
// the quick "Energy right now" row, and the add/edit sheets (moment, activity, training + drill picker).
// Not a screen of its own: Today renders timelineSectionHtml() and calls patchTimeline() on live changes.
// Data contract: FEATURE-TIMELINE.md. Writes are merge patches of only the fields the person changed, so two
// people editing the same session (e.g. each marking a different drill) keep each other's changes.
import { registerActions, registerForms } from '../registry.js';
import {
  ACTIVITY_ICONS, ACTIVITY_TYPES, DRILL_CATEGORIES, DRILL_RESULTS, DRILL_SUGGESTIONS, S, activityMeta, curDog,
  defaultMomentBehavior, dogBehaviors, drillsFor, fmtTime, goodness, isTime, nowTime, sessionDrills, timelineFor
} from '../state.js';
import { Store, byLine, canWrite, refreshSaveState } from '../store.js';
import { closeSheet, confirmDialog, flushDeferred, openSheet, toast } from '../ui.js';
import { $, $$, I, behaviorColor, clamp, clone, esc, genId, plural, todayStr } from '../util.js';

const COL = { moment: 'moments', activity: 'activities', training: 'training' };
const NOUN = { moment: 'moment', activity: 'activity', training: 'training session' };
const DUR_CHIPS = [10, 20, 30, 60];
const QUICK = [['Low', 3], ['Medium', 6], ['High', 9]];
const icon = (k) => ACTIVITY_ICONS[k] || ACTIVITY_ICONS.other;
// 45 -> '45 min', 90 -> '1 h 30 min', 420 -> '7 h'
const fmtDur = (n) => (n < 60 ? n + ' min' : Math.floor(n / 60) + ' h' + (n % 60 ? ' ' + (n % 60) + ' min' : ''));

/* ---------------- Section on Today ---------------- */
export function timelineSectionHtml(dog) {
  const items = timelineFor(dog.id, S.date);
  let h = '<section class="tl-sec" id="tlSec" aria-labelledby="tlH">' +
    '<div class="group-label"><span id="tlH">Through the day</span><span class="aside" id="tlCount">' + countText(items) + '</span></div>';
  h += '<div id="tlQuick">' + quickHtml(dog) + '</div>';
  if (!S.readOnly) {
    h += '<div class="tl-add">' +
      '<button class="tl-addbtn" data-action="tl-new" data-kind="moment">' + I.plus + '<span>Moment</span></button>' +
      '<button class="tl-addbtn" data-action="tl-new" data-kind="activity">' + I.plus + '<span>Activity</span></button>' +
      '<button class="tl-addbtn" data-action="tl-new" data-kind="training">' + I.plus + '<span>Training</span></button></div>';
  }
  h += '<div id="timeline" data-sig="' + esc(sigOf(dog, items)) + '">' + listHtml(dog, items) + '</div></section>';
  return h;
}
function countText(items) { return items.length ? plural(items.length, 'entry', 'entries') : ''; }
function sigOf(dog, items) {
  // Everything the list shows, so a live patch only touches the DOM when something visible changed.
  return JSON.stringify([S.readOnly, S.date === todayStr(), items.map((x) => [x.doc, x.doc.createdBy && S.names[x.doc.createdBy]]),
    dogBehaviors(dog.id).map((b) => [b.id, b.name, b.emoji, b.lowLabel, b.highLabel]), Object.values(S.drills).filter((d) => d && d.dogId === dog.id).map((d) => [d.id, d.name])]);
}
function listHtml(dog, items) {
  if (!items.length) {
    return '<div class="tl-empty"><p class="hand">Nothing logged ' + (S.date === todayStr() ? 'yet today' : 'for this day') + '.</p>' +
      '<p class="small muted">' + (S.readOnly ? 'Moments, walks, meals and training sessions show up here in time order.' : 'Log a moment when ' + esc(dog.name) + '’s energy or mood stands out, and the walks, meals and training around it. Over time Insights shows ' + esc(dog.name) + '’s rhythm through the day.') + '</p></div>';
  }
  return '<ol class="tl-list">' + items.map((x) => itemHtml(dog, x)).join('') + '</ol>';
}
function behIndex(dog, bid) { const i = dogBehaviors(dog.id).findIndex((b) => b.id === bid); return i; }
function itemHtml(dog, x) {
  const d = x.doc;
  let ic = '', title = '', sub = [], label = '', style = '';
  if (x.kind === 'moment') {
    const b = S.behaviors[d.behaviorId];
    const i = behIndex(dog, d.behaviorId);
    style = ' style="--c:' + (i >= 0 ? behaviorColor(i) : 'var(--ink-3)') + '"';
    ic = '<span class="tl-emoji bemoji" aria-hidden="true">' + esc(b && b.emoji || '•') + '</span>';
    title = '<span class="tl-name">' + esc(b ? b.name : 'Removed behavior') + '</span><span class="tl-pill num">' + esc(d.value) + '</span>';
    if (d.activity) sub.push('during ' + activityMeta(d.activity).label.toLowerCase());
    label = (b ? b.name : 'Behavior') + ' ' + d.value + ' of 10';
  } else if (x.kind === 'activity') {
    const m = activityMeta(d.type);
    ic = '<span class="tl-ic">' + icon(m.icon) + '</span>';
    title = '<span class="tl-name">' + esc(m.label) + '</span>' + (d.durationMin ? '<span class="tl-dur num">' + esc(fmtDur(d.durationMin)) + '</span>' : '');
    label = m.label + (d.durationMin ? ', ' + d.durationMin + ' minutes' : '');
  } else {
    const ds = sessionDrills(d);
    ic = '<span class="tl-ic tr">' + icon('training') + '</span>';
    title = '<span class="tl-name">' + esc(d.focus || 'Training') + '</span>';
    const bits = [];
    if (ds.length) bits.push(plural(ds.length, 'drill'));
    if (d.durationMin) bits.push(fmtDur(d.durationMin));
    if (bits.length) title += '<span class="tl-dur num">' + esc(bits.join(' · ')) + '</span>';
    const cnt = { 3: 0, 2: 0, 1: 0 };
    ds.forEach(([, v]) => { if (cnt[v.result] != null) cnt[v.result]++; });
    const sum = [3, 2, 1].filter((r) => cnt[r]).map((r) => '<span class="tr-sum r' + r + '"><i aria-hidden="true"></i>' + cnt[r] + ' ' + esc(DRILL_RESULTS[r].toLowerCase()) + '</span>').join('');
    if (sum) sub.push({ html: '<span class="tr-sums">' + sum + '</span>' });
    if (ds.length) sub.push(ds.slice(0, 4).map(([id]) => S.drills[id] ? S.drills[id].name : 'Removed drill').join(', ') + (ds.length > 4 ? ' +' + (ds.length - 4) : ''));
    label = (d.focus || 'Training') + (ds.length ? ', ' + plural(ds.length, 'drill') : '');
  }
  const note = x.kind === 'training' ? d.notes : d.note;
  const by = byLine(d);
  const inner = '<span class="tl-time num">' + esc(fmtTime(d.time)) + '</span>' + ic +
    '<span class="tl-body"><span class="tl-t">' + title + '</span>' +
    sub.map((s) => typeof s === 'string' ? '<span class="tl-s">' + esc(s) + '</span>' : s.html).join('') +
    (note ? '<span class="tl-note">' + esc(note) + '</span>' : '') +
    (by ? '<span class="tl-by">' + esc(by) + '</span>' : '') + '</span>';
  const aria = fmtTime(d.time) + ', ' + label + (S.readOnly ? '' : '. Edit');
  return '<li class="tl-item k-' + x.kind + '"' + style + '>' + (S.readOnly
    ? '<div class="tl-card" aria-label="' + esc(aria) + '">' + inner + '</div>'
    : '<button class="tl-card" data-action="tl-edit" data-kind="' + x.kind + '" data-id="' + esc(d.id) + '" aria-label="' + esc(aria) + '">' + inner + '</button>') + '</li>';
}
// One-tap "Energy right now: Low · Medium · High" (3/6/9) for the default behavior. Today only.
function quickHtml(dog) {
  if (S.readOnly || S.date !== todayStr()) return '';
  const b = defaultMomentBehavior(dog.id);
  if (!b) return '';
  const i = behIndex(dog, b.id);
  const last = timelineFor(dog.id, S.date).filter((x) => x.kind === 'moment' && x.doc.behaviorId === b.id).pop();
  return '<div class="tl-quick" style="--c:' + behaviorColor(i) + '"><div class="q-head"><span class="q-l"><span class="bemoji" aria-hidden="true">' + esc(b.emoji || '') + '</span> ' + esc(b.name) + ' right now</span>' +
    (last ? '<span class="q-last">last ' + esc(last.doc.value) + ' at ' + esc(fmtTime(last.doc.time)) + '</span>' : '') + '</div>' +
    '<div class="q-btns" role="group" aria-label="' + esc(b.name) + ' right now">' + QUICK.map(([l, v]) =>
      '<button class="q-btn" data-action="tl-quick" data-bid="' + esc(b.id) + '" data-v="' + v + '" aria-label="' + esc(b.name) + ' ' + l.toLowerCase() + ', ' + v + ' of 10"><span>' + l + '</span><small class="num">' + v + '</small></button>').join('') + '</div></div>';
}
// Live update from S (remote change or own save) without rebuilding Today. Leaves an open sheet alone.
export function patchTimeline(dog, force) {
  dog = dog || curDog();
  const box = $('#timeline'); if (!box || !dog) return;
  const items = timelineFor(dog.id, S.date);
  const sig = sigOf(dog, items);
  if (box.dataset.sig !== sig) { box.innerHTML = listHtml(dog, items); box.dataset.sig = sig; }
  const q = $('#tlQuick');
  if (q && (force || !q.contains(document.activeElement))) {
    const want = quickHtml(dog);
    if (q.innerHTML !== want) {
      const f = q.contains(document.activeElement) ? document.activeElement.dataset.v : null;
      q.innerHTML = want;
      if (f) { const nb = q.querySelector('[data-v="' + f + '"]'); if (nb) nb.focus({ preventScroll: true }); }
    }
  }
  const c = $('#tlCount'); if (c) c.textContent = countText(items);
}

/* ---------------- Sheets ---------------- */
// SH: the open sheet. orig = the doc as it was when opened (null for new), cur = the edited copy,
// newDrills = library drills created from the picker, written on save only if the session still uses them.
let SH = null;
const drafts = new Map(); // unsaved sheet state kept when a sheet is dismissed: key -> SH
const draftKey = (kind, id, dogId, date) => kind + '|' + (id || 'new') + '|' + dogId + '|' + date;

function blank(kind, dog) {
  const isToday = S.date === todayStr();
  const base = { id: genId(kind[0]), dogId: dog.id, date: S.date, time: isToday ? nowTime() : '12:00' };
  if (kind === 'moment') {
    const b = defaultMomentBehavior(dog.id);
    return Object.assign(base, { behaviorId: b ? b.id : null, value: 5, activity: null, note: '' });
  }
  if (kind === 'activity') return Object.assign(base, { type: 'walk', durationMin: null, note: '' });
  return Object.assign(base, { durationMin: null, location: '', focus: '', engagement: null, drills: {}, notes: '' });
}
function openItem(kind, id) {
  const dog = curDog(); if (!dog) return;
  if (kind === 'moment' && !dogBehaviors(dog.id).length) { toast('Add a behavior first, then log moments for it.'); return; }
  const doc = id ? S[COL[kind]][id] : null;
  if (id && !doc) { toast('That entry was removed.'); return; }
  const key = draftKey(kind, id, dog.id, S.date);
  const draft = drafts.get(key);
  drafts.delete(key);
  if (draft) SH = draft;
  else {
    const orig = doc ? clone(doc) : null;
    const cur = doc ? clone(doc) : blank(kind, dog);
    if (kind === 'training') { const m = {}; sessionDrills(cur).forEach(([k, v]) => { m[k] = v; }); cur.drills = m; }
    SH = { kind, id: cur.id, isNew: !doc, orig, cur, dogId: dog.id, date: S.date, key, newDrills: {}, saved: false };
  }
  const title = (SH.isNew ? 'New ' : 'Edit ') + NOUN[kind];
  openSheet(title.charAt(0).toUpperCase() + title.slice(1), sheetBody(dog, !!draft), null, onSheetClose);
}
function onSheetClose() {
  const sh = SH; SH = null;
  if (sh && !sh.saved && isDirty(sh)) { drafts.set(sh.key, sh); toast('Kept your unsaved ' + NOUN[sh.kind] + '. Open it again to finish.'); }
  // Live changes that arrived while the sheet was open: re-render once it has gone.
  setTimeout(() => { flushDeferred(); patchTimeline(); }, 320);
}
function isDirty(sh) {
  if (!sh.isNew) return Object.keys(diff(sh.orig, finalDoc(sh))).length > 0;
  const b = blank(sh.kind, { id: sh.dogId });
  const c = finalDoc(sh);
  return ['note', 'notes', 'location', 'focus', 'durationMin', 'engagement'].some((k) => c[k] != null && c[k] !== '' && c[k] !== b[k]) ||
    (sh.kind === 'training' && Object.keys(c.drills).length > 0) || (sh.kind === 'moment' && c.value !== 5) || (sh.kind === 'activity' && c.type !== 'walk');
}
function chipGroup(group, opts, val, toggle, extraCls) {
  return '<div class="chips tl-opts' + (extraCls ? ' ' + extraCls : '') + '" data-group="' + group + '"' + (toggle ? ' data-toggle="1"' : '') + '>' +
    opts.map(([v, l, ic]) => '<button type="button" class="chip" data-action="tl-opt" data-v="' + esc(v) + '" aria-pressed="' + (String(val) === String(v)) + '">' + (ic || '') + esc(l) + '</button>').join('') + '</div>';
}
function timeField(c) {
  return '<div class="tl-timerow"><label class="field tl-tf"><span>Time</span><input class="input num" type="time" id="tlTime" data-f="time" required value="' + esc(isTime(c.time) ? c.time : '12:00') + '"></label>' +
    (SH.date === todayStr() ? '<button type="button" class="chip" data-action="tl-now">Now</button>' : '') + '</div>';
}
function durField(c) {
  const v = c.durationMin;
  return '<div class="field"><span class="flabel" id="durL">How long</span><div class="tl-durrow">' +
    chipGroup('durationMin', DUR_CHIPS.map((n) => [n, n + ' min']), v, true, 'tl-durs') +
    '<label class="tl-durin"><input class="input num" type="number" id="tlDur" data-f="durationMin" inputmode="numeric" min="1" max="600" step="1" placeholder="Other" aria-labelledby="durL" value="' + esc(v != null && DUR_CHIPS.indexOf(v) < 0 ? v : '') + '"><span aria-hidden="true">min</span></label></div></div>';
}
function rangeBlock(id, b, v, optional) {
  const set = typeof v === 'number';
  const val = set ? v : 5;
  return '<div class="tl-val' + (set ? '' : ' unset') + '" id="' + id + 'Box" style="--pf:' + ((val - 1) / 9).toFixed(3) + '">' +
    '<div class="tl-val-head"><span class="tl-big num" id="' + id + 'Num">' + (set ? val : '–') + '</span><span class="hand tl-word" id="' + id + 'Word">' + esc(set ? wordFor(b, val) : 'not rated') + '</span>' +
    (optional ? '<button type="button" class="linkbtn tl-clear" data-action="tl-clear-range" data-r="' + id + '"' + (set ? '' : ' hidden') + '>Clear</button>' : '') + '</div>' +
    '<input type="range" class="tl-range" id="' + id + '" min="1" max="10" step="1" value="' + val + '" aria-label="' + esc(b ? b.name : 'Engagement') + ', 1 to 10"' + (set ? '' : ' aria-valuetext="Not rated"') + '>' +
    '<div class="blabels"><span id="' + id + 'Lo">' + esc(b ? b.lowLabel || 'Low' : 'Distracted') + '</span><span id="' + id + 'Hi">' + esc(b ? b.highLabel || 'High' : 'Locked in') + '</span></div></div>';
}
function wordFor(b, v) {
  if (!b) return v >= 8 ? 'locked in' : v >= 5 ? 'with me' : 'distracted';
  const g = goodness(b, v);
  return g >= 9 ? 'great' : g >= 7 ? 'good' : g >= 5 ? 'okay' : g >= 3 ? 'not great' : 'rough';
}
function sheetBody(dog, restored) {
  const c = SH.cur, k = SH.kind;
  let h = '<form class="form tl-form" data-form="tl-save" autocomplete="off" novalidate>';
  if (restored) h += '<p class="tl-restored small">Picked up where you left off. <button type="button" class="linkbtn" data-action="tl-discard">Start over</button></p>';
  if (k === 'moment') {
    const bs = dogBehaviors(dog.id);
    const b = S.behaviors[c.behaviorId];
    const i = Math.max(0, behIndex(dog, c.behaviorId));
    h += '<div class="field"><span class="flabel">What are you rating?</span>' + chipGroup('behaviorId', bs.map((x) => [x.id, x.name, x.emoji ? '<span class="bemoji" aria-hidden="true">' + esc(x.emoji) + '</span>' : '']), c.behaviorId, false, 'tl-behs') + '</div>';
    h += '<div class="tl-rate" id="tlRate" style="--c:' + behaviorColor(i) + '">' + rangeBlock('tlR', b, c.value, false) + '</div>';
    h += timeField(c);
    h += '<div class="field"><span class="flabel">What was happening? <span class="faint">(optional)</span></span>' +
      chipGroup('activity', Object.keys(ACTIVITY_TYPES).concat(['training']).map((t) => [t, activityMeta(t).label, icon(activityMeta(t).icon)]), c.activity, true, 'tl-acts') + '</div>';
    h += noteField('note', c.note, 'Anything that stood out?');
  } else if (k === 'activity') {
    h += '<div class="field"><span class="flabel">What did ' + esc(dog.name) + ' do?</span>' +
      chipGroup('type', Object.keys(ACTIVITY_TYPES).map((t) => [t, ACTIVITY_TYPES[t].label, icon(ACTIVITY_TYPES[t].icon)]), c.type, false, 'tl-acts') + '</div>';
    h += timeField(c) + durField(c) + noteField('note', c.note, 'Where, who with, how it went…');
  } else {
    h += timeField(c) + durField(c);
    h += '<div class="two"><label class="field"><span>Focus</span><input class="input" data-f="focus" maxlength="60" placeholder="e.g. Recall" value="' + esc(c.focus || '') + '"></label>' +
      '<label class="field"><span>Where</span><input class="input" data-f="location" maxlength="60" placeholder="e.g. Park" value="' + esc(c.location || '') + '"></label></div>';
    h += '<div class="field"><span class="flabel">Engagement <span class="faint">(optional)</span></span><div class="tl-rate eng" style="--c:var(--b2)">' + rangeBlock('tlE', null, c.engagement, true) + '</div></div>';
    h += '<div class="field"><span class="flabel">Drills</span><div id="trDrills" class="tr-drills">' + drillCardsHtml() + '</div>' +
      '<div id="trPick">' + pickerHtml(dog) + '</div></div>';
    h += noteField('notes', c.notes, 'What worked, what to try next time…');
  }
  h += '<div class="tl-actions"><button class="btn block" type="submit">' + I.check + (SH.isNew ? 'Save ' + NOUN[k] : 'Save changes') + '</button></div>';
  if (!SH.isNew) h += '<button type="button" class="btn block danger" data-action="tl-delete">' + I.trash + 'Delete ' + NOUN[k] + '</button>';
  const by = SH.orig ? byLine(SH.orig) : '';
  if (by) h += '<p class="byline tl-sheet-by">' + esc(by) + '</p>';
  return h + '</form>';
}
function noteField(f, v, ph) {
  return '<label class="field"><span>' + (f === 'notes' ? 'Session notes' : 'Note') + ' <span class="faint">(optional)</span></span><textarea class="input tl-note-in" data-f="' + f + '" maxlength="2000" rows="2" placeholder="' + esc(ph) + '">' + esc(v || '') + '</textarea></label>';
}
// --- training: drills in this session + picker ---
function drillDoc(id) { return (SH && SH.newDrills[id]) || S.drills[id] || null; }
function drillCardsHtml() {
  const ids = Object.keys(SH.cur.drills);
  if (!ids.length) return '<p class="small muted tr-none">Tap a drill below to add it to this session.</p>';
  return ids.map((id) => {
    const v = SH.cur.drills[id], d = drillDoc(id);
    const nm = d ? d.name : 'Removed drill';
    return '<div class="tr-drill' + (v.result ? '' : ' need') + '" data-did="' + esc(id) + '"><div class="tr-dh"><span class="tr-dn">' + esc(nm) + '</span>' + (d && d.category ? '<span class="tr-cat">' + esc(d.category) + '</span>' : '') +
      '<button type="button" class="icon-btn tr-rm" data-action="tr-rmdrill" data-did="' + esc(id) + '" aria-label="Remove ' + esc(nm) + ' from this session">' + I.x + '</button></div>' +
      '<div class="seg tr-res" role="group" aria-label="How did ' + esc(nm) + ' go?">' + [1, 2, 3].map((r) => '<button type="button" class="r' + r + '" data-action="tr-res" data-did="' + esc(id) + '" data-r="' + r + '" aria-pressed="' + (v.result === r) + '">' + DRILL_RESULTS[r] + '</button>').join('') + '</div>' +
      '<div class="tr-extra"><input class="input num tr-reps" type="number" inputmode="numeric" min="0" max="999" placeholder="Reps" aria-label="Reps for ' + esc(nm) + '" data-drill="' + esc(id) + '" data-df="reps" value="' + esc(v.reps != null ? v.reps : '') + '">' +
      '<input class="input tr-dnote" maxlength="200" placeholder="Note" aria-label="Note for ' + esc(nm) + '" data-drill="' + esc(id) + '" data-df="note" value="' + esc(v.note || '') + '"></div></div>';
  }).join('');
}
function pickerHtml(dog) {
  const inSession = SH.cur.drills;
  const lib = drillsFor(dog.id).concat(Object.values(SH.newDrills));
  const have = new Set(lib.map((d) => d.name.toLowerCase()));
  const avail = lib.filter((d) => !inSession[d.id]);
  const ideas = DRILL_SUGGESTIONS.filter((s) => !have.has(s.name.toLowerCase()));
  const ideaChips = ideas.map((s) => '<button type="button" class="chip add" data-action="tr-suggest" data-name="' + esc(s.name) + '" data-cat="' + esc(s.category) + '">' + I.plus + esc(s.name) + '</button>').join('');
  let h = '';
  if (avail.length) h += '<div class="chips tr-lib">' + avail.map((d) => '<button type="button" class="chip" data-action="tr-adddrill" data-did="' + esc(d.id) + '">' + I.plus + esc(d.name) + '</button>').join('') + '</div>';
  else if (lib.length && drillsFor(dog.id).length) h += '<p class="small muted tr-none">Every drill in ' + esc(dog.name) + '’s library is in this session.</p>';
  if (ideas.length) {
    if (!drillsFor(dog.id).length) h += '<p class="small muted tr-lead">' + esc(dog.name) + '’s drill library is empty. Pick what you practiced:</p><div class="chips tr-ideas">' + ideaChips + '</div>';
    else h += '<details class="tr-more"><summary>More drill ideas</summary><div class="chips tr-ideas">' + ideaChips + '</div></details>';
  }
  h += '<div class="tr-new" id="trNew"><button type="button" class="chip add" data-action="tr-newdrill" id="trNewBtn">' + I.plus + 'New drill</button>' +
    '<div class="tr-newform" id="trNewForm" hidden><input class="input" id="trNewName" maxlength="40" placeholder="Drill name" aria-label="New drill name" enterkeyhint="done">' +
    '<select class="input" id="trNewCat" aria-label="Category">' + DRILL_CATEGORIES.map((c) => '<option' + (c === 'Custom' ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
    '<button type="button" class="btn sm" data-action="tr-newdrill-add">Add</button></div></div>';
  return h;
}
function redrawDrills() {
  const dog = curDog();
  const a = $('#trDrills'); if (a) a.innerHTML = drillCardsHtml();
  const p = $('#trPick'); if (p && dog) { const open = !!p.querySelector('details[open]'); p.innerHTML = pickerHtml(dog); if (open) { const d = p.querySelector('details'); if (d) d.open = true; } }
}
function addDrillToSession(id) {
  if (!SH.cur.drills[id]) SH.cur.drills[id] = { result: null, reps: null, note: '' };
  redrawDrills();
  const card = $('.tr-drill[data-did="' + CSS.escape(id) + '"]');
  if (card) { card.scrollIntoView({ block: 'nearest' }); const b = card.querySelector('.tr-res button'); if (b) b.focus({ preventScroll: true }); }
}
function newDrill(name, category) {
  const dog = curDog();
  name = String(name || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const lib = drillsFor(dog.id, { includeArchived: true }).concat(Object.values(SH.newDrills));
  const same = lib.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (same) {
    if (same.archived && S.drills[same.id]) SH.newDrills[same.id] = Object.assign({}, same, { archived: false }); // restore on save
    return same.id;
  }
  const order = Math.max(-1, ...lib.map((d) => d.order || 0)) + 1;
  const id = genId('d');
  SH.newDrills[id] = { id, dogId: dog.id, name, category: DRILL_CATEGORIES.indexOf(category) >= 0 ? category : 'Custom', order, archived: false, createdBy: S.me || null, createdAt: Date.now() };
  return id;
}

/* ---------------- Save / delete ---------------- */
const META = ['createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'editors'];
function finalDoc(sh) {
  const c = clone(sh.cur);
  const num = (v, lo, hi) => (v === '' || v == null || !isFinite(Number(v)) ? null : clamp(Math.round(Number(v)), lo, hi));
  c.time = isTime(c.time) ? c.time : '12:00';
  if ('durationMin' in c) { c.durationMin = num(c.durationMin, 1, 600); if (c.durationMin === 0) c.durationMin = null; }
  if (sh.kind === 'moment') { c.value = num(c.value, 1, 10) || 5; c.activity = c.activity || null; c.note = (c.note || '').trim(); }
  if (sh.kind === 'activity') c.note = (c.note || '').trim();
  if (sh.kind === 'training') {
    c.engagement = num(c.engagement, 1, 10);
    c.location = (c.location || '').trim(); c.focus = (c.focus || '').trim(); c.notes = (c.notes || '').trim();
    for (const k in c.drills) { const v = c.drills[k]; v.reps = num(v.reps, 0, 999); v.note = (v.note || '').trim(); }
  }
  return c;
}
// Only the fields that changed. Drills diff per drill and per field; a removed drill becomes null.
export function diff(orig, next) {
  const p = {};
  for (const k in next) {
    if (META.indexOf(k) >= 0) continue;
    if (k === 'drills') {
      const od = {}; sessionDrills(orig).forEach(([id, v]) => { od[id] = v; });
      const dp = {};
      for (const id in next.drills) {
        const a = od[id], b = next.drills[id];
        if (!a) { dp[id] = b; continue; }
        const fp = {};
        for (const f in b) if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) fp[f] = b[f];
        if (Object.keys(fp).length) dp[id] = fp;
      }
      for (const id in od) if (!(id in next.drills)) dp[id] = null;
      if (Object.keys(dp).length) p.drills = dp;
    } else if (JSON.stringify(orig ? orig[k] : undefined) !== JSON.stringify(next[k])) p[k] = next[k];
  }
  return p;
}
function save() {
  if (!SH) return;
  if (!canWrite()) return;
  const sh = SH, col = COL[sh.kind];
  const doc = finalDoc(sh);
  if (sh.kind === 'moment' && !S.behaviors[doc.behaviorId]) { toast('Pick what you are rating.', true); return; }
  if (sh.kind === 'training') {
    const need = Object.keys(doc.drills).filter((id) => ![1, 2, 3].includes(doc.drills[id].result));
    if (need.length) {
      const d = drillDoc(need[0]);
      toast('How did ' + (d ? d.name : 'that drill') + ' go? Pick a result for each drill.', true);
      redrawDrills();
      const card = $('.tr-drill[data-did="' + CSS.escape(need[0]) + '"]'); if (card) { card.scrollIntoView({ block: 'center' }); const b = card.querySelector('.tr-res button'); if (b) b.focus({ preventScroll: true }); }
      return;
    }
    // Library drills created (or restored) from the picker that this session uses.
    for (const id in sh.newDrills) if (doc.drills[id]) Store.put('drills', id, sh.newDrills[id]);
  }
  let ok;
  const existsNow = !!S[col][sh.id];
  if (sh.isNew || !existsNow) {
    if (!sh.isNew) toast('Someone removed this while you were editing. Saved it again.');
    if (!doc.createdAt) { doc.createdBy = S.me || null; doc.createdAt = Date.now(); }
    ok = Store.patch(col, sh.id, doc, {}, 0);
  } else {
    const p = diff(sh.orig, doc);
    ok = Object.keys(p).length ? Store.patch(col, sh.id, p, sh.orig, 0) : true;
  }
  if (!ok) return;
  refreshSaveState();
  sh.saved = true;
  closeSheet();
  patchTimeline();
  if (sh.isNew) toast(sh.kind === 'moment' ? 'Logged ' + (S.behaviors[doc.behaviorId] || {}).name + ' ' + doc.value + ' at ' + fmtTime(doc.time) : sh.kind === 'activity' ? activityMeta(doc.type).label + ' logged' : 'Training session saved');
  else toast('Saved');
}

registerActions({
  'tl-new': (el) => openItem(el.dataset.kind, null),
  'tl-edit': (el) => openItem(el.dataset.kind, el.dataset.id),
  'tl-quick': (el) => {
    const dog = curDog(); const b = S.behaviors[el.dataset.bid]; if (!dog || !b) return;
    const doc = { id: genId('m'), dogId: dog.id, date: S.date, time: nowTime(), behaviorId: b.id, value: Number(el.dataset.v), activity: null, note: '', createdBy: S.me || null, createdAt: Date.now() };
    if (!Store.patch('moments', doc.id, doc, {}, 0)) return;
    refreshSaveState();
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
    patchTimeline(dog, true);
    toast(b.name + ' ' + doc.value + ' at ' + fmtTime(doc.time) + '. Tap it to add a note.');
  },
  'tl-opt': (el) => {
    if (!SH) return;
    const g = el.closest('[data-group]'); const group = g.dataset.group;
    const on = el.getAttribute('aria-pressed') !== 'true' || !g.dataset.toggle;
    $$('.chip', g).forEach((c) => c.setAttribute('aria-pressed', String(on && c === el)));
    let v = on ? el.dataset.v : null;
    if (group === 'durationMin') { v = v == null ? null : Number(v); const i = $('#tlDur'); if (i) i.value = ''; }
    SH.cur[group] = v;
    if (group === 'behaviorId') {
      const dog = curDog(); const b = S.behaviors[v];
      const r = $('#tlRate'); if (r) r.style.setProperty('--c', behaviorColor(Math.max(0, behIndex(dog, v))));
      const lo = $('#tlRLo'), hi = $('#tlRHi'); if (b && lo) { lo.textContent = b.lowLabel || 'Low'; hi.textContent = b.highLabel || 'High'; }
      const w = $('#tlRWord'); if (w && b) w.textContent = wordFor(b, SH.cur.value);
      const sl = $('#tlR'); if (sl && b) sl.setAttribute('aria-label', b.name + ', 1 to 10');
    }
  },
  'tl-now': () => { if (!SH) return; const t = nowTime(); SH.cur.time = t; const i = $('#tlTime'); if (i) i.value = t; },
  'tl-clear-range': (el) => {
    if (!SH) return; const id = el.dataset.r;
    SH.cur.engagement = null;
    const box = $('#' + id + 'Box'); box.classList.add('unset');
    $('#' + id + 'Num').textContent = '–'; $('#' + id + 'Word').textContent = 'not rated';
    $('#' + id).setAttribute('aria-valuetext', 'Not rated'); el.hidden = true;
  },
  'tl-discard': () => {
    if (!SH) return; const k = SH.kind, id = SH.isNew ? null : SH.id;
    SH.saved = true; closeSheet(); setTimeout(() => openItem(k, id), 300);
  },
  'tl-delete': async () => {
    if (!SH) return; const sh = SH;
    const c = await confirmDialog({ title: 'Delete this ' + NOUN[sh.kind] + '?', body: 'It will be removed from ' + (sh.date === todayStr() ? 'today' : 'this day') + '’s timeline' + (sh.kind === 'training' ? ' and from training insights.' : '.'), ok: 'Delete', danger: true });
    if (c !== 1) return;
    if (!Store.del(COL[sh.kind], sh.id)) return;
    sh.saved = true; drafts.delete(sh.key);
    if (SH === sh) closeSheet();
    patchTimeline(); refreshSaveState();
    toast(NOUN[sh.kind].charAt(0).toUpperCase() + NOUN[sh.kind].slice(1) + ' deleted');
  },
  'tr-adddrill': (el) => { if (SH) addDrillToSession(el.dataset.did); },
  'tr-suggest': (el) => { if (!SH) return; const id = newDrill(el.dataset.name, el.dataset.cat); if (id) addDrillToSession(id); },
  'tr-rmdrill': (el) => { if (!SH) return; delete SH.cur.drills[el.dataset.did]; redrawDrills(); },
  'tr-res': (el) => {
    if (!SH) return; const id = el.dataset.did, r = Number(el.dataset.r);
    if (!SH.cur.drills[id]) return;
    SH.cur.drills[id].result = r;
    const card = el.closest('.tr-drill'); card.classList.remove('need');
    $$('.tr-res button', card).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },
  'tr-newdrill': () => { const f = $('#trNewForm'); if (!f) return; f.hidden = false; $('#trNewBtn').hidden = true; $('#trNewName').focus(); },
  'tr-newdrill-add': () => {
    if (!SH) return; const n = $('#trNewName');
    const id = newDrill(n.value, $('#trNewCat').value);
    if (!id) { toast('Give the drill a name.', true); n.focus(); return; }
    addDrillToSession(id);
  },
}, ['tl-new', 'tl-edit', 'tl-quick', 'tl-delete']);

registerForms({ 'tl-save': () => save() });

// Field edits in an open sheet update SH.cur (so redrawing the drill list never loses typing).
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!SH || !t.closest || !t.closest('.tl-form')) return;
  if (t.dataset.f) {
    SH.cur[t.dataset.f] = t.value;
    if (t.id === 'tlDur') { const g = $('.tl-durs'); if (g) $$('.chip', g).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === String(Number(t.value)) && t.value !== ''))); }
  } else if (t.dataset.drill) {
    const d = SH.cur.drills[t.dataset.drill]; if (d) d[t.dataset.df] = t.value;
  } else if (t.classList.contains('tl-range')) {
    const v = Number(t.value), id = t.id;
    const box = $('#' + id + 'Box'); box.classList.remove('unset'); box.style.setProperty('--pf', ((v - 1) / 9).toFixed(3));
    t.removeAttribute('aria-valuetext');
    $('#' + id + 'Num').textContent = v;
    const b = id === 'tlR' ? S.behaviors[SH.cur.behaviorId] : null;
    $('#' + id + 'Word').textContent = wordFor(b, v);
    if (id === 'tlR') SH.cur.value = v; else { SH.cur.engagement = v; const c = $('[data-action="tl-clear-range"][data-r="tlE"]'); if (c) c.hidden = false; }
  }
});
// Enter in the new-drill name adds it instead of submitting the whole session.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target && e.target.id === 'trNewName') { e.preventDefault(); const b = $('[data-action="tr-newdrill-add"]'); if (b) b.click(); }
});
// Unset engagement slider: a tap at the default position (5) still rates it.
document.addEventListener('pointerup', (e) => {
  const t = e.target;
  if (t && t.id === 'tlE' && SH && SH.cur.engagement == null) setTimeout(() => { if (t.isConnected && SH && SH.cur.engagement == null) t.dispatchEvent(new Event('input', { bubbles: true })); }, 0);
});

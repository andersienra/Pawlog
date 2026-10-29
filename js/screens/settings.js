// Settings screen: people, dogs, behaviors (manager + behavior sheet), quick tags, theme, data, account.
// Public actions for other screens: 'behavior-new' (add-behavior sheet for the active dog) and
// 'behaviors-manage' (scrolls to Settings › Behaviors when on Settings, otherwise opens the manager sheet).
import { FB } from '../firebase.js';
import { avatarHtml } from '../photos.js';
import { actions, registerActions, registerForms, registerScreen } from '../registry.js';
import { DRILL_CATEGORIES, S, curDog, dogBehaviors, drillsFor, isLogged, saveQuickTags, sessionDrills, setPref, settings, sortedDogs } from '../state.js';
import { Store, canWrite, peopleSeen, personName, wantNames } from '../store.js';
import { applyTheme, bannerHtml, closeSheet, confirmDialog, openSheet, render, scheduleRender, toast } from '../ui.js';
import { $, I, esc, genId, plural } from '../util.js';

/* =========================================================
   SETTINGS
   ========================================================= */
const ic = (svg, cls) => svg.replace('<svg', '<svg class="' + (cls || 'ri') + '"');
export function renderPrefs(dog) {
  const s = settings();
  const dogs = sortedDogs();
  let h = '<header class="topbar"><button class="back-btn" data-action="tab" data-view="dog">' + I.chevL + esc(dog.name) + '</button><span class="spacer"></span><span id="savestate" class="savestate"></span></header>';
  h += bannerHtml();
  h += '<div class="stack set-stack"><h1 class="set-title">Settings</h1>';
  if (S.mode === 'db') {
    const ppl = peopleSeen();
    wantNames(ppl);
    const others = ppl.filter((x) => x !== S.me);
    h += '<section><div class="set-h"><h2>Shared with</h2><span class="aside">' + plural(ppl.length, 'person', 'people') + '</span></div><div class="scard pad people">' +
      '<div class="faces">' + ppl.slice(0, 8).map((id) => '<span class="face" title="' + esc(personName(id)) + '">' + esc((personName(id)[0] || '?').toUpperCase()) + (S.avatars[id] ? '<img src="' + esc(S.avatars[id]) + '" alt="" onerror="this.remove()">' : '') + '</span>').join('') + '</div>' +
      '<div class="names">' + ppl.map((id) => '<span>' + esc(id === S.me ? 'You' + (S.names[id] ? ' (' + S.names[id] + ')' : '') : personName(id)) + '</span>').join('') + '</div>' +
      '<p class="small muted" style="margin:10px 0 0">' + (others.length ? 'Everyone here sees the same logs, live.' : (S.backend === 'firebase' ? 'To log together, have the other person create an account here. The owner adds their email to the access list.' : 'To log together, share this page from the Share menu and give the other person Editor access.')) + ' People appear here once they’ve logged something.</p>' +
      (S.readOnly ? '<p class="small ro-note">You have view-only access.</p>' : '') + '</div></section>';
  }

  h += '<section><div class="set-h"><h2>Dogs</h2></div><div class="scard rows">' + dogs.map((d) =>
    '<div class="bm"><button class="main" data-action="select-dog" data-id="' + esc(d.id) + '">' + avatarHtml(d, 40) + '<span class="grow"><div class="t">' + esc(d.name) + '</div><div class="s">' + esc(d.breed || 'No breed set') + (d.id === dog.id ? ' · showing now' : '') + '</div></span></button>' +
    '<button class="icon-btn" data-action="edit-dog" data-id="' + esc(d.id) + '" aria-label="Edit ' + esc(d.name) + '">' + I.edit + '</button></div>').join('') +
    '<button class="row add-row" data-action="add-dog">' + ic(I.plus) + 'Add a dog</button></div></section>';

  h += '<section id="behaviors" class="beh-section"><div class="set-h"><h2>Behaviors for ' + esc(dog.name) + '</h2></div>' +
    '<p class="small muted set-lead">These are the sliders on the Today screen. Tap one to rename it or change its labels.</p>' +
    '<div class="behMgr">' + behaviorManagerHtml(dog) + '</div></section>';

  h += '<section id="drills" class="beh-section"><div class="set-h"><h2>Training drills</h2></div>' +
    '<p class="small muted set-lead">' + esc(dog.name) + '’s drill library for training sessions. Archived drills stay in past sessions.</p>' +
    '<div class="drillMgr">' + drillManagerHtml(dog) + '</div></section>';

  h += '<section><div class="set-h"><h2>Quick tags</h2></div><div class="scard pad"><div class="chips">' + (s.quickTags || []).map((tg, i) =>
    '<span class="chip tagchip-x">' + esc(tg) + '<button data-action="rm-quicktag" data-i="' + i + '" aria-label="Remove tag ' + esc(tg) + '">' + I.x + '</button></span>').join('') + '</div>' +
    '<form class="tag-input" data-form="quicktag"><input class="input" id="qtNew" name="tag" maxlength="40" placeholder="Add a quick tag" autocomplete="off" enterkeyhint="done" aria-label="New quick tag"><button class="btn sm set-add" type="submit">Add</button></form>' +
    ((s.quickTags || []).length === 0 ? '<p class="small muted" style="margin:10px 0 0">No quick tags. Add a few you use often.</p>' : '') + '</div></section>';

  h += '<section><div class="set-h"><h2>Appearance</h2></div><div class="seg" role="group" aria-label="Theme">' + [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => '<button data-action="theme" data-t="' + v + '" aria-pressed="' + ((s.theme || 'system') === v) + '">' + l + '</button>').join('') + '</div></section>';

  const where = S.backend === 'firebase' ? 'Synced live between everyone signed in to this Pawlog, and kept on this device so it works with a spotty connection.' : S.mode === 'db' ? 'Synced live for everyone with access to this page. Open it on any device to see the same logs.' : 'Saved in this browser only. Export a backup regularly, and import it on another device.';
  h += '<section><div class="set-h"><h2>Your data</h2></div><div class="scard rows">' +
    '<button class="row" data-action="export-json">' + ic(I.download) + '<span class="grow"><div class="t">Export backup</div><div class="s">JSON, includes everything</div></span></button>' +
    '<button class="row" data-action="export-csv">' + ic(I.download) + '<span class="grow"><div class="t">Export spreadsheet</div><div class="s">CSV, one row per logged day</div></span></button>' +
    '<label class="row tap" for="jsonPick" style="cursor:pointer">' + ic(I.upload) + '<span class="grow"><div class="t">Import backup</div><div class="s">From a Pawlog JSON file</div></span></label>' +
    '</div><p class="small muted set-lead" style="margin-top:8px">' + esc(where) + '</p></section>';
  if (S.backend === 'firebase' && FB.user) {
    h += '<section><div class="set-h"><h2>Account</h2></div><div class="scard rows"><div class="row"><span class="grow"><div class="s">Signed in as</div><div class="t copyable">' + esc(FB.user.email || '') + '</div></span></div>' +
      '<button class="row signout" data-action="sign-out">Sign out</button></div></section>';
  }
  const counts = Object.values(S.entries).filter(isLogged).length;
  h += '<p class="foot">Pawlog · ' + plural(dogs.length, 'dog') + ' · ' + plural(counts, 'day') + ' logged</p></div>';
  return h;
}

/* ---------- Behavior manager (Settings section + sheet opened from Today) ---------- */
// Per-behavior color: cycles --b1..--b6 by position in the active list (same rule Today uses).
const bColor = (i) => 'var(--b' + ((i % 6) + 1) + ', var(--accent))';
export function behaviorManagerHtml(dog) {
  const bsAll = dogBehaviors(dog.id, true);
  const active = bsAll.filter((b) => !b.archived), archived = bsAll.filter((b) => b.archived);
  let h = '<div class="scard rows bm-list">';
  active.forEach((b, i) => {
    h += '<div class="bm" data-bid="' + esc(b.id) + '"><button class="main" data-action="edit-behavior" data-id="' + esc(b.id) + '" aria-label="Edit ' + esc(b.name) + '"><span class="bdot" style="background:' + bColor(i) + '" aria-hidden="true"></span><span class="grow"><div class="t">' + esc(b.name) + '</div><div class="s">' + esc((b.lowLabel || 'Low') + ' → ' + (b.highLabel || 'High')) + ' · ' + (b.higherIsBetter ? 'higher is better' : 'lower is better') + '</div></span></button>' +
      '<button class="icon-btn" data-action="move-behavior" data-id="' + esc(b.id) + '" data-d="-1" aria-label="Move ' + esc(b.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + I.up + '</button>' +
      '<button class="icon-btn" data-action="move-behavior" data-id="' + esc(b.id) + '" data-d="1" aria-label="Move ' + esc(b.name) + ' down"' + (i === active.length - 1 ? ' disabled' : '') + '>' + I.down + '</button>' +
      '<button class="icon-btn" data-action="archive-behavior" data-id="' + esc(b.id) + '" aria-label="Archive ' + esc(b.name) + '">' + I.archive + '</button></div>';
  });
  if (!active.length) h += '<p class="small muted bm-empty">Nothing on the Today screen yet. Add a behavior or pick from suggestions.</p>';
  h += '<button class="row add-row" data-action="add-behavior">' + ic(I.plus) + 'Add behavior</button>' +
    '<button class="row add-row" data-action="track-picker">' + ic(I.check) + 'Pick from suggestions</button></div>';
  if (archived.length) {
    h += '<div class="set-h sub"><h3>Archived</h3><span class="aside">hidden from Today, history kept</span></div><div class="scard rows bm-list">' + archived.map((b) =>
      '<div class="bm archived"><button class="main" data-action="edit-behavior" data-id="' + esc(b.id) + '" aria-label="Edit ' + esc(b.name) + '"><span class="bdot" aria-hidden="true"></span><span class="grow"><div class="t">' + esc(b.name) + '</div></span></button>' +
      '<button class="btn sm set-add" data-action="unarchive-behavior" data-id="' + esc(b.id) + '">Restore</button>' +
      '<button class="icon-btn" data-action="delete-behavior" data-id="' + esc(b.id) + '" aria-label="Delete ' + esc(b.name) + '">' + I.trash + '</button></div>').join('') + '</div>';
  }
  return h;
}
// Re-draw whichever manager is showing (Settings section and/or the manager sheet) after a change.
function refreshBehaviorViews() {
  const dog = curDog();
  const m = $('#behMgr');
  if (m && dog) m.innerHTML = behaviorManagerHtml(dog);
  if (m) { scheduleRender({}); return; } // Settings page underneath re-renders once the sheet closes
  render();
}
function refocus(sel) { const b = $(sel); if (b && !b.disabled) b.focus(); }
let behaviorSheetFromMgr = false;
export function openBehaviorManager() {
  const dog = curDog(); if (!dog) return;
  openSheet('Behaviors for ' + dog.name, '<p class="small muted" style="margin:0 2px 12px">These are the sliders on the Today screen. Tap one to rename it or change its labels. Archiving keeps past ratings.</p><div id="behMgr" class="behMgr">' + behaviorManagerHtml(dog) + '</div>', null, () => { scheduleRender({}); });
}
export function openBehaviorSheet(bid) {
  const b = bid ? S.behaviors[bid] : null;
  const dog = curDog();
  const body = '<form class="form beh-form" data-form="behavior" data-id="' + esc(bid || '') + '" autocomplete="off">' +
    '<label class="field"><span>Name</span><input class="input" id="b_name" name="name" required maxlength="40" placeholder="e.g. Barking at the door" value="' + esc(b ? b.name : '') + '"></label>' +
    '<div class="two"><label class="field"><span>Low end (1)</span><input class="input" id="b_low" name="lowLabel" maxlength="30" placeholder="e.g. None" value="' + esc(b ? b.lowLabel : '') + '"></label>' +
    '<label class="field"><span>High end (10)</span><input class="input" id="b_high" name="highLabel" maxlength="30" placeholder="e.g. A lot" value="' + esc(b ? b.highLabel : '') + '"></label></div>' +
    '<label class="toggle scard"><span><div class="t">Higher is better</div><div class="small muted">Turn off for things you want less of, like barking or anxiety.</div></span><input type="checkbox" id="b_hib" name="higherIsBetter"' + (!b || b.higherIsBetter ? ' checked' : '') + '></label>' +
    '<label class="field"><span>Emoji <span class="faint">(optional)</span></span><input class="input emoji-in" id="b_emoji" name="emoji" maxlength="8" placeholder="🐾" value="' + esc(b && b.emoji !== '🐾' ? b.emoji : '') + '"></label>' +
    '<button class="btn block" type="submit">' + (b ? 'Save' : 'Add behavior') + '</button>' +
    (b ? '<button class="btn block soft" type="button" data-action="' + (b.archived ? 'unarchive-behavior' : 'archive-behavior') + '" data-id="' + esc(bid) + '">' + I.archive + (b.archived ? 'Restore to Today' : 'Archive (keep history)') + '</button>' +
      '<button class="btn block danger" type="button" data-action="delete-behavior" data-id="' + esc(bid) + '">' + I.trash + 'Delete behavior</button>' : '') + '</form>';
  behaviorSheetFromMgr = !!$('#behMgr');
  openSheet(b ? 'Edit ' + b.name : 'New behavior for ' + (dog ? dog.name : 'your dog'), body, () => { if (!b) setTimeout(() => { const i = $('#b_name'); if (i) i.focus(); }, 320); });
}
// After the edit sheet finishes: go back to the manager sheet if that's where it was opened from.
function afterBehaviorSheet() {
  const from = behaviorSheetFromMgr; behaviorSheetFromMgr = false;
  closeSheet();
  if (from) setTimeout(openBehaviorManager, 300); else render();
}
function behaviorsManage() {
  if (S.view === 'prefs' && $('#behaviors') && $('#sheetRoot').hidden) {
    const sec = $('#behaviors');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
    return;
  }
  const fromSheet = !$('#sheetRoot').hidden;
  if (fromSheet) { closeSheet(); setTimeout(openBehaviorManager, 300); } else openBehaviorManager();
}

registerScreen('prefs', { render: renderPrefs });
registerActions({
  'behavior-new': () => { if (!curDog()) return; const fromSheet = !$('#sheetRoot').hidden && !$('#behMgr'); if (fromSheet) { closeSheet(); setTimeout(() => openBehaviorSheet(null), 300); } else openBehaviorSheet(null); },
  'behaviors-manage': () => behaviorsManage(),
  'edit-behavior': (el) => openBehaviorSheet(el.dataset.id),
  'add-behavior': () => openBehaviorSheet(null),
  'move-behavior': (el) => {
    const dog = curDog(); const list = dogBehaviors(dog.id); const i = list.findIndex((b) => b.id === el.dataset.id); const j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    list.forEach((b, k) => { if (b.order !== k) Store.put('behaviors', b.id, Object.assign({}, b, { order: k })); });
    const sel = '[data-action="move-behavior"][data-id="' + el.dataset.id + '"][data-d="' + el.dataset.d + '"]';
    if ($('#behMgr')) { refreshBehaviorViews(); refocus('#behMgr ' + sel); }
    else { const y = window.scrollY; render(); window.scrollTo(0, y); refocus(sel); }
  },
  'archive-behavior': (el) => {
    const b = S.behaviors[el.dataset.id]; if (!b) return;
    Store.put('behaviors', b.id, Object.assign({}, b, { archived: true })); toast(b.name + ' archived');
    if ($('#behMgr')) refreshBehaviorViews(); else if (!$('#sheetRoot').hidden) afterBehaviorSheet(); else { const y = window.scrollY; render(); window.scrollTo(0, y); }
  },
  'unarchive-behavior': (el) => {
    const b = S.behaviors[el.dataset.id]; if (!b) return;
    const max = Math.max(-1, ...dogBehaviors(b.dogId).map((x) => x.order || 0));
    Store.put('behaviors', b.id, Object.assign({}, b, { archived: false, order: max + 1 })); toast(b.name + ' is back on Today');
    if ($('#behMgr')) refreshBehaviorViews(); else if (!$('#sheetRoot').hidden) afterBehaviorSheet(); else { const y = window.scrollY; render(); window.scrollTo(0, y); }
  },
  'delete-behavior': async (el) => {
    const b = S.behaviors[el.dataset.id]; if (!b) return;
    const c = await confirmDialog({ title: 'Delete ' + b.name + '?', body: 'Past ratings for it will no longer appear in charts. Archive it instead to keep its history.', ok: 'Delete', danger: true, alt: b.archived ? null : 'Archive instead' });
    if (c === 2) { actions['archive-behavior'](el); return; }
    if (c !== 1) return;
    Store.del('behaviors', b.id); toast(b.name + ' deleted');
    if ($('#behMgr')) refreshBehaviorViews(); else if (!$('#sheetRoot').hidden) afterBehaviorSheet(); else { const y = window.scrollY; render(); window.scrollTo(0, y); }
  },
  'rm-quicktag': (el) => { const q = settings().quickTags; q.splice(Number(el.dataset.i), 1); saveQuickTags(q); render(); },
  'theme': (el) => { setPref('theme', el.dataset.t); applyTheme(el.dataset.t); render(); },
}, ['behavior-new', 'behaviors-manage', 'edit-behavior', 'add-behavior', 'move-behavior', 'archive-behavior', 'unarchive-behavior', 'delete-behavior', 'rm-quicktag']);

registerForms({
  'behavior': (f) => {
    const fd = new FormData(f);
    const dog = curDog();
    const id = f.dataset.id || genId('b');
    const prev = S.behaviors[id];
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) { toast('Give the behavior a name.', true); const i = $('#b_name'); if (i) i.focus(); return; }
    const b = Object.assign({}, prev || { dogId: dog.id, archived: false, order: Math.max(-1, ...dogBehaviors(dog.id).map((x) => x.order || 0)) + 1 }, {
      id: id, name: name, emoji: String(fd.get('emoji') || '').trim() || '🐾',
      lowLabel: String(fd.get('lowLabel') || '').trim() || 'Low', highLabel: String(fd.get('highLabel') || '').trim() || 'High',
      higherIsBetter: fd.get('higherIsBetter') === 'on'
    });
    Store.put('behaviors', id, b);
    afterBehaviorSheet(); toast(prev ? 'Saved' : name + ' added');
  },
  'quicktag': (f) => {
    const v = String(new FormData(f).get('tag') || '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (S.readOnly) { canWrite(); return; }
    const q = settings().quickTags;
    if (q.indexOf(v) < 0) { q.push(v); saveQuickTags(q); }
    render(); const i = $('#qtNew'); if (i) i.focus();
  }
});

/* ---------- Training drill library (Settings section) ---------- */
function drillUses(id) { let n = 0; for (const t of Object.values(S.training)) if (t && sessionDrills(t).some(([k]) => k === id)) n++; return n; }
export function drillManagerHtml(dog) {
  const all = drillsFor(dog.id, { includeArchived: true });
  const active = all.filter((d) => !d.archived), archived = all.filter((d) => d.archived);
  if (S.readOnly) {
    return '<div class="scard rows bm-list dr-list">' + (active.length ? active.map((d) => '<div class="row"><span class="grow"><div class="t">' + esc(d.name) + '</div><div class="s">' + esc(d.category || 'Custom') + '</div></span></div>').join('')
      : '<p class="small muted bm-empty">No drills yet.</p>') + '</div>';
  }
  let h = '<div class="scard rows bm-list dr-list">';
  active.forEach((d, i) => {
    const n = drillUses(d.id);
    h += '<div class="bm" data-did="' + esc(d.id) + '"><button class="main" data-action="drill-edit" data-id="' + esc(d.id) + '" aria-label="Edit ' + esc(d.name) + '"><span class="grow"><div class="t">' + esc(d.name) + '</div><div class="s">' + esc(d.category || 'Custom') + (n ? ' · practiced ' + plural(n, 'time') : '') + '</div></span></button>' +
      '<button class="icon-btn" data-action="drill-move" data-id="' + esc(d.id) + '" data-d="-1" aria-label="Move ' + esc(d.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + I.up + '</button>' +
      '<button class="icon-btn" data-action="drill-move" data-id="' + esc(d.id) + '" data-d="1" aria-label="Move ' + esc(d.name) + ' down"' + (i === active.length - 1 ? ' disabled' : '') + '>' + I.down + '</button>' +
      '<button class="icon-btn" data-action="drill-archive" data-id="' + esc(d.id) + '" aria-label="Archive ' + esc(d.name) + '">' + I.archive + '</button></div>';
  });
  if (!active.length) h += '<p class="small muted bm-empty">No drills yet. Add one here, or pick from suggestions while logging a training session.</p>';
  h += '<button class="row add-row" data-action="drill-new">' + ic(I.plus) + 'Add drill</button></div>';
  if (archived.length) {
    h += '<div class="set-h sub"><h3>Archived</h3><span class="aside">hidden from the picker, history kept</span></div><div class="scard rows bm-list dr-list">' + archived.map((d) =>
      '<div class="bm archived"><button class="main" data-action="drill-edit" data-id="' + esc(d.id) + '" aria-label="Edit ' + esc(d.name) + '"><span class="grow"><div class="t">' + esc(d.name) + '</div><div class="s">' + esc(d.category || 'Custom') + '</div></span></button>' +
      '<button class="btn sm set-add" data-action="drill-unarchive" data-id="' + esc(d.id) + '">Restore</button>' +
      '<button class="icon-btn" data-action="drill-delete" data-id="' + esc(d.id) + '" aria-label="Delete ' + esc(d.name) + '">' + I.trash + '</button></div>').join('') + '</div>';
  }
  return h;
}
export function openDrillSheet(id) {
  const d = id ? S.drills[id] : null;
  const dog = curDog();
  const cat = d ? d.category : 'Basics';
  const body = '<form class="form" data-form="drill" data-id="' + esc(id || '') + '" autocomplete="off">' +
    '<label class="field"><span>Name</span><input class="input" id="dr_name" name="name" required maxlength="40" placeholder="e.g. Wait at the curb" value="' + esc(d ? d.name : '') + '"></label>' +
    '<div class="field"><span class="flabel" id="drCatL">Category</span><div class="chips" role="radiogroup" aria-labelledby="drCatL">' + DRILL_CATEGORIES.map((c) =>
      '<label class="chip dr-cat"><input type="radio" class="vh" name="category" value="' + esc(c) + '"' + (c === cat ? ' checked' : '') + '>' + esc(c) + '</label>').join('') + '</div></div>' +
    '<button class="btn block" type="submit">' + (d ? 'Save' : 'Add drill') + '</button>' +
    (d ? '<button class="btn block soft" type="button" data-action="' + (d.archived ? 'drill-unarchive' : 'drill-archive') + '" data-id="' + esc(id) + '">' + I.archive + (d.archived ? 'Restore to the picker' : 'Archive (keep history)') + '</button>' +
      '<button class="btn block danger" type="button" data-action="drill-delete" data-id="' + esc(id) + '">' + I.trash + 'Delete drill</button>' : '') + '</form>';
  openSheet(d ? 'Edit ' + d.name : 'New drill for ' + (dog ? dog.name : 'your dog'), body, () => { if (!d) setTimeout(() => { const i = $('#dr_name'); if (i) i.focus(); }, 320); });
}
function afterDrillChange() {
  if (!$('#sheetRoot').hidden) closeSheet();
  const y = window.scrollY; render(); window.scrollTo(0, y);
}
registerActions({
  'drill-new': () => openDrillSheet(null),
  'drill-edit': (el) => openDrillSheet(el.dataset.id),
  'drill-move': (el) => {
    const dog = curDog(); const list = drillsFor(dog.id); const i = list.findIndex((d) => d.id === el.dataset.id); const j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    list.forEach((d, k) => { if (d.order !== k) Store.put('drills', d.id, Object.assign({}, d, { order: k })); });
    const y = window.scrollY; render(); window.scrollTo(0, y);
    refocus('[data-action="drill-move"][data-id="' + el.dataset.id + '"][data-d="' + el.dataset.d + '"]');
  },
  'drill-archive': (el) => {
    const d = S.drills[el.dataset.id]; if (!d) return;
    Store.put('drills', d.id, Object.assign({}, d, { archived: true })); toast(d.name + ' archived');
    afterDrillChange();
  },
  'drill-unarchive': (el) => {
    const d = S.drills[el.dataset.id]; if (!d) return;
    const max = Math.max(-1, ...drillsFor(d.dogId).map((x) => x.order || 0));
    Store.put('drills', d.id, Object.assign({}, d, { archived: false, order: max + 1 })); toast(d.name + ' is back in the picker');
    afterDrillChange();
  },
  'drill-delete': async (el) => {
    const d = S.drills[el.dataset.id]; if (!d) return;
    const n = drillUses(d.id);
    const c = await confirmDialog({ title: 'Delete ' + d.name + '?', body: (n ? 'It’s in ' + plural(n, 'training session') + '. Those sessions will show it as a removed drill. ' : '') + 'Archive it instead to keep its name in past sessions.', ok: 'Delete', danger: true, alt: d.archived ? null : 'Archive instead' });
    if (c === 2) { actions['drill-archive'](el); return; }
    if (c !== 1) return;
    Store.del('drills', d.id); toast(d.name + ' deleted');
    afterDrillChange();
  },
}, ['drill-new', 'drill-edit', 'drill-move', 'drill-archive', 'drill-unarchive', 'drill-delete']);
registerForms({
  'drill': (f) => {
    if (S.readOnly) { canWrite(); return; }
    const fd = new FormData(f);
    const dog = curDog();
    const id = f.dataset.id || genId('d');
    const prev = S.drills[id];
    const name = String(fd.get('name') || '').trim().replace(/\s+/g, ' ');
    if (!name) { toast('Give the drill a name.', true); const i = $('#dr_name'); if (i) i.focus(); return; }
    const clash = drillsFor(dog.id, { includeArchived: true }).find((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase());
    if (clash) { toast(dog.name + ' already has a drill called ' + clash.name + (clash.archived ? ' (archived)' : '') + '.', true); return; }
    const cat = String(fd.get('category') || 'Custom');
    const d = Object.assign({}, prev || { dogId: dog.id, archived: false, order: Math.max(-1, ...drillsFor(dog.id).map((x) => x.order || 0)) + 1, createdBy: S.me || null, createdAt: Date.now() }, {
      id: id, name: name, category: DRILL_CATEGORIES.indexOf(cat) >= 0 ? cat : 'Custom', updatedBy: S.me || null, updatedAt: Date.now()
    });
    Store.put('drills', id, d);
    afterDrillChange(); toast(prev ? 'Saved' : name + ' added');
  }
});

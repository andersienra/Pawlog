// Settings screen: people, dogs, behaviors (+ behavior sheet), quick tags, theme, data, account.
import { FB } from '../firebase.js';
import { avatarHtml } from '../photos.js';
import { actions, registerActions, registerForms, registerScreen } from '../registry.js';
import { S, curDog, dogBehaviors, isLogged, saveQuickTags, setPref, settings, sortedDogs } from '../state.js';
import { Store, canWrite, peopleSeen, personName, wantNames } from '../store.js';
import { applyTheme, bannerHtml, closeSheet, confirmDialog, openSheet, render, toast } from '../ui.js';
import { $, I, esc, genId, plural } from '../util.js';

/* =========================================================
   SETTINGS
   ========================================================= */
export function renderPrefs(dog) {
  const s = settings();
  const dogs = sortedDogs();
  const bsAll = dogBehaviors(dog.id, true);
  const active = bsAll.filter((b) => !b.archived), archived = bsAll.filter((b) => b.archived);
  let h = '<header class="topbar"><button class="back-btn" data-action="tab" data-view="dog">' + I.chevL + esc(dog.name) + '</button><span class="spacer"></span><span id="savestate" class="savestate"></span></header>';
  h += bannerHtml();
  h += '<div class="stack"><h2 class="display" style="font-size:30px;margin:0 2px">Settings</h2>';
  if (S.mode === 'db') {
    const ppl = peopleSeen();
    wantNames(ppl);
    const others = ppl.filter((x) => x !== S.me);
    h += '<section><div class="group-label"><span>Shared with</span><span class="aside">' + plural(ppl.length, 'person', 'people') + '</span></div><div class="panel pad people">' +
      '<div class="faces">' + ppl.slice(0, 8).map((id) => '<span class="face" title="' + esc(personName(id)) + '">' + esc((personName(id)[0] || '?').toUpperCase()) + (S.avatars[id] ? '<img src="' + esc(S.avatars[id]) + '" alt="" onerror="this.remove()">' : '') + '</span>').join('') + '</div>' +
      '<div class="names">' + ppl.map((id) => '<span>' + esc(id === S.me ? 'You' + (S.names[id] ? ' (' + S.names[id] + ')' : '') : personName(id)) + '</span>').join('') + '</div>' +
      '<p class="small muted" style="margin:10px 0 0">' + (others.length ? 'Everyone here sees the same logs, live.' : (S.backend === 'firebase' ? 'To log together, have the other person create an account here. The owner adds their email to the access list.' : 'To log together, share this page from the Share menu and give the other person Editor access.')) + ' People appear here once they’ve logged something.</p>' +
      (S.readOnly ? '<p class="small" style="margin:8px 0 0;color:var(--warn)">You have view-only access.</p>' : '') + '</div></section>';
  }

  h += '<section><div class="group-label"><span>Dogs</span></div><div class="panel rows">' + dogs.map((d) =>
    '<div class="bm"><button class="main" data-action="select-dog" data-id="' + esc(d.id) + '">' + avatarHtml(d, 38) + '<span class="grow"><div class="t" style="font-weight:600">' + esc(d.name) + '</div><div class="s small muted">' + esc(d.breed || 'No breed set') + (d.id === dog.id ? ' · showing now' : '') + '</div></span></button>' +
    '<button class="icon-btn" data-action="edit-dog" data-id="' + esc(d.id) + '" aria-label="Edit ' + esc(d.name) + '">' + I.edit + '</button></div>').join('') +
    '<button class="row" data-action="add-dog" style="color:var(--accent);font-weight:600">' + I.plus.replace('<svg', '<svg style="width:22px;height:22px"') + 'Add a dog</button></div></section>';

  h += '<section><div class="group-label"><span>Behaviors for ' + esc(dog.name) + '</span><span class="aside">tap to edit</span></div><div class="panel rows">';
  active.forEach((b, i) => {
    h += '<div class="bm"><button class="main" data-action="edit-behavior" data-id="' + esc(b.id) + '"><span class="e" aria-hidden="true">' + esc(b.emoji) + '</span><span class="grow"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.name) + '</div><div class="small muted">' + (b.higherIsBetter ? 'Higher is better' : 'Lower is better') + '</div></span></button>' +
      '<button class="icon-btn" data-action="move-behavior" data-id="' + esc(b.id) + '" data-d="-1" aria-label="Move ' + esc(b.name) + ' up"' + (i === 0 ? ' disabled' : '') + '>' + I.up + '</button>' +
      '<button class="icon-btn" data-action="move-behavior" data-id="' + esc(b.id) + '" data-d="1" aria-label="Move ' + esc(b.name) + ' down"' + (i === active.length - 1 ? ' disabled' : '') + '>' + I.down + '</button></div>';
  });
  h += '<button class="row" data-action="add-behavior" style="color:var(--accent);font-weight:600">' + I.plus.replace('<svg', '<svg style="width:22px;height:22px"') + 'Add behavior</button></div>';
  if (archived.length) {
    h += '<div class="group-label" style="margin-top:14px"><span>Archived</span><span class="aside">hidden from Today, history kept</span></div><div class="panel rows">' + archived.map((b) =>
      '<div class="bm"><button class="main" data-action="edit-behavior" data-id="' + esc(b.id) + '"><span class="e" aria-hidden="true" style="opacity:.5">' + esc(b.emoji) + '</span><span class="grow muted">' + esc(b.name) + '</span></button><button class="btn sm soft" data-action="unarchive-behavior" data-id="' + esc(b.id) + '">Restore</button></div>').join('') + '</div>';
  }
  h += '</section>';

  h += '<section><div class="group-label"><span>Quick tags</span></div><div class="panel pad"><div class="chips">' + (s.quickTags || []).map((tg, i) =>
    '<span class="chip tagchip-x">' + esc(tg) + '<button data-action="rm-quicktag" data-i="' + i + '" aria-label="Remove tag ' + esc(tg) + '">' + I.x + '</button></span>').join('') + '</div>' +
    '<form class="tag-input" data-form="quicktag"><input class="input" id="qtNew" name="tag" maxlength="40" placeholder="Add a quick tag" autocomplete="off" enterkeyhint="done"><button class="btn sm" type="submit">Add</button></form>' +
    ((s.quickTags || []).length === 0 ? '<p class="small muted" style="margin:10px 0 0">No quick tags. Add a few you use often.</p>' : '') + '</div></section>';

  h += '<section><div class="group-label"><span>Appearance</span></div><div class="seg" role="group" aria-label="Theme">' + [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => '<button data-action="theme" data-t="' + v + '" aria-pressed="' + ((s.theme || 'system') === v) + '">' + l + '</button>').join('') + '</div></section>';

  const where = S.backend === 'firebase' ? 'Synced live between everyone signed in to this Pawlog, and kept on this device so it works with a spotty connection.' : S.mode === 'db' ? 'Synced live for everyone with access to this page. Open it on any device to see the same logs.' : 'Saved in this browser only. Export a backup regularly, and import it on another device.';
  h += '<section><div class="group-label"><span>Your data</span></div><div class="panel rows">' +
    '<button class="row" data-action="export-json">' + I.download.replace('<svg', '<svg style="width:22px;height:22px;color:var(--accent)"') + '<span class="grow"><div class="t">Export backup</div><div class="s">JSON, includes everything</div></span></button>' +
    '<button class="row" data-action="export-csv">' + I.download.replace('<svg', '<svg style="width:22px;height:22px;color:var(--accent)"') + '<span class="grow"><div class="t">Export spreadsheet</div><div class="s">CSV, one row per logged day</div></span></button>' +
    '<label class="row tap" for="jsonPick" style="cursor:pointer">' + I.upload.replace('<svg', '<svg style="width:22px;height:22px;color:var(--accent)"') + '<span class="grow"><div class="t">Import backup</div><div class="s">From a Pawlog JSON file</div></span></label>' +
    '</div><p class="small muted" style="margin:8px 4px 0;display:flex;gap:6px;align-items:flex-start">' + esc(where) + '</p></section>';
  if (S.backend === 'firebase' && FB.user) {
    h += '<section><div class="group-label"><span>Account</span></div><div class="panel rows"><div class="row"><span class="grow"><div class="s">Signed in as</div><div class="t copyable">' + esc(FB.user.email || '') + '</div></span></div>' +
      '<button class="row" data-action="sign-out" style="color:var(--bad);font-weight:600">Sign out</button></div></section>';
  }
  const counts = Object.values(S.entries).filter(isLogged).length;
  h += '<p class="foot">Pawlog · ' + plural(dogs.length, 'dog') + ' · ' + plural(counts, 'day') + ' logged</p></div>';
  return h;
}
export function openBehaviorSheet(bid) {
  const b = bid ? S.behaviors[bid] : null;
  const body = '<form class="form" data-form="behavior" data-id="' + esc(bid || '') + '" autocomplete="off">' +
    '<div class="two" style="grid-template-columns:80px 1fr"><label class="field"><span>Emoji</span><input class="input" id="b_emoji" name="emoji" maxlength="8" style="text-align:center;font-size:24px" value="' + esc(b ? b.emoji : '🐾') + '"></label>' +
    '<label class="field"><span>Name</span><input class="input" id="b_name" name="name" required maxlength="40" placeholder="e.g. Separation stress" value="' + esc(b ? b.name : '') + '"></label></div>' +
    '<div class="two"><label class="field"><span>Label for 1</span><input class="input" id="b_low" name="lowLabel" maxlength="30" placeholder="e.g. None" value="' + esc(b ? b.lowLabel : '') + '"></label>' +
    '<label class="field"><span>Label for 10</span><input class="input" id="b_high" name="highLabel" maxlength="30" placeholder="e.g. A lot" value="' + esc(b ? b.highLabel : '') + '"></label></div>' +
    '<label class="toggle panel" style="padding:8px 16px"><span><div style="font-weight:600">Higher is better</div><div class="small muted">Turn off for things you want less of, like barking or anxiety.</div></span><input type="checkbox" id="b_hib" name="higherIsBetter"' + (!b || b.higherIsBetter ? ' checked' : '') + '></label>' +
    '<button class="btn block" type="submit">' + (b ? 'Save' : 'Add behavior') + '</button>' +
    (b ? '<button class="btn block soft" type="button" data-action="' + (b.archived ? 'unarchive-behavior' : 'archive-behavior') + '" data-id="' + esc(bid) + '">' + I.archive + (b.archived ? 'Restore to Today' : 'Archive (keep history)') + '</button>' +
      '<button class="btn block danger" type="button" data-action="delete-behavior" data-id="' + esc(bid) + '">' + I.trash + 'Delete behavior</button>' : '') + '</form>';
  openSheet(b ? 'Edit behavior' : 'New behavior', body);
}

registerScreen('prefs', { render: renderPrefs });
registerActions({
  'edit-behavior': (el) => openBehaviorSheet(el.dataset.id),
  'add-behavior': () => openBehaviorSheet(null),
  'move-behavior': (el) => {
    const dog = curDog(); const list = dogBehaviors(dog.id); const i = list.findIndex((b) => b.id === el.dataset.id); const j = i + Number(el.dataset.d);
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    list.forEach((b, k) => { if (b.order !== k) Store.put('behaviors', b.id, Object.assign({}, b, { order: k })); });
    render();
  },
  'archive-behavior': (el) => { const b = S.behaviors[el.dataset.id]; if (!b) return; Store.put('behaviors', b.id, Object.assign({}, b, { archived: true })); closeSheet(); toast(b.name + ' archived'); render(); },
  'unarchive-behavior': (el) => { const b = S.behaviors[el.dataset.id]; if (!b) return; const max = Math.max(-1, ...dogBehaviors(b.dogId).map((x) => x.order || 0)); Store.put('behaviors', b.id, Object.assign({}, b, { archived: false, order: max + 1 })); closeSheet(); render(); },
  'delete-behavior': async (el) => {
    const b = S.behaviors[el.dataset.id]; if (!b) return;
    const c = await confirmDialog({ title: 'Delete ' + b.name + '?', body: 'Past ratings for it will no longer appear in charts. Archive it instead to keep its history.', ok: 'Delete', danger: true, alt: 'Archive instead' });
    if (c === 2) { actions['archive-behavior'](el); return; }
    if (c !== 1) return;
    Store.del('behaviors', b.id); closeSheet(); render();
  },
  'rm-quicktag': (el) => { const q = settings().quickTags; q.splice(Number(el.dataset.i), 1); saveQuickTags(q); render(); },
  'theme': (el) => { setPref('theme', el.dataset.t); applyTheme(el.dataset.t); render(); },
}, ['edit-behavior', 'add-behavior', 'move-behavior', 'archive-behavior', 'unarchive-behavior', 'delete-behavior', 'rm-quicktag']);

registerForms({
  'behavior': (f) => {
    const fd = new FormData(f);
    const dog = curDog();
    const id = f.dataset.id || genId('b');
    const prev = S.behaviors[id];
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Give the behavior a name.', true); return; }
    const b = Object.assign({}, prev || { dogId: dog.id, archived: false, order: Math.max(-1, ...dogBehaviors(dog.id).map((x) => x.order || 0)) + 1 }, {
      id: id, name: name, emoji: String(fd.get('emoji') || '').trim() || '🐾',
      lowLabel: String(fd.get('lowLabel') || '').trim() || 'Low', highLabel: String(fd.get('highLabel') || '').trim() || 'High',
      higherIsBetter: fd.get('higherIsBetter') === 'on'
    });
    Store.put('behaviors', id, b);
    closeSheet(); render(); toast(prev ? 'Saved' : name + ' added');
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

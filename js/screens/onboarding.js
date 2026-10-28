// Onboarding (no dog yet), the dog form, add/edit dog sheets, dog switcher, dog CRUD actions.
import { avatarHtml, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, dogBehaviors, photosOf, setActiveDog, sortedDogs } from '../state.js';
import { Store, canWrite, flushPending } from '../store.js';
import { bannerHtml, closeSheet, confirmDialog, go, openSheet, render, toast } from '../ui.js';
import { $, DEFAULT_BEHAVIORS, DOG_COLORS, I, PAW, SIZES, esc, genId, isDate, plural, todayStr } from '../util.js';

/* =========================================================
   Onboarding & dog form
   ========================================================= */
export let formAvatar = null;
export function dogFormFields(d, full) {
  d = d || {};
  const size = d.size || 'medium';
  const sizeSeg = Object.keys(SIZES).map((k) => '<label><input type="radio" name="size" value="' + k + '"' + (size === k ? ' checked' : '') + '><span>' + SIZES[k].label + '<small>' + SIZES[k].hint + '</small></span></label>').join('');
  const sex = d.sex || '';
  const color = d.color || DOG_COLORS[sortedDogs().length % DOG_COLORS.length];
  const sw = DOG_COLORS.map((c) => '<label><input type="radio" name="color" value="' + c + '"' + (color === c ? ' checked' : '') + ' aria-label="Color ' + c + '"><span style="background:' + c + '"></span></label>').join('');
  const unit = d.weightUnit || (/^en-US/i.test(navigator.language || '') ? 'lb' : 'kg');
  let h = '';
  h += '<label class="field"><span>Name</span><input class="input" id="f_name" name="name" required maxlength="40" autocomplete="off" placeholder="e.g. Biscuit" value="' + esc(d.name || '') + '"></label>';
  h += '<label class="field"><span>Breed</span><input class="input" id="f_breed" name="breed" maxlength="60" autocomplete="off" placeholder="e.g. Border Collie mix" value="' + esc(d.breed || '') + '"></label>';
  h += '<div class="two"><label class="field"><span>Birthday</span><input class="input" type="date" id="f_bday" name="birthday" max="' + todayStr() + '" value="' + esc(d.birthday || '') + '"></label>';
  h += '<label class="field"><span>Gotcha day</span><input class="input" type="date" id="f_gotcha" name="gotchaDate" max="' + todayStr() + '" value="' + esc(d.gotchaDate || '') + '"></label></div>';
  h += '<div class="field"><span class="flabel">Size</span><div class="seg" role="radiogroup" aria-label="Size">' + sizeSeg + '</div></div>';
  h += '<div class="two"><div class="field"><span class="flabel">Sex</span><div class="seg" role="radiogroup" aria-label="Sex"><label><input type="radio" name="sex" value="female"' + (sex === 'female' ? ' checked' : '') + '><span>Female</span></label><label><input type="radio" name="sex" value="male"' + (sex === 'male' ? ' checked' : '') + '><span>Male</span></label></div></div>';
  h += '<div class="field"><span class="flabel">Weight in</span><div class="seg" role="radiogroup" aria-label="Weight unit"><label><input type="radio" name="weightUnit" value="kg"' + (unit === 'kg' ? ' checked' : '') + '><span>kg</span></label><label><input type="radio" name="weightUnit" value="lb"' + (unit === 'lb' ? ' checked' : '') + '><span>lb</span></label></div></div></div>';
  h += '<div class="field"><span class="flabel">Color</span><div class="swatches">' + sw + '</div></div>';
  if (full) {
    h += '<label class="field"><span>Microchip number</span><input class="input" id="f_chip" name="microchip" inputmode="numeric" maxlength="30" autocomplete="off" value="' + esc(d.microchip || '') + '"></label>';
    h += '<div class="two"><label class="field"><span>Vet name</span><input class="input" id="f_vet" name="vetName" maxlength="60" value="' + esc((d.vet && d.vet.name) || '') + '"></label>';
    h += '<label class="field"><span>Vet phone</span><input class="input" id="f_vetph" name="vetPhone" type="tel" maxlength="30" value="' + esc((d.vet && d.vet.phone) || '') + '"></label></div>';
    h += '<label class="field"><span>Notes</span><textarea class="input" id="f_dnotes" name="notes" maxlength="2000" placeholder="Allergies, quirks, favorite toys…">' + esc(d.notes || '') + '</textarea></label>';
  }
  return h;
}
export function photoPickerField(cur) {
  return '<div class="field"><span class="flabel">Photo <span class="faint">(optional)</span></span><div style="display:flex;align-items:center;gap:14px">' +
    '<span id="formAv">' + avatarHtml({ name: '+', avatarAssetId: cur, color: 'var(--surface-3)' }, 64) + '</span>' +
    '<label for="filePick" class="btn soft sm" data-pick="form">' + I.camera + 'Choose photo</label></div></div>';
}
export function renderOnboarding() {
  if (S.readOnly) return '<div class="welcome onb-welcome"><div class="mark">' + PAW + '</div><h1>Nothing logged yet.</h1><p>When the owner adds a dog and starts logging, it shows up here.</p></div>' + bannerHtml();
  // Step 2: the dog form was filled in; the dog is created when this step finishes.
  if (TP && TP.pending) return '<div class="onb">' + trackStepHtml() + '</div>';
  if (!PENDING) formAvatar = null;
  return '<div class="onb"><div class="welcome onb-welcome"><div class="mark">' + PAW + '</div><h1>Every day with your dog, <span class="hl">logged.</span></h1><p>Rate how the day went in a few swipes, jot a note, add a photo. Pawlog turns it into trends you can actually see.</p></div>' +
    bannerHtml() +
    '<form class="form onb-card" data-form="dog-new" autocomplete="off"><div class="onb-step">Step 1 of 2</div><h2 class="display">Add your dog</h2>' + photoPickerField(formAvatar) + dogFormFields(PENDING, false) +
    '<button class="btn block onb-go" type="submit">Next: what to track' + I.chevR + '</button></form>' +
    '<p class="foot">You can add more dogs later in Settings.</p></div>';
}
export function readDogForm(form, base) {
  const f = new FormData(form);
  const d = Object.assign({}, base || {});
  d.name = String(f.get('name') || '').trim();
  d.breed = String(f.get('breed') || '').trim();
  d.birthday = isDate(f.get('birthday')) ? f.get('birthday') : null;
  d.gotchaDate = isDate(f.get('gotchaDate')) ? f.get('gotchaDate') : null;
  d.size = String(f.get('size') || 'medium');
  d.sex = String(f.get('sex') || '') || null;
  d.weightUnit = String(f.get('weightUnit') || 'kg');
  d.color = String(f.get('color') || DOG_COLORS[0]);
  if (f.has('microchip')) d.microchip = String(f.get('microchip') || '').trim();
  if (f.has('vetName')) d.vet = { name: String(f.get('vetName') || '').trim(), phone: String(f.get('vetPhone') || '').trim() };
  if (f.has('notes')) d.notes = String(f.get('notes') || '');
  return d;
}
// behaviors: [[name, emoji, lowLabel, highLabel, higherIsBetter], ...]; omitted -> DEFAULT_BEHAVIORS.
export function createDog(d, behaviors) {
  const id = genId('d');
  const dog = Object.assign({ id: id, createdAt: Date.now(), createdBy: S.me || null, avatarAssetId: formAvatar || null, microchip: '', vet: { name: '', phone: '' }, notes: '' }, d);
  if (!canWrite()) return null;
  Store.put('dogs', id, dog);
  (behaviors || DEFAULT_BEHAVIORS).forEach((b, i) => {
    const bid = genId('b');
    Store.put('behaviors', bid, { id: bid, dogId: id, name: b[0], emoji: b[1], lowLabel: b[2], highLabel: b[3], higherIsBetter: b[4], order: i, archived: false });
  });
  setActiveDog(id);
  formAvatar = null;
  return id;
}
export function openDogSheet(dogId) {
  const dog = dogId ? S.dogs[dogId] : null;
  formAvatar = dog ? dog.avatarAssetId || null : null;
  const body = '<form class="form" data-form="' + (dog ? 'dog-edit' : 'dog-add') + '" data-id="' + esc(dogId || '') + '" autocomplete="off">' +
    photoPickerField(formAvatar) + dogFormFields(dog, !!dog) +
    '<button class="btn block" type="submit">' + (dog ? 'Save changes' : 'Add dog') + '</button>' +
    (dog ? '<button class="btn block danger" type="button" data-action="delete-dog" data-id="' + esc(dogId) + '">' + I.trash + 'Delete ' + esc(dog.name) + '</button>' : '') +
    '</form>';
  openSheet(dog ? 'Edit ' + dog.name : 'Add a dog', body);
}
export function openDogSwitcher() {
  const dog = curDog();
  const body = '<div class="panel rows sel-list">' + sortedDogs().map((d) => '<button data-action="select-dog" data-id="' + esc(d.id) + '">' + avatarHtml(d, 42) + '<span class="grow" style="flex:1;min-width:0"><div style="font-weight:650">' + esc(d.name) + '</div><div class="small muted">' + esc(d.breed || '') + '</div></span>' + (d.id === dog.id ? '<span class="check">' + I.check + '</span>' : '') + '</button>').join('') + '</div>' +
    '<button class="btn block soft" style="margin-top:14px" data-action="add-dog">' + I.plus + 'Add another dog</button>';
  openSheet('Your dogs', body);
}

registerScreen('onboarding', { render: renderOnboarding });
registerActions({
  'switch-dog': () => openDogSwitcher(),
  'select-dog': (el) => { flushPending(); setActiveDog(el.dataset.id); closeSheet(); render(); },
  'add-dog': () => { closeSheet(); setTimeout(() => openDogSheet(null), 120); },
  'edit-dog': (el) => openDogSheet(el.dataset.id),
  'delete-dog': async (el) => {
    const d = S.dogs[el.dataset.id]; if (!d) return;
    const c = await confirmDialog({ title: 'Delete ' + d.name + '?', body: 'This removes ' + d.name + '’s profile, every daily log, health record and photo. It can’t be undone.', ok: 'Delete everything', danger: true });
    if (c !== 1) return;
    flushPending();
    const photoIds = [];
    for (const [id, e] of Object.entries(S.entries)) if (e && e.dogId === d.id) { photosOf(e).forEach((p) => photoIds.push(p)); Store.del('entries', id); }
    for (const [id, b] of Object.entries(S.behaviors)) if (b && b.dogId === d.id) Store.del('behaviors', id);
    for (const [id, ev] of Object.entries(S.events)) if (ev && ev.dogId === d.id) Store.del('events', id);
    if (d.avatarAssetId) photoIds.push(d.avatarAssetId);
    Store.del('dogs', d.id);
    photoIds.forEach(releasePhoto);
    const next = sortedDogs()[0];
    setActiveDog(next ? next.id : null);
    closeSheet();
    toast(d.name + ' deleted');
    go(next ? 'prefs' : 'today');
  },
}, ['add-dog', 'edit-dog', 'delete-dog']);
// "Next" on the dog form. First dog: keep the details and show step 2 in place (the dog is created
// when it finishes). Another dog (sheet): create it now, then open the same step as a sheet.
export function submitNewDog(f) {
  const d = readDogForm(f);
  if (!d.name) { toast('Give your dog a name first.', true); $('#f_name', f).focus(); return; }
  if (!canWrite()) return;
  flushPending();
  if (f.dataset.form === 'dog-new' && !curDog()) {
    PENDING = d;
    TP = newPicker(null, d.name, true);
    TP.pending = true;
    render(); window.scrollTo(0, 0);
    setTimeout(() => { const h = $('#tpTitle'); if (h) h.focus(); }, 60);
    return;
  }
  const id = createDog(d, []);
  if (!id) return;
  closeSheet();
  S.date = todayStr();
  go('today', { top: true });
  setTimeout(() => openTrackPicker(id, true), 320);
}
export function submitEditDog(f) {
  const base = S.dogs[f.dataset.id]; if (!base) return;
  const d = readDogForm(f, base);
  if (!d.name) { toast('Name can’t be empty.', true); return; }
  const prevAv = base.avatarAssetId;
  d.avatarAssetId = formAvatar;
  Store.put('dogs', d.id, d);
  if (prevAv && prevAv !== formAvatar) releasePhoto(prevAv);
  closeSheet(); render(); toast('Saved');
}

/* =========================================================
   "What do you want to track for <name>?" — onboarding step 2, also used when adding
   another dog and from Settings › Behaviors › "Pick from suggestions" (action 'track-picker').
   ========================================================= */
// Idea chips, off by default. [name, emoji, lowLabel, highLabel, higherIsBetter]
export const BEHAVIOR_IDEAS = [
  ['Barking', '🗣️', 'Quiet', 'Nonstop', false],
  ['Recall', '📣', 'Ignored me', 'Came right away', true],
  ['Separation anxiety', '🚪', 'Settled alone', 'Very distressed', false],
  ['Crate comfort', '🏠', 'Fought it', 'Happy in crate', true],
  ['Jumping on people', '🦘', 'Four on the floor', 'Jumped a lot', false],
  ['Begging', '🍽️', 'Left us alone', 'Begged constantly', false],
  ['Chewing', '🦴', 'None', 'Destroyed things', false],
  ['Car rides', '🚗', 'Stressed', 'Chill passenger', true],
  ['Sociability', '🐕', 'Kept to self', 'Super friendly', true],
  ['Play with other dogs', '🎾', 'Avoided them', 'Played great', true],
  ['Grooming tolerance', '🛁', 'Hated it', 'Totally relaxed', true],
  ['Potty accidents', '💧', 'None', 'Many', false]
];
let PENDING = null; // first-dog form values held while step 2 is showing
let TP = null;      // { dogId, name, onboarding, pending, basics, ideas, sel, custom, save }
function newPicker(dogId, name, onboarding) {
  const have = dogId ? dogBehaviors(dogId, true).map((b) => b.name.toLowerCase()) : [];
  const notHave = (b) => have.indexOf(b[0].toLowerCase()) < 0;
  const basics = DEFAULT_BEHAVIORS.filter(notHave);
  const bn = basics.map((b) => b[0].toLowerCase());
  const ideas = BEHAVIOR_IDEAS.filter(notHave).filter((b) => bn.indexOf(b[0].toLowerCase()) < 0);
  const sel = {};
  basics.forEach((b) => { sel[b[0]] = !!onboarding; });
  ideas.forEach((b) => { sel[b[0]] = false; });
  return { dogId: dogId, name: name, onboarding: !!onboarding, pending: false, basics: basics, ideas: ideas, sel: sel, custom: [] };
}
export function openTrackPicker(dogId, onboarding) {
  const dog = S.dogs[dogId]; if (!dog) return;
  TP = newPicker(dogId, dog.name, onboarding);
  // Closing the sheet any way (button, X, scrim, Escape) finishes the step. During onboarding of an added
  // dog the current picks are kept (the dog needs something to log); from Settings only the button saves.
  openSheet(onboarding ? 'What to track' : 'Add behaviors for ' + dog.name, '<div class="tp-sheet">' + trackStepHtml() + '</div>', null,
    () => { if (TP) finishTrackPicker(TP.save === true || TP.onboarding); });
}
function tpCount() { return Object.keys(TP.sel).filter((k) => TP.sel[k]).length + TP.custom.length; }
function tpChip(b) { return '<button type="button" class="tpc" data-action="tp-toggle" data-name="' + esc(b[0]) + '" aria-pressed="' + !!TP.sel[b[0]] + '">' + (TP.sel[b[0]] ? I.check : I.plus) + esc(b[0]) + '</button>'; }
function tpBasics() { return TP.basics.map(tpChip).join(''); }
function tpIdeas() {
  return TP.ideas.map(tpChip).join('') + TP.custom.map((n, i) => '<button type="button" class="tpc" data-action="tp-rm-custom" data-i="' + i + '" aria-pressed="true" aria-label="Remove ' + esc(n) + '">' + I.check + esc(n) + I.x.replace('<svg', '<svg class="rm"') + '</button>').join('');
}
function tpBtnLabel() {
  const n = tpCount();
  if (TP.onboarding) return n ? 'Start logging · ' + plural(n, 'behavior') : 'Skip for now';
  return n ? 'Add ' + plural(n, 'behavior') : 'Done';
}
function trackStepHtml() {
  let h = '<div class="tp-head">' + (TP.onboarding ? '<div class="onb-step">' + (TP.pending ? 'Step 2 of 2' : 'One more thing') + '</div>' : '') +
    (TP.onboarding ? '<h1 id="tpTitle" tabindex="-1">What do you want to track for ' + esc(TP.name) + '?</h1>' : '') +
    '<p>Each one becomes a 1–10 slider on the Today screen. Pick a few. You can add, rename or remove these anytime.</p></div>';
  if (TP.basics.length) h += '<div class="tp-group" id="tpBasicsL">The basics</div><div class="tp-chips" id="tpBasics" role="group" aria-labelledby="tpBasicsL">' + tpBasics() + '</div>';
  h += '<div class="tp-group" id="tpIdeasL">Ideas</div><div class="tp-chips" id="tpIdeas" role="group" aria-labelledby="tpIdeasL">' + tpIdeas() + '</div>';
  h += '<form class="tp-custom" data-form="tp-custom" autocomplete="off"><label for="tpNew">Something else?</label><div class="tp-row"><input class="input" id="tpNew" name="name" maxlength="40" placeholder="e.g. Stealing socks" enterkeyhint="done"><button class="btn sm tp-add" type="submit">Add</button></div></form>';
  h += '<div class="tp-foot"><button class="btn block tp-go" data-action="tp-done" id="tpDone">' + esc(tpBtnLabel()) + '</button>' +
    (TP.pending ? '<button class="btn block ghost tp-back" data-action="tp-back">' + I.chevL + 'Back to ' + esc(TP.name) + '’s details</button>' : '') + '</div>';
  return h;
}
// Re-draw just the chips and the button so focus and scroll stay put.
function drawTrackPicker() {
  const b = $('#tpBasics'), i = $('#tpIdeas'), d = $('#tpDone');
  if (b) b.innerHTML = tpBasics();
  if (i) i.innerHTML = tpIdeas();
  if (d) d.textContent = tpBtnLabel();
}
function finishTrackPicker(save) {
  const tp = TP; TP = null;
  if (!tp) return;
  const picked = save === false ? [] : tp.basics.concat(tp.ideas).filter((b) => tp.sel[b[0]])
    .concat(tp.custom.map((n) => [n, '🐾', 'Low', 'High', true]));
  if (tp.pending) {
    // First dog: create it now, with exactly the chosen behaviors.
    const d = PENDING; PENDING = null;
    const id = createDog(d, picked);
    if (!id) { render(); return; }
    S.date = todayStr();
    toast('Welcome, ' + d.name + '!');
    go('today', { top: true });
    return;
  }
  const dog = S.dogs[tp.dogId];
  if (dog && picked.length) {
    let order = Math.max(-1, ...dogBehaviors(tp.dogId, true).map((x) => x.order || 0)) + 1;
    picked.forEach((b) => { const bid = genId('b'); Store.put('behaviors', bid, { id: bid, dogId: tp.dogId, name: b[0], emoji: b[1], lowLabel: b[2], highLabel: b[3], higherIsBetter: b[4], order: order++, archived: false }); });
  }
  if (tp.onboarding && dog) toast('Welcome, ' + dog.name + '!');
  else if (picked.length) toast(plural(picked.length, 'behavior') + ' added');
  render();
}

registerForms({
  'dog-new': submitNewDog, 'dog-add': submitNewDog, 'dog-edit': submitEditDog,
  'tp-custom': (f) => {
    const v = String(new FormData(f).get('name') || '').trim().replace(/\s+/g, ' ');
    if (!v || !TP) return;
    const all = TP.basics.concat(TP.ideas);
    const exists = all.find((b) => b[0].toLowerCase() === v.toLowerCase());
    if (exists) TP.sel[exists[0]] = true;
    else if (TP.dogId && dogBehaviors(TP.dogId, true).some((b) => b.name.toLowerCase() === v.toLowerCase())) { toast(v + ' is already on the list'); }
    else if (TP.custom.map((x) => x.toLowerCase()).indexOf(v.toLowerCase()) < 0) TP.custom.push(v);
    f.reset(); drawTrackPicker(); const i = $('#tpNew'); if (i) i.focus();
  }
});
registerActions({
  'track-picker': () => { const dog = curDog(); if (!dog) return; const fromSheet = !$('#sheetRoot').hidden; closeSheet(); setTimeout(() => openTrackPicker(dog.id, false), fromSheet ? 300 : 0); },
  'tp-toggle': (el) => { if (!TP) return; const n = el.dataset.name; TP.sel[n] = !TP.sel[n]; drawTrackPicker(); const b = $('.tp-chips [data-name="' + CSS.escape(n) + '"]'); if (b) b.focus(); },
  'tp-rm-custom': (el) => { if (!TP) return; TP.custom.splice(Number(el.dataset.i), 1); drawTrackPicker(); const i = $('#tpNew'); if (i) i.focus(); },
  'tp-done': () => { if (!TP) return; if (TP.pending) { finishTrackPicker(true); return; } TP.save = true; closeSheet(); },
  'tp-back': () => { TP = null; render(); window.scrollTo(0, 0); },
}, ['track-picker', 'tp-done']);

// Photo picked from the dog form ("Choose photo"): becomes the form's avatar.
registerPicks({
  'form': async (files) => {
    const f = files[0];
    toast('Adding photo…');
    const id = await savePhoto(f, null, null);
    if (!id) return;
    const old = formAvatar; formAvatar = id;
    const fa = $('#formAv'); if (fa) fa.innerHTML = avatarHtml({ name: '+', avatarAssetId: id }, 64);
    if (old && old !== id && !Object.values(S.dogs).some((d) => d.avatarAssetId === old)) releasePhoto(old);
    toast('Photo updated');
  }
});

// Onboarding (no dog yet), the dog form, add/edit dog sheets, dog switcher, dog CRUD actions.
import { avatarHtml, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, photosOf, setActiveDog, sortedDogs } from '../state.js';
import { Store, canWrite, flushPending } from '../store.js';
import { bannerHtml, closeSheet, confirmDialog, go, openSheet, render, toast } from '../ui.js';
import { $, DEFAULT_BEHAVIORS, DOG_COLORS, I, PAW, SIZES, esc, genId, isDate, todayStr } from '../util.js';

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
  formAvatar = null;
  if (S.readOnly) return '<div class="welcome"><div class="mark">' + PAW + '</div><h1>Nothing logged yet.</h1><p>When the owner adds a dog and starts logging, it shows up here.</p></div>' + bannerHtml();
  return '<div class="welcome"><div class="mark">' + PAW + '</div><h1>Every day with your dog, logged.</h1><p>Rate how the day went in a few swipes, jot a note, add a photo. Pawlog turns it into trends you can actually see.</p></div>' +
    bannerHtml() +
    '<form class="form panel pad" data-form="dog-new" style="margin-top:14px" autocomplete="off"><h2 class="display" style="font-size:22px">Add your dog</h2>' + photoPickerField(null) + dogFormFields(null, false) +
    '<button class="btn block" type="submit">Start logging</button></form>' +
    '<p class="foot">You can add more dogs later in Settings.</p>';
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
export function createDog(d) {
  const id = genId('d');
  const dog = Object.assign({ id: id, createdAt: Date.now(), createdBy: S.me || null, avatarAssetId: formAvatar || null, microchip: '', vet: { name: '', phone: '' }, notes: '' }, d);
  if (!canWrite()) return null;
  Store.put('dogs', id, dog);
  DEFAULT_BEHAVIORS.forEach((b, i) => {
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
export function submitNewDog(f) {
  const d = readDogForm(f);
  if (!d.name) { toast('Give your dog a name first.', true); $('#f_name', f).focus(); return; }
  flushPending();
  createDog(d);
  closeSheet();
  S.date = todayStr();
  toast('Welcome, ' + d.name + '!');
  go('today', { top: true });
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

registerForms({ 'dog-new': submitNewDog, 'dog-add': submitNewDog, 'dog-edit': submitEditDog });

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

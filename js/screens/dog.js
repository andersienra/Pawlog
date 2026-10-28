// Dog profile screen: age, gotcha day, health & care records (+ record sheet), vet & ID, gallery.
import { imgTag, photoSrc, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, dogEntries, dueText, photosOf } from '../state.js';
import { Store } from '../store.js';
import { closeSheet, confirmDialog, openLightbox, openSheet, render, toast } from '../ui.js';
import { $, EVENT_TYPES, I, SIZES, avatarBg, inkOn, addDays, diffDays, ds, esc, fmt, genId, isDate, pd, plural, todayStr } from '../util.js';

/* =========================================================
   DOG PROFILE
   ========================================================= */
export function ageParts(birth, today) {
  // Whole months via a month-anniversary clamped to the month's length (Jan 31 -> Feb 28, Feb 29 -> Feb 28), then days.
  const b = pd(birth), t = pd(today);
  const anchor = (mo) => { const yy = b.getFullYear() + Math.floor((b.getMonth() + mo) / 12), mm = (b.getMonth() + mo) % 12; return new Date(yy, mm, Math.min(b.getDate(), new Date(yy, mm + 1, 0).getDate())); };
  let months = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
  if (months > 0 && anchor(months) > t) months--;
  if (months < 0) months = 0;
  const d = Math.max(0, Math.round((t - anchor(months)) / 864e5));
  return { y: Math.floor(months / 12), m: months % 12, d: d };
}
export function nextAnniversary(dateStr, today) {
  const b = pd(dateStr), t = pd(today);
  const mk = (yr) => { const leap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0; const day = b.getMonth() === 1 && b.getDate() === 29 && !leap ? 28 : b.getDate(); return new Date(yr, b.getMonth(), day); };
  let n = mk(t.getFullYear());
  if (n < t || n.getFullYear() <= b.getFullYear()) n = mk(Math.max(t.getFullYear(), b.getFullYear()) + 1);
  const prevA = mk(n.getFullYear() - 1);
  return { date: ds(n), days: diffDays(today, ds(n)), years: n.getFullYear() - b.getFullYear(), sinceLast: diffDays(ds(prevA), today), span: diffDays(ds(prevA), ds(n)) };
}
export function humanYears(ageYears, size) {
  const r = (SIZES[size] || SIZES.medium).rate;
  if (ageYears <= 1) return ageYears * r[0];
  if (ageYears <= 2) return r[0] + (ageYears - 1) * (r[1] - r[0]);
  return r[1] + (ageYears - 2) * r[2];
}
export function lifeStage(ageYears, size) {
  if (ageYears < 1) return 'Puppy';
  if (ageYears < 2) return 'Adolescent';
  if (ageYears >= (SIZES[size] || SIZES.medium).senior) return 'Senior';
  return 'Adult';
}
export function partsText(p) {
  const out = [];
  if (p.y) out.push('<b>' + p.y + '</b> <span>' + (p.y === 1 ? 'yr' : 'yrs') + '</span>');
  if (p.m || p.y) out.push('<b>' + p.m + '</b> <span>' + (p.m === 1 ? 'mo' : 'mos') + '</span>');
  out.push('<b>' + p.d + '</b> <span>' + (p.d === 1 ? 'day' : 'days') + '</span>');
  return out.join(' ');
}
export function plainParts(p) {
  const out = [];
  if (p.y) out.push(plural(p.y, 'year'));
  if (p.m) out.push(plural(p.m, 'month'));
  if (!p.y && (p.d || !p.m)) out.push(plural(p.d, 'day'));
  return out.join(', ');
}
export function galleryFor(dog) {
  const items = [];
  for (const e of dogEntries(dog.id)) for (const id of photosOf(e).slice().reverse()) items.push({ id: id, date: e.date });
  if (dog.avatarAssetId && !items.some((x) => x.id === dog.avatarAssetId)) items.push({ id: dog.avatarAssetId, date: ds(new Date(dog.createdAt || Date.now())), avatar: true });
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function renderDog(dog) {
  const t = todayStr();
  const sexTxt = dog.sex ? (dog.sex === 'female' ? 'Female' : 'Male') : '';
  const meta = [dog.breed, sexTxt].filter(Boolean).join(' · ');
  const sizeTxt = SIZES[dog.size] ? SIZES[dog.size].label + ' size' : '';
  const ay = dog.birthday ? diffDays(dog.birthday, t) / 365.25 : null;
  let h = '<header class="topbar dog-top"><span class="spacer"></span><button class="icon-btn" data-action="edit-dog" data-id="' + esc(dog.id) + '" aria-label="Edit profile">' + I.edit + '</button><button class="icon-btn" data-action="tab" data-view="prefs" aria-label="Settings">' + I.gear + '</button></header><div class="stack dog-stack">';

  // Hero: taped polaroid + name, breed/sex, life stage
  h += '<div class="dog-hero"><label class="pola av-wrap" for="filePick" data-pick="avatar" aria-label="Change ' + esc(dog.name) + '’s photo"><span class="tape" aria-hidden="true"></span>' + polaroidPhoto(dog) + '<span class="cam">' + I.camera + '</span></label>' +
    '<div class="who"><h1>' + esc(dog.name) + '</h1>' +
    (meta ? '<div class="sub">' + esc(meta) + '</div>' : '<button class="linkbtn" data-action="edit-dog" data-id="' + esc(dog.id) + '">Add breed and details</button>') +
    (sizeTxt && meta ? '<div class="sub faint">' + esc(sizeTxt) + '</div>' : '') +
    (ay != null ? '<span class="stage">' + lifeStage(ay, dog.size) + '</span>' : '') + '</div></div>';

  // Age (hero card)
  if (dog.birthday) {
    const p = ageParts(dog.birthday, t);
    const ageDays = diffDays(dog.birthday, t);
    const hy = humanYears(ay, dog.size);
    const nb = nextAnniversary(dog.birthday, t);
    const pct = Math.max(0, Math.min(100, nb.sinceLast / nb.span * 100));
    h += '<section class="age-card" aria-label="Age"><div class="ac-top"><span class="ac-k">Age</span><span class="hand">about ' + Math.round(hy) + ' in human years</span></div>' +
      '<div class="agebig num">' + esc(ageText(p)) + '</div>' +
      '<div class="small ac-born">Born ' + esc(fmt(dog.birthday, { month: 'long', day: 'numeric', year: 'numeric' })) + ' · ' + ageDays.toLocaleString() + ' days old</div>' +
      '<div class="ac-next"><span>' + (nb.days === 0 ? 'Happy birthday, ' + esc(dog.name) + '!' : 'Next birthday') + '</span><span class="num">' + (nb.days === 0 ? 'Turns ' + nb.years + ' today' : esc(fmt(nb.date, { month: 'short', day: 'numeric' })) + ' · ' + plural(nb.days, 'day')) + '</span></div>' +
      '<div class="yearbar" role="img" aria-label="' + Math.round(pct) + '% of the way to birthday number ' + nb.years + '"><i style="width:' + pct.toFixed(1) + '%"></i></div></section>';
    h += '<section class="dog-size"><div class="flabel">Size used for human years</div><div class="seg" role="group" aria-label="Size">' + Object.keys(SIZES).map((k) => '<button data-action="set-size" data-size="' + k + '" aria-pressed="' + ((dog.size || 'medium') === k) + '">' + SIZES[k].label + '</button>').join('') + '</div></section>';
  } else {
    h += '<section class="age-card age-empty"><div class="ac-top"><span class="ac-k">Age</span><span class="hand">a best guess is fine</span></div><h3>When is ' + esc(dog.name) + '’s birthday?</h3><p>Add it to see exact age, human years and a birthday countdown.</p><button class="btn sm ac-btn" data-action="edit-dog" data-id="' + esc(dog.id) + '">Add birthday</button></section>';
  }

  // Gotcha
  if (dog.gotchaDate) {
    const p = ageParts(dog.gotchaDate, t);
    const na = nextAnniversary(dog.gotchaDate, t);
    h += '<section class="dcard kv"><div><div class="k">Home for</div><div class="v sm">' + esc(plainParts(p) || 'Day one') + '</div><div class="s">since ' + esc(fmt(dog.gotchaDate, { month: 'short', day: 'numeric', year: 'numeric' })) + '</div></div>' +
      '<div><div class="k">Gotcha day</div><div class="v num">' + (na.days === 0 ? 'Today!' : na.days + '<span class="u"> days</span>') + '</div><div class="s">' + plural(na.years, 'year') + ' together on ' + esc(fmt(na.date, { month: 'short', day: 'numeric' })) + '</div></div></section>';
  }

  // Health & care: "Coming up" reminders, then the full timeline
  const evs = Object.values(S.events).filter((e) => e && e.dogId === dog.id);
  const upcoming = evs.filter((e) => isDate(e.nextDue)).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
  const past = evs.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  h += '<section><div class="dog-h"><h2>Coming up</h2><button class="linkbtn" data-action="add-event">' + I.plus + 'Add record</button></div>';
  if (!evs.length) {
    h += '<div class="dcard dashed"><div class="empty"><h3>No health records yet</h3><p>Log vet visits, vaccines, meds and grooming. Set a next-due date and Pawlog reminds you on the Today screen.</p><button class="btn sm" data-action="add-event">' + I.plus + 'Add a record</button></div></div>';
  } else if (!upcoming.length) {
    h += '<p class="small muted dog-note">Nothing due. Give a record a next-due date to get a reminder.</p>';
  } else {
    h += '<div class="due-list">' + upcoming.map((e) => dueCard(e)).join('') + '</div>';
  }
  if (evs.length) h += '<div class="dog-h sub-h"><h3>Health timeline</h3><span class="aside">' + plural(evs.length, 'record') + '</span></div><div class="dcard rows">' + past.map((e) => eventRow(e, '')).join('') + '</div>';
  h += '</section>';

  // Vet & ID
  const vet = dog.vet || {};
  h += '<section><div class="dog-h"><h2>Vet &amp; ID</h2></div><div class="dcard rows">';
  h += infoRow('Vet', vet.name, 'Add your vet');
  h += infoRow('Vet phone', vet.phone, 'Add a phone number', true);
  h += infoRow('Microchip', dog.microchip, 'Add microchip number', true);
  h += '</div></section>';

  if (dog.notes && dog.notes.trim()) h += '<section><div class="dog-h"><h2>Notes</h2></div><div class="dcard notecard">' + esc(dog.notes) + '</div></section>';

  // Gallery: scattered polaroids
  const gal = galleryFor(dog);
  h += '<section><div class="dog-h"><h2>Photos</h2>' + (gal.length ? '<span class="aside">' + gal.length + '</span>' : '') + '</div>';
  if (gal.length) h += '<div class="gallery">' + gal.map((g, i) => '<button class="gpola" style="--rot:' + ROTS[i % ROTS.length] + 'deg" data-action="lightbox-gallery" data-i="' + i + '" aria-label="Photo from ' + esc(fmt(g.date, { month: 'short', day: 'numeric' })) + '">' + imgTag(g.id, '') + '</button>').join('') + '</div>';
  else h += '<div class="dcard dashed"><div class="empty"><h3>No photos yet</h3><p>Photos you add to daily logs collect here.</p></div></div>';
  h += '</section></div>';
  return h;
}
const ROTS = [-3, 2, -1, 3, -2, 1.5, -2.5, 1];
function polaroidPhoto(dog) {
  const src = dog.avatarAssetId ? photoSrc(dog.avatarAssetId) : '';
  if (src) return '<span class="ph"><img src="' + esc(src) + '" alt=""></span>';
  const ch = dog.name ? Array.from(dog.name.trim())[0].toUpperCase() : '?';
  return '<span class="ph ph-init" style="background:' + esc(avatarBg(dog.color) || 'var(--surface-3)') + ';color:' + inkOn(avatarBg(dog.color)) + '">' + esc(ch) + '</span>';
}
export function ageText(p) {
  const out = [];
  if (p.y) out.push(p.y + ' ' + (p.y === 1 ? 'yr' : 'yrs'));
  if (p.m || p.y) out.push(p.m + ' ' + (p.m === 1 ? 'mo' : 'mos'));
  out.push(p.d + ' ' + (p.d === 1 ? 'day' : 'days'));
  return out.join(', ');
}
function dueCard(e) {
  const ty = EVENT_TYPES[e.type] || EVENT_TYPES.vet;
  const dt = dueText(e.nextDue);
  const short = dt.cls ? dt.txt.replace(/^Due /, '') : fmt(e.nextDue, { month: 'short', day: 'numeric', year: pd(e.nextDue).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  return '<button class="due-card" data-action="edit-event" data-id="' + esc(e.id) + '"><span class="grow"><span class="t">' + esc(e.title || ty.label) + '</span><span class="s">' + esc(ty.label) + (e.notes ? ' · ' + esc(e.notes) : '') + '</span></span>' +
    '<span class="due ' + dt.cls + '"><span class="vh">' + esc(dt.txt) + '</span><span aria-hidden="true">' + esc(short.charAt(0).toUpperCase() + short.slice(1)) + '</span></span></button>';
}
export function eventRow(e, extra) {
  const ty = EVENT_TYPES[e.type] || EVENT_TYPES.vet;
  return '<button class="ev" data-action="edit-event" data-id="' + esc(e.id) + '"><span class="ic" aria-hidden="true">' + ty.icon + '</span><span class="grow"><div class="t">' + esc(e.title || ty.label) + '</div><div class="s">' + esc(ty.label) + (isDate(e.date) ? ' · ' + esc(fmt(e.date, { month: 'short', day: 'numeric', year: 'numeric' })) : '') + '</div>' +
    (e.notes ? '<div class="s ell">' + esc(e.notes) + '</div>' : '') + extra + '</span>' + I.chevR.replace('<svg', '<svg class="chev"') + '</button>';
}
export function infoRow(k, v, empty, copy) {
  if (!v) return '<button class="row" data-action="edit-dog" data-id="' + esc(curDog().id) + '"><span class="grow"><div class="s">' + esc(k) + '</div><div class="t add-t">' + I.plus + esc(empty) + '</div></span></button>';
  return '<div class="row"><span class="grow"><div class="s">' + esc(k) + '</div><div class="t copyable num">' + esc(v) + '</div></span>' + (copy ? '<button class="icon-btn" data-action="copy" data-text="' + esc(v) + '" aria-label="Copy ' + esc(k) + '">' + I.copy + '</button>' : '') + '</div>';
}

export function openEventSheet(evId) {
  const dog = curDog();
  const ev = evId ? S.events[evId] : null;
  const type = ev ? ev.type : 'vet';
  const types = Object.keys(EVENT_TYPES).map((k) => '<label><input type="radio" name="type" value="' + k + '"' + (type === k ? ' checked' : '') + '><span class="chip" style="pointer-events:none">' + EVENT_TYPES[k].icon + ' ' + EVENT_TYPES[k].label + '</span></label>').join('');
  const body = '<form class="form" data-form="event" data-id="' + esc(evId || '') + '" autocomplete="off">' +
    '<div class="field"><span class="flabel">Type</span><div class="chips evtypes">' + types + '</div></div>' +
    '<label class="field"><span>Title</span><input class="input" id="ev_title" name="title" maxlength="80" placeholder="e.g. Rabies booster, Heartworm pill" value="' + esc(ev ? ev.title : '') + '"></label>' +
    '<div class="two"><label class="field"><span>Date</span><input class="input" type="date" id="ev_date" name="date" value="' + esc(ev && ev.date ? ev.date : todayStr()) + '"></label>' +
    '<label class="field"><span>Next due <span class="faint">(optional)</span></span><input class="input" type="date" id="ev_next" name="nextDue" value="' + esc(ev && ev.nextDue ? ev.nextDue : '') + '"></label></div>' +
    '<div class="chips" aria-label="Quick next-due">' + [['+2w', 14], ['+1m', 30], ['+3m', 91], ['+1y', 365]].map(([l, n]) => '<button type="button" class="chip static" data-action="due-quick" data-n="' + n + '">' + l + '</button>').join('') + '<button type="button" class="chip static" data-action="due-quick" data-n="0">No reminder</button></div>' +
    '<label class="field"><span>Notes</span><textarea class="input" id="ev_notes" name="notes" maxlength="2000" placeholder="Dose, clinic, what the vet said…">' + esc(ev ? ev.notes : '') + '</textarea></label>' +
    '<button class="btn block" type="submit">' + (ev ? 'Save' : 'Add record') + '</button>' +
    (ev ? '<button class="btn block danger" type="button" data-action="delete-event" data-id="' + esc(evId) + '">' + I.trash + 'Delete record</button>' : '') + '</form>';
  openSheet(ev ? 'Edit record' : 'New health record for ' + dog.name, body);
}

registerScreen('dog', { render: renderDog });
registerActions({
  'lightbox-gallery': (el) => openLightbox(galleryFor(curDog()), Number(el.dataset.i)),
  'set-size': (el) => { const d = Object.assign({}, curDog()); d.size = el.dataset.size; Store.put('dogs', d.id, d); render(); },
  'add-event': () => openEventSheet(null),
  'edit-event': (el) => openEventSheet(el.dataset.id),
  'delete-event': async (el) => {
    const c = await confirmDialog({ title: 'Delete this record?', body: 'It will be removed from the health timeline.', ok: 'Delete', danger: true });
    if (c !== 1) return;
    Store.del('events', el.dataset.id); closeSheet(); render();
  },
  'due-quick': (el) => {
    const n = Number(el.dataset.n); const inp = $('#ev_next'); const base = $('#ev_date').value || todayStr();
    inp.value = n ? addDays(isDate(base) ? base : todayStr(), n) : '';
  },
}, ['set-size', 'add-event', 'edit-event', 'delete-event']);

registerForms({
  'event': (f) => {
    const fd = new FormData(f);
    const dog = curDog();
    const id = f.dataset.id || genId('e');
    const type = String(fd.get('type') || 'vet');
    const ev = Object.assign({}, S.events[id] || {}, {
      id: id, dogId: (S.events[id] && S.events[id].dogId) || dog.id, type: type,
      title: String(fd.get('title') || '').trim() || EVENT_TYPES[type].label,
      date: isDate(fd.get('date')) ? fd.get('date') : todayStr(),
      nextDue: isDate(fd.get('nextDue')) ? fd.get('nextDue') : null,
      notes: String(fd.get('notes') || '')
    });
    Store.put('events', id, ev);
    closeSheet(); render(); toast(f.dataset.id ? 'Record saved' : 'Record added');
  }
});

// Photo picked from the profile avatar ("Change photo").
registerPicks({
  'avatar': async (files) => {
    const dog = curDog();
    const f = files[0];
    const prevAv = dog ? dog.avatarAssetId : null;
    toast('Adding photo…');
    const id = await savePhoto(f, dog ? dog.id : null, null);
    if (!id) return;
    const d = Object.assign({}, dog, { avatarAssetId: id });
    Store.put('dogs', d.id, d);
    if (prevAv) releasePhoto(prevAv);
    render();
    toast('Photo updated');
  }
});

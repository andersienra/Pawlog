// Dog profile screen: age, gotcha day, health & care records (+ record sheet), vet & ID, gallery.
import { avatarHtml, imgTag, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, dogEntries, dueText, photosOf } from '../state.js';
import { Store } from '../store.js';
import { closeSheet, confirmDialog, openLightbox, openSheet, render, toast } from '../ui.js';
import { $, EVENT_TYPES, I, SIZES, addDays, diffDays, ds, esc, fmt, genId, isDate, pd, plural, todayStr } from '../util.js';

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
  const meta = [dog.breed, dog.sex ? (dog.sex === 'female' ? 'Female' : 'Male') : '', SIZES[dog.size] ? SIZES[dog.size].label + ' size' : ''].filter(Boolean).join(' · ');
  let h = '<header class="topbar"><h1>' + esc(dog.name) + '</h1><button class="icon-btn" data-action="edit-dog" data-id="' + esc(dog.id) + '" aria-label="Edit profile">' + I.edit + '</button><button class="icon-btn" data-action="tab" data-view="prefs" aria-label="Settings">' + I.gear + '</button></header><div class="stack">';
  h += '<div class="hero"><label class="av-wrap" for="filePick" data-pick="avatar" aria-label="Change photo">' + avatarHtml(dog, 120) + '<span class="cam">' + I.camera + '</span></label>' +
    '<div><div class="sub">' + (meta ? esc(meta) : '<button class="linkbtn" data-action="edit-dog" data-id="' + esc(dog.id) + '">Add breed and details</button>') + '</div></div></div>';

  // Age
  if (dog.birthday) {
    const p = ageParts(dog.birthday, t);
    const ageDays = diffDays(dog.birthday, t);
    const ay = ageDays / 365.25;
    const hy = humanYears(ay, dog.size);
    const nb = nextAnniversary(dog.birthday, t);
    h += '<section><div class="group-label"><span>Age</span><span class="stage">' + lifeStage(ay, dog.size) + '</span></div><div class="panel">';
    h += '<div style="padding:16px 16px 12px"><div class="agebig">' + partsText(p) + '</div><div class="small muted" style="margin-top:2px">Born ' + esc(fmt(dog.birthday, { month: 'long', day: 'numeric', year: 'numeric' })) + ' · ' + ageDays.toLocaleString() + ' days old</div></div>';
    h += '<div class="kv" style="border-top:1px solid var(--line)"><div><div class="k">Human years</div><div class="v">≈ ' + Math.round(hy) + '</div><div class="s">for a ' + esc((SIZES[dog.size] || SIZES.medium).label.toLowerCase()) + ' dog</div></div>' +
      '<div><div class="k">Next birthday</div><div class="v">' + (nb.days === 0 ? 'Today!' : nb.days + '<span style="font-size:15px;color:var(--ink-3);font-weight:650"> days</span>') + '</div><div class="s">Turns ' + nb.years + ' on ' + esc(fmt(nb.date, { month: 'short', day: 'numeric' })) + '</div></div></div>';
    h += '<div style="padding:0 16px 14px"><div class="yearbar" aria-hidden="true"><i style="width:' + (nb.sinceLast / nb.span * 100).toFixed(1) + '%"></i></div><div class="small faint">' + (nb.days === 0 ? 'Happy birthday, ' + esc(dog.name) + '!' : Math.round(nb.sinceLast / nb.span * 100) + '% of the way to birthday #' + nb.years) + '</div></div>';
    h += '<div style="padding:0 16px 16px"><div class="flabel" style="margin-bottom:6px">Size used for human years</div><div class="seg" role="group" aria-label="Size">' + Object.keys(SIZES).map((k) => '<button data-action="set-size" data-size="' + k + '" aria-pressed="' + ((dog.size || 'medium') === k) + '">' + SIZES[k].label + '</button>').join('') + '</div></div>';
    h += '</div></section>';
  } else {
    h += '<section class="panel"><div class="empty"><h3>When is ' + esc(dog.name) + '’s birthday?</h3><p>Add it to see exact age, human years and a birthday countdown. A best guess is fine.</p><button class="btn sm soft" data-action="edit-dog" data-id="' + esc(dog.id) + '">Add birthday</button></div></section>';
  }

  // Gotcha
  if (dog.gotchaDate) {
    const p = ageParts(dog.gotchaDate, t);
    const na = nextAnniversary(dog.gotchaDate, t);
    h += '<section class="panel"><div class="kv"><div><div class="k">Home for</div><div class="v" style="font-size:20px;line-height:1.25;padding-top:4px">' + esc(plainParts(p) || 'Day one') + '</div><div class="s">since ' + esc(fmt(dog.gotchaDate, { month: 'short', day: 'numeric', year: 'numeric' })) + '</div></div>' +
      '<div><div class="k">Gotcha day</div><div class="v">' + (na.days === 0 ? 'Today!' : na.days + '<span style="font-size:15px;color:var(--ink-3);font-weight:650"> days</span>') + '</div><div class="s">' + plural(na.years, 'year') + ' together on ' + esc(fmt(na.date, { month: 'short', day: 'numeric' })) + '</div></div></div></section>';
  }

  // Health & care
  const evs = Object.values(S.events).filter((e) => e && e.dogId === dog.id);
  const upcoming = evs.filter((e) => isDate(e.nextDue)).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1));
  const past = evs.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  h += '<section><div class="group-label"><span>Health &amp; care</span><button class="linkbtn" style="min-height:32px;text-transform:none;letter-spacing:0;font-size:15px" data-action="add-event">' + I.plus + 'Add</button></div>';
  if (!evs.length) {
    h += '<div class="panel"><div class="empty"><h3>No health records yet</h3><p>Log vet visits, vaccines, meds and grooming. Set a next-due date and Pawlog reminds you on the Today screen.</p><button class="btn sm soft" data-action="add-event">' + I.plus + 'Add a record</button></div></div>';
  } else {
    if (upcoming.length) {
      h += '<div class="panel rows" style="margin-bottom:10px">' + upcoming.map((e) => { const dt = dueText(e.nextDue); return eventRow(e, '<span class="due ' + dt.cls + '">' + esc(dt.txt) + '</span>'); }).join('') + '</div>';
    }
    h += '<div class="group-label" style="margin-top:6px"><span>Timeline</span></div><div class="panel rows">' + past.map((e) => eventRow(e, '')).join('') + '</div>';
  }
  h += '</section>';

  // Vet & ID
  const vet = dog.vet || {};
  h += '<section><div class="group-label"><span>Vet &amp; ID</span></div><div class="panel rows">';
  h += infoRow('Vet', vet.name, 'Add your vet');
  h += infoRow('Vet phone', vet.phone, 'Add a phone number', true);
  h += infoRow('Microchip', dog.microchip, 'Add microchip number', true);
  h += '</div></section>';

  if (dog.notes && dog.notes.trim()) h += '<section><div class="group-label"><span>Notes</span></div><div class="panel pad" style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(dog.notes) + '</div></section>';

  // Gallery
  const gal = galleryFor(dog);
  h += '<section><div class="group-label"><span>Photos</span>' + (gal.length ? '<span class="aside">' + gal.length + '</span>' : '') + '</div><div class="panel">';
  if (gal.length) h += '<div class="gallery">' + gal.map((g, i) => '<button data-action="lightbox-gallery" data-i="' + i + '" aria-label="Photo from ' + esc(fmt(g.date, { month: 'short', day: 'numeric' })) + '">' + imgTag(g.id, '') + '</button>').join('') + '</div>';
  else h += '<div class="empty"><h3>No photos yet</h3><p>Photos you add to daily logs collect here.</p></div>';
  h += '</div></section></div>';
  return h;
}
export function eventRow(e, extra) {
  const ty = EVENT_TYPES[e.type] || EVENT_TYPES.vet;
  return '<button class="ev" data-action="edit-event" data-id="' + esc(e.id) + '"><span class="ic" aria-hidden="true">' + ty.icon + '</span><span class="grow"><div class="t">' + esc(e.title || ty.label) + '</div><div class="s">' + esc(ty.label) + (isDate(e.date) ? ' · ' + esc(fmt(e.date, { month: 'short', day: 'numeric', year: 'numeric' })) : '') + '</div>' +
    (e.notes ? '<div class="s" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(e.notes) + '</div>' : '') + extra + '</span></button>';
}
export function infoRow(k, v, empty, copy) {
  if (!v) return '<button class="row" data-action="edit-dog" data-id="' + esc(curDog().id) + '"><span class="grow"><div class="s">' + esc(k) + '</div><div class="t" style="color:var(--accent)">' + esc(empty) + '</div></span></button>';
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

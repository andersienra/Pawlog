// Today screen (Scrapbook): date header, reminders, polaroid + vibe score card, behavior sliders, tags,
// lined-paper notes, details, photos.
import { avatarHtml, imgTag, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, dogBehaviors, dueEvents, dueText, entryId, entryScore, getEntry, goodness, isLogged, normalizeEntry, photosOf, ratingsOf, saveQuickTags, scoreWord, settings, streakFor, tagsOf } from '../state.js';
import { Store, byLine, canWrite, flushPending, pendingEdits, refreshSaveState } from '../store.js';
import { autoGrow, bannerHtml, confirmDialog, dragging, go, openLightbox, render, toast } from '../ui.js';
import { $, $$, EVENT_TYPES, I, PAW, addDays, clamp, diffDays, esc, fmt, isDate, pd, plural, round1, todayStr } from '../util.js';

/* =========================================================
   TODAY
   ========================================================= */
export function renderToday(dog) {
  const t = todayStr();
  if (S.date > t) S.date = t;
  const date = S.date;
  const e = getEntry(dog.id, date) || {};
  const bs = dogBehaviors(dog.id);
  const streak = streakFor(dog.id);
  const isToday = date === t;
  const dayDiff = diffDays(date, t);
  const rel = isToday ? 'Today' : dayDiff === 1 ? 'Yesterday' : '';
  const sub = fmt(date, { weekday: 'long', month: 'short', day: 'numeric', year: pd(date).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

  let h = '<header class="topbar"><button class="dog-chip" data-action="switch-dog" aria-label="Switch dog">' + avatarHtml(dog, 34) + '<span class="nm">' + esc(dog.name) + '</span>' + I.chevD + '</button><span class="spacer"></span>' +
    '<span id="savestate" class="savestate" aria-live="polite"></span>' +
    (streak > 0 ? '<span class="streak" title="Days in a row with a log">' + I.flame + '<span class="num">' + streak + '</span></span>' : '') + '</header>';
  h += bannerHtml();
  h += '<div class="stack today">';
  // Date header: kicker date + "<Name>'s day". The whole title block opens the date picker.
  h += '<div class="datebar day-head"><div class="when"><div class="kicker">' + I.cal + '<span>' + (rel ? esc(rel) + ' · ' : '') + esc(sub) + '</span></div>' +
    '<h1 class="big">' + esc(dog.name) + '’s day</h1>' +
    '<input type="date" id="datePick" aria-label="Pick a date" max="' + t + '" value="' + date + '"></div>' +
    '<div class="navs"><button class="icon-btn" data-action="day" data-d="-1" aria-label="Previous day">' + I.chevL + '</button>' +
    '<button class="icon-btn" data-action="day" data-d="1" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>' + I.chevR + '</button></div></div>';
  if (!isToday) h += '<button class="jump-today" data-action="goto-today">Back to today</button>';

  const due = dueEvents(dog.id, 7);
  if (due.length && isToday) {
    h += '<div class="reminders">' + due.slice(0, 3).map((ev) => {
      const dt = dueText(ev.nextDue);
      return '<button class="reminder ' + (dt.cls === 'over' ? 'overdue' : dt.cls) + '" data-action="edit-event" data-id="' + esc(ev.id) + '"><span class="ic">' + I.cal + '</span><span class="grow"><div class="t">' + esc(ev.title || (EVENT_TYPES[ev.type] || EVENT_TYPES.vet).label) + '</div><div class="s">' + esc((EVENT_TYPES[ev.type] || EVENT_TYPES.vet).label) + '</div></span><span class="pill">' + esc(dt.txt) + '</span></button>';
    }).join('') + '</div>';
  }

  // Polaroid of the day's first photo beside the "vibe" score card.
  h += '<div class="today-top">' + polaroidHtml(e) + '<section class="vibe" id="summary" aria-live="polite">' + summaryInner(dog, e, bs) + '</section></div>';

  // Behaviors
  h += '<section><div class="group-label"><span>How was ' + esc(dog.name) + '?</span><span class="aside">1–10</span></div><div class="blist">';
  if (!bs.length) {
    h += '<div class="bempty"><h3>Nothing to rate yet</h3><p>Add the things you want to track for ' + esc(dog.name) + ': energy, recall, barking, anything.</p></div>';
  }
  const rs = ratingsOf(e);
  bs.forEach((b, i) => { h += behaviorCard(b, rs[b.id], i); });
  h += '</div>';
  if (!S.readOnly) h += '<div class="beh-tools"><button class="beh-add" data-action="behavior-new">' + I.plus + 'Add behavior</button>' +
    (bs.length ? '<button class="beh-edit" data-action="behaviors-manage">' + I.edit + 'Edit</button>' : '') + '</div>';
  h += '</section>';

  // Tags
  const qt = settings().quickTags || [];
  const tags = tagsOf(e);
  const extra = tags.filter((x) => qt.indexOf(x) < 0);
  h += '<section class="today-tags"><div class="group-label"><span>What happened</span></div><div class="chips" data-tagbox>' +
    qt.concat(extra).map((tg) => '<button class="chip" data-action="toggle-tag" data-tag="' + esc(tg) + '" aria-pressed="' + (tags.indexOf(tg) >= 0) + '">' + esc(tg) + '</button>').join('') +
    (S.addingTag || S.readOnly ? '' : '<button class="chip add" data-action="add-tag">' + I.plus + 'Tag</button>') + '</div>' +
    (S.addingTag ? '<form class="tag-input" data-form="tag-new"><input class="input" id="tagNew" name="tag" maxlength="40" placeholder="New tag" autocomplete="off" enterkeyhint="done"><button class="btn sm" type="submit">Add</button><button class="btn sm ghost" type="button" data-action="cancel-tag">Cancel</button></form>' : '') +
    '</section>';

  // Notes (lined paper)
  h += '<section><div class="group-label"><span>Notes</span></div><div class="panel paper"><textarea class="input notes-area" id="notes" data-autogrow maxlength="5000" aria-label="Notes" placeholder="Anything worth remembering? Triggers, wins, what you tried…">' + esc(e.notes || '') + '</textarea></div></section>';

  // Details
  const unit = dog.weightUnit || 'kg';
  const sumBits = [];
  if (e.walkMinutes != null) sumBits.push(e.walkMinutes + ' min walk');
  if (e.weight != null) sumBits.push(e.weight + ' ' + unit);
  if (e.meals != null) sumBits.push(plural(e.meals, 'meal'));
  h += '<section><details class="more panel" id="details"' + (S.detailsOpen ? ' open' : '') + '><summary class="row"><span class="grow"><div class="t">Walk, weight &amp; meals</div><div class="s">' + (sumBits.length ? esc(sumBits.join(' · ')) : 'Optional') + '</div></span>' +
    '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></summary>' +
    '<div class="detail-grid"><label class="field"><span>Walk (minutes)</span><input class="input num" id="walk" type="number" inputmode="numeric" min="0" max="600" step="5" placeholder="0" value="' + esc(e.walkMinutes != null ? e.walkMinutes : '') + '"></label>' +
    '<label class="field"><span>Weight (' + esc(unit) + ')</span><input class="input num" id="weight" type="number" inputmode="decimal" min="0" max="250" step="0.1" placeholder="–" value="' + esc(e.weight != null ? e.weight : '') + '"></label>' +
    '<div class="field" style="grid-column:1/-1"><span class="flabel">Meals</span><div class="stepper"><button type="button" data-action="meals" data-d="-1" aria-label="One fewer meal">−</button><div class="v num" id="mealsV">' + esc(e.meals != null ? e.meals : '–') + '</div><button type="button" data-action="meals" data-d="1" aria-label="One more meal">+</button></div></div></div></details></section>';

  // Photos
  h += '<section><div class="group-label"><span>Photos</span></div><div class="panel">' + photoGridHtml(e) + '</div></section>';

  const bl = byLine(getEntry(dog.id, date));
  h += '<p class="byline" id="byline" aria-live="polite">' + esc(bl) + '</p>';
  if (isLogged(getEntry(dog.id, date)) && !S.readOnly) h += '<div style="text-align:center"><button class="linkbtn danger" data-action="clear-day">' + I.trash + 'Clear this day</button></div>';
  h += '</div>';
  return h;
}
export function photoGridHtml(e) {
  const ph = photosOf(e);
  const sub = S.date;
  return '<div class="photos" id="photoGrid" data-ids="' + esc(ph.join(',')) + '">' +
    ph.map((id, i) => '<div class="ph"><button class="open" data-action="lightbox-entry" data-i="' + i + '" aria-label="Open photo">' + imgTag(id, 'Photo from ' + sub) + '</button>' + (S.readOnly ? '' : '<button class="rm" data-action="rm-photo" data-id="' + esc(id) + '" aria-label="Remove photo">' + I.x + '</button>') + '</div>').join('') +
    Array.from({ length: S.uploading }).map(() => '<div class="ph loading"></div>').join('') +
    (S.readOnly ? (ph.length ? '' : '<p class="small muted" style="margin:4px;grid-column:1/-1">No photos for this day.</p>') : '<label for="filePick" class="ph add" data-pick="entry">' + I.camera + '<span>Add</span></label>') + '</div>';
}
// Taped polaroid: the day's first photo (opens the lightbox), or an "add a photo" frame.
// data-key lets patchToday skip rebuilding it when nothing it shows has changed.
export function polaroidHtml(e) {
  const ph = photosOf(e);
  const tags = tagsOf(e);
  const isToday = S.date === todayStr();
  const cap = tags.length ? tags[0].toLowerCase() : ph.length ? (isToday ? 'today!' : fmt(S.date, { month: 'short', day: 'numeric' })) : '';
  const key = (ph[0] || '') + '|' + cap + '|' + (S.readOnly ? 1 : 0) + '|' + (ph[0] ? (photoSrcKnown(ph[0]) ? 1 : 0) : 0);
  const tape = '<span class="tape" aria-hidden="true"></span>';
  const capHtml = '<span class="cap">' + esc(cap || (S.readOnly ? 'no photo' : 'add a photo')) + '</span>';
  if (ph.length) {
    return '<button class="polaroid" id="polaroid" data-key="' + esc(key) + '" data-action="lightbox-entry" data-i="0" aria-label="Open the first photo of the day">' + tape + '<span class="pic">' + imgTag(ph[0], '') + '</span>' + capHtml + '</button>';
  }
  if (S.readOnly) return '<div class="polaroid empty" id="polaroid" data-key="' + esc(key) + '">' + tape + '<span class="pic">' + PAW + '</span>' + capHtml + '</div>';
  return '<label for="filePick" class="polaroid empty" id="polaroid" data-key="' + esc(key) + '" data-pick="entry" aria-label="Add a photo for this day">' + tape + '<span class="pic">' + I.camera + '</span>' + capHtml + '</label>';
}
function photoSrcKnown(id) { return !/ph-missing/.test(imgTag(id, '')); }
function refreshPolaroid(e) {
  const p = $('#polaroid'); if (!p) return;
  const wrap = document.createElement('div'); wrap.innerHTML = polaroidHtml(e);
  const n = wrap.firstElementChild;
  if (n.dataset.key !== p.dataset.key) p.replaceWith(n);
}
export function summaryInner(dog, e, bs) {
  const score = entryScore(Object.assign({ dogId: dog.id }, e));
  const rs = ratingsOf(e);
  const rated = bs.filter((b) => typeof rs[b.id] === 'number').length;
  const isToday = S.date === todayStr();
  const k = isToday ? 'Today’s vibe' : diffDays(S.date, todayStr()) === 1 ? 'Yesterday’s vibe' : 'The day’s vibe';
  return '<div class="summary"><div class="k">' + k + '</div>' +
    '<div class="score num' + (score == null ? ' none' : '') + '">' + (score == null ? '–' : score) + '</div>' +
    '<div class="word">' + scoreWord(score) + '</div>' +
    '<div class="meta">' + (rated ? rated + ' of ' + bs.length + ' rated' : bs.length ? 'Slide one to start' : 'Add a behavior to start') + '</div>' +
    '<div class="progress" aria-hidden="true"><i style="width:' + (bs.length ? Math.round(rated / bs.length * 100) : 0) + '%"></i></div></div>';
}
// Handwritten verdict for a rating, from how good it is (so "low is better" behaviors read right).
export function ratingWord(b, v) {
  const g = goodness(b, v);
  return g >= 9 ? 'great' : g >= 7 ? 'good' : g >= 5 ? 'okay' : g >= 3 ? 'not great' : 'rough';
}
function bvalHtml(b, v) {
  return typeof v === 'number' ? '<span class="bw">' + ratingWord(b, v) + '</span> · ' + v : 'Not rated';
}
// i = position in the dog's behavior list; colors cycle --b1..--b6 by order.
export function behaviorCard(b, v, i) {
  if (i == null) i = Math.max(0, dogBehaviors(b.dogId).findIndex((x) => x.id === b.id));
  const set = typeof v === 'number';
  const val = set ? v : 5;
  const n = (i % 6) + 1;
  const st = '--c:var(--b' + n + ',' + B_FALLBACK[n - 1] + ');--pf:' + ((val - 1) / 9).toFixed(3);
  return '<div class="bcard' + (set ? '' : ' unset') + '" data-bid="' + esc(b.id) + '" style="' + st + '">' +
    '<div class="bhead"><span class="bemoji" aria-hidden="true">' + esc(b.emoji || '•') + '</span><span class="bname">' + esc(b.name) + '</span>' +
    (set && !S.readOnly ? '<button class="bclear" data-action="clear-rating" data-bid="' + esc(b.id) + '" aria-label="Clear ' + esc(b.name) + ' rating">Clear</button>' : '') +
    '<span class="bval num">' + bvalHtml(b, v) + '</span></div>' +
    '<input type="range" class="slider" min="1" max="10" step="1"' + (S.readOnly ? ' disabled' : '') + ' value="' + val + '" id="r_' + esc(b.id) + '" data-rate="' + esc(b.id) + '" aria-label="' + esc(b.name) + ', 1 ' + esc(b.lowLabel) + ' to 10 ' + esc(b.highLabel) + '"' + (set ? '' : ' aria-valuetext="Not rated"') + '>' +
    '<div class="blabels"><span>' + esc(b.lowLabel || 'Low') + '</span><span>' + esc(b.highLabel || 'High') + '</span></div></div>';
}
// Used only until base.css defines --b1..--b6 (light values; dark comes from the tokens).
const B_FALLBACK = ['#D9480F', '#7048E8', '#0C8599', '#2F9E44', '#C2255C', '#E67700'];

// Entry editing: every change is a merge patch on the day's doc, so edits from two people merge.
// patch fields: ratings {bid: n|null}, tags {name: true|false}, photos {id: ts|null}, notes, walkMinutes, weight, meals.
export function editEntry(dog, date, patch, opts) {
  const id = entryId(dog.id, date);
  const create = { dogId: dog.id, date: date, ratings: {}, notes: '', tags: {}, photos: {}, walkMinutes: null, weight: null, meals: null };
  if (S.entries[id] && (Array.isArray(S.entries[id].tags) || Array.isArray(S.entries[id].photoAssetIds))) {
    // Legacy array-shaped doc: rewrite once in map shape so later patches merge cleanly.
    const n = normalizeEntry(S.entries[id]);
    S.entries[id] = n;
    Store.put('entries', id, n);
  }
  const ok = Store.patch('entries', id, Object.assign({ updatedAt: Date.now() }, patch), create, opts && opts.now ? 0 : 700);
  if (ok) refreshSaveState();
  return ok;
}
export function updateTodayLive(dog) {
  const e = getEntry(dog.id, S.date) || {};
  const sm = $('#summary');
  if (sm) sm.innerHTML = summaryInner(dog, e, dogBehaviors(dog.id));
}

// Update the Today screen from S.entries without rebuilding it.
export function patchToday() {
  const dog = curDog();
  if (!dog || S.view !== 'today' || !$('#summary')) return;
  const e = getEntry(dog.id, S.date) || {};
  const rs = ratingsOf(e);
  const order = dogBehaviors(dog.id).map((x) => x.id);
  for (const card of $$('.bcard[data-bid]')) {
    const bid = card.dataset.bid, b = S.behaviors[bid];
    if (!b) continue;
    const sl = card.querySelector('.slider');
    if (sl === dragging || sl === document.activeElement && dragging) continue;
    const v = rs[bid];
    const isSet = !card.classList.contains('unset');
    const curV = isSet ? Number(sl.value) : undefined;
    if ((typeof v === 'number') === isSet && (v === undefined || v === curV)) continue;
    const wrap = document.createElement('div'); wrap.innerHTML = behaviorCard(b, v, Math.max(0, order.indexOf(bid)));
    card.replaceWith(wrap.firstElementChild);
  }
  const tags = tagsOf(e);
  const chipsBox = $('[data-tagbox]');
  if (chipsBox) {
    const known = $$('.chip[data-tag]', chipsBox).map((c) => c.dataset.tag);
    for (const c of $$('.chip[data-tag]', chipsBox)) c.setAttribute('aria-pressed', String(tags.indexOf(c.dataset.tag) >= 0));
    const missing = tags.filter((t) => known.indexOf(t) < 0);
    if (missing.length) {
      const addBtn = chipsBox.querySelector('.chip.add');
      missing.forEach((tg) => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.action = 'toggle-tag'; b.dataset.tag = tg; b.setAttribute('aria-pressed', 'true'); b.textContent = tg; chipsBox.insertBefore(b, addBtn); });
    }
  }
  const notes = $('#notes');
  if (notes && notes !== document.activeElement && !pendingEdits.has('entries/' + entryId(dog.id, S.date)) && notes.value !== (e.notes || '')) { notes.value = e.notes || ''; autoGrow(notes); }
  for (const [fid, key] of [['walk', 'walkMinutes'], ['weight', 'weight']]) {
    const el = $('#' + fid);
    if (el && el !== document.activeElement) { const want = e[key] != null ? String(e[key]) : ''; if (el.value !== want) el.value = want; }
  }
  const mv = $('#mealsV'); if (mv) mv.textContent = e.meals != null ? e.meals : '–';
  const ph = $('#photoGrid'); if (ph) { const want = photosOf(e).join(','); if ((ph.dataset.ids !== want || ph.querySelector('.ph-missing')) && !S.uploading) ph.outerHTML = photoGridHtml(e); }
  const by = $('#byline'); if (by) by.textContent = byLine(e);
  refreshPolaroid(e);
  updateTodayLive(dog);
}

// Someone else changed the note while this person was typing in it: their text stayed on screen,
// so on leaving the field make it the saved version (the person editing wins).
document.addEventListener('focusout', (e) => {
  const t = e.target;
  if (!t || !S.ready || S.readOnly) return;
  const dog = curDog(); if (!dog) return;
  const en = getEntry(dog.id, S.date) || {};
  if (t.id === 'notes' && t.value !== (en.notes || '') && !pendingEdits.has('entries/' + entryId(dog.id, S.date))) editEntry(dog, S.date, { notes: t.value }, { now: true });
}, true);

registerScreen('today', { render: renderToday, patch: patchToday });
registerActions({
  'day': (el) => { flushPending(); const n = addDays(S.date, Number(el.dataset.d)); if (n <= todayStr()) { S.date = n; S.addingTag = false; render(); } },
  'goto-today': () => { flushPending(); S.date = todayStr(); go('today', { top: true }); },
  'open-day': (el) => { flushPending(); S.date = el.dataset.date; S.addingTag = false; go('today', { top: true }); },
  'clear-rating': (el) => {
    const dog = curDog(); const bid = el.dataset.bid;
    const r = {}; r[bid] = null;
    if (!editEntry(dog, S.date, { ratings: r })) return;
    const card = el.closest('.bcard');
    const b = S.behaviors[bid];
    if (card && b) { card.outerHTML = behaviorCard(b, undefined); }
    const sl = $('#r_' + CSS.escape(bid)); if (sl) sl.focus({ preventScroll: true });
    updateTodayLive(dog);
  },
  'toggle-tag': (el) => {
    const dog = curDog(); const tg = el.dataset.tag;
    const on = tagsOf(getEntry(dog.id, S.date)).indexOf(tg) < 0;
    const t = {}; t[tg] = on ? Date.now() : false;
    if (!editEntry(dog, S.date, { tags: t })) return;
    el.setAttribute('aria-pressed', String(on));
    refreshPolaroid(getEntry(dog.id, S.date) || {});
    if (!on && (settings().quickTags || []).indexOf(tg) < 0) render();
  },
  'add-tag': () => { S.addingTag = true; render(); const i = $('#tagNew'); if (i) i.focus(); },
  'cancel-tag': () => { S.addingTag = false; render(); },
  'meals': (el) => {
    const dog = curDog();
    const e = getEntry(dog.id, S.date) || {};
    const cur = e.meals == null ? 0 : e.meals;
    let v = clamp(cur + Number(el.dataset.d), 0, 9);
    if (v === 0 && e.meals == null) v = null;
    if (!editEntry(dog, S.date, { meals: v })) return;
    const mv = $('#mealsV'); if (mv) mv.textContent = v == null ? '–' : v;
  },
  'rm-photo': async (el) => {
    const c = await confirmDialog({ title: 'Remove this photo?', body: 'It will be removed from this day and your gallery.', ok: 'Remove', danger: true });
    if (c !== 1) return;
    const dog = curDog(); const id = el.dataset.id;
    const pp = {}; pp[id] = null;
    if (!editEntry(dog, S.date, { photos: pp }, { now: true })) return;
    releasePhoto(id);
    render();
  },
  'clear-day': async () => {
    const c = await confirmDialog({ title: 'Clear this day?', body: 'Ratings, tags, notes, details and photos for ' + fmt(S.date, { month: 'long', day: 'numeric' }) + ' will be removed.', ok: 'Clear day', danger: true });
    if (c !== 1) return;
    const dog = curDog(); const e = getEntry(dog.id, S.date);
    const ph = photosOf(e);
    const key = 'entries/' + entryId(dog.id, S.date);
    const p = pendingEdits.get(key); if (p) { clearTimeout(p.timer); pendingEdits.delete(key); }
    Store.del('entries', entryId(dog.id, S.date));
    ph.forEach(releasePhoto);
    render();
    toast('Day cleared');
  },
  'lightbox-entry': (el) => { const dog = curDog(); const e = getEntry(dog.id, S.date); if (e) openLightbox(photosOf(e).map((id) => ({ id: id, date: S.date })), Number(el.dataset.i)); },
}, ['clear-rating', 'toggle-tag', 'add-tag', 'meals', 'rm-photo', 'clear-day']);

registerForms({
  'tag-new': (f) => {
    const v = String(new FormData(f).get('tag') || '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (S.readOnly) { canWrite(); return; }
    const q = settings().quickTags;
    if (q.indexOf(v) < 0) { q.push(v); saveQuickTags(q); }
    const dog = curDog();
    const t = {}; t[v] = Date.now();
    editEntry(dog, S.date, { tags: t });
    S.addingTag = false;
    render();
  }
});

// Photos picked from the day's photo grid.
registerPicks({
  'entry': async (files) => {
    const dog = curDog();
    if (!dog) return;
    const date = S.date;
    if (S.readOnly) { canWrite(); return; }
    S.uploading += files.length;
    { const g = $('#photoGrid'); if (g) g.outerHTML = photoGridHtml(getEntry(dog.id, S.date) || {}); }
    for (const f of files) {
      const id = await savePhoto(f, dog.id, date);
      S.uploading = Math.max(0, S.uploading - 1);
      if (id) { const pp = {}; pp[id] = Date.now(); editEntry(dog, date, { photos: pp }, { now: true }); }
      if (S.view === 'today') { const en = getEntry(dog.id, S.date) || {}; const g = $('#photoGrid'); if (g) g.outerHTML = photoGridHtml(en); refreshPolaroid(en); }
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  const dog = curDog();
  if (t.matches && t.matches('.slider[data-rate]')) {
    if (touchHold && touchHold.el === t) { touchHold.pending = true; return; } // touch gesture not yet a drag: hold
    const bid = t.dataset.rate, v = Number(t.value), b = S.behaviors[bid];
    if (!b || !dog) return;
    const r = {}; r[bid] = v;
    if (!editEntry(dog, S.date, { ratings: r })) { t.value = ratingsOf(getEntry(dog.id, S.date))[bid] || 5; return; }
    const card = t.closest('.bcard');
    card.style.setProperty('--pf', ((v - 1) / 9).toFixed(3));
    if (card.classList.contains('unset')) {
      card.classList.remove('unset');
      t.removeAttribute('aria-valuetext');
      const bv = card.querySelector('.bval');
      bv.insertAdjacentHTML('beforebegin', '<button class="bclear" data-action="clear-rating" data-bid="' + esc(bid) + '" aria-label="Clear ' + esc(b.name) + ' rating">Clear</button>');
    }
    card.querySelector('.bval').innerHTML = bvalHtml(b, v);
    updateTodayLive(dog);
    if (navigator.vibrate) { try { navigator.vibrate(4); } catch (er) { /* ignore */ } }
  } else if (t.id === 'notes') {
    autoGrow(t);
    editEntry(dog, S.date, { notes: t.value });
  } else if (t.id === 'walk' || t.id === 'weight') {
    const raw = t.value.trim();
    const v = raw === '' ? null : Number(raw);
    if (v != null && (!isFinite(v) || v < 0)) return;
    editEntry(dog, S.date, t.id === 'walk' ? { walkMinutes: v == null ? null : Math.round(v) } : { weight: v == null ? null : round1(v) });
  }
});

// Unset slider: a tap sets it to the tapped value even when the value doesn't change (e.g. 5).
// Commit only on pointerup, so a scroll that merely starts on a slider (pointercancel) records nothing.
// Touch scroll-safety: on touch, Chrome moves a range thumb to the finger (firing 'input') before it decides
// the gesture is a vertical page scroll (then 'pointercancel'). Hold touch-initiated slider input until the
// finger moves sideways (a real drag: commit and go live) or lifts (a tap: commit); on cancel, revert.
export let unsetTap = null;
let touchHold = null; // { el, x, y, start, pending }
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  unsetTap = t.matches && t.matches('.bcard.unset .slider') ? t : null;
  touchHold = e.pointerType !== 'mouse' && t.matches && t.matches('.slider[data-rate]') ? { el: t, x: e.clientX, y: e.clientY, start: t.value, pending: false } : null;
});
document.addEventListener('pointermove', (e) => {
  const h = touchHold; if (!h) return;
  const dx = Math.abs(e.clientX - h.x), dy = Math.abs(e.clientY - h.y);
  if (dx > 8 && dx > dy) { touchHold = null; if (h.pending) h.el.dispatchEvent(new Event('input', { bubbles: true })); }
}, { passive: true });

document.addEventListener('pointercancel', () => {
  unsetTap = null;
  const h = touchHold; touchHold = null;
  if (h && h.pending && h.el.isConnected) h.el.value = h.start;
});
document.addEventListener('pointerup', (e) => {
  const h = touchHold; touchHold = null;
  if (h && h.pending && h.el.isConnected) h.el.dispatchEvent(new Event('input', { bubbles: true }));
  const t = unsetTap; unsetTap = null;
  if (t && e.target === t) setTimeout(() => { if (t.isConnected && t.closest('.bcard.unset')) t.dispatchEvent(new Event('input', { bubbles: true })); }, 0);
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'datePick') {
    flushPending();
    if (isDate(t.value) && t.value <= todayStr()) { S.date = t.value; S.addingTag = false; render(); }
  }
});

document.addEventListener('toggle', (e) => { if (e.target.id === 'details') S.detailsOpen = e.target.open; }, true);
document.addEventListener('click', (e) => {
  const w = e.target.closest('.when');
  if (w && e.target.id === 'datePick') { try { e.target.showPicker && e.target.showPicker(); } catch (er) { /* ignore */ } }
});

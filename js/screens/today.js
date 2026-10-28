// Today screen: date bar, reminders, score summary, behavior sliders, tags, notes, details, photos.
import { avatarHtml, imgTag, releasePhoto, savePhoto } from '../photos.js';
import { registerActions, registerForms, registerPicks, registerScreen } from '../registry.js';
import { S, curDog, dogBehaviors, dueEvents, dueText, entryId, entryScore, getEntry, goodness, isLogged, normalizeEntry, photosOf, ratingsOf, saveQuickTags, scoreWord, settings, streakFor, tagsOf, valueColor } from '../state.js';
import { Store, byLine, canWrite, flushPending, pendingEdits, refreshSaveState } from '../store.js';
import { autoGrow, bannerHtml, confirmDialog, dragging, go, openLightbox, render, toast } from '../ui.js';
import { $, $$, EVENT_TYPES, I, addDays, clamp, diffDays, esc, fmt, isDate, pd, plural, round1, todayStr } from '../util.js';

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
  const big = isToday ? 'Today' : dayDiff === 1 ? 'Yesterday' : fmt(date, { weekday: 'long' });
  const sub = fmt(date, { month: 'long', day: 'numeric', year: pd(date).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

  let h = '<header class="topbar"><button class="dog-chip" data-action="switch-dog" aria-label="Switch dog">' + avatarHtml(dog, 34) + '<span class="nm">' + esc(dog.name) + '</span>' + I.chevD + '</button><span class="spacer"></span>' +
    '<span id="savestate" class="savestate" aria-live="polite"></span>' +
    (streak > 0 ? '<span class="streak" title="Days in a row with a log">' + I.flame + '<span class="num">' + streak + '</span></span>' : '') + '</header>';
  h += bannerHtml();
  h += '<div class="stack">';
  h += '<div class="datebar"><button class="icon-btn" data-action="day" data-d="-1" aria-label="Previous day">' + I.chevL + '</button>' +
    '<div class="when"><div class="big">' + esc(big) + '</div><div class="sub">' + I.cal + esc(sub) + '</div>' +
    '<input type="date" id="datePick" aria-label="Pick a date" max="' + t + '" value="' + date + '"></div>' +
    '<button class="icon-btn" data-action="day" data-d="1" aria-label="Next day"' + (isToday ? ' disabled' : '') + '>' + I.chevR + '</button></div>';
  if (!isToday) h += '<button class="jump-today" data-action="goto-today">Back to today</button>';

  const due = dueEvents(dog.id, 7);
  if (due.length && isToday) {
    h += '<div style="display:flex;flex-direction:column;gap:8px">' + due.slice(0, 3).map((ev) => {
      const dt = dueText(ev.nextDue);
      return '<button class="reminder ' + (dt.cls === 'over' ? 'overdue' : '') + '" data-action="edit-event" data-id="' + esc(ev.id) + '"><span class="ic">' + (EVENT_TYPES[ev.type] || EVENT_TYPES.vet).icon + '</span><span class="grow" style="flex:1;min-width:0"><div class="t">' + esc(ev.title || (EVENT_TYPES[ev.type] || EVENT_TYPES.vet).label) + '</div><div class="s">' + esc(dt.txt) + '</div></span>' + '<svg class="chev" style="width:18px;height:18px;color:var(--ink-3)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></button>';
    }).join('') + '</div>';
  }

  h += '<section class="panel" id="summary">' + summaryInner(dog, e, bs) + '</section>';

  // Behaviors
  h += '<section><div class="group-label"><span>How was ' + esc(dog.name) + '?</span><span class="aside">1–10</span></div><div class="panel rows">';
  if (!bs.length) {
    h += '<div class="empty"><h3>No behaviors to rate</h3><p>Add the things you want to track in Settings.</p><button class="btn soft sm" data-action="tab" data-view="prefs">Open Settings</button></div>';
  }
  const rs = ratingsOf(e);
  for (const b of bs) h += behaviorCard(b, rs[b.id]);
  h += '</div></section>';

  // Tags
  const qt = settings().quickTags || [];
  const tags = tagsOf(e);
  const extra = tags.filter((x) => qt.indexOf(x) < 0);
  h += '<section><div class="group-label"><span>What happened</span></div><div class="panel pad"><div class="chips" data-tagbox>' +
    qt.concat(extra).map((tg) => '<button class="chip" data-action="toggle-tag" data-tag="' + esc(tg) + '" aria-pressed="' + (tags.indexOf(tg) >= 0) + '">' + esc(tg) + '</button>').join('') +
    (S.addingTag || S.readOnly ? '' : '<button class="chip add" data-action="add-tag">' + I.plus + 'Tag</button>') + '</div>' +
    (S.addingTag ? '<form class="tag-input" data-form="tag-new"><input class="input" id="tagNew" name="tag" maxlength="40" placeholder="New tag" autocomplete="off" enterkeyhint="done"><button class="btn sm" type="submit">Add</button><button class="btn sm ghost" type="button" data-action="cancel-tag">Cancel</button></form>' : '') +
    '</div></section>';

  // Notes
  h += '<section><div class="group-label"><span>Notes</span></div><div class="panel"><textarea class="input notes-area" id="notes" data-autogrow maxlength="5000" placeholder="Anything worth remembering? Triggers, wins, what you tried…">' + esc(e.notes || '') + '</textarea></div></section>';

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
  if (isLogged(getEntry(dog.id, date)) && !S.readOnly) h += '<div style="text-align:center"><button class="linkbtn" style="color:var(--bad)" data-action="clear-day">' + I.trash + 'Clear this day</button></div>';
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
export function summaryInner(dog, e, bs) {
  const score = entryScore(Object.assign({ dogId: dog.id }, e));
  const rs = ratingsOf(e);
  const rated = bs.filter((b) => typeof rs[b.id] === 'number').length;
  const C = 2 * Math.PI * 36;
  const pct = score == null ? 0 : score / 100;
  const col = score == null ? 'var(--surface-3)' : valueColor(pct);
  return '<div class="summary"><div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="none" stroke="var(--surface-2)" stroke-width="9"/><circle cx="42" cy="42" r="36" fill="none" stroke="' + col + '" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (C * pct).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' +
    '<div class="v num"><div>' + (score == null ? '–' : score) + '<small>score</small></div></div></div>' +
    '<div class="txt"><div class="word">' + scoreWord(score) + '</div><div class="meta">' + (rated ? rated + ' of ' + bs.length + ' rated' : 'Slide a behavior below to start today’s log') + '</div>' +
    '<div class="progress" aria-hidden="true"><i style="width:' + (bs.length ? Math.round(rated / bs.length * 100) : 0) + '%"></i></div></div></div>';
}
export function behaviorCard(b, v) {
  const set = typeof v === 'number';
  const val = set ? v : 5;
  const g = (goodness(b, val) - 1) / 9;
  const st = set ? '--c:' + valueColor(g) + ';--p:' + ((val - 1) / 9 * 100).toFixed(1) + '%' : '';
  return '<div class="bcard' + (set ? '' : ' unset') + '" data-bid="' + esc(b.id) + '" style="' + st + '">' +
    '<div class="bhead"><span class="bemoji" aria-hidden="true">' + esc(b.emoji || '•') + '</span><span class="bname">' + esc(b.name) + '</span>' +
    (set && !S.readOnly ? '<button class="bclear" data-action="clear-rating" data-bid="' + esc(b.id) + '" aria-label="Clear ' + esc(b.name) + ' rating">Clear</button>' : '') +
    '<span class="bval num">' + (set ? val + '<small>/10</small>' : 'Not rated') + '</span></div>' +
    '<input type="range" class="slider" min="1" max="10" step="1"' + (S.readOnly ? ' disabled' : '') + ' value="' + val + '" id="r_' + esc(b.id) + '" data-rate="' + esc(b.id) + '" aria-label="' + esc(b.name) + ', 1 ' + esc(b.lowLabel) + ' to 10 ' + esc(b.highLabel) + '">' +
    '<div class="blabels"><span>' + esc(b.lowLabel || 'Low') + '</span><span>' + esc(b.highLabel || 'High') + '</span></div></div>';
}

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
  for (const card of $$('.bcard[data-bid]')) {
    const bid = card.dataset.bid, b = S.behaviors[bid];
    if (!b) continue;
    const sl = card.querySelector('.slider');
    if (sl === dragging || sl === document.activeElement && dragging) continue;
    const v = rs[bid];
    const isSet = !card.classList.contains('unset');
    const curV = isSet ? Number(sl.value) : undefined;
    if ((typeof v === 'number') === isSet && (v === undefined || v === curV)) continue;
    const wrap = document.createElement('div'); wrap.innerHTML = behaviorCard(b, v);
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
    updateTodayLive(dog);
  },
  'toggle-tag': (el) => {
    const dog = curDog(); const tg = el.dataset.tag;
    const on = tagsOf(getEntry(dog.id, S.date)).indexOf(tg) < 0;
    const t = {}; t[tg] = on ? Date.now() : false;
    if (!editEntry(dog, S.date, { tags: t })) return;
    el.setAttribute('aria-pressed', String(on));
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
      if (S.view === 'today') { const g = $('#photoGrid'); if (g) g.outerHTML = photoGridHtml(getEntry(dog.id, S.date) || {}); }
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  const dog = curDog();
  if (t.matches && t.matches('.slider[data-rate]')) {
    const bid = t.dataset.rate, v = Number(t.value), b = S.behaviors[bid];
    if (!b || !dog) return;
    const r = {}; r[bid] = v;
    if (!editEntry(dog, S.date, { ratings: r })) { t.value = ratingsOf(getEntry(dog.id, S.date))[bid] || 5; return; }
    const card = t.closest('.bcard');
    const g = (goodness(b, v) - 1) / 9;
    card.style.setProperty('--c', valueColor(g));
    card.style.setProperty('--p', ((v - 1) / 9 * 100).toFixed(1) + '%');
    if (card.classList.contains('unset')) {
      card.classList.remove('unset');
      const bv = card.querySelector('.bval');
      bv.insertAdjacentHTML('beforebegin', '<button class="bclear" data-action="clear-rating" data-bid="' + esc(bid) + '" aria-label="Clear ' + esc(b.name) + ' rating">Clear</button>');
    }
    card.querySelector('.bval').innerHTML = v + '<small>/10</small>';
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
export let unsetTap = null;
document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  unsetTap = t.matches && t.matches('.bcard.unset .slider') ? t : null;
});

document.addEventListener('pointercancel', () => { unsetTap = null; });
document.addEventListener('pointerup', (e) => {
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

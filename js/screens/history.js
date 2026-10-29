// History screen: month calendar (scrapbook style), search, recent pages.
import { imgTag } from '../photos.js';
import { registerActions, registerScreen } from '../registry.js';
import { S, dogEntries, entryScore, getEntry, isLogged, photosOf, scoreWord, tagsOf, timelineDays } from '../state.js';
import { byLine } from '../store.js';
import { render } from '../ui.js';
import { $, I, PAW, diffDays, esc, firstDayOfWeek, fmt, pad, pd, plural, todayStr } from '../util.js';

/* =========================================================
   HISTORY
   ========================================================= */
// Three calendar bands that line up with scoreWord(): good/great -> great, mixed -> okay, rough -> rough.
export function calBand(sc) {
  if (sc == null) return 'none';
  if (sc >= 62) return 'great';
  if (sc >= 40) return 'okay';
  return 'rough';
}
// Short handwritten word for a score: "great", "good", "mixed", "rough".
export function scoreTag(sc) {
  return sc == null ? 'not rated' : scoreWord(sc).replace(/ day$/i, '').toLowerCase();
}

export function renderHistory(dog) {
  const t = todayStr();
  const [y, m] = S.histMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const dim = new Date(y, m, 0).getDate();
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7;
  const monthName = first.toLocaleDateString(undefined, { month: 'long' });
  const sameYear = y === new Date().getFullYear();
  // Days with a log entry, plus days that only have timeline items (moments, activities, training).
  const tl = timelineDays(dog.id);
  const entries = dogEntries(dog.id);
  const seen = new Set(entries.map((e) => e.date));
  const all = entries.concat(Object.keys(tl).filter((d) => !seen.has(d)).map((d) => ({ dogId: dog.id, date: d })))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const isCurMonth = S.histMonth === t.slice(0, 7);

  let h = '<header class="topbar hist-top">';
  if (S.search) h += '<h1>Search</h1><span id="savestate" class="savestate"></span>';
  else {
    h += '<h1 class="hist-month"><span>' + esc(monthName) + '</span>' + (sameYear ? '' : ' <small>' + y + '</small>') + '</h1><span id="savestate" class="savestate"></span>' +
      '<div class="hist-nav"><button class="hist-navbtn" data-action="month" data-d="-1" aria-label="Previous month">' + I.chevL + '</button>' +
      '<button class="hist-navbtn" data-action="month" data-d="1" aria-label="Next month"' + (isCurMonth ? ' disabled' : '') + '>' + I.chevR + '</button></div>';
  }
  h += '</header><div class="stack hist">';
  h += '<div class="search hist-search">' + I.search + '<input class="input" type="search" id="histSearch" placeholder="Search notes, tags, drills" aria-label="Search notes, tags and drills" value="' + esc(S.search) + '" autocomplete="off" enterkeyhint="search">' + (S.search ? '<button class="clear" data-action="clear-search" aria-label="Clear search">' + I.x + '</button>' : '') + '</div>';

  if (!S.search) {
    h += '<section class="hist-cal-card" aria-label="' + esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })) + '"><div class="cal">';
    for (let i = 0; i < 7; i++) {
      const wd = new Date(2024, 0, 7 + ((firstDayOfWeek + i) % 7)); // Jan 7 2024 is a Sunday
      h += '<div class="dow" aria-hidden="true">' + esc(wd.toLocaleDateString(undefined, { weekday: 'narrow' })) + '</div>';
    }
    for (let i = 0; i < lead; i++) h += '<div class="d pad"></div>';
    for (let d = 1; d <= dim; d++) {
      const dstr = y + '-' + pad(m) + '-' + pad(d);
      const e = getEntry(dog.id, dstr);
      const logged = isLogged(e) || !!tl[dstr];
      const sc = logged && e ? entryScore(e) : null;
      const cls = ['d', 'b-' + (logged ? calBand(sc) : 'none')];
      if (!logged) cls.push('empty-day');
      if (dstr > t) cls.push('future');
      if (dstr === t) cls.push('today');
      const label = fmt(dstr, { weekday: 'long', month: 'long', day: 'numeric' }) + (logged ? (sc != null ? ', score ' + sc : ', logged') : ', no log') + (dstr === t ? ', today' : '');
      h += '<button class="' + cls.join(' ') + '" data-action="open-day" data-date="' + dstr + '" aria-label="' + esc(label) + '"' + (dstr > t ? ' tabindex="-1" aria-disabled="true"' : '') + '>' + d + (logged && sc == null ? '<span class="dot"></span>' : '') + '</button>';
    }
    h += '</div><div class="legend" aria-hidden="true"><span><i class="sw b-rough"></i>Rough</span><span><i class="sw b-okay"></i>Okay</span><span><i class="sw b-great"></i>Great</span><span><i class="sw b-none"></i>No log</span></div></section>';
  }

  let list = all;
  const q = S.search.trim().toLowerCase();
  if (q) list = all.filter((e) => (e.notes || '').toLowerCase().indexOf(q) >= 0 || tagsOf(e).some((tg) => tg.toLowerCase().indexOf(q) >= 0) ||
    (tl[e.date] && tl[e.date].text.toLowerCase().indexOf(q) >= 0));
  h += '<section class="hist-pages"><div class="hist-h"><h2>' + (q ? plural(list.length, 'match', 'matches') : 'Recent pages') + '</h2>' + (!q && all.length ? '<span class="aside">' + plural(all.length, 'day') + ' logged</span>' : '') + '</div>';
  if (!list.length) {
    h += '<div class="panel hist-empty">' + (q ? '<div class="empty"><h3>No matches</h3><p>Nothing in your notes, tags or training matches “' + esc(S.search) + '”.</p></div>'
      : '<div class="empty"><div class="art">' + PAW + '</div><h3>No pages yet</h3><p>' + esc(dog.name) + '’s first day will show up here, colored by how it went.</p><button class="btn sm" data-action="goto-today">Log today</button></div>') + '</div>';
  } else {
    h += '<div class="hist-list">' + list.slice(0, S.histLimit).map((e) => entryRow(e, q, tl[e.date])).join('') + '</div>';
    if (list.length > S.histLimit) h += '<div class="hist-more"><button class="btn soft sm" data-action="more-history">Show more</button></div>';
  }
  h += '</section></div>';
  return h;
}
export function highlight(text, q) {
  if (!q) return esc(text);
  const qe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).split(new RegExp('(' + qe + ')', 'ig')).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
}
// Small badges for the day's timeline: "Training · 3 drills", "5 moments", "2 activities".
export function timelineBadges(t) {
  if (!t) return [];
  const out = [];
  if (t.sessions) out.push(t.sessions === 1 ? 'Training' + (t.drills ? ' · ' + plural(t.drills, 'drill') : '') : t.sessions + ' trainings' + (t.drills ? ' · ' + plural(t.drills, 'drill') : ''));
  if (t.moments) out.push(plural(t.moments, 'moment'));
  if (t.activities) out.push(plural(t.activities, 'activity', 'activities'));
  return out;
}
export function entryRow(e, q, tld) {
  const sc = entryScore(e);
  const band = calBand(sc);
  const t = todayStr();
  const dd = diffDays(e.date, t);
  const dl = dd === 0 ? 'Today' : dd === 1 ? 'Yesterday' : fmt(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: pd(e.date).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  let note = (e.notes || '').trim();
  if (q && note.toLowerCase().indexOf(q) < 0 && tld && tld.text.toLowerCase().indexOf(q) >= 0) note = tld.text.split('\n').find((x) => x.toLowerCase().indexOf(q) >= 0) || note;
  if (q && note.toLowerCase().indexOf(q) > 60) { const i = note.toLowerCase().indexOf(q); note = '…' + note.slice(i - 30); }
  const badges = timelineBadges(tld);
  const tags = tagsOf(e).slice(0, 4);
  const ph = photosOf(e);
  const bl = byLine(e);
  const lead = ph.length
    ? '<span class="pg-thumb" aria-hidden="true">' + imgTag(ph[0], '') + (ph.length > 1 ? '<span class="more num">+' + (ph.length - 1) + '</span>' : '') + '</span>'
    : '<span class="pg-score num b-' + band + '" aria-hidden="true">' + (sc == null ? '–' : sc) + '</span>';
  return '<button class="entry pg" data-action="open-day" data-date="' + e.date + '">' + lead +
    '<span class="body"><span class="top"><span class="date">' + esc(dl) + '</span><span class="hand b-' + band + '">' + esc(scoreTag(sc)) + (sc == null ? '' : ' · ' + sc) + '</span></span>' +
    (note ? '<span class="note">' + highlight(note, q) + '</span>' : '') +
    (badges.length ? '<span class="hist-badges">' + badges.map((x) => '<span class="hist-badge">' + esc(x) + '</span>').join('') + '</span>' : '') +
    (tags.length ? '<span class="chips" style="gap:6px">' + tags.map((tg) => '<span class="chip static">' + highlight(tg, q) + '</span>').join('') + '</span>' : '') +
    (!note && !tags.length && !badges.length ? '<span class="note">' + scoreWord(sc) + (ph.length ? ' · ' + plural(ph.length, 'photo') : '') + '</span>' : '') +
    (bl ? '<span class="byline-s">' + esc(bl) + '</span>' : '') + '</span></button>';
}

registerScreen('history', { render: renderHistory });
registerActions({
  'month': (el) => { const [y, m] = S.histMonth.split('-').map(Number); const d = new Date(y, m - 1 + Number(el.dataset.d), 1); const nm = d.getFullYear() + '-' + pad(d.getMonth() + 1); if (nm <= todayStr().slice(0, 7)) { S.histMonth = nm; render(); } },
  'clear-search': () => { S.search = ''; render(); const n = $('#histSearch'); if (n) n.focus(); },
  'more-history': () => { S.histLimit += 30; render(); },
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'histSearch') {
    S.search = t.value;
    const pos = t.selectionStart;
    render();
    const n = $('#histSearch'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* ignore */ } }
  }
});

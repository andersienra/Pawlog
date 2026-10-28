// History screen: search, month calendar heatmap, recent logs.
import { imgTag } from '../photos.js';
import { registerActions, registerScreen } from '../registry.js';
import { S, dogEntries, entryScore, getEntry, heatColor, isLogged, photosOf, scoreWord, tagsOf } from '../state.js';
import { byLine } from '../store.js';
import { render } from '../ui.js';
import { $, I, PAW, diffDays, esc, firstDayOfWeek, fmt, pad, pd, plural, todayStr } from '../util.js';

/* =========================================================
   HISTORY
   ========================================================= */
export function renderHistory(dog) {
  const t = todayStr();
  const [y, m] = S.histMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const dim = new Date(y, m, 0).getDate();
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7;
  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const all = dogEntries(dog.id);
  const isCurMonth = S.histMonth === t.slice(0, 7);

  let h = '<header class="topbar"><h1>History</h1><span id="savestate" class="savestate"></span></header><div class="stack">';
  h += '<div class="search">' + I.search + '<input class="input" type="search" id="histSearch" placeholder="Search notes and tags" value="' + esc(S.search) + '" autocomplete="off" enterkeyhint="search">' + (S.search ? '<button class="clear" data-action="clear-search" aria-label="Clear search">' + I.x + '</button>' : '') + '</div>';

  if (!S.search) {
    h += '<section class="panel"><div class="cal-head"><button class="icon-btn" data-action="month" data-d="-1" aria-label="Previous month">' + I.chevL + '</button><div class="m">' + esc(monthName) + '</div>' +
      '<button class="icon-btn" data-action="month" data-d="1" aria-label="Next month"' + (isCurMonth ? ' disabled style="opacity:.3"' : '') + '>' + I.chevR + '</button></div><div class="cal">';
    for (let i = 0; i < 7; i++) {
      const wd = new Date(2024, 0, 7 + ((firstDayOfWeek + i) % 7)); // Jan 7 2024 is a Sunday
      h += '<div class="dow" aria-hidden="true">' + esc(wd.toLocaleDateString(undefined, { weekday: 'narrow' })) + '</div>';
    }
    for (let i = 0; i < lead; i++) h += '<div class="d pad"></div>';
    for (let d = 1; d <= dim; d++) {
      const dstr = y + '-' + pad(m) + '-' + pad(d);
      const e = getEntry(dog.id, dstr);
      const logged = isLogged(e);
      const sc = logged ? entryScore(e) : null;
      const cls = ['d'];
      if (!logged) cls.push('empty-day');
      if (dstr > t) cls.push('future');
      if (dstr === t) cls.push('today');
      const label = fmt(dstr, { weekday: 'long', month: 'long', day: 'numeric' }) + (logged ? (sc != null ? ', score ' + sc : ', logged') : ', no log');
      h += '<button class="' + cls.join(' ') + '" data-action="open-day" data-date="' + dstr + '" aria-label="' + esc(label) + '"' + (logged ? ' style="background:' + heatColor(sc) + '"' : '') + '>' + d + (logged && sc == null ? '<span class="dot"></span>' : '') + '</button>';
    }
    h += '</div><div class="legend"><span>Rough</span><span class="bar" style="background:linear-gradient(90deg,' + heatColor(0) + ',' + heatColor(50) + ',' + heatColor(100) + ')"></span><span>Great</span></div></section>';
  }

  let list = all;
  const q = S.search.trim().toLowerCase();
  if (q) list = all.filter((e) => (e.notes || '').toLowerCase().indexOf(q) >= 0 || tagsOf(e).some((tg) => tg.toLowerCase().indexOf(q) >= 0));
  h += '<section><div class="group-label"><span>' + (q ? plural(list.length, 'match', 'matches') : 'Recent logs') + '</span>' + (!q && all.length ? '<span class="aside">' + plural(all.length, 'day') + ' logged</span>' : '') + '</div>';
  if (!list.length) {
    h += '<div class="panel">' + (q ? '<div class="empty"><h3>No matches</h3><p>Nothing in your notes or tags matches “' + esc(S.search) + '”.</p></div>'
      : '<div class="empty"><div class="art">' + PAW + '</div><h3>No logs yet</h3><p>Your first day will show up here, colored by how it went.</p><button class="btn sm" data-action="goto-today">Log today</button></div>') + '</div>';
  } else {
    h += '<div class="panel rows">' + list.slice(0, S.histLimit).map((e) => entryRow(e, q)).join('') + '</div>';
    if (list.length > S.histLimit) h += '<div style="text-align:center;margin-top:8px"><button class="btn soft sm" data-action="more-history">Show more</button></div>';
  }
  h += '</section></div>';
  return h;
}
export function highlight(text, q) {
  if (!q) return esc(text);
  const qe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).split(new RegExp('(' + qe + ')', 'ig')).map((part, i) => (i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('');
}
export function entryRow(e, q) {
  const sc = entryScore(e);
  const t = todayStr();
  const dd = diffDays(e.date, t);
  const dl = dd === 0 ? 'Today' : dd === 1 ? 'Yesterday' : fmt(e.date, { weekday: 'short', month: 'short', day: 'numeric', year: pd(e.date).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  let note = (e.notes || '').trim();
  if (q && note.toLowerCase().indexOf(q) > 60) { const i = note.toLowerCase().indexOf(q); note = '…' + note.slice(i - 30); }
  const tags = tagsOf(e).slice(0, 4);
  const ph = photosOf(e).slice(0, 4);
  const bl = byLine(e);
  return '<button class="entry" data-action="open-day" data-date="' + e.date + '"><span class="score num" style="background:' + heatColor(sc) + '">' + (sc == null ? '–' : sc) + '</span><span class="body"><span class="date">' + esc(dl) + '</span>' +
    (note ? '<span class="note">' + highlight(note, q) + '</span>' : '') +
    (tags.length ? '<span class="chips" style="gap:6px">' + tags.map((tg) => '<span class="chip static">' + highlight(tg, q) + '</span>').join('') + '</span>' : '') +
    (ph.length ? '<span class="thumbs">' + ph.map((id) => imgTag(id, '')).join('') + '</span>' : '') +
    (!note && !tags.length && !ph.length ? '<span class="note">' + scoreWord(sc) + '</span>' : '') +
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

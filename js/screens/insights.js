// Insights screen: tiles, wellbeing/weight line charts, consistency, behavior trends, weekday chart, tags.
import { registerActions, registerScreen } from '../registry.js';
import { S, dogBehaviors, dogEntries, entryScore, goodness, ratingsOf, streakFor, tagsOf, valueColor } from '../state.js';
import { render } from '../ui.js';
import { $, $$, addDays, clamp, diffDays, esc, firstDayOfWeek, fmt, pd, plural, round1, todayStr } from '../util.js';

/* =========================================================
   INSIGHTS
   ========================================================= */
export function rangeBounds(dogId, range, entries) {
  const end = todayStr();
  if (range === 'all') {
    const first = entries.length ? entries[entries.length - 1].date : end;
    return { start: first, end: end, days: diffDays(first, end) + 1 };
  }
  const n = Number(range);
  return { start: addDays(end, -(n - 1)), end: end, days: n };
}
export function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

export function renderInsights(dog) {
  const all = dogEntries(dog.id); // desc
  const bs = dogBehaviors(dog.id);
  const R = S.insRange;
  const rb = rangeBounds(dog.id, R, all);
  const inR = all.filter((e) => e.date >= rb.start && e.date <= rb.end).reverse(); // asc
  const prevStart = addDays(rb.start, -rb.days), prevEnd = addDays(rb.start, -1);
  let prev = all.filter((e) => e.date >= prevStart && e.date <= prevEnd);
  let cur = inR;
  let trendLabel = 'vs previous ' + rb.days + ' days';
  if (R === 'all') { const half = Math.floor(inR.length / 2); prev = inR.slice(0, half); cur = inR.slice(half); trendLabel = 'recent half vs earlier half'; }

  const segs = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']];
  let h = '<header class="topbar"><h1>Insights</h1><span id="savestate" class="savestate"></span></header><div class="stack">';
  h += '<div class="seg" role="group" aria-label="Time range">' + segs.map(([v, l]) => '<button data-action="range" data-r="' + v + '" aria-pressed="' + (R === v) + '">' + l + '</button>').join('') + '</div>';

  if (all.length < 2) {
    h += '<div class="panel"><div class="empty"><div class="art">' + chartArt() + '</div><h3>Trends need a few days</h3><p>Log ' + esc(dog.name) + ' for ' + plural(Math.max(1, 2 - all.length), 'more day') + ' and the charts will start to fill in.</p><button class="btn sm" data-action="goto-today">Log today</button></div></div></div>';
    return h;
  }

  // Tiles
  const scored = inR.map((e) => ({ e: e, s: entryScore(e) })).filter((x) => x.s != null);
  const avgScore = avg(scored.map((x) => x.s));
  const prevScored = (R === 'all' ? prev : prev).map(entryScore).filter((x) => x != null);
  const curScored = (R === 'all' ? cur : inR).map(entryScore).filter((x) => x != null);
  const dScore = prevScored.length && curScored.length ? avg(curScored) - avg(prevScored) : null;
  const logged = inR.length;
  const best = scored.slice().sort((a, b) => b.s - a.s || (a.e.date < b.e.date ? 1 : -1))[0];
  const worst = scored.slice().sort((a, b) => a.s - b.s || (a.e.date < b.e.date ? 1 : -1))[0];
  const shortD = (d) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' });

  h += '<div class="tiles">';
  h += '<div class="panel tile"><span class="k">Wellbeing</span><span class="v">' + (avgScore == null ? '–' : Math.round(avgScore)) + '<small>/100</small></span><span class="s">' + trendHtml(dScore, true, 3, ' pts') + '</span></div>';
  h += '<div class="panel tile"><span class="k">Logged</span><span class="v">' + logged + '<small>/' + rb.days + '</small></span><span class="s">' + Math.round(logged / rb.days * 100) + '% of days</span></div>';
  if (best && worst && scored.length > 1) {
    h += '<button class="panel tile" data-action="open-day" data-date="' + best.e.date + '"><span class="k">Best day</span><span class="v" style="color:var(--good)">' + best.s + '</span><span class="s">' + esc(shortD(best.e.date)) + '</span></button>';
    h += '<button class="panel tile" data-action="open-day" data-date="' + worst.e.date + '"><span class="k">Toughest day</span><span class="v" style="color:var(--bad)">' + worst.s + '</span><span class="s">' + esc(shortD(worst.e.date)) + '</span></button>';
  }
  h += '</div>';

  // Wellbeing chart
  if (scored.length >= 2) {
    const pts = scored.map((x) => ({ d: x.e.date, v: x.s }));
    h += '<section class="panel"><div class="chart-title"><span class="t">Wellbeing score</span><span class="s">daily, 0–100</span></div>' +
      lineChart('well', pts, rb, { min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => String(Math.round(v)), color: 'var(--accent)' }) + '</section>';
  } else if (inR.length) {
    h += '<section class="panel"><div class="empty"><h3>Rate a few behaviors</h3><p>The wellbeing score comes from your slider ratings.</p></div></section>';
  }

  // Consistency dots
  if (rb.days <= 120) {
    const set = new Set(inR.map((e) => e.date));
    let dots = '';
    for (let i = 0; i < rb.days; i++) { const d = addDays(rb.start, i); dots += '<i class="' + (set.has(d) ? 'on' : '') + '" title="' + esc(fmt(d, { month: 'short', day: 'numeric' })) + '"></i>'; }
    h += '<section class="panel"><div class="chart-title" style="padding-bottom:12px"><span class="t">Logging consistency</span><span class="s">' + plural(streakFor(dog.id), 'day') + ' streak</span></div><div class="dots" aria-label="' + logged + ' of ' + rb.days + ' days logged">' + dots + '</div></section>';
  }

  // Per-behavior
  h += '<section><div class="group-label"><span>Behaviors</span><span class="aside">' + esc(trendLabel) + '</span></div><div class="panel rows">';
  for (const b of bs) {
    const rv = (e) => ratingsOf(e)[b.id];
    const vals = inR.filter((e) => typeof rv(e) === 'number').map((e) => ({ d: e.date, v: rv(e) }));
    const a = avg(vals.map((x) => x.v));
    const c1 = avg(cur.filter((e) => typeof rv(e) === 'number').map(rv));
    const p1 = avg(prev.filter((e) => typeof rv(e) === 'number').map(rv));
    const delta = c1 != null && p1 != null ? c1 - p1 : null;
    h += '<div class="brow"><span class="nm"><span aria-hidden="true">' + esc(b.emoji) + '</span><span>' + esc(b.name) + '</span></span>' +
      '<span class="avg">' + (a == null ? '<span class="faint">–</span>' : '<b>' + a.toFixed(1) + '</b>') + '<span class="tr ' + trendCls(delta, b.higherIsBetter, 0.3) + '">' + trendArrow(delta, 0.3) + '</span></span>' +
      sparkline(vals, rb, b) + '</div>';
  }
  if (!bs.length) h += '<div class="empty"><p>No behaviors yet.</p></div>';
  h += '</div></section>';

  // Day-of-week
  if (bs.length) {
    if (!S.dowB || !bs.some((b) => b.id === S.dowB)) S.dowB = (bs.find((b) => /mood/i.test(b.name)) || bs[0]).id;
    const b = bs.find((x) => x.id === S.dowB);
    const sums = Array.from({ length: 7 }, () => []);
    for (const e of inR) { const v = ratingsOf(e)[b.id]; if (typeof v === 'number') sums[pd(e.date).getDay()].push(v); }
    h += '<section class="panel"><div class="chart-title"><span class="t">By day of week</span><span class="s">average ' + esc(b.name.toLowerCase()) + '</span></div>' +
      '<div class="hwrap"><div class="hscroll" id="dowScroll">' + bs.map((x) => '<button class="chip" data-action="dow" data-bid="' + esc(x.id) + '" aria-pressed="' + (x.id === S.dowB) + '">' + esc(x.emoji + ' ' + x.name) + '</button>').join('') + '</div></div>' +
      dowChart(sums, b) + '</section>';
  }

  // Tags
  const tc = {};
  for (const e of inR) for (const tg of tagsOf(e)) tc[tg] = (tc[tg] || 0) + 1;
  const top = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  h += '<section class="panel"><div class="chart-title"><span class="t">Most frequent tags</span><span class="s">days tagged</span></div>';
  if (top.length) {
    const mx = top[0][1];
    h += '<div class="tagbars">' + top.map(([tg, n]) => '<div class="tagbar"><div class="lbl"><span>' + esc(tg) + '</span><div class="track"><i style="width:' + (n / mx * 100).toFixed(1) + '%"></i></div></div><span class="c">' + n + '</span></div>').join('') + '</div>';
  } else h += '<p class="small muted" style="padding:10px 16px 16px;margin:0">No tags in this range yet. Tap tags on the Today screen to see patterns here.</p>';
  h += '</section>';

  // Weight
  const wts = inR.filter((e) => typeof e.weight === 'number').map((e) => ({ d: e.date, v: e.weight }));
  if (wts.length >= 1) {
    const unit = dog.weightUnit || 'kg';
    const vs = wts.map((x) => x.v);
    let mn = Math.min.apply(null, vs), mx = Math.max.apply(null, vs);
    const span = Math.max(mx - mn, mx * 0.04, 0.5);
    mn = Math.max(0, mn - span * 0.35); mx = mx + span * 0.35;
    const step = niceStep((mx - mn) / 2);
    mn = Math.floor(mn / step) * step; mx = Math.ceil(mx / step) * step;
    const ticks = []; for (let v = mn; v <= mx + 1e-9; v += step) ticks.push(round1(v));
    const last = wts[wts.length - 1], firstW = wts[0];
    const dW = wts.length > 1 ? round1(last.v - firstW.v) : null;
    h += '<section class="panel"><div class="chart-title"><span class="t">Weight</span><span class="s">' + last.v + ' ' + esc(unit) + (dW != null ? ' · ' + (dW > 0 ? '+' : '') + dW + ' in range' : '') + '</span></div>' +
      (wts.length >= 2 ? lineChart('weight', wts, rb, { min: mn, max: mx, ticks: ticks, fmt: (v) => round1(v) + ' ' + unit, color: 'var(--honey)', tickFmt: (v) => String(round1(v)) }) : '<p class="small muted" style="padding:8px 16px 16px;margin:0">Log weight on another day to see the trend.</p>') + '</section>';
  }
  h += '</div>';
  return h;
}
export function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
export function trendArrow(d, thr) {
  if (d == null) return '';
  if (Math.abs(d) < thr) return '→ steady';
  return (d > 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1);
}
export function trendCls(d, hib, thr) {
  if (d == null || Math.abs(d) < thr) return 'flat';
  return (d > 0) === !!hib ? 'good' : 'bad';
}
export function trendHtml(d, hib, thr, unit) {
  if (d == null) return 'No earlier data to compare';
  if (Math.abs(d) < thr) return '<span class="tr flat">→ Steady</span>';
  return '<span class="tr ' + trendCls(d, hib, thr) + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.round(Math.abs(d)) + (unit || '') + '</span>';
}
export function chartArt() {
  return '<svg viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 64 30 44l14 10 26-30" /><circle cx="70" cy="24" r="5" fill="currentColor"/></svg>';
}

export const CHARTS = {};
export function lineChart(id, pts, rb, o) {
  const W = 340, H = 170, pl = 36, pr = 12, pt = 30, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  const days = Math.max(1, rb.days - 1);
  const X = (d) => pl + (diffDays(rb.start, d) / days) * iw;
  const Y = (v) => pt + ih - ((v - o.min) / (o.max - o.min || 1)) * ih;
  const P = pts.map((p) => ({ x: X(p.d), y: Y(p.v), d: p.d, v: p.v }));
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(id === 'well' ? 'Wellbeing score over time' : 'Weight over time') + '">';
  s += '<defs><linearGradient id="g_' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.color + '" stop-opacity=".22"/><stop offset="1" stop-color="' + o.color + '" stop-opacity="0"/></linearGradient></defs>';
  for (const tv of o.ticks) {
    const y = Y(tv).toFixed(1);
    s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"' + (tv === o.ticks[0] ? '' : ' stroke-dasharray="3 4"') + '/>';
    s += '<text x="' + (pl - 8) + '" y="' + y + '" dy="4" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="var(--font-body)">' + esc(o.tickFmt ? o.tickFmt(tv) : String(tv)) + '</text>';
  }
  const xl = [rb.start, rb.end];
  if (rb.days > 6) xl.splice(1, 0, addDays(rb.start, Math.round((rb.days - 1) / 2)));
  xl.forEach((d, i) => {
    s += '<text x="' + X(d).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === xl.length - 1 ? 'end' : 'middle') + '" font-size="11" fill="var(--ink-3)" font-family="var(--font-body)">' + esc(fmt(d, { month: 'short', day: 'numeric' })) + '</text>';
  });
  const line = P.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const base = (pt + ih).toFixed(1);
  s += '<path d="' + line + ' L' + P[P.length - 1].x.toFixed(1) + ' ' + base + ' L' + P[0].x.toFixed(1) + ' ' + base + ' Z" fill="url(#g_' + id + ')"/>';
  s += '<path d="' + line + '" fill="none" stroke="' + o.color + '" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>';
  if (P.length <= 31) P.forEach((p) => { s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.6" fill="' + o.color + '"/>'; });
  const L = P[P.length - 1];
  s += '<circle cx="' + L.x.toFixed(1) + '" cy="' + L.y.toFixed(1) + '" r="5" fill="' + o.color + '" stroke="var(--surface)" stroke-width="2.5"/>';
  s += '<text x="' + Math.min(L.x, W - pr).toFixed(1) + '" y="' + (L.y - 11).toFixed(1) + '" text-anchor="end" font-size="12" font-weight="700" fill="var(--ink)" font-family="var(--font-body)">' + esc(o.fmt(L.v)) + '</text>';
  s += '<g class="hover" opacity="0"><line x1="0" x2="0" y1="' + pt + '" y2="' + base + '" stroke="var(--ink-3)" stroke-width="1"/><circle r="5.5" fill="' + o.color + '" stroke="var(--surface)" stroke-width="2.5"/></g>';
  s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent" class="hit"/></svg>';
  CHARTS[id] = { P: P, W: W, fmt: o.fmt };
  return '<div class="chart" data-chart="' + id + '">' + s + '<div class="tip"></div></div>';
}
export function bindChart(el) {
  const c = CHARTS[el.getAttribute('data-chart')];
  if (!c) return;
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), tip = el.querySelector('.tip');
  const ln = g.querySelector('line'), dot = g.querySelector('circle');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * c.W;
    let best = c.P[0], bd = Infinity;
    for (const p of c.P) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } }
    g.setAttribute('opacity', '1');
    ln.setAttribute('x1', best.x); ln.setAttribute('x2', best.x);
    dot.setAttribute('cx', best.x); dot.setAttribute('cy', best.y);
    tip.textContent = fmt(best.d, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + c.fmt(best.v);
    const px = best.x / c.W * r.width + (svg.getBoundingClientRect().left - el.getBoundingClientRect().left);
    const half = tip.offsetWidth / 2 + 4;
    tip.style.left = clamp(px, half, el.clientWidth - half) + 'px';
    tip.classList.add('on');
  };
  const leave = () => { g.setAttribute('opacity', '0'); tip.classList.remove('on'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointercancel', leave);
}
export function sparkline(vals, rb, b) {
  const W = 84, H = 30, p = 3;
  if (vals.length < 2) return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="84" height="30" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '" stroke="var(--line)" stroke-dasharray="2 3"/></svg>';
  const days = Math.max(1, rb.days - 1);
  const X = (d) => p + diffDays(rb.start, d) / days * (W - 2 * p);
  const Y = (v) => H - p - (v - 1) / 9 * (H - 2 * p);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + X(v.d).toFixed(1) + ' ' + Y(v.v).toFixed(1)).join(' ');
  const L = vals[vals.length - 1];
  const col = valueColor((goodness(b, L.v) - 1) / 9);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="84" height="30" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + Y(5.5).toFixed(1) + '" y2="' + Y(5.5).toFixed(1) + '" stroke="var(--line)" stroke-dasharray="2 3"/><path d="' + d + '" fill="none" stroke="var(--ink-2)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + X(L.d).toFixed(1) + '" cy="' + Y(L.v).toFixed(1) + '" r="3.5" fill="' + col + '" stroke="var(--surface)" stroke-width="1.5"/></svg>';
}
export function dowChart(sums, b) {
  const W = 340, H = 150, pt = 22, pb = 24, pl = 8, pr = 8;
  const ih = H - pt - pb, colW = (W - pl - pr) / 7, bw = Math.min(30, colW - 12);
  let s = '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average ' + esc(b.name) + ' by weekday">';
  s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (pt + ih) + '" y2="' + (pt + ih) + '" stroke="var(--line)"/>';
  for (let i = 0; i < 7; i++) {
    const wd = (firstDayOfWeek + i) % 7;
    const a = avg(sums[wd]);
    const cx = pl + colW * i + colW / 2;
    const label = new Date(2024, 0, 7 + wd).toLocaleDateString(undefined, { weekday: 'short' });
    if (a != null) {
      const bh = Math.max(4, (a / 10) * ih);
      const y = pt + ih - bh;
      const col = valueColor((goodness(b, a) - 1) / 9);
      s += '<path d="M' + (cx - bw / 2) + ' ' + (pt + ih) + ' V' + (y + 4) + ' q0 -4 4 -4 h' + (bw - 8) + ' q4 0 4 4 V' + (pt + ih) + ' Z" fill="' + col + '"><title>' + esc(label + ': ' + a.toFixed(1) + ' (' + plural(sums[wd].length, 'day') + ')') + '</title></path>';
      s += '<text x="' + cx + '" y="' + (y - 6) + '" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)" font-family="var(--font-body)">' + a.toFixed(1) + '</text>';
    } else {
      s += '<text x="' + cx + '" y="' + (pt + ih - 6) + '" text-anchor="middle" font-size="12" fill="var(--ink-3)" font-family="var(--font-body)">–</text>';
    }
    s += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--ink-3)" font-family="var(--font-body)">' + esc(label) + '</text>';
  }
  return s + '</svg></div>';
}

export let dowScrollX = 0;
export function bindHScroll() {
  const sc = $('#dowScroll');
  if (!sc) return;
  const wrap = sc.parentElement;
  const upd = () => { wrap.classList.toggle('at-end', sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4); dowScrollX = sc.scrollLeft; };
  sc.scrollLeft = dowScrollX;
  const sel = sc.querySelector('[aria-pressed="true"]');
  if (sel && (sel.offsetLeft + sel.offsetWidth > sc.scrollLeft + sc.clientWidth || sel.offsetLeft < sc.scrollLeft)) sc.scrollLeft = sel.offsetLeft - 16;
  sc.addEventListener('scroll', upd, { passive: true });
  upd();
}

registerScreen('insights', {
  render: renderInsights,
  afterRender() { bindHScroll(); $$('.chart[data-chart]').forEach(bindChart); }
});

registerActions({
  'range': (el) => { S.insRange = el.dataset.r; render(); },
  'dow': (el) => { S.dowB = el.dataset.bid; const y = window.scrollY; render(); window.scrollTo(0, y); },
});

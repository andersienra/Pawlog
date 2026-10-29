// Insights screen: tiles, wellbeing/weight line charts, consistency, behavior trends, weekday chart, tags,
// plus "through the day" (moments by hour + activity strip), "what changes it" (before/after activities)
// and training (sessions, drills, needs practice). The number crunching lives in ../analytics.js.
import { registerActions, registerScreen } from '../registry.js';
import * as ST from '../state.js';
import { S, dogBehaviors, dogEntries, entryScore, ratingsOf, streakFor, tagsOf } from '../state.js';
import * as AN from '../analytics.js';
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

// Behavior colors cycle --b1..--b6 by the behavior's position in the dog's list (same as Today).
const B_FALLBACK = ['#D9480F', '#7048E8', '#0C8599', '#2F9E44', '#C2255C', '#E67700'];
export function bColor(i) { const n = (((i % 6) + 6) % 6) + 1; return 'var(--b' + n + ', ' + B_FALLBACK[n - 1] + ')'; }

// Handwritten comparison note for the hero card.
export function heroNote(d, R, days) {
  const vs = R === 'all' ? 'vs earlier days' : 'vs the ' + days + ' days before';
  if (d == null) return { hand: 'just getting started', sub: 'Keep logging to see the trend' };
  const n = Math.round(Math.abs(d));
  if (Math.abs(d) < 3) return { hand: 'holding steady', sub: 'Within ' + 3 + ' points ' + vs };
  return d > 0 ? { hand: 'up ' + n + (n >= 8 ? '! great stretch' : '!'), sub: 'Up ' + n + ' points ' + vs }
    : { hand: 'down ' + n + ', hang in there', sub: 'Down ' + n + ' points ' + vs };
}
// Short handwritten trend for a behavior card. Arrow follows the value; the word follows good/bad.
export function bTrend(d, hib, thr) {
  if (d == null) return { t: '', cls: 'flat' };
  if (Math.abs(d) < thr) return { t: '→ steady', cls: 'flat' };
  const good = (d > 0) === !!hib;
  const arrow = d > 0 ? '↑ ' : '↓ ';
  const word = good ? (Math.abs(d) >= 1 ? 'nice!' : 'a bit better') : (Math.abs(d) >= 1 ? 'hmm' : 'a bit worse');
  return { t: arrow + Math.abs(d).toFixed(1) + ' ' + word, cls: good ? 'good' : 'bad' };
}

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
  let h = '<header class="topbar ins-top"><h1>How ' + esc(dog.name) + '’s doing</h1><span id="savestate" class="savestate"></span></header><div class="stack ins">';
  h += '<div class="ins-seg" role="group" aria-label="Time range">' + segs.map(([v, l]) => '<button data-action="range" data-r="' + v + '" aria-pressed="' + (R === v) + '">' + l + '</button>').join('') + '</div>';

  const xb = extraBounds(dog.id, R, rb);
  const extra = () => renderThroughDay(dog, xb) + renderTraining(dog, xb);
  if (all.length < 2) {
    h += '<div class="ins-card"><div class="empty"><div class="art">' + chartArt() + '</div><h3>Trends need a few days</h3><p>Log ' + esc(dog.name) + ' for ' + plural(Math.max(1, 2 - all.length), 'more day') + ' and the charts will start to fill in.</p><button class="btn sm" data-action="goto-today">Log today</button></div></div>';
    if (xb.any) h += extra();
    return h + '</div>';
  }

  // Hero: average day + trend
  const scored = inR.map((e) => ({ e: e, s: entryScore(e) })).filter((x) => x.s != null);
  const avgScore = avg(scored.map((x) => x.s));
  const prevScored = prev.map(entryScore).filter((x) => x != null);
  const curScored = (R === 'all' ? cur : inR).map(entryScore).filter((x) => x != null);
  const dScore = prevScored.length && curScored.length ? avg(curScored) - avg(prevScored) : null;
  const logged = inR.length;
  const best = scored.slice().sort((a, b) => b.s - a.s || (a.e.date < b.e.date ? 1 : -1))[0];
  const worst = scored.slice().sort((a, b) => a.s - b.s || (a.e.date < b.e.date ? 1 : -1))[0];
  const shortD = (d) => fmt(d, { weekday: 'short', month: 'short', day: 'numeric' });
  const note = heroNote(dScore, R, rb.days);

  h += '<section class="ins-hero" aria-label="Average day">';
  h += '<div class="hrow"><span class="k">Average day</span><span class="hand">' + esc(note.hand) + '</span></div>';
  h += '<div class="big num">' + (avgScore == null ? '–' : Math.round(avgScore)) + '<small>/100</small></div>';
  h += '<div class="sub">' + esc(note.sub) + '</div>';
  if (scored.length >= 2) {
    const pts = scored.map((x) => ({ d: x.e.date, v: x.s }));
    h += lineChart('well', pts, rb, { min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => String(Math.round(v)), color: 'var(--hero-ink, #2B1B0E)', text: 'color-mix(in oklab, var(--hero-ink, #2B1B0E) 78%, var(--hero, #FFD25A))', grid: 'color-mix(in oklab, var(--hero-ink, #2B1B0E) 28%, transparent)', halo: 'var(--hero, #FFD25A)', label: 'Day score over time' });
  } else if (inR.length) {
    h += '<p class="hero-empty">Rate a few behaviors and the day score trend will draw here.</p>';
  }
  h += '</section>';

  // Small tiles
  h += '<div class="ins-tiles">';
  h += '<div class="ins-tile"><span class="k">Logged</span><span class="v num">' + logged + '<small>/' + rb.days + '</small></span><span class="s">' + Math.round(logged / rb.days * 100) + '% of days</span></div>';
  if (best && worst && scored.length > 1) {
    h += '<button class="ins-tile" data-action="open-day" data-date="' + best.e.date + '" aria-label="Best day, score ' + best.s + ', ' + esc(shortD(best.e.date)) + '"><span class="k">Best day</span><span class="v num good">' + best.s + '</span><span class="s">' + esc(shortD(best.e.date)) + '</span></button>';
    h += '<button class="ins-tile" data-action="open-day" data-date="' + worst.e.date + '" aria-label="Toughest day, score ' + worst.s + ', ' + esc(shortD(worst.e.date)) + '"><span class="k">Toughest</span><span class="v num bad">' + worst.s + '</span><span class="s">' + esc(shortD(worst.e.date)) + '</span></button>';
  }
  h += '</div>';

  // Per-behavior stat cards
  h += '<section><div class="ins-h"><h2>Behaviors</h2><span class="aside">' + esc(trendLabel) + '</span></div>';
  if (bs.length) {
    h += '<div class="ins-bgrid">';
    bs.forEach((b, i) => {
      const rv = (e) => ratingsOf(e)[b.id];
      const vals = inR.filter((e) => typeof rv(e) === 'number').map((e) => ({ d: e.date, v: rv(e) }));
      const a = avg(vals.map((x) => x.v));
      const c1 = avg(cur.filter((e) => typeof rv(e) === 'number').map(rv));
      const p1 = avg(prev.filter((e) => typeof rv(e) === 'number').map(rv));
      const delta = c1 != null && p1 != null ? c1 - p1 : null;
      const tr = bTrend(delta, b.higherIsBetter, 0.3);
      const pct = a == null ? 0 : clamp(a / 10 * 100, 0, 100);
      h += '<div class="bstat" style="--c:' + bColor(i) + '">' +
        '<span class="nm"><span aria-hidden="true">' + esc(b.emoji || '') + '</span><span>' + esc(b.name) + '</span></span>' +
        '<span class="avgrow"><span class="avg num">' + (a == null ? '–' : a.toFixed(1)) + '</span>' + (tr.t ? '<span class="hand ' + tr.cls + '">' + esc(tr.t) + '</span>' : '') + '</span>' +
        '<span class="bar" role="img" aria-label="' + esc(b.name) + ' average ' + (a == null ? 'not rated' : a.toFixed(1) + ' of 10') + '"><i style="width:' + pct.toFixed(1) + '%"></i></span>' +
        sparkline(vals, rb, b) + '</div>';
    });
    h += '</div>';
  } else h += '<div class="ins-card"><div class="empty"><p>No behaviors yet.</p></div></div>';
  h += '</section>';

  h += extra();

  // Tags as colored pills
  const tc = {};
  for (const e of inR) for (const tg of tagsOf(e)) tc[tg] = (tc[tg] || 0) + 1;
  const top = Object.entries(tc).sort((a, b) => b[1] - a[1]).slice(0, 8);
  h += '<section class="ins-card"><div class="chart-title"><span class="t">Most logged</span><span class="s">days tagged</span></div>';
  if (top.length) {
    h += '<ul class="ins-pills">' + top.map(([tg, n], i) => '<li class="pill' + (i < 3 ? ' hot' : '') + '" style="--c:' + bColor(i) + '"><span class="tg">' + esc(tg) + '</span><span class="n num">· ' + n + '</span></li>').join('') + '</ul>';
  } else h += '<p class="small muted ins-note">No tags in this range yet. Tap tags on the Today screen to see patterns here.</p>';
  h += '</section>';

  // Day-of-week
  if (bs.length) {
    if (!S.dowB || !bs.some((b) => b.id === S.dowB)) S.dowB = (bs.find((b) => /mood/i.test(b.name)) || bs[0]).id;
    const bi = bs.findIndex((x) => x.id === S.dowB);
    const b = bs[bi];
    const sums = Array.from({ length: 7 }, () => []);
    for (const e of inR) { const v = ratingsOf(e)[b.id]; if (typeof v === 'number') sums[pd(e.date).getDay()].push(v); }
    h += '<section class="ins-card"><div class="chart-title"><span class="t">By day of week</span><span class="s">average ' + esc(b.name.toLowerCase()) + '</span></div>' +
      '<div class="hwrap"><div class="hscroll" id="dowScroll">' + bs.map((x, i) => '<button class="chip" data-action="dow" data-bid="' + esc(x.id) + '" aria-pressed="' + (x.id === S.dowB) + '" style="--c:' + bColor(i) + '"><i class="sw" aria-hidden="true"></i>' + esc((x.emoji ? x.emoji + ' ' : '') + x.name) + '</button>').join('') + '</div></div>' +
      dowChart(sums, b, bColor(bi)) + '</section>';
  }

  // Consistency dots
  if (rb.days <= 120) {
    const set = new Set(inR.map((e) => e.date));
    let dots = '';
    for (let i = 0; i < rb.days; i++) { const d = addDays(rb.start, i); dots += '<i class="' + (set.has(d) ? 'on' : '') + '" title="' + esc(fmt(d, { month: 'short', day: 'numeric' })) + '"></i>'; }
    h += '<section class="ins-card"><div class="chart-title"><span class="t">Logging consistency</span><span class="s">' + plural(streakFor(dog.id), 'day') + ' streak</span></div><div class="dots" role="img" aria-label="' + logged + ' of ' + rb.days + ' days logged">' + dots + '</div></section>';
  }

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
    h += '<section class="ins-card"><div class="chart-title"><span class="t">Weight</span><span class="s">' + last.v + ' ' + esc(unit) + (dW != null ? ' · ' + (dW > 0 ? '+' : '') + dW + ' in range' : '') + '</span></div>' +
      (wts.length >= 2 ? lineChart('weight', wts, rb, { min: mn, max: mx, ticks: ticks, fmt: (v) => round1(v) + ' ' + unit, color: 'var(--ink)', dot: bColor(2), tickFmt: (v) => String(round1(v)), label: 'Weight over time' }) : '<p class="small muted ins-note">Log weight on another day to see the trend.</p>') + '</section>';
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
  const txt = o.text || 'var(--ink-2)', grid = o.grid || 'var(--line)', halo = o.halo || 'var(--surface)', dotC = o.dot || o.color;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || (id === 'well' ? 'Wellbeing score over time' : 'Weight over time')) + '">';
  s += '<defs><linearGradient id="g_' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + o.color + '" stop-opacity=".14"/><stop offset="1" stop-color="' + o.color + '" stop-opacity="0"/></linearGradient></defs>';
  for (const tv of o.ticks) {
    const y = Y(tv).toFixed(1);
    s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="' + grid + '" stroke-width="' + (tv === o.ticks[0] ? 2 : 1) + '"' + (tv === o.ticks[0] ? '' : ' stroke-dasharray="3 5"') + '/>';
    s += '<text x="' + (pl - 8) + '" y="' + y + '" dy="4" text-anchor="end" font-size="11" font-weight="600" fill="' + txt + '" font-family="var(--font-body)">' + esc(o.tickFmt ? o.tickFmt(tv) : String(tv)) + '</text>';
  }
  const xl = [rb.start, rb.end];
  if (rb.days > 6) xl.splice(1, 0, addDays(rb.start, Math.round((rb.days - 1) / 2)));
  xl.forEach((d, i) => {
    s += '<text x="' + X(d).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === xl.length - 1 ? 'end' : 'middle') + '" font-size="11" font-weight="600" fill="' + txt + '" font-family="var(--font-body)">' + esc(fmt(d, { month: 'short', day: 'numeric' })) + '</text>';
  });
  const line = P.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const base = (pt + ih).toFixed(1);
  s += '<path d="' + line + ' L' + P[P.length - 1].x.toFixed(1) + ' ' + base + ' L' + P[0].x.toFixed(1) + ' ' + base + ' Z" fill="url(#g_' + id + ')"/>';
  s += '<path d="' + line + '" fill="none" stroke="' + o.color + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>';
  if (P.length <= 31) P.forEach((p) => { s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="' + dotC + '" stroke="' + o.color + '" stroke-width="' + (dotC === o.color ? 0 : 1.5) + '"/>'; });
  const L = P[P.length - 1];
  s += '<circle cx="' + L.x.toFixed(1) + '" cy="' + L.y.toFixed(1) + '" r="6" fill="' + dotC + '" stroke="' + (dotC === o.color ? halo : o.color) + '" stroke-width="2.5"/>';
  s += '<text x="' + Math.min(L.x, W - pr).toFixed(1) + '" y="' + (L.y - 12).toFixed(1) + '" text-anchor="end" font-size="13" font-weight="800" fill="' + o.color + '" font-family="var(--font-body)">' + esc(o.fmt(L.v)) + '</text>';
  s += '<g class="hover" opacity="0"><line x1="0" x2="0" y1="' + pt + '" y2="' + base + '" stroke="' + o.color + '" stroke-width="1.5" stroke-dasharray="3 3"/><circle r="6.5" fill="' + dotC + '" stroke="' + (dotC === o.color ? halo : o.color) + '" stroke-width="2.5"/></g>';
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
  const W = 140, H = 30, p = 4;
  if (vals.length < 2) return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '" stroke="var(--line)" stroke-width="2" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/></svg>';
  const days = Math.max(1, rb.days - 1);
  const X = (d) => p + diffDays(rb.start, d) / days * (W - 2 * p);
  const Y = (v) => H - p - (v - 1) / 9 * (H - 2 * p);
  const d = vals.map((v, i) => (i ? 'L' : 'M') + X(v.d).toFixed(1) + ' ' + Y(v.v).toFixed(1)).join(' ');
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + Y(5.5).toFixed(1) + '" y2="' + Y(5.5).toFixed(1) + '" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/><path d="' + d + '" fill="none" stroke="var(--c, var(--ink-2))" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
}
export function dowChart(sums, b, color) {
  const W = 340, H = 156, pt = 24, pb = 26, pl = 8, pr = 8;
  const ih = H - pt - pb, colW = (W - pl - pr) / 7, bw = Math.min(30, colW - 12);
  const fill = color || 'var(--accent)';
  let s = '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average ' + esc(b.name) + ' by weekday">';
  for (let i = 0; i < 7; i++) {
    const wd = (firstDayOfWeek + i) % 7;
    const a = avg(sums[wd]);
    const cx = pl + colW * i + colW / 2;
    const label = new Date(2024, 0, 7 + wd).toLocaleDateString(undefined, { weekday: 'short' });
    if (a != null) {
      const bh = Math.max(6, (a / 10) * ih);
      const y = pt + ih - bh;
      s += '<path d="M' + (cx - bw / 2) + ' ' + (pt + ih) + ' V' + (y + 6) + ' q0 -6 6 -6 h' + (bw - 12) + ' q6 0 6 6 V' + (pt + ih) + ' Z" fill="' + fill + '" stroke="var(--border, var(--ink))" stroke-width="2.5" stroke-linejoin="round"><title>' + esc(label + ': ' + a.toFixed(1) + ' (' + plural(sums[wd].length, 'day') + ')') + '</title></path>';
      s += '<text x="' + cx + '" y="' + (y - 7) + '" text-anchor="middle" font-size="12" font-weight="800" fill="var(--ink)" font-family="var(--font-body)">' + a.toFixed(1) + '</text>';
    } else {
      s += '<text x="' + cx + '" y="' + (pt + ih - 6) + '" text-anchor="middle" font-size="12" fill="var(--ink-3)" font-family="var(--font-body)">–</text>';
    }
    s += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink-2)" font-family="var(--font-body)">' + esc(label) + '</text>';
  }
  s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (pt + ih) + '" y2="' + (pt + ih) + '" stroke="var(--border, var(--ink))" stroke-width="2.5" stroke-linecap="round"/>';
  return s + '</svg></div>';
}

export const hScrollX = {};
export function bindHScroll(id) {
  id = id || 'dowScroll';
  const sc = $('#' + id);
  if (!sc) return;
  const wrap = sc.parentElement;
  const upd = () => { wrap.classList.toggle('at-end', sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 4); hScrollX[id] = sc.scrollLeft; };
  sc.scrollLeft = hScrollX[id] || 0;
  const sel = sc.querySelector('[aria-pressed="true"]');
  if (sel && (sel.offsetLeft + sel.offsetWidth > sc.scrollLeft + sc.clientWidth || sel.offsetLeft < sc.scrollLeft)) sc.scrollLeft = sel.offsetLeft - 16;
  sc.addEventListener('scroll', upd, { passive: true });
  upd();
}

/* =========================================================
   Through the day / What changes it / Training
   Data comes from the state.js helpers (momentsFor, activitiesFor, trainingFor, drillsFor) when they
   exist; otherwise straight from S.moments / S.activities / S.training / S.drills (same shapes).
   ========================================================= */
const listOf = (col, dogId) => {
  const c = S[col];
  return c && typeof c === 'object' ? Object.values(c).filter((x) => x && x.dogId === dogId) : [];
};
export function momentsOf(dogId) { return typeof ST.momentsFor === 'function' ? ST.momentsFor(dogId) || [] : listOf('moments', dogId); }
export function trainingOf(dogId) { return typeof ST.trainingFor === 'function' ? ST.trainingFor(dogId) || [] : listOf('training', dogId); }
// Activities plus training sessions (as type 'training'), like state.js activitiesFor().
export function activitiesOf(dogId) {
  if (typeof ST.activitiesFor === 'function') return ST.activitiesFor(dogId) || [];
  return listOf('activities', dogId).concat(trainingOf(dogId).map((t) => Object.assign({}, t, { type: 'training', trainingId: t.id })));
}
export function drillsOf(dogId) {
  if (typeof ST.drillsFor === 'function') return ST.drillsFor(dogId, { includeArchived: true }) || [];
  return listOf('drills', dogId);
}

// Activity wording. Labels come from ACTIVITY_TYPES when it has one; "after ___" phrases are ours.
const ACT_FALLBACK = { walk: 'Walk', meal: 'Meal', play: 'Play', nap: 'Nap', daycare: 'Daycare', car: 'Car ride', visitors: 'Visitors', bath: 'Bath', training: 'Training', other: 'Other' };
const ACT_AFTER = { walk: 'walks', meal: 'meals', play: 'play', nap: 'naps', daycare: 'daycare', car: 'car rides', visitors: 'visitors', bath: 'baths', training: 'training', other: 'other activities' };
export function actLabel(type) {
  const T = ST.ACTIVITY_TYPES;
  let v = null;
  if (Array.isArray(T)) v = T.find((x) => x && (x.key === type || x.id === type || x.type === type));
  else if (T && typeof T === 'object') v = T[type];
  const l = v && (typeof v === 'string' ? v : v.label);
  return l || ACT_FALLBACK[type] || String(type || 'Other');
}
const actAfter = (type) => ACT_AFTER[type] || actLabel(type).toLowerCase();

// Range bounds for the new cards. 'all' starts at the earliest entry, moment, activity or session.
export function extraBounds(dogId, R, rb) {
  const ms = momentsOf(dogId), as = activitiesOf(dogId), ts = trainingOf(dogId);
  const any = ms.length > 0 || as.length > 0 || ts.length > 0;
  let start = rb.start;
  if (R === 'all') for (const x of ms.concat(as)) if (x && AN.isDateStr(x.date) && x.date < start) start = x.date;
  return { start: start, end: rb.end, days: AN.dayDiff(start, rb.end) + 1, any: any, ms: ms, as: as, ts: ts };
}

const MIN_MOMENTS = 5;
export function renderThroughDay(dog, xb) {
  const all = dogBehaviors(dog.id, true);
  const active = dogBehaviors(dog.id);
  const inR = AN.inRange(xb.ms, xb.start, xb.end);
  const counts = {};
  for (const m of inR) counts[m.behaviorId] = (counts[m.behaviorId] || 0) + 1;
  const withData = all.filter((b) => counts[b.id]);
  const colorOf = (b) => { const i = active.findIndex((x) => x.id === b.id); return bColor(i >= 0 ? i : all.indexOf(b)); };
  const name = esc(dog.name);
  let h = '<section class="ins-card ins-day" aria-labelledby="dayTitle"><div class="chart-title"><h2 class="t" id="dayTitle">' + name + ' through the day</h2></div>';
  if (!withData.length) {
    h += '<div class="empty ins-empty"><div class="art">' + clockArt() + '</div><h3>When is ' + name + ' most wired?</h3><p>' +
      (xb.ms.length ? 'No moments logged in this range. ' : '') + 'Log a few moments through the day on Today with <b>+ Moment</b>, e.g. energy after a walk or before dinner. After ' + MIN_MOMENTS + ' readings, the daily rhythm shows up here.</p>' +
      '<button class="btn sm" data-action="goto-today">Log a moment</button></div></section>';
    return h;
  }
  if (!S.dayB || !withData.some((b) => b.id === S.dayB)) S.dayB = (withData.find((b) => /energ/i.test(b.name)) || withData.slice().sort((a, b) => counts[b.id] - counts[a.id])[0]).id;
  const b = withData.find((x) => x.id === S.dayB);
  const color = colorOf(b);
  if (withData.length > 1) {
    h += '<div class="hwrap"><div class="hscroll" id="dayScroll" role="group" aria-label="Behavior">' + withData.map((x) => '<button class="chip" data-action="ins-dayb" data-bid="' + esc(x.id) + '" aria-pressed="' + (x.id === b.id) + '" style="--c:' + colorOf(x) + '"><i class="sw" aria-hidden="true"></i>' + esc((x.emoji ? x.emoji + ' ' : '') + x.name) + '</button>').join('') + '</div></div>';
  }
  const prof = AN.hourlyProfile(inR, b.id);
  if (prof.total < MIN_MOMENTS) {
    h += '<div class="empty ins-empty sm"><h3>A few more moments</h3><p>' + plural(prof.total, b.name.toLowerCase() + ' reading') + ' so far in this range. Log ' + (MIN_MOMENTS - prof.total) + ' more at different times of day and ' + name + '’s rhythm will draw here.</p>' +
      '<button class="btn sm" data-action="goto-today">Log a moment</button></div></section>';
    return h;
  }
  const win = AN.peakWindows(prof);
  const energy = /energ/i.test(b.name);
  let hand, sub;
  if (!win.peak) { hand = 'still finding the pattern'; sub = 'Readings are spread thin. Keep logging at different times'; }
  else if (win.flat) { hand = 'pretty even all day'; sub = esc(b.name) + ' stays within a point through the day'; }
  else {
    hand = (energy ? 'Most energetic around ' : esc(b.name) + ' highest around ') + AN.fmtWindow(win.peak.start, win.peak.end);
    sub = (energy ? 'Calmest around ' : 'Lowest around ') + AN.fmtWindow(win.calm.start, win.calm.end) + ' (' + win.peak.mean.toFixed(1) + ' vs ' + win.calm.mean.toFixed(1) + ')';
  }
  h += '<div class="ins-dhead"><p class="hand">' + esc(hand) + '</p><p class="sub">' + sub + ' · ' + plural(prof.total, 'moment') + '</p></div>';
  const strip = AN.activityStrip(xb.as, { from: xb.start, to: xb.end }).slice(0, 6);
  h += dayChart(prof, win, strip, b, color);
  h += '</section>';
  h += renderEffects(dog, xb, b, inR);
  return h;
}

export const HCHART = {};
export function dayChart(prof, win, strip, b, color) {
  const dataHours = prof.hours.map((x) => x.h);
  for (const r of strip) r.hours.forEach((c, hh) => { if (c) dataHours.push(hh); });
  const dom = AN.hourDomain(dataHours);
  const span = dom.end - dom.start;
  const W = 340, pl = 64, pr = 10, pt = 24, ih = 112, axisH = 24, rowH = 22;
  const iw = W - pl - pr, cell = iw / span;
  const H = pt + ih + axisH + (strip.length ? 8 + strip.length * rowH : 0) + 4;
  const XB = (hh) => pl + (hh - dom.start) * cell;           // hour boundary
  const XC = (hh) => XB(hh) + cell / 2;                       // hour bucket center
  const Y = (v) => pt + ih - (v / 10) * ih;
  const winTxt = (w) => AN.fmtWindow(w.start, w.end) + ' (' + w.mean.toFixed(1) + ')';
  let label = 'Average ' + b.name + ' by hour of day from ' + plural(prof.total, 'moment') + '. ';
  if (win.peak && !win.flat) label += 'Highest around ' + winTxt(win.peak) + ', lowest around ' + winTxt(win.calm) + '. ';
  else if (win.peak) label += 'Fairly even through the day. ';
  if (strip.length) label += 'Usual times: ' + strip.map((r) => actLabel(r.type) + ' around ' + AN.fmtHour(r.peakHour)).join(', ') + '.';
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">';
  // peak / low bands
  if (win.peak && !win.flat) {
    const band = (w, cls, txt) => '<rect class="' + cls + '" x="' + XB(Math.max(w.start, dom.start)).toFixed(1) + '" y="' + pt + '" width="' + ((Math.min(w.end, dom.end) - Math.max(w.start, dom.start)) * cell).toFixed(1) + '" height="' + ih + '" rx="5"/>' +
      '<text x="' + ((XB(Math.max(w.start, dom.start)) + XB(Math.min(w.end, dom.end))) / 2).toFixed(1) + '" y="' + (pt - 7) + '" text-anchor="middle" font-size="11" font-weight="800" fill="var(--ink-2)" font-family="var(--font-body)">' + txt + '</text>';
    s += band(win.peak, 'band-hi', 'high') + band(win.calm, 'band-lo', 'low');
  }
  // y grid
  [0, 5, 10].forEach((tv) => {
    const y = Y(tv).toFixed(1);
    s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="' + (tv ? 'var(--line)' : 'var(--border)') + '" stroke-width="' + (tv ? 1 : 2) + '"' + (tv ? ' stroke-dasharray="3 5"' : '') + '/>';
    s += '<text x="' + (pl - 8) + '" y="' + y + '" dy="4" text-anchor="end" font-size="11" font-weight="600" fill="var(--ink-2)" font-family="var(--font-body)">' + tv + '</text>';
  });
  // x axis labels every 3 hours
  const ay = pt + ih + 17;
  for (let hh = Math.ceil(dom.start / 3) * 3; hh <= dom.end; hh += 3) {
    const x = XB(hh);
    s += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (pt + ih) + '" y2="' + (pt + ih + 4) + '" stroke="var(--border)" stroke-width="1.5"/>';
    s += '<text x="' + x.toFixed(1) + '" y="' + ay + '" text-anchor="' + (hh === dom.start ? 'start' : hh === dom.end ? 'end' : 'middle') + '" font-size="11" font-weight="700" fill="var(--ink-2)" font-family="var(--font-body)">' + AN.axisHour(hh) + '</text>';
  }
  // smoothed line, broken across gaps of more than 2 hours
  let d = '', prev = null;
  for (const p of prof.hours) {
    d += (prev == null || p.h - prev > 2 ? 'M' : 'L') + XC(p.h).toFixed(1) + ' ' + Y(p.smooth).toFixed(1) + ' ';
    prev = p.h;
  }
  s += '<path d="' + d.trim() + '" fill="none" stroke="' + color + '" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>';
  // raw hourly means, sized/faded by sample count
  const P = [];
  for (const p of prof.hours) {
    const k = p.n / (prof.maxN || 1);
    const r = 2.5 + 4 * Math.sqrt(k);
    const cx = XC(p.h), cy = Y(p.mean);
    s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + color + '" fill-opacity="' + (0.3 + 0.7 * k).toFixed(2) + '" stroke="var(--border)" stroke-width="1.5"/>';
    P.push({ x: cx, y: cy, h: p.h, n: p.n, v: p.mean, sm: p.smooth });
  }
  // activity strip
  if (strip.length) {
    const top = pt + ih + axisH + 8;
    strip.forEach((r, i) => {
      const y = top + i * rowH;
      const mx = Math.max.apply(null, r.hours);
      s += '<text x="0" y="' + (y + 14) + '" font-size="11" font-weight="700" fill="var(--ink-2)" font-family="var(--font-body)">' + esc(actLabel(r.type)) + '</text>';
      s += '<rect x="' + pl + '" y="' + (y + 3) + '" width="' + iw + '" height="14" rx="5" fill="var(--surface-2)"/>';
      for (let hh = dom.start; hh < dom.end; hh++) {
        const c = r.hours[hh]; if (!c) continue;
        s += '<rect x="' + (XB(hh) + 1.5).toFixed(1) + '" y="' + (y + 3) + '" width="' + Math.max(2, cell - 3).toFixed(1) + '" height="14" rx="4" fill="var(--ink)" fill-opacity="' + (0.18 + 0.82 * c / mx).toFixed(2) + '"><title>' + esc(actLabel(r.type) + ' at ' + AN.fmtHour(hh) + ': ' + plural(c, 'time')) + '</title></rect>';
      }
    });
  }
  s += '<g class="hover" opacity="0"><line x1="0" x2="0" y1="' + pt + '" y2="' + (pt + ih) + '" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 3"/></g>';
  s += '<rect x="0" y="0" width="' + W + '" height="' + (pt + ih + axisH) + '" fill="transparent" class="hit"/></svg>';
  HCHART.day = { P: P, W: W, name: b.name };
  return '<div class="chart day-chart" data-hchart="day">' + s + '<div class="tip"></div></div>';
}
export function bindHourChart(el) {
  const c = HCHART[el.getAttribute('data-hchart')];
  if (!c || !c.P.length) return;
  const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), tip = el.querySelector('.tip'), ln = g.querySelector('line');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * c.W;
    let best = c.P[0], bd = Infinity;
    for (const p of c.P) { const dd = Math.abs(p.x - x); if (dd < bd) { bd = dd; best = p; } }
    g.setAttribute('opacity', '1'); ln.setAttribute('x1', best.x); ln.setAttribute('x2', best.x);
    tip.textContent = AN.fmtHour(best.h) + ' · ' + best.v.toFixed(1) + ' avg · ' + plural(best.n, 'reading');
    const px = best.x / c.W * r.width + (r.left - el.getBoundingClientRect().left);
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

export function renderEffects(dog, xb, b, momentsInRange) {
  const res = AN.activityEffects(momentsInRange, xb.as, b.id, { from: xb.start, to: xb.end, higherIsBetter: !!b.higherIsBetter });
  const bn = b.name.toLowerCase();
  let h = '<section class="ins-card ins-fx" aria-labelledby="fxTitle"><div class="chart-title"><h2 class="t" id="fxTitle">What changes it</h2><span class="s">' + esc(bn) + ', 2 h before vs after</span></div>';
  if (!res.rows.length) {
    h += '<div class="fx-none"><p class="fx-nh">Not enough data yet</p><p>Log ' + esc(bn) + ' shortly before and after walks, meals or training (same day, within 2 hours). Once an activity has 3 before-and-after pairs, it shows up here.</p>';
    if (res.candidates.length) h += '<ul class="fx-cand">' + res.candidates.slice(0, 3).map((c) => '<li><span>' + esc(actLabel(c.type)) + '</span><span class="num">' + c.n + ' of 3 pairs</span></li>').join('') + '</ul>';
    return h + '</div></section>';
  }
  h += '<ul class="fx-rows">';
  for (const r of res.rows.slice(0, 8)) {
    const cls = r.better == null ? 'flat' : r.better ? 'good' : 'bad';
    const arrow = r.dir === 'up' ? '↑' : r.dir === 'down' ? '↓' : '→';
    const val = r.dir === 'flat' ? 'about the same' : arrow + ' ' + Math.abs(r.delta).toFixed(1);
    const word = r.dir === 'flat' ? 'no clear change' : (r.dir === 'up' ? 'higher' : 'lower') + ', ' + (r.better ? 'better' : 'worse');
    const pct = clamp(Math.abs(r.delta) / 4 * 50, r.dir === 'flat' ? 0 : 3, 50);
    h += '<li class="fx-row ' + cls + '"><div class="fx-top"><span class="fx-l">After ' + esc(actAfter(r.type)) + '</span><span class="fx-v"><span class="vh">' + esc(b.name) + ' </span><span class="fx-bn" aria-hidden="true">' + esc(bn) + ' </span><b>' + val + '</b><span class="vh"> (' + word + ')</span></span></div>' +
      '<div class="fx-bar" aria-hidden="true"><i class="' + (r.delta < 0 ? 'neg' : 'pos') + '" style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="fx-sub num">' + r.before.toFixed(1) + ' before → ' + r.after.toFixed(1) + ' after · ' + plural(r.n, 'time') + '</div></li>';
  }
  h += '</ul><p class="fx-foot">Average change in ' + esc(dog.name) + '’s ' + esc(bn) + ' within 2 hours, same day. Moments tagged with an activity count as “after”.</p></section>';
  return h;
}

const RESULT_TXT = AN.RESULT_WORDS;
function dotMeter(v) {
  let s = '<span class="itmeter r' + (v || 0) + '" role="img" aria-label="Latest: ' + esc(v ? RESULT_TXT[v].toLowerCase() : 'no result') + '">';
  for (let i = 1; i <= 3; i++) s += '<i class="' + (v && i <= v ? 'on' : '') + '"></i>';
  return s + '</span>';
}
function weekBars(weeks) {
  const ws = weeks.slice(-26);
  const W = 140, H = 34, gap = 2;
  const mx = Math.max(1, Math.max.apply(null, ws));
  const bw = Math.max(2, (W - gap * (ws.length - 1)) / ws.length);
  let s = '<svg class="wkbars" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Sessions per week, oldest to newest: ' + ws.join(', ') + '">';
  ws.forEach((n, i) => {
    const x = i * (bw + gap), bh = n ? Math.max(4, n / mx * (H - 4)) : 2;
    s += '<rect x="' + x.toFixed(1) + '" y="' + (H - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + (n ? 'var(--ink)' : 'var(--line)') + '"/>';
  });
  return s + '</svg>';
}
export function renderTraining(dog, xb) {
  const name = esc(dog.name);
  const lib = drillsOf(dog.id);
  const sum = AN.trainingSummary(xb.ts, lib, { from: xb.start, to: xb.end, today: todayStr() });
  let h = '<section class="ins-card ins-train" aria-labelledby="trTitle"><div class="chart-title"><h2 class="t" id="trTitle">Training</h2>' + (sum.sessions ? '<span class="s">' + plural(sum.drills.length, 'drill') + ' practiced</span>' : '') + '</div>';
  if (!sum.sessions && !sum.needsPractice.length) {
    h += '<div class="empty ins-empty"><div class="art">' + capArt() + '</div><h3>No training logged' + (xb.ts.length ? ' in this range' : ' yet') + '</h3><p>Add a session from Today with <b>+ Training</b>: pick the drills you worked on and how ' + name + ' did. Progress per drill shows up here.</p>' +
      '<button class="btn sm" data-action="goto-today">Log training</button></div></section>';
    return h;
  }
  const perWeek = sum.sessions / Math.max(1, xb.days / 7);
  h += '<div class="itr-tiles"><div class="itr-stat"><span class="v num">' + sum.sessions + '</span><span class="k">' + (sum.sessions === 1 ? 'session' : 'sessions') + '</span></div>' +
    '<div class="itr-stat"><span class="v num">' + sum.minutes + '</span><span class="k">minutes</span></div>' +
    '<div class="itr-stat wk"><span class="k">' + (perWeek >= 0.95 ? round1(perWeek) + ' a week' : 'per week') + '</span>' + weekBars(sum.weeks) + '</div></div>';
  if (sum.drills.length) {
    h += '<ul class="itr-drills">';
    for (const r of sum.drills.slice(0, 10)) {
      const tr = r.trend === 'up' ? '<span class="itrd good">↑ improving</span>' : r.trend === 'down' ? '<span class="itrd bad">↓ slipping</span>' : r.trend === 'flat' ? '<span class="itrd flat">→ steady</span>' : '';
      h += '<li class="itr-drill"><div class="itr-top"><span class="itr-nm">' + esc(r.name) + '</span>' + dotMeter(r.latest) + '</div>' +
        '<div class="itr-sub">' + plural(r.count, 'time') + (r.nailedRate != null ? ' · ' + Math.round(r.nailedRate * 100) + '% nailed it' : '') + (tr ? ' · ' + tr : '') + '</div></li>';
    }
    h += '</ul>';
    if (sum.drills.length > 10) h += '<p class="itr-more">+ ' + plural(sum.drills.length - 10, 'more drill') + '</p>';
  } else h += '<p class="itr-more">No sessions in this range.</p>';
  if (sum.needsPractice.length) {
    h += '<div class="itr-needs"><h3 class="itr-h">Needs practice</h3><ul>' + sum.needsPractice.slice(0, 5).map((n) => '<li><span class="itr-nm">' + esc(n.name) + '</span><span class="itr-why">' +
      (n.reason === 'struggling' ? 'Struggled ' + n.struggled + ' of last ' + n.of : 'Last practiced ' + plural(n.daysSince, 'day') + ' ago') + '</span></li>').join('') + '</ul></div>';
  }
  if (sum.notes.length) {
    h += '<div class="itr-notes"><h3 class="itr-h">Recent notes</h3>' + sum.notes.map((n) => '<button class="itr-note" data-action="open-day" data-date="' + esc(n.date) + '" aria-label="Open ' + esc(fmt(n.date, { weekday: 'long', month: 'long', day: 'numeric' })) + ': ' + esc(n.text.slice(0, 80)) + '">' +
      '<span class="when">' + esc(fmt(n.date, { weekday: 'short', month: 'short', day: 'numeric' })) + (n.focus ? ' · ' + esc(n.focus) : '') + '</span><span class="txt">' + esc(n.text) + '</span></button>').join('') + '</div>';
  }
  return h + '</section>';
}
function clockArt() {
  return '<svg viewBox="0 0 84 84" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="42" cy="42" r="30"/><path d="M42 24v18l12 8"/></svg>';
}
function capArt() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>';
}

registerScreen('insights', {
  render: renderInsights,
  afterRender() { bindHScroll(); bindHScroll('dayScroll'); $$('.chart[data-chart]').forEach(bindChart); $$('.chart[data-hchart]').forEach(bindHourChart); }
});

registerActions({
  'range': (el) => { S.insRange = el.dataset.r; render(); },
  'dow': (el) => { S.dowB = el.dataset.bid; const y = window.scrollY; render(); window.scrollTo(0, y); },
  'ins-dayb': (el) => { S.dayB = el.dataset.bid; const y = window.scrollY; render(); window.scrollTo(0, y); },
});

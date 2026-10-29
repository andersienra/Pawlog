// Pure analytics for the Insights "through the day", "what changes it" and "training" cards.
// No DOM, no imports: every function takes plain arrays/objects and returns plain data, so it runs
// (and is unit-tested) in Node as well as the browser. Dates are local 'YYYY-MM-DD', times 'HH:MM'.

/* ---------- small date/time helpers (local wall-clock, no time zones involved) ---------- */
const pad2 = (n) => String(n).padStart(2, '0');
const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmtDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
export const shiftDate = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
// 'HH:MM' -> minutes since midnight, or null when missing/invalid.
export function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t == null ? '' : t));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const num = (v) => typeof v === 'number' && isFinite(v);

// Keep items whose `date` is within [from, to] (inclusive; either bound may be omitted).
export function inRange(items, from, to) {
  return (items || []).filter((x) => x && isDateStr(x.date) && (!from || x.date >= from) && (!to || x.date <= to));
}
// Sort key for date + time (items without a valid time sort to the start of their day).
const stampOf = (x) => x.date + ' ' + pad2(Math.floor((toMin(x.time) || 0) / 60)) + ':' + pad2((toMin(x.time) || 0) % 60);

/* =========================================================
   1. Through the day: hourly profile of one behavior
   ========================================================= */
// Smoothing kernel over adjacent hours, applied to sums and counts (so it is sample-weighted):
// smooth[h] = (0.5*S[h-1] + S[h] + 0.5*S[h+1]) / (0.5*N[h-1] + N[h] + 0.5*N[h+1]).
export const SMOOTH_W = 0.5;

/**
 * hourlyProfile(moments, behaviorId, {from, to})
 * -> { total, hours: [{ h, n, mean, smooth }] (only hours with data, ascending), maxN }
 */
export function hourlyProfile(moments, behaviorId, opt) {
  const o = opt || {};
  const S = new Array(24).fill(0), N = new Array(24).fill(0);
  for (const m of inRange(moments, o.from, o.to)) {
    if (m.behaviorId !== behaviorId || !num(m.value)) continue;
    const t = toMin(m.time); if (t == null) continue;
    const h = Math.floor(t / 60);
    S[h] += m.value; N[h]++;
  }
  const hours = [];
  let total = 0, maxN = 0;
  for (let h = 0; h < 24; h++) {
    if (!N[h]) continue;
    total += N[h]; maxN = Math.max(maxN, N[h]);
    let ss = S[h], nn = N[h];
    if (h > 0) { ss += SMOOTH_W * S[h - 1]; nn += SMOOTH_W * N[h - 1]; }
    if (h < 23) { ss += SMOOTH_W * S[h + 1]; nn += SMOOTH_W * N[h + 1]; }
    hours.push({ h: h, n: N[h], sum: S[h], mean: S[h] / N[h], smooth: ss / nn });
  }
  return { total: total, hours: hours, maxN: maxN };
}

/**
 * peakWindows(profile, {width = 2, minN = 3, minSpread = 1})
 * Slides a `width`-hour window over the day and pools samples inside it (sum / count).
 * peak = highest pooled mean, calm = lowest pooled mean among windows that don't overlap the peak.
 * Ties: more samples first, then earlier. Windows need >= minN samples.
 * flat = true when peak - calm < minSpread (the behavior is fairly even through the day).
 * -> { peak: {start, end, mean, n} | null, calm: same | null, spread, flat }
 */
export function peakWindows(profile, opt) {
  const o = Object.assign({ width: 2, minN: 3, minSpread: 1 }, opt || {});
  const S = new Array(24).fill(0), N = new Array(24).fill(0);
  for (const x of (profile && profile.hours) || []) { S[x.h] = x.sum != null ? x.sum : x.mean * x.n; N[x.h] = x.n; }
  const wins = [];
  for (let s = 0; s + o.width <= 24; s++) {
    let ss = 0, nn = 0;
    for (let k = 0; k < o.width; k++) { ss += S[s + k]; nn += N[s + k]; }
    if (nn >= o.minN) wins.push({ start: s, end: s + o.width, mean: ss / nn, n: nn });
  }
  if (!wins.length) return { peak: null, calm: null, spread: null, flat: true };
  const better = (a, b, dir) => (a.mean !== b.mean ? (dir > 0 ? a.mean > b.mean : a.mean < b.mean) : a.n !== b.n ? a.n > b.n : a.start < b.start);
  let peak = wins[0];
  for (const w of wins) if (better(w, peak, 1)) peak = w;
  let calm = null;
  for (const w of wins) {
    if (w.start < peak.end && peak.start < w.end) continue; // overlaps the peak
    if (!calm || better(w, calm, -1)) calm = w;
  }
  const spread = calm ? peak.mean - calm.mean : null;
  return { peak: peak, calm: calm, spread: spread, flat: spread == null || spread < o.minSpread };
}

// Hour (0..24) -> '5 pm' parts; window -> '5–7 pm', '11 am–1 pm', '12–2 pm'.
function hourParts(h) { h = ((h % 24) + 24) % 24; return { n: h % 12 === 0 ? 12 : h % 12, ap: h < 12 ? 'am' : 'pm' }; }
export function fmtHour(h) { const p = hourParts(h); return p.n + ' ' + p.ap; }
export function fmtWindow(start, end) {
  const a = hourParts(start), b = hourParts(end);
  return a.ap === b.ap ? a.n + '–' + b.n + ' ' + b.ap : a.n + ' ' + a.ap + '–' + b.n + ' ' + b.ap;
}
// Short axis label: 6a, 12p, 9p.
export function axisHour(h) { const p = hourParts(h); return p.n + p.ap[0]; }

/**
 * hourDomain(hoursWithData[], {lo = 6, hi = 23})
 * x axis range in whole hours [start, end): default 6am–11pm, widened to fit any data outside it.
 */
export function hourDomain(hours, opt) {
  const o = Object.assign({ lo: 6, hi: 23 }, opt || {});
  let a = o.lo, b = o.hi;
  for (const h of hours || []) { if (h < a) a = h; if (h + 1 > b) b = h + 1; }
  return { start: a, end: Math.min(24, b) };
}

/**
 * activityStrip(activities, {from, to})
 * When things usually happen: per type, counts by hour of day.
 * -> [{ type, total, hours: number[24], peakHour }] sorted by total desc (then type).
 */
export function activityStrip(activities, opt) {
  const o = opt || {};
  const by = {};
  for (const a of inRange(activities, o.from, o.to)) {
    const t = toMin(a.time); if (t == null || !a.type) continue;
    const r = by[a.type] || (by[a.type] = { type: a.type, total: 0, hours: new Array(24).fill(0) });
    r.hours[Math.floor(t / 60)]++; r.total++;
  }
  return Object.values(by).map((r) => {
    let p = 0; for (let h = 1; h < 24; h++) if (r.hours[h] > r.hours[p]) p = h;
    r.peakHour = p; return r;
  }).sort((a, b) => b.total - a.total || (a.type < b.type ? -1 : 1));
}

/* =========================================================
   2. What changes it: before/after an activity
   ========================================================= */
/**
 * activityEffects(moments, activities, behaviorId, {from, to, higherIsBetter, windowMin = 120,
 *                 minOccurrences = 3, minPairs = 3, flatThreshold = 0.3})
 *
 * Occurrences of a type = its activity docs in range, plus "virtual" occurrences from moments tagged
 * activity = type (at the moment's time) unless a real occurrence of that type on the same day already
 * covers the moment (within windowMin before it).
 * For every occurrence at time t on day d:
 *   before = this behavior's moments on day d with t - windowMin <= time < t
 *   after  = this behavior's moments on day d with t <= time <= t + windowMin
 * It is a paired sample only when both sides have at least one moment; its delta is
 * mean(after) - mean(before). Types need >= minOccurrences occurrences and >= minPairs pairs.
 * -> { rows: [{ type, occurrences, n, delta, before, after, dir: 'up'|'down'|'flat', better: bool|null }],
 *      candidates: [{ type, occurrences, n }]  (types with enough occurrences but too few pairs) }
 * rows sorted by |delta| desc.
 */
export function activityEffects(moments, activities, behaviorId, opt) {
  const o = Object.assign({ windowMin: 120, minOccurrences: 3, minPairs: 3, flatThreshold: 0.3, higherIsBetter: true }, opt || {});
  const ms = inRange(moments, o.from, o.to).filter((m) => m.behaviorId === behaviorId && num(m.value) && toMin(m.time) != null);
  const byDay = {};
  for (const m of ms) (byDay[m.date] || (byDay[m.date] = [])).push({ t: toMin(m.time), v: m.value });
  const occ = {}; // type -> [{date, t}]
  for (const a of inRange(activities, o.from, o.to)) {
    const t = toMin(a.time); if (t == null || !a.type) continue;
    (occ[a.type] || (occ[a.type] = [])).push({ date: a.date, t: t });
  }
  // Tagged moments (any behavior) become occurrences when no real one already covers them.
  const tagged = inRange(moments, o.from, o.to).filter((m) => m.activity && toMin(m.time) != null);
  const virt = {};
  for (const m of tagged) {
    const t = toMin(m.time);
    const real = (occ[m.activity] || []).some((x) => x.date === m.date && x.t <= t && t - x.t <= o.windowMin);
    if (real) continue;
    const list = virt[m.activity] || (virt[m.activity] = []);
    if (!list.some((x) => x.date === m.date && x.t === t)) list.push({ date: m.date, t: t }); // one per time slot
  }
  for (const k in virt) occ[k] = (occ[k] || []).concat(virt[k]);

  const rows = [], candidates = [];
  for (const type in occ) {
    const list = occ[type];
    if (list.length < o.minOccurrences) continue;
    const deltas = [], befores = [], afters = [];
    for (const x of list) {
      const day = byDay[x.date] || [];
      const b = day.filter((m) => m.t < x.t && m.t >= x.t - o.windowMin).map((m) => m.v);
      const a = day.filter((m) => m.t >= x.t && m.t <= x.t + o.windowMin).map((m) => m.v);
      if (!b.length || !a.length) continue;
      const mb = mean(b), ma = mean(a);
      befores.push(mb); afters.push(ma); deltas.push(ma - mb);
    }
    if (deltas.length < o.minPairs) { candidates.push({ type: type, occurrences: list.length, n: deltas.length }); continue; }
    const d = mean(deltas);
    const dir = Math.abs(d) < o.flatThreshold ? 'flat' : d > 0 ? 'up' : 'down';
    rows.push({ type: type, occurrences: list.length, n: deltas.length, delta: d, before: mean(befores), after: mean(afters), dir: dir,
      better: dir === 'flat' ? null : (d > 0) === !!o.higherIsBetter });
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.n - a.n || (a.type < b.type ? -1 : 1));
  candidates.sort((a, b) => b.occurrences - a.occurrences || (a.type < b.type ? -1 : 1));
  return { rows: rows, candidates: candidates };
}

/* =========================================================
   3. Training
   ========================================================= */
export const RESULT_WORDS = { 1: 'Struggled', 2: 'Getting there', 3: 'Nailed it' };

/**
 * trainingSummary(sessions, drills, {from, to, today, staleDays = 14, trendThreshold = 0.25})
 *   sessions: training docs (all of them; range applies inside), drills: drill docs (array or map)
 * -> {
 *   sessions, minutes, weeks: number[] (sessions per 7-day bucket, oldest first, last bucket ends at `to`),
 *   drills: [{ id, name, category, count, latest: 1|2|3|null, latestDate, trend: 'up'|'down'|'flat'|null,
 *              trendDelta, nailedRate, lastDate, daysSince }] sorted by count desc then name,
 *   needsPractice: [{ id, name, reason: 'stale'|'struggling', daysSince, struggled, of }],
 *   notes: [{ id, date, time, text, focus }] (last 3 sessions in range with notes, newest first)
 * }
 * Trend: mean result in the second half of the range minus the first half (range split at its midpoint
 * date); needs results in both halves. 'stale' = practiced before but not in the last staleDays days
 * (not archived). 'struggling' = at least 2 of the drill's last 3 practices were "struggled".
 */
export function trainingSummary(sessions, drills, opt) {
  const o = Object.assign({ staleDays: 14, trendThreshold: 0.25 }, opt || {});
  const today = o.today || o.to;
  const lib = {};
  for (const d of Array.isArray(drills) ? drills : Object.values(drills || {})) if (d && d.id) lib[d.id] = d;
  const all = (sessions || []).filter((s) => s && isDateStr(s.date)).slice().sort((a, b) => (stampOf(a) < stampOf(b) ? -1 : stampOf(a) > stampOf(b) ? 1 : 0));
  const inR = inRange(all, o.from, o.to);
  const from = o.from || (inR[0] && inR[0].date) || today;
  const to = o.to || today;
  const days = Math.max(1, dayDiff(from, to) + 1);
  const nW = Math.ceil(days / 7);
  const weeks = new Array(nW).fill(0);
  let minutes = 0;
  for (const s of inR) {
    if (num(s.durationMin)) minutes += s.durationMin;
    const k = nW - 1 - Math.floor(dayDiff(s.date, to) / 7);
    if (k >= 0 && k < nW) weeks[k]++;
  }
  const mid = shiftDate(from, Math.floor(days / 2));
  const per = {};
  const ensure = (id) => per[id] || (per[id] = { id: id, inR: [], all: [] });
  for (const s of all) {
    const dm = s.drills && typeof s.drills === 'object' ? s.drills : {};
    for (const id in dm) {
      const r = dm[id];
      if (!r || typeof r !== 'object') continue; // null = drill removed from the session
      const rec = { date: s.date, result: [1, 2, 3].includes(r.result) ? r.result : null };
      ensure(id).all.push(rec);
      if ((!o.from || s.date >= o.from) && (!o.to || s.date <= o.to)) per[id].inR.push(rec);
    }
  }
  const nameOf = (id) => (lib[id] && lib[id].name) || 'Removed drill';
  const rows = [];
  for (const id in per) {
    const p = per[id];
    if (!p.inR.length) continue;
    const res = p.inR.filter((x) => x.result != null);
    const latestRec = res[res.length - 1] || null;
    const h1 = res.filter((x) => x.date < mid).map((x) => x.result), h2 = res.filter((x) => x.date >= mid).map((x) => x.result);
    const td = h1.length && h2.length ? mean(h2) - mean(h1) : null;
    const last = p.all[p.all.length - 1];
    rows.push({ id: id, name: nameOf(id), category: (lib[id] && lib[id].category) || '', count: p.inR.length,
      latest: latestRec ? latestRec.result : null, latestDate: latestRec ? latestRec.date : null,
      trend: td == null ? null : Math.abs(td) < o.trendThreshold ? 'flat' : td > 0 ? 'up' : 'down', trendDelta: td,
      nailedRate: res.length ? res.filter((x) => x.result === 3).length / res.length : null,
      lastDate: last.date, daysSince: dayDiff(last.date, today) });
  }
  rows.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const needs = [];
  for (const id in per) {
    if (lib[id] && lib[id].archived) continue;
    if (!lib[id]) continue; // removed from the library
    const p = per[id];
    const last = p.all[p.all.length - 1];
    const since = dayDiff(last.date, today);
    const recent = p.all.filter((x) => x.result != null).slice(-3);
    const struggled = recent.filter((x) => x.result === 1).length;
    if (struggled >= 2) needs.push({ id: id, name: nameOf(id), reason: 'struggling', daysSince: since, struggled: struggled, of: recent.length });
    else if (since >= o.staleDays) needs.push({ id: id, name: nameOf(id), reason: 'stale', daysSince: since, struggled: struggled, of: recent.length });
  }
  needs.sort((a, b) => (a.reason !== b.reason ? (a.reason === 'struggling' ? -1 : 1) : b.daysSince - a.daysSince || (a.name < b.name ? -1 : 1)));
  const notes = inR.filter((s) => s.notes && String(s.notes).trim()).slice(-3).reverse()
    .map((s) => ({ id: s.id, date: s.date, time: s.time || '', text: String(s.notes).trim(), focus: s.focus || '' }));
  return { sessions: inR.length, minutes: minutes, weeks: weeks, drills: rows, needsPractice: needs, notes: notes };
}

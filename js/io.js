// Export (JSON backup, CSV) and import.
import { photoFullSrc, photoSrc } from './photos.js';
import { registerActions } from './registry.js';
import { S, entryScore, isLogged, normalizeEntry, photosOf, ratingsOf, saveQuickTags, setActiveDog, settings, sortedDogs, tagsOf } from './state.js';
import { ROOT, Store, flushPending, localSave, withRetry } from './store.js';
import { confirmDialog, copyText, openSheet, render, toast } from './ui.js';
import { I, clone, esc, hasClaude, plural, todayStr } from './util.js';

/* =========================================================
   Export / import
   ========================================================= */
export async function exportObj() {
  // Include full-size photos; in shared mode fetch any not loaded yet.
  const full = {};
  for (const id of Object.keys(S.photos)) {
    const d = S.photoFull[id] || (S.mode === 'db' ? await photoFullSrc(id) : '');
    if (d && d !== photoSrc(id)) full[id] = d;
  }
  return { app: 'pawlog', version: 2, exportedAt: new Date().toISOString(), dogs: S.dogs, behaviors: S.behaviors, entries: S.entries, events: S.events, photos: S.photos, photoFull: full, settings: { app: { quickTags: settings().quickTags } } };
}
export function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function exportCsv() {
  const names = [];
  for (const b of Object.values(S.behaviors).sort((a, c) => (a.order || 0) - (c.order || 0))) if (b && names.indexOf(b.name) < 0) names.push(b.name);
  const head = ['date', 'dog'].concat(names, ['wellbeing_score', 'walk_minutes', 'weight', 'weight_unit', 'meals', 'tags', 'notes', 'photo_count']);
  const rows = [head.map(csvCell).join(',')];
  const es = Object.values(S.entries).filter(isLogged).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of es) {
    const dog = S.dogs[e.dogId];
    const byName = {};
    for (const [bid, v] of Object.entries(ratingsOf(e))) { const b = S.behaviors[bid]; if (b) byName[b.name] = v; }
    rows.push([e.date, dog ? dog.name : ''].concat(names.map((n) => byName[n]), [entryScore(e), e.walkMinutes, e.weight, dog ? dog.weightUnit : '', e.meals, tagsOf(e).join('; '), e.notes, photosOf(e).length]).map(csvCell).join(','));
  }
  return rows.join('\r\n');
}
export async function saveFile(filename, text, mime) {
  if (hasClaude()) {
    let dl = null;
    try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: filename, data: text }); toast('Saved ' + filename); return; }
      catch (e) {
        const c = e && e.code;
        if (c === 'declined') return;
        if (c === 'rate_limited') { toast('A save prompt is already open.'); return; }
        if (c === 'too_large') { toast('The file is too large to save here.', true); return; }
      }
    }
    showTextExport(filename, text);
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Downloaded ' + filename);
  } catch (e) { showTextExport(filename, text); }
}
export let exportText = '';
export function showTextExport(filename, text) {
  exportText = text;
  openSheet(filename, '<p class="small muted" style="margin:0 0 10px">Saving files isn’t available here. Copy the text and paste it into a note or file.</p><textarea class="input" id="exportBox" readonly style="font-family:ui-monospace,Menlo,monospace;font-size:12px;min-height:220px">' + esc(text.length > 200000 ? text.slice(0, 200000) + '\n…' : text) + '</textarea><button class="btn block" style="margin-top:12px" data-action="copy-export">' + I.copy + 'Copy all</button>');
}
export async function importJson(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn't valid JSON.", true); return; }
  if (!data || data.app !== 'pawlog' || typeof data.dogs !== 'object') { toast("That doesn't look like a Pawlog backup.", true); return; }
  const nd = Object.keys(data.dogs || {}).length, ne = Object.keys(data.entries || {}).length;
  const ch = await confirmDialog({ title: 'Import backup?', body: plural(nd, 'dog') + ' and ' + plural(ne, 'log entry', 'log entries') + '. Matching records are replaced; everything else is kept.', ok: 'Import' });
  if (ch !== 1) return;
  let n = 0;
  const okId = (id) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(id);
  const fullSrc = (data.photoFull && typeof data.photoFull === 'object') ? data.photoFull : {};
  // Photos first, so entries never point at missing images.
  for (const [id, v] of Object.entries(data.photos || {})) {
    if (!v || typeof v !== 'object' || !okId(id)) continue;
    const thumbSrc = typeof v.thumb === 'string' ? v.thumb : (typeof v.d === 'string' ? v.d : '');
    if (!/^data:image\//.test(thumbSrc)) continue;
    const big = typeof fullSrc[id] === 'string' && /^data:image\//.test(fullSrc[id]) ? fullSrc[id] : (typeof v.d === 'string' ? v.d : '');
    const meta = { dogId: v.dogId || null, date: v.date || null, thumb: thumbSrc, createdAt: Number(v.createdAt) || Date.now(), createdBy: v.createdBy || S.me || null };
    if (big && big !== thumbSrc) {
      S.photoFull[id] = big;
      if (S.mode === 'db') { try { await withRetry(() => ROOT.collection('photofull').doc(id).set({ dataUrl: big, dogId: meta.dogId, createdAt: meta.createdAt })); } catch (e) { /* thumb still shows */ } }
      else localSave('photoFull');
    }
    Store.put('photos', id, meta); n++;
  }
  for (const col of ['dogs', 'behaviors', 'entries', 'events']) {
    const src = data[col];
    if (!src || typeof src !== 'object') continue;
    for (const [id, v] of Object.entries(src)) {
      if (!v || typeof v !== 'object' || !okId(id)) continue;
      Store.put(col, id, col === 'entries' ? normalizeEntry(clone(v)) : clone(v)); n++;
    }
  }
  const qt = data.settings && data.settings.app && Array.isArray(data.settings.app.quickTags) ? data.settings.app.quickTags.filter((x) => typeof x === 'string').slice(0, 60) : null;
  if (qt) saveQuickTags(qt);
  if (!S.dogs[settings().activeDogId] && sortedDogs()[0]) setActiveDog(sortedDogs()[0].id);
  toast('Imported ' + plural(n, 'record'));
  render();
}

registerActions({
  'copy-export': () => copyText(exportText),
  'export-json': async () => { flushPending(); toast('Preparing backup…'); const o = await exportObj(); saveFile('pawlog-backup-' + todayStr() + '.json', JSON.stringify(o), 'application/json'); },
  'export-csv': () => { flushPending(); saveFile('pawlog-logs-' + todayStr() + '.csv', exportCsv(), 'text/csv'); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'jsonPick') {
    const f = t.files && t.files[0]; t.value = '';
    if (f) importJson(f);
  }
});

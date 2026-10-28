import { S, photosOf } from './state.js';
import { ROOT, Store, canWrite, dbQueue, existing, lastWritten, localSave, withRetry, writeFailed } from './store.js';
import { toast } from './ui.js';
import { DOG_COLORS, esc, genId } from './util.js';

/* =========================================================
   Photos — stored in the shared db so everyone on the artifact sees them.
   photos/<id>    { dogId, date, thumb (~320px JPEG data URL), w, h, createdBy, createdAt }
   photofull/<id> { dataUrl (longest side ≤1280px, sized to stay under ~190 KB) }
   Thumbs are subscribed with everything else; full images load only in the viewer.
   ========================================================= */
export const FULL_BUDGET = 190 * 1024, THUMB_BUDGET = 40 * 1024;
export async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  return await new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
    img.src = url;
  });
}
export function drawScaled(img, max) {
  const w = img.width, h = img.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// Step quality down, then size, until the data URL fits the budget.
export function fitJpeg(img, max, budget) {
  let size = max;
  for (let round = 0; round < 6; round++) {
    const c = drawScaled(img, size);
    for (const q of [0.84, 0.76, 0.68, 0.6, 0.52]) {
      const d = c.toDataURL('image/jpeg', q);
      if (d.length <= budget) return { d: d, w: c.width, h: c.height };
    }
    size = Math.round(size * 0.8);
  }
  const c = drawScaled(img, 480);
  return { d: c.toDataURL('image/jpeg', 0.5), w: c.width, h: c.height };
}
export async function savePhoto(file, dogId, date) {
  if (!canWrite()) return null;
  let img;
  try { img = await loadImage(file); } catch (e) { toast("Couldn't read that image. Try a JPEG or PNG.", true); return null; }
  const local = S.mode !== 'db';
  const full = fitJpeg(img, local ? 1024 : 1280, local ? 80 * 1024 : FULL_BUDGET);
  const th = fitJpeg(img, 320, THUMB_BUDGET);
  if (img.close) try { img.close(); } catch (e) { /* ignore */ }
  const id = 'p_' + genId();
  const meta = { dogId: dogId || null, date: date || null, thumb: th.d, w: full.w, h: full.h, createdAt: Date.now(), createdBy: S.me || null };
  S.photoFull[id] = full.d;
  if (S.mode === 'db') {
    // Write the full image first, then the thumb doc; the entry reference is added by the caller after this resolves.
    try {
      await withRetry(() => ROOT.collection('photofull').doc(id).set({ dataUrl: full.d, dogId: meta.dogId, createdAt: meta.createdAt, createdBy: meta.createdBy }));
    } catch (e) { writeFailed(e, 'photofull'); delete S.photoFull[id]; return null; }
    // Wait for the thumbnail doc too, so other phones never see the day's reference before the photo itself.
    S.photos[id] = meta;
    try { await withRetry(() => ROOT.collection('photos').doc(id).set(meta)); existing.add('photos/' + id); lastWritten.set('photos/' + id, JSON.stringify(meta)); }
    catch (e) { writeFailed(e, 'photos'); delete S.photos[id]; delete S.photoFull[id]; return null; }
  } else {
    S.photos[id] = meta; localSave('photos');
    localSave('photoFull');
  }
  return id;
}
export function photoSrc(id) {
  if (!id) return '';
  const p = S.photos[id];
  return (p && (p.thumb || p.d)) || '';
}
export async function photoFullSrc(id) {
  if (S.photoFull[id]) return S.photoFull[id];
  if (S.mode === 'db' && ROOT) {
    try {
      const snap = await ROOT.collection('photofull').doc(id).get();
      if (snap.exists) { const d = snap.data(); if (d && d.dataUrl) { S.photoFull[id] = d.dataUrl; return d.dataUrl; } }
    } catch (e) { /* show thumb */ }
  }
  return photoSrc(id);
}
export function photoRefCount(id) {
  let n = 0;
  for (const e of Object.values(S.entries)) if (e && photosOf(e).indexOf(id) >= 0) n++;
  for (const d of Object.values(S.dogs)) if (d && d.avatarAssetId === id) n++;
  return n;
}
export function releasePhoto(id) {
  if (!id || photoRefCount(id) > 0) return;
  if (S.photos[id]) Store.del('photos', id);
  delete S.photoFull[id];
  if (S.mode === 'db') dbQueue('photofull', id, { kind: 'del' });
  else localSave('photoFull');
}
export const imgTag = (id, alt) => {
  const src = photoSrc(id);
  return src ? '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="ph-missing" aria-label="Photo loading"></span>';
};
export function avatarHtml(dog, size) {
  size = size || 32;
  const st = 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.44) + 'px;background:' + esc((dog && dog.color) || DOG_COLORS[0]);
  const src = dog && dog.avatarAssetId ? photoSrc(dog.avatarAssetId) : '';
  if (src) return '<span class="avatar" style="' + st + '"><img src="' + esc(src) + '" alt=""></span>';
  const ch = dog && dog.name ? Array.from(dog.name.trim())[0].toUpperCase() : '?';
  return '<span class="avatar" style="' + st + '">' + esc(ch) + '</span>';
}

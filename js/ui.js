// Shared UI: theme, toast, sheets, confirm dialog, clipboard, render core / router / tabs / banners, lightbox.
// Screens plug in through registry.js (registerScreen); see ARCHITECTURE.md.
import { renderDenied } from './firebase.js';
import { photoFullSrc, photoSrc } from './photos.js';
import { registerActions, screens } from './registry.js';
import { S, curDog, settings } from './state.js';
import { setSaveState } from './store.js';
import { $, $$, I, LS_BANNER, LS_THEME, VIEWS, clamp, esc, fmt, lsGet, lsSet } from './util.js';

/* =========================================================
   Theme
   ========================================================= */
export function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  lsSet(LS_THEME, t || 'system');
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
  });
}
export function ensureHeadMeta() {
  const add = (name, content) => {
    if (document.head.querySelector('meta[name="' + name + '"]')) return;
    const m = document.createElement('meta'); m.name = name; m.content = content; document.head.appendChild(m);
  };
  add('apple-mobile-web-app-capable', 'yes');
  add('mobile-web-app-capable', 'yes');
  add('apple-mobile-web-app-title', 'Pawlog');
  add('apple-mobile-web-app-status-bar-style', 'default');
  add('theme-color', '#F3F5EF');
  if (!document.head.querySelector('link[rel="apple-touch-icon"]')) {
    const c = document.createElement('canvas'); c.width = c.height = 180;
    const x = c.getContext('2d');
    x.fillStyle = '#1D6A55'; x.fillRect(0, 0, 180, 180);
    x.fillStyle = '#fff';
    const el = (cx, cy, rx, ry) => { x.beginPath(); x.ellipse(cx * 2.8125, cy * 2.8125, rx * 2.8125, ry * 2.8125, 0, 0, Math.PI * 2); x.fill(); };
    el(32, 42, 13, 11); el(15, 27, 6, 7.5); el(25, 15, 6, 8); el(39, 15, 6, 8); el(49, 27, 6, 7.5);
    try { const l = document.createElement('link'); l.rel = 'apple-touch-icon'; l.href = c.toDataURL('image/png'); document.head.appendChild(l); } catch (e) { /* ignore */ }
  }
}

/* =========================================================
   Toast, sheets, dialogs
   ========================================================= */
export let toastTimer = null;
export function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isErr);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 4200 : 2200);
}
export let sheetOnClose = null;
export function openSheet(title, body, onMount, onClose) {
  const root = $('#sheetRoot');
  root.innerHTML = '<div class="scrim" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="grab"></div><div class="head"><h2>' + esc(title) + '</h2><button class="icon-btn" data-action="close-sheet" aria-label="Close">' + I.x + '</button></div><div class="body">' + body + '</div></div>';
  root.hidden = false;
  sheetOnClose = onClose || null;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  if (onMount) onMount(root);
}
export function closeSheet() {
  const root = $('#sheetRoot');
  if (root.hidden) return;
  root.classList.remove('open');
  document.body.style.overflow = '';
  const cb = sheetOnClose; sheetOnClose = null;
  setTimeout(() => { if (!root.classList.contains('open')) { root.hidden = true; root.innerHTML = ''; } }, 280);
  if (cb) cb();
}
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    const root = $('#confirmRoot');
    root.innerHTML = '<div class="scrim" data-c="0"></div><div class="dialog" role="alertdialog" aria-modal="true"><h3>' + esc(opts.title) + '</h3><p>' + esc(opts.body || '') + '</p><div class="acts">' +
      '<button class="btn block ' + (opts.danger ? 'danger solid' : '') + '" data-c="1">' + esc(opts.ok || 'OK') + '</button>' +
      (opts.alt ? '<button class="btn block soft" data-c="2">' + esc(opts.alt) + '</button>' : '') +
      '<button class="btn block ghost" data-c="0">Cancel</button></div></div>';
    root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
    const done = (v) => {
      root.classList.remove('open');
      root.removeEventListener('click', onClick);
      setTimeout(() => { root.hidden = true; root.innerHTML = ''; }, 220);
      resolve(v);
    };
    const onClick = (e) => { const b = e.target.closest('[data-c]'); if (b) done(Number(b.getAttribute('data-c'))); };
    root.addEventListener('click', onClick);
    setTimeout(() => { const b = root.querySelector('[data-c="1"]'); if (b) b.focus(); }, 50);
  });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove();
    toast(ok ? 'Copied' : 'Select the text and copy it manually.');
  }
}

/* =========================================================
   Rendering core
   ========================================================= */
// Live sync: remote changes re-render, but never under the user's fingers.
//  - If the Today screen is showing and the change is to the open day, patch it in place:
//    the focused field / dragged slider keep their local value, everything else updates.
//  - Otherwise, if a field is focused or a slider is being dragged, defer the full render until it's released.
export let renderQueued = false, renderDeferred = false, queuedOpts = {};
export let dragging = null; // slider element being dragged
export function busyElement() {
  const a = document.activeElement;
  if (a && $('#app').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'range') return a;
  return null;
}
export function scheduleRender(opts) {
  opts = opts || {};
  queuedOpts.todayEntry = queuedOpts.todayEntry || !!opts.todayEntry;
  queuedOpts.other = queuedOpts.other || (opts.col && opts.col !== 'entries') || !opts.col;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const o = queuedOpts; queuedOpts = {};
    const busy = busyElement();
    const sheetOpen = !$('#sheetRoot').hidden;
    if (S.view === 'today' && !o.other && curDog()) { patchView(); return; }
    if (busy || dragging) { renderDeferred = true; if (S.view === 'today') patchView(); return; }
    if (sheetOpen) { renderDeferred = true; return; }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });
}
export function flushDeferred() { if (renderDeferred && !busyElement() && !dragging) { renderDeferred = false; scheduleRender({}); } }
document.addEventListener('focusout', () => setTimeout(flushDeferred, 60));
document.addEventListener('pointerdown', (e) => { if (e.target.matches && e.target.matches('.slider')) dragging = e.target; }, true);
export const endDrag = () => { if (dragging) { dragging = null; setTimeout(() => { flushDeferred(); if (S.view === 'today') patchView(); }, 30); } };
document.addEventListener('pointerup', endDrag, true);
document.addEventListener('pointercancel', endDrag, true);

// The current screen's in-place updater (Today patches live edits without a rebuild).
export function patchView() { const scr = screens[S.view]; if (scr && scr.patch) scr.patch(); }
export function onReady() {
  const s = settings();
  applyTheme(s.theme);
  const h = (location.hash || '').slice(1);
  if (VIEWS.indexOf(h) >= 0) S.view = h;
  render();
}

export function render() {
  if (S.accessDenied) { renderDenied(); return; }
  if (!S.ready) return;
  const app = $('#app'), tabs = $('#tabs');
  const dog = curDog();
  if (!dog) {
    app.classList.add('no-tabs');
    tabs.hidden = true;
    app.innerHTML = screens.onboarding.render();
    return;
  }
  app.classList.remove('no-tabs');
  tabs.hidden = false;
  renderTabs();
  let html = '';
  const scr = screens[S.view];
  if (scr) html = scr.render(dog);
  app.innerHTML = html;
  afterRender();
}
export function afterRender() {
  setSaveState(S.saveState === 'saved' ? 'idle' : S.saveState);
  $$('textarea[data-autogrow]').forEach(autoGrow);
  const scr = screens[S.view];
  if (scr && scr.afterRender) scr.afterRender();
}
export function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.max(120, t.scrollHeight + 2) + 'px'; }

export function go(view, opts) {
  if (VIEWS.indexOf(view) < 0) view = 'today';
  S.scroll[S.view] = window.scrollY;
  const changed = view !== S.view;
  S.view = view;
  if (location.hash.slice(1) !== view) { try { history.replaceState(null, '', '#' + view); } catch (e) { location.hash = view; } }
  render();
  window.scrollTo(0, changed && !(opts && opts.top) ? (S.scroll[view] || 0) : 0);
}
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (VIEWS.indexOf(h) >= 0 && h !== S.view) go(h);
});

export function renderTabs() {
  const tabs = [['today', 'Today', I.today], ['history', 'History', I.history], ['insights', 'Insights', I.insights], ['dog', 'Dog', I.dog]];
  const cur = S.view === 'prefs' ? 'dog' : S.view;
  $('#tabs .inner').innerHTML = tabs.map(([v, l, ic]) => '<button class="tab" data-action="tab" data-view="' + v + '"' + (cur === v ? ' aria-current="page"' : '') + '>' + ic + '<span>' + l + '</span></button>').join('');
}

export function bannerHtml() {
  if (S.readOnly) return '<div class="banner ro-banner" role="note"><p><b>You can view but not edit.</b> Ask the owner to share with Editor access.</p></div>';
  if (S.mode !== 'local' || lsGet(LS_BANNER) === '1') return '';
  return '<div class="banner" role="note"><p><b>Saved on this device only.</b> Export a backup from Settings now and then.</p><button class="icon-btn" data-action="dismiss-banner" aria-label="Dismiss">' + I.x + '</button></div>';
}

/* =========================================================
   Lightbox
   ========================================================= */
export let LB = null;
export function openLightbox(items, idx) {
  LB = { items: items, idx: idx };
  drawLightbox();
  document.body.style.overflow = 'hidden';
}
export function drawLightbox() {
  const el = $('#lightbox');
  if (!LB) { el.hidden = true; el.innerHTML = ''; document.body.style.overflow = ''; return; }
  const it = LB.items[LB.idx];
  el.innerHTML = '<div class="lb-top"><span class="small" style="opacity:.8">' + (LB.idx + 1) + ' / ' + LB.items.length + '</span><button class="icon-btn" data-action="lb-close" aria-label="Close">' + I.x + '</button></div>' +
    '<div class="lb-img"><img id="lbImg" src="' + esc(S.photoFull[it.id] || photoSrc(it.id)) + '" alt="Photo"></div>' +
    '<div class="lb-bot"><button class="icon-btn" data-action="lb-nav" data-d="-1" aria-label="Previous"' + (LB.idx === 0 ? ' disabled' : '') + '>' + I.chevL + '</button><span>' + esc(it.date ? fmt(it.date, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : '') + '</span>' +
    '<button class="icon-btn" data-action="lb-nav" data-d="1" aria-label="Next"' + (LB.idx === LB.items.length - 1 ? ' disabled' : '') + '>' + I.chevR + '</button></div>';
  el.hidden = false;
  // Show the thumbnail immediately, then swap in the full-size image once it's fetched.
  if (!S.photoFull[it.id]) {
    const want = it.id;
    photoFullSrc(want).then((src) => { const im = $('#lbImg'); if (im && LB && LB.items[LB.idx] && LB.items[LB.idx].id === want && src) im.src = src; });
  }
}
export let touchX = null;
$('#lightbox').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#lightbox').addEventListener('touchend', (e) => {
  if (touchX == null || !LB) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  if (Math.abs(dx) > 50) { const n = LB.idx + (dx < 0 ? 1 : -1); if (n >= 0 && n < LB.items.length) { LB.idx = n; drawLightbox(); } }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (LB) { LB = null; drawLightbox(); } else closeSheet(); }
  if (LB && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { const n = LB.idx + (e.key === 'ArrowRight' ? 1 : -1); if (n >= 0 && n < LB.items.length) { LB.idx = n; drawLightbox(); } }
});

registerActions({
  'tab': (el) => { closeSheet(); go(el.dataset.view, { top: el.dataset.view === 'prefs' }); },
  'close-sheet': () => closeSheet(),
  'dismiss-banner': () => { lsSet(LS_BANNER, '1'); render(); },
  'lb-close': () => { LB = null; drawLightbox(); },
  'lb-nav': (el) => { if (!LB) return; LB.idx = clamp(LB.idx + Number(el.dataset.d), 0, LB.items.length - 1); drawLightbox(); },
  'reload': () => { try { location.reload(); } catch (e) { /* ignore */ } },
  'copy': (el) => copyText(el.dataset.text),
});

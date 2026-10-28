// Document-level event wiring. Click -> registered action (data-action), submit -> registered form
// handler (data-form), photo file picker -> registered pick handler (data-pick on the label).
// Modules register handlers in registry.js; this file only dispatches.
import { actions, forms, picks, writeActions } from './registry.js';
import { S } from './state.js';
import { canWrite } from './store.js';

export let pickTarget = 'entry';
document.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick && S.readOnly) { e.preventDefault(); canWrite(); return; }
  if (pick) pickTarget = pick.dataset.pick;
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn && S.readOnly && writeActions.has(el.dataset.action)) { e.preventDefault(); canWrite(); return; }
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id !== 'filePick') return;
  const files = Array.from(t.files || []);
  t.value = '';
  if (!files.length) return;
  await (picks[pickTarget] || picks.entry)(files);
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  const kind = f.dataset && f.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const fn = forms[kind];
  if (fn) fn(f);
});

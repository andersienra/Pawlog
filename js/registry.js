// Shared registries. No imports, so it is always evaluated before any module that uses it.
// Screens and feature modules register into these at import time; ui.js / actions.js dispatch from them.
// name -> { render(dog) -> html, afterRender?(), patch?() }. Names match S.view ('today', 'history',
// 'insights', 'dog', 'prefs') plus 'onboarding' (shown when there is no dog yet).
export const screens = {};
// data-action -> handler(el, event)
export const actions = {};
// data-action names that change data; blocked with a "view only" toast when S.readOnly.
export const writeActions = new Set();
// data-form -> submit handler(form)
export const forms = {};
// data-pick (on the label that opens #filePick) -> handler(files)
export const picks = {};

export function registerScreen(name, def) { screens[name] = def; }
export function registerActions(map, writes) {
  for (const k in map) { if (k in actions) console.warn('Pawlog: action registered twice: ' + k); actions[k] = map[k]; }
  (writes || []).forEach((a) => writeActions.add(a));
}
export function registerForms(map) { Object.assign(forms, map); }
export function registerPicks(map) { Object.assign(picks, map); }

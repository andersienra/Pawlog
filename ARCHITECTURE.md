# Pawlog architecture

Static files served from GitHub Pages at `/Pawlog/`. There is no build step and no bundler. The browser loads native ES modules straight from `js/`. Every path is relative, and every import names its `.js` extension.

Modules don't load from `file://`, so serve the folder over HTTP to try it locally:

```
python3 -m http.server 8765 --bind 127.0.0.1 --directory /path/to/pawlog-gh
```

## File map

```
index.html            head (manifest, icons, meta, fonts), page shell, CSS links, one <script type="module">
manifest.webmanifest  PWA manifest
firestore.rules       Firestore access list (deployed separately)
css/
  base.css            tokens + dark mode, base, shared blocks (panel, row, btn, empty, chips, fields, inputs, seg,
                      swatches), top bar, banner, toast, tabs, sheets, dialogs, lightbox, onboarding/sign-in,
                      people/byline, read-only (body.ro) rules, reduced motion
  today.css           Today screen (date bar, summary ring, reminders, behavior sliders, details, photo grid)
  history.css         History (search, calendar heatmap, entry rows)
  insights.css        Insights (tiles, charts, trends, dots, weekday chips, tag bars)
  dog.css             Dog profile (hero, age, kv, events, gallery) + health-record sheet type chips
  settings.css        Settings (behavior manager rows, quick-tag chips, toggle, people faces)
js/
  main.js             boot: imports every module, then picks a backend (claude db -> Firebase -> localStorage)
  registry.js         shared registries: screens, actions, write-guarded actions, forms, photo picks
  util.js             $/$$, esc, date helpers, ls* wrappers, hasClaude, icons (I, PAW), constants (LS_*, SIZES, ...)
  state.js            S (all in-memory state), prefs/settings, entry shape helpers, scoring, streaks,
                      setActiveDog, dueEvents/dueText
  store.js            Store.put/del/patch, local mode, db write queue, subscriptions, people/byLine,
                      debounced edits/flushPending, midnight rollover, save indicator, setReadOnly
  photos.js           image resize/encode, savePhoto, photoSrc/photoFullSrc, releasePhoto, imgTag, avatarHtml
  firebase.js         FIREBASE_CONFIG, SDK loader + adapter (same db/user interface as the claude runtime),
                      sign-in screen, access-denied screen, sign-out; registers 'auth' form + auth actions
  ui.js               theme, toast, sheets, confirmDialog, copyText, render core (scheduleRender, deferral
                      while typing/dragging), render()/router (go, hash), tabs, bannerHtml, lightbox
  io.js               JSON/CSV export, import, text-export fallback; jsonPick change handler
  actions.js          document-level dispatch: click -> actions, submit -> forms, #filePick -> picks
  screens/
    onboarding.js     no-dog welcome + dog form, add/edit dog sheets, dog switcher, dog CRUD actions
    today.js          Today render + patchToday (live in-place update), editEntry, slider/notes/details input
    history.js        History render, search input, month navigation
    insights.js       Insights render, SVG charts + hover, weekday chip scroller
    dog.js            Dog profile render, health-record sheet + form, avatar photo pick
    settings.js       Settings render, behavior sheet + form, quick tags, theme
```

## Module ownership

| Concern | Owner | Notes |
|---|---|---|
| State object `S`, prefs, shared settings | `state.js` | Every module mutates `S` fields directly (`S.date = ...`). No module reassigns `S`. |
| Persistence and sync | `store.js` | Always write through `Store.put/del/patch`, or `editEntry` for day entries. Never write localStorage or the db directly. |
| Backend selection | `main.js` | `typeof window.claude` (via `hasClaude()`): runtime db, then Firebase, then localStorage. |
| Firebase specifics | `firebase.js` | `window.__PAWLOG_FIREBASE_CONFIG` and `window.__pawlogFirebaseLoader` are test hooks. Keep them. |
| Rendering and navigation | `ui.js` | `render()` builds `#app` from `screens[S.view]`. `scheduleRender()` is the remote-change path. |
| Screen HTML and screen-only behavior | `screens/X.js` | |
| Click/submit/file-pick dispatch | `actions.js` | Screens never add their own click or submit listeners for actions. They register into it. |

## How screens plug in

Each screen module registers itself when it is imported:

```js
import { registerScreen, registerActions, registerForms, registerPicks } from '../registry.js';

registerScreen('history', {
  render(dog) { return '<header class="topbar">…</header><div class="stack">…</div>'; }, // required
  afterRender() { /* bind listeners on freshly rendered DOM */ },                     // optional
  patch() { /* update in place on a remote change without a rebuild */ }              // optional
});

registerActions({
  'month': (el, event) => { /* data-action="month" */ }
}, ['month']);                       // 2nd arg: action names that WRITE data (blocked in view-only mode)

registerForms({ 'my-form': (formEl) => { /* <form data-form="my-form"> submit */ } });
registerPicks({ 'my-pick': async (files) => { /* <label for="filePick" data-pick="my-pick"> */ } });
```

Screen names are the values of `S.view`: `today`, `history`, `insights`, `dog`, `prefs` (Settings). `onboarding` renders whenever there is no dog yet.

### Adding a screen

1. Create `js/screens/foo.js` with `registerScreen('foo', { render })` and its actions.
2. Create `css/foo.css`.
3. Add `import './screens/foo.js';` to `main.js` and `<link rel="stylesheet" href="css/foo.css">` to `index.html`.
4. Add `'foo'` to `VIEWS` in `util.js`. To give it a tab, add it to the `tabs` list in `renderTabs()` in `ui.js`. Steps 3 and 4 are shared edits, so coordinate them.

### Adding an action

Add `data-action="name"` to the element, and register `'name'` in the module that owns that UI. Action names must be unique across the whole app. `registerActions` logs a console warning on a duplicate. If the action changes data, also list it in the second argument, so view-only users get the "You can view but not edit" toast instead.

## Conventions

- **Imports run one way at top level.** At module top level you may only call into `util.js` and `registry.js`. Neither has imports, so they are always initialized. Every other cross-module use must happen inside functions (render, handlers, callbacks). The graph has cycles, such as `state` <-> `store` <-> `ui`. They are harmless as long as no top-level code touches a binding from a module that may not have run yet.
- **Imported bindings are read-only.** You can't assign to an imported `let` (`dragging`, `formAvatar`, `LB`, `ROOT`, ...). Either export a setter from the owning module or keep the state in `S`.
- **Keep the runtime paths.** Preserve the `hasClaude()` and `typeof window.claude` checks, the `window.claude.use('downloads')` export path, the localStorage fallback (`S.mode === 'local'`), and the `S.readOnly` guards (`canWrite()`).
- **No new dependencies.** External loads are limited to Google Fonts and the Firebase SDK from gstatic. The SDK is loaded lazily by `firebase.js`.
- **Generated HTML is escaped.** Pass all user text through `esc()`.

## Parallel work (one agent per screen)

- A screen agent edits **only** `js/screens/X.js` and `css/X.css`.
- Selectors in `css/X.css` should stay specific to that screen. Restyling a shared class there (`.panel`, `.row`, `.btn`, `.chip`, `.seg`, `.field`, `.input`, `.topbar`, `.empty`, ...) would leak into other screens. Screen CSS loads after `base.css`, so a screen can override shared classes under its own selectors if needed.
- Shared changes go through `css/base.css` (tokens, shared components) or `js/ui.js` (sheets, toast, render core, tabs, banner). Make them one at a time, or have one designated owner.
- Data-model changes (`state.js`, `store.js`, `firebase.js`) affect sync between devices. Treat them as shared too, and re-run the sync tests afterwards.
- Screens never import each other, and core modules never import screens. Screens are reached only through the registry: `main.js` imports them for their side effects. To reuse something across screens (for example, Settings' "Add a dog" button opens the sheet owned by `onboarding.js`), use the shared `data-action`. If a helper really is shared, move it into `state.js`, `photos.js` or `ui.js`.

// Firebase backend for the standalone / GitHub Pages build, plus sign-in and access-denied screens.
import { registerActions, registerForms } from './registry.js';
import { S, isPlainObj } from './state.js';
import { flushPending, startDb, wantNames, writeFailed, writers } from './store.js';
import { confirmDialog, scheduleRender } from './ui.js';
import { $, I, PAW, clone, esc, genId, sleep } from './util.js';

/* =========================================================
   FIREBASE CONFIG — paste your Firebase web app config here to sync
   between phones. Leave as null to keep everything on this device.
   Example:
     const FIREBASE_CONFIG = {
       apiKey: "…", authDomain: "your-project.firebaseapp.com",
       projectId: "your-project", appId: "…"
     };
   ========================================================= */
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC1xocvFWvgizH47JSVbpEOOL1HgFtThOU',
  authDomain: 'pawlog-9e959.firebaseapp.com',
  projectId: 'pawlog-9e959',
  storageBucket: 'pawlog-9e959.firebasestorage.app',
  messagingSenderId: '428529004088',
  appId: '1:428529004088:web:8178bcea34bfbe230740cd'
};
export const FIREBASE_SDK_VERSION = '10.14.1';

/* =========================================================
   Firebase backend (standalone / GitHub Pages build)
   Exposes the same `db` + `user` interface as the claude.ai runtime,
   so the write queue, merge patches, live sync and attribution above
   work unchanged. Data lives at pawlog/main/<collection>/<id>.
   ========================================================= */
export const FB = { m: null, app: null, auth: null, fs: null, user: null, people: {}, peopleReady: null, pendingName: '', unsubPeople: null };
export async function loadFirebase() {
  // Test hook: a page may provide its own loader that returns { app, auth, firestore } module objects.
  if (typeof window.__pawlogFirebaseLoader === 'function') return await window.__pawlogFirebaseLoader();
  const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';
  const r = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  return { app: r[0], auth: r[1], firestore: r[2] };
}
// Firestore error -> the db error codes the app already handles.
export function fbErr(e) {
  const c = String((e && e.code) || '').replace(/^firestore\//, '');
  if ((c === 'permission-denied' || c === 'unauthenticated') && !FB.signingOut) { onAccessDenied(); return { code: 'revoked', message: 'permission-denied' }; }
  const map = { 'not-found': 'invalid_argument', 'invalid-argument': 'invalid_argument', 'resource-exhausted': 'resource_exhausted' };
  return { code: map[c] || 'unavailable', message: (e && e.message) || c };
}
export const fbSnap = (s) => {
  const ex = typeof s.exists === 'function' ? s.exists() : !!s.exists;
  const d = ex ? s.data() : undefined;
  const md = s.metadata || {};
  return { id: s.id, exists: ex, data: () => d, metadata: { fromCache: !!md.fromCache, hasPendingWrites: !!md.hasPendingWrites } };
};
// Writes resolve when the server confirms. Offline, Firestore applies them to its local cache at once
// and syncs later, so don't hold the per-document queue waiting for a confirmation that may take hours.
// A late rejection (after we stopped waiting) is still reported to the user.
export function fbAck(p) {
  let waiting = true;
  const guarded = p.catch((e) => { const m = fbErr(e); if (!waiting) writeFailed(m, ''); throw m; });
  guarded.catch(() => {});
  return Promise.race([guarded, sleep(navigator.onLine === false ? 800 : 4000)]).finally(() => { waiting = false; });
}
// Removal conventions: a rating/photo set to null and a tag set to false become deleted fields.
export function fbLeaf(path, v) {
  const F = FB.m.firestore;
  if (v === null && path.length === 2 && (path[0] === 'ratings' || path[0] === 'photos')) return F.deleteField();
  if (v === false && path.length === 2 && path[0] === 'tags') return F.deleteField();
  return v;
}
export function fbFlatten(obj, path, out) {
  for (const k in obj) {
    const v = obj[k], p = path.concat(k);
    if (v === undefined) continue;
    if (isPlainObj(v) && Object.keys(v).length) fbFlatten(v, p, out);
    else out.push([p, v]);
  }
  return out;
}
export function fbDocRef(segs) {
  const F = FB.m.firestore;
  const ref = F.doc(FB.fs, ...segs);
  return {
    id: segs[segs.length - 1], path: segs.join('/'),
    async get() {
      try { return fbSnap(await F.getDoc(ref)); }
      catch (e) {
        const m = fbErr(e);
        if (m.code !== 'unavailable') throw m;
        try { return fbSnap(await F.getDocFromCache(ref)); } catch (e2) { return { id: ref.id, exists: false, data: () => undefined, metadata: { fromCache: true, hasPendingWrites: false } }; }
      }
    },
    set(d) { return fbAck(F.setDoc(ref, clone(d))); },
    // Same contract as the claude db: deep merge into an existing doc, reject when it's missing.
    // Each leaf is written by its own field path, so sibling keys written by someone else survive.
    update(d) {
      const pairs = fbFlatten(clone(d), [], []);
      if (!pairs.length) return Promise.resolve();
      const args = [];
      for (const [p, v] of pairs) args.push(new F.FieldPath(...p), fbLeaf(p, v));
      return fbAck(F.updateDoc(ref, args[0], args[1], ...args.slice(2)));
    },
    delete() { return fbAck(F.deleteDoc(ref)); },
    onSnapshot(next, err) { return F.onSnapshot(ref, (s) => next(fbSnap(s)), (e) => err && err(fbErr(e))); },
    collection(sub) { return fbColRef(segs.concat(sub)); }
  };
}
export function fbColRef(segs) {
  const F = FB.m.firestore;
  return {
    path: segs.join('/'),
    doc(id) { return fbDocRef(segs.concat(id || genId('x'))); },
    onSnapshot(next, err) {
      const t0 = Date.now();
      let delivered = false, held = null, timer = null;
      const emit = (qs) => { delivered = true; held = null; clearTimeout(timer); next(wrap(qs)); };
      // includeMetadataChanges so the "now synced with the server" event arrives even when nothing changed
      // (otherwise an empty collection answered from cache never gets a second event). Metadata-only
      // events after the first delivery are dropped below.
      const unsub = F.onSnapshot(F.collection(FB.fs, ...segs), { includeMetadataChanges: true }, (qs) => {
        if (!delivered) {
          // A first, empty answer from the local cache isn't the real state yet; wait (briefly) for the server.
          if (qs.metadata && qs.metadata.fromCache && qs.empty && navigator.onLine !== false && Date.now() - t0 < 5000) {
            held = qs;
            if (!timer) timer = setTimeout(() => { if (!delivered && held) emit(held); }, Math.max(0, 5000 - (Date.now() - t0)));
            return;
          }
          emit(qs); return;
        }
        if (!qs.docChanges().length) return;
        emit(qs);
      }, (e) => { clearTimeout(timer); if (err) err(fbErr(e)); });
      return () => { clearTimeout(timer); unsub(); };
      function wrap(qs) {
        return {
          docs: qs.docs.map(fbSnap), size: qs.size, empty: qs.empty,
          docChanges: () => qs.docChanges().map((c) => ({ type: c.type, doc: fbSnap(c.doc), oldIndex: c.oldIndex, newIndex: c.newIndex })),
          metadata: { fromCache: !!(qs.metadata && qs.metadata.fromCache), hasPendingWrites: !!(qs.metadata && qs.metadata.hasPendingWrites) }
        };
      }
    }
  };
}
export const fbDb = {
  doc(path) { return fbDocRef(path.split('/')); },
  collection(path) { return fbColRef(path.split('/')); }
};
// Names come from pawlog/main/people/<uid> = { name, email } (stored ids elsewhere, names resolved here).
export const fbUser = {
  id: async () => (FB.user ? FB.user.uid : null),
  can: async (n) => (n === 'data.write' ? true : null),
  isOwner: async () => false,
  canEdit: async () => false,
  async profiles(ids) {
    await FB.peopleReady;
    const out = {};
    [].concat(ids).forEach((id) => {
      const p = FB.people[id] || {};
      out[id] = { id: id, name: p.name || '', avatarUrl: '', color: '#888888', email: p.email || null, isMe: !!(FB.user && FB.user.uid === id), guest: false };
    });
    return out;
  }
};
export function fbSubscribePeople() {
  const F = FB.m.firestore;
  let resolve; FB.peopleReady = new Promise((r) => { resolve = r; setTimeout(r, 4000); });
  FB.unsubPeople = F.onSnapshot(F.collection(FB.fs, 'pawlog', 'main', 'people'), (qs) => {
    let changed = false;
    for (const c of qs.docChanges()) {
      const d = c.type === 'removed' ? null : c.doc.data();
      const before = JSON.stringify(FB.people[c.doc.id] || null);
      if (d) FB.people[c.doc.id] = { name: String(d.name || ''), email: String(d.email || '') }; else delete FB.people[c.doc.id];
      if (JSON.stringify(FB.people[c.doc.id] || null) !== before) { delete S.names[c.doc.id]; changed = true; }
    }
    resolve();
    if (changed && S.ready) scheduleRender({});
  }, (e) => { resolve(); fbErr(e); });
}
export async function fbWritePerson(u) {
  const F = FB.m.firestore;
  const name = (FB.pendingName || u.displayName || '').trim() || String(u.email || '').split('@')[0];
  FB.pendingName = '';
  try { await F.setDoc(F.doc(FB.fs, 'pawlog', 'main', 'people', u.uid), { name: name, email: u.email || '', updatedAt: Date.now() }, { merge: true }); }
  catch (e) { fbErr(e); }
}

export function onAccessDenied() {
  if (S.accessDenied) return;
  S.accessDenied = true;
  renderDenied();
}
export function renderDenied() {
  $('#tabs').hidden = true;
  const app = $('#app'); app.classList.add('no-tabs');
  const email = FB.user && FB.user.email ? FB.user.email : '';
  app.innerHTML = '<div class="welcome"><div class="mark">' + PAW + '</div><h1>This account isn’t on the Pawlog access list</h1>' +
    '<p>You’re signed in as <b class="copyable">' + esc(email) + '</b>. Only the people the owner has added can open this logbook.</p>' +
    '<p>Ask the owner to add this email, then try again. Or sign out and use a different account.</p></div>' +
    '<div class="form" style="margin-top:18px"><button class="btn block" data-action="reload">Try again</button><button class="btn block ghost" data-action="sign-out-now">Sign out</button></div>';
}

/* ---------- Sign-in screen ---------- */
export const AUTH = { mode: 'signin', busy: false, error: '', info: '', email: '', name: '' };
export function renderAuth() {
  $('#tabs').hidden = true;
  const app = $('#app'); app.classList.add('no-tabs');
  const m = AUTH.mode;
  const title = m === 'create' ? 'Create your account' : m === 'reset' ? 'Reset your password' : 'Welcome back';
  const lead = m === 'reset' ? 'Enter your email and we’ll send you a link to choose a new password.' : 'Sign in to share your dog’s daily log with the people who help look after them.';
  app.innerHTML = '<div class="welcome auth-head"><div class="mark">' + PAW + '</div><h1>' + esc(title) + '</h1><p>' + esc(lead) + '</p></div>' +
    '<form class="form panel pad" data-form="auth" novalidate style="margin-top:16px">' +
    (m !== 'reset' ? '<div class="seg" role="group" aria-label="Account"><button type="button" data-action="auth-mode" data-m="signin" aria-pressed="' + (m === 'signin') + '">Sign in</button><button type="button" data-action="auth-mode" data-m="create" aria-pressed="' + (m === 'create') + '">Create account</button></div>' : '') +
    (m === 'create' ? '<label class="field"><span>Your name</span><input class="input" id="au_name" name="name" autocomplete="name" maxlength="40" required placeholder="e.g. Ander" value="' + esc(AUTH.name) + '"></label>' : '') +
    '<label class="field"><span>Email</span><input class="input" id="au_email" name="email" type="email" inputmode="email" autocomplete="' + (m === 'create' ? 'email' : 'username') + '" autocapitalize="none" spellcheck="false" required value="' + esc(AUTH.email) + '"></label>' +
    (m !== 'reset' ? '<label class="field"><span>Password</span><input class="input" id="au_pw" name="password" type="password" autocomplete="' + (m === 'create' ? 'new-password' : 'current-password') + '" minlength="6" required' + (m === 'create' ? ' placeholder="At least 6 characters"' : '') + '></label>' : '') +
    '<p class="auth-msg err" id="authErr" role="alert"' + (AUTH.error ? '' : ' hidden') + '>' + esc(AUTH.error) + '</p>' +
    '<p class="auth-msg ok" id="authInfo" role="status"' + (AUTH.info ? '' : ' hidden') + '>' + esc(AUTH.info) + '</p>' +
    '<button class="btn block" type="submit" id="authGo"' + (AUTH.busy ? ' disabled' : '') + '>' + (m === 'create' ? 'Create account' : m === 'reset' ? 'Send reset link' : 'Sign in') + '</button>' +
    (m === 'signin' ? '<button type="button" class="linkbtn" style="align-self:center" data-action="auth-mode" data-m="reset">Forgot password?</button>' : '') +
    (m === 'reset' ? '<button type="button" class="linkbtn" style="align-self:center" data-action="auth-mode" data-m="signin">' + I.chevL + 'Back to sign in</button>' : '') +
    '</form><p class="foot">You stay signed in on this device until you sign out.</p>';
}
export function authMsg(e) {
  const c = String((e && e.code) || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/.test(c)) return 'That email and password don’t match. Check them and try again, or reset your password.';
  if (/email-already-in-use/.test(c)) return 'There’s already an account with this email. Sign in instead.';
  if (/weak-password|password-does-not-meet-requirements/.test(c)) return 'Choose a stronger password: at least 6 characters.';
  if (/invalid-email/.test(c)) return 'Enter a valid email address, like name@example.com.';
  if (/missing-password/.test(c)) return 'Enter your password.';
  if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a few minutes, then try again.';
  if (/network-request-failed/.test(c)) return 'Can’t reach the server. Check your connection and try again.';
  if (/operation-not-allowed|admin-restricted-operation/.test(c)) return 'New accounts are turned off for this Pawlog. Ask the owner to create one for you.';
  if (/user-disabled/.test(c)) return 'This account has been turned off. Ask the owner.';
  return 'Something went wrong' + (c ? ' (' + c + ')' : '') + '. Try again.';
}
export function setAuthMsg(err, info) {
  AUTH.error = err || ''; AUTH.info = info || '';
  const e = $('#authErr'), i = $('#authInfo');
  if (e) { e.textContent = AUTH.error; e.hidden = !AUTH.error; }
  if (i) { i.textContent = AUTH.info; i.hidden = !AUTH.info; }
}
export async function submitAuth(form) {
  const A2 = FB.m.auth;
  const fd = new FormData(form);
  const email = String(fd.get('email') || '').trim().toLowerCase();
  const pw = String(fd.get('password') || '');
  const name = String(fd.get('name') || '').trim();
  AUTH.email = email; AUTH.name = name;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthMsg(authMsg({ code: 'auth/invalid-email' })); $('#au_email').focus(); return; }
  if (AUTH.mode === 'create' && !name) { setAuthMsg('Enter your name so the other person knows who logged what.'); $('#au_name').focus(); return; }
  if (AUTH.mode !== 'reset' && !pw) { setAuthMsg(authMsg({ code: 'auth/missing-password' })); $('#au_pw').focus(); return; }
  const btn = $('#authGo'); AUTH.busy = true; if (btn) { btn.disabled = true; btn.textContent = AUTH.mode === 'reset' ? 'Sending…' : AUTH.mode === 'create' ? 'Creating account…' : 'Signing in…'; }
  setAuthMsg('', '');
  try {
    if (AUTH.mode === 'reset') {
      try { await A2.sendPasswordResetEmail(FB.auth, email); }
      catch (e) { if (!/user-not-found/.test(String(e && e.code))) throw e; }
      AUTH.busy = false; AUTH.mode = 'signin'; renderAuth();
      setAuthMsg('', 'If there’s an account for ' + email + ', a reset link is on its way. Check your inbox and spam folder.');
      return;
    }
    if (AUTH.mode === 'create') {
      FB.pendingName = name;
      const cred = await A2.createUserWithEmailAndPassword(FB.auth, email, pw);
      try { await A2.updateProfile(cred.user, { displayName: name }); } catch (e) { /* the people doc still carries the name */ }
      if (FB.user && FB.user.uid === cred.user.uid) fbWritePerson(Object.assign({}, cred.user, { displayName: name }));
    } else {
      await A2.signInWithEmailAndPassword(FB.auth, email, pw);
    }
    AUTH.busy = false; AUTH.error = ''; AUTH.info = '';
    // onAuthStateChanged takes it from here.
  } catch (e) {
    FB.pendingName = '';
    AUTH.busy = false;
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = AUTH.mode === 'create' ? 'Create account' : AUTH.mode === 'reset' ? 'Send reset link' : 'Sign in'; }
    setAuthMsg(authMsg(e));
    if (/email-already-in-use/.test(String(e && e.code))) { AUTH.mode = 'signin'; renderAuth(); setAuthMsg(authMsg(e)); }
  }
}
export async function fbSignOut() {
  if (FB.signingOut) return;
  FB.signingOut = true;
  flushPending();
  // Writes Firestore hasn't confirmed live only in this device's cache; clearing it would lose them.
  let quiet = false;
  try {
    const F = FB.m.firestore;
    if (F.waitForPendingWrites && navigator.onLine !== false) quiet = await Promise.race([F.waitForPendingWrites(FB.fs).then(() => true, () => false), sleep(2500).then(() => false)]);
  } catch (e) { quiet = false; }
  quiet = quiet && !writers.size;
  if (FB.unsubPeople) { try { FB.unsubPeople(); } catch (e) { /* ignore */ } }
  try { await FB.m.auth.signOut(FB.auth); } catch (e) { /* reload anyway */ }
  // Clear this device's cached copy of the logbook unless writes are still waiting to sync.
  if (quiet && FB.m.firestore.terminate) {
    try { await FB.m.firestore.terminate(FB.fs); await FB.m.firestore.clearIndexedDbPersistence(FB.fs); } catch (e) { /* ignore */ }
  }
  try { location.reload(); } catch (e) { /* ignore */ }
}
export function renderFbLoadError(msg) {
  $('#tabs').hidden = true;
  $('#app').innerHTML = '<div class="welcome"><div class="mark">' + PAW + '</div><h1>Can’t connect</h1><p>' + esc(msg) + '</p></div><div class="form" style="margin-top:18px"><button class="btn block" data-action="reload">Try again</button></div>';
}

export async function startFirebase(cfg) {
  S.backend = 'firebase';
  let m;
  try { m = await loadFirebase(); }
  catch (e) { renderFbLoadError('Pawlog couldn’t load its sync service. Check your connection, then try again.'); return; }
  FB.m = m;
  try {
    FB.app = m.app.initializeApp(cfg);
    try {
      FB.auth = m.auth.initializeAuth(FB.app, { persistence: [m.auth.indexedDBLocalPersistence, m.auth.browserLocalPersistence] });
    } catch (e) { FB.auth = m.auth.getAuth(FB.app); }
    try {
      FB.fs = m.firestore.initializeFirestore(FB.app, { ignoreUndefinedProperties: true, localCache: m.firestore.persistentLocalCache({ tabManager: m.firestore.persistentMultipleTabManager() }) });
    } catch (e) { FB.fs = m.firestore.getFirestore(FB.app); }
  } catch (e) {
    renderFbLoadError('Pawlog’s sync settings look wrong. Check FIREBASE_CONFIG.');
    return;
  }
  m.auth.onAuthStateChanged(FB.auth, (u) => {
    if (!u) {
      if (FB.signingOut) return; // fbSignOut reloads once when it's done
      if (FB.user) { try { location.reload(); } catch (e) { /* ignore */ } return; }
      renderAuth();
      return;
    }
    if (FB.user && FB.user.uid === u.uid) return;
    FB.user = u;
    S.me = u.uid; S.user = fbUser; S.canWrite = true;
    fbSubscribePeople();
    fbWritePerson(u);
    $('#app').innerHTML = '<div class="loading"><div>' + PAW.replace('<svg', '<svg class="paw"') + 'Opening your logbook…</div></div>';
    startDb(fbDb);
    wantNames([u.uid]);
  });
}

registerActions({
  'auth-mode': (el) => { const em = $('#au_email'); if (em) AUTH.email = em.value; const nm = $('#au_name'); if (nm) AUTH.name = nm.value; AUTH.mode = el.dataset.m; AUTH.error = ''; AUTH.info = ''; renderAuth(); const f = $(AUTH.mode === 'create' ? '#au_name' : '#au_email'); if (f && !f.value) f.focus(); },
  'sign-out': async () => {
    const c = await confirmDialog({ title: 'Sign out?', body: 'You’ll need your email and password to sign back in on this device.', ok: 'Sign out', danger: true });
    if (c === 1) fbSignOut();
  },
  'sign-out-now': () => fbSignOut(),
});

registerForms({
  'auth': (f) => { if (!AUTH.busy) submitAuth(f); }
});

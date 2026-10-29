// Boot. Imports every module (screens register themselves on import), then picks a backend:
// claude runtime db -> shared db; otherwise Firebase when configured; otherwise localStorage.
import { FIREBASE_CONFIG, startFirebase } from './firebase.js';
import { S } from './state.js';
import { startDb, startLocal, wantNames } from './store.js';
import { applyTheme, ensureHeadMeta } from './ui.js';
import { LS_THEME, hasClaude, lsGet } from './util.js';
import './screens/onboarding.js';
import './screens/today.js';
import './screens/timeline.js';
import './screens/history.js';
import './screens/insights.js';
import './screens/dog.js';
import './screens/settings.js';
import './io.js';
import './actions.js';

/* =========================================================
   Boot
   ========================================================= */
export async function init() {
  applyTheme(lsGet(LS_THEME) || 'system');
  ensureHeadMeta();
  const fbCfg = (typeof window.__PAWLOG_FIREBASE_CONFIG !== 'undefined') ? window.__PAWLOG_FIREBASE_CONFIG : FIREBASE_CONFIG;
  if (!hasClaude()) { if (fbCfg) startFirebase(fbCfg); else startLocal('standalone'); return; }
  let db = null, user = null;
  try {
    const r = await Promise.all([window.claude.use('db').catch(() => null), window.claude.use('user').catch(() => null)]);
    db = r[0]; user = r[1];
  } catch (e) { db = null; }
  if (!db) { if (fbCfg) startFirebase(fbCfg); else startLocal('nodb'); return; }
  S.user = user || null;
  let uid = null;
  try { uid = user ? await user.id() : null; } catch (e) { uid = null; }
  S.me = uid;
  // Write permission on the shared logbook: true/false from the platform, or null (unknown → let a refused write decide).
  let cw = null;
  try { cw = user ? await user.can('data.write') : null; } catch (e) { cw = null; }
  S.canWrite = cw;
  if (cw === false) { S.readOnly = true; document.body.classList.add('ro'); }
  startDb(db);
  if (uid) wantNames([uid]);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

// Utilities, icons and constants. No imports: safe to use at module top level anywhere.
/* =========================================================
   Utilities
   ========================================================= */
export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = (n) => String(n).padStart(2, '0');
export const ds = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const pd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const todayStr = () => ds(new Date());
export const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
export const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
export const fmt = (s, o) => pd(s).toLocaleDateString(undefined, o);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const genId = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
export const round1 = (v) => Math.round(v * 10) / 10;
export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
export function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
export const hasClaude = () => typeof window.claude !== 'undefined' && window.claude && typeof window.claude.use === 'function';

export const firstDayOfWeek = (() => {
  try {
    const loc = new Intl.Locale(navigator.language || 'en-US');
    const wi = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (wi && wi.firstDay) return wi.firstDay % 7; // 7 (Sun) -> 0
  } catch (e) { /* ignore */ }
  return /^en-(US|CA)|^ja|^he|^pt-BR/i.test(navigator.language || 'en-US') ? 0 : 1;
})();

/* =========================================================
   Icons
   ========================================================= */
export const PAW = '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><ellipse cx="32" cy="42" rx="13" ry="11"/><ellipse cx="15" cy="27" rx="6" ry="7.5"/><ellipse cx="25" cy="15" rx="6" ry="8"/><ellipse cx="39" cy="15" rx="6" ry="8"/><ellipse cx="49" cy="27" rx="6" ry="7.5"/></svg>';
export const sv = (p, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + p + '</svg>';
export const I = {
  today: sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  history: sv('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/>'),
  insights: sv('<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>'),
  dog: '<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><ellipse cx="32" cy="42" rx="12" ry="10"/><ellipse cx="15.5" cy="28" rx="5.5" ry="7"/><ellipse cx="25" cy="16.5" rx="5.5" ry="7.5"/><ellipse cx="39" cy="16.5" rx="5.5" ry="7.5"/><ellipse cx="48.5" cy="28" rx="5.5" ry="7"/></svg>',
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  chevL: sv('<path d="m15 18-6-6 6-6"/>'),
  chevR: sv('<path d="m9 18 6-6-6-6"/>'),
  chevD: sv('<path d="m6 9 6 6 6-6"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  x: sv('<path d="M18 6 6 18M6 6l12 12"/>'),
  camera: sv('<path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z"/><circle cx="12" cy="13" r="3.5"/>'),
  flame: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 3.2-1.2 5-2.7 6.6C7.8 10.2 6 12 6 15a6 6 0 0 0 12 0c0-2.6-1.2-4.6-2.6-6.1.1 1.7-.6 3-1.9 3.6.4-3.7-.8-7.5-1.5-10.5Z"/></svg>',
  check: sv('<path d="M20 6 9 17l-5-5"/>'),
  cloud: sv('<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19Z"/>'),
  copy: sv('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: sv('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
  up: sv('<path d="m18 15-6-6-6 6"/>'),
  down: sv('<path d="m6 9 6 6 6-6"/>'),
  search: sv('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  edit: sv('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  cal: sv('<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
  download: sv('<path d="M12 3v12m0 0-5-5m5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  upload: sv('<path d="M12 15V3m0 0L7 8m5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  archive: sv('<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>')
};

/* =========================================================
   Constants
   ========================================================= */
export const COLS = ['dogs', 'behaviors', 'entries', 'events', 'photos', 'settings'];
export const DEFAULT_BEHAVIORS = [
  ['Energy', '⚡', 'Sluggish', 'Bouncing off walls', true],
  ['Obedience', '🎯', 'Ignored me', 'Perfect listener', true],
  ['Leash manners', '🦮', 'Pulled hard', 'Loose leash', true],
  ['Reactivity', '🚨', 'Calm', 'Very reactive', false],
  ['Anxiety', '😟', 'Relaxed', 'Very anxious', false],
  ['Appetite', '🍖', "Wouldn't eat", 'Ate everything', true],
  ['Sociability', '🐕', 'Kept to self', 'Super friendly', true],
  ['Overall mood', '😊', 'Rough day', 'Best day ever', true]
];
// Per-behavior colour, cycling through the six --b1..--b6 tokens by behavior order (index 0 -> --b1).
export const behaviorColor = (index) => 'var(--b' + ((((Number(index) || 0) % 6) + 6) % 6 + 1) + ')';
export const DEFAULT_TAGS = ['Great walk', 'Zoomies', 'Barked at mailman', 'Ate something bad', 'Vet visit', 'Met a new dog', 'Training session', 'Bath day', 'Chewed something', 'Slept a lot'];
// Health-record types. icon = inline SVG (no emoji as UI icons).
export const EVENT_TYPES = {
  vet: { label: 'Vet visit', icon: sv('<path d="M5 3v5a4 4 0 0 0 8 0V3"/><path d="M9 12v3a5 5 0 0 0 10 0v-2"/><circle cx="19" cy="11" r="2"/>') },
  vaccine: { label: 'Vaccine', icon: sv('<path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3a1 1 0 0 1-1.4 0l-2.6-2.6a1 1 0 0 1 0-1.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"/>') },
  medication: { label: 'Medication', icon: sv('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>') },
  grooming: { label: 'Grooming', icon: sv('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>') },
  training: { label: 'Training', icon: sv('<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>') },
  milestone: { label: 'Milestone', icon: sv('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>') },
  incident: { label: 'Incident', icon: sv('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>') }
};
// Dog avatar colors: the Scrapbook behavior palette (--b1..--b6). #D9480F/#0C8599 are nudged one step darker
// (#C4410C = --accent-fill, #0B7285) so the white initial clears 4.5:1; inkOn() picks the initial color.
export const DOG_COLORS = ['#C4410C', '#7048E8', '#0B7285', '#2F9E44', '#C2255C', '#E67700'];
// Older saved dog colors from the raw behavior palette render one step darker so the white initial reads.
export const avatarBg = (c) => ({ '#D9480F': '#C4410C', '#0C8599': '#0B7285' })[String(c || '').toUpperCase()] || c;
// Readable initial color (white or ink) for an avatar background hex; falls back to white.
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return 'var(--ink)'; // token bg (e.g. --surface-3)
  const lin = (i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  const cw = 1.05 / (L + 0.05), ci = (L + 0.05) / (0.0137 + 0.05); // vs #FFFFFF / vs #2B1B0E
  return ci > cw ? '#2B1B0E' : '#FFFFFF';
}
export const SIZES = {
  small: { label: 'Small', hint: 'under 10 kg', senior: 10, rate: [15, 24, 4] },
  medium: { label: 'Medium', hint: '10–25 kg', senior: 8, rate: [15, 24, 5] },
  large: { label: 'Large', hint: '25–45 kg', senior: 7, rate: [15, 24, 6] },
  giant: { label: 'Giant', hint: '45 kg +', senior: 6, rate: [12, 22, 7] }
};
export const VIEWS = ['today', 'history', 'insights', 'dog', 'prefs'];
export const LS_DATA = 'pawlog:data:v1', LS_PHOTOS = 'pawlog:photos:v1', LS_FULL = 'pawlog:photos-full:v1', LS_THEME = 'pawlog:theme', LS_BANNER = 'pawlog:banner-dismissed', LS_PREFS = 'pawlog:prefs:v1';
// Shared store root: everyone with access to the artifact reads/writes the same logbook.
// pawlog/main is a document path (2 segments); collections live below it: pawlog/main/<col>/<id>.
export const SHARED_ROOT = 'pawlog/main';

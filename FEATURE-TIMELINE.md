# Feature brief: Through-the-day timeline + Training log

Owner's request: (1) log training sessions with the drills covered and notes; (2) log *when* behaviors happen (e.g. when the dog was most energetic) and see trends of energy through the day over time, especially alongside activities (walks, meals, play, training…).

Read ARCHITECTURE.md and REDESIGN.md (Scrapbook design system — use its tokens/classes: `.panel`, `.hero`, `.chip`, `.hand`, `--b1..--b6`, `--accent-text`, etc.). Copy is gender-neutral and uses the dog's name. ≥44px targets, ≥4.5:1 text contrast, light + dark, no emoji as UI icons (inline SVG; behavior emoji the owner chose are content and fine). Don't run git.

## Data model (shared contract — both agents code against exactly this)

All docs live in the shared store (`pawlog/main/<collection>/<id>` via `Store.put/del/patch`), per dog via `dogId`. Every doc also carries `createdBy`, `createdAt`, `updatedBy`, `updatedAt` like existing docs. Times are LOCAL wall-clock strings.

- **moments/<id>** — a timestamped behavior reading.
  `{ id, dogId, date: 'YYYY-MM-DD', time: 'HH:MM', behaviorId, value: 1-10, activity: <activity type key>|null, note: '' }`
  `activity` = what was happening / had just happened (optional).
- **activities/<id>** — something the dog did at a time.
  `{ id, dogId, date, time: 'HH:MM', type, durationMin: number|null, note: '' }`
  `type` ∈ `walk, meal, play, nap, daycare, car, visitors, bath, other` (constant `ACTIVITY_TYPES` with label + icon key, exported from js/state.js).
- **training/<id>** — a training session (counts as an activity of type `training` for timeline + analytics; do NOT also create an activities doc).
  `{ id, dogId, date, time: 'HH:MM', durationMin: number|null, location: '', focus: '', engagement: 1-10|null, drills: { <drillId>: { result: 1|2|3, reps: number|null, note: '' } }, notes: '' }`
  result: 1 = struggled, 2 = getting there, 3 = nailed it. `drills` is a MAP (so two people editing merge per drill).
- **drills/<id>** — the dog's drill library.
  `{ id, dogId, name, category, order, archived: false }`
  category ∈ `Basics, Leash, Recall, Manners, Tricks, Custom`. Suggestions constant `DRILL_SUGGESTIONS` (js/state.js): Sit, Down, Stay, Recall, Wait at door, Heel, Loose-leash walking, Leave it, Drop it, Place, Settle, Look at me, Touch, Off, Crate, Spin, Paw, Roll over (each with a category).

In-memory: `S.moments`, `S.activities`, `S.training`, `S.drills` (same shape as other collections in S — check how `S.entries`/`S.events` are held and mirror it). Helpers in js/state.js: `momentsFor(dogId, from?, to?)`, `activitiesFor(...)` (returns activities PLUS training sessions mapped to `{...,type:'training', trainingId}`), `trainingFor(...)`, `drillsFor(dogId, {includeArchived})`, `ACTIVITY_TYPES`, `DRILL_SUGGESTIONS`.

## Agent L — Logging (owns: js/store.js, js/state.js, js/io.js, js/screens/today.js, css/today.css, NEW js/screens/timeline.js, NEW css/timeline.css, js/screens/history.js, css/history.css, js/screens/settings.js, css/settings.css, index.html, js/main.js)
1. Store: add the 4 collections to `SUB_COLS` (and the local + claude-db modes); export/import (JSON) include them; CSV export adds moments/activities/training rows if simple.
2. Today: new section **"Through the day"** (after behaviors, before tags) showing the viewed date's timeline sorted by time: moments (behavior emoji/name + value pill colored by behavior color + activity + note), activities (icon, label, duration), training sessions (icon, focus, "4 drills · 20 min", result summary). Each item shows a small byline when logged by someone else. Tap → edit sheet (with Delete). Three buttons: **+ Moment**, **+ Activity**, **+ Training** (write-guarded; hidden in read-only).
   - Moment sheet: behavior chips (default Energy if present, else first behavior), big chunky 1–10 slider, time (defaults to now when viewing today, else 12:00; native time input, ≥44px), "What was happening?" activity chips (optional), note. A one-tap shortcut row on Today for the default behavior is welcome ("Energy right now: Low · Medium · High" → 3/6/9) if it stays tidy.
   - Activity sheet: type chips, time, duration (quick chips 10/20/30/60 + custom), note.
   - Training sheet: time, duration, location, focus, engagement slider (optional), drill picker from the dog's library (chips; tapping adds it to the session) with per-drill 3-state result control (Struggled / Getting there / Nailed it) + optional reps + note; "+ New drill" inline (name + category) which also adds it to the library; session notes. Seed the library from `DRILL_SUGGESTIONS` lazily (show suggestions as add-chips when the library is empty; don't bulk-write docs on load).
3. Settings: a "Training drills" manager section (rename, change category, archive/restore, delete with archive-instead) — mirror the behavior manager pattern.
4. History: recent-page cards show small badges ("Training · 3 drills", "5 moments") and search covers moment/activity/training notes and drill names.
5. Live sync: remote changes to these collections re-render the timeline without clobbering an open sheet the user is typing in.

## Agent I — Insights (owns: NEW js/analytics.js, js/screens/insights.js, css/insights.css)
Pure functions in js/analytics.js (no DOM), rendered in Insights, respecting the existing range selector (7d/30d/90d/All) and active dog. Read data via the helpers above (if Agent L hasn't landed them yet, read `S.moments` etc. directly with a small local fallback so you can test with injected data).
1. **"Biscuit through the day"** card: behavior selector chips (behaviors that have moments; default Energy). Chart of average value by hour of day (bucket by hour, light smoothing across adjacent hours, show only hours with data, x axis 6am–11pm-ish auto-fit), dots sized/opacity by sample count, ink line in the behavior color. Under it an **activity strip**: when activities/training usually happen (marks per hour by type). Headline in Caveat: "Most energetic around 5–7 pm" / calmest window. Needs ≥5 moments; otherwise a friendly empty state explaining how to log moments.
2. **"What changes it"** card: for each activity type (incl. training) with ≥3 occurrences in range, compare the selected behavior's moments in the 2h AFTER that activity vs the 2h BEFORE (same day), and moments tagged with `activity` = that type; show as rows "After walks · energy ↓ 2.1 (8 times)" with a small diverging bar; respect higher-is-better for color (good/bad text tokens). Hide rows with <3 paired samples; explain "Not enough data yet" otherwise.
3. **"Training"** card: sessions + minutes in range, sessions/week sparkline, per-drill rows (drill name, times practiced, latest result as 3-dot meter, trend arrow from first half vs second half of range, "nailed it" rate), "Needs practice" = drills not practiced in 14+ days or mostly struggled; recent session notes (last 3, tap → open that day on Today).
4. Keep all existing Insights cards working. Charts accessible (`role="img"` + aria-label summary).

## Testing
Each agent serves the repo on its own port (L: 8791, I: 8792) and keeps the existing suite passing: /tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/final-tests/ (run_all.sh uses port 8780 — copy the suite into your own folder and change the port). Add tests for your features. Agent I: inject realistic fake data (e.g. 30 days with 3–6 moments/day, walks at 7am/6pm, meals, a few training sessions) into localStorage mode to exercise and screenshot the charts. Screenshots (390×844, light + dark) to /tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/feature-shots/<L|I>/. The other agent is editing other files at the same time; if something outside your files breaks, report it, don't fix it.

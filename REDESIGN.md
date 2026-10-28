# Scrapbook redesign brief (shared by all redesign agents)

Mockups (static design specs — read for look & layout, don't copy their DC runtime syntax):
/tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/styles/project/
- Scrapbook.dc.html (Today), ScrapHistory.dc.html, ScrapInsights.dc.html, ScrapDog.dc.html, ScrapTrack.dc.html (onboarding "What to track").

Read ARCHITECTURE.md first. **Edit ONLY the files you own** (listed in your task). Other agents are editing the other files at the same time.

## Shared design tokens (CSS custom properties on :root, defined in css/base.css by the Foundation agent)
Existing names keep their meaning; values change. New names marked NEW. Screen agents: use these names; do not hard-code colors.

| Token | Light | Dark |
|---|---|---|
| --bg | #FFF4DE | #1E1610 |
| --surface | #FFFFFF | #2A2018 |
| --surface-2 | #F3E6CC | #3A2C20 |
| --surface-3 | #E9D9BC | #4A3A2A |
| --ink | #2B1B0E | #F7ECD8 |
| --ink-2 | #5C4630 | #D8C7AA |
| --ink-3 | #7A5A3A (text ≥ 4.5:1 on --bg) | #B9A584 |
| --line (subtle dividers) | #E9D9BC | #4A3A2A |
| --border NEW (chunky ink outlines) | #2B1B0E | #F3E6CC |
| --bw NEW | 2.5px | 2.5px |
| --bw-strong NEW | 3px | 3px |
| --hero NEW (sticker yellow cards, active tab pill) | #FFD25A | #E8B93C |
| --hero-ink NEW | #2B1B0E | #2B1B0E |
| --pop NEW (offset shadow) | 5px 5px 0 var(--border) | same |
| --pop-sm NEW | 3px 3px 0 var(--border) | same |
| --accent | #D9480F | #FF8A50 |
| --accent-ink | #FFFFFF | #2B1B0E |
| --b1 … --b6 NEW per-behavior colors (cycle by behavior order) | #D9480F #7048E8 #0C8599 #2F9E44 #C2255C #E67700 | #FF8A50 #9C84FF #3BC9DB #69DB7C #F783AC #FFA94D |
| --cal-none NEW / --cal-rough / --cal-okay / --cal-great | #F3E6CC / #F7B5A0 / #FFD25A / #8CD3A0 | #3A2C20 / #A8503C / #B8902A / #3E8F58 |
| --good / --bad | #2F9E44 / #D9480F | #69DB7C / #FF8A50 |
| --font-display | "Fraunces", Georgia, serif (800 headings, 600–700 card titles) | |
| --font-body | "Bricolage Grotesque", system-ui, sans-serif | |
| --font-hand NEW | "Caveat", cursive (small handwritten accents only, ≥18px, weight 700) | |
| --r-lg / --r-md / --r-sm | 22px / 18px / 12px | |

Shared component classes (Foundation owns their CSS; screens use them): cards/panels get `border: var(--bw) solid var(--border)`; "hero" cards = `--hero` background + `--bw-strong` border + `--pop` shadow; chips are 44px-tall pills with ink border (selected = ink background, --bg text); primary buttons = --accent bg, ink border, --pop-sm shadow; floating dark pill tab bar with --hero active pill; polaroid treatment for photos: class `.polaroid` (white frame, ink border, slight rotation, optional `.tape` child).

## Copy
Gender-neutral; use the dog's name ("How Biscuit's doing", "Good day"), never "good boy/girl" or he/she. Playful but not cutesy-overload; handwritten accents sparingly.

## Behavior customization (cross-cutting, coordinated via registry action names)
- Settings agent owns the behavior manager sheet and registers actions: `behavior-new` (open add-behavior sheet for active dog) and `behaviors-manage` (open Settings › Behaviors / manager sheet).
- Today agent adds, at the end of the behavior list, a "+ Add behavior" button (`data-a="behavior-new"`) and an "Edit" link (`data-a="behaviors-manage"`). Check how actions are wired (data attribute name) in js/actions.js and use the same convention.
- Onboarding agent: after the dog form, a "What do you want to track for <name>?" step (ScrapTrack mockup): basics pre-selected, idea chips, custom add field, "Start logging · N behaviors". Prior finished WIP code for this (and for the Today buttons/manager) exists in /tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/index.behaviors-scrapbook-WIP.html — mine it (search for the picker/behavior manager code), adapting to the modular structure.
- Defaults: "Potty accidents" removed from default behaviors for NEW dogs (constant lives in js/util.js or state.js — Foundation agent owns that change).

## Quality bar
≥44px tap targets; text contrast ≥ 4.5:1 (check your actual colors, incl. dark mode); no horizontal scroll at 375 and 390 widths; safe-area insets respected; works in light and dark (`data-theme` and prefers-color-scheme); reduced motion respected; no emoji as UI icons (inline SVG). Keep all existing functionality and tests passing.

## Testing
Serve with `python3 -m http.server <your port> --bind 127.0.0.1 --directory /home/claude/pawlog-gh` (use the port given in your task). Test scripts that worked on the modular build: /tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/t2/ (copy to your own folder before modifying). Screenshot your screens at 390×844 light + dark into /tmp/claude-0/-home-claude/2183d7fc-7937-5032-9b92-e3a946eb1ea8/scratchpad/redesign-shots/<your-agent-name>/. Other agents' files may be mid-edit while you test — if something outside your files breaks, note it in your report rather than fixing it.
Don't run git.

# Hyperframes Composition Brief: LicorPlus

## Objective
Create a short launch-style brag video for LicorPlus, a multitenant night-bar POS.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `/Users/apple/Documents/CLIENTES/licorplus`
- Primary files read: `web/index.html`, `web/tailwind.config.js`, `README.md`, `PRODUCT.md`, `CLAUDE.md`, `web/src/components/FloorPlan.jsx`, `web/src/pages/NuevaVenta.jsx`, `web/src/pages/Caja.jsx`
- Product name: LicorPlus
- Tagline / strongest claim: "El POS que sí entiende un bar." (invented outro line, consistent with the product's real positioning — it is not quoted from any file)
- Key UI or visual moment to recreate: the bar floor plan (`FloorPlan.jsx`) — a grid of tables with oversized bold numbers (`text-mesa` token: 2.25rem/800 weight/-0.03em) and three status-dot colors (verde=libre, ámbar=reservada, rojo=ocupada); and the live pre-order approval flow described in `CLAUDE.md` under "Operación" (mesera sends → `OrderItem.status = PENDING` → table border turns amber via WebSocket → admin or cashier approves → `ACTIVE`)
- Copy that must appear verbatim (concepts grounded in the project, lines may be trimmed/re-cased but must not invent capabilities):
  - "Enviar pedido a la barra" — real button label from `CLAUDE.md`'s UI-copy rule (exact phrasing the spec gives as an example of a button that says exactly what happens)
  - The pre-order rule: the waitress sends the order, it does not reach the bar until admin or cashier approves it (from `CLAUDE.md` "Operación")
  - The discount rule: editing the total redistributes by margin; if the new total would fall below the account's total cost, paying is blocked (from `CLAUDE.md` "Descuentos al cerrar")
  - The receipt rule: original value, discount, and amount paid print as three separate lines; invoice numbers never reset (from `CLAUDE.md` "Consecutivo de facturas" / "Descuentos al cerrar")

## Creative Direction
- Tone preset: polished
- Creative direction: a quiet, confident product film for a bar that operates after dark — one amber light in a dark room, not a party video
- Interpretation: 4 scenes, longer holds, restrained motion; the amber accent is the one bold gesture allowed; cuts feel deliberate
- Angle: This isn't a toy demo — it's software shaped by a real conversation with a real bar owner in Medellín. The video shows two moments where LicorPlus makes a deliberately opinionated call a generic POS wouldn't: the pre-order must be approved by someone other than the waitress who sent it (on purpose), and a tab can never close below its own cost.
- Hook: black screen; the floor plan draws itself out of the dark — zones, grid, oversized table numbers snapping in, status dots lighting up one by one (green, amber, red). No text yet.
- Outro / punchline: pull back to the full, calm, mostly-green floor plan; "LicorPlus" logo lockup; tagline "El POS que sí entiende un bar."
- Avoid:
  - Generic SaaS language ("streamline", "all-in-one", "effortless")
  - Abstract filler visuals unconnected to the real screens
  - Any invented metric, user count, or feature not in the project
  - Showing ml/shot math as a serving instruction (the product's own rule: ml are never shown to staff, only "quedan ~N shots" — if ml appear on screen at all, they appear strictly as an internal/inventory concept, not operational guidance)

## Visual Identity
- Background: `#0E0C13` (night)
- Secondary surfaces: `#171420` (surface), `#211D2C` (raised), `#2E2939` (edge)
- Text: `#F2EFE8` (ink) primary, `#9A93A8` (muted) secondary
- Accent: `#E8A33D` (amber) — the single bold color in the system
- Status colors: `#5FD18C` (libre/green), `#E8A33D` (reservada/amber), `#E05252` (ocupada/red)
- Display font: Archivo, heavy weight (800) for table numbers, tight letter-spacing (-0.03em) — this is the project's actual "hero" type treatment
- Body font: Archivo
- Visual references from the project: the floor-plan grid of tables with colored status dots; the oversized table-number treatment; the dark/amber color system; a tab/cart panel with line items; a "Total a cobrar" numeric readout; a printed receipt/tirilla layout with original value / discount / paid as separate lines and an invoice number

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The room wakes up — 4s — floor plan draws in, tables cascade, status dots light up one by one. No text.
2. Someone else has to say yes — 7s — product tap flies into tab, "Enviar pedido a la barra" sent, cut to floor plan where the table turns amber live with a pending badge, gets approved. Text: "La mesera manda. Otro aprueba."
3. It never closes at a loss — 7s — triple-click reveals discount field, total edit ripples a margin-based highlight across line items, a cost-floor catch (brief red flash → resolved), receipt slides out with original/discount/paid lines and an invoice number count-up. Text: "Nunca se cierra una cuenta a pérdida."
4. Outro — 2s — floor plan calm and green, LicorPlus logo lockup + tagline, held for full duration.

## Audio
- Audio role: sparse professional accents over a confident, driving electronic bed
- Audio arc: low under the hook, builds slightly through the two flow scenes, settles for the outro, short fade on logo landing
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (already copied to `brag-output/composition/assets/music/`)
- Music treatment: start low, build into Scene 2/3, fade out under the Scene 4 logo
- Music cue guidance: bundled preset at `.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json` (full track) / `.music-cues.md` (0-25s planning window), 120.19 BPM. Strong cues in window: 16.02s, 17.02s, 17.52s, 18.02s, 18.52s, 20.02s, 21.01s, 22.01s, 23.02s, 23.52s. Suggested: lock the Scene 3 cost-floor-resolves beat near 17.02s or 18.02s, and the Scene 4 logo landing near 20.02s. Beat grid from ~3.02s onward at roughly 0.5s spacing is available for Scene 1's table/dot cascade — snap sequential arrivals to every other beat so each one gets a full read.
- Audio-reactive treatment: subtle — the amber glow on the hero table (Scene 1) and the logo (Scene 4) may breathe slightly with music energy; no waveform bars or literal visualizers
- Audio-coupled moments:
  - Scene 1 — sequential table/dot cascade — soft ticks on each arrival, snapped to the beat grid
  - Scene 2 — product tap-and-fly into the tab — tap + whoosh; distinct notification ping exactly when the table flips amber; lighter confirm tick on approval
  - Scene 3 — triple-click reveal — three quick click ticks; a soft denied/alert blip at the brief red flash; an unlock/confirm tone when it resolves; a print/till sound as the receipt lands and the invoice number ticks up
  - Scene 4 — logo landing — one light accent chime, timed near the ~20s cue
- SFX selection guidance: this product is full of small, satisfying taps (product adds, sends, approvals, clicks) — SFX should sell those real interactions, not add generic whoosh-everywhere noise
- SFX analysis guidance: use `.claude/skills/brag/assets/sfx/sfx-analysis.md` if present; prefer lower high-frequency-risk sounds for the repeated tick/click moments
- Exact SFX choice: Hyperframes chooses exact filenames, timestamps, density, and volume based on the implemented animation
- Audio files: music already copied to `brag-output/composition/assets/music/`; Hyperframes should copy any selected SFX into `brag-output/composition/assets/` as well

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-cli`. `/brag` is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project (the floor plan grid, the tab/line-item panel, the receipt layout).
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds (target 20s).
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints; ignore cues that hurt readability, scene pacing, or the product story. Use only 1-3 strong cue locks.
- Use SFX to support motion and interaction: tap/click sounds for user actions, a notification-style ping for the live table-status flip, a print/till sound for the receipt, restraint elsewhere.
- Honor the planned music treatment (build through the middle scenes, fade under the final logo).
- Consider the Hyperframes audio-reactive workflow for subtle glow/presence on the hero table and logo; avoid waveform/equalizer visuals, musical-note graphics, particle systems, strobing, or heavy pulsing.
- Use local assets for audio and any required runtime/media dependencies.
- Run `hyperframes check` before render — it is brag's single gate.
- Keep creation and rendering local. Remote or publishing workflows require a separate explicit user request.

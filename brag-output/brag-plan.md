# Brag Plan: LicorPlus

## What is this app?
LicorPlus is a multitenant POS for night-time bars that models liquor the way a real bar sells it — open bottles counted in milliliters, shots as single-ingredient recipes tied to an actual brand, never a fake "variant" — and measures missing vs. extra stock without ever blocking a sale or accusing anyone.

## The angle
This isn't a toy demo — it's software built from a real conversation with a real bar owner in Medellín, and it shows. The angle: walk through three moments where LicorPlus makes a deliberately opinionated call that a generic POS wouldn't — the pre-order has to be approved by someone other than the waitress (on purpose), and a bar can never close a tab at a loss. Confident, quiet, a little nocturnal. The product looks like the bar it was built for: dark room, one amber light.

## Hook (first 2-3 seconds)
Black screen. The bar's floor plan draws itself in out of the dark — zones, grid, table numbers snapping in heavy and oversized (the table number is the hero of this screen, by design). Status dots light up one by one: green, amber, red. No text yet — just the room waking up.

## Key moments (the middle)
- **The pre-order flow, live:** a waitress taps a product, it visually flies into the tab, she sends it — and it does NOT go to the bar. It sits as a pending order. Cut to the floor plan: that table's border turns amber in real time (WebSocket), with a small badge in the side panel. Either the admin or the cashier can approve it — the waitress can't. The bottleneck is intentional.
- **Closing a tab that can't lose money:** the secret triple-click on "Total a cobrar" reveals the discount field. Typing a lower total redistributes the discount across line items by margin — the item with the fattest margin absorbs more of the cut — and if the new total would dip below the real cost of the tab, the pay button locks and the modal flags it in red. The receipt prints the original value, the discount, and what was actually paid, separately, with a running invoice number that never resets.

## Outro / punchline
Pull back to the full floor plan, calm and green. Logo lockup: **LicorPlus**. Tagline: a POS that actually knows how a bar runs itself.

## User flow worth showing
1. Entry: waitress opens an occupied table, taps "Shot Antioqueño" from the product list — it flies into the tab as a line item.
2. Key action: she sends the order. It stays pending, doesn't reach the bar. On the admin/cashier's floor plan, that table's border turns amber live, with a pending badge. One of them approves it with a tap — it becomes an active order.
3. Result: at close-out, the triple-click discount flow runs, the total redistributes by margin, the pay button validates against cost, and a numbered receipt prints.

## Tone
- Preset: polished
- Creative direction: a quiet, confident product film for a bar that operates after dark — one amber light in a dark room, not a party video
- Interpretation: fewer, longer-held scenes; restrained motion; the amber accent is the one bold gesture allowed; cuts feel deliberate, not frantic

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: `#0E0C13` (night), secondary surface `#171420`, raised panels `#211D2C`, edges `#2E2939`
- Accent: `#E8A33D` (amber) — the one bold color in the system
- Text: `#F2EFE8` (ink) primary, `#9A93A8` (muted) secondary
- Status colors: libre `#5FD18C` (green), reservada/amber `#E8A33D`, ocupada `#E05252` (red)
- Display font: Archivo (bold/800 weight for table numbers — oversized, tight letter-spacing)
- Body font: Archivo
- Strongest visual element: the floor plan — big bold table numbers, color-coded status dots, and a table border changing color live

## Share copy (draft)
LicorPlus ya aprueba pedidos en vivo, reparte descuentos sin que ninguna cuenta se cierre a pérdida, y no te deja vender shots donde no debe. Construido para un bar real, no para una demo.

## Audio direction
- Role: sparse professional accents over a confident, driving electronic bed — restrained, not festive
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120 BPM, bundled)
- Music treatment: starts low under the hook, builds slightly into the flow scenes, settles for the outro line, short fade on the logo landing
- Music cue guidance: preset read from `happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.md`. Target strong cues near 16.02s / 17.02s / 18.02s for the discount-validation beat in Scene 3, and near 20.02s for the outro landing. Beat grid (~0.5s spacing from ~3.0s on) available for any sequential reveals in Scene 1's table cascade — snap every other beat so each table/dot reveal gets a full read, not a flash.
- Audio-reactive treatment: subtle — the amber glow on the hero table/logo may breathe slightly with the music's energy; no waveform bars, nothing literal
- SFX posture: moderate, motion-matched — this product is full of small satisfying taps and the SFX should sell that
- Audio-coupled moments: table/dot cascade in Scene 1 (soft sequential ticks), product-tap-and-fly in Scene 2 (tap + whoosh), amber notification ping when the table flips status, triple-click ticks in Scene 3, lock/lock-denied cue vs. unlock/valid cue on the discount check, receipt print sound on invoice number landing
- Restraint rule: never let the beat force a line of text to flash by faster than its reading floor; the triple-click and receipt-print sounds should feel like real UI, not a music sting

## Storyboard

### Scene 1 — The room wakes up — 4s
Black fades to the bar's floor plan. Zones and grid draw in, then table numbers snap in heavy and oversized, cascading across the grid. Status dots light up one by one — green, amber, red — settling into the full layout. No text. Just the dark room and the one amber light turning on.
Sequential/interaction: yes — tables/dots populate one by one across the grid, snapped to beat-grid ticks (every other beat) so each arrival reads clearly, not as a flash.
Audio intent: anticipation, a room coming alive
Audio-coupled idea: soft sequential ticks on each table/dot arrival, synced to the beat grid
Music: low, restrained bed, building
Transition mood: soft crossfade → Scene 2

### Scene 2 — Someone else has to say yes — 7s
Cut into the order screen: a waitress taps "Shot Antioqueño" from the product list; it visually flies into her tab as a new line. She taps "Enviar pedido a la barra." The card confirms sent — but flags pending, not active. Hard cut to the floor plan on another screen: that same table's border flips to amber live, with a small "1 pre-pedido" badge in a side panel. A cursor taps to approve; the border resolves to the active/occupied color.
Text (short, appears once things settle): "La mesera manda. Otro aprueba." — held at full legibility before cutting.
Sequential/interaction: yes — tap product → fly animation → line appears → send tap → cut to table turning amber → approve tap → table resolves.
Audio intent: a quick satisfying action, then a beat of live tension (amber), then release (approved)
Audio-coupled idea: tap/whoosh on the product fly, distinct notification ping exactly when the table flips amber, a lighter confirm tick on approval
Music: driving under the action, no lyrics-style peak yet
Transition mood: clean hard cut → Scene 3

### Scene 3 — It never closes at a loss — 7s
Cash-out screen. A cursor triple-clicks the "Total a cobrar" number; a discount field reveals itself. Typing a lower total ripples a proportional highlight across the line items (the highest-margin item glows more, taking more of the cut). The total visually bumps against a cost floor — show it almost cross the line and the pay button catching it, flashing a brief red warning, then settling to a valid green-lit total. Pay button confirms; a numbered receipt slides out showing original value, discount, and amount paid as three separate lines, with the invoice number ticking up.
Text (short, after the validation beat): "Nunca se cierra una cuenta a pérdida."
Sequential/interaction: yes — triple-click reveal → type/drag total down → line-item highlight ripple by margin → cost-floor catch (brief red → resolved) → pay tap → receipt slide-out with number count-up.
Audio intent: a little mischief (the secret triple-click), a held breath at the cost-floor catch, satisfaction on the clean receipt print
Audio-coupled idea: three click ticks for the triple-click, a soft denied/alert blip at the red flash, an unlock/confirm tone when it resolves, a print/till sound on the receipt landing — target near the 16-18s strong cues
Music: brief pull-back at the red flash, resolves back into the bed
Transition mood: soft crossfade → Scene 4

### Scene 4 — Outro — 2s
Pull back to the full floor plan, calm, mostly green. Logo lockup "LicorPlus" centers over it with the tagline beneath.
Text: "El POS que sí entiende un bar." — held for the full scene.
Sequential/interaction: none
Audio intent: quiet landing, confident close
Audio-coupled idea: one light accent chime as the logo settles, timed near the ~20s cue
Music: fades out under the logo
Transition mood: hard stop (end)

**Music mood for this video:** confident, driving, restrained — a product film, not a party
**Audio summary:** a low, driving bed carries the whole video with motion-matched UI sounds doing the real storytelling (tap, ping, click, print), building through the two flow scenes and settling to a quiet fade under the logo.

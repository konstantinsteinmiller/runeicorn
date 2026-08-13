# Roadmap — retention, playtime, and conversion

Every item is written against the shipped codebase, with the file it touches, a
concrete implementation, a **byte cost** (because the jam build has a hard
13,312 byte ceiling) and an effort estimate.

`JAM` = fits inside the 13kB budget, worth doing before submission.
`POST` = do it in the post-jam build where bytes are free.

## Priority order (highest value first)

| # | Feature | Metric moved | Bytes | Effort | When |
|---|---------|--------------|-------|--------|------|
| 1 | Campaign save | D1 retention | ~130 | 15 m | JAM |
| 2 | Self-drawing ghost trail | Pickup / conversion | ~260 | 30 m | JAM |
| 3 | Region star ratings | Playtime / replay | ~340 | 45 m | JAM |
| 4 | Danger state feedback | Hard-to-put-down | ~220 | 30 m | JAM |
| 5 | Kill combo multiplier | Hard-to-put-down | ~280 | 40 m | JAM |
| 6 | Threat preview on world map | "One more region" | ~180 | 25 m | JAM |
| 7 | Endless mode + score | Playtime | ~350 | 45 m | JAM |
| 8 | Between-region boons | Playtime (roguelite) | ~700 | 1.5 h | JAM* |
| 9 | Score card + Web Share | Conversion / virality | ~400 | 1 h | JAM* |
| 10 | Daily seeded Infection | D1 return | ~420 | 1 h | POST |
| 11 | New enemy archetypes | Playtime / depth | ~900 | 2 h | POST |
| 12 | Boss Citadel | Playtime / climax | ~800 | 2 h | POST |
| 13 | Unicorn variants | Depth / mastery | ~1.1 k | 2.5 h | POST |
| 14 | Accessibility modes | Reach / conversion | ~300 | 45 m | POST |
| 15 | Mobile ergonomics pass | Mobile conversion | ~250 | 1 h | POST |
| 16 | Leaderboard | D1 return | ~600 | 2 h | POST |
| 17 | Portal builds + rewarded ads | Monetization | n/a | 3 h | POST |
| 18 | Replay ribbon | Virality | ~900 | 3 h | POST |

`JAM*` = only if the budget allows after item 1–7; measure with `pnpm squeeze` first.

---

## 1. Campaign save `JAM`
**Metric:** Day-1 retention — a player who closes the tab mid-campaign currently loses everything.

**Implementation:** in `src/main.js`, write `{r: S.conquered, b: bestSwarm}` to
`localStorage.pol` inside `load()` and on `SC_CLEAR`. On boot, `load(saved.r)`
instead of `load(0)`. Wrap in try/catch — some portals block storage.
Add a one-line "Resuming: <region name>" hint so the restore is *visible*;
an invisible save does not create the feeling of progress that retains people.

## 2. Self-drawing ghost trail `JAM`
**Metric:** Pickup rate / conversion — the single biggest drop-off in a
drag-to-play game is a first-time player who does not realise they must drag.

**Implementation:** in `src/ui.js`, if `S.intro && S.t > 3`, draw an animated
dashed arc from the main hive toward the nearest grey castle, with the cursor
glyph from the storyboard sliding along it on a loop. Kill it the instant
`S.intro` goes to 0. Reuse `rainbow()` and the existing hint plate so it costs
almost nothing. This converts confused players into playing players.

## 3. Region star ratings `JAM`
**Metric:** Average playtime + replay — gives a reason to re-enter a cleared region.

**Implementation:** on `SC_CLEAR` in `src/sim.js`, award: ★ cleared, ★ cleared
under a per-region par time (store `par` in the region table in `world.js`),
★ main hive never dropped below 100% HP. Persist a `stars[]` array alongside
the save. Render stars on the world map nodes in `drawWorldMap`. Show
"★★☆ — clear without losing hive HP" on the cleared panel so the missing star
is a *specific* invitation, not a vague one.

## 4. Danger state feedback `JAM`
**Metric:** Hard-to-put-down — tension is what stops a player closing the tab.

**Implementation:** when `S.hive.hp < 35`, push a lowpass + heartbeat pulse in
`src/audio.js` (`setSwarm` already smooths; add a `danger(on)` that ramps a
BiquadFilter on the master bus), tint the vignette red in `fx.drawPost`, and
add a slow pulsing red rim on the hive in `sprites.drawCastle`. Near-loss that
you *survive* is the most memorable moment a jam voter can have.

## 5. Kill combo multiplier `JAM`
**Metric:** Hard-to-put-down — converts steady grinding into escalating spectacle.

**Implementation:** add `S.combo`, `S.comboT` to `state.js`. Every soldier kill
in `updateSoldiers` sets `comboT = 2.5` and increments the combo; dust gain
becomes `3 * (1 + combo/10)`. Raise the music bed's filter cutoff and add a
rising arpeggio note per combo tier in `audio.js`. Draw the multiplier as big
rainbow text near the swarm centroid. This makes a good route *feel* good.

## 6. Threat preview on world map `JAM`
**Metric:** "One more region" — the classic pull. Show the player exactly what
new thing is waiting.

**Implementation:** in `world.drawWorldMap`, under the next node, draw the icons
of what the region introduces ("2 Void Mages", "Fortified Citadel"). Curiosity
about a *named, visible* new threat is a far stronger hook than a number.

## 7. Endless mode + score `JAM`
**Metric:** Average playtime — gives the campaign a tail instead of a wall.

**Implementation:** `makeRegion(i)` already scales procedurally past `REGIONS`.
Add a persistent best-region + best-swarm score, show it on the defeat panel
("Best: Region 9 · 812 unicorns"), and label regions past the curated set as
"ENDLESS · Wave N". Near-zero cost, meaningful retention.

## 8. Between-region boons `JAM*`
**Metric:** Average playtime — turns a linear campaign into a roguelite run.

**Implementation:** on the world map, offer 3 of ~8 boons: `+40% hive spawn`,
`+1000 capacity`, `Overload costs 40`, `clones 2× on trails`, `soldiers drop
double dust`, `trails resist the first cut`, `main hive regenerates`,
`start each region with 40 unicorns`. Store as a flags/multipliers object read
by `sim.js`. Choice + build variety is the single largest playtime multiplier
available here; budget ~700 bytes and cut a decorative effect if needed.

## 9. Score card + Web Share `JAM*`
**Metric:** Conversion / virality during jam voting.

**Implementation:** on defeat/final clear, compose a card on an offscreen canvas
(peak swarm, castles converted, kills, region) and offer `navigator.share` /
clipboard copy of the score text plus the game URL. Every share is a free
funnel into the voting page.

## 10. Daily seeded Infection `POST`
**Metric:** Day-1 → Day-2 return, the strongest single retention lever.

**Implementation:** seed `makeRegion` with the UTC date, one attempt per day,
show yesterday's global best. `world.js` already uses a `seeded` PRNG, so this
is mostly UI plus a tiny backend (or a portal leaderboard API).

## 11. New enemy archetypes `POST`
**Metric:** Playtime / depth — one new counter changes every route decision.

**Implementation:** *Shield Phalanx* (immune from the front, must be flanked —
forces trails that loop behind), *Cavalry* (charges along your trail toward the
hive — punishes long undefended lines), *Void Obelisk* (permanent wound until
destroyed — forces an offensive detour). Each is a small object type plus a
branch in `updateSoldiers`.

## 12. Boss Citadel `POST`
**Metric:** Playtime + climax — campaigns need an ending players brag about.

**Implementation:** a castle with 3 shield phases; each phase break spawns a
mage ring and doubles soldier output. Reuse `drawCastle` with a larger radius
and a phase-tinted shield arc. Pair with a music intensity layer.

## 13. Unicorn variants `POST`
**Metric:** Mastery depth — gives the swarm texture instead of uniform motes.

**Implementation:** every 3rd converted hive spawns a variant: *Lancer*
(pierces phalanxes), *Prism* (splits into 3 on death), *Void-eater* (shrinks
wounds it touches). Add a `k` field on units, branch in `updateUnits`, and add
one atlas row per variant in `sprites.js`.

## 14. Accessibility modes `POST`
**Metric:** Reach and conversion — a meaningful share of players bounce off
heavy bloom and rainbow-on-grey.

**Implementation:** a settings toggle for (a) reduced motion — clamp
`shakeOffset` and flash to ~25%, honour `prefers-reduced-motion` by default,
(b) high-contrast mode — raise trail luminance, drop grain and vignette,
(c) colourblind-safe palette — swap `PAL` in `fx.js` and the trail ramp for a
blue/orange/white scale. All three are palette and multiplier swaps.

## 15. Mobile ergonomics pass `POST`
**Metric:** Mobile conversion — most portal traffic is touch.

**Implementation:** move the Overload button into the bottom-third thumb arc,
add `navigator.vibrate` on conversion/overload, prevent scroll-bounce with
`touch-action: none` (already set), enlarge hit targets to 48 CSS px, and
detect low-end devices via `hardwareConcurrency` to auto-lower `UNIT_CAP` and
`PART_CAP`. Test on a real 360×640 device.

## 16. Leaderboard `POST`
**Metric:** Day-1 return + competitive retention.

**Implementation:** highest region + peak swarm, submitted per run. Use a
portal-native leaderboard where available (CrazyGames/Playgama) so there is no
backend to run, with a local-only fallback.

## 17. Portal builds + rewarded ads `POST`
**Metric:** Monetization and distribution.

**Implementation:** the multi-platform build matrix (CrazyGames, Playgama,
GamePix, GameMonetize). Natural rewarded-ad placement: *"Watch to start the
region with a full Overload charge"* — value without pay-to-win. Mandatory
platform rules: mute all audio for the ad's duration, fire `gameplayStop()`
before the ad and `gameplayStart()` after, gate the rewarded button on
readiness, and show any interstitial **before** the result panel, never over it.

## 18. Replay ribbon `POST`
**Metric:** Virality — the conversion explosion is the game's screenshot moment.

**Implementation:** record a ring buffer of the last ~4 seconds of swarm
positions (downsampled), then replay it on the score card as a looping
animation. Cheaper and prettier than video capture, and it shows the exact
moment a castle fell.

---

## Instrumentation to add first (POST)

None of the above should be prioritised on instinct once the game is on a
portal. Log five events and let them rank the list: `region_start`,
`region_clear`, `region_fail`, `first_trail_drawn` (the pickup funnel), and
`overload_used`. The gap between "loaded" and `first_trail_drawn` is the single
number that predicts jam ranking and portal conversion alike.

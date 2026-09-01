# Rune-icorn Duels — post-jam roadmap

Twenty action points, ordered inside four goals. Each carries a rough estimate
and the concrete change to make, not just an aspiration. Estimates assume the
current codebase (`sim.js` owns rules, `unicorn_state` owns all state, one
localStorage key).

Byte budget note: the jam build sits at ~12.2 kB of 13 kB. Items marked
**(post-jam)** assume the size cap is lifted; items marked **(fits)** were
costed to land inside the remaining headroom.

---

## A. Day-1 retention — give a reason to come back tomorrow

**A1. Daily rune seed — 3h (fits)**
Derive a daily modifier from `floor(Date.now()/864e5)`: one element is
"ascendant" and deals +25%. Show it as a small banner on the island at boot and
tint that element's slot. Store `lastSeed` in the existing save blob; when it
differs from today's, fire a "NEW DAY — ICE ASCENDANT" callout through the
existing `S.pops` channel. Costs one integer in storage and reuses the popup
system wholesale.

**A2. Win-streak ladder with a visible break point — 4h**
Track `streak` alongside `wins`. Umbra's `lv` in `think()` already ramps with
wins; re-key it to `streak` so a loss genuinely resets difficulty. Show
"STREAK 4" under the HP bar and animate the number breaking on a loss. Loss
aversion is the strongest day-2 hook available and this is ~30 lines.

**A3. Three named opponents instead of one — 8h**
Umbra is one `chooseRune`/`think` policy. Add two more sharing the rig:
*Sable* (barrier-heavy, punishes impatience) and *Vex* (fast single-rune
spam, punishes over-stacking). Cycle per win. This converts "I beat the game"
into "I have not beaten Vex yet", which is the actual retention lever.

**A4. Local leaderboard of best times per opponent — 2h**
`S.best` already exists and is saved. Widen to `best: {umbra, sable, vex}` and
render the three rows on the result panel. Zero new systems.

**A5. Return-visit greeting — 1.5h**
If `lastSeed` is 1 day old, open on "WELCOME BACK" with the streak intact; if
older, restore the streak once as a "comeback" gift. Costs one branch and buys
a measurable lift in day-2 return in games of this shape.

---

## B. Average playtime — make a session longer than one duel

**B1. Best-of-three match structure — 5h**
The single duel is the unit of play but a poor unit of *session*. Wrap
`resetDuel()` in a match: first to two duels. Carry a persistent scar (start
at 90 HP after losing a round) so round three feels earned. `S.round` already
exists and is unused — this is its purpose.

**B2. Endless Gauntlet mode — 6h**
Sequential opponents, HP carried over, one small heal between fights (a drawn
star restores 8). Track depth in the save blob. This is the mode that produces
20-minute sessions; everything it needs already exists except the heal branch
in `strike()`.

**B3. Spellbook as a completion meter — 2h (fits)**
`S.seen` already records every discovered combination. Show "17 / 23 SPELLS"
on the result panel and in the spellbook header. A visible incomplete set is
the cheapest playtime extender in the build — the data is already persisted.

**B4. Discovery rewards — 2.5h**
First time a combination is cast, grant a small bonus (a free barrier next
duel) and make the "NEW SPELL" callout larger and slower. Turns experimentation
from a curiosity into a strategy.

**B5. Practice target — 3h**
A no-timer mode against a training dummy that reports recognition confidence
per stroke. Reuses `rawScore()` from `runes.js`, which already returns the
unthresholded score. Serves the players who bounce off gesture accuracy.

---

## C. Easy to pick up, hard to put down

**C1. Two-beat onboarding is in; add the defensive beat — 2h (fits)**
Current onboarding teaches draw → store → cast. It never teaches *blocking*,
which is the skill that separates a 40-second loss from a win. Add beat 4:
Umbra telegraphs a bolt, the box highlights, "DRAW ▢ TO BLOCK". Gate Umbra's
first real cast until it resolves.

**C2. Per-stroke recognition feedback — 2h (fits)**
`recognise()` returns `-1` on a miss; the player learns nothing from a shake.
Use `rawScore()` to say *why*: "TOO ROUND — SHARPEN THE CORNERS" when the best
match was EARTH but the curvature gate (`ec > 20`) rejected it. The data is
already computed; this is a message, not an algorithm.

**C3. Rune-drawing assist ramp — 3h**
Track a rolling recognition rate in `unicorn_state`. Below 60%, quietly relax
`THRESH` from 0.78 toward 0.72 and raise `MAX_EC`; above 90%, restore them.
Struggling players stop bouncing, skilled players never notice.

**C4. Combo telegraph on the queue — 2h (fits)**
The CAST button already previews the spell name. Add the damage number and a
one-word type ("HEAVY · 32"). Making the trade-off between one fast rune and
three slow ones legible *before* committing is what turns the queue into a
decision.

**C5. Cast-cancel window — 1.5h**
150ms after cast, tapping the trash refunds the runes. Removes the sting of a
misfire, which is the single most common rage-quit trigger in gesture games.

**C6. Umbra tells, readable at a glance — 3h**
Her forming rune is visible but small. Add a colour flare at her horn 0.4s
before she casts, tinted by the element she is about to throw. Converts "the
NPC is random" into "I misread her" — the difference between frustration and
mastery.

---

## D. Converting new players

**D1. First-30-seconds guarantee — 2h (fits)**
Umbra currently opens after a 1.2s grace beat (`S.eThink`). Make her first
cast non-lethal regardless of combo, and delay her opening to 4s on the very
first duel only (`S.wins === 0`). Nobody should lose before understanding the
verb.

**D2. Silent-start audio — 1h (fits)**
Audio requires a gesture, so the first seconds are silent — which reads as
broken. Show a small "♪ TAP FOR SOUND" chip until the first input wakes the
context.

**D3. Instant replay of the killing blow — 4h**
Record the last 2.5s of `S.shots` and HP into a small ring buffer; replay it
behind the result panel. Cheap, and it makes a loss feel legible rather than
arbitrary.

**D4. Shareable result card — 3h**
Render the result panel to an offscreen canvas with the time, streak and the
final spell, and offer it via the Web Share API. Organic acquisition with no
backend.

**D5. Portal-safe wrapper pass — 4h**
Before any portal submission, run the platform playbook: ad-audio mute
guarantee (the master gain in `audio.js` is already a single node — mute it on
ad start), ad **before** the result screen and never after, rewarded-video
readiness gating, and `gameplayStart`/`gameplayStop` around `resetDuel()` and
`finish()`. These are the exact traps that have caused past rejections.

**D6. Input-method detection — 1h (fits)**
The onboarding says "DRAW"; on touch it should say "TRACE WITH YOUR FINGER".
One branch on `matchMedia('(pointer:coarse)')`, applied to the two onboarding
strings and the control hint.

---

## Suggested order

1. **D1, D2, C2, C4** — cheapest, and they fix the first-minute experience,
   which gates everything else. (~7h, all fit in the current budget.)
2. **A2, B3, A1** — the retention hooks that reuse systems already shipped.
3. **B1, C1, C6** — depth: make the duel a match and the opponent readable.
4. **A3, B2** — the content expansion that justifies the rest.
5. **D5** before any portal build, without exception.

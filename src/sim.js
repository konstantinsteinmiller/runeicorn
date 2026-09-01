/**
 * sim.js — the duel itself. Owns every rule; draws nothing.
 *
 * Flow: pointer stroke -> recognise() -> queue (max 3) -> cast -> a shot ->
 * resolve against barriers -> HP -> sky -> win/lose. The NPC runs the same
 * pipeline through `think`, so both duelists obey identical rules.
 */
import {
  S,
  AX,
  UX,
  GY,
  HDX,
  HDY,
  BOX,
  MAX_RUNES,
  HP_MAX,
  FIRE,
  WIND,
  ICE,
  EARTH,
  PH_DUEL,
  PH_WIN,
  PH_LOSE,
  RUNES,
  FOES,
  elemMul,
  spellFor,
  save,
} from './state.js'
import { recognise } from './runes.js'
import { clamp, damp, rnd, pick, min, max, hypot, abs } from './u.js'
import { impact, castBurst, fireRain, barrier, rainbowBurst, shakeAdd, flashAdd, trail } from './fx.js'
import { sfx, setMood } from './audio.js'

/* ------------------------------ tuning ------------------------------ */
/** Projectile speed per spell kind (stage units/sec); fields/heavies wait. */
const SPD = [980, 0, 0, 0, 1500]
/** Seconds a delayed spell hangs before it lands. GDD: Fire Rain ~2s. */
const DELAY = [0, 0.5, 0, 1.7, 0]
/** Where a duelist's horn is, in stage coords. `e` = is this Umbra. */
const hornX = (e) => (e ? UX - HDX : AX + HDX)
const HORN_Y = GY + HDY

/* --------------------------- announcements -------------------------- */
const pop = (s, c, x, y) => {
  S.pops.push({ s, c: c || '#fff', x: x ?? 640, y: y ?? 300 })
  if (S.pops.length > 6) S.pops.shift()
}

/* ------------------------------ drawing ----------------------------- */
/** Pointer went down inside the drawing box. */
export const strokeStart = (x, y) => {
  S.draw = 1
  S.pts.length = 0
  S.pts.push(x, y)
}

/** Pointer moved while drawing. Trails are the only per-move cost. */
export const strokeMove = (x, y) => {
  if (!S.draw) return
  const n = S.pts.length
  // Keep a fine sample so the ink hugs the real path; 2.5 units is below what
  // the eye resolves but still throws away jitter while the pointer is still.
  if (n && hypot(x - S.pts[n - 2], y - S.pts[n - 1]) < 2.5) return
  // Bound the buffer. The recogniser resamples to 32 points regardless, so a
  // very long scribble gains nothing by growing without limit.
  if (n < 1024) S.pts.push(x, y)
  trail(x, y, (S.pts.length * 0.013) % 1)
  sfx('draw', clamp((y - BOX.y) / BOX.h, 0, 1))
}

/** Pointer released: classify, then store or nudge. */
export const strokeEnd = () => {
  if (!S.draw) return
  S.draw = 0
  // A tap or a twitch is not a FAILED rune, it is not an attempt at all. Now
  // that the whole screen is drawable, without this every stray click would
  // buzz and shake at the player.
  const p = S.pts
  let x0 = 1e9
  let y0 = 1e9
  let x1 = -1e9
  let y1 = -1e9
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i]
    if (p[i] > x1) x1 = p[i]
    if (p[i + 1] < y0) y0 = p[i + 1]
    if (p[i + 1] > y1) y1 = p[i + 1]
  }
  if (p.length < 12 || hypot(x1 - x0, y1 - y0) < 45) {
    p.length = 0
    return
  }
  const r = recognise(S.pts)
  S.pts.length = 0
  if (r < 0) {
    // The dashed box that used to shake red is gone, so this callout is the
    // ONLY visual sign a stroke was rejected. Cutting it bought 5 bytes and
    // left muted players with no feedback at all, which was a bad trade.
    pop('NOT A RUNE', '#ff6a8a', 640, BOX.y - 46)
    sfx('bad')
    return
  }
  if (S.queue.length >= MAX_RUNES) {
    // Full: refuse rather than silently drop the rune they just drew.
    sfx('bad')
    pop('NO SLOTS!', '#ffd76a', 640, BOX.y - 46)
    return
  }
  S.queue.push(r)
  S.snap = { r, t: 0 } // the clean glyph flashes, then it is stored (GDD 2.2)
  sfx('snap', r)
  if (S.intro && S.introStep < 1) {
    S.introStep = 1
    S.introT = 0
  }
}

/* ------------------------------ casting ----------------------------- */
/**
 * Barrier flavour from the combo's element — no extra matrix column needed.
 * WIND -> stops projectiles, EARTH -> stops everything, ICE -> one-shot pillar.
 */
const guardKind = (q) => (q[0] === EARTH ? 1 : q[0] === ICE ? 2 : 0)

/** Fire a spell. `e` = cast by Umbra. */
const launch = (q, e) => {
  const sp = spellFor(q)
  const [name, kind, , ex] = sp
  /**
   * The player's damage is the only thing the meta-game touches: the element
   * the cast LEANS ON is checked against the foe's, then scaled by the rank
   * bought with coins. Umbra's own damage is left flat — she has no element
   * to counter and no coins to spend, and letting her scale too would just
   * cancel the upgrade the player paid for.
   */
  const dr = q[q.length - 1]
  const mul = e ? 1 : elemMul(dr, FOES[S.foe][1]) * (1 + 0.12 * S.up[dr])
  const dmg = sp[2] * mul
  const key = [...q].sort().join('')
  const hx = hornX(e)
  const dir = e ? -1 : 1

  castBurst(hx, HORN_Y, q[q.length - 1])
  sfx('cast', q.length)
  if (e) S.eCastAnim = 0.55
  else S.castAnim = 0.55

  if (kind === 2) {
    // Barriers land on the caster, instantly.
    const k = guardKind(q)
    if (e) {
      S.eGuard = ex
      S.eGuardK = k
    } else {
      S.guard = ex
      S.guardK = k
    }
    barrier(e ? UX : AX, GY - 70, q[0], ex)
    sfx('guard')
  } else {
    S.shots.push({
      x: hx,
      y: HORN_Y,
      tx: e ? AX : UX,
      r: q[q.length - 1],
      k: kind,
      dmg,
      ex,
      dir,
      w: mul > 1.2 ? 1 : 0, // super-effective, for the callout on impact
      n: q.length,
      delay: DELAY[kind],
      life: 0,
    })
  }

  if (!e) {
    S.combo = q.length
    // `seen` is still recorded — the spellbook (SPELLBOOK=1) reads it — but it
    // no longer changes what the player is told. Announcing a FIRST cast
    // differently only meant something while there was a book to look it up in.
    if (!S.seen[key]) {
      S.seen[key] = 1
      save()
    }
    pop(name + (q.length > 1 ? '  x' + q.length : ''), RUNES[q[0]][0], 640, 250)
    if (S.intro) {
      S.intro = 0
      S.introStep = 3
      save()
    }
  }
  q.length = 0
}

/** Player pressed cast. Harmless when the queue is empty. */
export const cast = () => {
  if (S.phase !== PH_DUEL || !S.queue.length) return
  launch(S.queue, 0)
}

/* ----------------------------- resolution --------------------------- */
/**
 * Does an active barrier of flavour `gk` stop a spell of `kind`?
 *   earth (1) stops everything.
 *   wind (0) stops anything PHYSICAL — bolts, pushes, and falling debris.
 *     Fire Rain and friends are many small projectiles dropping out of the
 *     sky, so an air shell deflects them; only ground-level fields (kind 1)
 *     still creep underneath it.
 *   ice pillar (2) eats a single incoming projectile; it is a wall, not a
 *     roof, so things falling from above go straight over it.
 */
const stops = (gk, kind) => gk === 1 || kind === 0 || kind === 4 || (!gk && kind === 3)

/** Land a resolved spell on a duelist. `e` = it hits Umbra. */
const strike = (s, e) => {
  const gk = e ? S.eGuardK : S.guardK
  const g = e ? S.eGuard : S.guard
  const tx = e ? UX : AX

  if (g > 0 && stops(gk, s.k)) {
    // Blocked. Still loud — a block the player cannot see is a bug report.
    impact(tx - s.dir * 58, GY - 90, gk === 1 ? EARTH : gk === 2 ? ICE : WIND, 0.35)
    sfx('guard')
    shakeAdd(0.12)
    pop('BLOCKED', '#8ff0ff', tx, GY - 210)
    if (gk === 2) {
      // The pillar spends itself on one hit. Tear the shield visual down with
      // it — fx owns its own timer and would otherwise keep shining.
      if (e) S.eGuard = 0
      else S.guard = 0
      barrier(tx, GY - 70, ICE, 0)
    }
    return
  }

  const p = clamp(s.dmg / 40, 0.15, 1)
  // fireRain is FIRE-flavoured art (burning blocks, orange sky wash), so it
  // only fits a fire heavy. Firing it for every heavy made GLACIER and
  // MOUNTAIN rain fire. Non-fire heavies get a full-power elemental impact.
  if (s.k === 3 && s.r === FIRE) fireRain(tx, GY, p)
  impact(tx, GY - 90, s.r, s.k === 3 ? 1 : p)
  sfx('hit', p)
  sfx('hurt', p)
  shakeAdd(0.16 + p * 0.34)
  flashAdd(0.1 + p * 0.2)

  if (e) {
    S.ehp = max(0, S.ehp - s.dmg)
    S.eHurt = 0.3
    if (s.ex && s.k === 1) S.eBurn = max(S.eBurn, s.ex)
    if (s.ex && (s.k === 0 || s.k === 3)) S.eSlow = max(S.eSlow, s.ex)
    if (s.k === 4) S.eForm = max(0, S.eForm - 0.5) // pushback disrupts casting
  } else {
    S.hp = max(0, S.hp - s.dmg)
    S.hurt = 0.3
    if (s.ex && s.k === 1) S.burn = max(S.burn, s.ex)
    if (s.ex && (s.k === 0 || s.k === 3)) S.slow = max(S.slow, s.ex)
  }
  // A weakness the player cannot SEE landing is a weakness they will not learn
  // to aim for, so the counter-hit says so in its own colour.
  pop((s.w ? 'WEAK! -' : '-') + (s.dmg | 0), s.w ? '#7dffa8' : e ? '#ffd76a' : '#ff6a8a', tx, GY - 250)
  if (s.n > 1 && e) pop('x' + s.n + ' COMBO', '#fff', tx, GY - 300)
}

const stepShots = (dt) => {
  for (let i = S.shots.length; i--; ) {
    const s = S.shots[i]
    s.life += dt
    if (s.delay > 0) {
      // Fields and heavies hang over the target, then fall.
      s.delay -= dt
      s.x = s.tx
      s.y = GY - 240
      if (s.delay <= 0) {
        strike(s, s.dir > 0)
        S.shots.splice(i, 1)
      }
      continue
    }
    s.x += SPD[s.k] * s.dir * dt
    // Gentle arc so bolts read as thrown, not slid.
    s.y = HORN_Y + (GY - 90 - HORN_Y) * clamp(abs(s.x - hornX(s.dir < 0)) / 700, 0, 1)
    if ((s.dir > 0 && s.x >= s.tx) || (s.dir < 0 && s.x <= s.tx)) {
      strike(s, s.dir > 0)
      S.shots.splice(i, 1)
    } else if (s.life > 4) S.shots.splice(i, 1)
  }
}

/* ------------------------------ the NPC ----------------------------- */
/**
 * Umbra forms runes on a timer and casts on intent, never on a coin flip:
 * she answers what is actually on the field. Difficulty ramps with wins so
 * a returning player meets a sharper opponent (retention, roadmap item 3).
 */
const think = (dt) => {
  const lv = S.foe // rung on the ladder IS the tier: a new foe is a new brain
  // The very first duel eases off. A beginner still fighting the gesture
  // should not be dead before they understand the verb; measured, a 2.5s/rune
  // hand won 18% of duels at full rate, which is where new players quit.
  const first = S.wins || S.losses ? 1 : 0.8
  const rate = (0.42 + lv * 0.085) * (S.eSlow > 0 ? 0.55 : 1) * first
  // Commit to the next rune BEFORE forming it, so the ghost in her slot shows
  // what is actually coming and the player has something to read.
  if (S.eRune < 0) S.eRune = chooseRune()
  S.eForm += dt * rate
  if (S.eForm >= 1) {
    S.eForm = 0
    if (S.equeue.length < MAX_RUNES) S.equeue.push(S.eRune)
    S.eRune = chooseRune()
  }

  S.eThink -= dt
  if (S.eThink > 0 || !S.equeue.length) return
  S.eThink = 0.25

  const q = S.equeue
  const incoming = S.shots.some((s) => s.dir > 0)
  const full = q.length >= MAX_RUNES

  // Cast when it means something: a full hand, a defensive answer to a shot
  // already in flight, or a finisher that would end the duel now.
  const finisher = spellFor(q)[2] >= S.hp
  // FROM TIER 2 SHE READS THE PLAYER'S SLOTS. Everything below tier 2 can only
  // answer a shot that already exists, which is always a beat too late against
  // a heavy — the wind-up is longer than the barrier. Watching the queue lets
  // her raise the wall while the spell is still being drawn, so a player who
  // telegraphs three runes of damage now meets a guard instead of a free hit.
  const threat = lv >= 2 && S.queue.length >= 2 && spellFor(S.queue)[1] !== 2
  // Reading the threat is only worth anything if she can ACT on it, and a
  // half-built attack in hand cannot become a wall. So she DUMPS it and
  // commits to EARTH — a lone EARTH is already a barrier, and `eRune` is the
  // ghost the player can see, so the panic is legible rather than magic.
  // Without this she could only ever guard in the accident of an empty queue.
  if (threat && S.eGuard <= 0 && q.length && spellFor(q)[1] !== 2) {
    q.length = 0
    S.eRune = EARTH
    S.eForm = max(S.eForm, 0.5)
  }
  const defend = (incoming || threat) && spellFor(q)[1] === 2 && S.eGuard <= 0
  if (full || defend || finisher || (q.length === 2 && rnd() < 0.02 + lv * 0.02)) launch(q, 1)
}

/** Which rune Umbra reaches for, given the state of the duel. */
const chooseRune = () => {
  const q = S.equeue
  const el = FOES[S.foe][1]
  // A lone EARTH already IS a barrier, so under a read threat it is the
  // fastest wall she can put up — one rune, no combo to finish first.
  if (S.foe >= 2 && S.queue.length >= 2 && S.eGuard <= 0 && !q.length) return EARTH
  // Answer pressure with defence, otherwise build toward damage.
  if (S.ehp < HP_MAX * 0.3 && S.eGuard <= 0 && !q.length && rnd() < 0.45) return pick([EARTH, ICE, WIND])
  if (q.length === 1 && rnd() < 0.55) return q[0] // doubling up is the strong play
  // A themed foe leans on its own element — that is what makes it readable,
  // and therefore what makes its weakness worth learning.
  return el < 0 || rnd() < 0.4 ? pick([FIRE, FIRE, ICE, ICE, EARTH, WIND]) : el
}

/* ------------------------------- update ----------------------------- */
const tick = (dt) => {
  // Damage over time, applied smoothly rather than in visible chunks.
  if (S.burn > 0) {
    S.burn -= dt
    S.hp = max(0, S.hp - 4 * dt)
    S.hurt = max(S.hurt, 0.06)
  }
  if (S.eBurn > 0) {
    S.eBurn -= dt
    S.ehp = max(0, S.ehp - 4 * dt)
    S.eHurt = max(S.eHurt, 0.06)
  }
  // Written out rather than looped over a name table: property mangling in the
  // release build renames S.guard etc., but a string 'guard' in a table would
  // not follow, so the dynamic form silently stopped decrementing.
  if (S.guard > 0) S.guard -= dt
  if (S.eGuard > 0) S.eGuard -= dt
  if (S.slow > 0) S.slow -= dt
  if (S.eSlow > 0) S.eSlow -= dt
  S.castAnim = max(0, S.castAnim - dt)
  S.eCastAnim = max(0, S.eCastAnim - dt)
  S.hurt = max(0, S.hurt - dt)
  S.eHurt = max(0, S.eHurt - dt)
  if (S.snap) {
    S.snap.t += dt
    if (S.snap.t > 0.45) S.snap = null
  }
}

/** End the duel once, and only once. */
const finish = (won) => {
  S.phase = won ? PH_WIN : PH_LOSE
  S.over = 0
  S.shots.length = 0
  S.queue.length = 0
  S.equeue.length = 0
  if (won) {
    S.wins++
    // Coins ONLY come from wins, and a rung further up pays more — the reward
    // curve has to outrun the difficulty curve or upgrading stops mattering.
    const c = 12 + S.foe * 6
    S.coins += c
    if (S.foe < FOES.length - 1) S.foe++
    if (!S.best || S.dur < S.best) S.best = S.dur
    rainbowBurst(UX, GY - 120)
    flashAdd(0.7)
    pop('VICTORY', '#ffe98a', 640, 240)
    pop('+' + c + ' COINS', '#ffd76a', 640, 300)
  } else {
    S.losses++
    pop('DEFEATED', '#ff6a8a', 640, 240)
  }
  shakeAdd(0.6)
  sfx(won ? 'win' : 'lose')
  save()
}

/** Start (or restart) a duel without touching the meta-progress. */
export const resetDuel = () => {
  S.phase = PH_DUEL
  S.hp = S.ehp = HP_MAX
  S.queue.length = S.equeue.length = S.shots.length = S.pts.length = 0
  S.eForm = S.guard = S.eGuard = S.burn = S.eBurn = S.slow = S.eSlow = 0
  S.castAnim = S.eCastAnim = S.hurt = S.eHurt = S.draw = 0
  S.dur = S.over = 0
  S.eThink = 1.2 // a grace beat before Umbra opens
  S.snap = null
  S.sky = 0.5
  S.round++
}

/** One simulation step. Called at a fixed timestep by main.js. */
export const updateSim = (dt) => {
  if (S.phase !== PH_DUEL) {
    S.over += dt
    setMood(S.phase === PH_WIN ? 1 : 0)
    S.sky = damp(S.sky, S.phase === PH_WIN ? 1 : 0, 2.5, dt)
    return
  }
  S.dur += dt
  tick(dt)
  stepShots(dt)
  if (S.intro) {
    // Beat 1 ("stored") reads for a moment, then hands over to beat 2 ("cast").
    S.introT += dt
    if (S.introStep === 1 && S.introT > 1.5) {
      S.introStep = 2
      S.introT = 0
    }
  } else think(dt)

  // The sky IS the scoreboard (GDD 2.3): it tracks the HP balance, damped so
  // a single bolt tilts the weather rather than snapping it.
  const bal = 0.5 + (S.hp - S.ehp) / (2 * HP_MAX)
  S.sky = damp(S.sky, clamp(bal, 0, 1), 1.4, dt)
  setMood(S.sky)

  if (S.ehp <= 0) finish(1)
  else if (S.hp <= 0) finish(0)
}

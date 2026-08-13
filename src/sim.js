/**
 * The simulation: swarm, enemies, conversion, threat.
 *
 * Design intent — the player never commands a unit. They shape a FLOW and the
 * flow does the rest. Every system here exists to make that flow legible:
 * growth you can see, losses you can feel, and exactly one counter (the mage)
 * that forces you to redraw.
 */
import {
  S,
  ST_GREY,
  ST_CONV,
  ST_HIVE,
  SC_PLAY,
  SC_CLEAR,
  SC_DEAD,
  UNIT_CAP,
  UNIT_SPD,
  UNIT_R,
  SPAWN_MAIN,
  SPAWN_HIVE,
  CLONE_RATE,
  UNIT_DMG,
  CONV_NEED,
  CAP_PER_HIVE,
  OVERLOAD_COST,
  OVERLOAD_TIME,
  SOLDIER_HP,
  SOLDIER_SPD,
  SOLDIER_DMG,
  MAGE_CAST,
  WOUND_R,
  WOUND_LIFE,
  nearestTarget,
  inWound,
  hint,
} from './state.js'
import {
  hypot,
  rnd,
  rand,
  min,
  max,
  clamp,
  atan2,
  sin,
  cos,
  TAU,
  segDist,
} from './u.js'
import { updateCuts, segLive, pruneTrails, totalLen } from './trail.js'
import { burst, ring, glitterWave, shakeAdd, flashAdd } from './fx.js'
import { sfx, setSwarm } from './audio.js'

/* -------------------- what a rainbow trail is worth ------------------ */

/** How far an UNDIRECTED unicorn will stray to hit something. Deliberately
 *  short: without a trail the swarm defends its hive and little else. */
const LOOSE_RANGE = 130
/** Speed / damage / conversion multiplier while riding a healthy conveyor. */
const TRAIL_BONUS = 1.5
/** Hive output bonus while an unbroken trail leaves it. */
const LINK_BONUS = 1.3

/** Damage weight of one unicorn — on-trail unicorns hit 50% harder. */
const wt = (u) => (u.tr ? TRAIL_BONUS : 1)

/* Reused burst option objects. These fire on every unit death and every combat
   tick; fresh object literals there were the last per-frame allocation source
   and showed up as GC spikes. fx.burst destructures immediately and never
   retains them, so mutating a shared object is safe. */
const SPARK = { hue: 0, spd: 120, life: 0.5, size: 2.6 }
const DEATH = { hue: 0, spd: 90, life: 0.5, size: 2.4 }

/** Is an intact trail running out of this hive? */
const linked = (c) => {
  for (const tr of S.trails) {
    if (tr.ok && tr.p.length > 3 && hypot(tr.p[0] - c.x, tr.p[1] - c.y) < 90) return 1
  }
  return 0
}

/* --------------------------- spatial hash --------------------------- */

const CELL = 46
let cells = []
let cw = 0
let ch = 0

const rebuildGrid = () => {
  cw = ((S.w / CELL) | 0) + 2
  ch = ((S.h / CELL) | 0) + 2
  const n = cw * ch
  if (cells.length !== n) {
    cells = []
    for (let i = 0; i < n; i++) cells.push([])
  }
  for (let i = 0; i < n; i++) cells[i].length = 0
  for (const u of S.units) {
    const cx = clamp((u.x / CELL) | 0, 0, cw - 1)
    const cy = clamp((u.y / CELL) | 0, 0, ch - 1)
    cells[cy * cw + cx].push(u)
  }
}

/**
 * Collect every unit within `r` px of (x,y) into the shared NEAR buffer and
 * return how many. Callback-free on purpose: a `fn` parameter meant allocating
 * a fresh closure for every castle, soldier and mage on every frame, and the
 * resulting GC pauses showed up as periodic 60-90 ms frame spikes.
 */
const NEAR = []
const near = (x, y, r) => {
  const x0 = clamp(((x - r) / CELL) | 0, 0, cw - 1)
  const x1 = clamp(((x + r) / CELL) | 0, 0, cw - 1)
  const y0 = clamp(((y - r) / CELL) | 0, 0, ch - 1)
  const y1 = clamp(((y + r) / CELL) | 0, 0, ch - 1)
  const r2 = r * r
  let n = 0
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const list = cells[cy * cw + cx]
      for (let i = 0; i < list.length; i++) {
        const u = list[i]
        const dx = u.x - x
        const dy = u.y - y
        if (dx * dx + dy * dy < r2) NEAR[n++] = u
      }
    }
  }
  return n
}

/* ------------------------------ units ------------------------------- */

const addUnit = (x, y, tr) => {
  if (S.units.length >= UNIT_CAP) return
  S.units.push({
    x,
    y,
    vx: rand(-20, 20),
    vy: rand(-20, 20),
    ph: rnd() * TAU,
    tr: tr || null,
    ti: 1,
    hp: 1,
    hb: (rnd() * 6) | 0, // stable hue bucket, lets the bloom pass batch by colour
    tg: null, // cached attack target
    tgT: 0, // seconds until the target is re-acquired
    // "Home": where this unit holds station when it has no conveyor. Set to
    // the spawn hive, then to a trail's end once it has run one, so the swarm
    // masses at the frontier instead of roaming the map on its own.
    hx: x,
    hy: y,
  })
}

/** Pick the trail that starts closest to a spawn point. */
const trailFrom = (x, y) => {
  let best = null
  let bd = 90
  for (const tr of S.trails) {
    if (tr.p.length < 4) continue
    const d = hypot(tr.p[0] - x, tr.p[1] - y)
    if (d < bd) {
      bd = d
      best = tr
    }
  }
  return best
}

/** After a trail ends, look for another one to hop onto (handles branching). */
const hopTrail = (u) => {
  let best = null
  let bd = 70
  for (const tr of S.trails) {
    if (tr === u.tr || tr.p.length < 4) continue
    const d = hypot(tr.p[0] - u.x, tr.p[1] - u.y)
    if (d < bd) {
      bd = d
      best = tr
    }
  }
  if (best) {
    u.tr = best
    u.ti = 1
    return 1
  }
  return 0
}

const updateUnits = (dt) => {
  const units = S.units
  const acc = UNIT_SPD * 9
  const boost = S.overload > 0 ? 1.5 : 1
  const cloneP = CLONE_RATE * (S.overload > 0 ? 2.2 : 1) * dt

  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i]
    let ax = 0
    let ay = 0
    let onTrail = 0
    const tr = u.tr

    if (tr && tr.p.length >= 4) {
      const p = tr.p
      const j = u.ti
      if (j * 2 + 1 >= p.length) {
        // Reached the end of the conveyor: hold the frontier, not the hive.
        if (!hopTrail(u)) {
          u.tr = null
          u.hx = p[p.length - 2]
          u.hy = p[p.length - 1]
        }
      } else if (!segLive(tr, j - 1)) {
        // The segment under us went dark: pathing force is lost (GDD 3.3),
        // and the unit mills where it was stranded.
        u.tr = null
        u.hx = u.x
        u.hy = u.y
      } else {
        const tx = p[j * 2]
        const ty = p[j * 2 + 1]
        const dx = tx - u.x
        const dy = ty - u.y
        const d = hypot(dx, dy) || 1
        if (d < 19) {
          u.ti++
          tr.use++
        }
        ax += (dx / d) * acc
        ay += (dy / d) * acc
        onTrail = 1
        // Recursive cloning only happens on a healthy conveyor.
        if (rnd() < cloneP && units.length < UNIT_CAP) {
          addUnit(u.x + rand(-6, 6), u.y + rand(-6, 6), tr)
          S.units[S.units.length - 1].ti = j
        }
      }
    }

    if (!onTrail) {
      // Off-trail units only engage what is already ON TOP of them. They must
      // NOT wander across the map and win the level on their own — the trail
      // is the player's verb, so an undirected swarm has to mill about.
      // Targets are cached: re-acquiring per unit per frame was O(units x foes).
      u.tgT -= dt
      // `st === ST_HIVE` also retires a castle the swarm just converted.
      if (u.tgT <= 0 || !u.tg || u.tg.hp <= 0 || u.tg.st === ST_HIVE) {
        u.tg = nearestTarget(u.x, u.y, LOOSE_RANGE)
        u.tgT = 0.2 + rnd() * 0.25
      }
      const t = u.tg
      if (t) {
        const dx = t.x - u.x
        const dy = t.y - u.y
        const d = hypot(dx, dy) || 1
        ax += (dx / d) * acc * 0.75
        ay += (dy / d) * acc * 0.75
      } else {
        // Nothing in reach: hold station around `home` and mill. This is what
        // stops an unattended swarm from conquering the map by itself.
        const dx = u.hx - u.x
        const dy = u.hy - u.y
        const d = hypot(dx, dy) || 1
        if (d > 64) {
          ax += (dx / d) * acc * 0.55
          ay += (dy / d) * acc * 0.55
        } else {
          ax += sin(S.t * 0.7 + u.ph) * acc * 0.2
          ay += cos(S.t * 0.6 + u.ph) * acc * 0.2
        }
      }
    }

    u.vx = (u.vx + ax * dt) * 0.9
    u.vy = (u.vy + ay * dt) * 0.9
    const sp = hypot(u.vx, u.vy)
    const cap = UNIT_SPD * boost * (onTrail ? TRAIL_BONUS : 1)
    if (sp > cap) {
      u.vx = (u.vx / sp) * cap
      u.vy = (u.vy / sp) * cap
    }
    u.x += u.vx * dt
    u.y += u.vy * dt
    u.ph += dt * (4 + sp * 0.05)

    // Soft walls.
    if (u.x < 8) u.vx += 400 * dt
    if (u.x > S.w - 8) u.vx -= 400 * dt
    if (u.y < 8) u.vy += 400 * dt
    if (u.y > S.h - 8) u.vy -= 400 * dt

    if (u.hp <= 0) {
      units.splice(i, 1)
      DEATH.hue = rnd()
      burst(u.x, u.y, 5, DEATH)
    }
  }
}

/**
 * Boids over the spatial hash — alignment, cohesion and separation against a
 * unit's nearest handful of neighbours (GDD 2.1). Capping at 9 per cell keeps
 * this O(units) instead of O(units²) and matches the "nearest 5-8" rule.
 */
const flock = (dt) => {
  const push = 240 * dt
  const coh = 0.9 * dt
  const ali = 2.2 * dt
  for (let c = 0; c < cells.length; c++) {
    const list = cells[c]
    const n = min(list.length, 9)
    if (n > 1) {
      // Cohesion + alignment toward the local cell average.
      let sx = 0
      let sy = 0
      let svx = 0
      let svy = 0
      for (let a = 0; a < n; a++) {
        const u = list[a]
        sx += u.x
        sy += u.y
        svx += u.vx
        svy += u.vy
      }
      sx /= n
      sy /= n
      svx /= n
      svy /= n
      for (let a = 0; a < n; a++) {
        const u = list[a]
        u.vx += (sx - u.x) * coh + (svx - u.vx) * ali
        u.vy += (sy - u.y) * coh + (svy - u.vy) * ali
      }
    }
    for (let a = 0; a < n; a++) {
      const u = list[a]
      for (let b = a + 1; b < n; b++) {
        const v = list[b]
        const dx = v.x - u.x
        const dy = v.y - u.y
        const d2 = dx * dx + dy * dy
        if (d2 > 0.01 && d2 < UNIT_R * UNIT_R * 4) {
          const d = Math.sqrt(d2)
          const f = (push * (1 - d / (UNIT_R * 2))) / d
          u.vx -= dx * f
          u.vy -= dy * f
          v.vx += dx * f
          v.vy += dy * f
        }
      }
    }
  }
}

/* ----------------------------- castles ------------------------------ */

const soldierEvery = () => (S.region < 1 ? 0 : max(1.5, 5.4 - S.region * 0.55))

const convert = (c) => {
  c.st = ST_HIVE
  c.conv = 1
  S.cap += CAP_PER_HIVE
  S.dust += 25
  sfx('convert')
  flashAdd(0.45)
  shakeAdd(0.28) // glitterWave() adds its own on top of this
  glitterWave(c.x, c.y)
  for (let i = 0; i < 3; i++) ring(c.x, c.y, { hue: rnd(), r0: c.r, r1: 260 + i * 90, life: 0.7 + i * 0.2, w: 8 - i * 2 })
  burst(c.x, c.y, 90, { hue: -1, spd: 320, life: 1.4, size: 3.4, grav: 60 })
  hint('HIVE CONVERTED! Draw onward from it')
}

const updateCastles = (dt) => {
  const rate = soldierEvery()
  for (const c of S.castles) {
    if (c.st === ST_HIVE) {
      // A hive with an unbroken trail leaving it produces 30% faster — so a
      // cut trail costs you throughput as well as flow.
      c.spawn += dt * (c.main ? SPAWN_MAIN : SPAWN_HIVE) * (linked(c) ? LINK_BONUS : 1)
      while (c.spawn >= 1) {
        c.spawn--
        const tr = trailFrom(c.x, c.y)
        addUnit(c.x + rand(-c.r, c.r), c.y + rand(-c.r, c.r), tr)
        if (rnd() < 0.12) sfx('spawn')
      }
      continue
    }

    // Grey castle: bleed soldiers at the player.
    if (rate) {
      c.spawn += dt
      if (c.spawn > rate) {
        c.spawn = 0
        const a = rnd() * TAU
        S.soldiers.push({
          x: c.x + cos(a) * (c.r + 12),
          y: c.y + sin(a) * (c.r + 12),
          vx: 0,
          vy: 0,
          hp: SOLDIER_HP + S.region * 8,
          ph: rnd() * TAU,
          ang: 0,
          atk: 0,
        })
      }
    }

    // Unicorns crash into the castle and feed the conversion meter.
    let hitN = near(c.x, c.y, c.r + UNIT_R)
    while (hitN--) {
      const u = NEAR[hitN]
      if (u.hp <= 0) continue
      u.hp = 0
      c.conv += wt(u) / CONV_NEED // 0..1 fraction; on-trail arrivals convert 50% harder
      c.st = ST_CONV
      if (rnd() < 0.25) {
        SPARK.hue = rnd()
        burst(u.x, u.y, 3, SPARK)
      }
    }
    if (c.conv >= 1) convert(c)
  }
}

/* ---------------------------- soldiers ------------------------------ */

const updateSoldiers = (dt) => {
  const hive = S.hive
  for (let i = S.soldiers.length - 1; i >= 0; i--) {
    const s = S.soldiers[i]
    // March on the main hive in a loose phalanx.
    const dx = hive.x - s.x
    const dy = hive.y - s.y
    const d = hypot(dx, dy) || 1
    s.ang = atan2(dy, dx)
    const sp = SOLDIER_SPD * (1 + S.region * 0.05)
    s.x += (dx / d) * sp * dt
    s.y += (dy / d) * sp * dt
    s.ph += dt * 6

    // Contact: the swarm chews them, they cut down unicorns.
    let hits = 0
    let dmg = 0
    let k = near(s.x, s.y, 18)
    while (k--) {
      const u = NEAR[k]
      if (u.hp <= 0) continue
      hits++
      dmg += wt(u)
      if (S.overload <= 0 && rnd() < 0.9 * dt) u.hp = 0
    }
    if (hits) {
      s.hp -= UNIT_DMG * dmg * dt * (S.overload > 0 ? 3 : 1)
      if (rnd() < 6 * dt) {
        SPARK.hue = rnd()
        burst(s.x, s.y, 3, SPARK)
        sfx('hit')
      }
    }

    if (s.hp <= 0) {
      S.soldiers.splice(i, 1)
      S.kills++
      S.dust += 3
      sfx('kill')
      burst(s.x, s.y, 14, { mono: 1, spd: 150, life: 0.7, size: 2.6, grav: 140 })
      burst(s.x, s.y, 10, { hue: rnd(), spd: 190, life: 0.6, size: 2.8 })
      continue
    }

    // Reached the hive: chew on it.
    if (d < hive.r + 14) {
      const was = hive.hp
      hive.hp -= SOLDIER_DMG * dt
      // Discrete thump each time the hive loses another 40 HP, instead of a
      // per-frame nudge — a continuous drip made the screen shake constantly
      // for as long as anything was chewing on the hive.
      if (((was / 40) | 0) !== ((hive.hp / 40) | 0)) shakeAdd(0.3)
      if (rnd() < 3 * dt) burst(hive.x, hive.y, 4, { mono: 1, spd: 90, life: 0.5, size: 2 })
      if (hive.hp <= 0 && S.scene === SC_PLAY) {
        S.scene = SC_DEAD
        S.over = 0
        sfx('lose')
        shakeAdd(1)
        flashAdd(0.3)
      }
    }
  }
}

/* ------------------------ mages / void wounds ----------------------- */

/**
 * Mage targeting — readable by construction.
 *
 * A mage always defends whichever castle is closest to falling, by severing
 * the supply line feeding it: it picks the live trail node nearest that castle
 * but far enough out (SEVER_GAP) to actually cut the approach rather than
 * landing on top of the walls. That makes the cast legible — the cut always
 * appears on the lane you are currently pushing down.
 */
const SEVER_GAP = 75
/** Seconds of visible warning before a Void Wound lands. */
export const TELEGRAPH = 1.6

const mageTarget = () => {
  // The castle the player is closest to converting.
  let tc = null
  let best = -1
  for (const c of S.castles) {
    if (!c.main && c.st !== ST_HIVE && c.conv > best) {
      best = c.conv
      tc = c
    }
  }
  let bx = 0
  let by = 0
  let bd = 1e9
  for (const tr of S.trails) {
    const p = tr.p
    if (p.length < 6) continue
    for (let i = 0, j = 0; i < p.length; i += 2, j++) {
      if (tr.cut[j]) continue // already severed here
      const x = p[i]
      const y = p[i + 1]
      // Prefer the approach lane to the threatened castle; with no castle in
      // play, fall back to cutting deep along the longest trail.
      const dc = tc ? hypot(x - tc.x, y - tc.y) : 1e6 - j
      if (dc < SEVER_GAP) continue
      if (dc < bd) {
        bd = dc
        bx = x
        by = y
      }
    }
  }
  return bd < 1e9 ? [bx, by] : null
}

const updateMages = (dt) => {
  for (let i = S.mages.length - 1; i >= 0; i--) {
    const m = S.mages[i]
    m.ph += dt
    m.cast -= dt

    let hits = 0
    let dmg = 0
    let k = near(m.x, m.y, 24)
    while (k--) {
      const u = NEAR[k]
      if (u.hp <= 0) continue
      hits++
      dmg += wt(u)
      if (S.overload <= 0 && rnd() < 0.9 * dt) u.hp = 0
    }
    if (hits) {
      m.hp -= UNIT_DMG * dmg * dt * 0.6 * (S.overload > 0 ? 3 : 1)
      if (rnd() < 5 * dt) burst(m.x, m.y, 3, { hue: rnd(), spd: 100, life: 0.4, size: 2 })
    }
    if (m.hp <= 0) {
      S.mages.splice(i, 1)
      S.kills++
      S.dust += 12
      sfx('kill')
      burst(m.x, m.y, 30, { mono: 1, spd: 190, life: 0.9, size: 3, grav: 100 })
      ring(m.x, m.y, { hue: 0.78, r0: 6, r1: 130, life: 0.5, w: 4 })
      hint('Void Mage silenced')
      continue
    }

    // Lock the target BEFORE firing and hold it, so render.js can telegraph
    // the strike. The player gets ~TELEGRAPH seconds to reroute or Overload.
    if (m.cast <= TELEGRAPH && !m.aim) m.aim = mageTarget()

    if (m.cast <= 0) {
      const t = m.aim
      m.aim = null
      m.cast = MAGE_CAST + rand(-0.6, 0.6)
      if (t) {
        const dx = t[0] - m.x
        const dy = t[1] - m.y
        const d = hypot(dx, dy) || 1
        S.bolts.push({ x: m.x, y: m.y - 18, vx: (dx / d) * 210, vy: (dy / d) * 210, life: d / 210 })
        burst(m.x, m.y - 18, 8, { mono: 1, spd: 60, life: 0.6, size: 2.4 })
      }
    }
  }
}

const updateBolts = (dt) => {
  for (let i = S.bolts.length - 1; i >= 0; i--) {
    const b = S.bolts[i]
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.life -= dt
    if (rnd() < 26 * dt) burst(b.x, b.y, 2, { mono: 1, spd: 30, life: 0.5, size: 2.2 })
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > S.w || b.y > S.h) {
      S.bolts.splice(i, 1)
      S.wounds.push({ x: b.x, y: b.y, r: WOUND_R, life: WOUND_LIFE, ml: WOUND_LIFE })
      sfx('cut')
      shakeAdd(0.26)
      burst(b.x, b.y, 34, { mono: 1, spd: 210, life: 0.9, size: 3 })
      ring(b.x, b.y, { hue: 0.75, r0: 4, r1: WOUND_R * 2, life: 0.45, w: 5, mono: 1 })
      hint('Trail cut! Reroute, or SPACE to Overload')
    }
  }
}

const updateWounds = (dt) => {
  for (let i = S.wounds.length - 1; i >= 0; i--) {
    const w = S.wounds[i]
    w.life -= dt
    if (w.life <= 0) {
      S.wounds.splice(i, 1)
      burst(w.x, w.y, 12, { hue: rnd(), spd: 120, life: 0.7, size: 2.4 })
    }
  }
}

/* ---------------------------- overload ------------------------------ */

export const overload = () => {
  if (S.scene !== SC_PLAY) return 0
  if (S.overload > 0) return 0
  if (S.dust < OVERLOAD_COST) {
    hint('Not enough Glitter Dust')
    return 0
  }
  S.dust -= OVERLOAD_COST
  S.overload = OVERLOAD_TIME
  const x = S.hive.x
  const y = S.hive.y
  // Purge every Void Wound on the map.
  for (const w of S.wounds) burst(w.x, w.y, 26, { hue: rnd(), spd: 240, life: 0.9, size: 3 })
  S.wounds.length = 0
  glitterWave(x, y)
  flashAdd(0.9)
  shakeAdd(1)
  sfx('overload')
  // Blast the front line back.
  for (const s of S.soldiers) {
    const d = hypot(s.x - x, s.y - y) || 1
    s.hp -= 40
    s.x += ((s.x - x) / d) * 40
    s.y += ((s.y - y) / d) * 40
  }
  hint('OVERLOAD! The swarm is invincible')
  return 1
}

/* ------------------------------ frame ------------------------------- */

export const step = (dt) => {
  if (S.scene !== SC_PLAY) return
  S.overload = max(0, S.overload - dt)

  rebuildGrid()
  for (const tr of S.trails) tr.use = 0

  updateCuts()
  updateUnits(dt)
  flock(dt)
  updateCastles(dt)
  updateSoldiers(dt)
  updateMages(dt)
  updateBolts(dt)
  updateWounds(dt)
  pruneTrails()
  setSwarm(S.units.length)

  // Victory: every grey castle is now a neon hive.
  let left = 0
  for (const c of S.castles) if (!c.main && c.st !== ST_HIVE) left++
  if (!left && S.scene === SC_PLAY) {
    S.scene = SC_CLEAR
    S.over = 0
    S.conquered = max(S.conquered, S.region + 1)
    sfx('win')
    flashAdd(0.7)
    for (let i = 0; i < 5; i++) ring(S.w / 2, S.h / 2, { hue: rnd(), r0: 10, r1: 700 + i * 120, life: 1 + i * 0.2, w: 10 - i })
  }
}

export { addUnit, near }

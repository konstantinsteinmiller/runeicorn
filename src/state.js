/**
 * SHARED CONTRACT — every module imports from here. Do not add per-module
 * globals; hang shared data off `S`.
 *
 * Coordinate system: CSS pixels of the viewport. One region = one screenful,
 * no scrolling. Layout is authored in normalized 0..1 space (`nx`,`ny`) and
 * projected to pixels on every resize, so everything is responsive by default.
 *
 * ART DIRECTION (from the storyboard):
 *   The Grim Empire is a pencil sketch — greys, hatching, jittered strokes,
 *   paper grain. The infection is pure neon: additive rainbow, bloom, glitter.
 *   Nothing colourful exists that the player did not cause.
 */
import { TAU, sin, cos, hypot } from './u.js'

/* ----------------------------- scenes ----------------------------- */
export const SC_PLAY = 0
export const SC_CLEAR = 1 // region conquered
export const SC_DEAD = 2 // main hive destroyed
export const SC_MAP = 3 // world map (storyboard panel 8)

/* ------------------------- castle states -------------------------- */
export const ST_GREY = 0
export const ST_CONV = 1 // conversion meter filling
export const ST_HIVE = 2 // neon rainbow hive

/* --------------------------- tuning ------------------------------- */
// Ceiling on live mini-unicorns. Lowered from 900 when the sprites doubled in
// size: each unit now covers 4x the pixels, so a packed swarm blends the same
// pixels dozens deep and overdraw — not draw-call count — becomes the limit.
// 520 big unicorns fill the screen exactly as much as 900 small ones did, and
// you can actually tell they are unicorns.
export const UNIT_CAP = 520
export const PART_CAP = 620 // hard ceiling on particles
export const UNIT_SPD = 132 // px/s base follow speed
// Separation radius. Kept in step with the sprite size (UNI_SCALE) — at 52 CSS
// px a 10 px spacing packed the swarm into an unreadable mass.
export const UNIT_R = 9
export const SPAWN_MAIN = 4.6 // units/s from the main hive
export const SPAWN_HIVE = 2.4 // units/s from a converted hive
export const CLONE_RATE = 0.7 // clones per unit per second on a healthy trail
export const UNIT_DMG = 26 // contact damage per second
/** Unicorns that must crash into a castle to flip it. Tuned so the FIRST
 *  conversion lands early — that reward is what starts the snowball. */
export const CONV_NEED = 72
export const CAP_BASE = 2400 // starting prismatic capacity (px of trail)
export const CAP_PER_HIVE = 900 // capacity gained per converted hive
export const OVERLOAD_COST = 60 // glitter dust per Overload Glitter Wave
export const OVERLOAD_TIME = 3 // seconds of swarm invincibility
export const SOLDIER_HP = 60
export const SOLDIER_SPD = 26
export const SOLDIER_DMG = 7 // damage per second to the hive
export const MAGE_CAST = 7 // seconds between Void Wound casts
export const WOUND_R = 58 // Void Wound radius
// Wounds must expire well before the next cast, or the trail is dead more
// often than it is alive and the swarm can never snowball.
export const WOUND_LIFE = 5.5
export const HIVE_HP = 160

/** Sprite atlas geometry — sprites.js builds it, render.js blits it. */
export const TILE = 26 // base CSS px per tile
export const SS = 2 // atlas supersample factor
/** Per-atlas size multipliers. Each sheet is rasterised at its own resolution
 *  (not upscaled at blit time), so bigger sprites stay crisp. */
export const UNI_SCALE = 2 // mini-unicorns: 52 CSS px
export const SOL_SCALE = 1.5 // grey soldiers: 39 CSS px
export const UNI_ROT = 16 // unicorn rotation steps
export const UNI_FRAMES = 6 // unicorn run-cycle frames
export const SOL_ROT = 8
export const SOL_FRAMES = 4

/* ---------------------------- state ------------------------------- */
export const S = {
  /* viewport */
  w: 0,
  h: 0,
  dpr: 1,
  sc: 1, // UI scale factor, ~1 at 900px wide, clamped
  t: 0, // seconds since boot
  dt: 0, // clamped frame delta in seconds

  /* flow */
  scene: SC_PLAY,
  region: 0, // index of the region being played
  conquered: 0, // highest region cleared
  intro: 1, // title card visible until the first drag
  help: 0, // tutorial overlay is up (modal)
  over: 0, // seconds spent on the current end-of-scene overlay

  /* entities */
  units: [], // {x,y,vx,vy,ph,tr,ti,inv}
  soldiers: [], // {x,y,vx,vy,hp,ph,ang}
  mages: [], // {x,y,cast,ph,hp}
  bolts: [], // {x,y,vx,vy,life}
  wounds: [], // {x,y,r,life,ml}
  castles: [], // {nx,ny,x,y,r,st,conv:0..1,hp,spawn,main,seed}
  trails: [], // {p:[x,y,...],use,cut:[bool per node],src}
  hive: null, // shortcut to the main hive castle

  /* resources */
  dust: 0,
  cap: CAP_BASE,
  capUsed: 0,
  kills: 0,
  overload: 0, // seconds of Overload still active

  /* input */
  drawing: null, // the trail currently under the cursor
  px: 0,
  py: 0, // last pointer position
  down: 0,

  /* adaptive quality: 1 = full bloom, 0 = degraded on slow hardware */
  q: 1,
  fdt: 0.016, // smoothed frame time, seconds

  /* feel */
  shake: 0,
  flash: 0,
  hitStop: 0,
  hint: '',
  hintT: 0,
  muted: 0,
}

/** Project normalized layout coords to pixels. Called on resize. */
export const project = () => {
  const m = 60 * S.sc
  for (const c of S.castles) {
    c.x = m + c.nx * (S.w - m * 2)
    c.y = m + c.ny * (S.h - m * 2)
  }
  for (const e of S.mages) {
    e.x = m + e.nx * (S.w - m * 2)
    e.y = m + e.ny * (S.h - m * 2)
  }
}

/** Show a transient hint line under the HUD. */
export const hint = (text, secs = 4) => {
  S.hint = text
  S.hintT = secs
}

/** Nearest live enemy target (castle or soldier) to a point, or null. */
export const nearestTarget = (x, y, maxD = 1e9) => {
  let best = null
  let bd = maxD
  for (const s of S.soldiers) {
    const d = hypot(s.x - x, s.y - y)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  for (const c of S.castles) {
    if (c.st === ST_HIVE) continue
    const d = hypot(c.x - x, c.y - y) - c.r
    if (d < bd) {
      bd = d
      best = c
    }
  }
  return best
}

/** Is this point inside an active Void Wound? */
export const inWound = (x, y) => {
  for (const w of S.wounds) if (hypot(w.x - x, w.y - y) < w.r) return w
  return null
}

/** Rainbow helper: the infection's signature colour ramp. */
export const rainbow = (v, l = 60, a = 1) => `hsla(${(v * 360) % 360},100%,${l}%,${a})`

/** Cheap pulsing value for neon breathing. */
export const pulse = (t, speed = 1) => 0.5 + 0.5 * sin(t * speed * TAU)

export { TAU, sin, cos }

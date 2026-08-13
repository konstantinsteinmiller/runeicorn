/**
 * sprites.js — every pixel in the game is generated here, zero image assets.
 *
 * 1. ATLASES (built once, blitted hundreds of times per frame)
 *      UNI — galloping mini-unicorn, UNI_ROT rotations x UNI_FRAMES frames
 *      SOL — grey soldier with spear, SOL_ROT x SOL_FRAMES
 *    Layout: columns = rotation, rows = frame, so tile (r,f) lives at
 *    (r*TILE*SS, f*TILE*SS) and is TILE*SS px square. Rotation index r is
 *    the angle r/ROT*TAU as measured by atan2(vy, vx).
 * 2. IMMEDIATE-MODE STRUCTURES — castles, mages, the title-card leader.
 *
 * Style: the Grim Empire is graphite (jittered strokes, cross-hatching, no
 * flat fills); the infection is neon (saturated additive rainbow).
 * Everything is deterministic — wobble comes from `seeded`, never rnd().
 */
import {
  TILE,
  SS,
  UNI_ROT,
  UNI_FRAMES,
  SOL_ROT,
  SOL_FRAMES,
  ST_GREY,
  ST_CONV,
  ST_HIVE,
  MAGE_CAST,
  UNI_SCALE,
  SOL_SCALE,
  S,
  rainbow,
  pulse,
} from './state.js'
import { TAU, sin, cos, max, clamp, lerp, seeded } from './u.js'

/** Atlas pixels per tile. */

export let UNI = null
export let SOL = null

/* --------------------------- ctx shorthands -------------------------- */

const F = (g, c) => ((g.fillStyle = c), g.fill())
const K = (g, c, w) => ((g.strokeStyle = c), (g.lineWidth = w), g.stroke())
const CO = (g, v) => (g.globalCompositeOperation = v ? 'lighter' : 'source-over')
const RD = (g) => (g.lineCap = g.lineJoin = 'round')
const AR = (g, x, y, r) => (g.beginPath(), g.arc(x, y, r, 0, TAU))
/** Vertical rainbow ramp — signature look of every infected structure. */
const LG = (g, y0, y1, t, a) => {
  const q = g.createLinearGradient(0, y0, 0, y1)
  for (let i = 0; i < 5; i++) q.addColorStop(i / 4, rainbow(t * 0.12 + i * 0.2, 60, a))
  return q
}

/* ------------------- local space -> screen, with wobble --------------- */
/* Shapes are authored in a small local unit space; OX/OY/OK place them and
   R/J add the hand-drawn jitter. All module state, so the helpers stay
   one-liners. R is re-seeded per shape, so nothing ever shimmers. */

let R = seeded(1)
let J = 0
let OX = 0
let OY = 0
let OK = 1

const M = (g, x, y) => g.moveTo(OX + x * OK, OY + y * OK)
const L = (g, x, y) => g.lineTo(OX + x * OK, OY + y * OK)
/** Append a wobbly polyline (flat [x,y,...]) as a new subpath. */
const sub = (g, a) => {
  for (let i = 0; i < a.length; i += 2) (i ? L : M)(g, a[i] + (R() - 0.5) * J, a[i + 1] + (R() - 0.5) * J)
}
/** Hand-drawn rectangle (deliberately does not close cleanly). */
const box = (g, x, y, w, h) => sub(g, [x, y, x + w, y, x + w, y + h, x, y + h, x, y])
/** Closed wobbly polygon, filled then outlined — the graphite workhorse. */
const shape = (g, a, f, s, w) => {
  g.beginPath()
  sub(g, a)
  g.closePath()
  F(g, f)
  K(g, s, w)
}
/** Diagonal graphite hatching — call inside a clip. */
const hatch = (g, x, y, w, h, n, c, lw) => {
  g.beginPath()
  for (let i = 0; i < n; i++) {
    const u = x - h + ((w + h) * i) / n
    M(g, u, y + h)
    L(g, u + h, y)
  }
  K(g, c, lw)
}

/* ----------------------- tilted 3/4 projection ------------------------ */
/* Atlas units live in body space: f = forward, s = lateral, z = height. The
   rig is turned by the tile heading, the ground squashed to .54 and height
   lifted by .8 — a cheap above-ish/side view that still reads at 26 CSS px.
   BOB bounces and PIT pitches the whole animal through the run cycle. */

let CA = 1
let SA = 0
let BOB = 0
let PIT = 0

/** Stroke a polyline given as flat [f,s,z,...] body-space triples. */
const s3 = (g, a, w, c) => {
  g.beginPath()
  for (let i = 0; i < a.length; i += 3) {
    const f = a[i]
    const s = a[i + 1]
    L(g, f * CA - s * SA, (f * SA + s * CA) * 0.54 - (a[i + 2] + BOB + f * PIT) * 0.8)
  }
  K(g, c, w)
}

/**
 * One leg. `ph` 0..1 walks the hoof through stance (planted, sliding back)
 * then swing (lifted, gathering forward) — a real contact/push cycle.
 */
const leg = (g, f, s, ph, w, c, m) => {
  const u = cos(ph * TAU) * m
  const l = max(0, -sin(ph * TAU)) * m
  s3(g, [f, s, 10.5, f + u * 0.45, s, 5 + l * 0.6, f + u, s, l], w, c)
}

/* ------------------------------ the swarm ----------------------------- */

/**
 * Mini-unicorn: white, horned, fierce, rainbow mane and tail, transverse
 * gallop (hinds land, then fores, then a suspension moment). The soft white
 * rim is the stroke's own shadow, so the whole animal is a single pass.
 */
const uni = (g, a, p) => {
  CA = cos(a)
  SA = sin(a)
  BOB = 2 * sin(p * TAU + 1)
  PIT = 0.15 * sin(p * TAU + 2)
  g.shadowColor = '#cef'
  g.shadowBlur = 6
  const D = '#a9a9c4'
  const W = '#fff'
  leg(g, -5, -3, p, 2.6, D, 4) // far pair
  leg(g, 5, -3, p + 0.44, 2.6, D, 4)
  s3(g, [-8, 0, 11, -2, 0, 12, 4, 0, 12, 7, 0, 11], 7, W) // barrel
  s3(g, [6, 0, 12, 10, 0, 16], 5, W) // neck
  s3(g, [10, 0, 17, 15, 0, 16], 3.6, W) // head + muzzle
  leg(g, -5, 3, p + 0.1, 3, W, 4) // near pair
  leg(g, 5, 3, p + 0.54, 3, W, 4)
  s3(g, [14, 0, 19, 20, 0, 24], 2, W) // horn
  g.shadowBlur = 0
  // rainbow mane (i < 3) and tail (i > 2), riding the body's bob
  for (let i = 0; i < 6; i++) {
    const m = i > 2
    const j = i % 3
    const f = (m ? -8 : 12) - j * 3.2
    const z = (m ? 13 : 19) - j * (m ? 1 : 2)
    s3(g, [f, 0, z, f - 3, 0, z - (m ? 1 : 2)], 3.4 - j * 0.5, rainbow((m ? 0.45 : 0) + j * 0.25 + p * 0.3, 64))
  }
}

/** Grey soldier: monochrome silhouette, helmet, spear, marching. */
const sol = (g, a, p) => {
  CA = cos(a)
  SA = sin(a)
  BOB = 0.5 * (1 - cos(p * 2 * TAU))
  PIT = 0
  g.shadowColor = '#0b0b12'
  g.shadowBlur = 4 // graphite smudge instead of a second outline pass
  const D = '#74748a'
  const B = '#c0c0d0'
  leg(g, 0, -2, p, 3, D, 3)
  leg(g, 0, 2, p + 0.5, 3, D, 3)
  s3(g, [-1, 0, 10, 0, 0, 17], 8, D) // torso
  s3(g, [0, 0, 18, 0, 0, 20], 6.5, B) // helmet
  s3(g, [-2.5, 0, 21, 2, 0, 19], 2, B) // crest + nose guard
  s3(g, [4, 3.4, 1, 1, 3.4, 26], 2, D) // spear shaft
  s3(g, [1.4, 3.4, 23, 1, 3.4, 30], 3, B) // spear head
  g.shadowBlur = 0
}

/* -------------------------------- atlases ----------------------------- */

/**
 * Rasterise one atlas.
 * `px`   — atlas tile size in pixels (drives resolution AND on-screen size)
 * `body` — body-space divisor; k = px/body keeps the animal's proportion of
 *          the tile constant however big the tile gets.
 * Returns `px` (source rect) and `tile` (CSS destination size) separately, so
 * each sheet can be a different size on screen.
 */
const sheet = (rot, frames, css, body, cy, fn) => {
  // Rasterise at EXACTLY the device pixel size the sprite is blitted at, so
  // drawImage is a 1:1 copy. A source/destination mismatch forces a filtered
  // rescale per unit, which collapsed to ~160 ms/frame at 600 units.
  const px = Math.round(css * (S.dpr || 1))
  const c = document.createElement('canvas')
  c.width = px * rot
  c.height = px * frames
  const g = c.getContext('2d')
  RD(g)
  for (let r = 0; r < rot; r++)
    for (let f = 0; f < frames; f++) {
      g.save()
      g.translate(r * px + px / 2, f * px + px * cy)
      g.scale(px / body, px / body)
      fn(g, (r / rot) * TAU, f / frames)
      g.restore()
    }
  return { c, rot, frames, px, tile: css }
}

/** Build every atlas once. Idempotent; call after DOM ready. */
export function buildAtlas() {
  if (UNI) return
  OX = OY = 0
  OK = 1
  UNI = sheet(UNI_ROT, UNI_FRAMES, TILE * UNI_SCALE, 48, 0.6, uni)
  SOL = sheet(SOL_ROT, SOL_FRAMES, TILE * SOL_SCALE, 44, 0.68, sol)
}

/* -------------------------------- castles ----------------------------- */

/**
 * Grey sketch fortress -> rising rainbow conversion meter -> pulsing neon
 * crystal hive, driven entirely by `c.st` and `c.conv` (0..1). The
 * silhouette is built once per frame and reused as fill, outline and clip.
 */
export function drawCastle(g, c, t) {
  const x = c.x
  const r = c.r
  const W = r * 1.8
  const gy = c.y + r * 0.85
  const top = gy - r * 2.4
  const lw = max(1, r * 0.055)
  const hv = c.st === ST_HIVE
  const pu = pulse(t, 0.45)
  const cv = hv ? 1 : clamp(c.conv || 0, 0, 1)
  const fy = gy - (gy - top) * cv
  const q = hv && LG(g, gy, top - r, t, 1)
  OX = OY = 0
  OK = 1
  RD(g)

  // keep, towers and roofs — silhouette varies with c.seed but never shimmers
  R = seeded(1 + ((c.seed * 9301) & 32767))
  J = r * 0.05
  g.beginPath()
  box(g, x - W / 2, gy - r, W, r)
  const n = 3 + ((R() * 2) | 0)
  for (let i = 0; i < n; i++) {
    const w = (W / n) * 0.8
    const tx = x - W / 2 + (W * (i + 0.5)) / n - w / 2
    const h = r * (1.2 + R() * 0.9)
    box(g, tx, gy - h, w, h)
    sub(g, [tx - w * 0.25, gy - h, tx + w / 2, gy - h - w * 0.9, tx + w * 1.25, gy - h])
  }
  F(g, hv ? 'rgba(9,4,22,.9)' : '#191920')
  K(g, hv ? q : '#9c9caa', lw * (hv ? 1.4 : 1))

  g.save()
  g.clip()
  hatch(g, x - W, top, W * 2, gy - top, c.st === ST_CONV ? 10 : 14, 'rgba(206,206,226,.3)', lw * 0.5)
  if (cv > 0.002) {
    // the infection floods the silhouette from the ground up
    CO(g, 1)
    g.fillStyle = LG(g, gy, top, t, hv ? 0.45 + pu * 0.3 : 0.8)
    g.fillRect(x - W, fy, W * 2, gy - fy)
    CO(g, 0)
  }
  g.restore()

  CO(g, 1)
  if (hv) {
    // crystalline spiral of light corkscrewing out of the keep
    g.beginPath()
    for (let i = 0; i <= 30; i++) {
      const u = i / 30
      const a = u * TAU * (c.main ? 4 : 3) + t * 1.3
      const rr = r * 0.7 * (1 - u * 0.85)
      g.lineTo(x + cos(a) * rr, gy - r * 0.9 - u * r * 1.8 + sin(a) * rr * 0.3)
    }
    g.globalAlpha = 0.3
    K(g, q, lw * 4.5 * (0.6 + pu * 0.5)) // bloom is a fat soft stroke, not a shadow
    g.globalAlpha = 1
    K(g, q, lw * 1.5)
  } else if (cv > 0.002) {
    // the meter's own fill line glows and breathes
    g.beginPath()
    M(g, x - W * 0.55, fy)
    L(g, x + W * 0.55, fy)
    K(g, rainbow(t * 0.5, 82, 0.95), lw * (1.2 + pulse(t, 2) * 1.4))
  }
  CO(g, 0)
}

/* --------------------------------- mages ------------------------------ */

/** Hooded Void Mage on a plinth, hands raised, dark smoke pouring upward. */
export function drawMage(g, m, t) {
  const ph = m.ph || 0
  // `m.cast` counts DOWN to 0 at the moment of the cast, so charge is inverted.
  const ch = 1 - clamp((m.cast || 0) / MAGE_CAST, 0, 1)
  OK = 1.15 * (S.sc || 1)
  OX = m.x
  OY = m.y
  R = seeded(11 + ((ph * 733) & 511))
  J = 1.1
  RD(g)

  g.beginPath()
  sub(g, [-7, -28, 7, -28, 15, -1, 0, -4, -15, -1, -7, -28]) // robe
  sub(g, [-8, -27, -9, -39, 0, -46, 9, -39, 8, -27]) // cowl
  F(g, '#14141b')
  K(g, '#70707e', OK * 1.4)
  g.beginPath()
  sub(g, [-6, -26, -13, -35, -10, -46]) // arms, raised
  sub(g, [6, -26, 13, -35, 10, -46])
  K(g, '#565666', OK * 3.4)

  const E = `hsla(287,95%,${50 + ch * 32}%,`
  g.beginPath()
  for (let i = 0; i < 2; i++) g.arc(OX + (i * 5.6 - 2.8) * OK, OY - 37 * OK, 1.4 * OK, 0, TAU) // eyes in the void
  F(g, E + (0.6 + ch * 0.4) + ')')

  // the void spell gathering between the hands
  const oy = OY - 50 * OK
  AR(g, OX, oy, (2 + ch * 8) * OK)
  F(g, `rgba(16,2,30,${0.4 + ch * 0.5})`)
  K(g, E + (0.25 + ch * 0.65) + ')', OK * 1.6)

  // dark smoke, deterministic off t and the mage's own phase
  for (let i = 0; i < 4; i++) {
    const u = (t * 0.32 + ph + i * 0.25) % 1
    AR(g, OX + sin(u * 6 + i * 2) * 7 * u * OK, OY - (46 + u * 32) * OK, (2 + u * 7) * OK)
    F(g, `rgba(56,46,78,${(1 - u) * 0.5})`)
  }
}

/* ------------------------------ title leader --------------------------- */

/* Fierce unicorn head, three-quarter, facing left. A plain polygon: `sub`
   wobbles it into a pencil line, which is cheaper AND more on-style than
   bezier control points would be. */
// prettier-ignore
const HEAD = [-58, 4, -60, 12, -54, 18, -46, 20, -34, 24, -18, 30, -2, 34, 14, 30, 22, 6, 18, -20, 6, -34, -6, -32, -22, -22, -40, -10, -52, -2]

/** The leader: big graphite unicorn head, rainbow mane, glowing eye. */
export function drawLeader(g, x, y, size, t) {
  OK = size / 120
  OX = x + OK
  OY = y + 23 * OK
  R = seeded(1337)
  J = 1.5
  RD(g)

  // mane: rainbow ribbons streaming off the crest, behind the head
  for (let i = 0; i < 11; i++) {
    const u = i / 10
    g.beginPath()
    for (let j = 0; j < 5; j++) {
      const v = j / 4
      L(g, lerp(4, 22, u) + v * (20 + u * 14), lerp(-34, 6, u) + v * (10 + u * 20) + sin(v * 3 + u * 5 + t) * 6 * v)
    }
    K(g, rainbow(u * 0.85 + t * 0.08, 62), size * 0.026 * (1 - u * 0.3))
  }

  // horn and ear — the horn is the one part of the leader already infected
  shape(g, [-22, -18, -30, -84, -2, -30], LG(g, OY - 84 * OK, OY - 18 * OK, t * 1.7, 0.95), '#fff', size * 0.008)
  shape(g, [8, -32, 16, -54, 21, -26], '#4c4c57', '#c6c6d4', size * 0.012)

  // skull: graphite gradient, pencil outline and cross-hatched shading, all
  // three off a single path build
  shape(g, HEAD, '#83838f', '#dcdce8', size * 0.014)
  g.save()
  g.clip()
  hatch(g, -58, -4, 82, 42, 12, 'rgba(16,16,26,.26)', size * 0.015)
  g.restore()

  // glowing eye — one big element, so shadowBlur is affordable here
  g.shadowColor = '#9ff'
  g.shadowBlur = size * 0.1 * (0.6 + pulse(t, 0.8) * 0.4)
  g.beginPath()
  g.ellipse(OX - 26 * OK, OY - 9 * OK, size * 0.046, size * 0.032, -0.3, 0, TAU)
  F(g, '#eaffff')
  g.fill()
  g.shadowBlur = 0

  // nostril and mouth — the two lines that turn the muzzle into a face
  g.beginPath()
  M(g, -57, 4)
  L(g, -51, 6)
  M(g, -57, 13)
  L(g, -48, 16)
  M(g, -20, -22) // brow
  L(g, -33, -11)
  M(g, 8, -18) // cheekbone and jowl
  L(g, -3, 3)
  L(g, -15, 13)
  K(g, '#2a2a36', size * 0.013)
}

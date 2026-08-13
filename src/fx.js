/**
 * FX — the juice layer. Everything colourful that the player did not draw
 * comes from here: glitter, sparks, shockwave rings, screen shake, screen
 * flash, plus the grim-sketch post pass (vignette + paper grain).
 *
 * Design notes for the 13kB budget and the 900-particle target:
 *   - ONE flat Float32Array pool, stride ST. No per-particle objects, ever.
 *     `updateFx` is allocation-free; dead particles are swap-removed with
 *     `copyWithin`, and a saturated pool round-robins over the oldest slot.
 *   - Life is stored NORMALISED (1 -> 0) with a decay rate, so no draw pass
 *     ever divides.
 *   - Colours are never concatenated in the hot loop. `PAL` is a NH x NL table
 *     of hsl strings (hue bucket x brightness bucket) built once from
 *     `rainbow()`; fading drops brightness, which under `lighter` is identical
 *     to fading alpha but costs no string work. The mono greys live in the
 *     same array past index NH*NL.
 *   - Small motes are `fillRect` (no path); only fat ones pay for `arc`.
 *   - No `shadowBlur`, no `save/restore` per particle. Bloom is faked by
 *     over-drawing a dim, larger quad under each bright mote — additive
 *     blending turns the overlap into a hot core.
 *
 * Trauma and flash live on `S.shake` / `S.flash`, so other modules can just do
 * `S.shake += 0.3` and this file picks it up and decays it.
 */
import { PART_CAP, S, rainbow } from './state.js'
import { TAU, rnd, min, max, sin, cos, hypot } from './u.js'

/* --------------------------- pools & tables ------------------------- */

const ST = 11 // x, y, vx, vy, k, rate, hue, size, grav, drag, flags
const RST = 9 // x, y, r0, span, k, rate, width, hue, mono
const RCAP = 32 // simultaneous rings
const NH = 32 // hue buckets (power of two: masked, never modulo'd)
const NL = 8 // brightness buckets
const GT = 128 // grain tile size

const P = new Float32Array(PART_CAP * ST)
const R = new Float32Array(RCAP * RST)
const SO = [0, 0] // reused shake vector — shakeOffset() must not allocate
const CM = ['source-over', 'lighter']

let np = 0 // live particles
let nr = 0 // live rings
let rp = 0 // recycle cursors, used only once a pool is saturated
let rr = 0

/** hue bucket * NL + brightness bucket -> ready-made colour string. */
const PAL = []
for (let h = 0; h < NH; h++) for (let l = 0; l < NL; l++) PAL.push(rainbow(h / NH, 4 + l * 11, 1))

/** Claim a pool slot. Never grows past PART_CAP: recycles instead. */
const slot = () => (np < PART_CAP ? np++ : (rp = (rp + 1) % PART_CAP)) * ST

/** Normalised life -> brightness bucket. */
const lvl = (k) => (k >= 1 ? NL - 1 : (k * NL) | 0)

/**
 * Age one pool: integrate (particles only), then swap-remove the expired.
 * Allocation-free — `copyWithin` moves the tail slot over the hole.
 */
const decay = (A, n, st, dt) => {
  for (let i = 0; i < n; i++) {
    const p = i * st
    if (A === P) {
      const d = max(0, 1 - A[p + 9] * dt)
      const vx = (A[p + 2] *= d)
      const vy = (A[p + 3] = A[p + 3] * d + A[p + 8] * dt)
      A[p] += vx * dt
      A[p + 1] += vy * dt
    }
    if ((A[p + 4] -= A[p + 5] * dt) <= 0) {
      const q = --n * st
      if (q !== p) A.copyWithin(p, q, q + st)
      i--
    }
  }
  return n
}

/* ------------------------------ spawning ---------------------------- */

/**
 * Spawn `n` particles at (x,y). `hue` is 0..1 (omit for full rainbow),
 * `mono` routes to the grey under layer, `add` (default on) picks additive.
 */
export const burst = (
  x,
  y,
  n,
  { hue, spread = TAU, dir = 0, spd = 190, life = 0.8, size = 2, grav = 0, drag = 2, mono, add = 1 } = {}
) => {
  const f = (mono ? 1 : 0) | (add ? 2 : 0)
  // Degraded quality: emit half the particles. Fill rate is the cost here, so
  // halving the count roughly halves the FX budget without changing any timing.
  if (!S.q) n = (n + 1) >> 1
  while (n-- > 0) {
    const p = slot()
    const a = dir + (rnd() - 0.5) * spread
    const v = spd * (0.2 + rnd() * rnd() * 1.2)
    P[p] = x
    P[p + 1] = y
    P[p + 2] = cos(a) * v
    P[p + 3] = sin(a) * v
    P[p + 4] = 1
    P[p + 5] = 1 / (life * (0.5 + rnd() * 0.9))
    P[p + 6] = hue == null ? rnd() : hue + (rnd() - 0.5) * 0.14
    P[p + 7] = size * (0.45 + rnd())
    P[p + 8] = grav
    P[p + 9] = drag
    P[p + 10] = f
  }
}

/** Expanding shockwave ring. */
export const ring = (x, y, { hue = rnd(), r0 = 4, r1 = 140, life = 0.5, w = 7, mono } = {}) => {
  const p = (nr < RCAP ? nr++ : (rr = (rr + 1) % RCAP)) * RST
  R[p] = x
  R[p + 1] = y
  R[p + 2] = r0
  R[p + 3] = r1 - r0
  R[p + 4] = 1
  R[p + 5] = 1 / life
  R[p + 6] = w
  R[p + 7] = hue
  R[p + 8] = mono ? 1 : 0
}

/** Add screen-shake trauma (shake = trauma^2). */
export const shakeAdd = (v) => (S.shake = min(1.2, S.shake + v))

/** Add an additive full-screen flash. */
export const flashAdd = (v) => (S.flash = min(1.5, S.flash + v))

/** The Overload Glitter Wave: the money shot. */
export const glitterWave = (x, y) => {
  const d = hypot(S.w, S.h)
  for (let i = 0; i < 3; i++)
    ring(x, y, { r1: d * (1.05 - i * 0.33), life: 0.9 - i * 0.27, w: 40 - i * 14 })
  // One burst, not two. 520 particles in a single frame was the largest
  // allocation/fill spike in the game and it fires on every conversion.
  burst(x, y, 300, { spd: 1150, life: 1.7, size: 3.2, drag: 1.7, grav: 60 })
  flashAdd(0.8)
  shakeAdd(0.55)
}

/* ------------------------------- update ----------------------------- */

/** Step everything. Allocation-free; safe to call with a clamped dt. */
export const updateFx = (dt) => {
  // Snappier settle: trauma should read as an impact, not a rumble.
  S.shake = max(0, S.shake - dt * (2.3 + S.shake * 2))
  S.flash = max(0, S.flash - dt * 2.6)
  if (np > PART_CAP) np = PART_CAP
  np = decay(P, np, ST, dt)
  nr = decay(R, nr, RST, dt)
}

/* -------------------------------- draw ------------------------------ */

/** Under the units: ground scorch, void smoke, grey sketch debris. */
export const drawFxUnder = (g) => {
  g.lineCap = 'round'
  g.strokeStyle = '#1a1820'
  for (let i = 0; i < np; i++) {
    const p = i * ST
    if (!(P[p + 10] & 1)) continue
    const k = P[p + 4]
    const x = P[p]
    const y = P[p + 1]
    g.globalAlpha = k * 0.85
    g.lineWidth = P[p + 7] * (0.35 + 0.65 * k)
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x - P[p + 2] * 0.02, y - P[p + 3] * 0.02)
    g.stroke()
  }
  g.globalAlpha = 1
}

/** Over the units: additive glitter, sparks and shockwave rings. */
export const drawFxOver = (g) => {
  let cm = (g.globalCompositeOperation = CM[1])
  for (let i = 0; i < np; i++) {
    const p = i * ST
    const f = P[p + 10]
    if (f & 1) continue
    const m = CM[f >> 1]
    if (m !== cm) g.globalCompositeOperation = cm = m
    const k = P[p + 4]
    const hu = P[p + 6]
    const b = (((hu * NH) | 0) & (NH - 1)) * NL
    const l = lvl(k)
    const x = P[p]
    const y = P[p + 1]
    const s = P[p + 7] * (0.3 + 0.7 * k) * (0.82 + 0.3 * sin(S.t * 24 + hu * 99))
    if (s > 1.5) {
      const w = s * 2.6
      g.fillStyle = PAL[b + (l >> 1)]
      g.fillRect(x - w, y - w, w + w, w + w)
    }
    g.fillStyle = PAL[b + l]
    if (s < 2.4) g.fillRect(x - s, y - s, s + s, s + s)
    else {
      g.beginPath()
      g.arc(x, y, s, 0, TAU)
      g.fill()
    }
  }
  for (let i = 0; i < nr; i++) {
    const p = i * RST
    const k = R[p + 4]
    const a = k * k
    const mo = R[p + 8]
    const hu = R[p + 7] + (1 - k) * 0.4
    const w = R[p + 6] * k
    g.globalCompositeOperation = CM[mo ? 0 : 1]
    g.beginPath()
    g.arc(R[p], R[p + 1], R[p + 2] + R[p + 3] * (1 - a), 0, TAU)
    g.lineWidth = w
    g.strokeStyle = rainbow(hu, mo ? 7 : 54, a * 0.55)
    g.stroke()
    g.lineWidth = w * 0.26
    g.strokeStyle = rainbow(hu + 0.12, mo ? 7 : 92, a)
    g.stroke()
  }
  g.globalCompositeOperation = CM[0]
}

/* ----------------------------- post pass ---------------------------- */

let pat = null
let vig = null
let vw = 0

/** Full-screen pass: flash, vignette, film grain. Call with no world transform. */
export const drawPost = (g) => {
  const w = S.w
  const h = S.h
  if (S.flash > 0.004) {
    g.globalCompositeOperation = CM[1]
    g.fillStyle = rainbow(S.t * 0.3, 92, min(1, S.flash) * 0.8)
    g.fillRect(0, 0, w, h)
  }
  g.globalCompositeOperation = CM[0]
  if (vw !== w + h) {
    vw = w + h
    vig = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, hypot(w, h) * 0.62)
    vig.addColorStop(0, '#0000')
    vig.addColorStop(1, '#030307c7')
  }
  if (!pat) {
    const t = document.createElement('canvas')
    t.width = t.height = GT
    const q = t.getContext('2d')
    for (let i = 3200; i--; ) {
      q.fillStyle = i & 1 ? '#fff' : '#000'
      q.fillRect((rnd() * GT) | 0, (rnd() * GT) | 0, 1, 1)
    }
    pat = g.createPattern(t, 'repeat')
  }
  g.fillStyle = vig
  g.fillRect(0, 0, w, h)
  const o = (rnd() * GT) | 0
  g.globalAlpha = 0.075
  g.translate(-o, -o)
  g.fillStyle = pat
  g.fillRect(o, o, w, h)
  g.translate(o, o)
  g.globalAlpha = 1
}

/* ------------------------------ queries ----------------------------- */

/** Positional shake offset the renderer applies before drawing the world. */
export const shakeOffset = () => {
  const s = S.shake * S.shake * 17 * S.sc
  SO[0] = (rnd() * 2 - 1) * s
  SO[1] = (rnd() * 2 - 1) * s
  return SO
}

/** Live particle count, for the debug HUD. */
export const fxCount = () => np

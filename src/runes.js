/**
 * Rune recognition — a compact $1 Unistroke Recognizer with the Protractor
 * (optimal cosine distance) extension, as recommended by GDD 3.3.
 *
 * The classic $1 is rotation-invariant but NOT invariant to where you started
 * drawing a closed shape: a triangle begun at a different corner is a cyclic
 * shift of the point sequence, which $1 scores as a different gesture. Rather
 * than special-case that, we simply generate every start point and both
 * directions as separate templates at boot — 26 templates costs nothing and
 * makes the recogniser dramatically more forgiving, which GDD 3.3 and 6 both
 * insist on.
 */
import { FIRE, WIND, ICE, EARTH } from './state.js'
import { hypot, sin, cos, atan2, min, max, sqrt, TAU, PI } from './u.js'

/** Points per normalised stroke. 32 is plenty for four primitives. */
const N = 32

/* ------------------------- stroke normalisation ------------------------ */

const pathLen = (p) => {
  let d = 0
  for (let i = 2; i < p.length; i += 2) d += hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
  return d
}

/** Resample to exactly N evenly spaced points. */
const resample = (p) => {
  const I = pathLen(p) / (N - 1)
  const out = [p[0], p[1]]
  let D = 0
  let px = p[0]
  let py = p[1]
  for (let i = 2; i < p.length; i += 2) {
    const x = p[i]
    const y = p[i + 1]
    let d = hypot(x - px, y - py)
    if (D + d >= I && d > 0) {
      // Walk along this segment, emitting points until it is used up.
      let t = (I - D) / d
      let cx = px + t * (x - px)
      let cy = py + t * (y - py)
      out.push(cx, cy)
      // Re-enter the loop with the segment shortened.
      p.splice(i, 0, cx, cy)
      D = 0
      px = cx
      py = cy
      continue
    }
    D += d
    px = x
    py = y
  }
  while (out.length < N * 2) out.push(p[p.length - 2], p[p.length - 1])
  out.length = N * 2
  return out
}

/**
 * Scale into a unit square (non-uniform, as in $1 — it is more forgiving of
 * squashed drawings), translate the centroid to the origin, then vectorise
 * and normalise for Protractor's cosine distance.
 */
const vectorise = (p) => {
  let x0 = 1e9
  let y0 = 1e9
  let x1 = -1e9
  let y1 = -1e9
  for (let i = 0; i < p.length; i += 2) {
    x0 = min(x0, p[i])
    x1 = max(x1, p[i])
    y0 = min(y0, p[i + 1])
    y1 = max(y1, p[i + 1])
  }
  const w = x1 - x0 || 1
  const h = y1 - y0 || 1
  const v = new Float32Array(N * 2)
  let cx = 0
  let cy = 0
  for (let i = 0; i < N * 2; i += 2) {
    const x = ((p[i] - x0) / w) * 2 - 1
    const y = ((p[i + 1] - y0) / h) * 2 - 1
    v[i] = x
    v[i + 1] = y
    cx += x
    cy += y
  }
  cx /= N
  cy /= N
  let sum = 0
  for (let i = 0; i < N * 2; i += 2) {
    v[i] -= cx
    v[i + 1] -= cy
    sum += v[i] * v[i] + v[i + 1] * v[i + 1]
  }
  const m = sqrt(sum) || 1
  for (let i = 0; i < N * 2; i++) v[i] /= m
  return v
}

/**
 * Effective corner count — how CONCENTRATED the stroke's turning is.
 *
 * Protractor compares point positions, which cannot tell a corner from a
 * curve: a circle scored 0.992 against the square templates, higher than a
 * real square. So we add one scalar. With `t` = per-point turning angle,
 *   ec = (sum t^2)^2 / sum t^4
 * is ~k for k sharp corners and ~N for evenly spread curvature. It needs no
 * rotation or start-point alignment, so it costs one pass and nothing else.
 * Measured: all four runes land in 3.6..13, a circle at 29.6.
 */
const feat = (raw) => {
  // THREE 1-2-1 blur passes. One is not enough: hand jitter fakes corners and
  // inflates both features, and it inflates them MORE on a small stroke (the
  // jitter is the same size while the shape is not). Measured, one pass made a
  // small sloppy triangle score like a circle. Three passes flatten jitter but
  // leave real corners standing, which is what opens the gap that lets the
  // envelope below be generous to players and still ruthless with junk.
  let p = raw.slice()
  for (let k = 0; k < 3; k++) {
    const q = p.slice()
    for (let i = 1; i < N - 1; i++) {
      const j = i * 2
      p[j] = (q[j - 2] + 2 * q[j] + q[j + 2]) / 4
      p[j + 1] = (q[j - 1] + 2 * q[j + 1] + q[j + 3]) / 4
    }
  }
  let s2 = 0
  let s4 = 0
  let tot = 0
  for (let i = 1; i < N - 1; i++) {
    const j = i * 2
    const ax = p[j] - p[j - 2]
    const ay = p[j + 1] - p[j - 1]
    const bx = p[j + 2] - p[j]
    const by = p[j + 3] - p[j + 1]
    const a = atan2(ax * by - ay * bx, ax * bx + ay * by)
    const q = a * a
    s2 += q
    s4 += q * q
    tot += a < 0 ? -a : a // total heading swing
  }
  return [s4 > 0 ? (s2 * s2) / s4 : N, tot]
}

/**
 * Per-rune feature envelope: [ecMin, ecMax, turnMin, turnMax].
 *
 * Shape matching alone is far too generous — it will happily call a straight
 * swipe WIND and a circle EARTH, because Protractor compares point positions
 * and cannot see corners. So the winning template must also prove the stroke
 * HAS the right structure: a triangle really turning at three corners, a quad
 * at four, a star swinging ~4pi, a wave actually undulating.
 *
 * Bounds are p5..p95 over 300 strokes per case, measured across BOTH clean
 * large strokes and small very sloppy ones, then widened. After three blur
 * passes the junk sits far outside:
 *   straight line  turn 1.1-2.1  (every rune floor is 4.2)
 *   rough circle   ec 17.8-24.9  (every rune ceiling is at most 14.5)
 */
/* Floors sit well under the CLEAN case, not just the sloppy one: a perfectly
   drawn triangle measures turn 4.2 and a square 4.7, so a 4.2 floor rejected
   tidy triangles outright. Straight lines only reach 2.1, so there is room. */
const ENV = [
  [2, 9, 3.4, 9], // FIRE  — three corners, one loop
  // WIND is the loosest because a shallow two-hump wave is genuinely close to
  // a line: it swings only 3.1 where a line swings 2.1, so the floor sits in
  // that narrow gap. The ceiling still keeps rough circles (17.8+) out.
  [3.5, 17, 2.7, 12], // WIND  — must undulate, not just travel
  [1.5, 6.5, 4, 8.8], // ICE   — a Z: two hard corners, open stroke
  [4, 12.5, 3.6, 8], // EARTH — four corners, one loop
]

/** Protractor: optimal angular distance between two unit vectors. */
const score = (a, b) => {
  let ab = 0
  let cross = 0
  for (let i = 0; i < N * 2; i += 2) {
    ab += a[i] * b[i] + a[i + 1] * b[i + 1]
    cross += a[i] * b[i + 1] - a[i + 1] * b[i]
  }
  const angle = atan2(cross, ab)
  return ab * cos(angle) + cross * sin(angle) // 1 = identical
}

/* ---------------------------- the templates ---------------------------- */

/**
 * Sample a closed polygon whose corners lie on a circle, once.
 * No rotation argument: the matcher finds the optimal rotation itself, so how
 * the template happens to be oriented cannot affect a score.
 */
const poly = (corners) => {
  const p = []
  const per = 96 / corners // points per edge, plenty before resampling
  // `e < corners` closes the shape exactly once. Walking one edge further
  // retraces an edge and skews the normalised vector badly enough that
  // triangles scored higher against the square template than their own.
  for (let e = 0; e < corners; e++) {
    const a0 = e * (TAU / corners)
    const a1 = (e + 1) * (TAU / corners)
    for (let k = 0; k < per; k++) {
      const t = k / per
      p.push(cos(a0) + (cos(a1) - cos(a0)) * t, sin(a0) + (sin(a1) - sin(a0)) * t)
    }
  }
  return p
}

/**
 * A Z — the ICE primitive. A five-point star is miserable to draw with a
 * mouse (you must cross your own line four times without losing the rhythm),
 * so ICE is the letter Z: across, back down the diagonal, across again.
 * Two hard corners, one stroke, no crossings.
 */
const zed = (dir) => {
  const V = [
    [-1, -0.8],
    [1, -0.8],
    [-1, 0.8],
    [1, 0.8],
  ]
  if (dir < 0) V.reverse()
  const p = []
  for (let e = 0; e < 3; e++) {
    const [x0, y0] = V[e]
    const [x1, y1] = V[e + 1]
    // resample() walks by arc length, so a flat count per edge is fine.
    for (let k = 0; k < 40; k++) {
      const t = k / 40
      p.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    }
  }
  p.push(V[3][0], V[3][1])
  return p
}

/** A horizontal wavy line — the WIND primitive. */
const wave = (humps, dir) => {
  const p = []
  for (let i = 0; i <= 120; i++) {
    const t = i / 120
    const x = dir > 0 ? t * 2 - 1 : 1 - t * 2
    p.push(x, sin(t * PI * humps) * 0.55)
  }
  return p
}

const TPL = []
const addTpl = (rune, pts) => TPL.push([rune, vectorise(resample(pts))])

/**
 * Add a CLOSED shape as `k` templates evenly spaced around its outline.
 *
 * A closed shape started at a different place is a cyclic shift of the point
 * sequence, which the matcher scores as a different gesture. Generating one
 * template per corner is not enough — players start mid-edge as often as on a
 * corner, and an uncovered start point is exactly when a rough triangle
 * matched a square template better than any triangle template. Shifting the
 * already-resampled ring is far cheaper than re-sampling the polygon k times.
 */
const addRing = (rune, pts) => {
  const b = resample(pts)
  for (let s = 0; s < N; s += 4) {
    const q = []
    for (let i = 0; i < N; i++) {
      const j = ((i + s) % N) * 2
      q.push(b[j], b[j + 1])
    }
    TPL.push([rune, vectorise(q)])
  }
}

/** Build every start point x direction so the stroke order never matters. */
/** Reversing the sample list covers the opposite drawing direction. */
const rev = (p) => {
  const q = []
  for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1])
  return q
}
const build = () => {
  const tri = poly(3)
  const quad = poly(4)
  for (let d = -1; d <= 1; d += 2) {
    addRing(FIRE, d > 0 ? tri : rev(tri))
    addRing(EARTH, d > 0 ? quad : rev(quad))
    addTpl(ICE, zed(d))
    for (const h of [2, 3, 4]) addTpl(WIND, wave(h, d))
  }
}
build()

/** Below this the shape is rejected and the player gets the "bad" nudge. */
const THRESH = 0.78

/**
 * Classify a raw stroke (flat [x,y,...] in stage coords).
 * Returns the rune id, or -1 if nothing matched well enough.
 */
export const recognise = (raw) => {
  if (raw.length < 12) return -1
  const p = raw.slice()
  if (pathLen(p) < 60) return -1 // a tap or a twitch, not a gesture
  const rs = resample(p)
  const v = vectorise(rs)
  const bs = [-1, -1, -1, -1] // best template score per rune
  for (const [rune, tv] of TPL) {
    const s = score(v, tv)
    if (s > bs[rune]) bs[rune] = s
  }
  const [ec, turn] = feat(rs)
  /*
   * Take the best-scoring rune that ALSO passes its structure test, instead of
   * testing only the single top template. Shape matching alone confuses a
   * rough triangle with a quad — they are both one closed loop, and which one
   * wins can come down to noise. Checking only the winner meant such a stroke
   * became EARTH (or was thrown away). Now the envelope acts as a tie-break,
   * so the stroke's own corner count decides, and a triangle that genuinely
   * turns three times lands as FIRE even when a square template scored higher.
   */
  let bestR = -1
  let bestS = THRESH
  for (let r = 0; r < 4; r++) {
    const e = ENV[r]
    if (bs[r] > bestS && ec >= e[0] && ec <= e[1] && turn >= e[2] && turn <= e[3]) {
      bestS = bs[r]
      bestR = r
    }
  }
  return bestR
}

/** Exposed for tuning/debug: the best score without the threshold. */
export const rawScore = (raw) => {
  if (raw.length < 12) return [-1, 0]
  const p = raw.slice()
  const v = vectorise(resample(p))
  let bestR = -1
  let bestS = -1
  for (const [rune, tv] of TPL) {
    const s = score(v, tv)
    if (s > bestS) {
      bestS = s
      bestR = rune
    }
  }
  return [bestR, bestS]
}

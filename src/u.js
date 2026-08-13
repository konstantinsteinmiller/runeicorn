/** Tiny shared helpers. Keep everything here one-liner sized. */

export const TAU = Math.PI * 2
export const rnd = Math.random
export const min = Math.min
export const max = Math.max
export const abs = Math.abs
export const sin = Math.sin
export const cos = Math.cos
export const atan2 = Math.atan2
export const hypot = Math.hypot
export const sqrt = Math.sqrt
export const PI = Math.PI

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const rand = (a, b) => a + rnd() * (b - a)
export const pick = (a) => a[(rnd() * a.length) | 0]
export const sign = (v) => (v < 0 ? -1 : 1)

/** Deterministic PRNG so a region always generates the same layout. */
export const seeded = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646

/** Angle difference wrapped to -PI..PI. */
export const angDiff = (a, b) => {
  let d = (b - a) % TAU
  if (d > PI) d -= TAU
  if (d < -PI) d += TAU
  return d
}

/** Distance from point p to segment ab, plus the projection factor 0..1. */
export const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = clamp(t, 0, 1)
  const qx = ax + dx * t
  const qy = ay + dy * t
  return [hypot(px - qx, py - qy), t, qx, qy]
}

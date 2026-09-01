/** Tiny shared helpers. Everything here stays one-liner sized. */

export const TAU = Math.PI * 2
export const PI = Math.PI
export const rnd = Math.random
export const min = Math.min
export const max = Math.max
export const abs = Math.abs
export const sin = Math.sin
export const cos = Math.cos
export const atan2 = Math.atan2
export const hypot = Math.hypot
export const sqrt = Math.sqrt
export const floor = Math.floor

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
/** Frame-rate independent approach. */
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt))
export const rand = (a, b) => a + rnd() * (b - a)
export const pick = (a) => a[(rnd() * a.length) | 0]
export const sign = (v) => (v < 0 ? -1 : 1)
/** Smoothstep 0..1. */
export const ease = (t) => t * t * (3 - 2 * t)

/** Deterministic PRNG, for anything that must rebuild identically. */
export const seeded = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646

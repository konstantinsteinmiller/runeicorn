/**
 * Rainbow Conveyor Trails — the player's only verb.
 *
 * A trail is a polyline of nodes the swarm treats as a conveyor. Trails may
 * only START on a rainbow hive or on an existing trail (GDD 2.2), their total
 * length is capped by Prismatic Capacity, and Void Wounds cut them into dead
 * segments that stop carrying units.
 */
import {
  S,
  ST_HIVE,
  WOUND_R,
  inWound,
  hint,
  rainbow,
} from './state.js'
import { hypot, sin, cos, min, max, abs, clamp, segDist, TAU } from './u.js'
import { burst } from './fx.js'
import { sfx } from './audio.js'

/** One literal, used from both rejection paths — a repeated string costs twice. */
const BLOCKED = 'A Void Wound blocks that path'
/** Reused so clearing the dash pattern never allocates. */
const NODASH = []
/** Distance between stored trail nodes, in px. */
const STEP = 15
/** How close to a hive / existing trail a new trail must start. */
const SNAP = 46

export const trailLen = (tr) => {
  let n = 0
  const p = tr.p
  for (let i = 2; i < p.length; i += 2) n += hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
  return n
}

export const totalLen = () => {
  let n = 0
  for (const tr of S.trails) n += trailLen(tr)
  return n
}

/**
 * Find a legal anchor for a new trail: a hive, or the nearest point on an
 * existing trail. Returns [x, y] or null.
 */
const anchor = (x, y) => {
  let best = null
  let bd = SNAP
  for (const c of S.castles) {
    if (c.st !== ST_HIVE) continue
    const d = hypot(c.x - x, c.y - y) - c.r
    if (d < bd) {
      bd = d
      best = [c.x, c.y]
    }
  }
  for (const tr of S.trails) {
    const p = tr.p
    for (let i = 2; i < p.length; i += 2) {
      const [d, , qx, qy] = segDist(x, y, p[i - 2], p[i - 1], p[i], p[i + 1])
      if (d < bd) {
        bd = d
        best = [qx, qy]
      }
    }
  }
  return best
}

export const startTrail = (x, y) => {
  if (inWound(x, y)) {
    hint(BLOCKED)
    return 0
  }
  if (S.capUsed >= S.cap) {
    hint('Capacity spent - convert a castle')
    return 0
  }
  const a = anchor(x, y)
  if (!a) {
    hint('Start trails at a hive or a trail')
    return 0
  }
  S.drawing = { p: [a[0], a[1], x, y], cut: [0, 0], use: 0, age: 0 }
  S.trails.push(S.drawing)
  sfx('draw')
  return 1
}

export const extendTrail = (x, y) => {
  const tr = S.drawing
  if (!tr) return
  const p = tr.p
  const n = p.length
  const d = hypot(x - p[n - 2], y - p[n - 1])
  if (d < STEP) return
  if (S.capUsed + d > S.cap) {
    hint('Capacity exhausted')
    endTrail()
    return
  }
  // Refuse to draw through a wound: the swarm could not follow it anyway.
  if (inWound(x, y)) {
    endTrail()
    hint(BLOCKED)
    return
  }
  p.push(x, y)
  tr.cut.push(0)
  S.capUsed += d
  if (p.length % 8 === 0) {
    burst(x, y, 2, { hue: (S.t * 0.4) % 1, spd: 30, life: 0.5, size: 2 })
    sfx('draw')
  }
}

export const endTrail = () => {
  const tr = S.drawing
  S.drawing = null
  if (!tr) return
  // Drop degenerate taps so a mis-click does not eat capacity.
  if (tr.p.length < 6) {
    const i = S.trails.indexOf(tr)
    if (i >= 0) S.trails.splice(i, 1)
    // Release any unit that already latched onto it, or it would follow a
    // conveyor that no longer exists.
    for (const u of S.units) if (u.tr === tr) u.tr = null
    S.capUsed = totalLen()
  }
}

/**
 * Recompute which trail nodes sit inside a Void Wound, and flag whether the
 * trail is intact end to end (`tr.ok`) — an unbroken conveyor is what earns
 * the hive its spawn bonus.
 */
export const updateCuts = () => {
  for (const tr of S.trails) {
    const p = tr.p
    let ok = 1
    for (let i = 0, j = 0; i < p.length; i += 2, j++) {
      const was = tr.cut[j]
      const now = inWound(p[i], p[i + 1]) ? 1 : 0
      tr.cut[j] = now
      if (now) ok = 0
      if (now && !was) burst(p[i], p[i + 1], 4, { mono: 1, spd: 40, life: 0.7, size: 2 })
    }
    tr.ok = ok
  }
}

/** A segment carries units only if both of its endpoints are healthy. */
export const segLive = (tr, j) => !tr.cut[j] && !tr.cut[j + 1]

/** Remove trails the player can no longer use, refunding capacity. */
export const pruneTrails = () => {
  S.capUsed = totalLen()
}

/**
 * Trails render in two passes: a wide, dim pass on the bloom layer and a
 * bright core pass on the main canvas.
 */
export const drawTrails = (g, glow) => {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const tr of S.trails) {
    const p = tr.p
    if (p.length < 4) continue
    // A conveyor RIBBON, not a line: it has to stay visible under the column
    // of unicorns running along it, which is the whole storyboard read.
    const w = 7 + min(26, tr.use * 0.09)
    const segs = p.length / 2 - 1

    // Stroke CONTIGUOUS RUNS, not individual segments. A 200-node trail was
    // 200 stroke() calls and 200 colour strings per pass; batching runs makes
    // it one or two, and the gradient reads smoother than per-segment steps.
    let i = 0
    while (i < segs) {
      const live = segLive(tr, i)
      let j = i
      while (j < segs && segLive(tr, j) === live) j++
      if (live || !glow) {
        g.beginPath()
        g.moveTo(p[i * 2], p[i * 2 + 1])
        for (let k = i + 1; k <= j; k++) g.lineTo(p[k * 2], p[k * 2 + 1])
        if (live) {
          const ax = p[i * 2]
          const ay = p[i * 2 + 1]
          const bx = p[j * 2]
          const by = p[j * 2 + 1]
          if (abs(bx - ax) + abs(by - ay) < 1) {
            g.strokeStyle = rainbow((i * 0.03 + S.t * 0.22) % 1, glow ? 48 : 62, glow ? 0.36 : 0.95)
          } else {
            const q = g.createLinearGradient(ax, ay, bx, by)
            for (let s = 0; s <= 4; s++) {
              q.addColorStop(
                s / 4,
                rainbow((i * 0.03 + s * 0.2 + S.t * 0.22) % 1, glow ? 48 : 62, glow ? 0.36 : 0.95),
              )
            }
            g.strokeStyle = q
          }
          g.lineWidth = glow ? w * 3.2 : w
        } else {
          // Dead run: torn, dashed graphite — reads as "cut" at a glance.
          g.setLineDash([5, 7])
          g.strokeStyle = 'rgba(44,38,54,.92)'
          g.lineWidth = w * 0.6
        }
        g.stroke()
        g.setLineDash(NODASH)
      }
      i = j
    }
    // Bright head cap so the newest stroke reads as "alive".
    if (!glow && tr === S.drawing) {
      const n = p.length
      g.fillStyle = rainbow((S.t * 0.5) % 1, 75, 0.9)
      g.beginPath()
      g.arc(p[n - 2], p[n - 1], w * 0.7, 0, TAU)
      g.fill()
    }
  }
}

/** Void Wounds: torn black holes in the world with crackling edges. */
export const drawWounds = (g, glow) => {
  for (const w of S.wounds) {
    const k = clamp(w.life / 0.6, 0, 1) * clamp((w.ml - w.life) / 0.25, 0, 1)
    if (glow) {
      g.strokeStyle = `rgba(90,40,140,${0.25 * k})`
      g.lineWidth = 10
      g.beginPath()
      g.arc(w.x, w.y, w.r * 0.9, 0, TAU)
      g.stroke()
      continue
    }
    g.fillStyle = `rgba(4,2,10,${0.86 * k})`
    g.beginPath()
    for (let a = 0; a < 17; a++) {
      const an = (a / 16) * TAU
      const rr = w.r * (0.74 + 0.26 * sin(an * 5 + w.x * 0.05 + ((S.t * 6) | 0) * 0.5))
      const px = w.x + cos(an) * rr
      const py = w.y + sin(an) * rr
      a ? g.lineTo(px, py) : g.moveTo(px, py)
    }
    g.fill()
    // Jagged lightning cracks (storyboard panel 6).
    g.strokeStyle = `rgba(150,90,220,${0.55 * k})`
    g.lineWidth = 1.6
    for (let c = 0; c < 4; c++) {
      const a0 = (c / 4) * TAU + w.x * 0.01
      g.beginPath()
      g.moveTo(w.x, w.y)
      for (let s = 1; s < 5; s++) {
        const rr = (w.r * s) / 4
        const jj = sin(c * 3.1 + s * 5.3 + ((S.t * 8) | 0) * 0.7) * 0.5
        g.lineTo(w.x + cos(a0 + jj) * rr, w.y + sin(a0 + jj) * rr)
      }
      g.stroke()
    }
  }
}

export { WOUND_R, max }

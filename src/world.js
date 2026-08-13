/**
 * WORLD — region generation + the grim sketch backdrop + the conquest map.
 *
 * Everything here is DETERMINISTIC: layouts and terrain come from `seeded()`
 * keyed off the region index, so a region always looks and plays the same and
 * no frame ever calls Math.random.
 *
 * Layout is authored in normalized 0..1 (`nx`,`ny`) only; `project()` in
 * state.js turns that into pixels on every resize.
 *
 * The terrain is a pencil sketch of the Grim Empire — graphite hills, hatched
 * troughs, distant spires. It is baked ONCE into an offscreen canvas and
 * blitted every frame; only the mist band is live.
 */
import {
  S,
  ST_GREY,
  ST_HIVE,
  CAP_BASE,
  HIVE_HP,
  SOLDIER_HP,
  MAGE_CAST,
  OVERLOAD_COST,
  project,
  rainbow,
} from './state.js'
import { seeded, sin, cos, TAU, min, max } from './u.js'

/* ========================= regions ========================= */

/** Hand-tuned regions; beyond this the curve scales procedurally forever. */
export const REGIONS = 8

const NAMES =
  'The Grey Marches|Ashfall Downs|Vale of Nails|Iron Cloister|Gallows Moor|Sunless Weald|Obsidian Reach|Last Grey Throne'.split(
    '|',
  )

export const regionName = (i) => NAMES[i] || 'Grey Eternity ' + (i - REGIONS + 1)

/** Push a castle in normalized space. Pixels are project()'s job, never ours. */
const castle = (R, nx, ny, r, st, main) =>
  S.castles.push({
    nx,
    ny,
    x: 0,
    y: 0,
    r,
    st,
    conv: 0,
    hp: HIVE_HP,
    spawn: 0,
    main,
    seed: R(), // 0..1 — render.js uses it as a hue offset, sprites.js as a shape seed
  })

/**
 * Build region `i` into `S`. One new idea per region:
 *   0: one castle, no enemies      — drag, watch the swarm flow and convert
 *   1: two castles, soldiers       — the swarm fights, kills pay glitter dust
 *   2: three castles, first mage   — trails get cut: reroute or Overload
 *   3: four castles, two mages     — capacity pressure, multi-front routing
 *   4+: more of everything, tougher soldiers, faster spawns
 */
export const makeRegion = (i) => {
  const R = seeded(i * 9781 + 20261)
  R()
  R()

  S.units.length =
    S.soldiers.length =
    S.mages.length =
    S.bolts.length =
    S.wounds.length =
    S.castles.length =
    S.trails.length =
      0

  const nC = min(8, i + 1) // grey castles (conversion targets)
  const nM = i < 2 ? 0 : min(4, ((i + 1) / 2) | 0) // Void Mages
  const cols = nC < 2 ? 1 : nC < 5 ? 2 : 3 // 3 columns max: portrait phones are narrow
  const rows = ((nC + cols - 1) / cols) | 0

  // The Main Hive: bottom centre, the only thing that starts neon.
  // ny 0.88, not 0.92: at 0.92 the hive's lower edge reaches the Overload
  // button, so tapping your own hive to start a trail fires Overload instead.
  castle(R, 0.5 + (R() - 0.5) * 0.22, 0.88, 26, ST_HIVE, 1)
  S.hive = S.castles[0]

  // Grey castles on a staggered, jittered grid: irregular but never stacked,
  // always on the land (ny stays below the horizon) and never near the hive.
  for (let k = 0; k < nC; k++) {
    const c = k % cols
    const r = (k / cols) | 0
    // bounded by construction: nx in .11..0.87, ny in .25..0.67
    castle(
      R,
      0.14 + ((c + 0.5 + (r & 1 ? 0.4 : 0)) / cols) * 0.72 + (R() - 0.5) * 0.05,
      0.17 + ((r + 0.5) / rows) * 0.55 + (R() - 0.5) * 0.04,
      16 + R() * 6,
      ST_GREY,
      0,
    )
  }

  // Mages sit in the lane between the castles and the hive, where trail
  // mid-points live — alternating left/right so they never squat on the hive.
  for (let k = 0; k < nM; k++)
    S.mages.push({
      nx: 0.5 + (k % 2 ? 1 : -1) * (0.2 + (k >> 1) * 0.16 + R() * 0.06),
      ny: 0.72 + R() * 0.07,
      x: 0,
      y: 0,
      // Long opening fuse on purpose: the player must get to feel the swarm
      // snowball BEFORE the counter to it shows up, or the mechanic reads as
      // punishment instead of a puzzle.
      cast: MAGE_CAST * (1.7 + k * 0.55 + R() * 0.5),
      ph: R() * TAU,
      hp: SOLDIER_HP * 1.6,
    })

  S.cap = CAP_BASE
  S.capUsed = 0
  S.dust = i > 1 ? OVERLOAD_COST : 0 // enough to teach Overload the first time a trail is cut
  S.region = i
  S.kills = S.overload = S.shake = S.flash = S.hitStop = S.over = S.down = 0
  S.drawing = null
  S.hint = ''
  S.hintT = 0
  // Soldier cadence, hp and speed are sim.js's business — it scales them off
  // S.region, which we just set, so the escalation curve continues forever.
  project()
}

/* ========================= terrain ========================= */

let cv // offscreen bake of the static sketch
let kw = -1
let kh = -1
let kr = -1
let hz = 0 // horizon y, needed by the live mist

/** Add `a,color` stop pairs to a gradient and return it. */
const stops = (o, ...s) => {
  for (let k = 0; k < s.length; k += 2) o.addColorStop(s[k], s[k + 1])
  return o
}

/** Bake the whole grim panorama once. Called only on resize / region change. */
const bake = () => {
  const w = S.w
  const h = S.h
  const d = S.dpr || 1
  const R = seeded(S.region * 3571 + 77711)
  cv = cv || document.createElement('canvas')
  cv.width = w * d
  cv.height = h * d
  const x = cv.getContext('2d')
  x.scale(d, d)
  hz = h * 0.22 // horizon sits high: the land is where the game is played

  // Heavy graphite sky.
  x.fillStyle = stops(x.createLinearGradient(0, 0, 0, h), 0, '#06060a', 0.22, '#1e2029', 1, '#0d0e12')
  x.fillRect(0, 0, w, h)

  // A wan, sunless disc smothered in cloud.
  const sx = w * 0.72
  const sy = hz * 0.46
  x.fillStyle = stops(
    x.createRadialGradient(sx, sy, 0, sx, sy, h * 0.34),
    0,
    '#cacfd826',
    1,
    '#cacfd800',
  )
  x.fillRect(0, 0, w, hz + 40)

  // Sketched cloud mass: long, near-horizontal pencil strokes.
  x.lineWidth = 1
  x.strokeStyle = '#8188981f'
  x.beginPath()
  for (let k = 0; k < 30; k++) {
    const cx0 = R() * w
    const cy = R() * hz * 0.92
    x.moveTo(cx0, cy)
    x.lineTo(cx0 + 50 + R() * 240, cy + (R() - 0.5) * 9)
  }
  x.stroke()

  // Horizon haze.
  x.fillStyle = stops(
    x.createLinearGradient(0, hz - 34, 0, hz + 14),
    0,
    '#959eb100',
    0.76,
    '#959eb133',
    1,
    '#959eb100',
  )
  x.fillRect(0, hz - 34, w, 48)

  // Distant empire: castle and spire silhouettes on the skyline.
  x.fillStyle = '#0e0f14'
  for (let k = 0, n = 5 + min(6, S.region); k < n; k++) {
    const bx = R() * w
    const bw = 5 + R() * 13
    const bh = 15 + R() * 46
    x.fillRect(bx, hz - bh, bw, bh)
    x.beginPath()
    x.moveTo(bx - 3, hz - bh)
    x.lineTo(bx + bw / 2, hz - bh - 8 - R() * 15)
    x.lineTo(bx + bw + 3, hz - bh)
    x.fill()
    if (R() > 0.45) x.fillRect(bx + bw + 2, hz - bh * 0.55, bw * 0.6, bh * 0.55)
  }

  // Rolling hills: 5 ridges, far ones hazy-light, near ones heavy-dark.
  for (let j = 0; j < 5; j++) {
    const f = (j + 1) / 5
    const base = hz + (h - hz) * (f * f * 0.82 + 0.07)
    const amp = 7 + f * 44
    const p1 = R() * TAU
    const p2 = R() * TAU
    const fr = ((1.4 + R() * 2) * TAU) / w
    const v = 27 - j * 4 // lightness %: far ridges hazy, near ridges heavy
    const yA = (q) => base + sin(q * fr + p1) * amp + sin(q * fr * 2.7 + p2) * amp * 0.34

    // The silhouette, drawn with a wobbling hand.
    x.beginPath()
    x.moveTo(-2, h + 2)
    for (let q = -2; q <= w + 8; q += 9) x.lineTo(q, yA(q) + (R() - 0.5) * 2.6)
    x.lineTo(w + 8, h + 2)
    x.closePath()
    x.fillStyle = `hsl(228,9%,${v}%)`
    x.fill()
    x.strokeStyle = `hsla(228,13%,${v + 30}%,.62)`
    x.lineWidth = 1.5 - j * 0.15
    x.stroke() // the closing edges fall off-screen, so this only inks the ridge

    // A second, offset pass — the double-stroke of a pencil going back over.
    x.lineWidth = 0.7
    x.beginPath()
    for (let q = -2; q <= w + 8; q += 9) {
      const yy = yA(q) + (R() - 0.5) * 3 + 1.6
      q < 0 ? x.moveTo(q, yy) : x.lineTo(q, yy)
    }
    x.stroke()

    // Cross-hatch shading in the troughs; the deepest get a second direction.
    x.lineWidth = 0.6
    x.strokeStyle = `hsla(228,11%,${v + 21}%,.5)`
    x.beginPath()
    for (let q = 0; q < w; q += 7) {
      const yy = yA(q)
      const dp = (yy - base) / amp
      if (dp < 0.1) continue
      const l = 6 + dp * 22
      x.moveTo(q, yy + 2)
      x.lineTo(q - l * 0.7, yy + 2 + l)
      if (dp > 0.55) {
        x.moveTo(q, yy + 4)
        x.lineTo(q + l * 0.6, yy + 4 + l * 0.8)
      }
    }
    x.stroke()
  }

  // Paper grain.
  x.fillStyle = '#ffffff16'
  for (let k = 0; k < 500; k++) x.fillRect(R() * w, R() * h, 1, 1)

  // Vignette: the empire is a heavy place.
  x.fillStyle = stops(
    x.createRadialGradient(w / 2, h * 0.55, h * 0.25, w / 2, h * 0.55, h * 0.9),
    0,
    '#0000',
    1,
    '#0009',
  )
  x.fillRect(0, 0, w, h)
}

/** Full-screen sketch backdrop. Cached blit + a live drifting mist band. */
export const drawTerrain = (g, t) => {
  const w = S.w
  const h = S.h
  if (!w) return
  if (kw !== w || kh !== h || kr !== S.region) {
    kw = w
    kh = h
    kr = S.region
    bake()
  }
  // Slightly oversized: render.js draws the world under a screen-shake
  // translate and never clears, so the backdrop must cover the shaken edges.
  const m = 30 * S.sc
  g.drawImage(cv, -m, -m, w + m * 2, h + m * 2)

  g.globalAlpha = 0.05
  g.fillStyle = '#aeb6c6'
  for (let k = 0; k < 3; k++) {
    g.beginPath()
    g.ellipse(
      ((t * (7 + k * 5) + k * 430) % (w + 700)) - 350,
      hz + 10 + k * 26 + sin(t * 0.2 + k) * 4,
      190 + k * 70,
      11 + k * 5,
      0,
      0,
      TAU,
    )
    g.fill()
  }
  g.globalAlpha = 1
}

/* ======================== world map ======================== */

/** Node `i` of `n` on the campaign trail — a meander across the continent. */
const node = (i, n) => {
  const a = n > 1 ? i / (n - 1) : 0.5
  return [S.w * (0.2 + a * 0.6 + sin(i * 2.3) * 0.03), S.h * (0.7 - a * 0.42 + sin(i * 1.7 + 1) * 0.055)]
}

/** Storyboard panel 8: the conquest map. */
export const drawWorldMap = (g, t) => {
  const w = S.w
  const h = S.h
  const n = max(REGIONS, S.region + 1, S.conquered + 1)
  const dn = max(S.conquered, S.region) // regions with index < dn are conquered

  g.fillStyle = '#07080ced'
  g.fillRect(0, 0, w, h)

  // Sketched continent, stroked twice with different wobble.
  g.fillStyle = '#1a1c24d9'
  g.strokeStyle = '#969eb280'
  g.lineWidth = 1.2
  for (let s = 0; s < 2; s++) {
    g.beginPath()
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * TAU
      const r = 1 + 0.14 * sin(a * 3 + 1) + 0.09 * sin(a * 5 + 2.4) + 0.05 * sin(a * 8) + sin(k * 12.9 + s) * 0.014
      const px = w / 2 + cos(a) * r * w * 0.46
      const py = h / 2 + sin(a) * r * h * 0.42
      k ? g.lineTo(px, py) : g.moveTo(px, py)
    }
    g.closePath()
    s || g.fill()
    g.stroke()
  }

  // Links: rainbow where the infection has already flowed, chalk where not.
  g.lineCap = 'round'
  g.setLineDash([9, 7])
  g.lineDashOffset = -t * 26
  for (let k = 0; k + 1 < n; k++) {
    const [ax, ay] = node(k, n)
    const [bx, by] = node(k + 1, n)
    const on = k + 1 < dn
    const v = k * 0.13 + t * 0.06
    g.strokeStyle = on
      ? stops(g.createLinearGradient(ax, ay, bx, by), 0, rainbow(v), 0.5, rainbow(v + 0.33), 1, rainbow(v + 0.66))
      : '#767e924d'
    g.lineWidth = on ? 3.5 : 1.4
    g.beginPath()
    g.moveTo(ax, ay)
    g.quadraticCurveTo((ax + bx) / 2 + (by - ay) * 0.18, (ay + by) / 2 - (bx - ax) * 0.18, bx, by)
    g.stroke()
  }
  g.setLineDash([])

  // Nodes: conquered hives glow, the target pulses white, the rest are graphite.
  for (let k = 0; k < n; k++) {
    const [px, py] = node(k, n)
    const cq = k < dn
    const cur = k === S.region
    const b = 0.5 + 0.5 * sin(t * 3 + k)
    const col = cq ? rainbow(k * 0.13 + t * 0.1) : cur ? '#fff' : '#7a809099'
    g.strokeStyle = g.fillStyle = col
    if (cq || cur) {
      g.shadowColor = col
      g.shadowBlur = 12 + b * 14
    }
    g.lineWidth = cur ? 2 + b * 2 : 1.6
    g.beginPath()
    g.arc(px, py, 12 + (cur ? b * 5 : 0), 0, TAU)
    g.stroke()
    if (cq) {
      // pulsing hive glyph
      const s = 1 + b * 0.12
      g.beginPath()
      g.moveTo(px, py - 11 * s)
      g.lineTo(px + 7 * s, py + 6 * s)
      g.lineTo(px - 7 * s, py + 6 * s)
      g.closePath()
      g.fill()
      g.beginPath()
      g.moveTo(px - 9 * s, py + 6 * s)
      g.lineTo(px + 9 * s, py + 6 * s)
      g.stroke()
    } else {
      // sketch hatch: a region still waiting for the light
      g.lineWidth = 0.8
      g.beginPath()
      for (let q = -7; q < 8; q += 5) {
        g.moveTo(px + q, py - 8)
        g.lineTo(px + q + 7, py + 8)
      }
      g.stroke()
    }
    g.shadowBlur = 0
  }
}

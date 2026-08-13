/**
 * Render orchestration.
 *
 * Two canvases: the main one, and a quarter-resolution "glow" buffer that
 * every bright thing is also drawn into. Scaling that buffer back up with
 * smoothing gives real bloom for a handful of bytes and almost no GPU cost —
 * this is what makes the neon read as *light* instead of coloured lines.
 */
import { S, TILE, SS, UNI_ROT, UNI_FRAMES, SOL_ROT, SOL_FRAMES, ST_HIVE, SC_MAP, rainbow } from './state.js'
import { atan2, TAU, min, cos, sin, clamp } from './u.js'
import { drawTerrain, drawWorldMap } from './world.js'
import { drawTrails, drawWounds } from './trail.js'
import { UNI, SOL, drawCastle, drawMage } from './sprites.js'
import { drawFxUnder, drawFxOver, drawPost, shakeOffset } from './fx.js'
import { TELEGRAPH } from './sim.js'
import { drawHud, drawOverlays } from './ui.js'

/** Reused dash patterns — setLineDash allocates if given a fresh array. */
const DASH = [7, 7]
const NODASH = []

/* Dev-only per-stage profiler. DEBUG is a compile-time false in release, so
   every call below is dead code the bundler removes. */
export const PROF = {}
/** Dev-only A/B switches so a stage's real cost can be isolated. */
export const Q = { bloom: 1, units: 1, fx: 1, glow: 1 }
const t0 = () => (DEBUG ? performance.now() : 0)
const mark = (k, t) => {
  if (DEBUG) PROF[k] = (PROF[k] || 0) * 0.88 + (performance.now() - t) * 0.12
}

/** Bloom buffer downscale. 4 = cheap and soft. */
const BS = 4
let bc = null
let bg = null

/** Rainbow palette for the batched unit bloom pass. */
const PAL = []
for (let i = 0; i < 6; i++) PAL.push(`hsla(${i * 60},100%,62%,.26)`)

export const initRender = () => {
  bc = document.createElement('canvas')
  bg = bc.getContext('2d')
}

export const resizeRender = () => {
  bc.width = Math.ceil(S.w / BS)
  bc.height = Math.ceil(S.h / BS)
}

const drawUnits = (g) => {
  const c = UNI.c
  const P = UNI.px // source tile, atlas pixels
  const D = UNI.tile // destination tile, CSS px
  const H = D / 2
  for (const u of S.units) {
    let r = Math.round((atan2(u.vy, u.vx) / TAU) * UNI_ROT) % UNI_ROT
    if (r < 0) r += UNI_ROT
    const f = (u.ph * 1.7) % UNI_FRAMES | 0
    g.drawImage(c, r * P, f * P, P, P, u.x - H, u.y - H, D, D)
  }
}

const drawSoldiers = (g) => {
  const c = SOL.c
  const P = SOL.px
  const D = SOL.tile
  const H = D / 2
  for (const s of S.soldiers) {
    let r = Math.round((s.ang / TAU) * SOL_ROT) % SOL_ROT
    if (r < 0) r += SOL_ROT
    const f = (s.ph * 0.9) % SOL_FRAMES | 0
    g.drawImage(c, r * P, f * P, P, P, s.x - H, s.y - H, D, D)
  }
}

/**
 * Void Wound telegraph: while a mage is winding up, show exactly where the cut
 * will land and how long you have. Without this the casts read as random.
 */
const drawAim = (g) => {
  for (const m of S.mages) {
    const a = m.aim
    if (!a) continue
    const k = 1 - clamp(m.cast / TELEGRAPH, 0, 1) // 0 -> 1 as it closes
    const r = 26 + (1 - k) * 34
    g.strokeStyle = `rgba(190,110,255,${0.35 + k * 0.5})`
    g.lineWidth = 2
    g.setLineDash(DASH)
    g.beginPath()
    g.arc(a[0], a[1], r, 0, TAU)
    g.stroke()
    g.setLineDash(NODASH)
    // Thin line back to the caster, so you can see WHICH mage is aiming.
    g.beginPath()
    g.moveTo(m.x, m.y - 18)
    g.lineTo(a[0], a[1])
    g.strokeStyle = `rgba(170,90,240,${0.16 + k * 0.34})`
    g.lineWidth = 1.4
    g.stroke()
  }
}

const drawBolts = (g) => {
  for (const b of S.bolts) {
    g.fillStyle = '#0a0512'
    g.beginPath()
    g.arc(b.x, b.y, 7, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(160,90,230,.9)'
    g.lineWidth = 2
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = (i / 4) * TAU + S.t * 6
      g.lineTo(b.x + cos(a) * 11, b.y + sin(a) * 11)
    }
    g.stroke()
  }
}

/** Everything that emits light, drawn into the low-res bloom buffer. */
const drawGlow = (g) => {
  g.save()
  g.setTransform(1 / BS, 0, 0, 1 / BS, 0, 0)
  g.clearRect(0, 0, S.w, S.h)
  g.globalCompositeOperation = 'lighter'

  drawTrails(g, 1)
  drawWounds(g, 1)

  // Units, batched into six hue passes so fillStyle changes six times, not 900.
  for (let b = 0; b < 6; b++) {
    g.fillStyle = PAL[b]
    for (const u of S.units) {
      if (u.hb === b) g.fillRect(u.x - 5, u.y - 5, 10, 10)
    }
  }

  // Hives are the brightest thing on the field.
  for (const c of S.castles) {
    if (c.st !== ST_HIVE && !c.conv) continue
    const k = c.st === ST_HIVE ? 1 : c.conv
    g.fillStyle = rainbow((S.t * 0.15 + c.seed) % 1, 60, 0.3 * k)
    g.beginPath()
    g.arc(c.x, c.y, c.r * (2.2 + 0.25 * sin(S.t * 3)), 0, TAU)
    g.fill()
  }

  drawFxOver(g)
  g.restore()
}

export const frame = (g) => {
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0)

  if (S.scene === SC_MAP) {
    drawWorldMap(g, S.t)
    drawOverlays(g)
    return
  }

  const [sx, sy] = shakeOffset()

  // Bloom is the first thing sacrificed when the frame budget is blown: it is
  // pure polish, and the trails/units still read without it.
  const bloom = S.q && (!DEBUG || Q.glow)

  let t = t0()
  if (bloom) drawGlow(bg)
  mark('glow', t)

  g.save()
  g.translate(sx, sy)

  t = t0()
  drawTerrain(g, S.t)
  mark('terrain', t)

  drawFxUnder(g)
  drawWounds(g, 0)

  t = t0()
  drawTrails(g, 0)
  mark('trails', t)

  t = t0()
  for (const c of S.castles) drawCastle(g, c, S.t)
  for (const m of S.mages) drawMage(g, m, S.t)
  drawAim(g)
  drawSoldiers(g)
  drawBolts(g)
  mark('struct', t)

  t = t0()
  if (!DEBUG || Q.units) drawUnits(g)
  mark('units', t)

  t = t0()
  if (!DEBUG || Q.fx) drawFxOver(g)
  mark('fx', t)

  // Bloom composite.
  t = t0()
  if (bloom) {
  g.globalCompositeOperation = 'lighter'
  g.imageSmoothingEnabled = true
  // ONE full-screen additive pass, not two. Each pass blends every pixel on
  // screen, and profiling put the old second (halo) pass at ~5.5 ms of an
  // 18 ms frame at 900 units — by far the most expensive thing in the game.
  // The halo is recovered for free by blurring the source instead: the buffer
  // is drawn slightly oversized so its own bilinear upscale spreads the light.
  g.globalAlpha = 0.78
  if (!DEBUG || Q.bloom) g.drawImage(bc, -S.w * 0.008, -S.h * 0.008, S.w * 1.016, S.h * 1.016)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  }
  mark('bloom', t)

  g.restore()

  t = t0()
  drawPost(g)
  mark('post', t)

  t = t0()
  drawHud(g)
  drawOverlays(g)
  mark('ui', t)
}

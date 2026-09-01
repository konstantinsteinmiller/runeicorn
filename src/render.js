/**
 * render.js — one frame, in order. Owns the letterbox transform and nothing
 * else; every module below draws in the 1280x720 stage space.
 *
 * Order: sky -> island -> fx under -> shots -> duelists -> fx over -> the
 * live stroke -> weather -> post -> HUD -> overlays.
 */
import { S, SW, SH, BOX, AX, UX, GY, RUNES, PH_WIN, PH_LOSE, clamp } from './state.js'
import { drawSky, drawIsland, drawWeather } from './arena.js'
import { drawUnicorn } from './chars.js'
import { drawFxUnder, drawFxOver, drawPost, shakeOffset } from './fx.js'
import { drawHud, drawOverlays, drawGlyph } from './ui.js'
import { ease, min, TAU } from './u.js'

/** Reused so a frame allocates nothing. */
const AST = { cast: 0, hurt: 0, hp: 1, win: 0, lose: 0, form: 0 }
const UST = { cast: 0, hurt: 0, hp: 1, win: 0, lose: 0, form: 0 }

/** Letterbox: fit 1280x720 inside the viewport, centred. */
export const layout = (w, h, dpr) => {
  S.w = w
  S.h = h
  S.dpr = dpr
  S.vs = min(w / SW, h / SH)
  S.vx = (w - SW * S.vs) / 2
  S.vy = (h - SH * S.vs) / 2
}

/** Screen -> stage. Everything upstream of this works in stage units. */
export const toStage = (x, y) => [(x - S.vx) / S.vs, (y - S.vy) / S.vs]

/** The stroke the player is drawing right now. */
const drawStroke = (g) => {
  const p = S.pts
  if (p.length < 4) return
  g.save()
  g.lineCap = g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(p[0], p[1])
  if (p.length < 8) {
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
  } else {
    // Quadratics through segment midpoints: each sample becomes a control
    // point, so the curve passes smoothly along the pointer path instead of
    // showing a corner at every sample. Cheap and allocation-free.
    for (let i = 2; i < p.length - 2; i += 2)
      g.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2)
    g.lineTo(p[p.length - 2], p[p.length - 1])
  }
  g.lineWidth = 17
  g.strokeStyle = '#1a1030'
  g.stroke()
  g.lineWidth = 9
  g.strokeStyle = '#fff'
  g.stroke()
  g.restore()
}

/** Spells in flight: a cel-shaded blob with a hard outline. */
const drawShots = (g) => {
  for (const s of S.shots) {
    const [col, lit] = RUNES[s.r]
    const r = (s.k === 3 ? 30 : s.k === 1 ? 24 : 17) * (1 + 0.12 * Math.sin(S.t * 22))
    g.save()
    g.translate(s.x, s.y)
    // Delayed spells hang overhead and pulse a warning before they fall.
    if (s.delay > 0) g.globalAlpha = 0.55 + 0.45 * Math.sin(S.t * 14)
    g.beginPath()
    g.arc(0, 0, r, 0, TAU)
    g.fillStyle = col
    g.fill()
    g.lineWidth = 5
    g.strokeStyle = '#1a1030'
    g.stroke()
    g.beginPath()
    g.arc(-r * 0.3, -r * 0.3, r * 0.34, 0, TAU)
    g.fillStyle = lit
    g.fill()
    g.restore()
  }
}

/** The clean rune flashing before it is stored (GDD 2.2). */
const drawSnap = (g) => {
  if (!S.snap) return
  const k = clamp(S.snap.t / 0.45, 0, 1)
  drawGlyph(g, S.snap.r, BOX.x + BOX.w / 2, BOX.y + BOX.h / 2, 96 * (1 + ease(k) * 0.5), 1 - k)
}

export const render = (g) => {
  const t = S.t
  // The canvas backing store is CSS size x dpr, so EVERY transform here must
  // carry dpr. Omitting it drew the stage into the top-left 1/dpr of the
  // canvas while input still mapped clicks in CSS pixels — the ink landed
  // away from the cursor and no button was ever hittable.
  const d = S.dpr
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, S.w * d, S.h * d)

  // Letterbox bars stay black; the stage is centred inside them.
  g.fillStyle = '#07060f'
  g.fillRect(0, 0, S.w * d, S.h * d)

  const so = shakeOffset()
  const k = S.vs * d
  g.setTransform(k, 0, 0, k, (S.vx + so[0] * S.vs) * d, (S.vy + so[1] * S.vs) * d)
  g.save()
  g.beginPath()
  g.rect(0, 0, SW, SH)
  g.clip()

  drawSky(g, t)
  drawIsland(g)
  drawFxUnder(g)

  AST.cast = clamp(S.castAnim / 0.55, 0, 1)
  AST.hurt = S.hurt
  AST.hp = S.hp / 100
  AST.win = S.phase === PH_WIN ? clamp(S.over, 0, 1) : 0
  AST.lose = S.phase === PH_LOSE ? clamp(S.over, 0, 1) : 0
  AST.form = S.queue.length / 3
  UST.cast = clamp(S.eCastAnim / 0.55, 0, 1)
  UST.hurt = S.eHurt
  UST.hp = S.ehp / 100
  UST.win = S.phase === PH_LOSE ? clamp(S.over, 0, 1) : 0
  UST.lose = S.phase === PH_WIN ? clamp(S.over, 0, 1) : 0
  UST.form = S.eForm

  drawUnicorn(g, AX, GY, -1, AST, t)
  drawUnicorn(g, UX, GY, 1, UST, t)

  drawShots(g)
  drawFxOver(g)
  drawSnap(g)
  if (S.draw) drawStroke(g)
  drawWeather(g, t)
  drawPost(g)
  g.restore()

  drawHud(g, t)
  drawOverlays(g, t) // reads S.dt itself for popup ageing
}

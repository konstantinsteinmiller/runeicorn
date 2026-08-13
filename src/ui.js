/**
 * HUD + overlays. Drawn last, on an untransformed context, after world and FX.
 *
 * Every size flows from `S.sc`, recomputed in `layoutUI()` from the viewport, so
 * the same code reads on a 360px phone and on a 4K monitor. All text goes through
 * `text()`, which puts a dark outline (and optionally a dark plate) under a light
 * fill, because the scene underneath is a bright, saturated rainbow mess.
 *
 * Rects are plain arrays [x,y,w,h] — immune to property mangling, cheap to test.
 * They are rebuilt only on resize; `uiHit`/`isUI` are pure lookups.
 */
import { S, SC_PLAY, SC_DEAD, ST_HIVE, OVERLOAD_COST, OVERLOAD_TIME, rainbow, pulse } from './state.js'
import { clamp, min, max } from './u.js'

const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window
const TAP = TOUCH ? 'Tap' : 'Click'
const DRAG = (TOUCH ? 'Drag' : 'Click and drag') + ' to draw a Rainbow Trail'
const F = 'px system-ui,sans-serif'
const MF = 'px ui-monospace,monospace'
const AL = ['left', 'center', 'right']
const W = '#fff' // light fill
const LIL = '#efe9ff' // light lilac
const DIM = '#b9b5cb' // secondary
const OFF = '#8f8ca0' // disabled
const INK = '#06040ed9' // outline / plate ink
const TITLE = 'PLAGUE OF LIGHT'
/** Tutorial rows: [label, explanation]. Kept to six — anything longer is read
 *  by nobody, and every line costs bytes we do not have. */
const HELP = [
  ['DRAW', 'Drag from a glowing hive to lay a trail.'],
  ['GROW', 'On a trail they clone, run faster and hit harder.'],
  ['TAKE', 'Steer them into a grey castle to convert it.'],
  ['GUARD', 'Soldiers march on your hive. Lose it, lose the region.'],
  ['CUTS', 'Mages mark a spot, then sever the trail. Reroute!'],
  ['BURST', (TOUCH ? 'Tap OVERLOAD' : 'Press SPACE') + ' to purge cuts and go invincible.'],
]
import { regionName } from './world.js'

/* cached geometry: overload btn, mute btn, capacity bar, HUD clusters, margin */
let ob = [0, 0, 0, 0]
let mb = ob
let hb = ob
let bar = ob
let tl = ob
let tr = ob
let m = 8

let g // active context
let introA = 1 // title-card fade
let ovT = 0 // seconds the end panel has been up
let hs = '' // latched S.hint + its own fade timer
let ht = 0
let rgn = -1 // region whose clock is running
let rt0 = 0

/* ----------------------------- helpers ---------------------------- */

const inR = (r, x, y) => x >= r[0] && y >= r[1] && x <= r[0] + r[2] && y <= r[1] + r[3]

const rr = (x, y, w, h, r) => {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
}

/** Dark backdrop plate. */
const panel = (x, y, w, h, a, r) => {
  rr(x, y, w, h, r)
  g.fillStyle = 'rgba(8,6,18,' + a + ')'
  g.fill()
}

/** Rainbow gradient across [x, x+w]. */
const rbg = (x, w, off, l) => {
  const q = g.createLinearGradient(x, 0, x + w, 0)
  for (let i = 0; i < 4; i++) q.addColorStop(i / 3, rainbow(i / 3 + off, l))
  return q
}

/** Shrink a size so `s` fits inside `mw` px. */
const fit = (s, px, mw) => min(px, mw / (s.length * 0.62))

/**
 * The one text routine: font, align (0 left / 1 centre / 2 right), optional dark
 * plate, dark outline, light fill. Returns the measured width.
 */
const text = (s, x, y, px, al, fill, mono, pl) => {
  g.font = 'bold ' + px + (mono ? MF : F)
  g.textAlign = AL[al]
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const d = g.measureText(s).width
  if (pl) panel(x - (al === 1 ? d / 2 : 0) - px * 0.6, y - px * 0.85, d + px * 1.2, px * 1.7, pl, px)
  g.lineWidth = max(2, px * 0.18)
  g.strokeStyle = INK
  g.strokeText(s, x, y)
  g.fillStyle = fill
  g.fillText(s, x, y)
  return d
}

/** Pill button: plate, progress fill, live rim, label + sub-label. */
const btn = (r, on, prog, lab, sub) => {
  const [x, y, w, h] = r
  const t = S.t
  const p = pulse(t, 1.3)
  const c = on ? rainbow(t * 0.35, 62 + 24 * p) : OFF
  rr(x, y, w, h, h / 2)
  g.fillStyle = on ? '#16082ae0' : INK
  g.fill()
  if (prog) {
    g.save()
    g.clip()
    g.fillStyle = on ? rbg(x, w, t * 0.25, 52) : '#8282964d'
    g.fillRect(x, y, w * prog, h)
    g.restore()
  }
  // A soft double stroke instead of shadowBlur: `shadowBlur` re-rasterises the
  // whole path through a blur kernel every frame, for every button.
  if (on) {
    g.globalAlpha = 0.3
    g.lineWidth = max(3, h * (0.13 + 0.16 * p))
    g.strokeStyle = c
    rr(x, y, w, h, h / 2)
    g.stroke()
    g.globalAlpha = 1
  }
  g.lineWidth = max(2, h * 0.055)
  g.strokeStyle = c
  rr(x, y, w, h, h / 2)
  g.stroke()
  if (lab) {
    text(lab, x + w / 2, y + h * 0.37, h * 0.32, 1, on ? W : OFF)
    text(sub, x + w / 2, y + h * 0.72, h * 0.23, 1, on ? DIM : OFF)
  }
}

/* ------------------------------ layout ---------------------------- */

export function layoutUI() {
  const w = S.w
  const h = S.h
  /* ~1 at 900x600; 0.8 floor on a small phone, 2.1 ceiling on 4K */
  const sc = (S.sc = clamp((min(w, h) + max(w, h) * 0.55) / 1100, 0.8, 2.1))
  /* deeper inset in landscape so a notch / rounded corner never eats chrome */
  m = (w > h ? 26 : 14) * sc

  const bw = min(w - m * 2, 320 * sc)
  const bh = max(46, 54 * sc) // >= 46px: finger sized
  ob = [(w - bw) / 2, h - m - bh, bw, bh]

  const ms = max(46, 46 * sc)
  mb = [w - m - ms, m, ms, ms]
  // "?" stacks UNDER the mute button: the top-right row is already the
  // castles/dust readout, and a third element there collides with it.
  hb = [w - m - ms, m + ms + 8 * sc, ms, ms]

  const lw = min(w * 0.42, 250 * sc)
  const cb = max(18, 18 * sc)
  bar = [m + 10 * sc, m + 40 * sc, lw - 20 * sc, cb]
  tl = [m, m, lw, 46 * sc + cb]

  const rw = min(w * 0.3, 200 * sc) + ms + 8 * sc
  tr = [w - m - rw, m, rw, ms]
}

/* -------------------------------- HUD ----------------------------- */

export function drawHud(ctx) {
  g = ctx
  const sc = S.sc
  const t = S.t
  const [bx, by, bw, cb] = bar
  const [mx, my, ms] = mb
  if (S.scene === SC_PLAY && S.region !== rgn) {
    rgn = S.region
    rt0 = t
  }
  g.save()

  /* the hero stat */
  panel(...tl, 0.42, 14 * sc)
  const d = text(S.units.length, bx, tl[1] + 20 * sc, 34 * sc, 0, rainbow(t * 0.2, 78), 1)
  text('UNICORNS', bx + d + 8 * sc, tl[1] + 24 * sc, max(12, 12 * sc), 0, LIL)

  /* prismatic capacity: rainbow while healthy, red-hot when nearly spent */
  const f = clamp(S.capUsed / (S.cap || 1), 0, 1)
  panel(bx, by, bw, cb, 0.55, cb / 2)
  if (f) {
    g.save()
    rr(bx, by, bw, cb, cb / 2)
    g.clip()
    g.fillStyle = f > 0.86 ? rainbow(0.03 * pulse(t, 4), 46 + 16 * pulse(t, 4)) : rbg(bx, bw, t * 0.1, 58)
    g.fillRect(bx, by, bw * f, cb)
    g.restore()
  }
  const cs = 'PRISMATIC ' + (S.capUsed | 0) + '/' + (S.cap | 0)
  text(cs, bx + bw / 2, by + cb / 2, fit(cs, cb * 0.62, tl[2]), 1, W)

  /* castles converted + glitter dust */
  let tot = 0
  let con = 0
  for (const c of S.castles)
    if (!c.main) {
      tot++
      if (c.st === ST_HIVE) con++
    }
  const aff = S.dust >= OVERLOAD_COST
  const rx = mx - 12 * sc
  panel(...tr, 0.42, 14 * sc)
  text('CASTLES ' + con + '/' + tot, rx, m + ms * 0.33, max(13, 15 * sc), 2,LIL)
  text('DUST ' + (S.dust | 0) + '/' + OVERLOAD_COST, rx, m + ms * 0.68, max(13, 15 * sc), 2,aff ? rainbow(t * 0.3, 74) : DIM)

  /* mute */
  btn(mb, !S.muted, 0)
  text(S.muted ? '✕' : '♪', mx + ms / 2, my + ms / 2, ms * 0.5, 1, S.muted ? OFF : W)

  /* help */
  btn(hb, 1, 0)
  text('?', hb[0] + ms / 2, hb[1] + ms / 2, ms * 0.5, 1, W)

  /* Overload Glitter Wave */
  if (S.scene === SC_PLAY) {
    const ov = S.overload
    btn(
      ob,
      ov > 0 || aff,
      ov > 0 ? ov / OVERLOAD_TIME : min(1, S.dust / OVERLOAD_COST),
      ov > 0 ? 'GLITTER WAVE' : 'OVERLOAD',
      ov > 0 ? 'SWARM IMMUNE' : (TOUCH ? 'TAP' : 'SPACE') + ' - ' + OVERLOAD_COST + ' DUST'
    )
    if (ov > 0) {
      const s = 26 * sc
      text('INVINCIBLE ' + ov.toFixed(1) + 's', S.w / 2, ob[1] - s, s, 1, rainbow(t * 0.5, 72), 0, 0.6)
    }
  }
  g.restore()
}

/* ----------------------------- overlays --------------------------- */

export function drawOverlays(ctx) {
  g = ctx
  const sc = S.sc
  const w = S.w
  const h = S.h
  const t = S.t
  const dt = S.dt
  const play = S.scene === SC_PLAY
  ovT = play ? 0 : ovT + dt
  introA = clamp(introA + (S.intro ? dt * 4 : -dt * 2.4), 0, 1)
  g.save()

  /* tutorial — modal, shown once on the first ever run, reopened via "?" */
  if (S.help) {
    const u = max(15, 17 * sc)
    const pw = min(w - m * 2, 560 * sc)
    const ph = u * (HELP.length * 2.1 + 6.2)
    const px = (w - pw) / 2
    const py = (h - ph) / 2
    g.fillStyle = 'rgba(4,3,10,.72)'
    g.fillRect(0, 0, w, h)
    panel(px, py, pw, ph, 0.94, u)
    rr(px, py, pw, ph, u)
    g.lineWidth = max(2, 2.4 * sc)
    g.strokeStyle = rbg(px, pw, t * 0.2, 66)
    g.stroke()
    text('HOW TO PLAY', w / 2, py + u * 2, u * 1.5, 1, W)
    for (let i = 0; i < HELP.length; i++) {
      const y = py + u * (4.2 + i * 2.1)
      text(HELP[i][0], px + u * 1.4, y, u * 0.95, 0, rainbow(i / HELP.length, 70))
      text(HELP[i][1], px + u * 5.2, y, fit(HELP[i][1], u * 0.95, pw - u * 6.6), 0, LIL)
    }
    text(TAP + ' anywhere to play', w / 2, py + ph - u * 1.9, u * 0.95, 1, DIM)
    g.restore()
    return
  }

  /* title card */
  if (introA > 0.01) {
    g.globalAlpha = introA
    const fs = fit(TITLE, 58 * sc, w - m * 2)
    const cy = h * 0.35
    const pw = min(w - m * 2, fs * 10.5)
    panel(w / 2 - pw / 2, cy - fs * 1.35, pw, fs * 3.3, 0.62, 18 * sc)
    g.shadowColor = rainbow(t * 0.25, 62)
    g.shadowBlur = fs * 0.45
    text(TITLE, w / 2, cy - fs * 0.42, fs, 1, rbg(w / 2 - pw / 2, pw, t * 0.25, 66))
    g.shadowBlur = 0
    text('RAINBOW SWARM', w / 2, cy + fs * 0.52, fs * 0.42, 1, LIL)
    text(DRAG, w / 2, cy + fs * 1.3, fit(DRAG, max(14, 16 * sc), pw - 24 * sc), 1, W)
  }

  /* transient hint, latched locally so it always fades out */
  if (S.hintT > ht) {
    ht = S.hintT
    hs = S.hint
  }
  ht = max(0, ht - dt)
  if (ht && hs && play) {
    g.globalAlpha = min(1, ht)
    text(hs, w / 2, ob[1] - 62 * sc, max(14, 15 * sc), 1, W, 0, 0.6)
  }
  g.globalAlpha = 1

  /* region cleared / defeat */
  if (!play) {
    const dead = S.scene === SC_DEAD
    const pw = min(w - m * 2, 560 * sc)
    const ph = min(h - m * 2, 290 * sc)
    const x = (w - pw) / 2
    const y = (h - ph) / 2
    const u = ph / 10
    const rain = rbg(x, pw, t * 0.3, 68)
    const s = (t - rt0) | 0
    g.globalAlpha = min(1, ovT * 2.5)
    panel(x, y, pw, ph, 0.88, 18 * sc)
    g.lineWidth = max(2, 3 * sc)
    g.strokeStyle = dead ? OFF : rain
    rr(x, y, pw, ph, 18 * sc)
    g.stroke()

    const ttl = dead ? 'THE MAIN HIVE FELL' : 'REGION CLEARED'
    const st =
      S.units.length + ' UNICORNS   ' + (S.kills | 0) + ' PURGED   ' + ((s / 60) | 0) + ':' + ('0' + (s % 60)).slice(-2)
    const p = TAP + (dead ? ' to retry' : ' to continue')
    text(ttl, w / 2, y + u * 2, fit(ttl, u * 1.5, pw - u * 1.6), 1, dead ? DIM : rain)
    text(regionName(S.region).toUpperCase(), w / 2, y + u * 3.7, u * 0.85, 1, dead ? OFF : LIL)
    text(st, w / 2, y + u * 5.6, fit(st, u * 0.8, pw - u * 1.6), 1, W)
    g.globalAlpha *= 0.55 + 0.45 * pulse(t, 0.7)
    text(p, w / 2, y + ph - u * 1.4, u * 0.9, 1, W)
  }
  g.restore()
}

/* ------------------------------- input ---------------------------- */

export function uiHit(x, y) {
  if (S.help) return 'closehelp' // tutorial is modal: anywhere dismisses it
  if (inR(mb, x, y)) return 'mute'
  if (inR(hb, x, y)) return 'help'
  if (S.scene !== SC_PLAY) return ovT > 0.45 ? 'advance' : null
  return inR(ob, x, y) ? 'overload' : null
}

export function isUI(x, y) {
  return (
    S.help ||
    S.scene !== SC_PLAY ||
    inR(ob, x, y) ||
    inR(mb, x, y) ||
    inR(hb, x, y) ||
    inR(tl, x, y) ||
    inR(tr, x, y)
  )
}

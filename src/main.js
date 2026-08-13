/**
 * Plague of Light: Rainbow Swarm — boot, input, scene flow.
 *
 * No main menu by design: the world is already alive behind the title card,
 * and the card dissolves the moment the player draws their first trail.
 */
import {
  S,
  SC_PLAY,
  SC_CLEAR,
  SC_DEAD,
  SC_MAP,
  project,
  hint,
} from './state.js'
import { min, max, clamp } from './u.js'
import { buildAtlas } from './sprites.js'
import { makeRegion, REGIONS } from './world.js'
import { startTrail, extendTrail, endTrail } from './trail.js'
import { step, overload } from './sim.js'
import { updateFx } from './fx.js'
import { initAudio, tickAudio, toggleMute, music, sfx } from './audio.js'
import { layoutUI, uiHit, isUI } from './ui.js'
import { initRender, resizeRender, frame, PROF, Q } from './render.js'

// Queried, not taken from the `id=c` implicit global: toplevel mangling is
// free to name one of its own variables `c` and would shadow it.
const cv = document.querySelector('canvas')
const g = cv.getContext('2d')
let last = 0
let started = 0

/* ------------------------------ layout ------------------------------ */

const resize = () => {
  // Capped at 1.5, not 2: this is a fill-rate bound game (900 sprites + an
  // additive bloom composite), and a retina backing store costs ~1.8x the
  // pixels for a difference the neon glow hides anyway.
  S.dpr = min(1.5, devicePixelRatio || 1)
  S.w = innerWidth
  S.h = innerHeight
  cv.width = (S.w * S.dpr) | 0
  cv.height = (S.h * S.dpr) | 0
  layoutUI()
  project()
  resizeRender()
}

/* ------------------------------ scenes ------------------------------ */

const load = (i) => {
  makeRegion(i)
  project()
  S.scene = SC_PLAY
  S.over = 0
  hint('Drag from a glowing hive', 6)
}

/** Advance past an end-of-scene panel. */
const advance = () => {
  if (S.scene === SC_CLEAR) {
    S.scene = SC_MAP
    S.over = 0
    sfx('ui')
  } else if (S.scene === SC_MAP) {
    load(S.region + 1)
  } else if (S.scene === SC_DEAD) {
    load(S.region)
  }
}

/* ------------------------------ input ------------------------------- */

const pos = (e) => {
  S.px = e.clientX
  S.py = e.clientY
}

/** Tutorial is shown once ever, then only on demand. Storage may be blocked. */
const SEEN = 'pol_seen'
const seen = (v) => {
  try {
    return v === undefined ? localStorage[SEEN] : (localStorage[SEEN] = v)
  } catch {
    // Storage blocked (file://, strict privacy modes): fail toward TEACHING.
    // A new player who never sees the tutorial is a worse outcome than a
    // returning player dismissing it again.
    return ''
  }
}

const down = (e) => {
  initAudio()
  if (!started) {
    started = 1
    music(1)
  }
  pos(e)
  const hit = uiHit(S.px, S.py)
  if (hit === 'closehelp') {
    S.help = 0
    seen('1')
    sfx('ui')
    return
  }
  if (hit === 'help') {
    S.help = 1
    sfx('ui')
    return
  }
  if (hit === 'mute') {
    toggleMute()
    sfx('ui')
    return
  }
  if (hit === 'overload') {
    overload()
    return
  }
  if (S.scene !== SC_PLAY) {
    // Any tap outside the chrome advances the panel.
    if (S.over > 0.45) advance()
    return
  }
  if (isUI(S.px, S.py)) return
  S.down = 1
  if (startTrail(S.px, S.py)) S.intro = 0
}

const move = (e) => {
  pos(e)
  if (S.down && S.scene === SC_PLAY) extendTrail(S.px, S.py)
}

const up = () => {
  S.down = 0
  endTrail()
}

onpointerdown = down
onpointermove = move
onpointerup = up
onpointercancel = up
onresize = resize
oncontextmenu = (e) => e.preventDefault()

onkeydown = (e) => {
  initAudio()
  if (S.help) {
    S.help = 0
    seen('1')
    return
  }
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault()
    if (S.scene === SC_PLAY) overload()
    else if (S.over > 0.45) advance()
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMute()
  } else if (e.key === 'h' || e.key === 'H' || e.key === '?') {
    S.help = 1
  }
}

/* ------------------------------- loop ------------------------------- */

const loop = (ms) => {
  requestAnimationFrame(loop)
  let dt = (ms - last) / 1e3
  last = ms
  if (!(dt > 0)) dt = 0
  dt = min(0.05, dt)

  // Hit-stop: freeze the sim for a few ms on impact, keep drawing.
  if (S.hitStop > 0) {
    S.hitStop -= dt
    dt *= 0.15
  }

  // Adaptive quality. Hardware varies wildly and a 13kB game cannot ship a
  // settings menu, so watch the smoothed frame time and drop the expensive
  // bloom pass when we fall behind. Hysteresis (24ms down, 15ms up) stops it
  // oscillating frame to frame.
  S.fdt = S.fdt * 0.94 + dt * 0.06
  if (S.q) {
    if (S.fdt > 0.024) S.q = 0
  } else if (S.fdt < 0.015) S.q = 1

  S.dt = dt
  S.t += dt
  S.over += dt
  if (S.hintT > 0) S.hintT -= dt

  // The tutorial is modal — freeze the world so reopening it mid-region can
  // never cost the player their hive.
  if (!S.help) step(dt)
  updateFx(dt)
  tickAudio(dt)
  frame(g)
}

/* ------------------------------- boot ------------------------------- */

initRender()
resize()
buildAtlas()

// Dev-only region jump for QA. DEBUG is a compile-time false in release, so
// the whole block is dead code the bundler drops.
if (DEBUG) {
  window.__load = load
  window.__S = S
  window.__PROF = PROF
  window.__frame = () => frame(g) // render one frame synchronously, for profiling
  window.__step = (dt) => step(dt) // sim-only, for profiling
  window.__q = Q // stage on/off switches, for cost attribution
  window.__fx = (dt) => updateFx(dt)
}

load(0)
S.intro = 1
if (!seen()) S.help = 1 // first ever visit: teach before anything else
requestAnimationFrame(loop)

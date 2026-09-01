/**
 * main.js — boot, input, and the frame loop. Owns no game rules.
 *
 * The game starts straight into the duel: no menu, no loading screen. Every
 * asset is procedural, so the first frame is the game.
 */
import { S, PH_DUEL, load, save, clamp } from './state.js'
import { layout, toStage, render } from './render.js'
import { resetDuel, updateSim, strokeStart, strokeMove, strokeEnd, cast } from './sim.js'
import { initAudio, tickAudio, music, toggleMute, resetAudio, sfx } from './audio.js'
import { updateFx, resetFx } from './fx.js'
import { resetArena } from './arena.js'
import { layoutUI, uiHit, isUI } from './ui.js'
import { min } from './u.js'

/* `document.querySelector` and not the `c` global: terser mangles a toplevel
   name to `c` and would shadow it, which has broken the release build before. */
const cv = document.querySelector('canvas')
const g = cv.getContext('2d', { alpha: false })

/* ------------------------------ viewport ---------------------------- */
const resize = () => {
  const w = innerWidth
  const h = innerHeight
  // Cap DPR: a 3x phone would rasterise 3x the pixels for no visible gain.
  const dpr = min(devicePixelRatio || 1, 2)
  cv.width = w * dpr
  cv.height = h * dpr
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  layout(w, h, dpr)
  layoutUI()
  resetArena() // sky/island caches are resolution-bound
  resetFx()
}
addEventListener('resize', resize)

/* -------------------------------- input ----------------------------- */
let started = 0
/** Browsers only allow audio after a gesture; the first input starts it. */
const wake = () => {
  if (started) return
  started = 1
  initAudio()
  music(1)
}

const act = (a) => {
  if (!a) return 1
  sfx('ui')
  // codes, not names — see uiHit
  if (a === 1) cast()
  else if (SPELLBOOK && a === 2) S.book = 1
  else if (SPELLBOOK && a === 3) S.book = 0
  else if (a === 9) {
    toggleMute()
    save()
  } else if (a === 4) {
    resetDuel()
    resetAudio()
  } else {
    // Buy one rank of an element. Priced off the rank already held, so each is
    // dearer than the last and the player has to pick a lane rather than
    // levelling all four flat.
    const i = a - 5
    const c = 10 * (S.up[i] + 1)
    if (S.coins >= c) {
      S.coins -= c
      S.up[i]++
      save()
    }
  }
  return 0
}

const down = (e) => {
  e.preventDefault()
  wake()
  const [x, y] = toStage(e.clientX, e.clientY)
  if (!act(uiHit(x, y))) return
  // Draw ANYWHERE that is not a button. Gating this on the central box made
  // most of the screen silently dead, which reads as "the press didn't register".
  if (isUI(x, y) || S.phase !== PH_DUEL) return
  // Capture, so a stroke that wanders off the canvas (or off-screen) keeps
  // delivering moves and still ends with a real pointerup.
  try {
    cv.setPointerCapture(e.pointerId)
  } catch {
    /* not all pointer types allow capture; window listeners still cover us */
  }
  strokeStart(x, y)
}
const move = (e) => {
  if (!S.draw) return
  // Safety net: if we are still "drawing" but nothing is pressed, a pointerup
  // went missing (capture handover, a swallowed event, a lost pointer). End the
  // stroke rather than leave ink hanging on screen forever.
  if (e.buttons === 0) {
    strokeEnd()
    return
  }
  e.preventDefault()
  // A pointer emits far more positions than there are frames. Coalesced events
  // give us every one of them, so the ink follows the real path instead of
  // cutting corners between frame samples.
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : 0
  if (evs && evs.length) {
    for (let i = 0; i < evs.length; i++) {
      const [x, y] = toStage(evs[i].clientX, evs[i].clientY)
      strokeMove(x, y)
    }
  } else {
    const [x, y] = toStage(e.clientX, e.clientY)
    strokeMove(x, y)
  }
}
const up = (e) => {
  e.preventDefault()
  strokeEnd()
}
cv.addEventListener('pointerdown', down)
addEventListener('pointermove', move, { passive: false })
addEventListener('pointerup', up)
addEventListener('pointercancel', up)
// Capture can be lost without an up/cancel ever reaching us.
cv.addEventListener('lostpointercapture', up)
// A stroke that leaves the window must still resolve, or the queue soft-locks.
addEventListener('blur', up)
cv.addEventListener('contextmenu', (e) => e.preventDefault())

addEventListener('keydown', (e) => {
  wake()
  const k = e.key
  if (k === ' ' || k === 'Enter' || k === 'e' || k === 'E') {
    e.preventDefault()
    if (S.phase !== PH_DUEL) act(4)
    else cast()
  } else if (SPELLBOOK && k === 'Escape') S.book = 0
  else if (k === 'm' || k === 'M') {
    toggleMute()
    save()
  } else if (SPELLBOOK && (k === '?' || k === 'h' || k === 'H')) S.book = S.book ? 0 : 1
})

/* ------------------------------- frame ------------------------------ */
const STEP = 1 / 120 // fixed physics step: identical duel at 30 or 144 Hz
let acc = 0
let prev = 0

const frame = (now) => {
  requestAnimationFrame(frame)
  const raw = prev ? (now - prev) / 1000 : 0.016
  prev = now
  // Clamp: a backgrounded tab returns a huge dt that would teleport shots.
  const dt = clamp(raw, 0, 0.25)
  S.dt = dt
  S.t += dt

  // Adaptive quality with hysteresis, so it settles instead of oscillating.
  S.fdt += (raw - S.fdt) * 0.1
  if (S.fdt > 0.024 && S.q > 0) S.q = 0
  else if (S.fdt < 0.015 && S.q < 1) S.q = 1

  acc = min(acc + dt, 0.25)
  while (acc >= STEP) {
    updateSim(STEP)
    acc -= STEP
  }
  updateFx(dt)
  tickAudio(dt)
  render(g)
}

/* -------------------------------- boot ------------------------------ */
const boot = () => {
  load()
  resize()
  resetDuel()
  S.round = 1
  requestAnimationFrame(frame)
}

if (WAVEDASH) {
  /**
   * WAVEDASH HANDSHAKE. Wavedash keeps its OWN loading screen up over the
   * game and only takes it down once we report full progress and readiness —
   * skip this pair and the player never sees the game at all, however fast it
   * booted. The SDK arrives on a `<script>` that Wavedash's platform wrapper
   * injects, so nothing is added to the page here.
   *
   * Three things this has to survive, all of them documented platform
   * behaviour rather than paranoia:
   *   · `WavedashJS` is a PROMISE, not an object — it must be awaited before
   *     any method is read.
   *   · Its methods can be MISSING on older wrappers — hence every call is
   *     optional.
   *   · The wrapper may never answer at all. A handshake that hangs would
   *     leave a permanently black screen, so a 3s race boots the game anyway
   *     and the ready signal is simply skipped. A game that runs unreported
   *     beats a game that never starts.
   */
  ;(async () => {
    let s
    try {
      // A NON-PROMISE in a race settles immediately, so a missing wrapper costs
      // nothing: `s` comes back undefined and the game boots at once. The 3s
      // only ever applies to a wrapper that answered with a promise and then
      // stalled — which is the case that would otherwise hang on a black screen.
      s = await Promise.race([self.WavedashJS, new Promise((r) => setTimeout(r, 3e3))])
      await s?.init?.({})
    } catch {
      s = 0
    }
    boot()
    // Only after init resolves: reporting ready before the SDK is up is the
    // one ordering Wavedash does not accept.
    s?.updateLoadProgressZeroToOne?.(1)
    s?.readyForEvents?.()
  })()
} else boot()

if (DEBUG) {
  // Synchronous hooks: rAF is throttled to ~1fps when the window is occluded,
  // so all automated QA drives the game through these instead of the loop.
  self.__S = S
  self.__step = (n = 1, d = STEP) => {
    for (let i = 0; i < n; i++) {
      S.t += d
      S.dt = d
      updateSim(d)
      updateFx(d)
    }
  }
  self.__frame = () => render(g)
  self.__cast = cast
  self.__stroke = (pts) => {
    strokeStart(pts[0], pts[1])
    for (let i = 2; i < pts.length; i += 2) strokeMove(pts[i], pts[i + 1])
    strokeEnd()
  }
}

/**
 * AUDIO — 100% synthesised at runtime with the Web Audio API. Zero asset bytes.
 *
 *   one-shot cues ─┐                    ┌──── dry ─────────────┐
 *   swarm grains  ─┼→ master gain ──────┤                      ├→ lowpass
 *   music notes   ─┘   (mute rides it)  └→ 350Hz HP → verb ────┘     │
 *                                                                    ↓
 *                                            destination ← limiter ──┘
 *
 * Autoplay policy: nothing is constructed until `initAudio()` runs from a real
 * user gesture. Every other entry point is an inert no-op — never a throw —
 * before that happens, so a browser with audio blocked still plays the game.
 *
 * THE SWARM IS GRANULAR, NOT TONAL. There is no drone and no oscillator
 * anywhere near it. The horde is a stampede: short bandpassed noise grains
 * (hooves) plus occasional long lowpassed swells (mass), scheduled ahead on
 * the audio clock exactly like the music sequencer. Unit count moves the grain
 * DENSITY and nothing else — no pitch, no cutoff, no sweep tracks the count —
 * so 900 unicorns read as rain on a roof instead of a synth pad climbing a
 * ramp. Two useful consequences fall out of that for free:
 *  - it cannot click or zipper however fast the count jumps, because there is
 *    no continuously running node whose params have to be retargeted;
 *  - it fades in from and out to true silence, because at zero units there is
 *    simply nothing scheduled.
 *
 * Other character notes (the mix has to survive 900 units):
 *  - every cue shares one procedurally generated reverb, highpassed on the way
 *    in so the low, dark cues (cut / lose / bass / rumble) stay tight.
 *  - the bulk cues (hit / spawn / draw) duck as the horde grows and throttle
 *    harder as the voice count rises, so 900 units is not 900 tiny stabs.
 *
 * Size strategy: there is exactly ONE voice function, `snd()`. Everything —
 * hooves, rumbles, arpeggios, kick, hat — is a row of numbers fed to it. Local
 * names are mangled away by terser, so they are spelled out for readability;
 * string literals are not, so waveform/filter types are numeric indices.
 */
import { S } from './state.js'

/** `snd` type codes: 0-2 pick an oscillator wave, 3-5 pick a filter. */
const TY = 'sine sawtooth triangle lowpass bandpass highpass'.split(' ')
const VOL = 0.8 // master target level (the limiter catches the peaks)
const NT = 0.134 // one 16th note ≈ 112 BPM
const MAJ = [0, 4, 7, 11, 12, 16, 19, 23] // two octaves of maj7, in semitones
const ROOT = [0, 5, -4, 3] // 4-bar chord walk under the arpeggio
const FREQ = 'hit spawn draw kill ui cut' // cues that fire in bulk
const GAP = 0.05 // min seconds between two shots of one bulk cue
// Ceiling on live voices before bulk cues get dropped. The swarm bed counts
// toward it, and at 2000 units the bed plus music alone sit near 30, so this
// is a safety valve against a genuine voice explosion, NOT the rate limiter —
// `thr` below does the shaping. Set too low, it silently eats `cut`.
const CAP = 40
const rnd = Math.random

let ac // AudioContext — undefined until the first gesture
let rdy = 0 // graph built and usable
let mst // master gain — every voice lands here; mute rides it, and so do the
// dry path and the reverb send, so one fader kills everything
let nb // the one and only noise buffer
let live = 0 // voices currently sounding
let swT = 0 // swarm size, as reported by the sim
let swS = 0 // swarm size, smoothed — what the grain density tracks
let gnx = 0 // next scheduled swarm grain, on the AudioContext clock
let mus = 0 // music bed wanted
let nxt = 0 // next scheduled music step, on the AudioContext clock
let seq = 0 // step counter
const thr = {} // cue name -> earliest time it may fire again

/* --------------------------- node shorthands --------------------------- */

const gain = (v) => {
  const g = ac.createGain()
  g.gain.value = v
  return g
}

/** A biquad of type `ty`. Its stock cutoff is 350Hz — free where that fits. */
const filter = (ty) => {
  const b = ac.createBiquadFilter()
  b.type = TY[ty]
  return b
}

const end = () => live--

/**
 * The one and only voice.
 *
 *   f > 0 → oscillator at `f` Hz, `ty` = wave 0..2, gliding to `to` Hz
 *   f < 0 → noise off the shared buffer through a `ty` = 3..5 filter whose
 *           cutoff sweeps from -f down/up to `to`
 *
 * `g` peak gain, `t` absolute start time (audio clock), `a` attack seconds —
 * defaulted to a soft 12ms so nothing ever clicks. Always exponential-decays
 * to silence across `d`, then self-disposes.
 */
const snd = (f, d, ty, g, to, t, a) => {
  try {
    const env = gain(0)
    const eg = env.gain
    let src, prm // the source node, and the param that gets swept
    if (f > 0) {
      src = ac.createOscillator()
      src.type = TY[ty]
      prm = src.frequency
      src.connect(env)
    } else {
      src = ac.createBufferSource()
      src.buffer = nb
      src.loop = 1 // one short buffer covers any duration
      const b = filter(ty)
      prm = b.frequency
      f = -f
      src.connect(b).connect(env)
    }
    prm.setValueAtTime(f, t)
    if (to) prm.exponentialRampToValueAtTime(to, t + d)
    eg.setValueAtTime(0, t)
    eg.linearRampToValueAtTime(g, t + (a || 0.012))
    eg.exponentialRampToValueAtTime(1e-4, t + d)
    env.connect(mst)
    // The random offset means no two noise voices read the same samples, so
    // the shared buffer never betrays itself as a loop — that is what lets the
    // swarm bed run for ten minutes without turning into an audible pattern.
    src.start(t, rnd() * 0.3) // the offset arg is ignored by oscillators
    src.stop(t + d + 0.03)
    live++
    src.onended = end
  } catch {}
}

/**
 * Ascending arpeggio over the shared maj7 stack — the "reward" gesture. Each
 * step is a triangle plus a sine a few cents sharp: the slow beat between them
 * is what stops it sounding like a bare chiptune blip.
 */
const arp = (base, n, d, sp, t) => {
  for (let i = 0; i < n; i++) {
    const f = base * 2 ** (MAJ[i] / 12)
    const w = t + i * sp
    snd(f, d, 2, 0.05, 0, w, 0.012)
    snd(f * 1.006, d, 0, 0.03, 0, w, 0.03)
  }
}

/* -------------------------------- init --------------------------------- */

/** Safe to call on every user gesture, forever. No-op once running. */
export function initAudio() {
  try {
    if (!ac) {
      ac = new (self.AudioContext || self.webkitAudioContext)()

      // Bus. Everything sums into `mst` (the fader mute rides); `lp` is a
      // gentle master lowpass that shaves the synthetic top off the whole mix
      // — dry AND reverb — before the limiter, whose stock curve is already a
      // decent bus compressor.
      mst = gain(S.muted ? 0 : VOL)
      const lp = filter(3)
      lp.frequency.value = 5e3
      lp.connect(ac.createDynamicsCompressor()).connect(ac.destination)
      mst.connect(lp)

      // ONE noise buffer (~0.42s), reused by every noise voice for the whole
      // session — voices loop it from a random offset, so any duration and any
      // number of simultaneous grains come out of these samples.
      nb = ac.createBuffer(1, 2e4, ac.sampleRate)
      const nd = nb.getChannelData(0)
      for (let i = 2e4; i--; ) nd[i] = rnd() * 2 - 1

      // Reverb send. The impulse response is grown here, once: 1e5 samples of
      // stereo noise (~2.1-2.3s, depending on the device rate) under a cubic
      // decay. The two channels are independently random, so the room is wide.
      // The send's highpass runs at a biquad's stock 350Hz (free), keeping bass
      // out of the tail: bright cues bloom, low cues stay dry and punchy. The
      // swarm's hoof grains sit right in the send's band, so the stampede gets
      // the room and reads as distance rather than as something in your face.
      const ib = ac.createBuffer(2, 1e5, ac.sampleRate)
      for (let c = 2; c--; ) {
        const d = ib.getChannelData(c)
        for (let i = 1e5; i--; ) d[i] = (rnd() * 2 - 1) * (1 - i / 1e5) ** 3
      }
      const cv = ac.createConvolver()
      cv.buffer = ib
      mst.connect(filter(5)).connect(cv).connect(gain(0.36)).connect(lp)

      rdy = 1
    }
    ac.resume() // no-op when already running
  } catch {}
}

/* ------------------------------ one-shots ------------------------------ */

/** Fire cue `n`. `v` (0..1) is optional intensity / variation. */
export function sfx(n, v) {
  if (!rdy) return
  const t = ac.currentTime
  const p = 0.8 + rnd() * 0.4 // wide pitch jitter so repeats never machine-gun
  const k = rnd() // timbre roll — bulk cues alternate between shapes
  let q = 1 // bulk-cue level, ducked as the horde grows
  // Bulk cues are rate-limited and voice-capped. The rare, important cues
  // (convert / overload / win / lose) always land.
  if (FREQ.includes(n)) {
    if (t < thr[n] || live > CAP) return
    // `live` counts the swarm bed too, so a big horde widens this by itself.
    thr[n] = t + GAP + live * 0.012
    q = 15 / (15 + swS ** 0.5) // 100 units -> 0.6, 900 -> 0.33
  }
  switch (n) {
    case 'hit': // soft dark thud; past ~400 units it degrades into a crunch
      q *= 0.03 + (v || 0.5) * 0.06
      if (k > 0.5 - swS / 2e3) snd(-620 * p, 0.1, 4, q * 1.6, 170, t, 0.004)
      else snd((260 + k * 340) * p, 0.09, k > 0.24 ? 2 : 0, q, 80 * p, t, 0.005)
      break
    case 'spawn': // warm little bloom — deliberately near-subliminal
      snd(290 * p, 0.13, 2, 0.016 * q, 450 * p, t, 0.02)
      break
    case 'draw': // trail tick, quieter still
      snd(720 * p, 0.07, 2, 0.007 * q, 540 * p, t, 0.006)
      break
    case 'ui':
      snd(520, 0.14, 2, 0.055, 790, t, 0.006)
      break
    case 'kill': // falling cry + a soft body thump
      snd(340 * p, 0.24, 2, 0.05 * q, 55 * p, t, 0.005)
      snd(-1500, 0.16, 4, 0.05 * q, 240, t, 0.005)
      break
    case 'cut': // Void Wound: low rumble swept hard down. Below the verb, dry.
      snd(-1000, 0.9, 3, 0.34, 50, t, 0.03)
      snd(108 * p, 0.85, 1, 0.11, 28, t, 0.03)
      break
    case 'convert': // THE reward: chorused maj7 arpeggio over a low swell
      arp(196, 6, 0.75, 0.06, t)
      snd(98, 1.2, 2, 0.15, 0, t, 0.025)
      snd(-600, 0.7, 4, 0.045, 6000, t, 0.14)
      break
    case 'overload': // Glitter Wave: rising shimmer over a huge low chord
      arp(147, 5, 1.9, 0.06, t)
      snd(73, 1.8, 2, 0.19, 0, t, 0.04)
      snd(-300, 1.9, 4, 0.18, 8000, t, 0.45)
      snd(-1400, 1.2, 3, 0.15, 45, t, 0.03)
      break
    case 'win': // fanfare: the whole stack, two octaves up, over a deep root
      arp(262, 8, 1.1, 0.11, t)
      snd(65, 2.4, 2, 0.15, 0, t, 0.06)
      break
    case 'lose': // dark descending, and dry by contrast
      snd(165, 2.2, 1, 0.11, 36, t, 0.06)
      snd(-700, 1.9, 3, 0.11, 42, t, 0.06)
  }
}

/* ------------------------------ swarm bed ------------------------------ */

/** Report the live unit count. Smoothed in `tickAudio`, so jumps are free. */
export function setSwarm(n) {
  swT = n > 0 ? n : 0
}

/* -------------------------------- music -------------------------------- */

/** Start/stop the procedural bed. Safe before init; picks up on the next tick. */
export function music(on) {
  mus = on ? 1 : 0
  nxt = seq = 0 // resync to the audio clock and restart at bar 1
}

/**
 * One sequencer step (a 16th): a music-box triangle arpeggio on the 8ths with
 * a soft attack and a long tail, a bass that follows the 4-bar chord walk and
 * swells in over most of a second, a round sine kick on steps 0/6/10 (the 1089
 * bitmask) and a dark tick on 2/6/10/14. Everything sits well under the cues.
 */
const note = (i, t) => {
  const s = i & 15 // step within the bar
  const r = ROOT[(i >> 4) & 3] // which chord of the 4-bar walk
  if (!(s & 1)) snd(220 * 2 ** ((r + MAJ[(i >> 1) & 7]) / 12), 0.5, 2, 0.02, 0, t, 0.03)
  if (!s) snd(55 * 2 ** (r / 12), 2.4, 0, 0.06, 0, t, 0.7)
  if ((1089 >> s) & 1) snd(108, 0.3, 0, 0.08, 32, t, 0.005)
  if (s % 4 == 2) snd(-5000, 0.06, 4, 0.007, 2600, t, 0.004)
}

/* --------------------------------- tick -------------------------------- */

/** Call once per frame with the frame delta in seconds. */
export function tickAudio(dt) {
  if (!rdy) return
  const t = ac.currentTime

  // `swS` chases the real count slowly, so a castle conversion ramps the bed
  // over ~half a second instead of stepping it.
  swS += (swT - swS) * (dt < 0.4 ? dt * 2.5 : 1)

  // THE STAMPEDE. `gi` is the mean seconds between grains and is the ONLY
  // thing the unit count touches: 0.93s at one unit, 0.13s at 100, 0.042s at
  // 900, and it saturates at 0.03s however big the horde gets, which is what
  // caps the CPU. Nothing here is a function of pitch.
  //
  // Every grain is a short bandpassed noise thud — a hoof — with its band,
  // length, fall and level all rolled per grain, and the gap to the next one
  // jittered 0.4x..1.6x, so it can never lock into a machine-gun or a loop.
  // Roughly one grain in eight also seeds a long, soft, lowpassed swell; at a
  // few hundred units those overlap four or five deep and fuse into the mass
  // of the herd. Level per grain is nearly flat, so growth is heard as more
  // things happening rather than as anything getting higher or louder.
  if (swS > 1) {
    const gi = 0.03 + 0.9 / (1 + swS / 12)
    const g = (0.035 * swS) / (swS + 8) // fade in from true silence
    if (gnx < t) gnx = t + 0.05 // first grain, or recovery from a tab stall
    while (gnx < t + 0.2) {
      const b = rnd()
      snd(-(170 + b * 700), 0.05 + b * 0.07, 4, g * (0.5 + rnd()), 80 + b * 160, gnx, 0.005)
      if (rnd() < 0.13) snd(-190, 1.4, 3, (g * swS) / (swS + 300), 110, gnx, 0.7)
      gnx += gi * (0.4 + rnd() * 1.2)
    }
  }

  // Sequencer. Notes are placed on the audio clock ~200ms ahead, so frame
  // jitter never smears the groove. Nothing is allocated here but the notes.
  if (mus) {
    if (nxt < t) nxt = t + 0.05 // first note, or recovery from a tab stall
    while (nxt < t + 0.2) {
      note(seq++, nxt)
      nxt += NT
    }
  }
}

/* --------------------------------- mute -------------------------------- */

/** Ramp the master bus to 0 / VOL. Returns (and mirrors into S) the new state. */
export function toggleMute() {
  S.muted = S.muted ? 0 : 1
  if (rdy) mst.gain.setTargetAtTime(S.muted ? 0 : VOL, ac.currentTime, 0.02)
  return S.muted
}

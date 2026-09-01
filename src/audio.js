/**
 * PROCEDURAL AUDIO — Web Audio API only, zero asset bytes.
 *
 * CONTRACT
 *   Nothing is constructed until `initAudio()` runs from a real user gesture
 *   (autoplay policy). Every other export is a safe no-op before that, and
 *   after that never throws — hostile input is sanitised at the door, so no
 *   non-finite value can ever reach an AudioParam.
 *
 * SIGNAL FLOW — there is exactly ONE path and nothing runs beside it:
 *   every voice -> mst (master gain) -> DynamicsCompressor -> destination
 *   NOTHING is always-on. The music is not a drone with a filter on it, it is
 *   a stream of short scheduled voices that stop and disconnect themselves, so
 *   `mst` really is the only fader in the graph and there is no second path a
 *   mute could miss.
 *
 * MUTE — `vol()` is the ONLY code that ever touches `mst.gain`, and it only
 *   ever calls setTargetAtTime. Mixing a direct `.value` write with scheduled
 *   automation on one AudioParam is the classic Web Audio mute bug: the
 *   automation timeline keeps evaluating and silently discards the assignment
 *   (or the assignment lands one render quantum and is overwritten), so the
 *   fader appears stuck. One mechanism, one owner, no exceptions.
 *   Second, independent guarantee: `V()` refuses to BUILD a voice while
 *   `S.muted`, so a muted game generates no sound at all rather than merely
 *   attenuating it. Either mechanism alone is sufficient.
 *
 * THE MUSIC (GDD 2.3) is a slow piano piece, not an arpeggiator: a two-bar
 * chord progression in A with real voice-leading (`CH`), a rolled left hand,
 * and a sparse melody drawn from the chord tones. `setMood(S.sky)` morphs it
 * by MODE MIXTURE — losing is A aeolian (i bVI bIII bVII i7 iv7 bVI v), slow
 * and thin; winning bends three stored notes a semitone into A major with a
 * real V-I cadence (I bVI bIII bVII I7 iv7 bVI V), a little quicker and with
 * the full triad plus more melody. Both extremes are consonant; the mode is
 * sampled once per chord so a drifting mood can never leave a chord detuned
 * halfway between the two.
 *
 * SIZE NOTES
 *   Terser mangles every top-level name to one character, so descriptive
 *   identifiers here are free. What is NOT free are long *property* names, so
 *   the ones that repeat most are aliased into string constants, and wave
 *   types are table indices rather than repeated string literals.
 */
import { S } from './state.js'
import { rnd } from './u.js'

/* Property-name aliases — pure byte savings, see SIZE NOTES. */
const SET = 'setValueAtTime'
const EXP = 'exponentialRampToValueAtTime'
const FRQ = 'frequency'
const CON = 'connect'

/* Wave table: index 0 is the shared noise buffer, 1..3 are oscillators. */
const NOISE = 0
const SIN = 1
const TRI = 2
const SAW = 3
const W = [0, 'sine', 'triangle', 'sawtooth']

const MAXV = 40 // hard voice cap — drop rather than clip
const AHEAD = 0.25 // sequencer look-ahead, seconds
const VOL = 0.55 // master level when unmuted

/* --------------------------------------------------------------- graph */
let A // AudioContext — falsy until the first gesture
let mst // master gain — the ONLY fader, owned solely by vol()
let nz // the ONE shared noise buffer
let vc = 0 // live voice count

/* mood: target + smoothed, 0 losing .. 1 winning */
let mood = 0.5
let mS = 0.5
/** Sampled mode, 0 = minor / aeolian, 1 = major. See `at`. */
let cb = 0

/* sequencer */
let playing = 0 // music requested
let nx = 0 // next step time, on the AudioContext clock
let step = 0 // step index (one eighth note)
let lastDraw = 0 // 'draw' rate limiter
let lastMel = -9 // step of the last melody note — never two in a row
let mi = 0 // melodic contour index

/**
 * Sanitise AND clamp in one go: anything non-numeric (NaN, undefined, a
 * string, ±Infinity below the floor) fails the `> a` test and comes out as
 * `a`. Every number that reaches an AudioParam passes through here.
 */
const cl = (v, a, b) => ((v = +v) > a ? (v < b ? v : b) : a)

/** The AudioContext clock, sanitised. Everything schedules against this. */
const now = () => cl(A.currentTime, 0, 1e7)

/** `mk('Gain')` -> `A.createGain()`. Node factory; the names are long. */
const mk = (k) => A['create' + k]()

/** Semitones above A1 (55 Hz) -> Hz. The one tuning function in the file. */
const hz = (s) => 55 * 2 ** (s / 12)

/**
 * THE ONLY WRITER OF `mst.gain`, and it only ever calls setTargetAtTime — see
 * the MUTE note at the top. Successive calls are safe by construction: a later
 * setTargetAtTime simply supersedes the earlier one from its own start time,
 * so hammering the mute button just re-aims the same smooth approach and can
 * never leave the fader stuck between two mechanisms.
 */
const vol = () => {
  if (A) mst.gain.setTargetAtTime(S.muted ? 0 : VOL, now(), 0.03)
}

/* ---------------------------------------------------------------- voice */
/**
 * THE voice. Every single sound in the game — cues and piano notes alike — is
 * built out of calls to this.
 *   w   wave index into W, or NOISE for the shared buffer
 *   f0  start frequency (Hz)      f1  end frequency, glides exponentially
 *                                     (0 / omitted = hold f0)
 *   d   duration (s)              g   peak gain
 *   q   filter tracking: cutoff sweeps f0*q -> f1*q, so q is "brightness"
 *       for oscillators and stays 1 for a noise sweep (omitted = 1)
 *   dl  delay before it starts (s)   a  attack (s, omitted = 4 ms)
 * The gain envelope is a fast exponential attack into a long exponential
 * decay, which is exactly a struck-string envelope — see `pia`.
 */
const V = (w, f0, f1, d, g, q, dl, a) => {
  if (!A || S.muted || vc >= MAXV) return
  /* d, g and f0 are what the API can throw on; f1/a/q only ever arrive from
     the literal tables below, and every `v` from outside is clamped by its
     cue before it gets here. */
  d = cl(d, 0.02, 4)
  g = cl(g, 1e-4, 0.9)
  f0 = cl(f0, 10, 18e3)
  f1 = f1 || f0
  a = a || 0.004
  q = q || 1
  const t = now() + (dl || 0) // NaN/undefined are falsy, so this is safe
  const e = t + d
  const flt = mk('BiquadFilter') // defaults to lowpass, Q 1
  const out = mk('Gain')
  const gp = out.gain
  let s
  if (w) {
    s = mk('Oscillator')
    s.type = W[w]
    s[FRQ][SET](f0, t)
    s[FRQ][EXP](f1, e)
  } else {
    s = mk('BufferSource')
    s.buffer = nz
    s.loop = 1 // looped, so an exotic sampleRate can never run it dry
    flt.type = 'bandpass' // for noise the sweep IS the band
  }
  /* f0/f1 are already clamped and q is finite, so the cutoff is too, and the
     AudioParam clamps it to its own nominal range for us. */
  flt[FRQ][SET](f0 * q, t)
  flt[FRQ][EXP](f1 * q, e)
  /* click-free envelope: near-silent -> exponential attack -> exp tail */
  gp[SET](1e-4, t)
  gp[EXP](g, t + a)
  gp[EXP](1e-4, e)
  s[CON](flt)[CON](out)[CON](mst)
  s.start(t)
  s.stop(e)
  vc++
  s.onended = () => (vc--, out.disconnect())
}

/* ----------------------------------------------------------------- cues */
/**
 * Scale degrees for the one-shot cues, in the same key as the music so nothing
 * ever clashes with the bed. The ODD entries are the colour tones (3rd, b7,
 * 10th) and rise a semitone with `cb`, which is the same minor->major mixture
 * the progression uses. Degree 0 sits on A2 (110 Hz).
 */
const DEG = [0, 3, 7, 10, 12, 15]
const nf = (i) => hz(12 + DEG[i % 6] + (i & 1 ? cb : 0))

/**
 * The four runes, layer A (0..3) over layer B (4..7), so a player can name
 * the element with their eyes shut:
 *   FIRE  warm sawtooth chirp + ember crackle
 *   WIND  airy filtered noise sweep + breathy tail
 *   ICE   crystalline bell + inharmonic 2.76x partial
 *   EARTH low thunk + dusty thud
 */
const SNAP = [
  [SAW, 170, 540, 0.26, 0.2, 5],
  [NOISE, 380, 3600, 0.38, 0.16, 1, 0, 0.05],
  [SIN, 1180, 0, 0.7, 0.16],
  [TRI, 150, 42, 0.3, 0.28, 4],
  [NOISE, 1500, 620, 0.18, 0.08, 1.4, 0.01],
  [NOISE, 2600, 900, 0.3, 0.07, 1, 0.06, 0.08],
  [SIN, 3260, 0, 0.5, 0.07, 1, 0.005],
  [NOISE, 300, 80, 0.22, 0.12],
]

/**
 * Cue table. `'__proto__': null` makes an unknown name resolve to undefined
 * instead of an inherited Object method. Keys are QUOTED so
 * `--mangle-all-props` cannot rename them out from under the caller.
 */
const CUES = {
  '__proto__': null,

  /* Called many times per second while the finger moves: hard rate limit,
     soft voice, pitched up the current (mood-bent) scale so drawing feels
     like singing on the surface rather than a machine gun. v = 0..1 stroke. */
  'draw': (v) => {
    const t = now()
    if (t - lastDraw < 0.055) return
    lastDraw = t
    const f = nf((cl(v, 0, 1) * 5) | 0) * 2
    V(TRI, f, f * 1.01, 0.11, 0.038, 5)
  },

  /* A rune was RECOGNISED. v = rune id 0..3. */
  'snap': (v) => {
    v = cl(v | 0, 0, 3)
    V(...SNAP[v])
    V(...SNAP[v + 4])
  },

  /* Shape not recognised: a soft falling minor second. A shrug, not a slap. */
  'bad': () => {
    V(TRI, 330, 250, 0.18, 0.1)
    V(TRI, 311, 236, 0.22, 0.07, 1, 0.07)
  },

  /* The spell launches. v = rune count 1..3: a modest zap, or a layered
     riser under a full triad that bends minor->major with the mood.
     This is the reward moment, so every layer scales with v. */
  'cast': (v) => {
    const n = cl(v | 0, 1, 3)
    V(NOISE, 300, 1200 + 2600 * n, 0.25 + 0.18 * n, 0.05 + 0.03 * n, 1, 0, 0.1 * n)
    V(SIN, 120, 46, 0.4, 0.18, 1, 0.04 * n)
    for (let i = 0; i < n; i++) {
      const f = nf(i) * 2
      V(SAW, f, f * 2, 0.3 + 0.12 * n, 0.07 + 0.02 * n, 3 + 2 * n, i * 0.045)
    }
  },

  /* Spell connects. v = power 0..1 scales body, brightness and length. */
  'hit': (v) => {
    const p = cl(v, 0, 1)
    V(NOISE, 260 + 700 * p, 90, 0.18 + 0.3 * p, 0.18 + 0.18 * p)
    V(SIN, 180 + 120 * p, 44, 0.22 + 0.25 * p, 0.2 + 0.2 * p)
  },

  /* A barrier eats the hit: glassy shimmer over a rising chime. */
  'guard': () => {
    V(NOISE, 1600, 2600, 0.22, 0.1)
    V(SIN, 620, 940, 0.35, 0.12)
  },

  /* You take damage: a sagging saw and a dull thud. */
  'hurt': () => {
    V(SAW, 240, 62, 0.5, 0.22, 4)
    V(NOISE, 900, 200, 0.35, 0.12)
  },

  /* Triumphant flourish. Forcing mood AND the sampled mode to 1 snaps the
     scale to major (0,4,7,11,12,16) for the flourish itself and hands the
     progression its bright V-I colour on the very next chord. */
  'win': () => {
    mood = mS = cb = 1
    for (let i = 0; i < 6; i++) {
      const f = nf(i) * 2
      V(TRI, f, 0, 0.9, 0.11, 6, i * 0.1)
      V(SIN, f * 4, 0, 0.7, 0.05, 1, i * 0.1 + 0.02)
    }
    V(NOISE, 900, 7000, 1.2, 0.07, 1, 0, 0.3)
  },

  /* Melancholic low drone: two saws beating a half-hertz apart over a sub,
     and the mood dropped to 0 so the piano falls back to aeolian. */
  'lose': () => {
    mood = mS = cb = 0
    V(SAW, 110, 41, 2.2, 0.16, 2.5, 0, 0.5)
    V(SAW, 109, 40.5, 2.4, 0.13, 2, 0.05, 0.6)
    V(SIN, 55, 27, 2.6, 0.18, 1, 0, 0.4)
  },

  'ui': () => V(TRI, 760, 900, 0.09, 0.09),
}

/* ---------------------------------------------------------------- music */
/**
 * THE PROGRESSION. Eight chords, two bars each, written out as four voices —
 * bass, then the three right-hand voices low to high — in semitones above
 * A1 (55 Hz). Hand-voiced so that NO right-hand voice ever moves more than a
 * whole tone between chords; the bass carries the harmonic motion:
 *
 *   Am(A)  Fmaj7  C   G   Am7(A7)  Dm7  Fmaj7  Em(E)
 *   i/I    bVI    bIII bVII i7/I7  iv7  bVI    v/V
 *
 * Three stored notes are marked "bendable" and rise a semitone in the major
 * mode: the C of the two tonic chords (-> C#) and the G of the final chord
 * (-> G#, the leading tone). That single bit turns a floating aeolian loop
 * with a modal minor v into A major with a real V-I cadence and a secondary
 * dominant (A7 -> Dm7), which is the whole win/lose morph — harmony, not a
 * filter sweep. Everything else is common to both modes, so nothing has to
 * cross-fade and both extremes are fully consonant.
 *
 * ENCODING: one character per voice, code = 42 + 2*semitone + bendable.
 * So `c>>1` minus 21 is the semitone and `c&1` is the bend flag.
 */
const CH = '*ahr:`hr0`hn>^dn*ahn4`jr:`hr8^ho'
/** Decode voice `i` of the table at the currently sampled mode. */
const at = (i) => ((i = CH.charCodeAt(i)), (i >> 1) - 21 + (i & 1) * cb)

/**
 * ONE PIANO NOTE, at semitone `s`, from four voices:
 *   1. the fundamental — a triangle under a lowpass at 2.4x, so it keeps a
 *      trace of the third harmonic and nothing above it. Long decay.
 *   2. the 2nd partial, slightly sharp, decaying in HALF the time
 *   3. a 30 ms band-swept noise blip: the hammer
 * A 3rd partial used to sit between them. It was the quietest voice at 0.16
 * gain and the shortest at 0.26 decay, so it was the cheapest thing in the
 * instrument to lose: the strike is a shade less bright in its first 60 ms and
 * unchanged after that.
 * That inharmonic, faster-decaying partial stack is what makes an exponential
 * blip read as a struck string rather than a beep — the tone is bright for a
 * moment and then settles onto its fundamental, exactly like a real piano.
 * Gain and timing are jittered per note so no two strikes are identical.
 * The fundamental is scheduled FIRST, so under voice pressure the partials
 * are what get dropped and a note degrades instead of disappearing.
 */
const pia = (s, d, g, dl) => {
  const f = hz(s)
  g *= 0.72 + 0.5 * rnd()
  dl += rnd() * 0.02
  V(TRI, f, 0, d, g, 2.4, dl, 0.005)
  V(SIN, f * 2.004, 0, d * 0.5, g * 0.48, 2, dl, 0.004)
  V(NOISE, f * 5, f * 1.6, 0.03, g * 0.4, 1, dl)
}

/**
 * One eighth note, scheduled at absolute AudioContext time `t`. `i & 15` is
 * the position inside the current two-bar chord and `i >> 4 & 7` picks the
 * chord. The rhythm is deliberately sparse — this loops for a whole session,
 * and space is what stops it becoming fatiguing.
 */
const seq = (t, i) => {
  if (vc > 26) return // the piano always yields to gameplay cues
  const m = mS
  const k = i & 15
  const c = ((i >> 4) & 7) * 4
  const dl = t - now()
  const v = (j) => at(c + j)
  if (!k) {
    /* Sample the mode ONCE per chord, so a drifting mood can never leave a
       chord sounding halfway between minor and major. */
    cb = m > 0.55 ? 1 : 0
    /* Downbeat: bass, then the right hand rolled upward like a real wrist.
       The top voice only joins once you are not losing — that is the whole
       "fuller when winning, thinner when losing" difference in one line. */
    pia(v(0), 3.4, 0.05, dl)
    pia(v(1), 2.6, 0.026, dl + 0.03)
    pia(v(2), 2.6, 0.024, dl + 0.07)
    if (m > 0.45) pia(v(3), 2.4, 0.022, dl + 0.11)
  } else if (k == 8) {
    /* Second bar: the fifth under the same chord, and one inner voice.
       Two OFF-BEAT inner voices used to sit on k==4 and k==12 as well, mood-
       gated. They were the densest thing in the loop and the last of the music
       budget: the piece is sparser now, downbeat + second bar + melody, which
       is also the sparse-on-purpose direction the rhythm was already going. */
    pia(v(0) + 7, 2.8, 0.036, dl)
    pia(v(2), 2.2, 0.02, dl + 0.05)
  }
  /* The melody: chord tones an octave up, plus one colour tone a whole step
     over the top voice (a 9th or a 13th — consonant over every chord here,
     and taken UNBENT so the bright mode never sours it). The contour index
     steps by one or two, so the line wanders instead of arpeggiating, and it
     is never allowed on two consecutive eighths. */
  if (i - lastMel > 1 && rnd() < 0.09 + 0.24 * m) {
    lastMel = i
    mi = (mi + 1 + (rnd() < 0.45)) % 4
    pia(12 + v((mi % 3) + 1), 1.8, 0.034, dl)
  }
}

/* -------------------------------------------------------------- exports */

/**
 * Create or resume the AudioContext. Safe to call on EVERY user gesture,
 * repeatedly. Until this runs, nothing at all exists. Note there is nothing
 * to "start": the music is scheduled note by note from tickAudio, so the
 * graph is just master -> limiter -> destination and stays that way.
 */
export const initAudio = () => {
  try {
    if (A) return A.resume()
    A = new AudioContext()
    /* Limiter. knee/ratio/attack/release defaults are already what we want. */
    const lim = mk('DynamicsCompressor')
    lim.threshold.value = -12
    mst = mk('Gain')
    mst[CON](lim)[CON](A.destination)
    /* S.muted was restored by load() long before this gesture, so the very
       first thing the fader does is settle on the remembered state. */
    vol()
    /* THE shared noise buffer: half a second, looped by every noise voice. */
    const sr = A.sampleRate
    const b = (nz = A.createBuffer(1, sr >> 1, sr)).getChannelData(0)
    for (let i = b.length; i--; ) b[i] = rnd() * 2 - 1
  } catch {
    A = 0 // blocked or unsupported: the whole module stays a silent no-op
  }
}

/** One-shot cue. Unknown names are ignored; `v` is per cue, see CUES. */
export const sfx = (n, v) => {
  A && CUES[n]?.(v)
}

/** 0 = losing (dark) .. 0.5 even .. 1 = winning (bright). Feed it S.sky. */
export const setMood = (v) => {
  mood = cl(v, 0, 1)
}

/** Start/stop the piano. Safe (and remembered) before initAudio. */
export const music = (v) => {
  playing = !!v
}

/** Per frame: smooth the mood, then schedule ahead on the AudioContext clock. */
export const tickAudio = (dt) => {
  if (!A) return
  dt = cl(dt, 0, 0.1)
  mS += (mood - mS) * dt * 3 // dt is capped, so this can never overshoot
  if (!playing) return
  const t = now()
  if (!(nx > t)) nx = t + 0.05 // first note, or we fell behind: resync
  /* One eighth note. 52 bpm when you are losing, 70 when you are winning —
     a slow piece either way, and it never lurches because mS is smoothed. */
  const sl = 30 / (52 + 18 * mS)
  for (let n = 0; nx < t + AHEAD && n < 8; n++) {
    seq(nx, step++)
    nx += sl
  }
}

/** Flip mute, mirror it into S.muted, return the new value. */
export const toggleMute = () => {
  S.muted = S.muted ? 0 : 1
  vol()
  return S.muted
}

/** Clean slate for a new duel — keeps the context (and the gesture) alive. */
export const resetAudio = () => {
  mood = mS = 0.5
  step = nx = lastDraw = mi = 0
  lastMel = -9
}

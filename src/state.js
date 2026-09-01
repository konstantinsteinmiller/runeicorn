/**
 * SHARED CONTRACT — every module imports from here.
 *
 * ALL game state lives in ONE object: `unicorn_state` (exported also as `S`,
 * which is just a short alias for the same reference). Nothing else may hold
 * mutable game state. Persistence is a SINGLE localStorage key holding a tiny
 * subset of it (see `save`/`load`), so we never litter storage.
 *
 * COORDINATES
 *   Everything is laid out in a virtual 1280x720 stage. render.js computes one
 *   letterbox transform (`S.vx, S.vy, S.vs`) so every module can work in stage
 *   units and the game fits any viewport identically. Pointer coords are
 *   converted to stage space by main.js before anything sees them.
 *
 * ART DIRECTION (from the storyboard)
 *   Hand-drawn CEL SHADING: flat colour fills with thick black outlines, no
 *   gradients on characters. Two chibi unicorns on a floating mossy island —
 *   AURORA (white/gold, cute, heroic) on the left, UMBRA (matte black/purple,
 *   sleepy-menacing) on the right. The sky is the scoreboard: heavy grey storm
 *   while even, thinning toward a rainbow as you win, blackening to rain as you
 *   lose.
 */
import { sin, TAU, clamp } from './u.js'

/* ------------------------------ stage ------------------------------ */
export const SW = 1280
export const SH = 720
/** The transparent drawing box: the central third of the stage (GDD 3.2). */
export const BOX = { x: 470, y: 168, w: 340, h: 300 }

/* --------------------------- the duelists -------------------------- */
/** Ground line: the island rim in arena.js. The hooves stand here. */
export const GY = 508
/* The island spans x 326..954 (arena.js IX/IW) and the drawing box takes
   470..810, so the duelists live in the two strips left over. Any wider and
   they float off the rim; any narrower and they collide with the box. */
export const AX = 400 // Aurora, left
export const UX = 880 // Umbra, right
/** Horn tip, where spells are born — offset from the hooves. Measured from
    the rendered rig: Aurora's tip sits at (x+58, y-168), Umbra's (larger head)
    at (x-61, y-174); one symmetric pair covers both within a few units. */
export const HDX = 59
export const HDY = -170

/* ------------------------------ phases ----------------------------- */
export const PH_DUEL = 0
export const PH_WIN = 1
export const PH_LOSE = 2

/* ------------------------------ runes ------------------------------ */
/* id, name, glyph, colour — the four primitives of GDD 3.2. */
export const FIRE = 0
export const WIND = 1
export const ICE = 2
export const EARTH = 3
/* [base, light] per rune. The names used to live here too and nothing ever
   read them — every spell name the player sees comes from SPELLS. */
export const RUNES = [
  ['#ff5a2b', '#ffb066'],
  ['#8ff0ff', '#d9ffff'],
  ['#59b6ff', '#cfe9ff'],
  ['#b08050', '#e0c39a'],
]

/* --------------------------- spell matrix -------------------------- */
/**
 * Full GDD §4 matrix. Key = sorted rune ids joined, e.g. '0' , '00', '03'.
 * [name, kind, damage, extra]
 *   kind: 0 bolt (fast projectile) · 1 field (delayed area) · 2 barrier
 *         3 heavy (delayed, big) · 4 push
 *   extra: dot seconds / barrier seconds / slow seconds, per spell
 */
export const SPELLS = {
  0: ['FIRE BOLT', 0, 8, 0],
  '00': ['FIRE STORM', 1, 14, 3],
  '000': ['FIRE RAIN', 3, 30, 0],
  1: ['BOLT', 4, 5, 0],
  11: ['WIND WALL', 2, 0, 6],
  111: ['CYCLONE', 4, 16, 0],
  2: ['ICE BOLT', 0, 8, 0],
  22: ['PILLAR', 2, 0, 4],
  222: ['BLIZZARD', 1, 22, 3],
  3: ['EARTH WALL', 2, 0, 2],
  33: ['EARTH SHARD', 0, 16, 0],
  333: ['BOULDER', 3, 34, 0],
  '01': ['FIRE BALL', 0, 16, 0],
  '02': ['WET BALL', 0, 20, 2],
  '03': ['MAGMA SHARD', 0, 15, 2],
  12: ['FROST GALE', 1, 14, 3],
  13: ['SAND BLAST', 0, 13, 0],
  23: ['GLACIER', 3, 24, 0],
  '012': ['PRISM NOVA', 3, 32, 2],
  '013': ['ASH STORM', 1, 24, 3],
  '023': ['SHATTER', 3, 30, 0],
  123: ['TEMPEST', 1, 26, 3],
}
/* NOTE: every key must be reachable, i.e. at most MAX_RUNES long. The
   spellbook enumerates these keys, so a longer one would render a row no
   player could ever unlock. (A 4-rune 'RUNE-ICORN' lived here and did exactly
   that; GDD 4 lists no 4-rune combo either.) */
/** Fallback for any unlisted combination — never leave the player with nothing. */
export const WILD = ['WILD SURGE', 0, 11, 0]

export const MAX_RUNES = 3
export const HP_MAX = 100

/* ----------------------------- the ladder --------------------------- */
/**
 * CTR[e] is the rune that COUNTERS element e: fire melts ice, ice freezes
 * wind, wind erodes earth, earth smothers fire. One 4-cycle, so every themed
 * foe has exactly one element that hurts and one that barely scratches — the
 * whole exploit loop in four numbers.
 */
export const CTR = [3, 2, 0, 1]
/**
 * [name, element] up the ladder, one rung per win. Element -1 means NO
 * weakness: Umbra opens the game before the player knows elements exist, and
 * PRISM closes it with nothing to exploit, so the boss has to be out-played
 * rather than counter-picked. The index doubles as the AI tier (see `think`).
 */
export const FOES = [
  ['UMBRA', -1],
  ['EMBER', FIRE],
  ['ZEPHYR', WIND],
  ['GLACE', ICE],
  ['TERRA', EARTH],
  ['PRISM', -1],
]
/**
 * Damage scale for rune `r` against foe element `f`. The rune that counts is
 * the LAST one drawn — which is already the one that colours the projectile
 * and its impact, so the element the player sees flying is the element that
 * gets the bonus. Counting the most-repeated rune instead was both dearer and
 * a rule the screen never showed.
 */
export const elemMul = (r, f) => (f < 0 ? 1 : r === f ? 0.55 : CTR[f] === r ? 1.7 : 1)

/* ------------------------------ state ------------------------------ */
/**
 * THE single game-state object. Everything mutable lives here.
 * (Exported as both `unicorn_state` and the short alias `S`.)
 */
export const unicorn_state = {
  /* viewport + stage transform */
  w: 0,
  h: 0,
  dpr: 1,
  vx: 0, // stage->screen offset
  vy: 0,
  vs: 1, // stage->screen scale
  t: 0,
  dt: 0,

  /* flow */
  phase: PH_DUEL,
  over: 0, // seconds the end panel has been up
  book: 0, // spellbook modal open
  intro: 1, // onboarding still running
  introStep: 0, // which onboarding beat we are on
  introT: 0, // time on the current beat, so beat 1 can hand over to 2
  round: 1,

  /* duelists */
  hp: HP_MAX,
  ehp: HP_MAX,
  queue: [], // player rune ids, max MAX_RUNES
  equeue: [], // NPC rune ids
  eForm: 0, // 0..1 progress of the NPC's rune currently forming
  /* Which rune that is (0..3, or -1 before the first pick). Umbra commits to
     it up front so the player can READ her and counter — GDD 3.4 wants a
     ghostly outline of the real rune, not a question mark. */
  eRune: -1,
  eThink: 1.2, // NPC decision cooldown
  guard: 0, // player barrier seconds remaining
  eGuard: 0,
  /* Barrier flavour: 0 wind (stops projectiles) · 1 earth (stops everything)
     · 2 ice pillar (stops one projectile, then shatters). Derived from the
     combo's element in sim.js, so the matrix needs no extra column. */
  guardK: 0,
  eGuardK: 0,
  burn: 0, // player DOT seconds
  eBurn: 0,
  slow: 0,
  eSlow: 0,
  castAnim: 0, // player cast pose timer
  eCastAnim: 0,
  hurt: 0,
  eHurt: 0,

  /* drawing */
  draw: 0, // 1 while the pointer is down inside the box
  pts: [], // raw stroke in stage coords
  snap: null, // {rune, t} the clean rune flashing after a hit

  /* spells in flight */
  shots: [], // {x,y,vx,vy,rune,dmg,kind,extra,dir,life,delay}

  /* scoring / meta */
  foe: 0, // rung on the FOES ladder; also the NPC's AI tier
  coins: 0, // spent on element ranks, earned only by winning
  up: [0, 0, 0, 0], // per-element damage rank, +12% each
  wins: 0,
  losses: 0,
  best: 0, // fastest win, seconds
  dur: 0, // seconds this duel has run, for `best`
  /* Spellbook discovery: key -> 1. The four single-rune spells start KNOWN —
     they are the alphabet, not a secret, and a book that opens completely
     blank teaches the player nothing about what they are looking for. */
  seen: { 0: 1, 1: 1, 2: 1, 3: 1 },
  combo: 0, // runes in the last cast, for the DAMAGE! xN COMBO callout

  /* feel */
  shake: 0,
  flash: 0,
  sky: 0.5, // 0 = losing/black storm, 1 = winning/rainbow
  pops: [], // HUD callouts {s, c?, x?, y?}

  /* adaptive quality */
  q: 1,
  fdt: 0.016,
  muted: 0,
}
/** Short alias. Same object — never reassign either binding. */
export const S = unicorn_state

/* --------------------------- persistence --------------------------- */
/** ONE key. Only the handful of fields worth surviving a reload. */
const KEY = 'ru'
/* Every key here is QUOTED on purpose. The release build mangles property
   names, and an unquoted `w:` becomes whatever terser picks that run — so the
   save format would silently change shape on any edit and every player would
   lose their wins, best time and spellbook on update. Quoted keys are exempt
   from mangling, which pins the format. */
export const save = () => {
  try {
    localStorage[KEY] = JSON.stringify({
      'w': S.wins,
      'l': S.losses,
      'b': S.best,
      's': S.seen,
      'm': S.muted,
      'i': S.intro ? 0 : 1,
      'f': S.foe,
      'c': S.coins,
      'u': S.up,
    })
  } catch {
    /* storage blocked — the game simply does not remember */
  }
}
export const load = () => {
  try {
    const o = JSON.parse(localStorage[KEY])
    S.wins = o['w'] | 0
    S.losses = o['l'] | 0
    S.best = o['b'] || 0
    // Merge, so the four base runes stay known even for an older save.
    S.seen = { 0: 1, 1: 1, 2: 1, 3: 1, ...o['s'] }
    S.muted = o['m'] | 0
    S.intro = o['i'] ? 0 : 1
    // clamp: a save written before the ladder existed has no 'f', and a hand
    // -edited one must not index past the roster.
    S.foe = clamp(o['f'] | 0, 0, FOES.length - 1)
    S.coins = o['c'] | 0
    if (o['u']) S.up = o['u']
  } catch {
    /* first visit, or storage blocked */
  }
}

/* ----------------------------- helpers ----------------------------- */
export const rainbow = (v, l = 60, a = 1) =>
  `hsla(${(((v * 360) % 360) + 360) % 360},100%,${l}%,${a})`
export const pulse = (t, speed = 1) => 0.5 + 0.5 * sin(t * speed * TAU)
/** Look up the spell for a queue of rune ids. */
export const spellFor = (q) => SPELLS[[...q].sort().join('')] || WILD

export { TAU, clamp }

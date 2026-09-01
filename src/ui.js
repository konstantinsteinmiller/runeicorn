/**
 * UI — every piece of on-canvas chrome.
 *
 * HP bars, both rune queues, the drawing box, the CAST / spellbook / mute
 * buttons, the onboarding, the spellbook tome, the floating callouts and
 * the result panel. There is no DOM: everything here is drawn.
 *
 * COORDINATES — pure STAGE units (1280x720). render.js applies the single
 * letterbox transform, so this file never looks at the real viewport and the
 * pointer coords arriving at `uiHit`/`isUI`/`inBox` are already stage space.
 *
 * STYLE — cel shading: flat fills, thick ink outlines, no gradients. Every
 * light string is ink-stroked first so nothing floats bare on the scene, and
 * sizes are picked to stay legible when the stage is letterboxed onto a phone.
 *
 * `G` is the current context: the two entry points park it there so all the
 * internal helpers can stay one-liners.
 */
import {
  S,
  SPELLS,
  RUNES,
  BOX,
  SW,
  SH,
  PH_WIN,
  MAX_RUNES,
  HP_MAX,
  FOES,
  CTR,
  spellFor,
  pulse,
} from './state.js'
import { sin, cos, atan2, PI, TAU, clamp, damp } from './u.js'

/* palette — kept tiny on purpose, every colour earns its bytes */
const INK = '#0a0713' // outline on absolutely everything
const GOLD = '#ffd76a' // Aurora + accents
const PUR = '#c08cff' // Umbra
const DK = '#181130' // idle plate
const ACT = '#3b2a63' // live plate
const RED = '#ff8092' // damage / warning
const DIS = '#7a6f95' // disabled ink
const LAV = '#cfc4ff' // secondary copy
const BRN = '#4b2f1c' // tome cover + tome ink
const DIM = '#9b8a72' // tome: undiscovered
const F = 'px sans-serif' // generic on purpose: 'system-ui,' bought nothing visible

/* ------------------------------- layout -------------------------------- *
 * Only the INTERACTIVE rects are cached ([x, y, w, h]); the rest of the HUD
 * is drawn from constants. uiHit/isUI are pure lookups over these.        */
let cast, mute, book, shopR

export const layoutUI = () => {
  cast = [470, 596, 340, 80]
  // mute slides into the corner the tome vacates; folded at compile time
  mute = SPELLBOOK ? [1056, 610, 68, 62] : [1148, 602, 90, 74]
  if (SPELLBOOK) book = [1148, 600, 96, 76]
  // four element ranks, in a row across the result panel
  shopR = [0, 1, 2, 3].map((i) => [388 + i * 130, 316, 114, 78])
}
layoutUI()

/** Animated mirrors of state that must not pollute S. */
let ha = HP_MAX
let ea = HP_MAX
let G

/* --------------------------- canvas micro-DSL --------------------------- */
const bp = () => G.beginPath()
const mv = (x, y) => G.moveTo(x, y)
const ln = (x, y) => G.lineTo(x, y)
const sk = (w, c) => ((G.lineWidth = w), (G.strokeStyle = c), G.stroke())
const fi = (c) => ((G.fillStyle = c), G.fill())
const al = (a) => (G.globalAlpha = a)

/** Rounded-rect path (not roundRect: Safari 15 is in the build target). */
const rr = (x, y, w, h, r) => {
  bp()
  mv(x + r, y)
  G.arcTo(x + w, y, x + w, y + h, r)
  G.arcTo(x + w, y + h, x, y + h, r)
  G.arcTo(x, y + h, x, y, r)
  G.arcTo(x, y, x + w, y, r)
}

/** Chunky ink-outlined plate — the base of every piece of chrome. */
const panel = (x, y, w, h, r, f, lw) => {
  rr(x, y, w, h, r)
  fi(f)
  sk(lw || 5, INK)
}

/** One text run, ALWAYS ink-outlined for contrast. */
/**
 * `o` = outline colour; pass 0 for none. The dark halo exists so light copy
 * survives on top of the game world — over the tome's cream page it only
 * muddies dark ink, which is what made the spellbook so hard to read.
 */
const T = (s, x, y, z, c, a, o) => {
  G.font = '900 ' + z + F
  G.textAlign = a || 'center'
  G.textBaseline = 'middle'
  G.lineJoin = 'round'
  if (o !== 0) {
    G.strokeStyle = o || INK
    G.lineWidth = z * 0.28
    G.strokeText(s, x, y)
  }
  G.fillStyle = c || '#fff'
  G.fillText(s, x, y)
}

/** Button plate + optional pulsing "press me" ring. */
const btn = (r, f, glow) => {
  panel(r[0], r[1], r[2], r[3], 16, f)
  if (glow) {
    al(0.25 + 0.6 * glow)
    rr(r[0] - 5, r[1] - 5, r[2] + 10, r[3] + 10, 20)
    sk(4, GOLD)
    al(1)
  }
}

/** Full-screen dim + a big centred plate: spellbook and result share it. */
const modal = (x, y, w, h, f) => {
  G.fillStyle = '#06040cc4'
  G.fillRect(0, 0, SW, SH)
  panel(x, y, w, h, 28, f, 8)
}

/** HP bar. `gh` is the lagging ghost value, so damage drains as a red chunk. */
const bar = (x, v, gh, c, nm, rt) => {
  panel(x, 22, 366, 46, 23, '#1a1230')
  const seg = (val, col) => {
    const bw = 356 * clamp(val / HP_MAX, 0, 1)
    bw > 2 && (rr(rt ? x + 361 - bw : x + 5, 27, bw, 36, 18), fi(col))
  }
  seg(gh, '#ff4d63')
  seg(v, c)
  T(nm, rt ? x + 350 : x + 16, 46, 27, 0, rt ? 'right' : 'left')
}

/* ------------------------------- glyphs -------------------------------- */

/* Sides of each rune's polygon (WIND is the odd one out: two sine strokes).
 * ICE walks every 2nd vertex of a pentagon = a unicursal star, EARTH is a
 * 4-gon spun 45 degrees = a square. */
const SIDES = [3, 0, 3, 4] // segments per glyph; ICE's Z has three

/**
 * Draw one rune glyph, centred on x,y with radius r.
 * 0 = FIRE triangle · 1 = WIND double wave · 2 = ICE zig-zag Z ·
 * 3 = EARTH square.
 * `f` < 1 draws only that fraction of the outline (the onboarding traces the
 * triangle with it); returns the head of the stroke so a finger can ride it.
 */
export const drawGlyph = (g, k, x, y, r, a = 1, f = 1) => {
  G = g
  G.save()
  al(a)
  G.lineCap = G.lineJoin = 'round'
  bp()
  let p = [x, y]
  if (k == 1)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 13; i++)
        (i ? ln : mv)(
          x + (i / 6 - 1) * r,
          y + (j - 0.5) * r * 0.9 + sin((i / 12) * TAU) * r * 0.26
        )
  else {
    // ICE is an open Z, the others are closed polygons — same walk, different
    // vertex source, so one loop covers both.
    const z = k == 2
    const n = SIDES[k]
    const R = k == 3 ? r * 1.06 : r
    const e = n * f
    const V = (i) => {
      if (z) return [x + (i & 1 ? r : -r), y + (i < 2 ? -r : r) * 0.8]
      const A = (k == 3 ? PI / 4 : -PI / 2) + (i / n) * TAU
      return [x + cos(A) * R, y + sin(A) * R]
    }
    for (let i = 0; i <= e + 1; i++) {
      const u = i > e ? e : i
      const j = u | 0
      const m = u - j
      const a1 = V(j)
      const b1 = V(j + 1)
      p = [a1[0] + (b1[0] - a1[0]) * m, a1[1] + (b1[1] - a1[1]) * m]
      ;(i ? ln : mv)(p[0], p[1])
    }
  }
  sk(r * 0.52, INK)
  sk(r * 0.3, RUNES[k][0])
  G.restore()
  return p
}

/** One queue slot at x (the row sits at y 82). `fm` = NPC rune forming. */
const slot = (x, k, fm) => {
  const cx = x + 28
  panel(x, 82, 56, 56, 14, k == null ? DK + 'cc' : RUNES[k][0] + '2e', 4)
  if (k != null) drawGlyph(G, k, cx, 110, 17)
  else if (fm > 0) {
    /* ai.js may expose the rune being charged as S.eRune; if not, a sigil. */
    const a = 0.22 + 0.7 * fm
    if (S.eRune >= 0) drawGlyph(G, S.eRune, cx, 110, 17, a)
    else al(a), T('?', cx, 110, 32, PUR), al(1)
    bp()
    G.arc(cx, 110, 31, -PI / 2, -PI / 2 + TAU * fm)
    sk(5, PUR)
  }
}

/* --------------------------------- HUD --------------------------------- */

export const drawHud = (g, t) => {
  G = g
  const dt = S.dt || 0
  const q = S.queue.length
  /* the ghost value snaps up (heal / new duel) and lags down (damage chunk) */
  ha = S.hp > ha ? S.hp : damp(ha, S.hp, 5, dt)
  ea = S.ehp > ea ? S.ehp : damp(ea, S.ehp, 5, dt)

  g.save()
  bar(26, S.hp, ha, GOLD, 'AURORA', 0)
  bar(888, S.ehp, ea, PUR, FOES[S.foe][0], 1)
  /**
   * WHAT THIS FOE FEARS, spelled out under its own HP bar. A weakness the
   * player has to discover by elimination across a six-rung ladder is not a
   * mechanic, it is a guessing game — and the coat colour alone says which
   * element the foe IS, never which one beats it. So the counter-rune is drawn
   * as the glyph the player actually has to draw, next to the multiplier it
   * pays. Neutral rungs (Umbra, Prism) show nothing, which is itself the tell
   * that there is nothing to exploit.
   */
  const fe = FOES[S.foe][1]
  if (fe >= 0) {
    // Rune + multiplier, no label: a glyph beside "x1.7" under the enemy's own
    // bar already says "this element hits it harder", and the words were the
    // expensive half. Right-aligned to the bar, which ends at x 1254.
    al(0.55 + 0.25 * pulse(t, 0.6))
    drawGlyph(G, CTR[fe], 1180, 162, 13)
    T('x1.7', 1202, 162, 21, '#7dffa8', 'left')
    al(1)
  }
  for (let i = 0; i < MAX_RUNES; i++) {
    slot(32 + i * 64, S.queue[i], 0)
    slot(1192 - i * 64, S.equeue[i], i == S.equeue.length ? S.eForm : 0)
  }

  /* Until the first rune is stored, say plainly that the whole screen works. */
  if (!S.intro && !q) {
    al(0.34 + 0.16 * pulse(t, 0.5))
    T('DRAW A RUNE', 640, BOX.y - 26, 30, LAV)
    al(1)
  }

  /* CAST shows the resulting spell name, so combos teach themselves. */
  btn(cast, q ? ACT : DK, q && pulse(t, 0.9))
  T(q ? spellFor(S.queue)[0] : '[Space] Cast', 640, 638, 34, q ? 0 : DIS)

  /* spellbook (a closed tome), mute */
  if (SPELLBOOK) {
    btn(book, ACT)
    rr(1175, 622, 42, 32, 6)
    fi(BRN)
    sk(5, GOLD)
    bp()
    mv(1188, 624)
    ln(1188, 652)
    sk(4, GOLD)
  }
  btn(mute, DK)
  T('♪', SPELLBOOK ? 1090 : 1193, SPELLBOOK ? 641 : 639, 40, S.muted ? DIS : 0)
  g.restore()
}

/* ------------------------------ onboarding ----------------------------- */

const arrow = (x1, y1, x2, y2, t) => {
  const a = atan2(y2 - y1, x2 - x1)
  al(0.55 + 0.45 * pulse(t, 0.9))
  bp()
  mv(x1, y1)
  ln(x2, y2)
  for (const s of [2.5, -2.5]) mv(x2 + cos(a + s) * 26, y2 + sin(a + s) * 26), ln(x2, y2)
  sk(9, GOLD)
  al(1)
}

/**
 * SHOW, don't tell. Three short beats, none of which block play:
 *   0 — a ghost finger traces a glowing triangle inside the box, on a loop
 *   1 — an arrow flies from the box to the first queue slot
 *   2 — an arrow points at CAST
 * main.js owns S.introStep. There is no skip: the tutorial is three beats
 * long and ends itself on the first cast (see `launch`).
 */
const intro = (t) => {
  const s = S.introStep | 0
  const cx = BOX.x + BOX.w / 2
  if (s < 1) {
    const R = 78
    const cy = BOX.y + BOX.h / 2
    /* 0..1 traced, then a short beat of held shape before the loop restarts */
    drawGlyph(G, 0, cx, cy, R, 0.16)
    const p = drawGlyph(G, 0, cx, cy, R, 1, clamp(((t * 0.45) % 1.3) * 1.18, 0, 1))
    bp()
    G.arc(p[0], p[1], 14, 0, TAU)
    fi('#fff')
    sk(4, INK)
    T('DRAW THE RUNE', cx, BOX.y - 30, 36, GOLD)
  } else if (s < 2) {
    T('STORED! UP TO 3', cx, BOX.y - 30, 34, GOLD)
  } else {
    arrow(cx, 524, 640, 582, t)
    T('NOW CAST IT', cx, 490, 36, GOLD)
  }
}

/* -------------------------------- popups ------------------------------- */

/** Floating callouts from S.pops — ui.js owns their ageing (key `a`). */
const popups = (dt) => {
  for (let i = S.pops.length; i--; ) {
    const p = S.pops[i]
    const k = (p.a = (p.a || 0) + dt) / 1.3
    if (k > 1) {
      S.pops.splice(i, 1)
      continue
    }
    G.save()
    al(k > 0.72 ? (1 - k) / 0.28 : 1)
    G.translate(p.x || 640, (p.y || 300) - 84 * k)
    const z = 1.4 - k * 0.4
    G.scale(z, z)
    T(p.s, 0, 0, 46, p.c || GOLD)
    G.restore()
  }
}

/* ------------------------------- spellbook ----------------------------- */

/* singles, then pairs, then triples, then the full rainbow — a readable page */
const KEYS = Object.keys(SPELLS).sort((a, b) => a.length - b.length)

const spellbook = () => {
  modal(110, 48, 1060, 624, BRN)
  panel(126, 64, 1028, 592, 16, '#f2e3c0')
  // Ink on paper: no halo, near-black for found spells, soft grey for unfound.
  T('SPELLBOOK', 640, 106, 40, '#2a1608', 0, 0)
  KEYS.map((k, i) => {
    const x = 152 + (i % 3) * 340
    const y = 164 + ((i / 3) | 0) * 60
    if (S.seen[k]) {
      for (let j = 0; j < k.length; j++) drawGlyph(G, +k[j], x + j * 28, y, 12)
      T(SPELLS[k][0], x + 118, y, 24, '#2a1608', 'left', 0)
    } else T('? ? ?', x - 12, y, 26, '#b3a184', 'left', 0)
  })
  T('✕', 1110, 104, 34, GOLD)
}

/* ------------------------------ result panel --------------------------- */

/**
 * Result panel AND the whole shop. There is no separate screen and no level
 * select: the ladder walks itself, and the one moment the player has coins
 * they did not have before is the moment a duel ends — so that is where the
 * ranks are bought. A plate lights up only when its rank is affordable, which
 * is the entire affordance; anywhere else on the panel starts the next duel.
 */
const endPanel = (t) => {
  const w = S.phase == PH_WIN
  modal(340, 196, 600, 306, '#1a1230')
  T(w ? 'VICTORY!' : 'DEFEATED', 640, 262, 52, w ? GOLD : RED)
  shopR.map((r, i) => {
    const c = 10 * (S.up[i] + 1)
    const ok = S.coins >= c
    panel(r[0], r[1], r[2], r[3], 14, ok ? ACT : DK)
    drawGlyph(G, i, r[0] + 30, r[1] + 39, 14, ok ? 1 : 0.4)
    T('+' + S.up[i] * 12 + '%', r[0] + 76, r[1] + 40, 21, ok ? '#fff' : DIS, 0, 0)
  })
  if (S.over > 0.5) {
    al(0.5 + 0.5 * pulse(t, 0.7))
    T('Tap to duel', 640, 452, 26)
    al(1)
  }
}

/* ------------------------------- overlays ------------------------------ */

export const drawOverlays = (g, t) => {
  G = g
  const dt = S.dt || 0
  g.save()
  if (S.intro && !S.book && !S.phase) intro(t)
  popups(dt)
  if (SPELLBOOK && S.book) spellbook()
  if (S.phase) endPanel(t)
  g.restore()
}

/* ------------------------------ hit testing ---------------------------- */

const inR = (r, x, y) => x > r[0] && y > r[1] && x < r[0] + r[2] && y < r[1] + r[3]

/**
 * ACTION CODES, not names. This is a private protocol between uiHit and act —
 * no value here ever reaches a player, a save file or an SDK, so there is
 * nothing to gain from it being readable at runtime and a string per hit-test
 * to lose. 0 = nothing hit, which `act` already treats as "not a UI press".
 *   1 cast · 2 open book · 3 close book · 4 duel again · 5..8 element ranks
 *   9 mute
 */
export const uiHit = (x, y) => {
  if (S.phase) {
    // Rank plates win over "tap to duel on", or the shop would be unreachable:
    // the whole panel is the restart button.
    const i = shopR.findIndex((r) => inR(r, x, y))
    return i >= 0 ? 5 + i : S.over > 0.4 ? 4 : 0
  }
  return hitPlay(x, y)
}

const hitPlay = (x, y) =>
  SPELLBOOK && S.book ? 3 : inR(cast, x, y) ? 1 : SPELLBOOK && inR(book, x, y) ? 2 : inR(mute, x, y) ? 9 : 0

/**
 * True for anything the game must not treat as a drawing stroke — i.e. real
 * interactive targets only. The HP bars and rune slots are display-only, so
 * they deliberately do NOT block: reserving that whole top band made strokes
 * started up there vanish, which reads as "the press didn't register".
 */
export const isUI = (x, y) => !!uiHit(x, y) || !!(SPELLBOOK && S.book) || !!S.phase

export const inBox = (x, y) => x > BOX.x && y > BOX.y && x < BOX.x + BOX.w && y < BOX.y + BOX.h

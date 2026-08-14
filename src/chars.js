/**
 * chars.js — AURORA and UMBRA, the two chibi duelists.
 *
 * Two ideas do all the work of making these read as drawn characters rather
 * than stacked primitives:
 *
 *  1. SILHOUETTE-FIRST INKING. Every compound mass (torso + neck, skull +
 *     muzzle, ear, horn) is drawn in two passes — first the whole group is
 *     STROKED with one very heavy line, then every part is FILLED on top. The
 *     fills swallow the inner half of those strokes, so what survives is a
 *     single continuous outline around the union and no seams where the parts
 *     overlap. Interior features then get hairlines, which is where the varied
 *     line weight comes from.
 *  2. THREE-BAND CEL SOLIDS (`blob`). Each form is clipped to itself and given
 *     a bounce/rim light, a core shadow and a lit coat, all hard-edged, offset
 *     towards a key light that is up-and-forward. Volume, no gradients.
 *
 * The legs are REAL EQUINE LEGS, not two-bone doll limbs: three segments and a
 * hoof, with the fore KNEE and the hind HOCK folding backward while the STIFLE
 * above the hock swings forward. See `FORE`/`HIND` and `limb`.
 *
 * They are built off published horse measurements rather than by eye, because
 * the three things that make a drawn horse leg wrong are all measurable. Joint
 * heights are set as fractions of withers height H: fetlock .12, knee .31 and
 * hock .34 (a LEVEL PAIR — this is what reads, not either one alone), elbow
 * .53 and stifle .50 (also level), hip .72. The standing foreleg is a straight
 * weight-bearing COLUMN, not a zig-zag: the measured carpal angle is 171-177
 * degrees, so `FORE` is solved to hang plumb and the only real angle below the
 * shoulder is the pastern, ~32 degrees forward. The hind leg is the opposite
 * and must never match it — femur forward to the stifle, gaskin back to the
 * hock, cannon plumb again. Overdo that zig and the horse reads as sitting
 * down, which is exactly what an earlier `HIND` did by throwing the hock twice
 * as far back as anatomy allows. Each limb then TAPERS the whole way down,
 * because a horse carries muscle above the knee and nothing but tendon below
 * it; a limb drawn at one width is what makes a cartoon horse look like a
 * table with four dowels nailed to it.
 *
 * STANCE is what actually reads at a glance, and it is all in the numbers. The
 * forelegs plant under the CHEST (hooves at x 18 / 25) and the hinds under the
 * HAUNCH (x -35 / -27), so the gap BETWEEN the two pairs (~45) is five times
 * the near/far offset WITHIN one (~8) and the eye sees a pair of feet at each
 * end instead of one cluster in the middle. The barrel then rides high enough
 * (`by`) that the belly line clears the ground by ~50 — that daylight is what
 * separates a standing pony from a squatting one. Chibi is big-headed, not
 * legless.
 *
 * The rig is authored FACING +X in a local space whose origin is where the
 * HOOVES MEET THE GROUND (canvas y grows downward, so the body lives at
 * negative y). Umbra is the same rig mirrored, stockier, bigger-headed and a
 * little shorter. RASTERISED extents in stage units (ink included, alpha > 24),
 * relative to that origin, Aurora / Umbra:
 *   standing   131 x 197 / 133 x 190   (tail ~64 back, muzzle ~66 fore)
 *   reared     139 x 223 / 139 x 221   (leans back over the planted hinds)
 *   collapsed  167 x 114 / 166 x 115   (lies forward of the origin)
 * The taller legs cost no WIDTH: the standing and low-HP extents are unchanged
 * to the pixel, and rear/win grew only BACKWARD, away from the guide box.
 * Nothing but the contact shadow ever crosses the ground line (max y = +4 in
 * every live pose), and the hind hooves do not SLIDE through the cast wind-up:
 * their goal is a constant, so the measured centroid wanders under 1.7 units
 * horizontally from cast 0 to 1 (it was 6.9 when the four hooves overlapped).
 * It rises ~4 with the rest of the rig, which is the deliberate rear lift and
 * not the leg solving differently. At x=400 / x=880 that keeps both clear of
 * the central drawing box (x 470..810) in every live pose; only the low-HP head
 * droop (~4px) and the game-over collapse reach into it, as before.
 *
 * No Math.random() in any draw path: every wobble is derived from `t`, so the
 * characters never shimmer and a paused game freezes into a stable pose.
 * S.q === 0 drops the cel bands, the limb/neck shade stripes, the aura and all
 * but the hero hair lock; silhouette, proportions and poses are unchanged. The
 * limb bounce rim is NOT a detail flourish and survives every quality level —
 * without it Umbra's four black legs fuse into one unreadable mass.
 */
import { S, FOES, RUNES, rainbow } from './state.js'
import { TAU, PI, clamp, sin, cos, atan2, hypot, min, max, abs } from './u.js'

/** The one hand-inked outline colour. */
const OUT = '#150f1c'
/** Nominal standing height, hooves -> horn tip, in stage units. */
const HT = 197
/** Torso masses as [cx, cy, rx, ry] quads: haunch, barrel, chest. */
const TQ = [-23, 6, 18, 21, -2, 0, 29, 27, 19, 3, 14.5, 18]

/** [coat, shadow, rim, mane, streak, horn, hoof, eye, glow, blush] */
const PAL = [
  // AURORA — cream coat, warm shadow, pearl rim, gold mane w/ pastel locks
  ['#fec', '#eba', '#fff', '#fc3', '#fe9', '#fd6', '#c94', '#423', '#fe9', '#f9a'],
  // UMBRA — matte black coat, violet bounce rim, purple mane w/ neon cyan
  ['#213', '#102', '#74c', '#84d', '#7ff', '#a5f', '#539', '#7ff', '#b7f', '#639'],
]

/** Draw context + clock + the active palette, cached so helpers stay terse. */
let g, T, AM, CO, SH, RM, MA, MH, HO, HF, EY, GL, BL

/* ------------------------------ helpers ----------------------------- */

/** Fill the current path flat, then ink an outline of width `w` around it. */
const ink = (f, w) => {
  if (f) {
    g.fillStyle = f
    g.fill()
  }
  if (w) {
    g.lineWidth = w
    g.stroke()
  }
}

/** Path through a flat [x,y,...] list; `c` closes it. */
const poly = (p, c) => {
  g.beginPath()
  g.moveTo(p[0], p[1])
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1])
  if (c) g.closePath()
}

/** Ellipse path. Radii are clamped positive so no pose can throw. */
const el = (x, y, rx, ry, a) => {
  g.beginPath()
  g.ellipse(x, y, max(0.1, rx), max(0.1, ry), a || 0, 0, TAU)
}

/**
 * A DIMENSIONAL form — the workhorse. Key light is up-and-forward (+x, -y),
 * so we clip to the silhouette and lay three hard-edged bands inside it:
 * bounce rim (the whole shape), core shadow (nudged towards the light) and
 * the lit coat (nudged further). The result is a crescent shadow hugging the
 * lower-back edge with a bright bounce line outside it — the cel look, with
 * none of the mush of a gradient. No outline: every caller has already laid
 * its group down as one continuous silhouette line.
 */
const blob = (x, y, rx, ry) => {
  el(x, y, rx, ry)
  if (S.q) {
    g.save()
    g.clip()
    ink(RM)
    el(x + rx * 0.08, y - ry * 0.08, rx, ry)
    ink(SH)
    el(x + rx * 0.34, y - ry * 0.32, rx, ry)
    ink(CO)
    g.restore()
  } else ink(CO)
}

/**
 * ONE PASS of a TAPERED tube: stroke every segment of the flat [x,y,...]
 * polyline `p` separately, each at the mean of its two nodes' half-widths in
 * `hw`, offset by `d` and optionally scaled by `k`. Round caps and joins are
 * already set on the context, so each segment ends in a disc — which lands the
 * three things a drawn leg needs for free: the joint swellings a real limb
 * has, a rounded root that will not lay a hard seam across the ribs, and a
 * fold that survives a tucked foreleg instead of chamfering into a plank.
 *
 * The taper is the most anatomical thing in the rig. A horse's leg is MUSCLE
 * at the top and TENDON at the bottom — the forearm runs about twice the width
 * of the cannon hanging under it, and carries no muscle at all below the knee
 * — so a limb drawn at ONE width is the single thing that makes a cartoon
 * horse read as a table with four dowels nailed to it. Necks taper for the
 * same reason: thick off the shoulder, slim at the poll.
 *
 * Whole-pass-at-a-time is the load-bearing part. Ink EVERY segment, then rim
 * every segment, then coat every segment: stroking one segment start-to-finish
 * before the next puts the second segment's outline on top of the first
 * segment's fill, which is the notch that used to band the leg like a sock.
 */
const tube = (p, hw, d, f, k) => {
  g.strokeStyle = f
  for (let i = 1; i < hw.length; i++) {
    poly([p[i * 2 - 2], p[i * 2 - 1], p[i * 2], p[i * 2 + 1]])
    ink(0, (hw[i] + hw[i - 1]) * (k || 1) + d)
  }
  g.strokeStyle = OUT
}

/**
 * Ink and cel-shade a tapered tube: a heavy outline, a BOUNCE RIM surviving as
 * a hairline just inside it — the only reason Umbra's four black legs do not
 * fuse into one dark mass — the coat inset within that, and a shadow stripe
 * down the lower-back side so a limb is a cylinder rather than a stick. The
 * stripe is nudged by a FRACTION OF THE LOCAL half-width (`i >> 1` maps both
 * the x and the y of a node onto that node's own width), so it stays inside
 * the coat on the wire-thin cannon and the fat thigh alike — a fixed offset
 * would slide straight out of the cannon's edge.
 */
const meat = (p, hw, col) => {
  tube(p, hw, 8.4, OUT)
  tube(p, hw, 0, RM)
  tube(p, hw, -3, col)
  if (S.q) tube(p.map((v, i) => v + hw[i >> 1] * (i & 1 ? 0.2 : -0.18)), hw, 0, SH, 0.4)
}

/**
 * The two leg rigs, packed as [a0..a3 | l0..l3 | k0..k3] — see `limb`.
 * Absolute joint angles, then segment lengths, then the flex each joint takes
 * per unit of curl. PI/2 (1.571) = straight down, SMALLER = leaning forward.
 *
 * The four lengths sum to ~63, a hair under the shoulder/hip height, so every
 * standing limb solves at a stretch of ~1.0: the chain is drawn as authored and
 * nothing is squashed to reach the floor.
 *
 * FORE  humerus back off the shoulder, forearm forward again to the KNEE
 *       (carpus) at just over half leg height, long cannon almost plumb, then a
 *       SHORT pastern into the hoof. The whole run wanders barely 5 units off
 *       the vertical — a COLUMN with a hint of zig, which is what a standing
 *       horse's front leg is and what stops the pose reading as a kneel. Keep
 *       the pastern short: a long one throws the hoof out in front of the
 *       cannon and the leg turns into a propped stick. Curling folds the knee
 *       BACKWARD (k2 positive) while the two upper bones swing forward — the
 *       tucked foreleg of a rearing horse.
 * HIND  femur throws forward to the STIFLE, high and tight against the belly;
 *       the long gaskin runs back down to the HOCK, which is therefore the
 *       sharp rearward point of the silhouette — 17 units of horizontal
 *       excursion between the two, and the hock ends up BEHIND the hoof; then
 *       cannon and fetlock come forward again. That forward / back / forward
 *       run is the equine "Z" and the single most recognisable thing about a
 *       horse — the hind leg zig-zags where the foreleg drops straight, and the
 *       two must never match.
 * Because these are RELATIVE angles the whole scheme survives every pose: no
 * solver can flip a joint the wrong way, because no joint is ever solved.
 */
const FORE = [1.73, 1.62, 1.57, 1.01, 17, 22, 17.5, 7, -1, -0.5, 0.85, 1.3, 9.5, 9.6, 7.2, 6, 5.4]
const HIND = [1, 2.38, 1.57, 1.14, 24, 21, 20, 7, -0.5, -1.4, 1.9, 0.5, 11.8, 11.4, 7.4, 6.2, 5]

/**
 * ONE leg, built by FORWARD KINEMATICS from the joint angles above rather than
 * by an IK solve, because the entire point is that the joints bend in FIXED,
 * OPPOSITE directions — a solver would happily flip them. `c` curls the whole
 * chain (tuck for a rear, fold for a collapse) by adding each joint's k.
 *
 * The finished chain is then aimed RIGIDLY: the leg rotates about its root and
 * stretches a little so the hoof lands on (fx,fy). Relative joint angles are
 * untouched, so the anatomy holds — and the hind hooves stay nailed down while
 * the body rears back over them, which is the whole reason for the goal.
 *
 * ONE continuous tapered run, not two capsules: the leg narrows from the
 * muscle at the top to the tendon at the bottom across all four segments, so
 * the eye reads a limb rather than a fat sausage butted against a thin stick.
 * The feathered fetlock is inked and filled first and then buried under it, so
 * only its fluffy edge breaks the line instead of banding the leg like a sock.
 * The feather must stay NARROWER than the hoof: any wider and the two merge
 * into a pancake at the bottom of the leg, which is exactly what a planted
 * foot must not look like.
 */
const limb = (hx, hy, fx, fy, c, P, col) => {
  let Q = [0, 0]
  let x = 0
  let y = 0
  for (let i = 0; i < 4; i++) {
    const a = P[i] + c * P[i + 8]
    Q.push((x += cos(a) * P[i + 4]), (y += sin(a) * P[i + 4]))
  }
  // stretch the CHAIN, not the context: ink weights stay in stage units
  const s = clamp(hypot(fx - hx, fy - hy) / (hypot(x, y) || 1), 0.6, 1.3)
  Q = Q.map((v) => v * s)
  const rt = atan2(fy - hy, fx - hx) - atan2(y, x)
  g.save()
  g.translate(hx, hy)
  g.rotate(rt)
  // The chain is drawn in a frame rotated by `rt`, so GROUND LEVEL inside it
  // runs along (cos rt, -sin rt) and straight down is (sin rt, cos rt). The
  // hoof is the one part that has to know: everything else in a leg follows
  // the bone, but a sole answers to the floor.
  const rc = cos(rt)
  const rs = sin(rt)
  const pa = P[3] + c * P[11] // pastern direction: aims the feather and the hoof
  const px = cos(pa)
  const py = sin(pa)
  const w = P[16] // the tip half-width: one number sizes the whole foot
  el(Q[6], Q[7], w * 0.95, 8, pa) // feathered fetlock, buried under the cannon
  ink(0, 7)
  ink(col)
  meat(Q, P.slice(12), col) // the entire leg as ONE tapered run, no seams
  // The hoof: a WALL that leans with the pastern onto a SOLE that lies FLAT ON
  // THE GROUND. Those are two different directions and using one for both is
  // what put the animal on the back edge of its feet — square the sole to the
  // pastern and a 32-degree pastern tips the whole foot 32 degrees, so it
  // stands on its heels with the toes in the air. So: the coronet rides UP THE
  // BONE (`px,py`) while both rims run along the FLOOR (`rc,-rs`), which is
  // also what makes the wall slope forward to the toe the way a real one does.
  // An explicit trapezoid, and it earns the bytes: a stroke flares nothing,
  // and a round cap would dome the one edge that has to stay dead flat.
  // Sizing it all off P[16] buys the fore/hind tell for free — the front foot
  // rounder and wider, the hind narrower.
  const ax = Q[8] - px * 2
  const ay = Q[9] - py * 2
  const bx = Q[8] + rs * 6
  const cy = Q[9] + rc * 6
  const v = w * 1.7
  poly([ax - rc * w, ay + rs * w, ax + rc * w, ay - rs * w, bx + rc * v, cy - rs * v, bx - rc * v, cy + rs * v], 1)
  ink(0, 6)
  ink(HF)
  g.restore()
}

/**
 * A hair MASS: `n` overlapping LOCKS in alternating tones, splayed to either
 * side of the hero lock, each shorter and a beat out of phase. That is what
 * turns a single flat ribbon into a layered silhouette with readable strands —
 * and where the pastel (Aurora) / neon cyan (Umbra) streaking comes from.
 * Drawn back-to-front so the full-length hero lock, with the heaviest line,
 * lands on top.
 *
 * Each lock is a tapered strip whose spine carries a travelling wave (`AM` is
 * the shared amplitude, set per pose). The wave's phase shifts along the
 * length, so the tip lags the root — that is the "hair follows the body" read,
 * with zero stored state. The taper is gentle, so tips stay soft and fat
 * rather than becoming spikes.
 */
const hair = (x, y, a, len, w, sp, curl, n) => {
  for (let i = S.q ? n : 1; i--; ) {
    const L = []
    const R = []
    let px = x - i * 3
    let py = y + i * 4
    for (let j = 0; j <= 6; j++) {
      const f = j / 6
      const aa =
        a + (i & 1 ? 0.34 : -0.38) * i + (curl + i * 0.16) * f + AM * sin(T * (sp + i * 0.5) - f * 3.6) * (0.25 + f)
      const hw = w * (1 - i * 0.22) * (1 - f * f * 0.6) * 0.5
      const nx = sin(aa) * hw
      const ny = cos(aa) * hw
      L.push(px - nx, py + ny)
      R.unshift(px + nx, py - ny) // unshift = the return edge, already reversed
      px += (cos(aa) * len * (1 - i * 0.26)) / 6
      py += (sin(aa) * len * (1 - i * 0.26)) / 6
    }
    poly([...L, ...R], 1)
    ink(i & 1 ? MH : MA, i ? 2.2 : w / 6)
  }
}

/** A short twitch: rises to 1 for a beat once every 1/sp seconds. */
const twitch = (t, sp, ph, sharp) => clamp(1 - abs(((t * sp + ph) % 1) - 0.03) * sharp, 0, 1)

/** One pointed ear: heavy silhouette, flat fill, then a soft inner shell. */
const ear = (x, y, a, s, col) => {
  g.save()
  g.translate(x, y)
  g.rotate(a)
  poly([-9 * s, 5 * s, -3 * s, -18 * s, 10 * s, -1 * s], 1)
  ink(0, 11)
  ink(col)
  poly([-4.5 * s, 2 * s, -2 * s, -11 * s, 4.5 * s, -1 * s], 1)
  ink(col === CO ? BL : SH)
  g.restore()
}

/* ------------------------------ the rig ----------------------------- */

/**
 * Draw a duelist in STAGE coordinates (the caller has applied the stage
 * transform; we work in the 1280x720 space from state.js).
 *   ctx    canvas 2d context
 *   x, y   ground position — the HOOVES stand here
 *   side   -1 = Aurora facing right, +1 = Umbra facing left
 *   st     { cast, hurt, hp, win, lose, form }
 *   t      S.t seconds
 */
export function drawUnicorn(ctx, x, y, side, st, t) {
  g = ctx
  T = t

  /* ---- pose scalars: everything below is a smooth blend of these ---- */
  const win = clamp(st.win || 0, 0, 1)
  const lose = clamp(st.lose || 0, 0, 1)
  // A win is a full rear (storyboard panel 8); a collapse cancels both.
  const rear = clamp((st.cast || 0) + win, 0, 1) * (1 - lose)
  const form = clamp(st.form || 0, 0, 1)
  const hit = clamp((st.hurt || 0) * 4, 0, 1)
  const sag = (1 - clamp(st.hp >= 0 ? st.hp : 1, 0, 1)) * (1 - rear) // posture drops with HP
  const fold = lose * 30 // limbs curl up under the body when collapsed
  const D = side > 0 ? 1 : 0 // 1 = Umbra

  ;[CO, SH, RM, MA, MH, HO, HF, EY, GL, BL] = PAL[D]
  // Each rung of the ladder wears its element. Only the MANE, HORN and AURA
  // are re-tinted, off the rune palette that already exists — the black coat
  // and the violet rim stay put, so the foe still reads as the same species
  // and the same threat, recoloured. Generating from RUNES rather than storing
  // six more palettes is what keeps a whole roster inside a handful of bytes.
  if (D) {
    // `D &&` would NOT do here: it yields 0 for Aurora, which passes `>= 0`
    // and paints the hero in fire.
    const fe = FOES[S.foe][1]
    const rb = rainbow(t * 0.14)
    const rl = rainbow(t * 0.14 + 0.12, 80)
    // PRISM shares Umbra's "no element", so without the second branch the last
    // rung of the ladder wears the palette of the first and the boss reads as
    // the tutorial. It cycles instead — every element and none, which is also
    // the reason it has no weakness to counter-pick.
    if (fe >= 0) [MA, MH, GL, HO] = [RUNES[fe][0], RUNES[fe][1], RUNES[fe][0], RUNES[fe][1]]
    else if (S.foe) [MA, MH, GL, HO] = [rb, rl, rb, rl]
  }
  // Hit flash: strobe the whole coat white/red while `hurt` runs down.
  const F = hit && sin(t * 46) > 0 ? (sin(t * 23) > 0 ? '#fff' : '#f55') : 0
  if (F) CO = SH = RM = MA = MH = HO = HF = BL = F // the eye stays readable

  const K = 1 + D * 0.07 // Umbra is a touch stockier...
  const HK = 1.18 + D * 0.06 // ...with a bigger head on a shorter neck
  const br = sin(t * 2.1 + side) * (1 - rear * 0.7) // breathing
  const by = -76 + br * 1.5 + sag * 8 // barrel centre
  // blink + ear flick: short twitches on slow cycles, out of phase per side
  const ph = side * 0.25 + 0.5
  const bl = twitch(t, 0.21, ph, 40)
  const fk = twitch(t, 0.33, ph, 26) * sin(t * 30) * 0.4
  AM = 0.26 + rear * 0.38 + hit * 0.5 // shared mane/tail wave amplitude

  g.save()
  g.translate(x + hit * 9 * side, y - 6) // recoil away from the caster
  g.scale(-side, 1) // authored facing +x; Umbra is the mirror
  g.lineJoin = g.lineCap = 'round'
  g.strokeStyle = OUT

  // Contact shadow — grounds the character instead of letting it float.
  g.globalAlpha = 0.25
  g.fillStyle = OUT
  el(0, 3, 42 + lose * 22, 8)
  g.fill()
  g.globalAlpha = 1

  // collapsed on its side (storyboard panel 8) — the whole rig tips over and
  // the neck folds (see hx/hy below) so the head comes to rest on the ground
  if (lose) {
    g.translate(-45 * lose, -16 * lose)
    g.rotate(1.15 * lose)
  }
  g.translate(0, -rear * 4 - win * abs(sin(t * 3.4)) * 5) // victory hop

  // Umbra's dread aura: stacked low-alpha ellipses, no shadowBlur needed.
  if (D && S.q && !F) {
    g.globalAlpha = 0.07
    g.fillStyle = GL
    el(-2, by - 6, 54, 52)
    g.fill()
    g.globalAlpha = 1
  }

  /* ---- rearing frame: the body pivots over the planted hind hooves --- */
  // The pivot (-22,-6) sits between the two hind hooves and just off the floor,
  // and the hip is the one point DIRECTLY ABOVE it — so the hip is simply the
  // pivot plus a rotated (0, by+22) and needs no second offset term.
  const R = -0.58 * rear
  const rc = cos(R)
  const rs = sin(R)
  const hipx = -22 - (by + 22) * rs
  const hipy = -6 + (by + 22) * rc

  // far hind leg — drawn in the standing frame, the hooves stay planted.
  // Far limbs take the shadow tone whole, so they read as behind the body.
  limb(hipx, hipy, -35 + fold, -fold, lose, HIND, SH)

  g.save()
  g.translate(-22, -6)
  g.rotate(R)
  g.translate(22, 6)

  /* ---- forelegs: ground -> tucked (rear) -> flung open (win) -------- */
  const pad = sin(t * 3) * 3 * rear // paddling while reared up
  const rr = rear * rear // eased lift: the hooves stay planted through the wind-up
  // curl: a rear folds the knee right up, a win throws the same leg out again
  const tk = rr * (win ? 0.75 : 1.15) + lose
  // The pair differs only in root, reach and which way the paddle swings, so
  // one closure serves both — they are drawn either side of the torso, which
  // is the only reason this is not simply a loop.
  const fl = (x, a, b, s, col) =>
    limb(x, by + 14, x + a * rear - fold * 0.5, -b * rr - fold + s * pad, tk, FORE, col)
  fl(18, win ? 36 : 15, win ? 30 : 22, -1, SH)

  /* ---- tail: a layered hair mass that hangs and trails --------------- */
  hair(-26, by - 4, 2.4 + 0.4 * rear, 56, 30, 1.7, -0.7, 3)

  /* ---- torso + neck: ONE silhouette, then the shaded fills ----------- */
  const hx = 22 + sag * 3 - lose * 14 // the neck folds as it goes down
  const hy = by - 42 + D * 7 + sag * 9 - rear * 3 + fold
  const nk = [11, by - 6, hx - 4, hy + 14]
  const NW = [16 * K, 11.5 * K] // thick off the shoulder, slim at the poll
  // resolve TQ: [cx*K, by+cy, rx*K, (ry+breath)*K]
  const TR = TQ.map((v, i) => (i & 1 ? (i & 2 ? (v + br * 0.5) * K : by + v) : v * K))
  const each = (fn) => {
    for (let i = 0; i < 12; i += 4) fn(TR[i], TR[i + 1], TR[i + 2], TR[i + 3])
  }
  tube(nk, NW, 13, OUT)
  each((a, b, c, d) => {
    el(a, b, c, d)
    ink(0, 13)
  })
  meat(nk, NW, CO) // its own line merges into the silhouette above
  each(blob)

  /* ---- fluffy chest tuft: a silhouette-defining scallop ------------- */
  for (let i = 3; i--; ) {
    el(31 + i * 0.5, by + 15 - i * 6, 7.5 - i * 1.4, 6.5 - i * 1.2)
    ink(CO, 2.4)
  }

  // mane down the back of the neck, rooted at the poll, behind the head
  hair(hx - 21, hy - 4, 2.6 - 0.25 * rear, 46, 27, 2.1, -0.5, 3)

  g.save()
  g.translate(hx, hy)
  // The body rears by -0.58, so the head counter-rotates: in world space it
  // still ends up tilted up ~0.3 rad, with the horn aimed up-and-forward.
  g.rotate(0.28 * rear + sag * 0.3 - lose * 0.5 + br * 0.02)
  g.scale(HK, HK)

  ear(-14, -13, -0.7, 0.85, SH) // far ear
  el(20, 10, 12.5, 10.5) // skull + muzzle inked as one mass, then filled
  ink(0, 11)
  el(0, 0, 25, 23)
  ink(0, 11)
  blob(20, 10, 12.5, 10.5)
  blob(0, 0, 25, 23)
  ear(0, -19, -0.2 + fk, 1.15, CO) // near ear — flicks

  el(27, 6, 1.7, 2.3) // nostril
  ink(OUT)
  g.beginPath() // mouth
  g.arc(24, 12, 4.2, 0.3, win ? 2.7 : 1.6)
  ink(0, 2.2)

  g.globalAlpha = 0.4 // soft cheek blush
  el(4, 10, 5.6, 3.2)
  ink(BL)
  g.globalAlpha = 1

  /* ---- the one big expressive eye ----------------------------------- */
  // Umbra (D) is permanently half-lidded
  if (win || lose) {
    // closed: a happy upward arc on a win, a defeated downward one on a loss
    g.beginPath()
    g.arc(9, win ? 3 : -8, 7, win ? PI + 0.4 : 0.4, win ? -0.4 : PI - 0.4)
    ink(0, 3.4)
  } else {
    if (D && !F) {
      g.globalAlpha = 0.28 // Umbra's eye actually glows — a halo, no blur
      el(10, -2, 10, 8)
      ink(EY)
      g.globalAlpha = 1
    }
    el(10, -2, 6.4, 8.8 * (1 - bl) * (1 - D * 0.45) + 0.7)
    ink(EY, 1.8)
    if (!F) {
      el(12.4, -5.2, 3, 3.4) // key glint...
      ink('#fff')
      el(7, 2.6, 1.6, 1.6) // ...and a small bounce catchlight
      g.fill()
    }
    // heavy upper lash — the single biggest "hand-drawn" cue on the face
    g.beginPath()
    g.ellipse(10, -2, 6.6, 9, 0, PI + (D ? 0.1 : 0.5), D ? 0.4 : -0.3)
    ink(0, 4)
  }

  /* ---- horn: spiral, gathering light as `form` rises ---------------- */
  const hc = 15.68 // cos(-1.12) * 36, folded: terser will not do it for us
  const hs = -32.4 // sin(-1.12) * 36
  const tx = 9 + hc
  const ty = -19 + hs
  poly([9 - hs / 6, -19 + hc / 6, 9 + hs / 6, -19 - hc / 6, tx, ty], 1)
  ink(0, 9)
  ink(HO)
  for (let i = 1; i < 4; i++) {
    // three ridges across the horn: the spiral read, for 3 lines of code
    const f = i / 4
    const w2 = (1 - f) / 6
    const cx = 9 + hc * f
    const cy = -19 + hs * f
    poly([cx - hs * w2, cy + hc * w2, cx + hs * w2 + hc / 12, cy - hc * w2 + hs / 12])
    ink(0, 1.7)
  }
  // forelock swept back over the brow, in front of the horn base
  hair(1, -21, 0.25, 14, 12, 2.6, 0.8, 1)

  // ONE deliberate shadow pass for the whole character.
  if (form > 0.01 || rear > 0.4) {
    g.save()
    g.globalAlpha = min(1, form + rear * 0.3)
    g.fillStyle = g.shadowColor = GL
    g.shadowBlur = S.q > 0.6 ? 8 + 34 * form : 0
    el(tx, ty, 4 + 8 * form, 4 + 8 * form)
    g.fill()
    for (let i = 0; i < 3; i++) {
      // sparks spiralling in as the rune finishes forming
      const a2 = t * 2.6 + i * 2.1
      const r2 = 20 - form * 15
      el(tx + cos(a2) * r2, ty + sin(a2) * r2 * 0.7, 1 + 2.4 * form, 1 + 2.4 * form)
      g.fill()
    }
    g.restore() // restore() puts shadowBlur back for us
  }
  g.restore() // head

  // near foreleg, in front of the barrel
  fl(25, win ? 37 : 9, win ? 36 : 17, 1, CO)
  g.restore() // rearing frame

  // near hind leg, in front of the barrel
  limb(hipx + 4, hipy, -27 + fold, -fold, lose, HIND, CO)
  g.restore()
}

/** Big portrait for the onboarding / end panel. `size` ~= body height. */
export function drawPortrait(ctx, x, y, side, size, t) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / HT, size / HT)
  drawUnicorn(ctx, 0, 0, side, { form: 0.3 + 0.3 * sin(t * 1.3) }, t)
  ctx.restore()
}

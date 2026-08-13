/* global DEBUG, c */
/**
 * Plague of Light: Rainbow Swarm — seed.
 *
 * This is a deliberately small vertical slice (hive -> drawn trail -> swarm
 * follows -> rainbow trail rendering) that exists so the 13kB pipeline has a
 * realistic payload to measure against. Replace it with the real game; the
 * build does not care what is in here.
 *
 * Size conventions used throughout (see BUILD.md):
 *   - `_`-prefixed properties are mangled away by terser.
 *   - `DEBUG` is a compile-time constant; DEBUG blocks vanish in release.
 *   - `c` is the <canvas id=c> element, reached through the implicit global.
 */

const g = c.getContext('2d')

/** Whole game state. `_`-prefixed keys get renamed to one character. */
const S = {
  _units: [],
  _trail: [], // flat [x, y, x, y, ...] polyline
  _dust: 0,
  _hiveX: 0,
  _hiveY: 0,
  _spawnAcc: 0,
}

let drawing = 0
let last = 0

const rnd = Math.random
const TAU = Math.PI * 2

const resize = () => {
  c.width = innerWidth
  c.height = innerHeight
  S._hiveX = c.width / 2
  S._hiveY = c.height * 0.85
}

/* ------------------------------- input ------------------------------ */

const push = (e) => {
  const t = S._trail
  const x = e.clientX
  const y = e.clientY
  const l = t.length
  if (l < 2 || Math.hypot(x - t[l - 2], y - t[l - 1]) > 14) t.push(x, y)
}

onpointerdown = (e) => {
  drawing = 1
  S._trail = []
  push(e)
}
onpointermove = (e) => drawing && push(e)
onpointerup = onpointercancel = () => (drawing = 0)
onresize = resize

/* -------------------------------- sim ------------------------------- */

const spawn = () => {
  if (S._units.length > 3e3) return
  S._units.push({
    x: S._hiveX + rnd() * 20 - 10,
    y: S._hiveY + rnd() * 20 - 10,
    vx: 0,
    vy: 0,
    i: 0, // index of the trail node this unit is heading for
  })
}

const step = (dt) => {
  S._spawnAcc += dt * 6
  while (S._spawnAcc > 1) {
    S._spawnAcc--
    spawn()
  }

  const t = S._trail
  for (const u of S._units) {
    let ax = 0
    let ay = 0

    if (t.length > 1) {
      const i = Math.min(u.i * 2, t.length - 2)
      const dx = t[i] - u.x
      const dy = t[i + 1] - u.y
      const d = Math.hypot(dx, dy) || 1
      if (d < 22) u.i++
      ax = (dx / d) * 60
      ay = (dy / d) * 60
    } else {
      // No trail: mill around the hive.
      ax = (S._hiveX - u.x) * 0.5
      ay = (S._hiveY - u.y) * 0.5
    }

    u.vx = (u.vx + ax * dt) * 0.96 + (rnd() - 0.5) * 8
    u.vy = (u.vy + ay * dt) * 0.96 + (rnd() - 0.5) * 8
    u.x += u.vx * dt
    u.y += u.vy * dt
  }

  // Recycle units that ran off the end of the trail into glitter dust.
  S._units = S._units.filter((u) => u.i * 2 < t.length + 2)
  S._dust += dt * S._units.length * 0.01
}

/* ------------------------------- render ----------------------------- */

const draw = (time) => {
  const w = c.width
  const h = c.height

  g.fillStyle = '#07070c'
  g.fillRect(0, 0, w, h)

  // Rainbow conveyor trail.
  const t = S._trail
  if (t.length > 3) {
    g.lineCap = g.lineJoin = 'round'
    g.lineWidth = 3 + Math.min(12, S._units.length / 80)
    for (let i = 2; i < t.length; i += 2) {
      g.strokeStyle = `hsl(${(i * 6 + time / 8) % 360} 100% 60%)`
      g.beginPath()
      g.moveTo(t[i - 2], t[i - 1])
      g.lineTo(t[i], t[i + 1])
      g.stroke()
    }
  }

  // The swarm.
  g.globalCompositeOperation = 'lighter'
  for (const u of S._units) {
    g.fillStyle = `hsl(${(u.x + u.y + time / 6) % 360} 100% 65%)`
    g.beginPath()
    g.arc(u.x, u.y, 1.6, 0, TAU)
    g.fill()
  }

  // Hive.
  g.fillStyle = `hsl(${(time / 5) % 360} 100% 70%)`
  g.beginPath()
  g.arc(S._hiveX, S._hiveY, 9 + Math.sin(time / 200) * 2, 0, TAU)
  g.fill()
  g.globalCompositeOperation = 'source-over'

  // HUD.
  g.fillStyle = '#fff'
  g.font = '14px monospace'
  g.fillText(`${S._units.length} unicorns   ${S._dust | 0} dust`, 12, 22)

  if (DEBUG) {
    g.fillStyle = '#0f0'
    g.fillText(`dev build — trail nodes ${S._trail.length / 2}`, 12, 40)
  }
}

/* -------------------------------- loop ------------------------------ */

const frame = (time) => {
  const dt = Math.min(0.05, (time - last) / 1e3) || 0
  last = time
  step(dt)
  draw(time)
  requestAnimationFrame(frame)
}

resize()
requestAnimationFrame(frame)

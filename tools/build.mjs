#!/usr/bin/env node
/**
 * 13kB build pipeline.
 *
 *   src/main.js
 *     -> esbuild        bundle to a single ES2020 IIFE, tree-shaken, DEBUG stripped
 *     -> terser         aggressive compress + mangle (+ property mangling)
 *     -> micro passes   "use strict" removal, tail semicolons, </script escaping
 *     -> roadroller     context-mixing self-extracting packer
 *     -> shell          minified HTML with the payload inlined
 *     -> zopfli zip     minimal container, best-of-N deflate
 *     -> verify         decoder round-trip + third-party zip round-trip
 *
 * Flags
 *   --squeeze            everything at maximum effort (release build)
 *   --mangle-all-props   rename every non-builtin property (read BUILD.md first)
 *   --no-roadroller      skip packing, ship plain minified JS
 *   --reuse-params       reuse cached roadroller parameters instead of searching
 *   --strict             exit 1 when the zip busts the 13kB budget
 *   --keep-tmp           keep the intermediate artifacts in dist/.tmp
 *   --quiet              only print the final line
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { performance } from 'node:perf_hooks'
import * as esbuild from 'esbuild'
import { minify as terserMinify } from 'terser'
import { minify as minifyHtml } from 'html-minifier-terser'
import { Packer } from 'roadroller'
import { createZip, verifyZip } from './zip.mjs'
import {
  BUDGET,
  PATHS,
  JS_PLACEHOLDER,
  esbuildOptions,
  terserOptions,
  roadrollerOptions,
  zipOptions,
  htmlMinifyOptions,
} from './config.mjs'

/* ------------------------------- cli ------------------------------- */

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const OPT = {
  squeeze: flag('--squeeze'),
  mangleAllProps: flag('--mangle-all-props'),
  roadroller: !flag('--no-roadroller'),
  reuseParams: flag('--reuse-params'),
  strict: flag('--strict'),
  keepTmp: flag('--keep-tmp'),
  quiet: flag('--quiet'),
}

/* ------------------------------ output ----------------------------- */

const tty = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
}
const say = (...a) => !OPT.quiet && console.log(...a)
const n = (v) => v.toLocaleString('en-US')
const pad = (s, w) => String(s).padEnd(w)
const padL = (s, w) => String(s).padStart(w)

const root = path.resolve(process.cwd())
const abs = (p) => path.join(root, p)

/* ----------------------------- pipeline ---------------------------- */

async function main() {
  const t0 = performance.now()
  const timings = {}
  const time = async (label, fn) => {
    const t = performance.now()
    const out = await fn()
    timings[label] = performance.now() - t
    return out
  }

  fs.mkdirSync(abs(PATHS.out), { recursive: true })
  if (OPT.keepTmp) fs.mkdirSync(abs(PATHS.tmp), { recursive: true })

  say(
    c.bold('\n  unicornbow'),
    c.dim(`— ${OPT.squeeze ? 'squeeze (release)' : 'standard'} build`),
  )

  /* 1. bundle ------------------------------------------------------- */
  const bundled = await time('esbuild', async () => {
    const result = await esbuild.build({
      ...esbuildOptions('release'),
      entryPoints: [abs(PATHS.entry)],
      outfile: abs(`${PATHS.tmp}/bundle.js`),
    })
    return result.outputFiles[0].text
  })
  dump('bundle.js', bundled)

  /* 2. terser ------------------------------------------------------- */
  const minified = await time('terser', async () => {
    const result = await terserMinify(
      bundled,
      terserOptions({ squeeze: OPT.squeeze, mangleAllProps: OPT.mangleAllProps }),
    )
    if (result.error) throw result.error
    return result.code
  })
  dump('terser.js', minified)

  /* 3. micro passes ------------------------------------------------- */
  const payload = microSqueeze(minified, OPT.squeeze)
  assertParses(payload, 'minified payload')
  dump('payload.js', payload)

  /* 4. candidates --------------------------------------------------- */
  const shell = await time('shell', () => minifyShell())
  const candidates = []

  candidates.push({ name: 'plain (terser only)', js: payload })

  if (OPT.roadroller) {
    const packed = await time('roadroller', () => pack(payload))
    candidates.push({ name: 'roadroller', js: packed.code, note: packed.note })
  }

  /* 5. rank candidates with a fast deflate --------------------------- */
  await time('rank', async () => {
    for (const cand of candidates) {
      const js = escapeForInlineScript(cand.js)
      assertParses(js, `${cand.name} payload after </script escaping`)
      const html = Buffer.from(shell.replace(JS_PLACEHOLDER, () => js), 'utf8')
      const { zip } = await createZip([{ name: PATHS.htmlName, data: html }], {
        useZopfli: false,
      })
      Object.assign(cand, {
        html,
        jsBytes: Buffer.byteLength(cand.js, 'utf8'),
        htmlBytes: html.length,
        rankBytes: zip.length,
      })
    }
  })

  /* 6. pick the winner and spend the zopfli budget on it alone ------- */
  candidates.sort((a, b) => a.rankBytes - b.rankBytes)
  const winner = candidates[0]

  const final = await time('zopfli', async () => {
    const entries = [{ name: PATHS.htmlName, data: winner.html }]
    const { zip, entries: stats } = await createZip(entries, zipOptions(OPT))
    verifyZip(zip, entries)
    return { zip, how: stats[0].how }
  })
  winner.zip = final.zip
  winner.zipBytes = final.zip.length
  winner.how = final.how

  fs.writeFileSync(abs(`${PATHS.out}/${PATHS.htmlName}`), winner.html)
  fs.writeFileSync(abs(`${PATHS.out}/${PATHS.zipName}`), winner.zip)

  /* 7. report ------------------------------------------------------- */
  report({ bundled, payload, candidates, winner, timings, elapsed: performance.now() - t0 })

  if (winner.zipBytes > BUDGET) {
    console.log(
      c.red(`\n  OVER BUDGET by ${n(winner.zipBytes - BUDGET)} bytes.`),
      c.dim('See BUILD.md > "When you are over budget".\n'),
    )
    if (OPT.strict) process.exit(1)
  }
}

/* ------------------------------ stages ----------------------------- */

/**
 * Textual passes terser will not do for you.
 * Each one is small; together they are worth 20-80 bytes pre-compression.
 */
function microSqueeze(code, squeeze) {
  let out = code
  if (squeeze) {
    // Sloppy mode is a byte cheaper and the game does not rely on strict
    // throw-on-assign semantics. Also unlocks roadroller's free variables.
    out = out.replace(/^\s*(["'])use strict\1;?/, '')
  }
  out = out.replace(/;+\s*$/, '') // trailing semicolon before EOF
  out = out.replace(/^[\s;]+/, '') // leading empties from stripped directives
  return out.trim()
}

/** `</script` inside a JS string/regex is legal as `<\/script`. Same for `<!--`. */
function escapeForInlineScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
}

async function minifyShell() {
  const src = fs.readFileSync(abs(PATHS.shell), 'utf8')
  if (!src.includes(JS_PLACEHOLDER)) {
    throw new Error(`${PATHS.shell} must contain the ${JS_PLACEHOLDER} placeholder`)
  }
  const out = await minifyHtml(src, htmlMinifyOptions)
  return out
}

/**
 * Roadroller: turns the payload into a compressed blob plus a ~250 byte
 * context-mixing decoder. Beats plain deflate above ~2kB of JS.
 */
async function pack(js) {
  const { level, packer: packerOptions } = roadrollerOptions(OPT)
  const inputs = [{ data: js, type: 'js', action: 'eval' }]
  const cachePath = abs(PATHS.paramCache)

  let best = null
  if (OPT.reuseParams && fs.existsSync(cachePath)) {
    try {
      best = JSON.parse(fs.readFileSync(cachePath, 'utf8')).best
      say(c.dim('  · reusing cached roadroller parameters'))
    } catch {
      best = null
    }
  }

  const reused = !!best
  let packer = new Packer(inputs, { ...packerOptions, ...(best || {}) })
  if (!best) {
    const bar = makeProgress(`  · roadroller -O${level}`)
    const result = await packer.optimize(level, bar.tick)
    bar.done()
    best = result.best
    try {
      fs.writeFileSync(cachePath, JSON.stringify({ best }, null, 2))
    } catch {
      /* cache is a nicety */
    }
  }

  let decoded = packer.makeDecoder()

  // --dirty lets the decoder leak globals. That is only safe when no element
  // id (which the browser turns into a global) shares a name with a free var.
  if (packerOptions.allowFreeVars && decoded.freeVars?.length) {
    const shellSrc = fs.readFileSync(abs(PATHS.shell), 'utf8')
    const ids = [...shellSrc.matchAll(/\bid\s*=\s*["']?([A-Za-z_$][\w$-]*)/g)].map((m) => m[1])
    const clash = decoded.freeVars.filter((v) => ids.includes(v))
    if (clash.length) {
      say(c.yellow(`  · free vars ${clash.join(', ')} clash with element ids — repacking safely`))
      packer = new Packer(inputs, { ...packerOptions, allowFreeVars: false, ...best })
      decoded = packer.makeDecoder()
    }
  }

  const code = decoded.firstLine + '\n' + decoded.secondLine
  dump('packed.js', code)
  verifyDecoder(code, js)

  return {
    code,
    note: `${reused ? 'cached params' : `-O${level}`}, ${packer.memoryUsageMB | 0}MB model${
      decoded.freeVars?.length ? `, free vars: ${decoded.freeVars.join('')}` : ''
    }`,
  }
}

/**
 * Run the self-extracting decoder in a sandbox with `eval` stubbed out and
 * assert it reproduces the input byte for byte. This catches a packer or
 * escaping regression before it ever reaches a browser.
 */
function verifyDecoder(packedCode, expected) {
  if (!/\beval\s*\(/.test(packedCode)) {
    say(c.yellow('  · decoder does not call eval — skipping round-trip check'))
    return
  }
  let captured
  const sandbox = {
    // Stub `eval` so the decoder hands us the decompressed source instead of
    // running it. It resolves to this function, so V8 treats it as an ordinary
    // call rather than a direct eval.
    eval: (s) => {
      captured = s
    },
    // Web globals the decoder reaches for that a bare vm context lacks.
    TextDecoder,
    TextEncoder,
    console,
  }
  vm.createContext(sandbox)
  try {
    new vm.Script(packedCode).runInContext(sandbox, { timeout: 120_000 })
  } catch (err) {
    throw new Error(`roadroller decoder threw while unpacking: ${err.message}`)
  }
  if (captured === undefined) {
    say(c.yellow('  · could not intercept the decoder — skipping round-trip check'))
    return
  }
  if (captured !== expected) {
    throw new Error(
      `roadroller round-trip mismatch: decoded ${captured.length} bytes, expected ${expected.length}`,
    )
  }
  say(c.dim('  · decoder round-trip verified'))
}

function assertParses(code, what) {
  try {
    new vm.Script(code)
  } catch (err) {
    throw new Error(`${what} is not valid JavaScript: ${err.message}`)
  }
}

/* ------------------------------ helpers ---------------------------- */

function dump(name, content) {
  if (!OPT.keepTmp) return
  fs.writeFileSync(abs(`${PATHS.tmp}/${name}`), content)
}

function makeProgress(label) {
  let last = 0
  let bestSize = Infinity
  const active = tty && !OPT.quiet
  if (!active) return { tick: undefined, done: () => {} }
  process.stdout.write(`${label} searching…`)
  return {
    tick: (info) => {
      const now = performance.now()
      if (info.bestSize?.[0]) bestSize = Math.min(bestSize, Math.ceil(info.bestSize[0]))
      if (now - last < 120) return
      last = now
      const pct = info.passRatio ? ` ${Math.round(info.passRatio * 100)}%` : ''
      process.stdout.write(
        `\r${label} ${info.pass}${pct} — best ~${n(bestSize)} B          `,
      )
    },
    done: () => process.stdout.write(`\r${label} done — best ~${n(bestSize)} B          \n`),
  }
}

function report({ bundled, payload, candidates, winner, timings, elapsed }) {
  if (OPT.quiet) {
    console.log(`${winner.zipBytes} ${BUDGET}`)
    return
  }
  const bundleBytes = Buffer.byteLength(bundled, 'utf8')
  const payloadBytes = Buffer.byteLength(payload, 'utf8')

  say('')
  say(c.dim('  stage                       bytes        change'))
  say(c.dim('  ------------------------------------------------'))
  row('esbuild bundle', bundleBytes, null)
  row('terser', payloadBytes, bundleBytes)
  say('')

  say(c.dim('  candidate                 payload    html    zip*'))
  say(c.dim('  ------------------------------------------------'))
  for (const cand of candidates) {
    const mark = cand === winner ? c.green(' <-') : '   '
    say(
      `  ${pad(cand.name, 22)}${padL(n(cand.jsBytes), 8)}${padL(n(cand.htmlBytes), 8)}${padL(
        n(cand.rankBytes),
        8,
      )}${mark}`,
    )
    if (cand.note) say(c.dim(`    ${cand.note}`))
  }
  say(c.dim('  * ranked with zlib-9; only the winner pays for zopfli'))

  const loser = candidates[1]
  if (loser) {
    const diff = loser.rankBytes - winner.rankBytes
    say(
      c.dim(
        `\n  ${winner.name} beats ${loser.name} by ${n(diff)} B ` +
          `(${((diff / loser.rankBytes) * 100).toFixed(1)}%)`,
      ),
    )
  }
  say(
    c.dim(
      `  final: ${winner.how} -> ${n(winner.zipBytes)} B ` +
        `(${n(winner.rankBytes - winner.zipBytes)} B under the zlib-9 estimate)`,
    ),
  )

  const used = winner.zipBytes / BUDGET
  const width = 40
  const filled = Math.min(width, Math.round(used * width))
  const colour = used > 1 ? c.red : used > 0.9 ? c.yellow : c.green
  say('')
  say(`  [${colour('#'.repeat(filled))}${c.dim('.'.repeat(Math.max(0, width - filled)))}]`)
  say(
    `  ${c.bold(n(winner.zipBytes))} / ${n(BUDGET)} bytes` +
      `  (${(used * 100).toFixed(1)}%)  ` +
      colour(`${n(BUDGET - winner.zipBytes)} bytes free`),
  )
  say(
    c.dim(
      `\n  ${Object.entries(timings)
        .map(([k, v]) => `${k} ${(v / 1000).toFixed(2)}s`)
        .join('  ')}  |  total ${(elapsed / 1000).toFixed(2)}s`,
    ),
  )
  say(c.dim(`  -> ${PATHS.out}/${PATHS.zipName}  (open ${PATHS.out}/${PATHS.htmlName} to play)\n`))

  function row(label, bytes, prev) {
    const delta =
      prev == null ? '' : c.dim(`  ${(((bytes - prev) / prev) * 100).toFixed(1)}%`)
    say(`  ${pad(label, 24)}${padL(n(bytes), 10)}${delta}`)
  }
}

main().catch((err) => {
  console.error(c.red(`\n  build failed: ${err.message}\n`))
  if (process.env.DEBUG_BUILD) console.error(err)
  process.exit(1)
})

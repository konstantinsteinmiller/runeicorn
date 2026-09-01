/**
 * Central knob board for the 13kB build pipeline.
 * Everything size-relevant lives here so the build script stays readable.
 */

/** js13kGames hard limit: 13 * 1024 bytes for the final .zip */
/**
 * POST-JAM. The jam ceiling was 13 * 1024 = 13,312 and the entry shipped under
 * it (13,304 at commit e570fe2 + the leg rework). The elemental ladder, the
 * tiered NPC and the coin progression were then added with the cap explicitly
 * lifted, and TOGETHER THEY EXCEED IT — `BUDGET=13312 pnpm check` re-arms the
 * old gate and this tree will fail it by design. To rebuild the jam entry,
 * check out the jam commit; the number is recorded here, not preserved.
 */
/**
 * Knobs arrive as EITHER an env var or a CLI flag. The flags exist because
 * `VAR=1 node ...` in a package.json script is POSIX-only — pnpm runs scripts
 * through cmd.exe on Windows, where that prefix is a syntax error rather than
 * an assignment. build.mjs ignores arguments it does not recognise, so the
 * extra flags cost it nothing.
 */
const argv = process.argv.slice(2)
const has = (n) => argv.includes(n)
const val = (n) => {
  const p = argv.find((a) => a.startsWith(n + '='))
  return p && p.slice(n.length + 1)
}

/**
 * Byte budgets accept a raw count or a `k` suffix (`13312` / `13k`, 1k = 1024).
 * The suffix is parsed rather than tolerated: `Number('13k')` is NaN, which the
 * old `||` chain swallowed straight into the default — so `--budget=13k` worked
 * only because the default happened to be the same number, and `--budget=20k`
 * would have silently produced 13312 as well. Unparseable input now throws.
 */
const bytes = (v) => {
  if (v == null || v === '' || v === false) return 0
  const m = /^(\d+(?:\.\d+)?)(k|kb|kib)?$/i.exec(String(v).trim())
  if (!m) throw new Error(`cannot parse byte budget ${JSON.stringify(v)} — use e.g. 13312 or 13k`)
  return Math.round(Number(m[1]) * (m[2] ? 1024 : 1))
}

export const BUDGET = bytes(process.env.BUDGET) || bytes(val('--budget')) || 13 * 1024

/**
 * Output root. Portal builds go somewhere else than the jam build so the two
 * never overwrite each other — `wavedash build push` uploads a DIRECTORY, and
 * pointing it at `dist/` would ship whichever build ran last.
 */
const OUT = process.env.OUT || val('--out') || 'dist'

export const PATHS = {
  // ENTRY/SHELL env overrides make it easy to size-test an alternative build.
  entry: process.env.ENTRY || 'src/main.js',
  shell: process.env.SHELL_HTML || 'src/index.html',
  out: OUT,
  tmp: `${OUT}/.tmp`,
  /** file name INSIDE the zip — js13k requires index.html at the archive root */
  htmlName: 'index.html',
  zipName: 'game.zip',
  /** cached roadroller parameters so repeat -O2 builds are fast. Per OUT dir:
      the portal payload differs from the jam payload, and parameters tuned for
      one are merely valid — not optimal — for the other. */
  paramCache: `${OUT}/.roadroller-params.json`,
}

/** Placeholder inside src/index.html that gets replaced with the payload. */
export const JS_PLACEHOLDER = '__JS__'

/* ------------------------------------------------------------------ *
 * 1. esbuild — bundling only. No minification: terser is strictly
 *    better at it, and double-minifying only confuses terser's model.
 * ------------------------------------------------------------------ */
export const esbuildOptions = (mode /* 'release' | 'dev' */) => ({
  bundle: true,
  format: 'iife',
  // Modern-only target: no transpiled helpers, no polyfills, shortest output.
  // Safari 15, not 14: esbuild refuses to emit destructuring for Safari 14
  // (known engine bug) and cannot lower it either, so the build hard-fails.
  target: ['es2020', 'chrome80', 'firefox78', 'safari15'],
  // Emit real UTF-8 instead of \uXXXX escapes — smaller and roadroller-friendly.
  charset: 'utf8',
  legalComments: 'none',
  treeShaking: true,
  minify: false,
  write: false,
  define: {
    DEBUG: mode === 'dev' ? 'true' : 'false',
    /**
     * FEATURE FLAG, not a deletion. The spellbook stays in the source and is
     * compiled out — esbuild folds the constant, terser drops the dead
     * branches, and tree-shaking then takes the modal and its KEYS table with
     * it. `SPELLBOOK=1 pnpm build` puts it back.
     */
    SPELLBOOK: process.env.SPELLBOOK === '1' || has('--spellbook') ? 'true' : 'false',
    /**
     * PORTAL TARGET. Off for the jam build and it must stay that way: js13k
     * requires a self-contained zip, and the Wavedash handshake talks to a
     * `<script>` that Wavedash's own wrapper injects — an external resource
     * the jam entry is not allowed to depend on. `WAVEDASH=1 pnpm
     * build:wavedash` compiles the handshake in and writes a separate tree.
     */
    WAVEDASH: process.env.WAVEDASH === '1' || has('--wavedash') ? 'true' : 'false',
  },
  // Anything referenced through these is compile-time removed when DEBUG=false.
  pure: mode === 'dev' ? [] : ['console.log', 'console.warn', 'console.debug'],
})

/* ------------------------------------------------------------------ *
 * 2. terser — the actual minifier.
 *    `safe` runs on every build; `squeeze` adds the transforms that
 *    trade a little language-spec pedantry for bytes.
 * ------------------------------------------------------------------ */

/**
 * Property names that must survive `--mangle-all-props`.
 * Terser already protects known DOM/builtin props (mangle.properties.builtins
 * is false by default); this list is for YOUR own string-accessed keys.
 */
export const RESERVED_PROPS = [
  // e.g. keys that are read back from JSON / localStorage
  'v',
  'best',
  'mute',
  /**
   * WAVEDASH SDK SURFACE — these cross a boundary we do not own, so mangling
   * them renames one half of a call the other half still expects.
   *
   * This is not hypothetical: `--mangle-all-props` turned
   * `sdk.updateLoadProgressZeroToOne` into `sdk.Tt`, and because the handshake
   * calls it as `?.()`, a missing method is indistinguishable from a method
   * that legitimately does not exist on an older wrapper. The call silently
   * became a no-op, Wavedash's loading screen would have stayed up forever,
   * and NOTHING would have appeared in the console.
   *
   * `init` and `debug` happen to survive today because terser recognises them,
   * but they are pinned anyway — a name that only works by luck is a bug that
   * has not fired yet.
   */
  'WavedashJS',
  'init',
  'debug',
  'updateLoadProgressZeroToOne',
  'readyForEvents',
]

export const terserOptions = ({ squeeze = false, mangleAllProps = false } = {}) => {
  const compress = {
    ecma: 2020,
    module: true,
    toplevel: true,
    passes: squeeze ? 12 : 4,
    arrows: true,
    arguments: true,
    hoist_funs: true,
    hoist_props: true,
    keep_fargs: false,
    keep_infinity: false,
    drop_console: true,
    drop_debugger: true,
    inline: 3,
    reduce_funcs: true,
    reduce_vars: true,
    collapse_vars: true,
    join_vars: true,
    negate_iife: true,
    sequences: 400,
    unsafe_arrows: true,
    typeofs: false, // `typeof x=="undefined"` -> `void 0===x` is fine, but the
    // typeofs rewrite breaks on undeclared globals. Keep off.
  }

  if (squeeze) {
    Object.assign(compress, {
      // true/false -> 1/0. Big win in flag-heavy game code.
      // Only unsafe if you compare with `=== true`.
      booleans_as_integers: true,
      // The whole unsafe family: assumes no exotic getters/Proxies/monkey
      // patching of builtins. Always true for a self-contained 13k game.
      unsafe: true,
      unsafe_comps: true,
      unsafe_Function: true,
      unsafe_math: true,
      unsafe_methods: true,
      unsafe_proto: true,
      unsafe_regexp: true,
      unsafe_undefined: true,
      pure_getters: true,
      // Assume no code depends on `arguments.callee`, function .name, etc.
      keep_classnames: false,
      keep_fnames: false,
      side_effects: true,
      unused: true,
    })
  }

  const mangle = {
    toplevel: true,
    eval: true,
    keep_classnames: false,
    keep_fnames: false,
  }

  // Property mangling. Default convention: only `_`-prefixed properties get
  // renamed, which is safe and opt-in per property. `--mangle-all-props`
  // renames everything terser does not recognise as a builtin — much bigger
  // win, much bigger footgun (see BUILD.md).
  if (squeeze || mangleAllProps) {
    mangle.properties = mangleAllProps
      ? { keep_quoted: true, reserved: RESERVED_PROPS, builtins: false }
      : { regex: /^_/, keep_quoted: true, reserved: RESERVED_PROPS }
  }

  return {
    ecma: 2020,
    module: true,
    toplevel: true,
    compress,
    mangle,
    format: {
      comments: false,
      ascii_only: false, // keep UTF-8 literals raw
      semicolons: true,
      wrap_func_args: false,
      braces: false,
      beautify: false,
      // Terser escapes `</script` for us; build.mjs escapes the packed output
      // too, so both candidates are safe to inline.
      inline_script: true,
    },
  }
}

/* ------------------------------------------------------------------ *
 * 3. roadroller — context-mixing self-extracting packer.
 * ------------------------------------------------------------------ */
export const roadrollerOptions = ({ squeeze = false } = {}) => ({
  // -O2 (~300 parameter sets) for release, -O1 (~30) for the fast path.
  level: squeeze ? 2 : 1,
  packer: {
    // MEASURED CEILING, do not raise. A single pack at 1024 is ~16 B smaller,
    // but `optimize()` packs hundreds of times and overflows roadroller's wasm
    // heap partway through ("Start offset ... outside the bounds of the
    // buffer"), so the whole build dies for 16 bytes. 400 is what survives.
    maxMemoryMB: squeeze ? 400 : 150,
    // Let the decoder use undeclared globals (CLI: --dirty). Saves ~10-25 B.
    // build.mjs re-packs without it if a free var collides with an element id.
    allowFreeVars: squeeze,
  },
})

/* ------------------------------------------------------------------ *
 * 4. zopfli / deflate — the zip container.
 * ------------------------------------------------------------------ */
export const zipOptions = ({ squeeze = false } = {}) => ({
  zopfliIterations: squeeze ? 1000 : 100,
  // Fixed 1980-01-01 timestamp -> byte-identical zips for identical input.
  deterministic: true,
})

/* ------------------------------------------------------------------ *
 * 5. HTML shell minification.
 * ------------------------------------------------------------------ */
export const htmlMinifyOptions = {
  collapseWhitespace: true,
  collapseBooleanAttributes: true,
  removeAttributeQuotes: true,
  removeComments: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeEmptyAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  useShortDoctype: true,
  sortAttributes: true,
  sortClassName: true,
  minifyCSS: { level: { 1: { all: true }, 2: { all: true } } },
  minifyJS: false, // the payload is injected AFTER this step
}

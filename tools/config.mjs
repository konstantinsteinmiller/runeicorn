/**
 * Central knob board for the 13kB build pipeline.
 * Everything size-relevant lives here so the build script stays readable.
 */

/** js13kGames hard limit: 13 * 1024 bytes for the final .zip */
export const BUDGET = Number(process.env.BUDGET) || 13 * 1024

export const PATHS = {
  // ENTRY/SHELL env overrides make it easy to size-test an alternative build.
  entry: process.env.ENTRY || 'src/main.js',
  shell: process.env.SHELL_HTML || 'src/index.html',
  out: 'dist',
  tmp: 'dist/.tmp',
  /** file name INSIDE the zip — js13k requires index.html at the archive root */
  htmlName: 'index.html',
  zipName: 'game.zip',
  /** cached roadroller parameters so repeat -O2 builds are fast */
  paramCache: 'dist/.roadroller-params.json',
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
  target: ['es2020', 'chrome80', 'firefox78', 'safari14'],
  // Emit real UTF-8 instead of \uXXXX escapes — smaller and roadroller-friendly.
  charset: 'utf8',
  legalComments: 'none',
  treeShaking: true,
  minify: false,
  write: false,
  define: {
    DEBUG: mode === 'dev' ? 'true' : 'false',
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

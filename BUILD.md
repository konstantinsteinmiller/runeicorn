# Build pipeline — 13,312 bytes, hard

Everything ships as one zipped `index.html`. No images, no fonts, no network
requests: the only asset is JavaScript, so every byte saved is a byte of
gameplay bought.

## Commands

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`           | esbuild watch + server on :8080, `DEBUG=true`, live reload                 |
| `pnpm build`         | Full pipeline at moderate effort (~1s). Use while iterating.               |
| `pnpm squeeze`       | **Release build.** Everything at maximum effort. Also `build:squeeze`.     |
| `pnpm squeeze:fast`  | Same, but reuses the cached roadroller parameters instead of re-searching. |
| `pnpm squeeze:props` | Squeeze **+ mangle every non-builtin property**. Read the warning below.   |
| `pnpm size`          | Budget report for the zip already on disk. Exits 1 when over.              |
| `pnpm check`         | Release build that exits 1 when over budget. This is the CI gate.          |
| `pnpm clean`         | Delete `dist/`.                                                            |

Output: `dist/game.zip` (the submission) and `dist/index.html` (open it directly
to play the exact bytes that are in the zip).

## The pipeline

```
src/main.js
  ├─ esbuild ─────── single ES2020 IIFE, tree-shaken, DEBUG folded away
  ├─ terser ──────── 12-pass compress + toplevel mangle (+ property mangling)
  ├─ micro passes ── strip "use strict", tail semicolons, escape </script
  ├─ roadroller ──── context-mixing packer: blob + ~250 byte self-extractor
  ├─ shell ───────── src/index.html minified, payload inlined
  └─ zopfli zip ──── minimal container, best-of-N deflate  →  dist/game.zip
```

### 1. esbuild — bundling only, never minification

Terser is a better minifier and esbuild's output only confuses it. esbuild's job
is to produce one IIFE with `target: es2020` (no transpiler helpers, no
polyfills), `charset: utf8` (raw UTF-8 instead of `\uXXXX` escapes, which is both
smaller and friendlier to the packer), and to fold `DEBUG` to `false` so every
debug block is dead code before terser even looks at it.

### 2. terser — where most of the bytes go

`pnpm build` runs a safe configuration. `pnpm squeeze` adds the transforms that
trade a little spec pedantry for bytes:

| Setting                     | Saves                | Costs                                                       |
| --------------------------- | -------------------- | ----------------------------------------------------------- |
| `passes: 12`                | 1–3%                 | build time only                                              |
| `booleans_as_integers`      | ~1 B per bool        | breaks `x === true` comparisons — use truthiness             |
| `unsafe_math`               | small                | may reassociate float ops; irrelevant for game feel          |
| `unsafe_methods/proto/comps`| small                | assumes nobody monkey-patched builtins                       |
| dropping `"use strict"`     | 13 B                 | sloppy mode semantics (silent failed assignments)            |
| property mangling (`^_`)    | ~2–6 B per access    | only `_`-prefixed properties, so it is opt-in per property   |

**The `_` convention.** Any property named `_something` is renamed to one
character. Use it for every long-lived state key:

```js
const S = { _units: [], _glitterDust: 0, _prismaticCapacity: 300 }
S._glitterDust++            // becomes S.a++
```

Never `_`-prefix something you also reach by string (`obj['_units']`,
`JSON.parse` output keys). Those go in `RESERVED_PROPS` in `tools/config.mjs`.

**`pnpm squeeze:props`** removes the `^_` restriction and renames *every*
property terser does not recognise as a DOM/builtin name. It is typically worth
another 3–6% but it will silently break anything reached dynamically. Only run it
close to submission, and play the result before shipping it.

### 3. roadroller — and why the build does not always use it

Roadroller compresses the payload with a context-mixing model and prepends a
~250 byte decoder. That decoder is incompressible, so on small payloads it
*loses* to plain deflate. The build therefore packs **both** candidates, zips
both, and keeps whichever is smaller — the report prints both rows and marks the
winner with `<-`.

Measured on this project:

| Payload after terser  | plain zip  | roadroller zip | winner     |
| --------------------- | ---------- | -------------- | ---------- |
| 1.7 kB (early seed)   | **1,228**  | 1,667          | plain      |
| 32 kB (shipping game) | 14,725     | **12,287**     | roadroller |

Break-even sits around 2.5–3 kB of minified JS. The shipping game is far past
it, so roadroller wins by ~2.2 kB — which is the entire reason the game fits.

`-O2` searches ~300 parameter sets and is the slow part of a release build. The
winning parameters are cached in `dist/.roadroller-params.json`;
`pnpm squeeze:fast` reuses them and skips the search.

### 4. The zip

`archiver`/`jszip` write extra fields (timestamps, unix attributes, data
descriptors) worth 20–60 wasted bytes, and cap out at zlib level 9. `tools/zip.mjs`
writes the minimum legal container instead — 30-byte local header, 46-byte
central record, 22-byte EOCD, zero extra fields, fixed 1980 timestamp for
reproducible output — and compresses with the best of zopfli (1000 iterations)
and all four zlib strategies, falling back to STORE if the data is
incompressible. Overhead for one `index.html` entry is 118 bytes, which is the
floor.

Ranking the candidates uses fast zlib-9; only the winner pays for zopfli.

## Safety rails

A 13kB game that does not boot is worth zero bytes, so the build refuses to
produce a broken artifact:

- **Decoder round-trip.** The roadroller output is executed in a `vm` sandbox
  with `eval` stubbed, and the decompressed source is checked against the
  input. Roadroller re-emits JS from its own tokenizer, so the round trip is
  semantic rather than byte-exact — token spacing shifts and non-ASCII string
  literals come back escaped (`—` → `—`). The build therefore asserts the
  decoded payload still parses and canonicalises both sides through esbuild
  before comparing. A packer or escaping regression fails the build.
- **Zip round-trip.** The archive is re-parsed with fflate (a third-party
  reader) and every entry is compared against the original bytes.
- **Syntax checks** after minification and after `</script` escaping.
- **Free-variable / element-id collision.** Squeeze mode enables roadroller's
  `--dirty` mode, which lets the decoder use undeclared globals. Since
  `<canvas id=c>` also creates a global `c`, the build compares the decoder's
  free variables against every `id=` in the shell and silently repacks without
  `--dirty` if they clash.
- **`</script` and `<!--`** inside the payload are rewritten to `<\/script` and
  `<\!--`, which are identical inside a JS string or regex but cannot terminate
  the inline script tag early.

## When you are over budget

In descending order of bytes-per-hour-of-work:

1. **Run `pnpm squeeze`**, not `pnpm build`. Free.
2. **`_`-prefix every long state property** you own (section 2). Free, seconds
   of work, scales with how much state the game has.
3. **Delete a feature.** The single most effective compressor ever written.
4. **Collapse objects into flat arrays.** `units[i*4]` beats `units[i].x` after
   mangling because there is no property name at all, and the numbers compress
   better than the structure did.
5. **Reuse magic numbers and string literals.** Both roadroller and deflate pay
   per *distinct* pattern; the second occurrence of anything is nearly free.
   Prefer one procedural draw routine driven by parameters over five bespoke ones.
6. **Fold constants into the code, not into config objects.** A config object
   survives minification; an inlined literal does not.
7. **Generate, don't store.** Level layouts as a seeded PRNG walk, curves as
   `Math.sin`, palettes as `hsl(h*37%360 ...)`.
8. **Try `pnpm squeeze:props`** and playtest the result.
9. **Trim the shell.** `src/index.html` is ~250 bytes of raw HTML. Dropping the
   viewport meta breaks mobile; dropping `<!doctype html>` puts the page in
   quirks mode. Both are last resorts for single-digit gains.

Do not bother with: shorter local variable names (terser already mangles them),
removing whitespace or comments (removed), or `var` over `const` (identical
after compression).

## Configuration

Everything tunable lives in `tools/config.mjs`: budget, terser presets,
roadroller level and memory, zopfli iterations, HTML minifier options,
`RESERVED_PROPS`.

Env overrides, useful for experiments and CI:

- `ENTRY=src/other.js` — build a different entry point
- `SHELL_HTML=src/other.html` — build a different shell
- `BUDGET=10240` — tighten the limit (`--strict` then fails earlier)
- `DEBUG_BUILD=1` — full stack traces on build failure
- `NO_COLOR=1` — plain output

## Flags

| Flag                 | Effect                                                        |
| -------------------- | ------------------------------------------------------------- |
| `--squeeze`          | Maximum effort everywhere (release).                          |
| `--mangle-all-props` | Rename every non-builtin property. Risky; playtest after.      |
| `--no-roadroller`    | Skip packing entirely (faster iteration, or debugging).        |
| `--reuse-params`     | Reuse cached roadroller parameters instead of searching.       |
| `--strict`           | Exit 1 when over budget.                                       |
| `--keep-tmp`         | Keep `dist/.tmp/{bundle,terser,payload,packed}.js`.             |
| `--quiet`            | Print only `<zipBytes> <budget>` (for scripts).                |

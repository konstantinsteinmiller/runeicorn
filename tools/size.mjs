#!/usr/bin/env node
/**
 * Budget report for the artifact that is already on disk.
 * `pnpm size` after a build, or in CI as a hard gate (exit 1 when over).
 */
import fs from 'node:fs'
import path from 'node:path'
import { BUDGET, PATHS } from './config.mjs'

const zipPath = path.join(process.cwd(), PATHS.out, PATHS.zipName)
if (!fs.existsSync(zipPath)) {
  console.error(`no build found at ${PATHS.out}/${PATHS.zipName} — run "pnpm build" first`)
  process.exit(1)
}

const bytes = fs.statSync(zipPath).size
const used = bytes / BUDGET
const width = 40
const filled = Math.min(width, Math.round(used * width))
const tty = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (s, code) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const colour = used > 1 ? 31 : used > 0.9 ? 33 : 32
const n = (v) => v.toLocaleString('en-US')

console.log('')
console.log(`  [${paint('#'.repeat(filled), colour)}${paint('.'.repeat(width - filled), 2)}]`)
console.log(
  `  ${n(bytes)} / ${n(BUDGET)} bytes (${(used * 100).toFixed(1)}%)  ` +
    paint(`${n(BUDGET - bytes)} bytes free`, colour),
)
console.log('')

process.exit(bytes > BUDGET ? 1 : 0)

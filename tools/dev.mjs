#!/usr/bin/env node
/**
 * Dev server: unminified, DEBUG=true, rebuild + live reload on save.
 * Nothing here touches the release pipeline — `pnpm build` is the truth.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as esbuild from 'esbuild'
import { PATHS, JS_PLACEHOLDER, esbuildOptions } from './config.mjs'

const DEV_DIR = path.join(process.cwd(), '.dev')
const shellPath = path.join(process.cwd(), PATHS.shell)
const PORT = Number(process.env.PORT) || 8080

const LIVE_RELOAD = `<script>new EventSource("/esbuild").onmessage=()=>location.reload()</script>`

const writeShell = () => {
  const src = fs.readFileSync(shellPath, 'utf8')
  const html = src
    .replace(new RegExp(`<script>\\s*${JS_PLACEHOLDER}\\s*</script>`), '<script src="m.js"></script>')
    .concat(LIVE_RELOAD)
  fs.mkdirSync(DEV_DIR, { recursive: true })
  fs.writeFileSync(path.join(DEV_DIR, 'index.html'), html)
}

writeShell()
fs.watch(shellPath, { persistent: false }, () => {
  try {
    writeShell()
  } catch {
    /* editor mid-save */
  }
})

const ctx = await esbuild.context({
  ...esbuildOptions('dev'),
  entryPoints: [path.join(process.cwd(), PATHS.entry)],
  outfile: path.join(DEV_DIR, 'm.js'),
  write: true,
  sourcemap: 'inline',
})

await ctx.watch()
const { hosts, port } = await ctx.serve({ servedir: DEV_DIR, port: PORT })
console.log(`\n  dev server  http://${hosts[0] === '0.0.0.0' ? 'localhost' : hosts[0]}:${port}\n`)

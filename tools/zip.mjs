/**
 * Minimal, byte-optimal ZIP writer.
 *
 * Why not `archiver` / `jszip`?
 *   - They emit extra fields (UT/ux timestamps, data descriptors, unix attrs)
 *     which cost 20-60 bytes per entry that js13k has no use for.
 *   - They cap out at zlib level 9. Zopfli finds deflate streams that are
 *     typically 3-8% smaller and stay 100% spec-compatible.
 *
 * This writer emits the theoretical minimum container: 30-byte local header,
 * 46-byte central directory record, 22-byte EOCD, zero extra fields.
 * Overhead for one `index.html` entry = 118 bytes, and that is the floor.
 */
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

/** 1980-01-01 00:00:00 — the lowest legal MS-DOS timestamp. */
const DOS_TIME = 0
const DOS_DATE = 0x0021

const crc32 =
  typeof zlib.crc32 === 'function'
    ? (buf) => zlib.crc32(buf) >>> 0
    : (() => {
        const table = new Int32Array(256)
        for (let i = 0; i < 256; i++) {
          let c = i
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
          table[i] = c
        }
        return (buf) => {
          let c = -1
          for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
          return (c ^ -1) >>> 0
        }
      })()

/**
 * Squeeze one buffer as hard as deflate allows.
 * Tries zopfli (if installed) and every zlib strategy, keeps the smallest.
 * Falls back to STORE when the data is incompressible.
 */
export async function bestDeflate(data, { zopfliIterations = 100, useZopfli = true } = {}) {
  /** @type {{method: number, data: Buffer, how: string}} */
  let best = { method: 0, data: Buffer.from(data), how: 'store' }

  const consider = (buf, how) => {
    if (buf && buf.length < best.data.length) {
      best = { method: 8, data: Buffer.from(buf), how }
    }
  }

  for (const strategy of [
    zlib.constants.Z_DEFAULT_STRATEGY,
    zlib.constants.Z_FILTERED,
    zlib.constants.Z_HUFFMAN_ONLY,
    zlib.constants.Z_RLE,
  ]) {
    try {
      consider(
        zlib.deflateRawSync(data, { level: 9, memLevel: 9, windowBits: 15, strategy }),
        `zlib9/s${strategy}`,
      )
    } catch {
      /* ignore a failing strategy */
    }
  }

  try {
    if (!useZopfli) throw new Error('skipped')
    const { deflateAsync } = await import('@gfx/zopfli')
    const out = await deflateAsync(Buffer.from(data), {
      numiterations: zopfliIterations,
      blocksplitting: true,
      blocksplittingmax: 15,
    })
    consider(out, `zopfli x${zopfliIterations}`)
  } catch {
    /* @gfx/zopfli not installed — zlib result stands */
  }

  return best
}

/**
 * @param {{name: string, data: Buffer|Uint8Array}[]} entries
 * @returns {Promise<{zip: Buffer, entries: {name: string, raw: number, packed: number, how: string}[]}>}
 */
export async function createZip(entries, { zopfliIterations = 100, useZopfli = true } = {}) {
  const locals = []
  const centrals = []
  const stats = []
  let offset = 0

  for (const entry of entries) {
    const raw = Buffer.from(entry.data)
    const name = Buffer.from(entry.name, 'utf8')
    const { method, data: packed, how } = await bestDeflate(raw, { zopfliIterations, useZopfli })
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed to extract: 2.0
    local.writeUInt16LE(0, 6) // flags: none (no data descriptor, no UTF-8 bit)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length: zero. Every byte counts.
    name.copy(local, 30)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4) // version made by (MS-DOS, 2.0)
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)

    locals.push(local, packed)
    centrals.push(central)
    stats.push({ name: entry.name, raw: raw.length, packed: packed.length, how })
    offset += local.length + packed.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // no archive comment

  return { zip: Buffer.concat([...locals, ...centrals, eocd]), entries: stats }
}

/**
 * Independent round-trip check: parse the archive with fflate (a third-party
 * reader) and assert every entry decompresses back to the exact input bytes.
 * A zip that a browser cannot open is worth 0 bytes, not 13k.
 */
export function verifyZip(zip, entries) {
  const unpacked = unzipSync(zip)
  for (const entry of entries) {
    const got = unpacked[entry.name]
    if (!got) throw new Error(`zip verify: entry "${entry.name}" missing`)
    if (!Buffer.from(got).equals(Buffer.from(entry.data))) {
      throw new Error(`zip verify: entry "${entry.name}" round-trip mismatch`)
    }
  }
  const extra = Object.keys(unpacked).filter((n) => !entries.some((e) => e.name === n))
  if (extra.length) throw new Error(`zip verify: unexpected entries ${extra.join(', ')}`)
  return true
}

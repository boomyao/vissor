/**
 * Best-effort intrinsic-dimension probe for the image formats codex
 * is likely to emit and users are likely to upload. Reads just the
 * header — we never decode pixel data. Returns `null` when we don't
 * recognise the format; callers fall back to a 512-square default.
 */
export function probeImageDims(
  buf: Buffer,
): { w: number; h: number } | null {
  if (isPng(buf)) return pngDims(buf)
  if (isJpeg(buf)) return jpegDims(buf)
  if (isGif(buf)) return gifDims(buf)
  if (isWebp(buf)) return webpDims(buf)
  return null
}

function isPng(b: Buffer): boolean {
  return (
    b.length >= 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
}

function pngDims(b: Buffer): { w: number; h: number } {
  // IHDR chunk starts at byte 8: 4-byte length, 4-byte type "IHDR",
  // then width/height as big-endian u32s.
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function isJpeg(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
}

/**
 * Walk the JPEG segment chain looking for an SOF marker. Each segment
 * after the start-of-image is `0xFF <marker> <len-hi> <len-lo> <payload>`.
 * SOF markers (C0..CF excluding C4/C8/CC) carry height/width at payload
 * bytes 1..4.
 */
function jpegDims(b: Buffer): { w: number; h: number } | null {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    let marker = b[i + 1]
    // Skip any fill bytes (spec allows multiple 0xFFs before a marker).
    while (marker === 0xff && i + 1 < b.length) {
      i++
      marker = b[i + 1]
    }
    i += 2
    if (marker === 0xd8 || marker === 0xd9) return null // SOI/EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no payload
    if (i + 1 >= b.length) return null
    const segLen = b.readUInt16BE(i)
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isSOF && i + 7 < b.length) {
      return { w: b.readUInt16BE(i + 5), h: b.readUInt16BE(i + 3) }
    }
    i += segLen
  }
  return null
}

function isGif(b: Buffer): boolean {
  if (b.length < 10) return false
  const sig = b.toString('ascii', 0, 6)
  return sig === 'GIF87a' || sig === 'GIF89a'
}

function gifDims(b: Buffer): { w: number; h: number } {
  return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
}

function isWebp(b: Buffer): boolean {
  return (
    b.length >= 30 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  )
}

function webpDims(b: Buffer): { w: number; h: number } | null {
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8X' && b.length >= 30) {
    // Extended: width-1 and height-1 as 3-byte little-endian values.
    const w = 1 + ((b[24] | (b[25] << 8) | (b[26] << 16)) & 0xffffff)
    const h = 1 + ((b[27] | (b[28] << 8) | (b[29] << 16)) & 0xffffff)
    return { w, h }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    // Lossless: 14-bit width-1 / 14-bit height-1 packed after signature.
    const sig = b[20]
    if (sig !== 0x2f) return null
    const bits =
      b.readUInt8(21) |
      (b.readUInt8(22) << 8) |
      (b.readUInt8(23) << 16) |
      (b.readUInt8(24) << 24)
    const w = 1 + (bits & 0x3fff)
    const h = 1 + ((bits >> 14) & 0x3fff)
    return { w, h }
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    // Lossy: skip 3-byte frame tag, 3-byte start code, then width/height as
    // 14-bit little-endian values with high 2 bits unused.
    const w = b.readUInt16LE(26) & 0x3fff
    const h = b.readUInt16LE(28) & 0x3fff
    return { w, h }
  }
  return null
}

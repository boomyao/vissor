import JSZip from 'jszip'
import type { CanvasItem, Project, Asset } from '@vissor/shared'
import { api } from './api.js'

/**
 * Package a project as a downloadable ZIP:
 *   - images/<tile-id>.png for every image tile (one file per tile)
 *   - manifest.json with tile positions, sizes, z-order, and any
 *     text-tile contents, so a future "import" could reconstruct the
 *     board. Also includes the project name + export timestamp.
 *
 * Downloads happen in the browser — we fetch each /api/files/:id
 * through the already-running vissor server, stuff the bytes into
 * JSZip, and hand the final blob to the user via a synthetic <a>.
 */
export async function exportProjectAsZip(
  project: Project,
  items: CanvasItem[],
  assets: Record<string, Asset>,
): Promise<void> {
  const zip = new JSZip()
  const images = zip.folder('images')!

  const manifestItems = items.map((item) => {
    const base = {
      id: item.id,
      kind: item.kind,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      z: item.z,
      turnId: 'turnId' in item ? item.turnId ?? null : null,
    }
    if (item.kind === 'text') {
      return { ...base, text: item.text }
    }
    if (item.kind === 'image') {
      return {
        ...base,
        assetId: item.assetId,
        filename: `images/${item.id}.png`,
      }
    }
    // 'group' or any future kind — manifest-only, no asset.
    return base
  })

  // Fetch + add each image. In parallel — these are same-origin and
  // the browser handles concurrency limits sensibly.
  await Promise.all(
    items
      .filter((i): i is Extract<CanvasItem, { kind: 'image' }> =>
        i.kind === 'image',
      )
      .map(async (item) => {
        const res = await fetch(api.fileUrl(item.assetId))
        if (!res.ok) return
        const blob = await res.blob()
        const ext = guessExt(assets[item.assetId]?.mime ?? 'image/png')
        const filename = `${item.id}${ext}`
        images.file(filename, blob)
      }),
  )

  const manifest = {
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
    },
    exportedAt: new Date().toISOString(),
    items: manifestItems,
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(project.name)}-${stamp()}.zip`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 2_000)
  }
}

function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'vissor-project'
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes())
  )
}

function guessExt(mime: string): string {
  if (mime.includes('jpeg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('svg')) return '.svg'
  return '.png'
}

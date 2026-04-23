import { randomUUID } from 'node:crypto'
import { stat, readFile, writeFile, readdir, appendFile, copyFile, rm, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type {
  Asset,
  CanvasItem,
  ChatMessage,
  Project,
  ProjectSnapshot,
} from '@vissor/shared'
import {
  assetPath,
  ensureDirs,
  ensureProjectDir,
  projectAssetsIndexPath,
  projectChatPath,
  projectDir,
  projectItemsPath,
  projectMetaPath,
  PROJECTS_DIR,
} from './paths.js'

type Json = Record<string, unknown>

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Write-then-rename for full-file overwrites. Without this, a crash
 * or SIGKILL mid-write truncates the target file and readJsonl
 * downstream throws on the partial last line — taking the whole
 * project with it. rename(2) is atomic on POSIX within a single
 * filesystem, so readers see either the old full file or the new
 * full file, never a half-written one.
 */
async function atomicWriteFile(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, data, 'utf8')
  await rename(tmp, path)
}

async function writeJson(path: string, value: Json): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(value, null, 2))
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const raw = await readFile(path, 'utf8')
    const out: T[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim().length) continue
      try {
        out.push(JSON.parse(line) as T)
      } catch {
        // Skip malformed lines rather than failing the whole read.
        // Usually caused by an interrupted append — the last line was
        // partially flushed. Losing one line beats bricking the project.
        // eslint-disable-next-line no-console
        console.error(
          `[store] skipping malformed line in ${path}: ${line.slice(0, 100)}`,
        )
      }
    }
    return out
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

// ---------- projects ----------

export async function listProjects(): Promise<Project[]> {
  await ensureDirs()
  let entries: string[]
  try {
    entries = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }
  const projects: Project[] = []
  for (const id of entries) {
    const meta = await readJson<Project>(projectMetaPath(id))
    if (meta) projects.push(meta)
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  return projects
}

export async function createProject(name?: string): Promise<Project> {
  await ensureDirs()
  const id = randomUUID()
  const now = Date.now()
  const project: Project = {
    id,
    name: name ?? 'Untitled project',
    createdAt: now,
    updatedAt: now,
  }
  await ensureProjectDir(id)
  await writeJson(projectMetaPath(id), project as unknown as Json)
  await writeJson(projectAssetsIndexPath(id), {})
  return project
}

export async function getProject(id: string): Promise<Project | null> {
  return readJson<Project>(projectMetaPath(id))
}

/**
 * Clone a project's canvas into a new project. Items are copied
 * with fresh ids (so moves/deletes on the copy don't touch the
 * source) and the asset index is copied verbatim — asset BLOBS are
 * content-addressed, so the clone just points at the same files. Chat
 * history and codex session id are NOT copied: a clone is a fresh
 * board to iterate on, not a continuation of the source's
 * conversation.
 */
export async function duplicateProject(
  sourceId: string,
): Promise<Project | null> {
  const source = await getProject(sourceId)
  if (!source) return null
  const copy = await createProject(`${source.name} (copy)`)
  // Copy the assets index as-is; asset files are deduped globally.
  const assetsIndex = await readAssetsIndex(sourceId)
  await writeJson(projectAssetsIndexPath(copy.id), assetsIndex as unknown as Json)
  // Re-materialise items with new ids, same layout.
  const items = await readItems(sourceId)
  const idMap = new Map<string, string>()
  for (const item of items) idMap.set(item.id, randomUUID())
  for (const item of items) {
    const next: CanvasItem = { ...item, id: idMap.get(item.id)! }
    // CanvasGroup points at childIds — remap to the new ids.
    if (next.kind === 'group') {
      next.childIds = next.childIds.map((id) => idMap.get(id) ?? id)
    }
    await appendItemOp(copy.id, { op: 'add', item: next })
  }
  return copy
}

export async function updateProject(
  id: string,
  patch: Partial<Project>,
): Promise<Project | null> {
  const current = await getProject(id)
  if (!current) return null
  const next: Project = { ...current, ...patch, id, updatedAt: Date.now() }
  await writeJson(projectMetaPath(id), next as unknown as Json)
  return next
}

export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id)
  try {
    await rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// ---------- items ----------

export async function readItems(projectId: string): Promise<CanvasItem[]> {
  // We store items as a JSONL event log keyed by op:
  //   { op: 'add', item }, { op: 'update', item }, { op: 'remove', id }
  // and replay to a Map for reads. Simple, append-only, crash-safe.
  type Op =
    | { op: 'add'; item: CanvasItem }
    | { op: 'update'; item: CanvasItem }
    | { op: 'remove'; id: string }
  const ops = await readJsonl<Op>(projectItemsPath(projectId))
  const map = new Map<string, CanvasItem>()
  for (const op of ops) {
    if (op.op === 'add' || op.op === 'update') map.set(op.item.id, op.item)
    else if (op.op === 'remove') map.delete(op.id)
  }
  return [...map.values()].sort((a, b) => a.z - b.z)
}

export async function appendItemOp(
  projectId: string,
  op:
    | { op: 'add'; item: CanvasItem }
    | { op: 'update'; item: CanvasItem }
    | { op: 'remove'; id: string },
): Promise<void> {
  await ensureProjectDir(projectId)
  await appendFile(projectItemsPath(projectId), JSON.stringify(op) + '\n', 'utf8')
}

// ---------- chat ----------

export async function readChat(projectId: string): Promise<ChatMessage[]> {
  return readJsonl<ChatMessage>(projectChatPath(projectId))
}

export async function appendChat(
  projectId: string,
  message: ChatMessage,
): Promise<void> {
  await ensureProjectDir(projectId)
  await appendFile(
    projectChatPath(projectId),
    JSON.stringify(message) + '\n',
    'utf8',
  )
}

/**
 * Rewrite the chat log. We need this because agent messages mutate
 * (status + text aggregate over the turn). The log stays small so this
 * is cheap — O(chat length) per turn update.
 */
export async function rewriteChat(
  projectId: string,
  messages: ChatMessage[],
): Promise<void> {
  await ensureProjectDir(projectId)
  const body = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '')
  await atomicWriteFile(projectChatPath(projectId), body)
}

// ---------- assets ----------

export async function readAssetsIndex(
  projectId: string,
): Promise<Record<string, Asset>> {
  return (
    (await readJson<Record<string, Asset>>(projectAssetsIndexPath(projectId))) ??
    {}
  )
}

async function writeAssetsIndex(
  projectId: string,
  index: Record<string, Asset>,
): Promise<void> {
  await ensureProjectDir(projectId)
  await writeJson(projectAssetsIndexPath(projectId), index as unknown as Json)
}

export async function ingestFile(
  projectId: string,
  sourcePath: string,
  opts: {
    mime: string
    source: Asset['source']
    originalFilename?: string
    width?: number
    height?: number
  },
): Promise<Asset> {
  await ensureDirs()
  const buf = await readFile(sourcePath)
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 24)
  const ext = extname(opts.originalFilename ?? sourcePath) || guessExt(opts.mime)
  const dest = assetPath(hash, ext)
  if (!(await fileExists(dest))) {
    await copyFile(sourcePath, dest)
  }
  const index = await readAssetsIndex(projectId)
  const existing = index[hash]
  if (existing) return existing
  const asset: Asset = {
    id: hash,
    mime: opts.mime,
    width: opts.width,
    height: opts.height,
    size: buf.byteLength,
    absPath: dest,
    source: opts.source,
    createdAt: Date.now(),
  }
  index[hash] = asset
  await writeAssetsIndex(projectId, index)
  return asset
}

export async function registerAsset(
  projectId: string,
  asset: Asset,
): Promise<void> {
  const index = await readAssetsIndex(projectId)
  index[asset.id] = asset
  await writeAssetsIndex(projectId, index)
}

function guessExt(mime: string): string {
  switch (mime) {
    case 'image/png': return '.png'
    case 'image/jpeg': return '.jpg'
    case 'image/webp': return '.webp'
    case 'image/gif': return '.gif'
    default: return ''
  }
}

// ---------- snapshot ----------

export async function getSnapshot(
  projectId: string,
): Promise<ProjectSnapshot | null> {
  const project = await getProject(projectId)
  if (!project) return null
  const [items, assets, chat] = await Promise.all([
    readItems(projectId),
    readAssetsIndex(projectId),
    readChat(projectId),
  ])
  return { project, items, assets, chat }
}

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

export const VISSOR_HOME =
  process.env.VISSOR_HOME ?? join(homedir(), '.vissor')

export const PROJECTS_DIR = join(VISSOR_HOME, 'projects')
export const ASSETS_DIR = join(VISSOR_HOME, 'assets')
export const SCRATCH_DIR = join(VISSOR_HOME, 'scratch')

export function turnScratchDir(turnId: string): string {
  return join(SCRATCH_DIR, turnId)
}

export function projectDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId)
}

export function projectMetaPath(projectId: string): string {
  return join(projectDir(projectId), 'meta.json')
}

export function projectItemsPath(projectId: string): string {
  return join(projectDir(projectId), 'items.jsonl')
}

export function projectChatPath(projectId: string): string {
  return join(projectDir(projectId), 'chat.jsonl')
}

export function projectAssetsIndexPath(projectId: string): string {
  return join(projectDir(projectId), 'assets.json')
}

export function assetPath(assetId: string, ext: string): string {
  return join(ASSETS_DIR, `${assetId}${ext}`)
}

export async function ensureDirs(): Promise<void> {
  await mkdir(PROJECTS_DIR, { recursive: true })
  await mkdir(ASSETS_DIR, { recursive: true })
  await mkdir(SCRATCH_DIR, { recursive: true })
}

/**
 * Clear the scratch dir on startup. Each in-flight turn gets its own
 * per-turn subdir here; if the server was killed before a turn
 * cleaned up (ungraceful shutdown, crash, SIGKILL), those dirs are
 * stranded. At boot the in-memory turn mutex is empty, so nothing is
 * actively using scratch and a full wipe is safe.
 */
export async function cleanScratchOnBoot(): Promise<void> {
  await rm(SCRATCH_DIR, { recursive: true, force: true }).catch(() => undefined)
  await mkdir(SCRATCH_DIR, { recursive: true })
}

export async function ensureProjectDir(projectId: string): Promise<void> {
  await mkdir(projectDir(projectId), { recursive: true })
}

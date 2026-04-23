import { api } from './api.js'
import { useStore } from '../store/store.js'

const LAST_PROJECT_KEY = 'vissor:lastProjectId'

/** Load the project list from the server and push it into the store. */
export async function refreshProjects(): Promise<void> {
  const list = await api.listProjects()
  useStore.getState().setProjects(list)
}

/** Load a specific project into the store by id. */
export async function switchProject(id: string): Promise<void> {
  const { snapshot } = await api.getProject(id)
  useStore.getState().loadSnapshot(snapshot)
  localStorage.setItem(LAST_PROJECT_KEY, id)
}

/** Create a new blank project and switch to it. */
export async function createAndSwitch(name?: string): Promise<void> {
  const project = await api.createProject(name)
  await refreshProjects()
  await switchProject(project.id)
}

/**
 * Clone the current project into a fresh copy, refresh the list, and
 * switch to the new copy. Items land with the same layout; chat
 * history and codex session start fresh so the user can branch off.
 */
export async function duplicateCurrent(): Promise<void> {
  const current = useStore.getState().project
  if (!current) return
  const copy = await api.duplicateProject(current.id)
  await refreshProjects()
  await switchProject(copy.id)
}

/** Rename the project and refresh the list. */
export async function renameCurrent(name: string): Promise<void> {
  const current = useStore.getState().project
  if (!current) return
  await api.renameProject(current.id, name)
  await refreshProjects()
  // Also refresh the in-memory project meta for the active session.
  useStore.setState((s) => ({
    project: s.project ? { ...s.project, name } : s.project,
  }))
}

/**
 * Delete the current project. If other projects exist, switch to the
 * most-recently-updated one; otherwise create a fresh blank project.
 */
export async function deleteCurrent(): Promise<void> {
  const current = useStore.getState().project
  if (!current) return
  await api.deleteProject(current.id)
  localStorage.removeItem(LAST_PROJECT_KEY)
  await refreshProjects()
  const { projects } = useStore.getState()
  if (projects.length > 0) {
    await switchProject(projects[0].id)
  } else {
    const created = await api.createProject()
    await refreshProjects()
    await switchProject(created.id)
  }
}

/**
 * Initial boot: pick last-used project (or first, or create one) and load it.
 * Called once from App on mount.
 */
export async function bootInitialProject(): Promise<void> {
  await refreshProjects()
  const { projects } = useStore.getState()
  const saved = localStorage.getItem(LAST_PROJECT_KEY)
  const targetId =
    (saved && projects.find((p) => p.id === saved)?.id) ||
    projects[0]?.id ||
    null
  if (targetId) {
    await switchProject(targetId)
    return
  }
  const created = await api.createProject()
  await refreshProjects()
  await switchProject(created.id)
}

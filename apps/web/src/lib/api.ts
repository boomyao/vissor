import type {
  ChatSendRequest,
  ChatSendResponse,
  GetProjectResponse,
  ListProjectsResponse,
  Project,
  StylePreset,
  UploadResponse,
} from '@vissor/shared'
import { Routes } from '@vissor/shared'

// Re-export for consumers that don't want to import from @vissor/shared directly.
export type { StylePreset }

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return (await res.json()) as T
}

export const api = {
  listProjects: async (): Promise<Project[]> => {
    const r = await fetch(Routes.projectsList)
    const data = await json<ListProjectsResponse>(r)
    return data.projects
  },

  createProject: async (name?: string): Promise<Project> => {
    const r = await fetch(Routes.projectsCreate, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await json<{ project: Project }>(r)
    return data.project
  },

  renameProject: async (id: string, name: string): Promise<Project> => {
    const r = await fetch(Routes.projectPatch(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const data = await json<{ project: Project }>(r)
    return data.project
  },

  patchProject: async (
    id: string,
    patch: { name?: string; canvasBg?: string },
  ): Promise<Project> => {
    const r = await fetch(Routes.projectPatch(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await json<{ project: Project }>(r)
    return data.project
  },

  deleteProject: async (id: string): Promise<void> => {
    const r = await fetch(Routes.projectDelete(id), { method: 'DELETE' })
    await json(r)
  },

  duplicateProject: async (id: string): Promise<Project> => {
    const r = await fetch(Routes.projectDuplicate(id), { method: 'POST' })
    const data = await json<{ project: Project }>(r)
    return data.project
  },

  getProject: async (id: string): Promise<GetProjectResponse> => {
    const r = await fetch(Routes.projectGet(id))
    return json<GetProjectResponse>(r)
  },

  sendChat: async (req: ChatSendRequest): Promise<ChatSendResponse> => {
    const r = await fetch(Routes.chatSend, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    return json<ChatSendResponse>(r)
  },

  cancelChat: async (
    projectId: string,
    turnId: string,
  ): Promise<{ canceled: boolean }> => {
    const r = await fetch(Routes.chatCancel, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, turnId }),
    })
    return json<{ canceled: boolean }>(r)
  },

  upload: async (projectId: string, files: File[]): Promise<UploadResponse> => {
    const fd = new FormData()
    for (const f of files) fd.append('file', f, f.name)
    const r = await fetch(`${Routes.uploads}?projectId=${projectId}`, {
      method: 'POST',
      body: fd,
    })
    return json<UploadResponse>(r)
  },

  placeAsset: async (
    projectId: string,
    assetId: string,
    x: number,
    y: number,
    size?: { w: number; h: number },
  ): Promise<void> => {
    const r = await fetch(Routes.itemsPlace(projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, x, y, w: size?.w, h: size?.h }),
    })
    await json(r)
  },

  placeText: async (
    projectId: string,
    x: number,
    y: number,
    text?: string,
  ): Promise<{ item: { id: string } }> => {
    const r = await fetch(Routes.itemsPlaceText(projectId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, text }),
    })
    return json<{ item: { id: string } }>(r)
  },

  patchText: async (
    projectId: string,
    itemId: string,
    text: string,
  ): Promise<void> => {
    const r = await fetch(Routes.itemPatch(projectId, itemId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    await json(r)
  },

  fileUrl: (assetId: string): string => Routes.file(assetId),

  patchItem: async (
    projectId: string,
    itemId: string,
    patch: {
      x?: number
      y?: number
      w?: number
      h?: number
      z?: number
      text?: string
      fontSize?: number
      color?: string
    },
  ): Promise<void> => {
    const r = await fetch(Routes.itemPatch(projectId, itemId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await json(r)
  },

  deleteItem: async (projectId: string, itemId: string): Promise<void> => {
    const r = await fetch(Routes.itemDelete(projectId, itemId), {
      method: 'DELETE',
    })
    await json(r)
  },

  streamUrl: (projectId: string): string => Routes.projectStream(projectId),
}

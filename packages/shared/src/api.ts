// Wire types for the HTTP/SSE API.

import type { Asset, CanvasItem, ChatMessage, Project, ProjectSnapshot, TurnId } from './types.js'

/** Built-in style presets selectable from the command bar. */
export type StylePreset =
  | 'minimal'
  | 'photoreal'
  | 'illustration'
  | '3d'
  | 'sketch'

/** Target aspect ratio for generated images. */
export type AspectRatio = 'square' | 'portrait' | 'landscape' | 'wide'

export const ASPECT_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  square: { w: 512, h: 512 },
  portrait: { w: 384, h: 512 },
  landscape: { w: 512, h: 384 },
  wide: { w: 640, h: 360 },
}

export interface ChatSendRequest {
  projectId: string
  /** Caller-allocated, so the client can optimistically render. */
  turnId: TurnId
  text: string
  /** Asset ids to attach as reference images. */
  attachedAssetIds: string[]
  /**
   * Number of variants to request. Server translates this into a
   * prompt instruction for codex. Omit to accept the server default.
   */
  variantCount?: number
  /** Optional style preset applied to the prompt. */
  stylePreset?: StylePreset
  /** Optional aspect ratio (applied both to prompt and to tile size). */
  aspectRatio?: AspectRatio
}

export interface ChatSendResponse {
  turnId: TurnId
  /** Pre-materialised user message so the client doesn't have to synth it. */
  userMessage: ChatMessage
}

/** Server-sent event pushed over the project-scoped SSE channel. */
export type ChatStreamEvent =
  | { kind: 'turn.started'; turnId: TurnId; agentMessageId: string }
  | { kind: 'turn.status'; turnId: TurnId; statusLine: string }
  | { kind: 'turn.text.delta'; turnId: TurnId; delta: string }
  | { kind: 'turn.text.final'; turnId: TurnId; text: string }
  | { kind: 'turn.completed'; turnId: TurnId }
  | { kind: 'turn.failed'; turnId: TurnId; error: string }
  | { kind: 'asset.added'; asset: Asset }
  | { kind: 'item.added'; item: CanvasItem }
  | { kind: 'item.updated'; item: CanvasItem }
  | { kind: 'item.removed'; itemId: string }
  | { kind: 'session.codexId'; codexSessionId: string }

export interface UploadResponse {
  assets: Asset[]
}

export interface CreateProjectRequest {
  name?: string
}

export interface ListProjectsResponse {
  projects: Project[]
}

export interface GetProjectResponse {
  snapshot: ProjectSnapshot
}

export interface PatchItemRequest {
  /** Partial update: x/y/w/h/z, plus text (for CanvasText items). */
  x?: number
  y?: number
  w?: number
  h?: number
  z?: number
  text?: string
}

/** HTTP route catalogue — single source of truth between web + server. */
export interface RenameProjectRequest {
  name: string
}

export interface PlaceAssetRequest {
  assetId: string
  /** World-space top-left. */
  x: number
  y: number
  /** Optional explicit size; defaults to the asset's intrinsic size. */
  w?: number
  h?: number
}

export interface PlaceTextRequest {
  x: number
  y: number
  w?: number
  h?: number
  text?: string
}

export const Routes = {
  projectsList: '/api/projects',
  projectsCreate: '/api/projects',
  projectGet: (id: string) => `/api/projects/${id}`,
  projectPatch: (id: string) => `/api/projects/${id}`,
  projectDelete: (id: string) => `/api/projects/${id}`,
  projectStream: (id: string) => `/api/projects/${id}/stream`,
  chatSend: '/api/chat',
  chatCancel: '/api/chat/cancel',
  uploads: '/api/uploads',
  file: (assetId: string) => `/api/files/${assetId}`,
  itemsPlace: (projectId: string) => `/api/projects/${projectId}/items`,
  itemsPlaceText: (projectId: string) => `/api/projects/${projectId}/items/text`,
  itemPatch: (projectId: string, itemId: string) =>
    `/api/projects/${projectId}/items/${itemId}`,
  itemDelete: (projectId: string, itemId: string) =>
    `/api/projects/${projectId}/items/${itemId}`,
} as const

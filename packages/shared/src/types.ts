// Domain types shared between web and server.

export type ProjectId = string
export type TurnId = string
export type ItemId = string
export type MessageId = string

/** A project is a single infinite-canvas workspace. */
export interface Project {
  id: ProjectId
  name: string
  /** Owning user id. Required for new projects; legacy meta.json files
   *  without ownerId are migrated at server boot (see auth migration). */
  ownerId: string
  createdAt: number
  updatedAt: number
  /** Opaque codex thread id, assigned after the first turn. */
  codexSessionId?: string
  /** Canvas background colour (CSS string). Falls back to theme bg. */
  canvasBg?: string
}

/** Stored file reference (user uploads and agent-generated outputs alike). */
export interface Asset {
  /** Content-addressed id. */
  id: string
  mime: string
  width?: number
  height?: number
  /** Bytes on disk. */
  size: number
  /** Absolute server path. The web client loads via /api/files/:id. */
  absPath: string
  /** Source tag: "upload" | "codex". */
  source: 'upload' | 'codex'
  createdAt: number
}

/** Canvas tile — the primitive the user pans/zooms around. */
export type CanvasItem =
  | CanvasImage
  | CanvasText
  | CanvasGroup

export interface CanvasItemBase {
  id: ItemId
  /** World-space x/y (top-left in our coordinate system). */
  x: number
  y: number
  w: number
  h: number
  /** Render order. Higher = on top. */
  z: number
  /** Which turn produced this item, if any. */
  turnId?: TurnId
  /** For variant grids. */
  variantIndex?: number
  createdAt: number
}

export interface CanvasImage extends CanvasItemBase {
  kind: 'image'
  assetId: string
}

export interface CanvasText extends CanvasItemBase {
  kind: 'text'
  text: string
  /** Font size in world-space pixels. Optional; defaults to 16. */
  fontSize?: number
  /** CSS color string. Optional; defaults to the theme foreground. */
  color?: string
}

export interface CanvasGroup extends CanvasItemBase {
  kind: 'group'
  label?: string
  childIds: ItemId[]
}

/** A single chat message in the conversation stream. */
export type ChatMessage = UserMessage | AgentMessage

export interface UserMessage {
  id: MessageId
  role: 'user'
  turnId: TurnId
  text: string
  /** Asset ids attached to the turn (reference images). */
  attachedAssetIds: string[]
  /** Variant count requested at send time, for Retry. */
  variantCount?: number
  /** Style preset requested at send time, for Retry. */
  stylePreset?: string
  /** Aspect ratio requested at send time, for Retry. */
  aspectRatio?: string
  /** Codex reasoning budget requested at send time, for Retry. */
  reasoningEffort?: string
  createdAt: number
}

/**
 * Coarse cause of a failed turn. The raw `error` string comes straight
 * from codex and is meant for logs; this is what the UI maps to an
 * actionable message.
 */
export type AgentErrorKind =
  | 'canceled'
  | 'quota'
  | 'auth'
  | 'upstream'
  | 'no-output'
  | 'crashed'
  | 'interrupted'
  | 'internal'
  | 'unknown'

export interface AgentMessage {
  id: MessageId
  role: 'agent'
  turnId: TurnId
  /** Status of the turn. "streaming" | "completed" | "failed". */
  status: 'streaming' | 'completed' | 'failed'
  /** Aggregated final text body. May still be empty while streaming. */
  text: string
  /** Short status line shown while streaming (e.g. "Thinking", "Editing file foo.ts"). */
  statusLine?: string
  /** Items the agent attached to this turn — canvas ids, not inlined. */
  producedItemIds: ItemId[]
  error?: string
  errorKind?: AgentErrorKind
  createdAt: number
  completedAt?: number
}

export interface ProjectSnapshot {
  project: Project
  items: CanvasItem[]
  assets: Record<string, Asset>
  chat: ChatMessage[]
}

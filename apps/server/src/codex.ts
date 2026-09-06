import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  AgentErrorKind,
  AgentMessage,
  CanvasImage,
  CanvasItem,
  ChatMessage,
  GenerationPlan,
  UserMessage,
} from '@vissor/shared'
import { ASPECT_DIMS, imageSlotPosition } from '@vissor/shared'
import { projectBus } from './bus.js'
import { resolveCodex } from './codexPath.js'
import { ensureWatcher, flushWatcher, setHandler } from './imageWatcher.js'
import { runExclusive } from './mutex.js'
import { turnScratchDir } from './paths.js'
import { buildPromptForCodex, parseGenerationPlan, PLAN_PREFIX } from './systemPrompt.js'
import {
  appendChat,
  appendItemOp,
  getProject,
  ingestFile,
  readChat,
  rewriteChat,
  updateProject,
} from './store.js'

// ---------- codex stdout schema (0.122) ----------

type CodexJson =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed' }
  | { type: 'turn.failed'; error?: { message?: string } }
  | { type: 'item.started'; item: CodexItem }
  | { type: 'item.updated'; item: CodexItem }
  | { type: 'item.completed'; item: CodexItem }
  | { type: 'error'; message?: string }
  | Record<string, unknown>

type CodexItem =
  | { type: 'agent_message'; text?: string }
  | { type: 'reasoning'; text?: string }
  | { type: 'command_execution'; command?: string }
  | { type: 'file_change'; path?: string }
  | { type: 'mcp_tool_call'; name?: string }
  | { type: 'web_search'; query?: string }
  | { type: 'todo_list'; items?: unknown[] }
  | { type: string; [k: string]: unknown }

// ---------- turn orchestration ----------

interface RunTurnParams {
  projectId: string
  turnId: string
  text: string
  attachedImagePaths: string[]
  variantCount?: number
  stylePreset?: string
  aspectRatio?: string
  reasoningEffort?: string
}

function validReasoningEffort(v: string | undefined): string | null {
  if (!v) return null
  return v === 'low' || v === 'medium' || v === 'high' || v === 'xhigh'
    ? v
    : null
}

const CODEX_MODEL = process.env.VISSOR_CODEX_MODEL ?? 'gpt-6-astra'
const CODEX_SERVICE_TIER = process.env.VISSOR_CODEX_SERVICE_TIER ?? 'fast'

/** Cap the longest tile side so canvas stays readable regardless of
 *  the source image's resolution (codex routinely emits 1024+ pixel
 *  PNGs). Aspect ratio is preserved. */
const MAX_TILE_SIDE = 512
const DEFAULT_SLOW_WARN_MS = 60_000
const DEFAULT_DEAD_AIR_MS = 180_000
const SLOW_WARN_MS = readPositiveIntEnv(
  'VISSOR_CODEX_SLOW_WARN_MS',
  DEFAULT_SLOW_WARN_MS,
)
const DEAD_AIR_MS = readPositiveIntEnv(
  'VISSOR_CODEX_DEAD_AIR_MS',
  DEFAULT_DEAD_AIR_MS,
)
const MAX_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [2_000, 8_000]
const RETRY_BUDGET_MS = readPositiveIntEnv(
  'VISSOR_CODEX_RETRY_BUDGET_MS',
  DEAD_AIR_MS + 120_000,
)

const NON_RETRYABLE_ERROR = [
  /usage limit/i,
  /purchase more credits/i,
  /insufficient[_ ]quota/i,
  /rate[_ ]limit/i,
  /not logged in/i,
  /unauthorized/i,
  /invalid api key/i,
]

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function clampTileSize(w: number, h: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= MAX_TILE_SIDE) return { w, h }
  const scale = MAX_TILE_SIDE / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

async function placeNewImageItem(
  projectId: string,
  turnId: string,
  assetId: string,
  variantIndex: number,
  width: number,
  height: number,
  defaultTileSize?: { w: number; h: number },
): Promise<CanvasImage> {
  const TILE_W = defaultTileSize?.w ?? 512
  const TILE_H = defaultTileSize?.h ?? 512
  const { readItems } = await import('./store.js')
  const items = await readItems(projectId)
  const { x, y } = imageSlotPosition(items, turnId, variantIndex)
  const now = Date.now()
  const sized = clampTileSize(width || TILE_W, height || TILE_H)
  const item: CanvasImage = {
    id: randomUUID(),
    kind: 'image',
    assetId,
    x,
    y,
    w: sized.w,
    h: sized.h,
    z: now,
    turnId,
    variantIndex,
    createdAt: now,
  }
  await appendItemOp(projectId, { op: 'add', item })
  return item
}

export async function runTurn(params: RunTurnParams): Promise<void> {
  // Serialise all turns for a given project. Two chat sends for the
  // same project that overlap would corrupt chat.jsonl (the finaliser
  // in one race reads stale chat and overwrites the other's edits).
  return runExclusive(`turn:${params.projectId}`, () =>
    runTurnInner(params),
  )
}

// ---------- cancel plumbing ----------

interface CancelHandle {
  turnId: string
  cancel: () => void
}

/**
 * Per-project active cancel handle. At most one in-flight turn exists
 * per project (the mutex guarantees this), so a Map keyed by projectId
 * is enough — no queueing needed.
 */
const cancelHandles = new Map<string, CancelHandle>()

/**
 * Invoked by the HTTP cancel route. Returns true if a matching
 * in-flight turn existed and was signalled, false otherwise (the turn
 * finished on its own, or it was never running here).
 */
export function cancelTurn(projectId: string, turnId: string): boolean {
  const h = cancelHandles.get(projectId)
  if (!h || h.turnId !== turnId) return false
  h.cancel()
  return true
}

/**
 * Shutdown path: signal every in-flight turn to abort. Each turn's
 * finaliser will then mark the agent message failed before the
 * process exits. The next startup's `reconcileStuckTurns` also
 * catches anything that raced past us.
 */
export function cancelAllTurns(): number {
  const n = cancelHandles.size
  for (const h of cancelHandles.values()) h.cancel()
  return n
}

/**
 * Signal any in-flight turn for a project to abort, then wait for
 * the project's turn mutex to idle — i.e. the finaliser has written
 * chat.jsonl and released resources. Used before destructive
 * project-level operations (delete, reset) so the finaliser can't
 * race with us and resurrect a deleted project by recreating its
 * chat/items files mid-delete.
 */
export async function cancelAndWaitForProjectIdle(
  projectId: string,
): Promise<void> {
  cancelHandles.get(projectId)?.cancel()
  // Enqueue a no-op under the same key as runTurn to block until
  // any current turn's finaliser has released the mutex.
  await runExclusive(`turn:${projectId}`, async () => undefined)
}

interface AttemptResult {
  variantCount: number
  textChunks: string[]
  turnError: string | null
  exitCode: number | null
  ourKill: boolean
  didFail: boolean
  errorText: string | undefined
  stalled: boolean
  canceled: boolean
}

function classifyFailure(
  errorText: string | undefined,
  canceled: boolean,
): AgentErrorKind {
  if (canceled) return 'canceled'
  const t = errorText ?? ''
  if (!t) return 'unknown'
  if (/usage limit|purchase more credits|insufficient[_ ]quota|rate[_ ]limit/i.test(t)) {
    return 'quota'
  }
  if (/not logged in|unauthorized|invalid api key|authentication/i.test(t)) {
    return 'auth'
  }
  if (/stalled|no response from codex|disconnect|websocket|stream|reconnecting|upstream/i.test(t)) {
    return 'upstream'
  }
  if (/without producing any images|produced no output/i.test(t)) {
    return 'no-output'
  }
  if (/only produced|generation plan/i.test(t)) return 'incomplete-output'
  if (/exited with code|was terminated/i.test(t)) return 'crashed'
  if (/^internal error/i.test(t)) return 'internal'
  return 'unknown'
}

function isRetryableFailure(result: AttemptResult): boolean {
  if (!result.didFail || result.canceled) return false
  if (result.variantCount > 0) return false
  const text = result.errorText ?? ''
  return !NON_RETRYABLE_ERROR.some((re) => re.test(text))
}

/**
 * Sleep between attempts while staying cancellable: the HTTP cancel
 * route reaches turns through `cancelHandles`, and `runOneAttempt`
 * clears its entry on exit, so without re-registering here a user who
 * hits cancel during the backoff would get no response at all.
 * Resolves true if the wait finished, false if it was cancelled.
 */
function waitBeforeRetry(
  projectId: string,
  turnId: string,
  ms: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (proceeded: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const current = cancelHandles.get(projectId)
      if (current && current.turnId === turnId) {
        cancelHandles.delete(projectId)
      }
      resolve(proceeded)
    }
    const timer = setTimeout(() => finish(true), ms)
    cancelHandles.set(projectId, { turnId, cancel: () => finish(false) })
  })
}

async function runTurnInner(params: RunTurnParams): Promise<void> {
  const { projectId, turnId } = params

  // 1. Create & persist the agent message skeleton.
  const agentMessageId = randomUUID()
  const agent: AgentMessage = {
    id: agentMessageId,
    role: 'agent',
    turnId,
    status: 'streaming',
    text: '',
    producedItemIds: [],
    createdAt: Date.now(),
  }
  await appendChat(projectId, agent)
  projectBus.publish(projectId, {
    kind: 'turn.started',
    turnId,
    agentMessageId,
  })
  projectBus.publish(projectId, {
    kind: 'turn.status',
    turnId,
    statusLine: 'Planning images…',
  })

  try {
    await runTurnCore({
      params,
      agentMessageId,
    })
  } catch (err) {
    // Safety net: any unexpected throw from the core path would have
    // bypassed the classification-based finaliser, leaving the agent
    // message stuck as `streaming`. Mark it failed explicitly so the
    // UI doesn't spin forever. Best-effort — we swallow any error
    // writing this, otherwise we just leak the rescue too.
    try {
      const chat = await readChat(projectId)
      const stillStreaming = chat.some(
        (m) =>
          m.role === 'agent' &&
          m.id === agentMessageId &&
          m.status === 'streaming',
      )
      if (stillStreaming) {
        const msg =
          err instanceof Error ? err.message : 'unknown internal error'
        const next = chat.map<ChatMessage>((m) => {
          if (m.role !== 'agent' || m.id !== agentMessageId) return m
          return {
            ...m,
            status: 'failed',
            error: `Internal error: ${msg}`,
            errorKind: 'internal',
            completedAt: Date.now(),
          } satisfies AgentMessage
        })
        await rewriteChat(projectId, next)
        projectBus.publish(projectId, {
          kind: 'turn.failed',
          turnId,
          error: `Internal error: ${msg}`,
          errorKind: 'internal',
        })
      }
    } catch {
      // intentional — don't double-throw during rescue
    }
    throw err
  }
}

interface RunTurnCoreParams {
  params: RunTurnParams
  agentMessageId: string
}

async function runTurnCore({
  params,
  agentMessageId,
}: RunTurnCoreParams): Promise<void> {
  const {
    projectId,
    turnId,
    text,
    attachedImagePaths,
    variantCount: requestedVariantCount,
    stylePreset,
    aspectRatio,
    reasoningEffort,
  } = params

  const project = await getProject(projectId)
  // Capture the session id ONCE, before any attempt runs. If attempt 1
  // crashes mid-thread.started, the store may now hold a broken thread
  // we don't want to resume from on the retry.
  const initialPriorSessionId = project?.codexSessionId

  // 2. Build argv pieces. commonArgs + promptForCodex are attempt-invariant;
  //    the session-id component varies per attempt (retry can opt out).
  const imageArgs: string[] = []
  for (const p of attachedImagePaths) {
    imageArgs.push('-i', p)
  }
  const effort = validReasoningEffort(reasoningEffort) ?? 'medium'

  const commonArgs = [
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '-c',
    `model="${CODEX_MODEL}"`,
    '-c',
    `service_tier="${CODEX_SERVICE_TIER}"`,
    '-c',
    `model_reasoning_effort=${effort}`,
    ...imageArgs,
  ]
  // Wrap the user's text in the design-agent system prompt. Codex
  // won't reliably pick the image-generation tool without a strong
  // instruction to do so — and will happily hallucinate PNG bytes
  // into apply_patch if left to its own devices.
  const promptForCodex = buildPromptForCodex({
    userText: text,
    hasAttachments: attachedImagePaths.length > 0,
    isResume: !!initialPriorSessionId,
    variantCount: requestedVariantCount,
    stylePreset,
    aspectRatio,
  })

  // 3. Attempt loop. If codex goes completely silent (dead-air guard
  //    fires) and produced nothing, that's almost always an OpenAI
  //    upstream hiccup — retry once, transparently, using the session
  //    id captured above so we don't resume a broken thread.
  // Retry any zero-image failure — covers both "silent stall" and
  // "codex picked the wrong tool and claimed success". Three things
  // stop us: a failure that retrying cannot fix (quota, auth), having
  // produced at least one image (keep what we got), and the elapsed
  // budget — a dead-air stall already burned DEAD_AIR_MS, so retrying
  // it indefinitely would leave the user waiting many minutes.
  const turnStartedAt = Date.now()
  let lastResult: AttemptResult | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await runOneAttempt({
      projectId,
      turnId,
      agentMessageId,
      priorSessionId: initialPriorSessionId,
      commonArgs,
      promptForCodex,
      aspectRatio,
    })
    if (lastResult.canceled) break
    if (!isRetryableFailure(lastResult)) break
    if (attempt >= MAX_ATTEMPTS) break
    const elapsed = Date.now() - turnStartedAt
    if (elapsed >= RETRY_BUDGET_MS) {
      console.error(
        `[codex:${projectId}] retry budget spent (${Math.round(elapsed / 1000)}s) — giving up after attempt ${attempt}`,
      )
      break
    }
    const backoffMs =
      RETRY_BACKOFF_MS[attempt - 1] ??
      RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]
    console.error(
      `[codex:${projectId}] attempt ${attempt} produced 0 images (${lastResult.errorText}) — retrying in ${backoffMs}ms`,
    )
    projectBus.publish(projectId, {
      kind: 'turn.status',
      turnId,
      statusLine: `Upstream failed — retrying in ${Math.round(backoffMs / 1000)}s (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`,
    })
    const proceeded = await waitBeforeRetry(projectId, turnId, backoffMs)
    if (!proceeded) {
      lastResult = {
        ...lastResult,
        canceled: true,
        didFail: true,
        errorText: 'Canceled by user.',
      }
      break
    }
    projectBus.publish(projectId, {
      kind: 'turn.status',
      turnId,
      statusLine: `Retrying (attempt ${attempt + 1} of ${MAX_ATTEMPTS})…`,
    })
  }
  const result = lastResult!

  // 4. Finalise agent message. Everything in the attempt loop was
  //    attempt-local; here we do the one-time chat.jsonl rewrite and
  //    emit the terminal turn.completed / turn.failed bus events.
  const finalText = result.textChunks.join('\n\n')
  const errorKind = result.didFail
    ? classifyFailure(result.errorText, result.canceled)
    : undefined
  const chat = await readChat(projectId)
  const finalChat = chat.map<ChatMessage>((m) => {
    if (m.role !== 'agent' || m.id !== agentMessageId) return m
    return {
      ...m,
      status: result.didFail ? 'failed' : 'completed',
      text: finalText || m.text,
      error: result.errorText,
      errorKind,
      completedAt: Date.now(),
    } satisfies AgentMessage
  })
  await rewriteChat(projectId, finalChat)
  // Send one final text snapshot so any client that only subscribed late
  // has the aggregated result even if they missed the deltas.
  if (finalText) {
    projectBus.publish(projectId, { kind: 'turn.text.final', turnId, text: finalText })
  }
  if (result.didFail) {
    projectBus.publish(projectId, {
      kind: 'turn.failed',
      turnId,
      error: result.errorText ?? 'codex failed',
      errorKind,
    })
  } else {
    projectBus.publish(projectId, { kind: 'turn.completed', turnId })
  }
}

interface OneAttemptParams {
  projectId: string
  turnId: string
  agentMessageId: string
  priorSessionId: string | undefined
  commonArgs: string[]
  promptForCodex: string
  aspectRatio?: string
}

/**
 * Spawn codex once, stream its output, and classify the outcome.
 * Caller decides whether to retry based on {@link AttemptResult.stalled}.
 * All per-attempt state (stdout buffer, dead-air timer, variant count)
 * is scoped to this function so retries start from a clean slate.
 */
async function runOneAttempt(p: OneAttemptParams): Promise<AttemptResult> {
  const {
    projectId,
    turnId,
    agentMessageId,
    priorSessionId,
    commonArgs,
    promptForCodex,
    aspectRatio,
  } = p

  // Option ordering matters for `codex exec resume`: its clap usage is
  // `[OPTIONS] [SESSION_ID] [PROMPT]`, so flags have to come BEFORE
  // the session id, not after. Forget this and codex refuses with
  // "unexpected argument '--json' found".
  const argv = priorSessionId
    ? ['exec', 'resume', ...commonArgs, priorSessionId, '--', promptForCodex]
    : ['exec', ...commonArgs, '--', promptForCodex]

  // Give codex a dedicated scratch dir as its cwd. Codex's tool
  // choice is unreliable — for visual tasks it sometimes invokes
  // image_gen (writes to ~/.codex/generated_images/<thread>/), and
  // sometimes falls back to `magick`/`convert` shell commands that
  // dump files into the cwd. By pointing cwd at a controlled scratch
  // dir per turn, we can scan it at the end of the turn and pick up
  // anything visual codex produced there, while also keeping the
  // real workspace clean.
  const scratch = turnScratchDir(turnId)
  await mkdir(scratch, { recursive: true })
  if (priorSessionId) await ensureWatcher(projectId, priorSessionId)
  // Use 'pipe' for stdin and close it immediately so codex sees EOF
  // and doesn't hang waiting on "additional input from stdin".
  // (Passing 'ignore' here has been observed to leave the child
  // blocked on an open fd in some codex builds.)
  const codexBin = resolveCodex()
  console.error(`[codex:${projectId}] using binary: ${codexBin}`)
  const child = spawn(codexBin, argv, {
    cwd: scratch,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve())
    child.once('error', () => resolve())
  })
  child.stdin.end()

  // Stderr. Codex prints retry/disconnect chatter here when the
  // upstream stream drops; count that as liveness so the dead-air
  // guard doesn't kill a process that's genuinely trying to recover.
  child.stderr.on('data', (chunk) => {
    touchActivity()
    process.stderr.write(`[codex:${projectId}] ${chunk}`)
  })

  // Per-attempt state.
  let variantCount = 0
  let plan: GenerationPlan | null = null
  let requestedCount: number | undefined
  const ingestedAssets = new Set<string>()
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let stdoutBuf = ''
  // Codex 0.122 can emit multiple `item.completed` agent_messages per turn
  // (e.g. a reasoning preamble + the final answer). We concatenate them in
  // order so the UI ends up with the full transcript.
  const textChunks: string[] = []
  let turnError: string | null = null
  let work = Promise.resolve()
  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    work = work.then(operation).catch((err) => {
      turnError = err instanceof Error ? err.message : String(err)
      ourKill = true
      child.kill('SIGTERM')
    })
    return work
  }

  // Force-exit guard. Two scenarios:
  //   (a) "got what we asked for" — once variantCount >= requestedCount,
  //       codex could still try (and fail) to produce "extras"; kill it
  //       eagerly so the user's UI doesn't sit in Thinking… forever.
  //   (b) "dead air" — codex sometimes enters a stream-disconnect retry
  //       loop (OpenAI backend flaking). We detect this as: no stdout
  //       AND no new image files for DEAD_AIR_MS; force-kill.
  // When WE choose to kill, we flip `ourKill` so the exit-handler
  // doesn't mis-classify it as a crash.
  let ourKill = false
  let stalled = false
  let canceled = false
  let lastActivity = Date.now()
  let slowWarned = false
  const touchActivity = () => {
    lastActivity = Date.now()
    slowWarned = false
  }

  // Expose a cancel entry-point while this attempt is running. The HTTP
  // cancel route invokes it to abort the in-flight turn.
  cancelHandles.set(projectId, {
    turnId,
    cancel: () => {
      if (ourKill) return
      canceled = true
      ourKill = true
      turnError = 'Canceled by user.'
      try {
        child.kill('SIGTERM')
      } catch {
        // process may already be exiting
      }
    },
  })
  // At xhigh reasoning effort and for reference-image restoration,
  // codex can legitimately go silent for several minutes before the
  // first image_gen output. Keep the guard configurable so production
  // can trade faster failure detection for fewer false stalls.
  const deadAirTimer = setInterval(() => {
    if (ourKill) return
    const idle = Date.now() - lastActivity
    if (idle > SLOW_WARN_MS && !slowWarned) {
      slowWarned = true
      projectBus.publish(projectId, {
        kind: 'turn.status',
        turnId,
        statusLine: 'Upstream is slow — still waiting on the model…',
      })
    }
    if (idle > DEAD_AIR_MS) {
      turnError =
        variantCount > 0
          ? `No response from codex for ${Math.round(DEAD_AIR_MS / 1000)}s — keeping the ${variantCount} images already produced.`
          : `No response from codex for ${Math.round(DEAD_AIR_MS / 1000)}s (OpenAI upstream stalled).`
      ourKill = true
      stalled = true
      child.kill('SIGTERM')
    }
  }, 5_000)

  const handleLine = async (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let ev: CodexJson
    try {
      ev = JSON.parse(trimmed)
    } catch {
      return
    }
    const type = (ev as { type?: string }).type
    if (type === 'thread.started') {
      const threadId = (ev as { thread_id: string }).thread_id
      await updateProject(projectId, { codexSessionId: threadId })
      projectBus.publish(projectId, {
        kind: 'session.codexId',
        codexSessionId: threadId,
      })
      await ensureWatcher(projectId, threadId, threadId !== priorSessionId)
      setHandler(projectId, (abs) => enqueue(() => onImageProduced(abs)))
    } else if (type === 'item.started') {
      const item = (ev as { item: CodexItem }).item
      const status = statusLineFor(item)
      if (status) {
        projectBus.publish(projectId, {
          kind: 'turn.status',
          turnId,
          statusLine: status,
        })
      }
    } else if (type === 'item.completed') {
      const item = (ev as { item: CodexItem }).item
      if (item.type === 'agent_message') {
        const raw = (item as { text?: string }).text ?? ''
        const visibleLines: string[] = []
        for (const line of raw.split('\n')) {
          if (!line.trim().startsWith(PLAN_PREFIX)) {
            visibleLines.push(line)
            continue
          }
          const parsed = parseGenerationPlan(line.trim())
          if (!parsed) throw new Error('Invalid generation plan. Please retry.')
          if (plan || variantCount > 0) continue
          plan = parsed
          requestedCount = parsed.images.length
          const chat = await readChat(projectId)
          await rewriteChat(projectId, chat.map((m) =>
            m.role === 'agent' && m.id === agentMessageId
              ? { ...m, generationPlan: parsed }
              : m,
          ))
          projectBus.publish(projectId, { kind: 'turn.plan', turnId, plan: parsed })
          projectBus.publish(projectId, {
            kind: 'turn.status', turnId,
            statusLine: `Generating 1 of ${requestedCount}…`,
          })
        }
        const t = visibleLines.join('\n').trim()
        if (t) {
          const delta = textChunks.length ? '\n\n' + t : t
          textChunks.push(t)
          // Stream the chunk to any connected client so the UI updates
          // progressively instead of waiting for the whole turn.
          projectBus.publish(projectId, {
            kind: 'turn.text.delta',
            turnId,
            delta,
          })
        }
      }
    } else if (type === 'turn.failed') {
      const msg = (ev as { error?: { message?: string } }).error?.message ?? 'codex turn failed'
      turnError = msg
    } else if (type === 'error') {
      const msg = (ev as { message?: string }).message ?? 'codex error'
      turnError = msg
    }
  }

  const onImageProduced = async (
    absPath: string,
  ) => {
    if (canceled || (requestedCount !== undefined && variantCount >= requestedCount)) return
    if (!plan || !requestedCount) throw new Error('Missing generation plan before image generation. Please retry.')
    const pid = projectId
    const tid = turnId
    const asset = await ingestFile(pid, absPath, {
      mime: MIME_BY_EXT[extname(absPath).toLowerCase()] ?? 'image/png',
      source: 'codex',
      originalFilename: absPath.split('/').pop() ?? 'ig.png',
    })
    if (ingestedAssets.has(asset.id)) return
    ingestedAssets.add(asset.id)
    projectBus.publish(pid, { kind: 'asset.added', asset })
    const resolvedAspect = plan.aspectRatio ?? aspectRatio
    const tileDims = resolvedAspect
      ? (ASPECT_DIMS as Record<string, { w: number; h: number }>)[resolvedAspect]
      : undefined
    const item = await placeNewImageItem(
      pid,
      tid,
      asset.id,
      variantCount,
      asset.width ?? tileDims?.w ?? 512,
      asset.height ?? tileDims?.h ?? 512,
      tileDims,
    )
    const idx = variantCount
    variantCount++
    touchActivity()
    // Surface visible progress while the turn is streaming — codex
    // doesn't emit any events for image generation itself, so we
    // synthesise a status line per variant as its file lands.
    const done = idx + 1
    const line =
      done >= requestedCount
        ? 'Polishing…'
        : `Generating ${done + 1} of ${requestedCount}…`
    projectBus.publish(pid, {
      kind: 'turn.status',
      turnId: tid,
      statusLine: line,
    })
    projectBus.publish(pid, { kind: 'item.added', item: item as CanvasItem })
    // Early-exit: we've produced the requested count. codex sometimes
    // keeps trying to emit "extras" or enters a retry loop; kill it
    // now rather than letting the UI sit in Thinking… for minutes.
    if (done >= requestedCount && !ourKill) {
      ourKill = true
      // Small grace so codex can flush its last few events (turn.completed
      // or the final agent_message text) before we send SIGTERM.
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM')
      }, 1_500)
    }
    // Track it on the agent message — rewrite chat log.
    const chat = await readChat(pid)
    const next = chat.map((m) =>
      m.role === 'agent' && m.id === agentMessageId
        ? { ...m, producedItemIds: [...m.producedItemIds, item.id] }
        : m,
    )
    await rewriteChat(pid, next)
  }

  if (priorSessionId) {
    setHandler(projectId, (abs) => enqueue(() => onImageProduced(abs)))
  }

  child.stdout.on('data', (chunk: Buffer) => {
    touchActivity()
    stdoutBuf += chunk.toString('utf8')
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() ?? ''
    for (const line of lines) void enqueue(() => handleLine(line))
  })

  try {
    await closed
    if (stdoutBuf.trim().length) await enqueue(() => handleLine(stdoutBuf))
    await work
    await flushWatcher(projectId)
    setHandler(projectId, null)
    await work
    await ingestScratch(scratch, (abs) => enqueue(() => onImageProduced(abs)))
  } finally {
    setHandler(projectId, null)
    clearInterval(deadAirTimer)
    clearTimeout(killTimer)
    const h = cancelHandles.get(projectId)
    if (h && h.turnId === turnId) cancelHandles.delete(projectId)
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }

  const exitCode = child.exitCode
  const exitedBadly = exitCode !== null && exitCode !== 0 && !ourKill
  const killedByOther = exitCode === null && !ourKill
  // Clean-exit + zero images is a failure, not a success: codex
  // sometimes picks the wrong tool (e.g. `imagegen` skill that shells
  // out to a CLI that doesn't exist) and claims completion without
  // writing any files. The user's intent was always "make me pictures",
  // so no pictures === failed turn.
  const cleanExitNoOutput =
    exitCode === 0 && variantCount === 0
  const incomplete = requestedCount !== undefined && variantCount > 0 && variantCount < requestedCount
  const didFail =
    turnError !== null ||
    exitedBadly ||
    killedByOther ||
    (ourKill && variantCount === 0 && stalled) ||
    cleanExitNoOutput ||
    incomplete
  const errorText = didFail
    ? turnError ??
      (incomplete
        ? `Only produced ${variantCount} of ${requestedCount} images. The completed images remain on the canvas.`
        : exitedBadly
        ? `codex exited with code ${exitCode}`
        : killedByOther
          ? 'codex process was terminated'
          : cleanExitNoOutput
            ? 'codex finished without producing any images. Try rephrasing or retrying.'
            : 'codex produced no output')
    : undefined

  return {
    variantCount,
    textChunks,
    turnError,
    exitCode,
    ourKill,
    didFail,
    errorText,
    stalled: stalled && variantCount === 0,
    canceled,
  }
}

function statusLineFor(item: CodexItem): string | null {
  switch (item.type) {
    case 'reasoning':
      return 'Thinking'
    case 'command_execution':
      return `Running: ${(item as { command?: string }).command ?? ''}`.trim()
    case 'file_change':
      return `Editing ${(item as { path?: string }).path ?? 'file'}`
    case 'mcp_tool_call':
      return `Tool: ${(item as { name?: string }).name ?? ''}`.trim()
    case 'web_search':
      return `Searching: ${(item as { query?: string }).query ?? ''}`.trim()
    default:
      return null
  }
}

const INGESTIBLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

async function ingestScratch(
  scratch: string,
  onImage: (path: string) => Promise<void>,
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(scratch)
  } catch {
    return
  }
  const candidates: { abs: string; mtime: number; size: number }[] = []
  for (const name of entries) {
    if (!INGESTIBLE_EXTS.has(extname(name).toLowerCase())) continue
    const abs = join(scratch, name)
    try {
      const s = await stat(abs)
      if (!s.isFile() || s.size === 0) continue
      candidates.push({ abs, mtime: s.mtimeMs, size: s.size })
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => a.mtime - b.mtime)
  for (const c of candidates) {
    await onImage(c.abs)
  }
}

// ---------- public helper used by routes ----------

export async function appendUserMessage(
  projectId: string,
  message: UserMessage,
): Promise<void> {
  await appendChat(projectId, message)
}

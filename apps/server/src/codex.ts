import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  AgentMessage,
  CanvasImage,
  CanvasItem,
  ChatMessage,
  UserMessage,
} from '@vissor/shared'
import { ASPECT_DIMS } from '@vissor/shared'
import { projectBus } from './bus.js'
import { resolveCodex } from './codexPath.js'
import { ensureWatcher, setHandler } from './imageWatcher.js'
import { runExclusive } from './mutex.js'
import { turnScratchDir } from './paths.js'
import { buildPromptForCodex } from './systemPrompt.js'
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
}

/** Place a tile on a fresh row below existing content. */
async function placeNewImageItem(
  projectId: string,
  turnId: string,
  assetId: string,
  variantIndex: number,
  width: number,
  height: number,
  defaultTileSize?: { w: number; h: number },
): Promise<CanvasImage> {
  // Grid layout: all variants of one turn sit on a single horizontal
  // row. Each subsequent turn sits on a new row below.
  const TILE_W = defaultTileSize?.w ?? 512
  const TILE_H = defaultTileSize?.h ?? 512
  const GAP = 24
  const { readItems } = await import('./store.js')
  const items = await readItems(projectId)
  // Variants of the SAME turn share a Y baseline — use the row Y
  // established by the first sibling (if any). Otherwise, create a
  // new row below everything else.
  const siblings = items.filter((i) => i.turnId === turnId)
  const otherItems = items.filter((i) => i.turnId !== turnId)
  const otherMaxY = otherItems.reduce((acc, i) => Math.max(acc, i.y + i.h), 0)
  const rowY = siblings.length > 0
    ? siblings[0].y
    : otherMaxY + (otherItems.length ? GAP : 0)
  // X is left of the farthest-right sibling, or 0 for the first.
  const rowRight = siblings.reduce((acc, i) => Math.max(acc, i.x + i.w), 0)
  const x = siblings.length > 0 ? rowRight + GAP : 0
  const y = rowY
  const now = Date.now()
  const item: CanvasImage = {
    id: randomUUID(),
    kind: 'image',
    assetId,
    x,
    y,
    w: width || TILE_W,
    h: height || TILE_H,
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

async function runTurnInner(params: RunTurnParams): Promise<void> {
  const { projectId, turnId, variantCount: requestedVariantCount } = params

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
  const requestedCount = requestedVariantCount ?? 2
  projectBus.publish(projectId, {
    kind: 'turn.status',
    turnId,
    statusLine:
      requestedCount === 1
        ? 'Generating…'
        : `Generating ${requestedCount} variants…`,
  })

  try {
    await runTurnCore({
      params,
      agentMessageId,
      requestedCount,
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
            completedAt: Date.now(),
          } satisfies AgentMessage
        })
        await rewriteChat(projectId, next)
        projectBus.publish(projectId, {
          kind: 'turn.failed',
          turnId,
          error: `Internal error: ${msg}`,
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
  requestedCount: number
}

async function runTurnCore({
  params,
  agentMessageId,
  requestedCount,
}: RunTurnCoreParams): Promise<void> {
  const {
    projectId,
    turnId,
    text,
    attachedImagePaths,
    variantCount: requestedVariantCount,
    stylePreset,
    aspectRatio,
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
  const commonArgs = [
    '--json',
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    // Intentionally DO NOT override model_reasoning_effort. Earlier
    // code forced "low" on the theory that image tasks don't need
    // heavy reasoning; in practice that starved the model and made it
    // reach for the fake `imagegen` shell skill instead of the native
    // image_gen tool, producing zero-image "successful" turns. The
    // ChatGPT Desktop client runs at the user's configured effort
    // (often "xhigh") and that's what reliably picks image_gen.
    // Keep that parity — inherit whatever is in ~/.codex/config.toml.
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
  const MAX_ATTEMPTS = 2
  let lastResult: AttemptResult | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      projectBus.publish(projectId, {
        kind: 'turn.status',
        turnId,
        statusLine: `Upstream hiccup — retrying (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
      })
    }
    lastResult = await runOneAttempt({
      projectId,
      turnId,
      agentMessageId,
      priorSessionId: initialPriorSessionId,
      commonArgs,
      promptForCodex,
      requestedCount,
      aspectRatio,
    })
    if (lastResult.canceled) break
    // Retry on any zero-image failure — covers both "silent stall"
    // and "codex picked the wrong tool and claimed success" cases. If
    // codex produced at least one image, keep what we got.
    const retryable = lastResult.didFail && lastResult.variantCount === 0
    if (!retryable) break
    if (attempt >= MAX_ATTEMPTS) break
    console.error(
      `[codex:${projectId}] attempt ${attempt} produced 0 images (${lastResult.errorText}) — retrying`,
    )
  }
  const result = lastResult!

  // 4. Finalise agent message. Everything in the attempt loop was
  //    attempt-local; here we do the one-time chat.jsonl rewrite and
  //    emit the terminal turn.completed / turn.failed bus events.
  const finalText = result.textChunks.join('\n\n')
  const chat = await readChat(projectId)
  const finalChat = chat.map<ChatMessage>((m) => {
    if (m.role !== 'agent' || m.id !== agentMessageId) return m
    return {
      ...m,
      status: result.didFail ? 'failed' : 'completed',
      text: finalText || m.text,
      error: result.errorText,
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
  requestedCount: number
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
    requestedCount,
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
  child.stdin.end()

  // Stderr. Codex prints retry/disconnect chatter here when the
  // upstream stream drops; count that as liveness so the dead-air
  // guard doesn't kill a process that's genuinely trying to recover.
  child.stderr.on('data', (chunk) => {
    touchActivity()
    process.stderr.write(`[codex:${projectId}] ${chunk}`)
  })

  // If we already know the thread id from a previous turn, start
  // watching it before we see thread.started. Otherwise we'll
  // register the handler when that event arrives below.
  if (priorSessionId) {
    await ensureWatcher(projectId, priorSessionId)
    setHandler(projectId, async (abs) => {
      await onImageProduced(projectId, turnId, agentMessageId, abs)
    })
  }

  // Per-attempt state.
  let variantCount = 0
  let stdoutBuf = ''
  // Codex 0.122 can emit multiple `item.completed` agent_messages per turn
  // (e.g. a reasoning preamble + the final answer). We concatenate them in
  // order so the UI ends up with the full transcript.
  const textChunks: string[] = []
  let turnError: string | null = null

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
  const SLOW_WARN_MS = 60_000
  // At xhigh reasoning effort the model can legitimately go silent for
  // ~2 min between `reasoning` start and the first image_gen tool
  // call (observed 2m9s in the ChatGPT Desktop reference session).
  // Pad past that, but not so far that a true stall is invisible.
  const DEAD_AIR_MS = 180_000
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
          ? `No response from codex for ${Math.round(DEAD_AIR_MS / 1000)}s — keeping the ${variantCount} variant${variantCount === 1 ? '' : 's'} already produced.`
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
      await ensureWatcher(projectId, threadId)
      setHandler(projectId, async (abs) => {
        await onImageProduced(projectId, turnId, agentMessageId, abs)
      })
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
        const t = (item as { text?: string }).text ?? ''
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
      projectBus.publish(projectId, { kind: 'turn.failed', turnId, error: msg })
    } else if (type === 'error') {
      const msg = (ev as { message?: string }).message ?? 'codex error'
      turnError = msg
      projectBus.publish(projectId, { kind: 'turn.failed', turnId, error: msg })
    }
  }

  const onImageProduced = async (
    pid: string,
    tid: string,
    _agentId: string,
    absPath: string,
  ) => {
    const asset = await ingestFile(pid, absPath, {
      mime: 'image/png',
      source: 'codex',
      originalFilename: absPath.split('/').pop() ?? 'ig.png',
    })
    projectBus.publish(pid, { kind: 'asset.added', asset })
    const tileDims = aspectRatio
      ? (ASPECT_DIMS as Record<string, { w: number; h: number }>)[aspectRatio]
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
      setTimeout(() => {
        if (!child.killed) child.kill('SIGTERM')
      }, 1_500)
    }
    // Track it on the agent message — rewrite chat log.
    const chat = await readChat(pid)
    const next = chat.map((m) =>
      m.role === 'agent' && m.id === _agentId
        ? { ...m, producedItemIds: [...m.producedItemIds, item.id] }
        : m,
    )
    await rewriteChat(pid, next)
  }

  child.stdout.on('data', (chunk: Buffer) => {
    touchActivity()
    stdoutBuf += chunk.toString('utf8')
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop() ?? ''
    for (const line of lines) void handleLine(line)
  })

  // Wait for exit.
  await new Promise<void>((resolve) => {
    child.once('close', () => resolve())
    child.once('error', () => resolve())
  })
  // Flush trailing line.
  if (stdoutBuf.trim().length) await handleLine(stdoutBuf)

  // Grace period for the image watcher to ingest any png that lands
  // right at exit. The watcher itself lives for the life of the
  // server; we just detach our handler so files arriving later aren't
  // attributed to this (now-finished) turn.
  await new Promise((r) => setTimeout(r, 800))
  setHandler(projectId, null)

  // Also scan the scratch dir — codex often falls back to shell tools
  // like `magick`/`convert` that dump output there. Each image we find
  // becomes a tile on the canvas, same as image_gen output.
  await ingestScratch(
    projectId,
    turnId,
    agentMessageId,
    scratch,
    () => variantCount++,
    aspectRatio,
  )
  // Whether or not we found anything, clean up the scratch dir. Keep
  // it small: don't leave generated detritus around forever.
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined)

  clearInterval(deadAirTimer)
  // Release the cancel handle — only do this if we're still the registered
  // owner (defensive; the mutex should already prevent concurrent owners).
  const h = cancelHandles.get(projectId)
  if (h && h.turnId === turnId) cancelHandles.delete(projectId)

  // Classify the outcome:
  //   - Clean exit (code 0): completed.
  //   - Non-zero exit code: failed.
  //   - Killed by us (ourKill): completed if we already got at least
  //     one variant (that was the point — early-exit), else failed
  //     (dead-air with no output).
  //   - Killed by anything else (exitCode null, ourKill false): failed
  //     — user or the system took codex out.
  //   - Also fail if any inline error event was observed on stdout.
  const exitCode = child.exitCode
  const exitedBadly = exitCode !== null && exitCode !== 0
  const killedByOther = exitCode === null && !ourKill
  // Clean-exit + zero images is a failure, not a success: codex
  // sometimes picks the wrong tool (e.g. `imagegen` skill that shells
  // out to a CLI that doesn't exist) and claims completion without
  // writing any files. The user's intent was always "make me pictures",
  // so no pictures === failed turn.
  const cleanExitNoOutput =
    exitCode === 0 && variantCount === 0
  const didFail =
    turnError !== null ||
    exitedBadly ||
    killedByOther ||
    (ourKill && variantCount === 0 && stalled) ||
    cleanExitNoOutput
  const errorText = didFail
    ? turnError ??
      (exitedBadly
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

/**
 * Walk the scratch dir for images, ingest each one as an asset and
 * place it as a tile on the canvas. Ordering is by mtime so variants
 * land in roughly the order codex produced them.
 */
async function ingestScratch(
  projectId: string,
  turnId: string,
  agentMessageId: string,
  scratch: string,
  nextVariantIndex: () => number,
  aspectRatio?: string,
): Promise<void> {
  const tileDims = aspectRatio
    ? (ASPECT_DIMS as Record<string, { w: number; h: number }>)[aspectRatio]
    : undefined
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
    const ext = extname(c.abs).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    const asset = await ingestFile(projectId, c.abs, {
      mime,
      source: 'codex',
      originalFilename: c.abs.split('/').pop() ?? `scratch${ext}`,
    })
    projectBus.publish(projectId, { kind: 'asset.added', asset })
    const idx = nextVariantIndex()
    const item = await placeNewImageItem(
      projectId,
      turnId,
      asset.id,
      idx,
      asset.width ?? tileDims?.w ?? 512,
      asset.height ?? tileDims?.h ?? 512,
      tileDims,
    )
    projectBus.publish(projectId, {
      kind: 'turn.status',
      turnId,
      statusLine: `Variant ${idx + 1} ready`,
    })
    projectBus.publish(projectId, {
      kind: 'item.added',
      item: item as CanvasItem,
    })
    const chat = await readChat(projectId)
    const next = chat.map((m) =>
      m.role === 'agent' && m.id === agentMessageId
        ? { ...m, producedItemIds: [...m.producedItemIds, item.id] }
        : m,
    )
    await rewriteChat(projectId, next)
  }
}

// ---------- public helper used by routes ----------

export async function appendUserMessage(
  projectId: string,
  message: UserMessage,
): Promise<void> {
  await appendChat(projectId, message)
}

/**
 * The system prompt that wraps every user message before handing it
 * to codex. codex is a general-purpose coding agent by default; left
 * to its own devices it will try to fulfil "make me a logo" with
 * apply_patch (writing PNG bytes by hand) or by just claiming to have
 * done the work. This prefix forces the design-agent frame and
 * explicitly rules out the common mis-moves.
 *
 * Keep this short — every token costs latency on every turn.
 */
// Tool selection is the hard part. Codex has two paths to image
// output: the native `image_gen` tool (writes to
// ~/.codex/generated_images/<thread>/) and the `imagegen` skill
// (shell commands writing to cwd). We watch both, but the native
// tool is ~25% faster and more reliable, so the prompt nudges
// toward it and deliberately does NOT mention "save to cwd" —
// the previous version ended that sentence with "…in the current
// working directory" and that one phrase flipped the model into
// the shell-skill path every time.
const BASE_RULES =
  'Generate the requested image(s) using the built-in `image_gen` tool. Do not invoke the `imagegen` skill, shell commands, or apply_patch. Produce 2 visually distinct variants unless the user specifies a different count — call the tool twice with different prompts or seeds. Do not invent filenames or claim output you did not actually generate. After the tool finishes, reply with one short sentence describing what you produced.'

const ASPECT_DESCRIPTIONS: Record<string, string> = {
  square: 'Canvas: 1:1 square.',
  portrait: 'Canvas: portrait (3:4 aspect).',
  landscape: 'Canvas: landscape (4:3 aspect).',
  wide: 'Canvas: wide (16:9 aspect).',
}

const STYLE_DESCRIPTIONS: Record<string, string> = {
  minimal:
    'Style: minimal flat vector, two or three colors, generous whitespace, clean geometry.',
  photoreal:
    'Style: photorealistic, natural lighting, detailed textures, plausible real-world scene.',
  illustration:
    'Style: hand-drawn illustration, warm limited palette, soft edges, editorial feel.',
  '3d':
    'Style: soft 3D render, subtle shadows, pastel background, rounded forms.',
  sketch:
    'Style: pencil or ink sketch, monochrome, visible strokes, rough edges.',
}

export function buildPromptForCodex(opts: {
  userText: string
  hasAttachments: boolean
  isResume: boolean
  variantCount?: number
  stylePreset?: string
  aspectRatio?: string
}): string {
  const parts: string[] = []
  if (opts.hasAttachments) {
    parts.push(
      opts.isResume
        ? 'The attached images are prior iterations; revise them per the request.'
        : 'The attached images are references; draw style or subject cues from them.',
    )
  }
  // Variant count: if the client asked for N, we override the default
  // inside BASE_RULES by prefixing an explicit directive. Keep the
  // wording tight — codex is sensitive to verbosity.
  const variantN = normalizeVariantCount(opts.variantCount)
  const rules =
    variantN !== 2
      ? BASE_RULES.replace(
          'Produce 2 visually distinct variants unless the user specifies a different count',
          `Produce exactly ${variantN} visually distinct variant${variantN === 1 ? '' : 's'}`,
        )
      : BASE_RULES
  parts.push(rules)
  if (opts.stylePreset && STYLE_DESCRIPTIONS[opts.stylePreset]) {
    parts.push(STYLE_DESCRIPTIONS[opts.stylePreset])
  }
  if (opts.aspectRatio && ASPECT_DESCRIPTIONS[opts.aspectRatio]) {
    parts.push(ASPECT_DESCRIPTIONS[opts.aspectRatio])
  }
  parts.push(opts.userText)
  return parts.join('\n\n')
}

function normalizeVariantCount(n: number | undefined): number {
  if (!n) return 2
  const i = Math.floor(n)
  if (i <= 0) return 1
  if (i > 6) return 6 // hard cap — codex gets slow and wasteful beyond this
  return i
}

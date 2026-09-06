import { ASPECT_DIMS, DEFAULT_IMAGE_COUNT, MAX_IMAGE_COUNT, type GenerationPlan } from '@vissor/shared'

export const PLAN_PREFIX = 'VISSOR_IMAGE_PLAN '

const BASE_RULES =
  'Generate images using the built-in `image_gen` tool. Do not invoke the `imagegen` skill, shell commands, or apply_patch. First distinguish the attached input references from the requested output images. A numbered list of different deliverables means separate images with separate purposes, not variants of the entire list. Before calling any tools, send an assistant commentary message consisting of VISSOR_IMAGE_PLAN followed by one line of JSON: {"images":["short title for output 1","short title for output 2"],"aspectRatio":"square"}. List every requested output in order, using the user’s language for titles. aspectRatio may be square, portrait, landscape, or wide; omit it if unspecified. This is a machine-readable plan, not text to draw in the images. Then call image_gen exactly once PER planned image, sequentially in plan order, generating one standalone image file per call. Each tool prompt must describe ONLY that output’s purpose plus shared product, reference, language, dimensions and style requirements. Explicitly request one standalone image in each call. Never combine separate deliverables into a collage, contact sheet, tiled grid, or multipanel image. A comparison or detail layout requested within one deliverable is allowed. Keep the product identity and visual style consistent across the set. Use the original attachments in their given order as references for every output; do not accidentally substitute a newly generated image for an original reference. Do not invent product specifications absent from the references. Do not invent filenames or claim output you did not generate. Finish with one short sentence describing the images actually produced.'

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
      'The attached images are ordered input references. Determine their roles from the user’s request, even when continuing an earlier conversation.',
    )
  }
  parts.push(BASE_RULES)
  parts.push(
    `The user’s explicit output count or list takes precedence over the UI count. If neither is specified, produce ${opts.variantCount ?? DEFAULT_IMAGE_COUNT} image(s); only use visual variants when no distinct purposes are requested. Plan at most ${MAX_IMAGE_COUNT} outputs per turn. If the user requests more, clearly state the limit and which remaining outputs are deferred.`,
  )
  if (opts.stylePreset && STYLE_DESCRIPTIONS[opts.stylePreset]) {
    parts.push(STYLE_DESCRIPTIONS[opts.stylePreset])
  }
  if (opts.aspectRatio && ASPECT_DESCRIPTIONS[opts.aspectRatio]) {
    parts.push(ASPECT_DESCRIPTIONS[opts.aspectRatio])
  }
  parts.push(opts.userText)
  return parts.join('\n\n')
}

export function parseGenerationPlan(text: string): GenerationPlan | null {
  if (!text.startsWith(PLAN_PREFIX)) return null
  try {
    const value = JSON.parse(text.slice(PLAN_PREFIX.length))
    if (!Array.isArray(value?.images) || value.images.length < 1 || value.images.length > MAX_IMAGE_COUNT) return null
    if (!value.images.every((title: unknown) => typeof title === 'string' && title.trim().length > 0 && title.length <= 200)) return null
    if (value.aspectRatio !== undefined && !Object.hasOwn(ASPECT_DIMS, value.aspectRatio)) return null
    return { images: value.images.map((title: string) => title.trim()), aspectRatio: value.aspectRatio }
  } catch {
    return null
  }
}

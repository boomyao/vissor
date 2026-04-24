// English dictionary. Keep keys grouped by surface. Use `{name}`
// placeholders for interpolation; the `t()` helper does simple
// `{name}` -> variable substitution. The Chinese dictionary must
// keep the exact same key set (enforced by TypeScript via `Dict`).
const en = {
  // Language switcher
  'lang.en': 'English',
  'lang.zh': '简体中文',
  'lang.switch': 'Language',

  // Generic shell
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.export': 'Export',
  'common.exporting': 'Exporting…',
  'common.exportTitle': 'Download project as ZIP (images + manifest)',
  'common.fit': 'Fit',
  'common.fitTitle': 'Fit to content (F)',
  'common.map': 'Map',
  'common.mapTitle': 'Mini-map',
  'common.bg': 'Bg',
  'common.bgTitle': 'Canvas background',
  'common.shortcutsTitle': 'Keyboard shortcuts (?)',
  'common.reload': 'Reload',
  'common.errorTitle': 'Something broke in the UI.',
  'common.loading': 'Loading workspace…',
  'common.loadFailed': 'Could not load: {error}',

  // Auth
  'auth.title': 'Vissor',
  'auth.tagline': 'Sign in to continue',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in…',
  'auth.invalid': 'Wrong username or password',
  'auth.error': 'Could not reach the server. Try again?',
  'auth.signOut': 'Sign out',
  'auth.signedInAs': 'Signed in as {name}',

  // Canvas background presets
  'bg.paper': 'Paper',
  'bg.warm': 'Warm',
  'bg.cool': 'Cool',
  'bg.card': 'Card',
  'bg.slate': 'Slate',

  // Project switcher
  'project.untitled': 'Untitled project',
  'project.new': '+ New project',
  'project.duplicate': 'Duplicate current',
  'project.rename': 'Rename current…',
  'project.delete': 'Delete current…',
  'project.renamePrompt': 'Project name',
  'project.deleteConfirm': 'Delete "{name}"? This cannot be undone.',
  'project.switchFailed': 'Failed to open project: {error}',
  'project.createFailed': 'Failed to create project: {error}',
  'project.duplicateFailed': 'Failed to duplicate project: {error}',

  // Welcome hero
  'hero.metaUntitled': 'Untitled project · {date}',
  'hero.meta': '{project} · {date}',
  'hero.titleLine1': 'What do you want',
  'hero.titleLine2': '{em:to make} today?',
  'hero.subtitle':
    'Describe it below. Each send spawns a cluster of variants on the canvas — drag them, iterate on them, arrange them.',
  'hero.starter.logo': 'A logo for a third-wave coffee brand',
  'hero.starter.lighthouse': 'Editorial illustration of a lighthouse',
  'hero.starter.running': '4 hero frames for a running app',
  'hero.starter.brutalist': 'Architectural moodboard — brutalist',

  // Command bar
  'command.placeholder': 'Describe what you want to create…',
  'command.send': '⏎ Send',
  'command.generate': 'Generate',
  'command.cancelTurn': 'Cancel',
  'command.cancelTurnTitle': 'Cancel this turn',
  'command.addImage': '＋ Image',
  'command.addImageTitle': 'Attach reference image',
  'command.uploading': 'Uploading…',
  'command.iteratingOne': 'Iterating on 1 tile',
  'command.iteratingMany': 'Iterating on {n} tiles',
  'command.countLabel': 'count',
  'command.countTitle': 'Variant count — click to cycle',
  'command.reasoningLabel': 'craft',
  'command.reasoningTitle':
    'How much craft Vissor puts into each batch — higher picks the right tools more reliably and makes variants more distinct, at the cost of latency',
  'command.reasoningLow': 'draft',
  'command.reasoningMedium': 'standard',
  'command.reasoningHigh': 'refined',
  'command.reasoningXhigh': 'polished',

  // Chat feed
  'chat.header': 'Conversation · {n}',
  'chat.show': 'Show conversation',
  'chat.hide': 'Hide',
  'chat.you': 'You',
  'chat.agent': 'Agent',
  'chat.statusThinking': 'Thinking',
  'chat.statusFailed': '· failed',
  'chat.retry': '↻ Retry',
  'chat.retryTitle': 'Retry this turn',

  // Selection toolbar
  'selection.selected': '{n} selected',
  'selection.useAsReference': '↯ Use as reference ({n})',
  'selection.useAsReferenceTitle': 'Attach all as references to the next prompt',
  'selection.align': '▤ Align',
  'selection.alignTitle': 'Align / distribute selected',
  'selection.alignLeft': 'Align left',
  'selection.alignCenterH': 'Center horizontally',
  'selection.alignRight': 'Align right',
  'selection.alignTop': 'Align top',
  'selection.alignCenterV': 'Center vertically',
  'selection.alignBottom': 'Align bottom',
  'selection.distributeH': 'Distribute horizontally',
  'selection.distributeV': 'Distribute vertically',
  'selection.download': '↓ Download ({n})',
  'selection.downloadTitle': 'Download all selected',
  'selection.delete': '✕ Delete ({n})',
  'selection.deleteTitle': 'Delete all selected (Cmd-Z to undo)',
  'selection.clear': 'Clear',
  'selection.clearTitle': 'Clear selection (Esc)',

  // Canvas context menu (empty-area right-click)
  'canvas.insertImage': 'Insert image…',

  // Tile context menu
  'tile.duplicate': 'Duplicate',
  'tile.useAsReference': 'Use as reference',
  'tile.attachedAsReference': 'Attached as reference',
  'tile.generateMore': 'Generate more like this',
  'tile.generateMorePrompt':
    'More variations of this — keep the subject and composition, vary the lighting and palette.',
  'tile.bringToFront': 'Bring to front',
  'tile.sendToBack': 'Send to back',
  'tile.download': 'Download',
  'tile.delete': 'Delete',

  // Context drawer
  'drawer.asset': 'Asset',
  'drawer.id': 'ID',
  'drawer.source': 'Source',
  'drawer.type': 'Type',
  'drawer.size': 'Size',
  'drawer.sizeKb': '{n} KB',
  'drawer.attached': 'Attached',
  'drawer.useAsReference': 'Use as reference',
  'drawer.downloadTitle': 'Download',

  // Mini-map
  'minimap.title': 'Mini-map — click to recentre',

  // Shortcuts overlay
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.group.canvas': 'Canvas',
  'shortcuts.group.tiles': 'Tiles',
  'shortcuts.group.composer': 'Composer',
  'shortcuts.group.history': 'History',
  'shortcuts.group.help': 'Help',
  'shortcuts.canvas.pan': 'Pan',
  'shortcuts.canvas.zoom': 'Zoom',
  'shortcuts.canvas.fit': 'Fit to content',
  'shortcuts.canvas.esc': 'Clear selection / close drawer',
  'shortcuts.tiles.doubleClick': 'Create text tile',
  'shortcuts.tiles.createText': 'Create text tile at viewport centre',
  'shortcuts.tiles.attachRef': 'Attach selected image(s) as reference',
  'shortcuts.tiles.nudge': 'Nudge selected (Shift = 10px)',
  'shortcuts.tiles.delete': 'Delete selected',
  'shortcuts.composer.send': 'Send',
  'shortcuts.composer.newline': 'Newline',
  'shortcuts.composer.recall': 'Recall last prompt',
  'shortcuts.history.undo': 'Undo',
  'shortcuts.history.redo': 'Redo',
  'shortcuts.help.overlay': 'Show this overlay',
  'shortcuts.keys.space': 'Space + drag',
  'shortcuts.keys.scroll': 'Scroll / pinch',
  'shortcuts.keys.doubleClick': 'Double-click empty area',
  'shortcuts.keys.arrows': '← ↑ → ↓',
  'shortcuts.keys.delete': 'Delete / Backspace',
  'shortcuts.keys.enterEmpty': '↑ (empty)',
  'shortcuts.keys.cmdZ': 'Cmd/Ctrl + Z',
  'shortcuts.keys.cmdShiftZ': 'Cmd/Ctrl + Shift + Z',
}

export type Dict = typeof en
export { en }


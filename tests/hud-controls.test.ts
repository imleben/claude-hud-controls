import type { On } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
const REPORT = '/home/me/.claude/hud-controls/session-1.json'
const PENDING = '/home/me/.claude/hud-controls/session-1.pending.json'

// The files the row shares with the HUD statusline, in memory; a missing one reads empty.
function share(on: On, isFull = false, env: Record<string, string> = {}) {
  const files: Record<string, string> = {}
  on('session.id', () => ({ value: 'session-1' }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/me' : env[e.name] }))
  on('fs.read', ($, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', ($, e) => {
    if (isFull) throw new Error('ENOSPC: no space left on device')
    files[e.path] = e.text
    return { value: undefined }
  })
  return files
}

// The engine runs a plugin's command once the turn ends: here, a second on.
const QUEUE: Plugin = {
  name: 'queue',
  tier: 'prepend',
  register(on) {
    on('command.run', async ($, e, next) => {
      if (e.origin.kind === 'plugin') await $.clock.sleep(1000)
      return next(e)
    })
  },
}

// A session mid-turn on the given model, its row mounted with the effort choices open.
async function open(
  $: Engine,
  on: On,
  given: { model?: string; replies?: Record<string, string>; isFull?: boolean; env?: Record<string, string> } = {},
) {
  let model = given.model ?? 'claude-opus-5-5'
  const effortArgs: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = share(on, given.isFull, given.env)
  on('session.model', () => ({ value: model }))
  // The top-level effortLevel reaches only older models, so it is never shown.
  on('settings.read', () => ({
    value: {
      model: /(fable|opus|sonnet|haiku)/.exec(model)?.[1],
      effortLevel: 'medium',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } },
    },
  }))
  on('config.set', { key: 'model' }, ($, e) => {
    model = `claude-${String(e.value)}-5-5`
    return { value: e.value }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', { command: 'effort' }, ($, e) => {
    effortArgs.push(e.args)
    const level = /^(\w+)$/.exec(e.args)?.[1]
    return {
      text:
        given.replies?.[e.args] ??
        (level ? `Set effort level to ${level} (this session only)` : `${e.args} (this session only)`),
    }
  })

  const start = () => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await start()
  const ui = await $.ui.mount({
    plugin: 'hud-controls',
    surface: 'terminal',
    component: 'PromptHint',
    props: { ...PROPS, isWorking: true },
  })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const click = async (label: string) => {
    const x = (await row()).indexOf(label)
    expect(x).toBeGreaterThan(-1)
    await ui.pointer({ type: 'down', x, y: 0, button: 'left', in: 'controls' })
  }
  // A press whose command the queue holds: not awaited, done once it is drawn.
  const press = async (label: string) => {
    const pressing = click(label)
    for (let tries = 0; tries < 50 && (await look(label))?.underline !== true; tries++) {
      await ui.advance(10)
    }
    return { pressing }
  }
  const type = (args: string) =>
    $.command.run({
      command: 'effort',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 200 },
    })
  // With the effort choices open: the level drawn bold, or none.
  const shown = async () => {
    for (const label of ['lw', 'md', 'hg', 'xh', 'mx']) {
      if ((await look(label))?.weight === 'bold') return label
    }
    return ''
  }
  const report = (effort: string, of = model) => {
    files[REPORT] = JSON.stringify({ model: of, effort, at: clock.now() })
  }
  const pending = () => JSON.parse(files[PENDING] ?? '{}') as { effort?: unknown }

  await click(/(Fable|Opus|Sonnet|Haiku)/i.exec(model)?.[1]?.replace(/^./, one => one.toUpperCase()) ?? '')
  return { ui, clock, files, effortArgs, start, look, click, press, type, shown, report, pending }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`clicks switch model, effort, workflows and ultracode on ${surface}`, async ($, on) => {
    let model = 'claude-opus-5-5'
    let saved = 'claude-opus-5-5'
    let workflowsOn = false
    const modelSets: string[] = []
    const modelArgs: string[] = []
    const effortArgs: string[] = []

    mock.clock(on, { now: 1_000_000 })
    share(on)
    on('session.model', () => ({ value: model }))
    on('settings.read', () => ({ value: { effortLevel: 'medium', model: saved } }))
    on('config.set', { key: 'model' }, ($, e) => {
      saved = String(e.value)
      modelSets.push(saved)
      model = `claude-${saved}-5-5`
      return { value: e.value }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('config.list', () => ({
      value: [
        {
          key: 'workflows',
          label: 'Dynamic workflows',
          kind: 'toggle',
          value: workflowsOn,
          provider: { plugin: 'engine', tier: 'core' },
          isLocked: false,
        } as never,
      ],
    }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('config.set', { key: 'workflows' }, ($, e) => {
      workflowsOn = e.value === true
      return { value: e.value }
    })
    on('command.run', { command: 'model' }, ($, e) => {
      modelArgs.push(e.args)
      model = `claude-${e.args}-5-5`
      return { text: `Set model to ${e.args}` }
    })
    on('command.run', { command: 'effort' }, ($, e) => {
      effortArgs.push(e.args)
      if (e.args === 'ultracode on') {
        return {
          text: workflowsOn
            ? 'Ultracode on (this session only): dynamic workflows on every task'
            : 'Ultracode needs dynamic workflows enabled (see /config).',
        }
      }
      return { text: `Set effort level to ${e.args} (this session only)` }
    })

    await $.session.start({ cwd: '/tmp', surface, isInteractive: true })

    const ui = await $.ui.mount({
      plugin: 'hud-controls',
      surface,
      component: 'PromptHint',
      props: PROPS,
    })
    await ui.resize({ columns: 200, rows: 1, in: 'controls' })

    const row = async (y = 0) => (await ui.find({ in: 'controls', key: `row:${y}` }))?.text ?? ''
    // A run by its exact label: its color and weight as drawn.
    const look = async (label: string) =>
      (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
    const click = async (label: string, y = 0) => {
      const x = (await row(y)).indexOf(label)
      expect(x).toBeGreaterThan(-1)
      await ui.pointer({ type: 'down', x, y, button: 'left', in: 'controls' })
    }

    // The running model is its family alone: the saved alias follows its latest release.
    expect(await row()).toBe('Fable Opus Sonnet Haiku │ wf │ uc')
    expect(await ui.find({ text: '? for shortcuts' })).toBeDefined()
    // No Buttons: the pointer has nothing to invert.
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.findAll({ in: 'controls', type: 'Button' })).toHaveLength(0)
    expect(await look('Opus')).toMatchObject({ color: '#f5a46c', weight: 'bold' })
    expect(JSON.stringify(await look('Opus'))).not.toContain('backgroundColor')

    // A press runs /model with the family alias, which switches to the latest;
    // pressing the running model opens the effort choices, again closes them.
    await click('Opus')
    expect(modelArgs).toEqual(['opus'])
    expect(await row()).toContain('│ lw md hg xh mx │')
    await click('Opus')
    expect(modelArgs).toEqual(['opus'])
    expect(await row()).not.toContain('hg')

    // A miss (the space between runs) presses nothing.
    await ui.pointer({ type: 'down', x: 5, y: 0, button: 'left', in: 'controls' })
    expect(modelArgs).toEqual(['opus'])

    await click('Sonnet')
    expect(modelArgs).toEqual(['opus', 'sonnet'])
    expect(await look('Sonnet')).toMatchObject({ weight: 'bold' })

    // Picking an effort keeps the choices open; effort takes the model's color.
    await click('hg')
    expect(effortArgs).toEqual(['high'])
    expect(await look('hg')).toMatchObject({ color: '#7cc8f8', weight: 'bold' })
    expect((await look('Opus'))?.color).not.toBe('#f5a46c')
    // The shown level can be stale, so pressing it runs the command again.
    await click('hg')
    expect(effortArgs).toEqual(['high', 'high'])
    await click('Sonnet')
    expect(await row()).not.toContain('xh')

    // A switch is its name alone: gray while off, the model's color while on.
    await click('uc')
    expect(await look('uc')).toMatchObject({ color: '#7a7a7a' })
    await click('wf')
    expect(await look('wf')).toMatchObject({ color: '#7cc8f8', weight: 'bold' })
    await click('uc')
    expect(await look('uc')).toMatchObject({ color: '#7cc8f8', weight: 'bold' })
    expect(effortArgs).toEqual(['high', 'high', 'ultracode on', 'ultracode on'])

    // A narrow region wraps onto a second row that clicks still reach.
    await ui.resize({ columns: 20, rows: 3, in: 'controls' })
    await click('Haiku', 1)
    expect(modelArgs).toEqual(['opus', 'sonnet', 'haiku'])
  })
}

test('an effort press marks what is queued and trusts only the reply', async ($, on) => {
  const effortArgs: string[] = []
  const toasts: string[] = []
  let finish: (() => void) | undefined
  const REPLIES: Record<string, string> = {
    max: 'Failed to set effort level: max is not available here',
    high: 'Set effort level to high (this session only): Deeper reasoning',
    low: 'Set effort level to low (this session only): Quick answers',
    auto: 'Effort level set to auto (this session only)',
  }

  mock.clock(on, { now: 1_000_000 })
  const files = share(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({
    value: { model: 'opus', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } },
  }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', { command: 'effort' }, async ($, e) => {
    effortArgs.push(e.args)
    // The engine runs a plugin's command once the session is idle.
    if (e.args === 'low') await new Promise<void>(resolve => (finish = resolve))
    return { text: REPLIES[e.args] ?? '' }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'hud-controls',
    surface: 'terminal',
    component: 'PromptHint',
    props: PROPS,
  })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const click = async (label: string) => {
    const x = (await row()).indexOf(label)
    expect(x).toBeGreaterThan(-1)
    await ui.pointer({ type: 'down', x, y: 0, button: 'left', in: 'controls' })
  }

  // A refusal the reply states changes nothing, and the press can be repeated.
  await click('Opus')
  await click('mx')
  await click('mx')
  expect(effortArgs).toEqual(['max', 'max'])
  expect(toasts).toContain('Effort not changed: max is not available here')
  expect(await look('hg')).toMatchObject({ weight: 'bold' })
  expect((await look('mx'))?.weight).not.toBe('bold')

  // Auto clears the shown level, so the level that was shown can be chosen again.
  await $.command.run({
    command: 'effort',
    args: 'auto',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 200 },
  })
  expect((await look('hg'))?.weight).not.toBe('bold')
  await click('hg')
  expect(effortArgs).toEqual(['max', 'max', 'auto', 'high'])

  // Mid-turn the press waits in the engine's queue: it says so, the row and
  // the HUD show the level at once, underlined until it applies, and a second
  // press queues nothing more.
  await ui.redraw({ ...PROPS, isWorking: true })
  const pressing = click('lw')
  while (finish === undefined) await ui.advance(10)
  expect(toasts).toContain('Set effort level to low')
  expect(JSON.parse(files[PENDING] ?? '{}')).toEqual({ effort: 'low' })
  expect(await look('lw')).toMatchObject({ weight: 'bold', underline: true })
  expect((await look('hg'))?.weight).not.toBe('bold')
  await click('lw')
  expect(effortArgs).toEqual(['max', 'max', 'auto', 'high', 'low'])
  finish()
  await pressing
  expect(await look('lw')).toMatchObject({ weight: 'bold' })
  expect((await look('lw'))?.underline).not.toBe(true)
  expect(JSON.parse(files[PENDING] ?? '{}')).toEqual({ effort: null })
})

test('the row shows the level the HUD reports for the running model', async ($, on) => {
  const row = await open($, on, { model: 'claude-haiku-5-5' })
  expect(await row.shown()).toBe('')
  // What Claude Code hands the HUD shows here within a second.
  row.report('max')
  await row.ui.advance(1000)
  expect(await row.shown()).toBe('mx')

  // A switch keeps the level until the HUD reports the new model's: one
  // written for the model before ignored, one for the new model taken at once.
  await row.click('Opus')
  expect(await row.shown()).toBe('mx')
  row.report('xhigh', 'claude-haiku-5-5')
  await row.ui.advance(1000)
  expect(await row.shown()).toBe('mx')
  row.report('high')
  await row.ui.advance(1000)
  expect(await row.shown()).toBe('hg')

  // A report that may predate an applied press waits a second.
  await row.click('lw')
  expect(await row.shown()).toBe('lw')
  row.report('high')
  await row.ui.advance(1000)
  expect(await row.shown()).toBe('lw')
  await row.clock.advance(1500)
  row.report('low')
  await row.ui.advance(1000)
  expect(await row.shown()).toBe('lw')

  // A reload starts the module again mid-session; the level stays.
  await row.start()
  expect(await row.shown()).toBe('lw')
})

// A typed /effort applies from the running turn's next request; a press's
// command waits for the turn to end, so the row puts its level on them.
test('an effort press mid-turn applies to the running turn at once', { plugins: [QUEUE] }, async ($, on) => {
  const sent: unknown[] = []
  on('turn.step', async function* ($, e) {
    sent.push(`${e.agentId ?? 'main'}:${e.model}:${String(e.effort)}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const row = await open($, on)
  const step = async (model = 'claude-opus-5-5', agentId?: string) => {
    const stream = $.turn.step({
      turnId: 't1',
      index: sent.length,
      model,
      effort: 'medium',
      messageCount: 1,
      ...(agentId === undefined ? {} : { agentId }),
    })
    for await (const _ of stream) void _
  }

  await step()
  expect(sent).toEqual(['main:claude-opus-5-5:medium'])
  const pressed = await row.press('xh')
  await step()
  // A subagent keeps its own level, and Haiku never gets one above high.
  await step('claude-opus-5-5', 'agent-1')
  await step('claude-haiku-5-5')
  expect(sent.slice(1)).toEqual([
    'main:claude-opus-5-5:xhigh',
    'agent-1:claude-opus-5-5:medium',
    'main:claude-haiku-5-5:medium',
  ])
  await row.clock.advance(1000)
  await pressed.pressing
  expect(row.effortArgs).toEqual(['xhigh'])
})

// CLAUDE_CODE_EFFORT_LEVEL rules a typed /effort out, so it rules a press out too.
test('an effort press mid-turn leaves an environment-set level alone', { plugins: [QUEUE] }, async ($, on) => {
  const sent: unknown[] = []
  on('turn.step', async function* ($, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const row = await open($, on, { env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } })
  const pressed = await row.press('lw')
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of stream) void _
  expect(sent).toEqual(['high'])
  await row.clock.advance(1000)
  await pressed.pressing
})

test('a press shows at once, and only the last one runs', { plugins: [QUEUE] }, async ($, on) => {
  const row = await open($, on, { replies: { low: 'Kept effort level as medium' } })
  expect(await row.shown()).toBe('hg')

  // Mid-turn a press shows at once, on the row and in the file the HUD reads.
  const first = await row.press('lw')
  expect(await row.look('lw')).toMatchObject({ weight: 'bold', underline: true })
  expect(row.pending()).toEqual({ effort: 'low' })
  const second = await row.press('md')
  expect(await row.look('md')).toMatchObject({ weight: 'bold', underline: true })
  expect((await row.look('lw'))?.weight).not.toBe('bold')
  expect(row.pending()).toEqual({ effort: 'medium' })
  await row.clock.advance(1000)
  await first.pressing
  await second.pressing
  expect(row.effortArgs).toEqual(['medium'])
  expect(await row.look('md')).toMatchObject({ weight: 'bold' })
  expect((await row.look('md'))?.underline).not.toBe(true)
  expect(row.pending()).toEqual({ effort: null })

  // Declining Claude Code's confirmation puts back the level it kept.
  const third = await row.press('lw')
  await row.clock.advance(1000)
  await third.pressing
  expect(await row.shown()).toBe('md')
  expect(row.pending()).toEqual({ effort: null })

  // A second press on ultracode before its command runs takes the first back.
  const on1 = await row.press('uc')
  expect(await row.look('uc')).toMatchObject({ weight: 'bold', underline: true })
  await row.click('uc')
  expect((await row.look('uc'))?.weight).not.toBe('bold')
  await row.clock.advance(1000)
  await on1.pressing
  expect(row.effortArgs).toEqual(['medium', 'low'])
})

test('an /effort typed at the prompt replaces a waiting press', { plugins: [QUEUE] }, async ($, on) => {
  const row = await open($, on)

  const level = await row.press('md')
  await row.type('xhigh')
  const auto = await row.press('lw')
  await row.type('auto')
  expect(row.pending()).toEqual({ effort: null })
  const toggle = await row.press('uc')
  await row.type('ultracode off')
  expect((await row.look('uc'))?.underline).not.toBe(true)
  await row.clock.advance(1000)
  await Promise.all([level.pressing, auto.pressing, toggle.pressing])
  expect(row.effortArgs).toEqual(['xhigh', 'auto', 'ultracode off'])
})

// The engine answers the row's own /effort without its output and records
// that output as the command's transcript rows, from the row's origin.
const ROW = { kind: 'plugin', name: 'hud-controls' } as const
type RowOrigin = typeof ROW | { kind: 'composer' }

async function silent($: Engine, on: On) {
  const state = { workflowsOn: true, hold: undefined as Promise<void> | undefined }
  const toasts: string[] = []
  const effortArgs: string[] = []
  mock.clock(on, { now: 1_000_000 })
  share(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => ({
    value: [
      {
        key: 'workflows',
        label: 'Dynamic workflows',
        kind: 'toggle',
        value: state.workflowsOn,
        provider: { plugin: 'engine', tier: 'core' },
        isLocked: false,
      } as never,
    ],
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', { command: 'effort' }, async ($, e) => {
    effortArgs.push(e.args)
    await state.hold
    return {}
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'hud-controls', surface: 'terminal', component: 'PromptHint', props: PROPS })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const click = async (label: string) =>
    ui.pointer({ type: 'down', x: (await row()).indexOf(label), y: 0, button: 'left', in: 'controls' })
  let id = 0
  const append = (text: string, origin: RowOrigin) =>
    $.session.append({
      message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
      door: 'command',
      origin,
      uuid: `row-${id++}`,
    })
  const header = (args: string, origin: RowOrigin = ROW) =>
    append(
      `<command-name>/effort</command-name>\n<command-message>effort</command-message>\n<command-args>${args}</command-args>`,
      origin,
    )
  const stdout = (printed: string, origin: RowOrigin = ROW) =>
    append(`<local-command-stdout>${printed}</local-command-stdout>`, origin)
  const rows = async (args: string, printed: string) => {
    await header(args)
    await stdout(printed)
  }
  const isPlain = async (label: string) => (await look(label))?.underline !== true
  return { ui, state, toasts, effortArgs, look, click, header, stdout, rows, isPlain }
}

const ON = 'Ultracode on (this session only): dynamic workflows on every task. Effort stays medium.'
const OFF_REPLY = 'Ultracode off. Effort stays medium.'
const ORANGE = '#f5a46c'
const GRAY = '#7a7a7a'

test('a press shows what it asked once it runs, and its rows confirm it', async ($, on) => {
  const row = await silent($, on)
  await row.click('uc')
  expect(row.effortArgs).toEqual(['ultracode on'])
  expect(await row.look('uc')).toMatchObject({ color: ORANGE, weight: 'bold' })
  expect(await row.isPlain('uc')).toBe(true)
  await row.rows('ultracode on', ON)
  expect(await row.look('uc')).toMatchObject({ color: ORANGE, weight: 'bold' })

  // A press after the run starts a new command, even before the first one's rows.
  await row.click('uc')
  expect(row.effortArgs).toEqual(['ultracode on', 'ultracode off'])
  expect(await row.look('uc')).toMatchObject({ color: GRAY })
})

test('each run reads its own rows when several run before them', async ($, on) => {
  const row = await silent($, on)
  await row.click('uc')
  await row.click('Opus')
  await row.click('lw')
  expect(row.effortArgs).toEqual(['ultracode on', 'low'])
  await row.rows('ultracode on', ON)
  await row.rows('low', 'Set effort level to low (this session only)')
  expect(await row.look('uc')).toMatchObject({ color: ORANGE, weight: 'bold' })
  expect(await row.look('lw')).toMatchObject({ weight: 'bold' })
  expect(await row.isPlain('uc')).toBe(true)
  expect(await row.isPlain('lw')).toBe(true)
  // The first run's reply, a refusal, still reaches it after the second ran.
  row.state.workflowsOn = false
  await row.click('uc')
  await row.click('lw')
  await row.rows('ultracode off', 'Failed to set effort level: busy')
  await row.rows('low', 'Set effort level to low (this session only)')
  expect(await row.look('uc')).toMatchObject({ color: ORANGE, weight: 'bold' })
})

test('rows that come during the run count once it ends', async ($, on) => {
  const row = await silent($, on)
  let release: () => void = () => undefined
  row.state.hold = new Promise(resolve => {
    release = resolve
  })
  const pressing = row.click('uc')
  for (let tries = 0; tries < 50 && row.effortArgs.length < 1; tries++) await row.ui.advance(10)
  await row.rows('ultracode on', 'Ultracode needs dynamic workflows enabled (see /config).')
  release()
  await pressing
  expect(await row.look('uc')).toMatchObject({ color: GRAY })
  expect(await row.isPlain('uc')).toBe(true)
  expect(row.toasts).toContain('Ultracode needs Workflow turned on')
})

test('another origin\'s output is not a run\'s reply', async ($, on) => {
  const row = await silent($, on)
  await row.click('uc')
  await row.header('ultracode on')
  await row.stdout('Unrelated output', { kind: 'composer' })
  await row.stdout('Ultracode needs dynamic workflows enabled (see /config).')
  expect(await row.look('uc')).toMatchObject({ color: GRAY })
  expect(row.toasts).toContain('Ultracode needs Workflow turned on')

  // An effort press reads a kept level the same way.
  await row.click('Opus')
  await row.click('mx')
  expect(await row.look('mx')).toMatchObject({ weight: 'bold' })
  await row.rows('max', 'Kept effort level as low')
  expect(await row.look('lw')).toMatchObject({ weight: 'bold' })
  expect(await row.isPlain('mx')).toBe(true)
})

test('a press runs once even when the HUD file cannot be written', async ($, on) => {
  const row = await open($, on, { isFull: true })
  await row.click('lw')
  expect(row.effortArgs).toEqual(['low'])
  expect(await row.look('lw')).toMatchObject({ weight: 'bold' })
  expect((await row.look('lw'))?.underline).not.toBe(true)
})

test('a new session drops a press an ended process left in the HUD file', async ($, on) => {
  const files = share(on)
  files[PENDING] = JSON.stringify({ effort: 'max' })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files[PENDING] ?? '{}')).toEqual({ effort: null })
})

// The /config model row only saves: the running session keeps its model.
test('a model press runs /model, so an older running model moves to the latest', async ($, on) => {
  let model = 'claude-opus-5'
  const modelArgs: string[] = []
  const modelSets: string[] = []
  mock.clock(on, { now: 1_000_000 })
  share(on)
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('config.set', { key: 'model' }, ($, e) => {
    modelSets.push(String(e.value))
    return { value: e.value }
  })
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    model = { opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' }[e.args] ?? e.args
    return { text: `Set model to ${e.args}` }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'hud-controls', surface: 'terminal', component: 'PromptHint', props: PROPS })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const click = async (label: string) =>
    ui.pointer({ type: 'down', x: (await row()).indexOf(label), y: 0, button: 'left', in: 'controls' })

  await click('Opus')
  expect(modelArgs).toEqual(['opus'])
  expect(model).toBe('claude-opus-5-5')
  await click('Fable')
  expect(modelArgs).toEqual(['opus', 'fable'])
  expect(await look('Fable')).toMatchObject({ color: '#c3a6ff', weight: 'bold' })
  expect(await look('Opus')).not.toMatchObject({ weight: 'bold' })
  // Pressed again, the model this row just set only toggles the effort choices.
  await click('Fable')
  await click('Fable')
  expect(modelArgs).toEqual(['opus', 'fable'])
  expect(modelSets).toEqual([])
})

test('a model press mid-turn shows at once, and only the last one runs', { plugins: [QUEUE] }, async ($, on) => {
  let model = 'claude-opus-5-5'
  const modelArgs: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  share(on)
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    model = `claude-${e.args}-5-5`
    return { text: `Set model to ${e.args}` }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'hud-controls',
    surface: 'terminal',
    component: 'PromptHint',
    props: { ...PROPS, isWorking: true },
  })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const press = async (label: string) => {
    const pressing = ui.pointer({ type: 'down', x: (await row()).indexOf(label), y: 0, button: 'left', in: 'controls' })
    for (let tries = 0; tries < 50 && (await look(label))?.underline !== true; tries++) await ui.advance(10)
    return pressing
  }

  const fable = await press('Fable')
  expect(await look('Fable')).toMatchObject({ weight: 'bold', underline: true })
  expect(await look('Opus')).not.toMatchObject({ weight: 'bold' })
  const sonnet = await press('Sonnet')
  expect(await look('Sonnet')).toMatchObject({ weight: 'bold', underline: true })
  await clock.advance(1000)
  await Promise.all([fable, sonnet])
  expect(modelArgs).toEqual(['sonnet'])
  expect(await look('Sonnet')).toMatchObject({ weight: 'bold' })
  expect((await look('Sonnet'))?.underline).not.toBe(true)
})

test('pressing the running model mid-turn takes back a waiting model press', { plugins: [QUEUE] }, async ($, on) => {
  let model = 'claude-opus-5-5'
  const modelArgs: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  share(on)
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    model = `claude-${e.args}-5-5`
    return { text: `Set model to ${e.args}` }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'hud-controls',
    surface: 'terminal',
    component: 'PromptHint',
    props: { ...PROPS, isWorking: true },
  })
  await ui.resize({ columns: 200, rows: 1, in: 'controls' })
  const row = async () => (await ui.find({ in: 'controls', key: 'row:0' }))?.text ?? ''
  const look = async (label: string) =>
    (await ui.find({ in: 'controls', type: 'Text', text: new RegExp(`^${label}$`) }))?.props
  const press = async (label: string) => {
    const pressing = ui.pointer({ type: 'down', x: (await row()).indexOf(label), y: 0, button: 'left', in: 'controls' })
    for (let tries = 0; tries < 50 && (await look(label))?.underline !== true; tries++) await ui.advance(10)
    return pressing
  }

  // The row's own /model opus: the running id is now the one it picked.
  const opus = await press('Opus')
  await clock.advance(1000)
  await opus
  expect(modelArgs).toEqual(['opus'])

  const fable = await press('Fable')
  expect(await look('Fable')).toMatchObject({ weight: 'bold', underline: true })
  await ui.pointer({ type: 'down', x: (await row()).indexOf('Opus'), y: 0, button: 'left', in: 'controls' })
  expect(await look('Opus')).toMatchObject({ weight: 'bold' })
  expect((await look('Fable'))?.underline).not.toBe(true)
  await clock.advance(1000)
  await fable
  expect(modelArgs).toEqual(['opus'])
  expect(model).toBe('claude-opus-5-5')
})

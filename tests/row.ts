import type { On } from 'claude-code'
import type { Engine, Plugin } from 'claude-code/testing'
import { expect, mock } from 'claude-code/testing'

export const PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
export const REPORT = '/home/me/.claude/hud-controls/session-1.json'
export const PENDING = '/home/me/.claude/hud-controls/session-1.pending.json'

// The files the row shares with the HUD statusline, in memory; a missing one reads empty.
export function share(on: On, isFull = false, env: Record<string, string> = {}) {
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
export const QUEUE: Plugin = {
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
export async function open(
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
  // An effort press runs the /model of a model pressed before it.
  const modelArgs: string[] = []
  // Every command the row's presses ran, in order.
  const ran: string[] = []
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    ran.push(`model:${e.args}`)
    model = `claude-${e.args}-5-5`
    return { text: `Set model to ${e.args}` }
  })
  // The prompt box: what the row offers in it, and what the person leaves there.
  // `hold` keeps a read waiting, `holdFill` a write: what the person does meanwhile.
  const prompt: { box: string; hold?: Promise<void>; holdFill?: Promise<void> } = { box: '' }
  on('prompt.read', async () => {
    await prompt.hold
    return { value: { text: prompt.box, cursor: prompt.box.length } }
  })
  on('prompt.fill', async ($, e) => {
    await prompt.holdFill
    prompt.box = e.mode === 'append' ? prompt.box + e.text : e.text
    return { isFilled: true, text: prompt.box, cursor: prompt.box.length }
  })
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('config.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', { command: 'effort' }, ($, e) => {
    effortArgs.push(e.args)
    ran.push(`effort:${e.args}`)
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
  return { ui, clock, files, effortArgs, modelArgs, ran, toasts, prompt, start, look, click, press, type, shown, report, pending, text: row }
}

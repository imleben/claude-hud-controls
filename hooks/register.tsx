import { atom, read, update } from 'claude-code'
import type { ApiContentBlock, EngineInterface, Register } from 'claude-code'
import type { Segment } from './controls'

const modelId = atom({ plugin: 'hud-controls', key: 'modelId' } as const, '')
const effort = atom({ plugin: 'hud-controls', key: 'effort' } as const, '')
const workflows = atom(
  { plugin: 'hud-controls', key: 'workflows' } as const,
  null as boolean | null,
)
const ultracode = atom({ plugin: 'hud-controls', key: 'ultracode' } as const, false)
const effortOpen = atom({ plugin: 'hud-controls', key: 'effortOpen' } as const, false)
// A press whose command waits in the engine's queue (it runs once the session is idle).
// It shows at once, here and on the HUD statusline; only the last press's command runs.
const pendingEffort = atom({ plugin: 'hud-controls', key: 'pendingEffort' } as const, '')
const pendingUltracode = atom({ plugin: 'hud-controls', key: 'pendingUltracode' } as const, false)
// When a reply last changed effort: a HUD report must be written after it.
const changedAt = atom({ plugin: 'hud-controls', key: 'changedAt' } as const, 0)

// Aliases, not ids: the saved model follows each family's latest release.
const MODELS = [
  { alias: 'fable', label: 'Fable', color: '#c3a6ff' },
  { alias: 'opus', label: 'Opus', color: '#f5a46c' },
  { alias: 'sonnet', label: 'Sonnet', color: '#7cc8f8' },
  { alias: 'haiku', label: 'Haiku', color: '#86e0a8' },
] as const

const EFFORTS = [
  { level: 'low', label: 'lw' },
  { level: 'medium', label: 'md' },
  { level: 'high', label: 'hg' },
  { level: 'xhigh', label: 'xh' },
  { level: 'max', label: 'mx' },
] as const

const LEVELS: readonly string[] = EFFORTS.map(one => one.level)

// For a model the engine names without a family (a custom or default id).
const PLAIN = '#e6e6e6'
// A switch that is off.
const OFF = '#7a7a7a'
// A statusline run spawned before a change can still report after it.
const REPORT_LAG_MS = 1000

// Halfway to a dark gray: an option not chosen keeps its hue, dimmer.
function mute(hex: string) {
  const mix = (at: number) =>
    Math.round((parseInt(hex.slice(at, at + 2), 16) + 0x4b) / 2)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(1)}${mix(3)}${mix(5)}`
}

function family(id: string) {
  return MODELS.find(one => id.includes(one.alias))?.alias
}

// The level a new session starts with, until the HUD reports Claude Code's own.
// The top-level effortLevel reaches only older models, so it is not guessed from.
async function settingsEffort($: EngineInterface, id: string) {
  const settings = (await $.settings.read()) as Record<string, unknown>
  const perModel = settings.modelSettings as
    | Record<string, { effortLevel?: unknown } | undefined>
    | undefined
  const level = perModel?.[id.replace(/\[.*\]$/, '')]?.effortLevel
  return typeof level === 'string' ? level : ''
}

async function noteChange($: EngineInterface) {
  const now = await $.clock.now()
  await update($, changedAt, () => now)
}

// Claude Code keeps the session's effort across a model switch, and the HUD
// reports what the new model takes, caps and defaults included.
async function syncModel($: EngineInterface) {
  const id = await $.session.model()
  if ((await read($, modelId)) === id) return
  await update($, modelId, () => id)
}

const bareModel = (id: unknown) =>
  typeof id === 'string' ? id.replace(/\[.*\]$/, '').toLowerCase() : ''

// The files this row shares with the HUD statusline (hud/), per session:
// `<id>.json` the HUD writes with the model and effort Claude Code hands it,
// `<id>.pending.json` this row writes with the level pressed and not yet applied.
async function sharedFile($: EngineInterface, suffix: string) {
  const home = await $.env.get('HOME')
  const id = await $.session.id()
  return home && /^[\w-]+$/.test(id) ? `${home}/.claude/hud-controls/${id}${suffix}` : undefined
}

// The file only shows the press on the statusline: a write that fails costs that, not the press.
async function sharePending($: EngineInterface) {
  const file = await sharedFile($, '.pending.json')
  const level = await read($, pendingEffort)
  if (file) await $.fs.write(file, JSON.stringify({ effort: level || null })).catch(() => undefined)
}

// The HUD's report for the running model, once written after the last reply.
async function syncReport($: EngineInterface) {
  const file = await sharedFile($, '.json')
  const text = file ? await $.fs.read(file) : ''
  const report = JSON.parse(typeof text === 'string' ? text : '') as {
    model?: unknown
    effort?: unknown
    at?: unknown
  }
  if (typeof report.at !== 'number') return
  if (bareModel(report.model) !== bareModel(await read($, modelId))) return
  if (report.at < (await read($, changedAt)) + REPORT_LAG_MS) return
  const level = typeof report.effort === 'string' && LEVELS.includes(report.effort) ? report.effort : ''
  if ((await read($, effort)) !== level) await update($, effort, () => level)
}

// Only what the reply says took effect: a refusal comes back as text, not an error.
async function applyEffortReply($: EngineInterface, text?: string) {
  const reply = text ?? ''
  if (reply === '') return
  await noteChange($)
  if (/needs dynamic workflows/i.test(reply)) {
    $.ui.toast('Ultracode needs Workflow turned on')
  }
  const failed = /^Failed to set effort level: (.*)/i.exec(reply)?.[1]
  if (failed !== undefined) $.ui.toast(`Effort not changed: ${failed}`)
  if (/ultracode on/i.test(reply)) await update($, ultracode, () => true)
  if (/ultracode off/i.test(reply)) await update($, ultracode, () => false)
  // Auto leaves the level to the model, so no level is shown as chosen.
  if (/^(?:Effort level set to auto|Effort set to auto|Cleared effort)/i.test(reply)) {
    await update($, effort, () => '')
  }
  // Declining Claude Code's confirmation keeps the level the session had.
  const kept = /^Kept effort level as (\w+)/i.exec(reply)?.[1]
  if (kept !== undefined) await update($, effort, () => (LEVELS.includes(kept) ? kept : ''))

  const capped = /set to '(\w+)'/i.exec(reply)?.[1]
  const set = /effort level to (\w+)/i.exec(reply)?.[1]
  const level = [capped, set].find(one => one !== undefined && LEVELS.includes(one))
  if (level !== undefined) await update($, effort, () => level)
}

async function pickModel($: EngineInterface, alias: string) {
  const saved = ((await $.settings.read()) as Record<string, unknown>).model
  if (saved === alias && family(await read($, modelId)) === alias) return
  const done = await $.config
    .set({ key: 'model', value: alias })
    .catch((error: unknown) => ({ deny: String(error) }))
  if (done.deny !== undefined) {
    await $.command.run({ command: 'model', args: alias })
  }
  await syncModel($)
}

// A model press opens the effort choices; pressing the running model again closes them.
async function pressModel($: EngineInterface, alias: string) {
  const isSame = family(await read($, modelId)) === alias
  await update($, effortOpen, isOpen => !(isSame && isOpen))
  await pickModel($, alias)
}

// The choices stay open, so the pressed level shows on the row at once.
async function pickEffort($: EngineInterface, level: string, isWorking: boolean) {
  // The same press already waits in the queue.
  if ((await read($, pendingEffort)) === level) return
  await update($, pendingEffort, () => level)
  await sharePending($)
  if (isWorking) $.ui.toast(`Effort ${level}: applies when the current turn ends`)
  // The command hook reads the reply and clears what it applied.
  await $.command.run({ command: 'effort', args: level }).catch(async (error: unknown) => {
    await clearPending($, level)
    throw error
  })
}

async function clearPending($: EngineInterface, args: string) {
  if (/^ultracode /.test(args)) {
    await update($, pendingUltracode, () => false)
    return
  }
  if ((await read($, pendingEffort)) !== args) return
  await update($, pendingEffort, () => '')
  await sharePending($)
}

async function toggleWorkflows($: EngineInterface) {
  const isOn = !(await read($, workflows))
  const done = await $.config
    .set({ key: 'workflows', value: isOn })
    .catch((error: unknown) => ({ deny: String(error) }))
  if (done.deny !== undefined) {
    $.ui.toast(`Workflow not changed: ${done.deny}`)
    return
  }
  await update($, workflows, () => done.value === true)
  if (done.value !== true) await update($, ultracode, () => false)
}

async function toggleUltracode($: EngineInterface, isWorking: boolean) {
  // A second press before the first one's command runs takes it back.
  if (await read($, pendingUltracode)) {
    await update($, pendingUltracode, () => false)
    return
  }
  const isOn = !(await read($, ultracode))
  const args = `ultracode ${isOn ? 'on' : 'off'}`
  await update($, pendingUltracode, () => true)
  if (isWorking) $.ui.toast(`Ultracode ${isOn ? 'on' : 'off'}: applies when the current turn ends`)
  await $.command.run({ command: 'effort', args }).catch(async (error: unknown) => {
    await clearPending($, args)
    throw error
  })
}

// Whether a command of this row still stands when the engine runs it: a later
// press or a typed /effort replaced it.
async function isWanted($: EngineInterface, args: string) {
  if (/^ultracode /.test(args)) return read($, pendingUltracode)
  return (await read($, pendingEffort)) === args
}

// An /effort the row runs resolves without its output; the engine records that
// output after it as the command's transcript rows, from the same origin.
// What the run asked for shows once it runs, and its output corrects that.
type Run = { args: string; origin: string; was: { effort: string; ultracode: boolean }; isRead: boolean }
// Runs whose output rows have not come yet, oldest first.
const unread: Run[] = []
// Output rows that came before their run resolved.
const early: { args: string; origin: string; text: string }[] = []
// The /effort args each origin's last command row named, until its output.
const named = new Map<string, string>()
// Enough for every run one turn can queue; older entries are dropped.
const KEEP = 8

function originKey(origin: object) {
  const { kind, name } = origin as { kind?: unknown; name?: unknown }
  return `${String(kind)}:${typeof name === 'string' ? name : ''}`
}

function keep<T>(list: T[], one: T) {
  list.push(one)
  if (list.length > KEEP) list.shift()
}

async function showAsked($: EngineInterface, args: string) {
  const asked = args.trim().toLowerCase()
  if (asked === 'ultracode on') await update($, ultracode, () => true)
  else if (asked === 'ultracode off') await update($, ultracode, () => false)
  else if (asked === 'auto') await update($, effort, () => '')
  else if (LEVELS.includes(asked)) await update($, effort, () => asked)
}

async function readReply($: EngineInterface, run: Run, text: string) {
  if (run.isRead) return
  // A refusal changed nothing: the level or switch goes back to what it was.
  if (/^Failed to set effort level|needs dynamic workflows/i.test(text)) {
    if (/^ultracode /i.test(run.args)) await update($, ultracode, () => run.was.ultracode)
    else await update($, effort, () => run.was.effort)
  }
  await applyEffortReply($, text)
}

// After the run: its output now, from rows that came early, or later from its rows.
async function settleRun($: EngineInterface, run: Run, text?: string) {
  const at = early.findIndex(one => one.args === run.args && one.origin === run.origin)
  const rows = at === -1 ? undefined : early.splice(at, 1)[0]
  if (text !== undefined) {
    // Read already: its rows, early or later, are not read again.
    if (rows === undefined) keep(unread, { ...run, isRead: true })
    return
  }
  await showAsked($, run.args)
  if (rows !== undefined) await readReply($, run, rows.text)
  else keep(unread, run)
}

// The command's rows: its name and args, then what it printed.
async function readCommandRow($: EngineInterface, origin: object, content: readonly ApiContentBlock[]) {
  const key = originKey(origin)
  const text = content.map(one => (one.type === 'text' ? one.text : '')).join('')
  const name = /<command-name>\/?([^<]*)<\/command-name>/.exec(text)?.[1]
  if (name !== undefined) {
    if (name === 'effort') {
      named.set(key, (/<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? '').trim())
    } else named.delete(key)
    return
  }
  if (/<local-command-stderr>/.test(text)) {
    named.delete(key)
    return
  }
  const printed = /<local-command-stdout>([\s\S]*)<\/local-command-stdout>/.exec(text)?.[1]
  const args = named.get(key)
  if (printed === undefined || args === undefined) return
  named.delete(key)
  const at = unread.findIndex(one => one.args === args && one.origin === key)
  if (at === -1) {
    keep(early, { args, origin: key, text: printed })
    return
  }
  const [run] = unread.splice(at, 1)
  if (run) await readReply($, run, printed)
}

// What a press on the controls row runs, by the key of the run pressed.
// A press made while a turn runs queues its command until the turn ends.
function actionFor($: EngineInterface, key: string, isWorking: boolean) {
  const [kind, value = ''] = key.split(':')
  if (kind === 'model' && MODELS.some(one => one.alias === value)) {
    return () => pressModel($, value)
  }
  if (kind === 'effort' && LEVELS.includes(value)) return () => pickEffort($, value, isWorking)
  if (key === 'workflows') return () => toggleWorkflows($)
  if (key === 'ultracode') return () => toggleUltracode($, isWorking)
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const id = await $.session.model()
    // A reload starts the module again mid-session: what it learned stays.
    // A new process has no press waiting: one an ended process left is dropped.
    if ((await read($, modelId)) === '') {
      const level = await settingsEffort($, id)
      if (LEVELS.includes(level)) await update($, effort, () => level)
      await sharePending($)
    }
    await update($, modelId, () => id)
    const row = (await $.config.list()).find(one => one.key === 'workflows')
    await update($, workflows, () => (row ? row.value === true : null))

    return started
  })

  on('session.measure', async ($, e, next) => {
    await syncModel($)

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const level = e.effort
    if (e.agentId === undefined && typeof level === 'string') {
      if ((await read($, effort)) !== level) await update($, effort, () => level)
    }

    return yield* next(e)
  })

  on('config.set', { key: 'model' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined) await syncModel($)

    return done
  }).catch(($, e, next) => next(e))

  on('config.set', { key: 'workflows' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined) {
      await update($, workflows, () => done.value === true)
      if (done.value !== true) await update($, ultracode, () => false)
    }

    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const isRow = e.origin.kind === 'plugin' && e.origin.name === 'hud-controls'
    // Answered here, a replaced press runs nothing.
    if (isRow && !(await isWanted($, e.args))) return {}
    // An /effort typed at the prompt replaces the press of its kind still waiting.
    const typed = isRow ? '' : e.args.trim()
    if (/^ultracode\b/i.test(typed)) {
      await update($, pendingUltracode, () => false)
    } else if (typed !== '') {
      await update($, pendingEffort, () => '')
      await sharePending($)
    }
    const run: Run = {
      args: e.args.trim(),
      origin: originKey(e.origin),
      was: { effort: await read($, effort), ultracode: await read($, ultracode) },
      isRead: false,
    }
    const done = await next(e)
    // Past next, a throw would reach the catch below and run the command again.
    try {
      if (done.text !== undefined) await applyEffortReply($, done.text)
      await settleRun($, run, done.text)
      // It ran: no longer waiting, and a press now starts a new command.
      if (isRow) await clearPending($, e.args)
    } catch (error) {
      $.ui.log(`hud-controls: effort reply not read: ${String(error)}`)
    }

    return done
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'command' }, async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    try {
      await readCommandRow($, e.origin, e.message.content)
    } catch (error) {
      $.ui.log(`hud-controls: effort reply not read: ${String(error)}`)
    }

    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const done = await next(e)
    await syncModel($)

    return done
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    const { press, isWorking, sync } = (e.data ?? {}) as {
      press?: unknown
      isWorking?: unknown
      sync?: unknown
    }
    // No report yet, or one half written, leaves the row as it is.
    if (e.component === 'PromptHint' && sync === true) await syncReport($).catch(() => undefined)
    const action =
      e.component === 'PromptHint' && typeof press === 'string'
        ? actionFor($, press, isWorking === true)
        : undefined
    if (action) {
      await action().catch((error: unknown) => $.ui.toast(`HUD change failed: ${String(error)}`))
    }

    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // Only a Client region draws clicks without the Button's pointer inversion.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const { Box, Client, Text } = $.ui.resolve(e)
    const id = await read($, modelId)
    const queuedEffort = await read($, pendingEffort)
    const isUltracodeQueued = await read($, pendingUltracode)
    // A press shows as chosen at once; its command applies it when it runs.
    const level = queuedEffort || (await read($, effort))
    const isWorkflowOn = await read($, workflows)
    const isUltracodeOn = (await read($, ultracode)) !== isUltracodeQueued
    const isEffortOpen = await read($, effortOpen)
    const current = MODELS.find(one => one.alias === family(id))
    // Effort and the switches take the running model's color.
    const accent = current?.color ?? PLAIN

    // Full and bold when chosen, muted otherwise; a switch is its own name, gray while off.
    // Underlined while its command waits for the turn to end.
    const run = (
      key: string,
      label: string,
      isActive: boolean,
      color: string,
      idle = mute(color),
      isPending = false,
    ) =>
      ({
        key,
        label,
        color: isActive ? color : idle,
        isBold: isActive,
        isPending,
      }) satisfies Segment
    const bar: Segment = { key: null, label: '│', color: null, isBold: false, isPending: false }

    // A family alone: the saved alias follows its latest release, and the
    // statusline above names the exact version.
    const segments: Segment[] = [
      ...MODELS.map(one => run(`model:${one.alias}`, one.label, one === current, one.color)),
      ...(isEffortOpen
        ? [
            bar,
            ...EFFORTS.map(one =>
              run(
                `effort:${one.level}`,
                one.label,
                one.level === level,
                accent,
                undefined,
                one.level === queuedEffort,
              ),
            ),
          ]
        : []),
      ...(isWorkflowOn === null
        ? []
        : [bar, run('workflows', 'wf', isWorkflowOn, accent, OFF)]),
      bar,
      run('ultracode', 'uc', isUltracodeOn, accent, OFF, isUltracodeQueued),
    ]

    // The engine's hint keeps its row beside the mode label; the controls go last.
    return (
      <Box flexDirection="column">
        {e.props.hint !== '' && (
          <Text dimColor wrap="truncate-end">
            {` ${e.props.hint}`}
          </Text>
        )}
        <Box paddingLeft={1}>
          <Client
            key="controls"
            module="./controls.tsx"
            props={{ segments, isWorking: e.props.isWorking }}
            width="100%"
          />
        </Box>
      </Box>
    )
  })
}

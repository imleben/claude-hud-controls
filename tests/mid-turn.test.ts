import { expect, test } from 'claude-code/testing'
import { open, QUEUE } from './row'

// Requests of a turn already running: a press applies to them, as a typed command does.

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

// A typed /model applies from the running turn's next request; a press's
// command waits for the turn to end, so the row sends the requests to the
// family's newest id Claude Code has sent before. A family never sent waits.
test('a model press mid-turn applies to the running turn at once', { plugins: [QUEUE] }, async ($, on) => {
  const stored: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  const sent: string[] = []
  on('turn.step', async function* ($, e) {
    sent.push(`${e.agentId ?? 'main'}:${e.model}:${String(e.effort)}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const modelArgs: string[] = []
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    return { text: `Set model to ${e.args}` }
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

  // Requests Claude Code sent before teach the row each family's newest id.
  await step('claude-sonnet-5-5')
  await step('claude-sonnet-5')
  await step('claude-opus-5-5', 'agent-1')
  sent.length = 0
  const sonnet = await row.press('Sonnet')
  expect(row.toasts).toContain('Set model to claude-sonnet-5-5')
  await step()
  await step('claude-opus-5-5', 'agent-1')
  expect(sent).toEqual(['main:claude-sonnet-5-5:medium', 'agent-1:claude-opus-5-5:medium'])

  // Fable was never sent here: its press waits for the turn to end.
  const fable = await row.press('Fable')
  expect(row.toasts).toContain('Model fable: applies when the current turn ends')
  await step()
  expect(sent[2]).toBe('main:claude-opus-5-5:medium')
  await row.clock.advance(1000)
  await Promise.all([sonnet.pressing, fable.pressing])
  expect(modelArgs).toEqual(['fable'])
})

// Dates are no release, another provider's id is not this one's, and `[1m]`
// asks for more than the model: none of them misleads a press.
test('a model press mid-turn names the newest id sent from the same provider', { plugins: [QUEUE] }, async ($, on) => {
  const stored: Record<string, unknown> = {}
  on('store.get', ($, e) => ({ value: stored[e.key] }))
  on('store.set', ($, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  const sent: string[] = []
  on('turn.step', async function* ($, e) {
    sent.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const modelArgs: string[] = []
  on('command.run', { command: 'model' }, ($, e) => {
    modelArgs.push(e.args)
    return { text: `Set model to ${e.args}` }
  })
  const row = await open($, on)
  const step = async (model = 'claude-opus-5-5') => {
    const stream = $.turn.step({ turnId: 't1', index: sent.length, model, effort: 'medium', messageCount: 1 })
    for await (const _ of stream) void _
  }

  for (const id of [
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-20250514',
    'us.anthropic.claude-haiku-5-5-v1:0',
    'claude-sonnet-5-5',
    'claude-3-5-sonnet-20241022',
    'claude-fable-5-1[1m]',
  ]) {
    await step(id)
  }
  sent.length = 0
  const presses = [await row.press('Haiku')]
  await step()
  presses.push(await row.press('Sonnet'))
  await step()
  presses.push(await row.press('Fable'))
  await step()
  await step('claude-opus-5-5[1m]')
  expect(sent).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5-5[1m]'])
  await row.clock.advance(1000)
  await Promise.all(presses.map(one => one.pressing))
  expect(modelArgs).toEqual(['fable'])
})

// A uc press has no request to apply to: its line waits in the prompt box, and
// the row asks for Enter, which runs it at once as typed.
test('a uc press mid-turn offers its line in the prompt box and asks for Enter', { plugins: [QUEUE] }, async ($, on) => {
  const row = await open($, on, { replies: { 'ultracode on': 'Ultracode on (this session only): x. Effort stays high.' } })
  const first = await row.press('uc')
  expect(row.prompt.box).toBe('/effort ultracode on')
  expect(await row.text()).toContain('uc ⏎ press Enter')
  expect(row.toasts.at(-1)).toBe('Ultracode on: press Enter to apply now, or it applies when the current turn ends')
  // Enter: the composer empties the box and runs the line at once.
  row.prompt.box = ''
  await row.type('ultracode on')
  expect(await row.text()).not.toContain('Enter')
  expect(await row.look('uc')).toMatchObject({ weight: 'bold' })
  expect((await row.look('uc'))?.underline).not.toBe(true)
  // The queued press it replaced runs nothing when the turn ends.
  await row.clock.advance(1000)
  await first.pressing
  expect(row.effortArgs).toEqual(['ultracode on'])

  // Left in the box, the line goes once the queued run applies it.
  const second = await row.press('uc')
  expect(row.prompt.box).toBe('/effort ultracode off')
  await row.clock.advance(1000)
  await second.pressing
  expect(row.effortArgs).toEqual(['ultracode on', 'ultracode off'])
  expect(row.prompt.box).toBe('')
  expect(await row.text()).not.toContain('Enter')

  // A take-back clears it; a draft of the person's own is never replaced.
  const third = await row.press('uc')
  await row.click('uc')
  expect(row.prompt.box).toBe('')
  expect(await row.text()).not.toContain('Enter')
  await row.clock.advance(1000)
  await third.pressing
  row.prompt.box = 'half a question'
  const fourth = await row.press('uc')
  expect(row.prompt.box).toBe('half a question')
  expect(row.toasts.at(-1)).toBe('Ultracode on: applies when the current turn ends')
  expect(await row.text()).not.toContain('Enter')
  await row.click('uc')
  expect(row.prompt.box).toBe('half a question')
  await row.clock.advance(1000)
  await fourth.pressing
  expect(row.effortArgs).toEqual(['ultracode on', 'ultracode off'])
})

// The box has no compare-and-write: what the person does while the row reads it wins.
test('a uc press mid-turn yields the prompt box to what the person does meanwhile', { plugins: [QUEUE] }, async ($, on) => {
  const row = await open($, on)
  let release = () => {}
  const held = () => (row.prompt.hold = new Promise<void>(resolve => (release = resolve)))

  // Taken back while its offer still reads the box: no line stays behind.
  held()
  const first = await row.press('uc')
  await row.click('uc')
  release()
  row.prompt.hold = undefined
  await row.ui.advance(10)
  expect(row.prompt.box).toBe('')
  expect(await row.text()).not.toContain('Enter')
  await row.clock.advance(1000)
  await first.pressing

  // A draft typed between the offer's read and its write stays as typed.
  row.prompt.holdFill = new Promise<void>(resolve => (release = resolve))
  const second = await row.press('uc')
  row.prompt.box = 'half a question'
  release()
  row.prompt.holdFill = undefined
  await row.ui.advance(10)
  expect(row.prompt.box).toBe('half a question')
  expect(await row.text()).not.toContain('Enter')
  await row.clock.advance(1000)
  await second.pressing

  // An offered line the person clears or edits no longer asks for Enter.
  row.prompt.box = ''
  const third = await row.press('uc')
  expect(await row.text()).toContain('press Enter')
  row.prompt.box = 'a question instead'
  await row.ui.advance(1000)
  expect(await row.text()).not.toContain('Enter')
  await row.clock.advance(1000)
  await third.pressing
  expect(row.prompt.box).toBe('a question instead')
})

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

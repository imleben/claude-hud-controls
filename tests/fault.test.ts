import { atom, read } from 'claude-code'
import type { Hook, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { register } from '../hooks/register'

// The test runner has timers; the mod's own types (es2023, no DOM) do not.
declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

const controlsMount = atom({ plugin: 'hud-controls', key: 'controlsMount' } as const, 0)
const remountedAt = atom({ plugin: 'hud-controls', key: 'remountedAt' } as const, [] as number[])

// The kit raises no `ui.fault`, so the module's own hook is called as the
// engine would, with faults from several surfaces overlapping over a
// compare-and-set store whose every call yields, as the engine's does.
test('overlapping faults mount the row again three times an hour at most', async () => {
  const values = new Map<string, { value: unknown; version: number }>()
  const turn = () => new Promise(resolve => setTimeout(resolve, 0))
  const $ = {
    clock: { now: async () => (await turn(), 1_000_000) },
    state: {
      get: async (ref: { key: string }) => {
        await turn()
        return values.get(ref.key) ?? { value: undefined, version: 0 }
      },
      set: async (ref: { key: string }, value: unknown, options?: { ifVersion?: number }) => {
        await turn()
        const held = values.get(ref.key) ?? { value: undefined, version: 0 }
        if (options?.ifVersion !== undefined && options.ifVersion !== held.version) {
          return { isSet: false, version: held.version }
        }
        values.set(ref.key, { value, version: held.version + 1 })
        return { isSet: true, version: held.version + 1 }
      },
    },
  }
  let fault: Hook<'ui.fault'> | undefined
  const capture = ((event: string, ...rest: unknown[]) => {
    const hook = rest[rest.length - 1] as Hook<'ui.fault'>
    if (event === 'ui.fault') fault = hook
    return { catch: () => undefined }
  }) as unknown as On
  register(capture, {} as never)
  const raise = (phase: 'load' | 'render' | 'run') =>
    fault?.(
      $ as never,
      {
        surface: 'terminal',
        component: 'PromptHint',
        requestId: 'hint',
        element: 'controls',
        module: 'hooks/controls.tsx',
        phase,
        reason: 'ran longer than its 1000ms budget',
      } as never,
      (async () => ({})) as never,
    )

  await raise('load')
  expect(await read($ as never, controlsMount)).toBe(0)

  await Promise.all([raise('run'), raise('render'), raise('run'), raise('run'), raise('run')])
  expect(await read($ as never, controlsMount)).toBe(3)
  expect(await read($ as never, remountedAt)).toHaveLength(3)
})

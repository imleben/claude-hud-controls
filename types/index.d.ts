/** The session's resolved model id, as `$.session.model()` answers it. */
export type HudModelId = string

declare module 'claude-code' {
  interface PluginState {
    'hud-controls': {
      modelId: HudModelId
      effort: string
      workflows: boolean | null
      ultracode: boolean
      effortOpen: boolean
      pendingEffort: string
      effortRuns: number
      pendingUltracode: boolean
      ultracodeKnown: boolean
      pendingModel: string
      draftModel: string
      offeredLine: string
      pickedId: HudModelId
      changedAt: number
    }
  }
}

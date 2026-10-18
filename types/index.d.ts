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
      pendingUltracode: boolean
      changedAt: number
    }
  }
}

import type { Plugin } from '@opencode-ai/plugin'

export const TemperaturePlugin: Plugin = async () => {
  return {
    'chat.params': async (_input, output) => {
      output.temperature = 0
    },
  }
}

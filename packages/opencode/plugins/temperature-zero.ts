import type { PluginModule } from '@opencode-ai/plugin'

export default {
  id: 'temperature-zero',
  server: async () => {
    return {
      'chat.params': async (_input, output) => {
        output.temperature = 0
      },
    }
  },
} satisfies PluginModule

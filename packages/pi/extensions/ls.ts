import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', () => {
    const activeTools = new Set(pi.getActiveTools())
    activeTools.add('ls')
    pi.setActiveTools([...activeTools])
  })
}

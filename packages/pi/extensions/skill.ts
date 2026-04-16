import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs/promises'

export default async function (pi: ExtensionAPI) {
  let toolRegistered = false

  pi.on('input', async () => {
    if (toolRegistered) {
      return
    }

    const skills = pi
      .getCommands()
      .filter(c => c.source === 'skill')
      .map(c => ({
        name: c.name,
        description: c.description,
        path: c.sourceInfo.path,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name))

    let description =
      'Load a specialized skill that provides domain-specific instructions and workflows.'
    if (!skills.length) {
      description += ' No skills are currently available.'
    } else {
      description += `

When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.

The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.

Tool output includes a \`<skill_content name="...">\` block with the loaded content.

The following skills provide specialized sets of instructions for particular tasks
Invoke this tool to load a skill when a task matches one of the available skills listed below:

## Available Skills
${skills.map(s => `- **${s.name}**${s.description ? `: ${s.description}` : ''}`).join('\n')}`
    }

    const infoMap = new Map(
      skills.map(s => [s.name, { ...s, loaded: false, content: '' }]),
    )

    pi.registerTool({
      name: 'skill',
      label: 'Skill',
      description,
      parameters: Type.Object({
        name: Type.String({
          description: 'The name of the skill from available_skills',
        }),
      }),
      execute: async (_toolCallId, { name }) => {
        const info = infoMap.get(name)
        if (!info) {
          const available = skills.map(s => s.name).join(', ')
          throw new Error(
            `Skill "${name}" not found. Available skills: ${available || 'none'}`,
          )
        }

        if (!info.loaded) {
          info.content = await fs.readFile(info.path, 'utf8')
          info.loaded = true
        }

        const dir = path.dirname(info.path)
        const base = pathToFileURL(dir).href

        let text = `<skill_content name="${info.name}">
# Skill: ${info.name}

${info.content.trim()}

Base directory for this skill: ${base}
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
</skill_content>`

        return {
          content: [{ type: 'text', text }],
          details: { name: info.name, dir },
        }
      },
    })

    toolRegistered = true
  })
}

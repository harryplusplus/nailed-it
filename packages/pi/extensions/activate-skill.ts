import {
  type ExtensionAPI,
  stripFrontmatter,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'
import path from 'node:path'
import fs from 'node:fs/promises'
import { Text } from '@mariozechner/pi-tui'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', async () => {
    const skills = pi
      .getCommands()
      .filter(c => c.source === 'skill')
      .map(c => ({
        name: c.name.replace(/^skill:/, ''),
        description: c.description,
        path: c.sourceInfo.path,
      }))
      .toSorted((a, b) => a.name.localeCompare(b.name))

    const promptSnippet =
      'Load a specialized skill that provides domain-specific instructions and workflows'
    let description = `${promptSnippet}.`
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
      name: 'activate_skill',
      label: 'Activate Skill',
      description,
      promptSnippet,
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
          info.content = stripFrontmatter(await fs.readFile(info.path, 'utf8'))
          info.loaded = true
        }

        const dir = path.dirname(info.path)

        let text = `<skill_content name="${info.name}">
${info.content.trim()}

Skill directory: ${dir}
Relative paths in this skill are relative to the skill directory.
</skill_content>`

        return {
          content: [{ type: 'text', text }],
          details: { name: info.name, dir },
        }
      },
      renderResult({ details }, { expanded }) {
        let text = `Skill ${details.name} activated.`
        if (expanded) {
          text += `\nDirectory: ${details.dir}`
        }
        return new Text(text, 0, 0)
      },
    })
  })
}

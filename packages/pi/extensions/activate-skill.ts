import {
  type ExtensionAPI,
  stripFrontmatter,
} from '@mariozechner/pi-coding-agent'
import { Type } from 'typebox'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { Text } from '@mariozechner/pi-tui'

type SkillInfo = {
  name: string
  description: string | undefined
  path: string
  content: string
  loadPromise: Promise<void> | null
}

export default async function (pi: ExtensionAPI) {
  const activatedSkills = new Map<string, string | undefined>()

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

    activatedSkills.clear()

    if (!skills.length) return

    const promptSnippet =
      'Load a specialized skill that provides domain-specific instructions and workflows'
    let description = `${promptSnippet}.`

    description += [
      '',
      'When a task matches one of the skills below, invoke this tool with the skill name to load its full instructions and bundled resources.',
      '',
      '## Available Skills',
      ...skills.map(
        s => `- **${s.name}**${s.description ? `: ${s.description}` : ''}`,
      ),
    ].join('\n')

    const infoMap = new Map<string, SkillInfo>(
      skills.map(s => [s.name, { ...s, loadPromise: null, content: '' }]),
    )

    pi.registerTool({
      name: 'activate_skill',
      label: 'Activate Skill',
      description,
      promptSnippet,
      promptGuidelines: [
        'Before acting on any user request, check if a relevant skill from available_skills should be activated. If so, invoke activate_skill first.',
      ],
      parameters: Type.Object({
        name: Type.Union(skills.map(s => Type.Literal(s.name))),
      }),
      execute: async (_toolCallId, params) => {
        const name: string = params.name
        const info = infoMap.get(name)
        if (!info) {
          const available = skills.map(s => s.name).join(', ')
          throw new Error(
            `Skill "${name}" not found. Available skills: ${available || 'none'}`,
          )
        }

        if (!info.loadPromise) {
          info.loadPromise = (async () => {
            try {
              const raw = await fs.readFile(info.path, 'utf8')
              info.content = stripFrontmatter(raw)
            } catch (err) {
              info.loadPromise = null
              throw new Error(
                `Failed to load skill "${info.name}" from ${info.path}: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          })()
        }

        await info.loadPromise
        activatedSkills.set(name, info.description)

        const dir = path.dirname(info.path)
        const { files: resources, capped } = await listSkillResources(dir)

        let text = [
          `<skill_content name="${info.name}">`,
          info.content.trim(),
          '',
          `Skill directory: ${dir}`,
          'Relative paths in this skill are relative to the skill directory.',
        ]

        if (resources.length) {
          text.push('', '<skill_resources>')
          for (const f of resources) {
            text.push(`  <file>${f}</file>`)
          }
          if (capped) {
            text.push('  <!-- listing capped; more files available -->')
          }
          text.push('</skill_resources>')
        }

        text.push('</skill_content>')

        return {
          content: [{ type: 'text', text: text.join('\n') }],
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

  pi.on('before_agent_start', async event => {
    if (activatedSkills.size === 0) return

    const lines = [...activatedSkills].map(
      ([name, description]) =>
        `- **${name}**${description ? `: ${description}` : ''}`,
    )

    return {
      systemPrompt:
        event.systemPrompt +
        '\n\n' +
        [
          '## Active Skills',
          ...lines,
          '',
          'Re-invoke `activate_skill` if detailed instructions are no longer in context.',
        ].join('\n'),
    }
  })
}

const IGNORE_PREFIXES = ['.', '_']
const IGNORE_NAMES = new Set(['SKILL.md', 'node_modules', '.git'])
const IGNORE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
])
const HIGH_PRIORITY = new Set(['scripts', 'references'])

async function listSkillResources(
  skillDir: string,
  opts: { maxFiles?: number; maxLevels?: number } = {},
): Promise<{ files: string[]; capped: boolean }> {
  const { maxFiles = 20, maxLevels = 2 } = opts
  const files: string[] = []

  async function walk(dir: string, rel: string, depth: number) {
    if (depth >= maxLevels || files.length >= maxFiles) return

    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    const sorted = entries.toSorted((a, b) => {
      const aHigh = HIGH_PRIORITY.has(a.name) ? 0 : 1
      const bHigh = HIGH_PRIORITY.has(b.name) ? 0 : 1
      if (aHigh !== bHigh) return aHigh - bHigh
      return a.name.localeCompare(b.name)
    })

    for (const entry of sorted) {
      if (files.length >= maxFiles) break

      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (IGNORE_PREFIXES.some(prefix => entry.name.startsWith(prefix)))
        continue
      if (IGNORE_NAMES.has(entry.name)) continue

      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1)
      } else {
        if (IGNORE_EXTS.has(path.extname(entry.name).toLowerCase())) continue
        files.push(relPath)
      }
    }
  }

  await walk(skillDir, '', 0)
  return { files, capped: files.length >= maxFiles }
}

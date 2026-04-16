import { $ } from 'execa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const filePath = fileURLToPath(import.meta.url)
const rootDir = path.resolve(path.dirname(filePath), '..')
const piDir = path.join(rootDir, '.pi')
const piHome = path.join(os.homedir(), '.pi')

console.log('Linking .pi directory...')
await $`ln -sfn ${piDir} ${piHome}`

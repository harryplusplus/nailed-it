import { program } from 'commander'
import { submodules } from './commands/submodules.ts'
import { modelsDev } from './commands/models-dev.ts'
import { pi } from './commands/pi.ts'
import { opencode } from './commands/opencode.ts'
import { pg } from './commands/pg.ts'

await program
  .name('cli')
  .addCommand(modelsDev)
  .addCommand(submodules)
  .addCommand(pi)
  .addCommand(opencode)
  .addCommand(pg)
  .parseAsync()

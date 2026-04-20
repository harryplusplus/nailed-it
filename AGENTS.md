# Project Guidelines

## Before Coding

Read the karpathy-guidelines skill before any coding work (writing, reviewing, refactoring).

## TypeScript & package.json

After making changes to TypeScript or package.json files, always run oxfmt and oxlint on the changed files only:

```bash
pnpm oxfmt <path/to/file.ts> <path/to/package.json>    # Format changed files
pnpm oxlint <path/to/file.ts> <path/to/package.json>   # Lint changed files (includes type checking for .ts)
```

Fix any errors or warnings before committing.

### Node.js built-in imports

For the following Node.js built-in modules, use default imports (not destructured named imports):

- `node:path` → `import path from 'node:path'`
- `node:os` → `import os from 'node:os'`
- `node:fs/promises` → `import fs from 'node:fs/promises'`

Use promise-based `node:fs/promises` by default. Synchronous `node:fs` (`readFileSync`, `existsSync`, etc.) blocks the event loop — only use it when environment constraints leave no alternative (e.g. top-level sync init in a non-async context).

Rationale: these are system APIs with flat namespaces designed for qualified access (`path.join()`, `os.homedir()`, `fs.readFile()`). Destructuring makes call sites ambiguous and harder to grep.

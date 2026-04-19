# Project Guidelines

## TypeScript & package.json

After making changes to TypeScript or package.json files, always run oxfmt and oxlint on the changed files only:

```bash
pnpm oxfmt <path/to/file.ts> <path/to/package.json>    # Format changed files
pnpm oxlint <path/to/file.ts> <path/to/package.json>   # Lint changed files (includes type checking for .ts)
```

Fix any errors or warnings before committing.

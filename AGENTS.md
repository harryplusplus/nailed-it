# Project Guidelines

## TypeScript

After making changes to TypeScript files, always run oxfmt and oxlint on the changed files only:

```bash
pnpm oxfmt <file1.ts> <file2.ts>    # Format changed files
pnpm oxlint <file1.ts> <file2.ts>   # Lint changed files (includes type checking)
```

Fix any errors or warnings before committing.

// /// script
// requires-node = ">=20.19.0"
// ///
/**
 * Check Agent Skill TypeScript scripts with oxfmt, oxlint, and tsgolint.
 *
 * Uses configuration bundled in the skill's assets/ directory — works
 * independently of any project-level config files.
 * Requires pnpm (pnpx) to be available.
 *
 * Usage:
 *   pnpm tsx scripts/check.ts <path>... [--fix] [--format-only] [--lint-only] [--typecheck-only]
 *
 * Exit codes:
 *   0: All checks pass
 *   1: One or more checks fail
 *   2: Usage error
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Resolve skill directory relative to this script
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = resolve(__dirname, "..");
const ASSETS_DIR = resolve(SKILL_DIR, "assets");

// ─── CLI argument parsing ───────────────────────────────────────────

interface Args {
  paths: string[];
  fix: boolean;
  formatOnly: boolean;
  lintOnly: boolean;
  typecheckOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const paths: string[] = [];
  let fix = false;
  let formatOnly = false;
  let lintOnly = false;
  let typecheckOnly = false;

  for (const arg of argv) {
    if (arg === "--fix") {
      fix = true;
    } else if (arg === "--format-only") {
      formatOnly = true;
    } else if (arg === "--lint-only") {
      lintOnly = true;
    } else if (arg === "--typecheck-only") {
      typecheckOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      outputError(`Unknown option: ${arg}`);
      process.exit(2);
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0) {
    outputError("No paths specified. Provide at least one file or directory.");
    process.exit(2);
  }

  return { paths, fix, formatOnly, lintOnly, typecheckOnly };
}

function printHelp(): void {
  console.log(`Check Agent Skill TypeScript scripts with oxfmt, oxlint, and tsgolint.

Usage:
  pnpm tsx scripts/check.ts <path>... [--fix] [--format-only] [--lint-only] [--typecheck-only]

Examples:
  pnpm tsx scripts/check.ts scripts/
  pnpm tsx scripts/check.ts scripts/check.ts --fix
  pnpm tsx scripts/check.ts scripts/ --typecheck-only

Options:
  --fix             Auto-fix issues where possible
  --format-only     Only check formatting
  --lint-only       Only run lint checks
  --typecheck-only  Only run type checks
  --help, -h        Show this help message`);
}

// ─── Output helpers ─────────────────────────────────────────────────

function outputJson(data: Record<string, unknown>): void {
  console.log(JSON.stringify(data, null, 2));
}

function outputError(message: string): void {
  process.stderr.write(JSON.stringify({ error: message }) + "\n");
}

// ─── Types ──────────────────────────────────────────────────────────

interface DiagnosticError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
  severity: string;
  fixable: boolean;
}

interface CheckResult {
  status: "pass" | "fail";
  errors: DiagnosticError[];
  changed?: string[];
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface OxlintDiagnostic {
  code?: string;
  message?: string;
  severity?: string;
  filename?: string;
  labels?: Array<{
    span?: { line?: number; column?: number };
  }>;
}

interface OxlintOutput {
  diagnostics?: OxlintDiagnostic[];
}

// ─── Tool execution ─────────────────────────────────────────────────

async function runCommand(cmd: string, args: string[]): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "stdout" in err && "code" in err) {
      const execErr = err as unknown as {
        stdout: string;
        stderr: string;
        code: string | number;
      };
      return {
        stdout: execErr.stdout,
        stderr: execErr.stderr,
        exitCode: typeof execErr.code === "number" ? execErr.code : 1,
      };
    }
    outputError(`Command not found: ${cmd}. Is pnpm installed and on PATH?`);
    process.exit(1);
    throw new Error("unreachable", { cause: err });
  }
}

// ─── Format check (oxfmt) ───────────────────────────────────────────

async function checkFormat(paths: string[], fix: boolean): Promise<CheckResult> {
  const configPath = resolve(ASSETS_DIR, ".oxfmtrc.jsonc");
  if (!existsSync(configPath)) {
    outputError(`Missing oxfmt config: ${configPath}`);
    process.exit(1);
  }

  const cmd = "pnpx";
  const baseArgs = ["oxfmt@latest", "-c", configPath];
  const args = fix ? [...baseArgs, ...paths] : [...baseArgs, "--check", ...paths];

  const { exitCode } = await runCommand(cmd, args);

  // Parse --list-different output for changed files
  const changed: string[] = [];
  if (!fix && exitCode !== 0) {
    const listArgs = ["oxfmt@latest", "-c", configPath, "--list-different", ...paths];
    const listResult = await runCommand(cmd, listArgs);
    for (const line of listResult.stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) changed.push(trimmed);
    }
  }

  return {
    status: exitCode === 0 ? "pass" : "fail",
    errors: [],
    changed: changed.length > 0 ? changed : undefined,
  };
}

// ─── Lint check (oxlint) ────────────────────────────────────────────

function parseOxlintDiagnostics(stdout: string): DiagnosticError[] {
  const errors: DiagnosticError[] = [];
  try {
    const data: OxlintOutput = JSON.parse(stdout);
    for (const d of data.diagnostics ?? []) {
      const label = d.labels?.[0];
      const span = label?.span;
      errors.push({
        file: d.filename ?? "",
        line: span?.line ?? 0,
        col: span?.column ?? 0,
        code: d.code ?? "",
        message: d.message ?? "",
        severity: d.severity ?? "warning",
        fixable: false,
      });
    }
  } catch {
    if (stdout.trim()) {
      errors.push({
        file: "",
        line: 0,
        col: 0,
        code: "parse-error",
        message: stdout.trim(),
        severity: "error",
        fixable: false,
      });
    }
  }
  return errors;
}

async function checkLint(paths: string[], fix: boolean): Promise<CheckResult> {
  const configPath = resolve(ASSETS_DIR, ".oxlintrc.json");
  if (!existsSync(configPath)) {
    outputError(`Missing oxlint config: ${configPath}`);
    process.exit(1);
  }

  const cmd = "pnpx";
  const baseArgs = ["oxlint@latest", "-c", configPath, "--format", "json"];
  const fixArgs = fix ? ["--fix"] : [];
  const args = [...baseArgs, ...fixArgs, ...paths];

  const { stdout, exitCode } = await runCommand(cmd, args);
  const errors = parseOxlintDiagnostics(stdout);

  return {
    status: exitCode === 0 ? "pass" : "fail",
    errors,
  };
}

// ─── Type check (oxlint --type-aware --type-check) ──────────────────

async function checkTypes(paths: string[]): Promise<CheckResult> {
  const configPath = resolve(ASSETS_DIR, ".oxlintrc.json");
  const tsconfigPath = resolve(ASSETS_DIR, "tsconfig.strict.json");
  if (!existsSync(configPath)) {
    outputError(`Missing oxlint config: ${configPath}`);
    process.exit(1);
  }
  if (!existsSync(tsconfigPath)) {
    outputError(`Missing tsconfig: ${tsconfigPath}`);
    process.exit(1);
  }

  // Prefer project tsconfig if available (for node_modules resolution),
  // otherwise fall back to the skill's strict tsconfig.
  const projectTsconfig = resolve(SKILL_DIR, "tsconfig.json");
  const effectiveTsconfig = existsSync(projectTsconfig) ? projectTsconfig : tsconfigPath;

  const cmd = "pnpx";
  const args = [
    "oxlint@latest",
    "--type-aware",
    "--type-check",
    "--tsconfig",
    effectiveTsconfig,
    "-c",
    configPath,
    "--format",
    "json",
    ...paths,
  ];

  const { stdout, exitCode } = await runCommand(cmd, args);
  const errors = parseOxlintDiagnostics(stdout);

  return {
    status: exitCode === 0 ? "pass" : "fail",
    errors,
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const runFormat = !args.lintOnly && !args.typecheckOnly;
  const runLint = !args.formatOnly && !args.typecheckOnly;
  const runTypecheck = !args.formatOnly && !args.lintOnly;

  const results: Record<string, unknown> = { paths: args.paths };
  let overallPass = true;

  if (runFormat) {
    const formatResult = await checkFormat(args.paths, args.fix);
    results.format = formatResult;
    if (formatResult.status === "fail") overallPass = false;
  }

  if (runLint) {
    const lintResult = await checkLint(args.paths, args.fix);
    results.lint = lintResult;
    if (lintResult.status === "fail") overallPass = false;
  }

  if (runTypecheck) {
    const typecheckResult = await checkTypes(args.paths);
    results.typecheck = typecheckResult;
    if (typecheckResult.status === "fail") overallPass = false;
  }

  results.overall = overallPass ? "pass" : "fail";
  outputJson(results);
  process.exit(overallPass ? 0 : 1);
}

main().catch((err: unknown) => {
  outputError(`Unexpected error: ${String(err)}`);
  process.exit(1);
});

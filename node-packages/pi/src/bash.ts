import Parser from 'tree-sitter'

export interface RgPipeEscape {
  /** Byte offset where the escaped pipe starts in the original command string */
  start: number
  /** Byte offset where the escaped pipe ends in the original command string */
  end: number
  /** The text content containing the escaped pipe (e.g. "foo\\|bar") */
  text: string
}

/**
 * Find all `\|` (escaped pipe) occurrences in `rg` command arguments.
 *
 * In Rust regex (used by `rg`), `|` is the alternation operator and does NOT
 * need to be escaped. Writing `\|` matches a literal `|` character instead
 * (unrecognized escapes are treated as literals). This is a common mistake
 * carried over from grep/ERE habits. This function detects `\|` in `rg`
 * arguments and returns their locations.
 *
 * The function is safe to call with any command string — it gracefully handles
 * parse errors and non-`rg` commands.
 *
 * @param parser - A tree-sitter Bash parser instance (reusable across calls)
 * @param command - The raw bash command string to inspect
 * @returns An array of `RgPipeEscape` objects, one per argument containing `\|`
 */
export function findRgPipeEscape(
  parser: Parser,
  command: string,
): RgPipeEscape[] {
  const escapes: RgPipeEscape[] = []
  const tree = parser.parse(command)
  visitNode(tree.rootNode, escapes)
  return escapes
}

function visitNode(node: Parser.SyntaxNode, escapes: RgPipeEscape[]): void {
  if (node.type === 'command') {
    checkRgCommand(node, escapes)
  }

  for (const child of node.children) {
    visitNode(child, escapes)
  }
}

/**
 * Replace all `\|` with `|` in `rg` command arguments, and return the
 * transformed command along with the count of replacements made.
 *
 * This is the auto-fix counterpart of {@link findRgPipeEscape}. It rewrites
 * the command string so that Rust regex alternation works as intended, instead
 * of silently matching a literal `|` character.
 *
 * The function is safe to call with any command string — it gracefully handles
 * parse errors and non-`rg` commands.
 *
 * @param parser - A tree-sitter Bash parser instance (reusable across calls)
 * @param command - The raw bash command string to transform
 * @returns The (possibly modified) command and the number of replacements made
 */
export function replaceRgPipeEscape(
  parser: Parser,
  command: string,
): { command: string; count: number } {
  const escapes = findRgPipeEscape(parser, command)
  if (escapes.length === 0) return { command, count: 0 }

  // Collect absolute byte positions of every `\|` within the command string
  const positions: number[] = []
  for (const escape of escapes) {
    let searchIdx = 0
    while (true) {
      const relIdx = escape.text.indexOf('\\|', searchIdx)
      if (relIdx === -1) break
      positions.push(escape.start + relIdx)
      searchIdx = relIdx + 2
    }
  }

  // Sort descending so earlier indices stay valid as we replace
  positions.sort((a, b) => b - a)

  let result = command
  for (const pos of positions) {
    result = result.slice(0, pos) + '|' + result.slice(pos + 2)
  }

  return { command: result, count: positions.length }
}

function checkRgCommand(node: Parser.SyntaxNode, escapes: RgPipeEscape[]): void {
  const nameNode = node.children.find(c => c.type === 'command_name')
  if (!nameNode) return

  const nameWord = nameNode.children.find(c => c.type === 'word')
  if (!nameWord || nameWord.text !== 'rg') return

  for (const arg of node.children) {
    // Skip single-quoted raw strings — `\|` here is a deliberate literal
    if (arg.type === 'raw_string') continue

    if (arg.type === 'string') {
      const content = arg.children.find(c => c.type === 'string_content')
      if (content && content.text.includes('\\|')) {
        escapes.push({
          start: content.startIndex,
          end: content.endIndex,
          text: content.text,
        })
      }
    } else if (arg.type === 'word') {
      // Skip the command name itself (the "rg" word)
      if (arg === nameWord) continue
      if (arg.text.includes('\\|')) {
        escapes.push({
          start: arg.startIndex,
          end: arg.endIndex,
          text: arg.text,
        })
      }
    }
  }
}

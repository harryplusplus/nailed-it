import { describe, it, expect } from 'vitest'
import Parser from 'tree-sitter'
import Bash from 'tree-sitter-bash'
import { findRgPipeEscape } from './bash.js'

const parser = new Parser()
parser.setLanguage(Bash as unknown as Parser.Language)

describe('findRgPipeEscape', () => {
  describe('detects escaped pipe (\\|) in rg arguments', () => {
    it('double-quoted string: rg "foo\\|bar"', () => {
      const result = findRgPipeEscape(parser, 'rg "foo\\|bar"')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        start: 4,
        end: 12,
        text: 'foo\\|bar',
      })
    })

    it('double-quoted string with additional args: rg "a\\|b" file.txt', () => {
      const result = findRgPipeEscape(parser, 'rg "a\\|b" file.txt')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('a\\|b')
    })

    it('unquoted word: rg foo\\|bar', () => {
      const result = findRgPipeEscape(parser, 'rg foo\\|bar')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('foo\\|bar')
    })

    it('pipeline second command: ps aux | rg "foo\\|bar"', () => {
      const result = findRgPipeEscape(parser, 'ps aux | rg "foo\\|bar"')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('foo\\|bar')
    })

    it('list (&&): echo hi && rg "a\\|b"', () => {
      const result = findRgPipeEscape(parser, 'echo hi && rg "a\\|b"')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('a\\|b')
    })

    it('pipeline first command: rg "foo\\|bar" | head', () => {
      const result = findRgPipeEscape(parser, 'rg "foo\\|bar" | head')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('foo\\|bar')
    })

    it('unquoted word in pipeline: rg foo\\|bar | head', () => {
      const result = findRgPipeEscape(parser, 'rg foo\\|bar | head')
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('foo\\|bar')
    })

    it('multiple \\| escapes in one command: rg "a\\|b" "c\\|d"', () => {
      const result = findRgPipeEscape(parser, 'rg "a\\|b" "c\\|d"')
      expect(result).toHaveLength(2)
      expect(result[0].text).toBe('a\\|b')
      expect(result[1].text).toBe('c\\|d')
    })
  })

  describe('ignores safe usage (no false positives)', () => {
    it('double-quoted string without escape: rg "foo|bar"', () => {
      const result = findRgPipeEscape(parser, 'rg "foo|bar"')
      expect(result).toHaveLength(0)
    })

    it('single-quoted string with \\|: rg \'foo\\|bar\'', () => {
      const result = findRgPipeEscape(parser, "rg 'foo\\|bar'")
      expect(result).toHaveLength(0)
    })

    it('single-quoted string without escape: rg \'foo|bar\'', () => {
      const result = findRgPipeEscape(parser, "rg 'foo|bar'")
      expect(result).toHaveLength(0)
    })

    it('not rg command: grep "foo\\|bar"', () => {
      const result = findRgPipeEscape(parser, 'grep "foo\\|bar"')
      expect(result).toHaveLength(0)
    })

    it('pipeline without escape: ps aux | rg "foo|bar"', () => {
      const result = findRgPipeEscape(parser, 'ps aux | rg "foo|bar"')
      expect(result).toHaveLength(0)
    })

    it('no rg call at all: echo hello', () => {
      const result = findRgPipeEscape(parser, 'echo hello')
      expect(result).toHaveLength(0)
    })

    it('empty string', () => {
      const result = findRgPipeEscape(parser, '')
      expect(result).toHaveLength(0)
    })

    it('rg as substring of another command: grep rg "foo\\|bar"', () => {
      const result = findRgPipeEscape(parser, 'grep rg "foo\\|bar"')
      expect(result).toHaveLength(0)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  commentLines,
  countLines,
  findComments,
  groupComments,
  increases,
  languageOf,
  removeComments
} from '../../../scripts/lib/comments'

const texts = (path: string, text: string) => findComments(path, text).map((comment) => comment.text)
const strip = (path: string, text: string) => removeComments(path, text, findComments(path, text))

describe('findComments', () => {
  it('finds every script comment form', () => {
    const source = '/** doc */\nconst a = 1 // trailing\nconst b = /* inline */ 2\n'
    expect(texts('a.ts', source)).toEqual(['/** doc */', '// trailing', '/* inline */'])
  })

  it('finds comments with no code around them', () => {
    expect(texts('a.ts', '// only\n')).toEqual(['// only'])
    expect(texts('a.ts', 'function f() {\n  // empty body\n}\n')).toEqual(['// empty body'])
  })

  it('ignores comment markers inside strings, templates and regexes', () => {
    const source = "const url = 'https://x.dev/*a*/'\nconst r = /\\/\\//\nconst t = `http://${url} // text`\n"
    expect(texts('a.ts', source)).toEqual([])
  })

  it('finds comments inside template substitutions and shader source', () => {
    expect(texts('a.ts', 'const t = `${/* why */ 1}`\n')).toEqual(['/* why */'])
    expect(texts('a.ts', 'const s = `void main() {\n  gl_Position = p; // clip\n}`\n')).toEqual(['// clip'])
  })

  it('finds comments in every part of an SFC', () => {
    const source = '<script setup lang="ts">\n// script\n</script>\n<!-- root -->\n<template>\n  <!-- markup -->\n  <p :a="/* bound */ 1">{{ /* text */ 2 }}</p>\n</template>\n<style>\n/* style */\n</style>\n'
    expect(texts('A.vue', source)).toEqual(
      ['// script', '<!-- root -->', '<!-- markup -->', '/* bound */', '/* text */', '/* style */']
    )
  })

  it('finds comments in the other languages of the repo', () => {
    expect(texts('ci.yml', "a: '#x' # why\nb: don't # why not\n")).toEqual(['# why', '# why not'])
    expect(texts('.gitignore', '# why\na#b\n')).toEqual(['# why'])
    expect(texts('a.py', 'a = "#x"  # why\n')).toEqual(['# why'])
    expect(texts('a.css', 'a { b: url(http://x) } /* why */\n')).toEqual(['/* why */'])
    expect(texts('.husky/pre-commit', 'npm test # why\n')).toEqual(['# why'])
    expect(languageOf('README.md')).toBeNull()
  })

  it('reads a shader template as a whole, and leaves prose templates alone', () => {
    const later = 'const s = `void main() { gl_Position = p; ${N}\n  // hidden\n}`\n'
    expect(texts('a.ts', later)).toEqual(['// hidden'])
    expect(texts('a.ts', 'const s = /* glsl */ `\n// tagged\n`\n')).toEqual(['// tagged'])
    expect(texts('a.ts', 'const s = `float left\n// not a comment`\n')).toEqual([])
    expect(texts('a.ts', 'const s = `uniform distribution\n// not a comment`\n')).toEqual([])
  })

  it('reads JSX text as text', () => {
    expect(texts('a.tsx', 'const a = <p>http://x {/* c */}</p>\n')).toEqual(['/* c */'])
  })

  it('covers shader, style and config files', () => {
    expect(texts('a.glsl', 'float x; // why\n')).toEqual(['// why'])
    expect(texts('a.scss', 'a { b: url(http://x); } // why\n')).toEqual(['// why'])
    expect(texts('a.toml', 'a = 1 # why\n')).toEqual(['# why'])
    expect(texts('Dockerfile', '# why\nFROM x\n')).toEqual(['# why'])
    expect(texts('a.svg', '<svg><!-- why --></svg>\n')).toEqual(['<!-- why -->'])
  })

  it('allows exact tool directives, not prose attached to them', () => {
    const allowed = '#!/usr/bin/env node\n// @ts-expect-error\nconst s = /* glsl */ `x`\n'
    expect(texts('a.ts', allowed)).toEqual([])
    expect(texts('a.ts', '// @ts-expect-error because it is hard\n')).toHaveLength(1)
  })
})

describe('removeComments', () => {
  it('removes whole lines and the blank line they leave', () => {
    expect(strip('a.ts', '// top\n\nconst a = 1\n\n// mid\n\nconst b = 2 // end\n'))
      .toBe('const a = 1\n\nconst b = 2\n')
  })

  it('keeps tokens and line breaks apart', () => {
    expect(strip('a.ts', 'const/**/a = 1\n')).toBe('const a = 1\n')
    expect(strip('a.ts', 'a/*\n*/b\n')).toBe('a\nb\n')
  })

  it('closes a block that held only a comment', () => {
    expect(strip('a.ts', 'try {\n  f()\n} catch {\n  // ignore\n}\n')).toBe('try {\n  f()\n} catch {}\n')
  })

  it('keeps tokens apart inside SFC and HTML scripts', () => {
    expect(strip('A.vue', '<script>\nconst/**/a = 1\n</script>\n')).toContain('const a = 1')
    expect(strip('a.html', '<script>\nlet/**/a = 1\n</script>\n')).toContain('let a = 1')
    expect(strip('A.vue', '<template><p>a<!-- x -->b</p></template>\n')).toContain('<p>ab</p>')
  })

  it('never pulls code into a comment that stays', () => {
    const source = 'function f() {\n  // example {\n  // second\n}\n'
    const second = findComments('a.ts', source)[1]!
    expect(removeComments('a.ts', source, [second])).toBe('function f() {\n  // example {\n}\n')
  })

  it('removes a shader comment that holds a substitution whole', () => {
    expect(strip('a.ts', 'const s = `uniform float x; // n ${N}\n`\n')).toBe('const s = `uniform float x;\n`\n')
  })

  it('keeps CRLF line endings', () => {
    expect(strip('a.ts', 'const a = 1 // x\r\nconst b = 2\r\n')).toBe('const a = 1\r\nconst b = 2\r\n')
  })

  it('groups consecutive line comments', () => {
    const source = '// one\n// two\nconst a = 1 // three\n'
    expect(groupComments(source, findComments('a.ts', source)).map((group) => group.text))
      .toEqual(['// one\n// two', '// three'])
  })
})

describe('ratchet', () => {
  const baseline = countLines(commentLines('a.ts', '// old\n'))

  it('allows a baselined comment to move or disappear', () => {
    expect(increases(countLines(commentLines('b.ts', '  // old\n')), baseline)).toEqual([])
    expect(increases({}, baseline)).toEqual([])
  })

  it('rejects a new, edited or duplicated comment', () => {
    for (const source of ['// new\n', '// old, edited\n', '// old\n// old\n']) {
      expect(increases(countLines(commentLines('a.ts', source)), baseline)).toHaveLength(1)
    }
  })
})

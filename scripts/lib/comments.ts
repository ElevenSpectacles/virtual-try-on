import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { NodeTypes, parse } from '@vue/compiler-dom'
import type { TemplateChildNode } from '@vue/compiler-dom'
import ts from 'typescript'

export interface Range {
  start: number
  end: number
}

export interface Comment extends Range {
  line: number
  endLine: number
  text: string
}

type Language = 'script' | 'jsx' | 'json' | 'vue' | 'html' | 'css' | 'slash' | 'hash' | 'yaml' | 'shell' | 'python'

const SCRIPT = /^\.[cm]?[jt]sx?$/
const HASH_FILES = new Set(['.gitignore', '.gitattributes', '.npmignore', '.npmrc', '.nuxtrc', '.editorconfig'])

const SHADER = /\bgl_[A-Z]|\buniform\s+(?:sampler|[iub]?vec|mat|float|int|bool)|\bvec[234]\s*\(|#include <\w+>|\bvoid\s+main\s*\(/
const COMMENT_MARKER = /\/\/|\/\*|<!--|#/
const GLSL_TAG = /\/\* glsl \*\/\s*$/
const SHADER_COMMENT = /(?<=^|[\s;{}),])(?<comment>\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/gm

const DIRECTIVES = [
  /^\/\/ @ts-expect-error$/,
  /^\/\/\/ <reference (?:path|types|lib)="[^"]+" ?\/>$/,
  /^\/\*[*#]? ?[@#]__(?:PURE|NO_SIDE_EFFECTS)__ ?\*\/$/,
  /^\/\* ?@vite-ignore ?\*\/$/,
  /^\/\* glsl \*\/$/,
  /^\/\/ @vitest-environment [\w-]+$/
]

export function languageOf(path: string): Language | null {
  const name = basename(path)
  const ext = extname(name)
  if (ext === '.tsx' || ext === '.jsx') return 'jsx'
  if (SCRIPT.test(ext)) return 'script'
  if (/^\.(?:glsl|vert|frag|scss|less)$/.test(ext)) return 'slash'
  if (ext === '.vue') return 'vue'
  if (ext === '.html' || ext === '.svg') return 'html'
  if (ext === '.css') return 'css'
  if (ext === '.py') return 'python'
  if (ext === '.yml' || ext === '.yaml') return 'yaml'
  if (ext === '.jsonc' || ext === '.json5' || /^tsconfig.*\.json$/.test(name)) return 'json'
  if (ext === '.sh' || ext === '.toml' || name === 'Dockerfile' || /(^|\/)\.husky\/[^/]+$/.test(path)) return 'shell'
  if (HASH_FILES.has(name) || name === '.env.example') return 'hash'
  return null
}

function scanScript(text: string, kind = ts.ScriptKind.TS): Range[] {
  const source = kind === ts.ScriptKind.JSON
    ? ts.parseJsonText('source.json', text)
    : ts.createSourceFile(kind === ts.ScriptKind.TSX ? 'source.tsx' : 'source.ts', text, ts.ScriptTarget.Latest, true, kind)
  const found = new Map<number, Range>()
  const visit = (node: ts.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      for (const range of scanShader(node, source)) found.set(range.start, range)
    }
    const children = node.kind === ts.SyntaxKind.EndOfFileToken ? [] : node.getChildren(source)
    if (children.length) {
      children.forEach(visit)
      return
    }
    if (node.kind === ts.SyntaxKind.JsxText) return
    for (const range of [
      ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? [])
    ]) {
      found.set(range.pos, { start: range.pos, end: range.end })
    }
  }
  visit(source)
  const all = [...found.values()]
  return all.filter((range) =>
    !all.some((outer) => outer !== range && outer.start < range.start && range.end <= outer.end))
}

function scanShader(node: ts.TemplateLiteral, source: ts.SourceFile): Range[] {
  const start = node.getStart(source) + 1
  let body = source.text.slice(start, node.getEnd() - 1)
  if (ts.isTemplateExpression(node)) {
    let from = node.head.getEnd() - 2
    for (const { literal } of node.templateSpans) {
      const to = literal.getStart(source) + 1
      const blank = source.text.slice(from, to).replace(/[^\r\n]/g, ' ')
      body = body.slice(0, from - start) + blank + body.slice(to - start)
      from = literal.getEnd() - 2
    }
  }
  const tagged = GLSL_TAG.test(source.text.slice(node.getFullStart(), node.getStart(source))) ||
    GLSL_TAG.test(source.text.slice(Math.max(0, node.getStart(source) - 40), node.getStart(source)))
  return tagged || SHADER.test(body) ? shift(scanPattern(body, SHADER_COMMENT), start) : []
}

function scanPattern(text: string, pattern: RegExp): Range[] {
  return [...text.matchAll(pattern)].flatMap((match) => {
    const comment = match.groups?.comment
    if (!comment) return []
    const start = match.index + match[0].length - comment.length
    return [{ start, end: start + comment.length }]
  })
}

const CSS = /"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|url\([^"'()]*\)|(?<comment>\/\*[\s\S]*?(?:\*\/|$))/g
const PYTHON = /'''[\s\S]*?'''|"""[\s\S]*?"""|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*'|(?<comment>#[^\r\n]*)/g
const SLASH = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|url\([^"'()]*\)|(?<comment>\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g
const HASH = /^[ \t]*(?<comment>#[^\r\n]*)/gm
const YAML = /(?<=^|[ \t[{,])(?:"(?:\\.|[^"\\\n])*"|'(?:''|[^'\n])*')|(?<=^|[ \t])(?<comment>#[^\r\n]*)/gm

function shift(ranges: Range[], by: number): Range[] {
  return ranges.map(({ start, end }) => ({ start: start + by, end: end + by }))
}

function scanMarkup(text: string, parseMode: 'sfc' | 'html'): Range[] {
  const found: Range[] = []
  const visit = (node: TemplateChildNode) => {
    const { start, end } = node.loc
    if (node.type === NodeTypes.COMMENT) {
      found.push({ start: start.offset, end: end.offset })
    } else if (node.type === NodeTypes.INTERPOLATION) {
      found.push(...shift(scanScript(node.content.loc.source), node.content.loc.start.offset))
    } else if (node.type === NodeTypes.ELEMENT) {
      for (const prop of node.props) {
        if (prop.type === NodeTypes.DIRECTIVE && prop.exp) {
          found.push(...shift(scanScript(prop.exp.loc.source), prop.exp.loc.start.offset))
        }
      }
      if (node.tag === 'script' || node.tag === 'style') {
        for (const child of node.children) {
          const raw = text.slice(child.loc.start.offset, child.loc.end.offset)
          const ranges = node.tag === 'script' ? scanScript(raw) : scanPattern(raw, CSS)
          found.push(...shift(ranges, child.loc.start.offset))
        }
      } else {
        node.children.forEach(visit)
      }
    }
  }
  parse(text, { parseMode, comments: true }).children.forEach(visit)
  return found
}

function scan(text: string, language: Language): Range[] {
  switch (language) {
    case 'script': return scanScript(text)
    case 'jsx': return scanScript(text, ts.ScriptKind.TSX)
    case 'slash': return scanPattern(text, SLASH)
    case 'json': return scanScript(text, ts.ScriptKind.JSON)
    case 'vue': return scanMarkup(text, 'sfc')
    case 'html': return scanMarkup(text, 'html')
    case 'css': return scanPattern(text, CSS)
    case 'python': return scanPattern(text, PYTHON)
    case 'yaml':
    case 'shell': return scanPattern(text, YAML)
    case 'hash': return scanPattern(text, HASH)
  }
}

export function findComments(path: string, text: string): Comment[] {
  const language = languageOf(path)
  if (!language) return []
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length
  return scan(text, language)
    .map((range) => ({ ...range, text: text.slice(range.start, range.end).trimEnd() }))
    .filter(({ start, text: body }) =>
      !(start === 0 && body.startsWith('#!')) && !DIRECTIVES.some((directive) => directive.test(body)))
    .sort((a, b) => a.start - b.start)
    .map((comment) => {
      const line = lineAt(comment.start)
      return { ...comment, line, endLine: line + comment.text.split('\n').length - 1 }
    })
}

export function groupComments(text: string, comments: Comment[]): Comment[] {
  const groups: Comment[] = []
  for (const comment of comments) {
    const last = groups.at(-1)
    const ownLine = !text.slice(text.lastIndexOf('\n', comment.start - 1) + 1, comment.start).trim()
    const lastOwnLine = last && !text.slice(text.lastIndexOf('\n', last.start - 1) + 1, last.start).trim()
    const lineComment = /^(\/\/|#)/
    if (
      last && ownLine && lastOwnLine && comment.line === last.endLine + 1 &&
      lineComment.test(comment.text) && lineComment.test(last.text)
    ) {
      groups[groups.length - 1] = {
        ...last,
        end: comment.end,
        endLine: comment.endLine,
        text: text.slice(last.start, comment.end)
      }
    } else {
      groups.push(comment)
    }
  }
  return groups
}

export function removeComments(path: string, text: string, comments: Range[]): string {
  const markup = /\.(?:vue|html|svg)$/.test(path)
  let result = text
  for (const { start, end } of [...comments].sort((a, b) => b.start - a.start)) {
    const lineStart = result.lastIndexOf('\n', start - 1) + 1
    const newline = result.indexOf('\n', end)
    const lineEnd = newline === -1 ? result.length : newline
    const before = result.slice(lineStart, start)
    const after = result.slice(end, lineEnd)
    if (before.trim() && !after.trim()) {
      const carriageReturn = after.endsWith('\r') ? '\r' : ''
      result = result.slice(0, lineStart) + before.trimEnd() + carriageReturn + result.slice(lineEnd)
    } else if (before.trim() || after.trim()) {
      const gap = result.slice(start, end).includes('\n') ? '\n'
        : !(markup && result.startsWith('<!--', start)) && /\S$/.test(before) && /^\S/.test(after) ? ' ' : ''
      result = result.slice(0, start) + gap + result.slice(end)
    } else {
      result = closeGap(result.slice(0, lineStart), result.slice(newline === -1 ? lineEnd : lineEnd + 1))
    }
  }
  return result
}

function closeGap(head: string, tail: string): string {
  const previous = head.slice(head.lastIndexOf('\n', head.length - 2) + 1)
  const next = tail.slice(0, tail.indexOf('\n') + 1)
  const opensBlock = previous.trimEnd().endsWith('{') && !COMMENT_MARKER.test(previous)
  if (opensBlock && next.trimStart().startsWith('}')) {
    return head.trimEnd() + tail.trimStart()
  }
  const nextIsBlank = next !== '' && !next.trim()
  if (nextIsBlank && (!previous.trim() || /[[({]$/.test(previous.trimEnd()))) {
    return head + tail.slice(next.length)
  }
  const closes = !tail.trim() || /^\s*([\])}]|<\/)/.test(next)
  if (head && !previous.trim() && closes) return head.slice(0, head.length - previous.length) + tail
  return head + tail
}

export type Baseline = Record<string, number>

export interface CommentLine {
  path: string
  line: number
  text: string
  key: string
}

export function commentLines(path: string, text: string): CommentLine[] {
  return findComments(path, text).flatMap((comment) =>
    comment.text.split('\n').flatMap((raw, offset) => {
      const body = raw.trim()
      if (!body) return []
      const key = createHash('sha256').update(body).digest('hex').slice(0, 16)
      return [{ path, line: comment.line + offset, text: body, key }]
    }))
}

export function countLines(lines: CommentLine[]): Baseline {
  const counts: Baseline = {}
  for (const { key } of lines) counts[key] = (counts[key] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

export function increases(current: Baseline, allowed: Baseline): string[] {
  return Object.keys(current).filter((key) => current[key]! > (allowed[key] ?? 0))
}

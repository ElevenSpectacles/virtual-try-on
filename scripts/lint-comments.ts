#!/usr/bin/env -S npx tsx
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  commentLines,
  countLines,
  findComments,
  groupComments,
  increases,
  languageOf,
  removeComments,
  type Baseline
} from './lib/comments'

const BASELINE = '.comment-baseline.json'
const PATCHED_VENDORED_SKILL = /^threejs-(?:fundamentals|geometry|loaders|materials)$/

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    list: { type: 'boolean' },
    delete: { type: 'string' },
    update: { type: 'boolean' }
  }
})

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' })

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function sourceFiles(): string[] {
  const { skills } = JSON.parse(readFileSync('skills-lock.json', 'utf8')) as { skills: object }
  const vendored = new Set(Object.keys(skills))
  const files = new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0'))
  return [...files].sort().filter((path) => {
    const skill = /^\.(?:agents|claude)\/skills\/([^/]+)/.exec(path)?.[1]
    if (skill && (vendored.has(skill) || PATCHED_VENDORED_SKILL.test(skill))) return false
    return path !== '' && languageOf(path) !== null && existsSync(path) && lstatSync(path).isFile()
  })
}

function scanFile(path: string) {
  const text = readFileSync(path, 'utf8')
  const comments = findComments(path, text)
  const groups = groupComments(text, comments).map((group) => ({
    ...group,
    id: `${path}:${group.line}:${group.start - text.lastIndexOf('\n', group.start - 1)}`
  }))
  return { text, comments, groups }
}

function list() {
  const selected = sourceFiles().filter((path) =>
    !positionals.length || positionals.some((scope) => `${path}/`.startsWith(`${scope.replace(/\/$/, '')}/`)))
  for (const path of selected) {
    const { text, groups } = scanFile(path)
    const lines = text.split('\n')
    for (const { id, text: comment, line, endLine } of groups) {
      const context = lines.slice(Math.max(0, line - 2), endLine + 3).join('\n')
      console.log(JSON.stringify({ id, comment, context }))
    }
  }
}

function deleteListed(idsPath: string) {
  const wanted = new Set(readFileSync(idsPath, 'utf8').split('\n').map((id) => id.trim()).filter(Boolean))
  const edits: { path: string; text: string }[] = []
  for (const path of sourceFiles()) {
    const { text, comments, groups } = scanFile(path)
    const chosen = groups.filter(({ id }) => wanted.delete(id))
    if (!chosen.length) continue
    const inside = comments.filter(({ start }) => chosen.some((group) => start >= group.start && start < group.end))
    edits.push({ path, text: removeComments(path, text, inside) })
  }
  if (wanted.size) fail(`Unknown or outdated comment ids; run --list again:\n${[...wanted].join('\n')}`)
  for (const { path, text } of edits) writeFileSync(path, text)
  console.log(`Edited ${edits.length} files.`)
}

function check() {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
  const lines = sourceFiles().flatMap((path) => commentLines(path, readFileSync(path, 'utf8')))
  const current = countLines(lines)

  const added = new Set(increases(current, baseline))
  if (added.size) {
    const found = lines.filter(({ key }) => added.has(key))
    fail([
      ...found.map(({ path, line, text }) => `${path}:${line} ${text}`),
      '',
      'Comments are banned. Make the code explain itself, or record the decision in docs/adr/.'
    ].join('\n'))
  }

  if (!values.update && increases(baseline, current).length) {
    fail('Comments were deleted. Lock that in with: npm run lint:comments -- --update')
  }

  if (values.base) {
    git('rev-parse', '--verify', `${values.base}^{commit}`)
    if (git('ls-tree', '--name-only', values.base, '--', BASELINE).trim()) {
      const previous = JSON.parse(git('show', `${values.base}:${BASELINE}`)) as Baseline
      if (increases(values.update ? current : baseline, previous).length) {
        fail(`${BASELINE} grew since ${values.base}. It can only shrink.`)
      }
    }
  }

  if (values.update) writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Comment ratchet passed: ${lines.length} baselined comment lines remain.`)
}

if (values.list) list()
else if (values.delete) deleteListed(values.delete)
else check()

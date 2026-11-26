import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CARD_CROP_HEIGHT, CARD_CROP_WIDTH } from '../../../src/runtime/utils/tryon-card'

const runtime = (path: string) => fileURLToPath(new URL(`../../../src/runtime/${path}`, import.meta.url))

function workerSource(name: string): ts.SourceFile {
  const path = runtime(`workers/${name}.worker.ts`)
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)
}

function typeDeclarations(source: ts.SourceFile): string {
  return source.statements
    .filter((s) => ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s))
    .map((s) => s.getText(source))
    .join('\n\n')
}

function numericConstant(source: ts.SourceFile, name: string): number | undefined {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        const init = declaration.initializer
        if (init && ts.isNumericLiteral(init)) return Number(init.text)
      }
    }
  }
  return undefined
}

function typeErrors(worker: string, typesFile: string, names: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'worker-contract-'))
  const file = join(dir, 'contract.ts')
  const main = runtime(`types/${typesFile}`).replace(/\.ts$/, '')
  writeFileSync(
    file,
    [
      `import type { ${names.map((n) => `${n} as Main${n}`).join(', ')} } from '${main}'`,
      typeDeclarations(workerSource(worker)),
      'type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false',
      ...names.map((n) => `export const ${n}Matches: Same<${n}, Main${n}> = true`)
    ].join('\n\n')
  )
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts']
  })
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('classic worker contracts', () => {
  it('keeps the face landmarker worker messages identical to types/', () => {
    expect(
      typeErrors('face-landmarker', 'face-landmarker-worker.ts', [
        'FaceLandmarkerWorkerRequest',
        'FaceLandmarkerWorkerResponse'
      ])
    ).toEqual([])
  })

  it('keeps the hair segmenter worker messages identical to types/', () => {
    expect(
      typeErrors('hair-segmenter', 'hair-segmenter-worker.ts', [
        'HairSegmenterWorkerRequest',
        'HairSegmenterWorkerResponse'
      ])
    ).toEqual([])
  })

  it('crops the card band at the size tryon-card measures', () => {
    const source = workerSource('face-landmarker')
    expect(numericConstant(source, 'CARD_CROP_WIDTH')).toBe(CARD_CROP_WIDTH)
    expect(numericConstant(source, 'CARD_CROP_HEIGHT')).toBe(CARD_CROP_HEIGHT)
  })
})

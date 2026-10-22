import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { imageReferences } from '../src/features/canvas-v3/sync/imageGenerationTarget.js'

const composerUrl = new URL(
  '../src/features/canvas-v3/components/NodeComposer.vue',
  import.meta.url,
)
const stylesUrl = new URL('../src/features/canvas-v3/canvas-v3.css', import.meta.url)

test('reference row uses LibTV thumbnail cards with ordered and at-sign overlays', async () => {
  const source = await readFile(composerUrl, 'utf8')

  assert.match(source, /class="cv3-reference-chips"/)
  assert.match(source, /class="cv3-reference-card"/)
  assert.match(source, /class="cv3-reference-thumbnail"/)
  assert.match(
    source,
    /class="cv3-reference-index"[\s\S]*?wanxiangVideo \? wanxiangReferenceLabels\[index\] : index \+ 1/,
  )
  assert.match(source, /class="cv3-reference-mention"[\s\S]*?aria-label="@"/)
  assert.match(source, />\s*@\s*<\/button>/)
  assert.match(
    source,
    /class="cv3-reference-thumbnail"[\s\S]*?class="cv3-reference-mention"[\s\S]*?class="cv3-reference-remove"/,
  )
  assert.doesNotMatch(
    source,
    /class="cv3-reference-chips"[\s\S]*?\{\{ reference\.data\.title \}\}[\s\S]*?<\/div>/,
  )
})

test('reference cards keep titles accessible and remove only their connecting edge', async () => {
  const source = await readFile(composerUrl, 'utf8')
  const removeReference =
    source.match(/function removeReference\(reference\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(source, /:title="reference\.data\.title"/)
  assert.match(source, /:alt="reference\.data\.title"/)
  assert.match(source, /:aria-label="'移除引用：' \+ reference\.data\.title"/)
  assert.match(source, /:disabled="generating \|\| interrupted"/)
  assert.match(removeReference, /if \(generating\.value \|\| interrupted\.value\) return/)
  assert.match(removeReference, /incoming\.value\.find/)
  assert.match(removeReference, /candidate\.source === reference\.id/)
  assert.match(removeReference, /graph\.removeEdge\(edge\.id\)/)
  assert.doesNotMatch(removeReference, /removeNode|removeSelected|clearGraph/)
})

test('reference interactions have restrained hover, focus, touch and reduced-motion states', async () => {
  const css = await readFile(stylesUrl, 'utf8')

  assert.match(css, /\.cv3-reference-card\s*\{[\s\S]*?width:\s*48px[\s\S]*?height:\s*48px/)
  assert.match(css, /\.cv3-reference-media\s*\{[\s\S]*?border-radius:\s*8px/)
  assert.match(css, /\.cv3-reference-remove\s*\{[\s\S]*?opacity:\s*0/)
  assert.match(css, /\.cv3-reference-card:hover \.cv3-reference-remove/)
  assert.match(css, /\.cv3-reference-card:focus-within \.cv3-reference-remove/)
  assert.match(css, /\.cv3-reference-card:hover \.cv3-reference-index[\s\S]*?opacity:\s*0/)
  assert.match(css, /\.cv3-reference-card:hover \.cv3-reference-mention/)
  assert.match(css, /\.cv3-reference-remove:focus-visible/)
  assert.match(css, /@media \(hover: none\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
})

test('reference image exposes the measured LibTV hover card and click-pinned preview', async () => {
  const [source, css] = await Promise.all([
    readFile(composerUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ])

  assert.match(source, /const previewReferenceId = ref\(''\)/)
  assert.match(source, /aria-haspopup="dialog"/)
  assert.match(source, /:aria-expanded="previewReferenceId === reference\.id"/)
  assert.match(source, /@click="toggleReferencePreview\(reference, \$event\)"/)
  assert.match(source, /class="cv3-reference-preview"[\s\S]*?role="dialog"/)
  assert.match(source, /previewReferenceId\.value === reference\.id \? '' : reference\.id/)
  assert.match(
    source,
    /function handleComposerKeydown\(event\)[\s\S]*?if \(previewReferenceId\.value\)[\s\S]*?previewReferenceId\.value = ''[\s\S]*?previewTrigger\.value\?\.focus/,
  )
  assert.match(css, /\.cv3-reference-preview\s*\{[\s\S]*?padding:\s*4px/)
  assert.match(css, /\.cv3-reference-preview\s*\{[\s\S]*?border-radius:\s*12px/)
  assert.match(css, /\.cv3-reference-preview\s*\{[\s\S]*?backdrop-filter:\s*blur\(32px\)/)
  assert.match(css, /\.cv3-reference-preview-frame\s*\{[\s\S]*?width:\s*160px/)
  assert.match(css, /\.cv3-reference-thumbnail\.is-open \.cv3-reference-preview/)
})

test('the generated product never appears as its own reference thumbnail', async () => {
  const source = { id: 'source', data: { kind: 'image', assetUrl: 'source.png' } }
  const output = {
    id: 'output',
    data: { kind: 'image', assetUrl: 'product.png', sourceImageNodeId: source.id },
  }
  const legacyOutput = {
    id: 'legacy-output',
    data: { kind: 'image', assetUrl: 'legacy-product.png' },
  }
  const nodes = [source, output, legacyOutput]
  const edges = [
    { source: source.id, target: output.id },
    { source: source.id, target: legacyOutput.id },
  ]

  assert.deepEqual(
    imageReferences(output, nodes, edges).map((node) => node.id),
    ['source'],
  )
  assert.deepEqual(
    imageReferences(legacyOutput, nodes, edges).map((node) => node.id),
    ['source'],
  )

  const composer = await readFile(composerUrl, 'utf8')
  assert.match(composer, /imageReferences\(props\.node, graph\.nodes, graph\.edges\)/)
  // Visible chips must not repeat the current image. Pricing intentionally uses
  // a separate draft:true view to include the source sent by edit generation.
  assert.match(
    composer,
    /const references = computed\(\(\) => imageReferences\(props\.node, graph\.nodes, graph\.edges\)\)/,
  )
})

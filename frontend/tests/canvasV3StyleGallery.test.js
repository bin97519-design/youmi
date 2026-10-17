import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/StyleGalleryModal.vue',
  import.meta.url,
)
const composerUrl = new URL(
  '../src/features/canvas-v3/components/NodeComposer.vue',
  import.meta.url,
)
const configUrl = new URL('../src/features/canvas-v3/config/styleGallery.js', import.meta.url)
const clientUrl = new URL('../src/features/canvas-v3/sync/imageTaskClient.js', import.meta.url)
const targetUrl = new URL(
  '../src/features/canvas-v3/sync/imageGenerationTarget.js',
  import.meta.url,
)

test('style gallery preserves the measured LibTV modal hierarchy and controls', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /class="cv3-style-gallery-backdrop"/)
  assert.match(source, /role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-label="风格广场"/)
  assert.match(source, /class="cv3-style-gallery-tabs"[\s\S]*?STYLE_GALLERY_TABS/)
  assert.match(source, /placeholder="搜索风格名称、作者"/)
  assert.match(source, /v-for="category in STYLE_CATEGORIES"/)
  assert.match(source, /仅看可商用/)
  assert.match(source, /aria-label="筛选模型"/)
  assert.match(source, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(source, /width:\s*min\(1028px, calc\(100vw - 120px\)\)/)
  assert.match(source, /height:\s*min\(734px, calc\(100dvh - 158px\)\)/)
})

test('style gallery filters, favorites, recent history, detail and compact controls are functional', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /filterStyleGallery\(STYLE_GALLERY_ITEMS/)
  assert.match(source, /cv3-style-favorites/)
  assert.match(source, /cv3-style-recent/)
  assert.match(source, /function toggleFavorite\(id\)/)
  assert.match(source, /function selectStyle\(style\)/)
  assert.match(source, /@click="compact = !compact"/)
  assert.match(source, /@click="detail = style"/)
  assert.match(source, /class="cv3-style-detail-apply"[\s\S]*?selectStyle\(detail\)/)
  assert.match(source, /if \(detail\.value\) detail\.value = null/)
  assert.match(source, /event\.key !== 'Tab'/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
})

test('style catalogue keeps the captured sections and a dense commercial-ready card set', async () => {
  const source = await readFile(configUrl, 'utf8')

  for (const label of [
    '推荐',
    '摄影写真',
    '电商营销',
    '动漫游戏',
    '风格插画',
    '平面设计',
    '建筑及室内设计',
    '创意玩法',
    '文创周边',
    '小说推文',
  ]) {
    assert.match(source, new RegExp(`'${label}'`))
  }
  assert.equal((source.match(/\[\r?\n\s*'[a-z0-9-]+',/g) || []).length, 15)
  assert.match(source, /export function filterStyleGallery/)
  assert.match(source, /export function imageStyleInstructions/)
})

test('choosing a style updates node state and contributes a frozen generation instruction', async () => {
  const [composer, client, target] = await Promise.all([
    readFile(composerUrl, 'utf8'),
    readFile(clientUrl, 'utf8'),
    readFile(targetUrl, 'utf8'),
  ])

  assert.match(composer, /tool === '风格'[\s\S]*?styleGalleryOpen\.value = true/)
  assert.match(
    composer,
    /function applyStyle\(style\)[\s\S]*?patch\(\{ stylePreset: style \}, true\)/,
  )
  assert.match(composer, /class="cv3-style-selection"/)
  assert.match(composer, /function removeStyle\(\)[\s\S]*?stylePreset: null/)
  assert.match(client, /imageStyleInstructions\(node\.data\)/)
  assert.match(target, /stylePreset: node\.data\.stylePreset/)
  assert.doesNotMatch(composer, /applyStyle[\s\S]{0,220}(run\(|runImage|submit|generate)/)
})

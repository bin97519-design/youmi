import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHARACTER_STUDIO_TEMPLATES,
  characterStudioAssetPreview,
  characterStudioPortraitPreview,
} from '../src/features/canvas-v3/config/characterStudioCatalog.js'
import { characterStudioAssets } from '../src/features/canvas-v3/config/characterStudioAssets.js'
import { characterStudioPayload } from '../src/features/canvas-v3/config/characterStudioRuntime.js'

const official = CHARACTER_STUDIO_TEMPLATES.find((record) => record.id === 'official-003')
const cutout = '/canvas-v3/characters/003.webp'
const whiteAsset = '/canvas-v3/characters/assets/003-full-body.webp'

test('official 003 separates its transparent portrait from all four original white-background assets', () => {
  const before = JSON.stringify(official)
  assert.equal(official.previewUrl, cutout)
  assert.equal(official.assetPreviewUrl, whiteAsset)
  assert.equal(characterStudioPortraitPreview(official), cutout)
  assert.equal(characterStudioAssetPreview(official), whiteAsset)
  assert.equal(
    official.imageUrl,
    'https://libtv-res.liblib.art/tool/character/003_full_body_1.png?x-oss-process=image/resize,h_440,m_lfit/format,webp/ignore-error,1',
  )
  assert.equal(official.coverUrl, official.imageUrl)
  assert.equal(official.sourceImageUrl, official.imageUrl)
  assert.equal(official.sourceUrl, official.imageUrl)
  const assets = characterStudioAssets(official, characterStudioAssetPreview(official))
  assert.deepEqual(
    assets.slots.map(({ asset }) => asset.previewUrl),
    [
      whiteAsset,
      '/canvas-v3/characters/assets/003-face-closeup.webp',
      '/canvas-v3/characters/assets/003-expression-grid.webp',
      '/canvas-v3/characters/assets/003-character-sheet.webp',
    ],
  )
  assert.deepEqual(
    assets.slots.map(({ asset }) => asset.url),
    [official.imageUrl, ...official.config.assets.map((asset) => asset.url)],
  )
  assert.equal(JSON.stringify(official), before)
})

test('already-saved copies resolve previews from their current source without requiring stored preview fields', () => {
  const savedCopy = characterStudioPayload({
    ...official,
    id: 'personal-copy-003',
    official: false,
    source: 'personal',
    name: '我重新命名的角色',
  })
  assert.equal(Object.hasOwn(savedCopy, 'previewUrl'), false)
  assert.equal(Object.hasOwn(savedCopy, 'assetPreviewUrl'), false)
  assert.equal(characterStudioPortraitPreview(savedCopy), cutout)
  assert.equal(characterStudioAssetPreview(savedCopy), whiteAsset)
  assert.equal(characterStudioPortraitPreview({ imageUrl: official.imageUrl }), cutout)
  assert.equal(characterStudioAssetPreview({ coverUrl: official.imageUrl }), whiteAsset)
  const oldPreviewCopy = { ...savedCopy, previewUrl: whiteAsset }
  assert.equal(characterStudioPortraitPreview(oldPreviewCopy), cutout)
  assert.equal(characterStudioAssetPreview(oldPreviewCopy), whiteAsset)
})

test('edited or generated personal originals cannot be replaced by matching names, ids or template metadata', () => {
  const original = 'https://assets.example.com/new-personal-generated-image.png'
  for (const changed of [
    { ...official, imageUrl: original },
    { id: 'official-003', name: official.name, imageUrl: original, config: { templateId: '003' } },
    { imageUrl: original, coverUrl: official.imageUrl, config: { templateId: '003' } },
    { imageUrl: official.imageUrl + '&new-user-variant=1', config: { templateId: '003' } },
  ]) {
    const record = { ...changed }
    const before = JSON.stringify(record)
    assert.equal(characterStudioPortraitPreview(record), record.imageUrl)
    assert.equal(characterStudioAssetPreview(record), record.imageUrl)
    assert.equal(JSON.stringify(record), before)
  }
})

test('old bundled display previews cannot cover a changed personal original but custom previews still can', () => {
  const imageUrl = 'https://assets.example.com/replaced-reference.png'
  for (const template of CHARACTER_STUDIO_TEMPLATES) {
    for (const previewUrl of [template.previewUrl, template.assetPreviewUrl].filter(Boolean)) {
      const copied = { ...official, imageUrl, previewUrl }
      const before = JSON.stringify(copied)
      assert.equal(characterStudioPortraitPreview(copied), imageUrl)
      assert.equal(characterStudioAssetPreview(copied), imageUrl)
      assert.equal(JSON.stringify(copied), before)
    }
  }
  for (const previewUrl of [
    'https://assets.example.com/custom-preview.png',
    '/my-portraits/custom-cutout.webp',
  ]) {
    const copied = { ...official, imageUrl, previewUrl }
    assert.equal(characterStudioPortraitPreview(copied), previewUrl)
    assert.equal(characterStudioAssetPreview(copied), previewUrl)
  }
  assert.equal(characterStudioPortraitPreview({ previewUrl: cutout }), cutout)
  assert.equal(characterStudioAssetPreview({ previewUrl: whiteAsset }), whiteAsset)
})

test('unknown personal display previews and non-003 official asset fallbacks keep their existing behavior', () => {
  const personal = {
    imageUrl: 'https://assets.example.com/personal.png',
    previewUrl: 'https://assets.example.com/personal-preview.png',
  }
  assert.equal(characterStudioPortraitPreview(personal), personal.previewUrl)
  assert.equal(characterStudioAssetPreview(personal), personal.previewUrl)
  for (const record of CHARACTER_STUDIO_TEMPLATES.filter((item) => item !== official)) {
    assert.equal(record.previewUrl, `/canvas-v3/characters/${record.config.templateId}.webp`)
    assert.equal(record.assetPreviewUrl, undefined)
    assert.equal(characterStudioPortraitPreview(record), record.previewUrl)
    assert.equal(characterStudioAssetPreview(record), record.previewUrl)
    assert.equal(record.config.assets, undefined)
  }
  assert.equal(characterStudioPortraitPreview(), '')
  assert.equal(characterStudioAssetPreview(null), '')
})

test('the bundled 003 portrait has a WebP alpha channel while the full-body asset stays opaque', () => {
  const chunks = (path) => {
    const bytes = readFileSync(new URL(`../public${path}`, import.meta.url))
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
    const result = new Map()
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const length = bytes.readUInt32LE(offset + 4)
      assert.ok(offset + 8 + length <= bytes.length)
      result.set(
        bytes.toString('ascii', offset, offset + 4),
        bytes.subarray(offset + 8, offset + 8 + length),
      )
      offset += 8 + length + (length % 2)
    }
    return result
  }
  const portrait = chunks(cutout)
  assert.equal(portrait.get('VP8X')[0] & 0x10, 0x10)
  assert.equal(portrait.has('ALPH'), true)
  const fullBody = chunks(whiteAsset)
  assert.equal(fullBody.has('ALPH'), false)
  assert.equal((fullBody.get('VP8X')?.[0] || 0) & 0x10, 0)
})

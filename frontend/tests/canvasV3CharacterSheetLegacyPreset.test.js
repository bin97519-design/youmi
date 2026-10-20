import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  imageEditInstructions,
  imageEditTemplate,
  imageEditTemplatePrompt,
} from '../src/features/canvas-v3/config/imageEditPresets.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

const legacyPrompt =
  '以引用图中的角色为准，生成一张专业角色设定图。包含角色正面、侧面、背面的全身造型，以及脸部与服装配饰细节。严格统一人物身份、身材比例、发型、服装、材质和配色，使用干净背景与整洁的设定稿排版。不要引入其他角色，不要文字、标注或水印；仅输出一张完整设定图。'

const data = (instructions, id = 'character-sheet') => ({
  kind: 'image',
  model: 'configured-model',
  prompt: '保持原图蓝色双辫与插画画风',
  params: { ratio: '16:9', resolution: '4K', count: '1张' },
  editTemplate: { id, version: 1, sourceNodeId: 'original-reference', instructions },
  generation: { clientTaskId: 'already-submitted', prompt: 'already submitted request snapshot' },
})

test('only the exact historical character-sheet default follows the current nine-view template', () => {
  const selected = data(legacyPrompt)
  const original = structuredClone(selected)
  const expected = imageEditTemplate('character-sheet').prompt
  assert.notEqual(expected, legacyPrompt)
  assert.equal(imageEditTemplatePrompt(selected), expected)
  assert.equal(imageEditInstructions(selected), expected)
  assert.equal(imageEditTemplatePrompt(data(`  ${legacyPrompt}\n`)), expected)
  const request = imageTaskRequest(
    { data: selected },
    [{ data: { kind: 'image', assetUrl: 'https://assets.example.com/original.png' } }],
    'new-unsubmitted-test-request',
  )
  assert.equal(request.prompt, `${expected}\n\n${selected.prompt}`)
  assert.deepEqual(request.image_urls, ['https://assets.example.com/original.png'])
  assert.equal(request.n, 1)
  assert.equal(request.size, '16:9')
  assert.equal(request.resolution, '4K')
  assert.deepEqual(selected, original)
  assert.equal(selected.generation.prompt, 'already submitted request snapshot')
  assert.equal(selected.generation.clientTaskId, 'already-submitted')
})

test('custom character-sheet instructions, including edits around the old default, are never migrated', () => {
  const instructions = [
    '我自己的设定表排版',
    `${legacyPrompt}\n用户补充：保留鞋子细节`,
    `用户排版优先：${legacyPrompt}`,
    legacyPrompt.replace('脸部与服装配饰细节', '六张上身视图'),
  ]
  for (const prompt of instructions) {
    const selected = data(prompt)
    assert.equal(imageEditTemplatePrompt(selected), prompt)
    assert.equal(imageEditInstructions(selected), prompt)
    assert.equal(
      imageTaskRequest({ data: selected }, [], 'no-submit').prompt,
      `${prompt}\n\n${selected.prompt}`,
    )
  }
})

test('other image templates retain their existing override and empty-default behavior', () => {
  for (const id of ['product-sheet', 'scene-sheet', 'panorama-720', 'storyboard']) {
    assert.equal(imageEditTemplatePrompt(data(legacyPrompt, id)), legacyPrompt)
    assert.equal(imageEditInstructions(data(legacyPrompt, id)), legacyPrompt)
    const expected = imageEditTemplate(id).prompt
    for (const unset of [undefined, null, '', '   ']) {
      assert.equal(imageEditTemplatePrompt(data(unset, id)), expected)
      assert.equal(imageEditInstructions(data(unset, id)), expected)
    }
  }
  assert.equal(imageEditTemplatePrompt({}), '')
  assert.equal(imageEditTemplatePrompt(data('custom', 'unknown')), '')
})

test('resetting instructions returns to the live default without freezing a new prompt snapshot', () => {
  const selected = data('用户自定义排版')
  const reset = { ...selected, editTemplate: { ...selected.editTemplate, instructions: undefined } }
  const persisted = JSON.parse(JSON.stringify(reset))
  assert.equal(Object.hasOwn(persisted.editTemplate, 'instructions'), false)
  assert.equal(imageEditTemplatePrompt(reset), imageEditTemplate('character-sheet').prompt)
  assert.equal(imageEditInstructions(persisted), imageEditTemplatePrompt(reset))
  assert.deepEqual(persisted.generation, selected.generation)
  assert.equal(persisted.editTemplate.sourceNodeId, 'original-reference')

  const composer = readFileSync(
    new URL('../src/features/canvas-v3/components/NodeComposer.vue', import.meta.url),
    'utf8',
  )
  assert.match(composer, /:value="imageEditTemplatePrompt\(node\.data\)"/)
  assert.match(composer, /instructions: undefined/)
  assert.doesNotMatch(composer, /instructions: editTemplate\.prompt/)
})

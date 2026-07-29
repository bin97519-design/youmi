import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildElementEditPrompt,
  buildGenerationReplay,
  normalizeRectToBox,
} from '../src/utils/elementEditPrompt.js'

test('normalizes an M-mode rectangle relative to its image layer', () => {
  assert.deepEqual(
    normalizeRectToBox(
      { left: 300, top: 250, right: 700, bottom: 650 },
      { left: 100, top: 50, width: 800, height: 1000 },
    ),
    [0.25, 0.2, 0.75, 0.6],
  )
})

test('clips an M-mode rectangle to the image boundaries', () => {
  assert.deepEqual(
    normalizeRectToBox(
      { left: 20, top: 0, right: 950, bottom: 1200 },
      { left: 100, top: 50, width: 800, height: 1000 },
    ),
    [0, 0, 1, 1],
  )
})

test('adds normalized target coordinates and their definition to a local edit prompt', () => {
  const prompt = buildElementEditPrompt({
    instruction: '把床品改成浅蓝色',
    targets: [
      {
        name: '床',
        referenceImageIndex: 2,
        box: [0, 0.548, 1, 1],
      },
    ],
  })

  assert.match(prompt, /参考图2中的“床”/)
  assert.match(prompt, /box_2d=\[0\.000, 0\.548, 1\.000, 1\.000\]/)
  assert.match(prompt, /\[left, top, right, bottom\]/)
  assert.match(prompt, /\(0,0\) 是左上角，\(1,1\) 是右下角/)
  assert.match(prompt, /只修改上述 box_2d 矩形内的目标元素/)
  assert.match(prompt, /把床品改成浅蓝色/)
})

test('keeps a normal image prompt unchanged when no element is selected', () => {
  assert.equal(
    buildElementEditPrompt({ instruction: '生成法式卧室主图', targets: [] }),
    '生成法式卧室主图',
  )
})

test('uses the same coordinate prompt for a manually marked element', () => {
  const prompt = buildElementEditPrompt({
    instruction: '把柜体改成胡桃木色',
    targets: [
      {
        name: '手标-床头柜',
        referenceImageIndex: 1,
        box: normalizeRectToBox(
          { left: 220, top: 560, right: 420, bottom: 760 },
          { left: 100, top: 100, width: 800, height: 1000 },
        ),
      },
    ],
  })

  assert.match(prompt, /参考图1中的“手标-床头柜”/)
  assert.match(prompt, /box_2d=\[0\.150, 0\.460, 0\.400, 0\.660\]/)
  assert.match(prompt, /\[left, top, right, bottom\]/)
})

test('replays a marked img2img task with its original references and settings', () => {
  const replay = buildGenerationReplay({
    record: {
      prompt: '【局部元素图生图任务】\nbox_2d=[0.100, 0.200, 0.300, 0.400]',
      model: 'banana2',
      ratio: '9:16',
      resolution: '2K',
      referenceImageUrls: ['https://example.com/source.png'],
    },
    userMessage: {
      text: '[手标-副文案]清空这里',
      elements: [{ name: '手标-副文案', order: 1 }],
    },
    defaults: { model: 'gpt-image-2', ratio: '1:1', resolution: '1K' },
  })

  assert.equal(replay.displayText, '[手标-副文案]清空这里')
  assert.deepEqual(replay.messageElements, [{ name: '手标-副文案', order: 1 }])
  assert.deepEqual(replay.referenceImageUrls, ['https://example.com/source.png'])
  assert.equal(replay.model, 'banana2')
  assert.equal(replay.ratio, '9:16')
  assert.equal(replay.resolution, '2K')
  assert.equal(replay.missingRequiredReference, false)
})

test('blocks a marked regeneration when its source image cannot be recovered', () => {
  const replay = buildGenerationReplay({
    record: { prompt: '【局部元素图生图任务】\nbox_2d=[0.100, 0.200, 0.300, 0.400]' },
  })

  assert.equal(replay.requiresReferenceImage, true)
  assert.equal(replay.missingRequiredReference, true)
})

test('falls back to message and marked-layer references for older history records', () => {
  const replay = buildGenerationReplay({
    record: { prompt: '普通图生图' },
    userMessage: {
      referenceImages: [{ url: 'https://example.com/one.png' }],
    },
    fallbackReferenceImageUrls: ['https://example.com/two.png', 'https://example.com/one.png'],
  })

  assert.deepEqual(replay.referenceImageUrls, [
    'https://example.com/one.png',
    'https://example.com/two.png',
  ])
})

test('replays a failed generation from its persisted request snapshot', () => {
  const replay = buildGenerationReplay({
    userMessage: {
      text: '把图一的床垫替换成图二的床垫',
      referenceImages: [{ url: 'https://example.com/legacy.png' }],
    },
    assistantMessage: {
      text: '生成失败：Billing hard limit has been reached.',
      model: 'gpt-image-2',
      generationRequest: {
        prompt: '完整的原始生图提示词',
        referenceImageUrls: ['https://example.com/one.png', 'https://example.com/two.png'],
        model: 'banana2',
        ratio: '3:4',
        resolution: '2K',
        targetLayerId: 'layer-1',
      },
    },
  })

  assert.equal(replay.prompt, '完整的原始生图提示词')
  assert.deepEqual(replay.referenceImageUrls, [
    'https://example.com/one.png',
    'https://example.com/two.png',
  ])
  assert.equal(replay.model, 'banana2')
  assert.equal(replay.ratio, '3:4')
  assert.equal(replay.resolution, '2K')
  assert.equal(replay.targetLayerId, 'layer-1')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import { directorCanvasSelectionIntent } from '../src/features/canvas-v3/config/directorCanvasSelection.js'
import {
  DIRECTOR_ATTACHMENT_LIMIT,
  normalizeDirectorAsset,
} from '../src/features/canvas-v3/config/directorAttachments.js'

const image = (id, extra = {}) => ({
  id,
  data: { kind: 'image', title: id, assetUrl: `https://cdn.example.test/${id}.png`, ...extra },
})
const text = (id, prompt) => ({ id, data: { kind: 'text', title: id, prompt } })
const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)

test('pure intent whitelists ready image/video metadata and appends text without modifying nodes, attachments or draft', () => {
  const current = [
    normalizeDirectorAsset({ id: 'kept', kind: 'image', url: 'https://cdn.example.test/kept.png' }),
  ]
  const nodes = [
    image('image', {
      generation: { clientTaskId: 'private-task' },
      apiKey: 'secret',
      runState: 'running',
    }),
    image('video', {
      kind: 'video',
      assetUrl: 'https://cdn.example.test/video.mp4',
      mimeType: 'video/mp4',
      thumbnail: 'javascript:bad',
    }),
    text('角色要求', '保留原始服装和外观'),
  ]
  const before = structuredClone({ current, nodes })
  const result = directorCanvasSelectionIntent(nodes, {
    existingAttachments: current,
    prompt: '原来的草稿',
  })
  assert.equal(result.acceptedCount, 3)
  assert.equal(result.acceptedMediaCount, 2)
  assert.equal(result.acceptedTextCount, 1)
  assert.equal(result.rejectedCount, 0)
  assert.equal(result.prompt, '原来的草稿\n\n【角色要求】\n保留原始服装和外观')
  assert.deepEqual(
    result.assets.map((asset) => asset.layerId),
    ['image', 'video'],
  )
  assert.equal(result.assets[1].previewUrl, 'https://cdn.example.test/video.mp4')
  assert.equal(JSON.stringify(result.assets).includes('private-task'), false)
  assert.equal(JSON.stringify(result.assets).includes('secret'), false)
  assert.deepEqual({ current, nodes }, before)
})

test('attachment capacity, unsupported nodes, missing artifacts and duplicates have explicit per-node feedback', () => {
  const existing = Array.from({ length: 9 }, (_, i) =>
    normalizeDirectorAsset({
      id: `existing-${i}`,
      kind: 'image',
      url: `https://cdn.example.test/${i}.png`,
    }),
  )
  const result = directorCanvasSelectionIntent(
    [
      image('existing-0'),
      image('new-1'),
      image('new-2'),
      image('empty', { assetUrl: '' }),
      image('audio', { kind: 'audio' }),
      text('blank', ' '),
    ],
    { existingAttachments: existing },
  )
  assert.equal(result.acceptedCount, 1)
  assert.equal(result.rejectedCount, 5)
  assert.equal(result.duplicateCount, 1)
  assert.match(result.rejections.find((item) => item.nodeId === 'new-2').reason, /最多添加 10/)
  assert.equal(existing.length, 9)
})

test('same URL from distinct canvas nodes is retained, while repeated node identities are counted as duplicates', () => {
  const source = 'https://cdn.example.test/shared.png'
  const result = directorCanvasSelectionIntent([
    image('first', { assetUrl: source }),
    image('last', { assetUrl: source }),
    image('first', { assetUrl: source }),
  ])
  assert.deepEqual(
    result.assets.map((asset) => asset.layerId),
    ['first', 'last'],
  )
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.rejectedCount, 1)
})

test('unsafe sources, unsupported inline data, known oversized material and non-ready media cannot enter Chat', () => {
  const urls = [
    'javascript:bad',
    'file:///private.png',
    'blob:https://app.test/id',
    'https://u:p@cdn.example.test/i.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    '/api/private',
    'https://cdn.example.test/a\nb.png',
    'data:image/png;base64,abc',
  ]
  const nodes = [
    ...urls.map((assetUrl, i) => image(`unsafe-${i}`, { assetUrl })),
    image('oversized', { fileSize: 20 * 1024 * 1024 + 1 }),
    image('wrong-kind', { mimeType: 'video/mp4' }),
    image('declared-svg', { mimeType: 'image/svg+xml' }),
    image('inline-video', { kind: 'video', assetUrl: 'data:video/mp4;base64,AAAA' }),
  ]
  const result = directorCanvasSelectionIntent(nodes)
  assert.equal(result.acceptedCount, 0)
  assert.equal(result.rejectedCount, nodes.length)
  assert.deepEqual(result.assets, [])
})

test('safe inline raster data is retained as a ready attachment without initiating upload', () => {
  const url = 'data:image/png;base64,iVBORw0KGgo='
  const result = directorCanvasSelectionIntent([image('inline', { assetUrl: url })])
  assert.equal(result.acceptedCount, 1)
  assert.equal(result.assets[0].url, url)
  assert.equal(result.assets[0].mimeType, 'image/png')
  assert.equal(result.assets[0].size, 8)
  assert.equal(result.assets[0].status, 'ready')
})

test('text deduplication and explicit per-node/total draft limits never truncate or replace existing content', () => {
  const draft = '既有内容'
  const result = directorCanvasSelectionIntent(
    [text('duplicate', draft), text('long', '长'.repeat(4001)), text('good', '新内容')],
    { prompt: draft },
  )
  assert.equal(result.acceptedTextCount, 1)
  assert.equal(result.rejectedCount, 2)
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.prompt, `${draft}\n\n【good】\n新内容`)
  const full = 'a'.repeat(11999)
  const limited = directorCanvasSelectionIntent([text('overflow', 'extra')], { prompt: full })
  assert.equal(limited.prompt, full)
  assert.equal(limited.acceptedCount, 0)
  assert.match(limited.rejections[0].reason, /12000/)
})

test('explicit project/session/conversation guards reject stale selections without changing a single draft field', () => {
  const currentScope = { projectId: 'project-a', sessionId: 'project-a', conversationId: 'chat-a' }
  for (const expectedScope of [
    { projectId: 'old-project' },
    { sessionId: 'old-session' },
    { conversationId: 'old-chat' },
  ]) {
    const result = directorCanvasSelectionIntent([image('one'), text('two', 'text')], {
      prompt: 'kept',
      currentScope,
      expectedScope,
    })
    assert.equal(result.stale, true)
    assert.equal(result.acceptedCount, 0)
    assert.equal(result.rejectedCount, 2)
    assert.equal(result.prompt, 'kept')
    assert.deepEqual(result.assets, [])
  }
  assert.equal(
    directorCanvasSelectionIntent([image('one')], { currentScope, expectedScope: currentScope })
      .acceptedCount,
    1,
  )
  assert.equal(directorCanvasSelectionIntent([image('one')], { currentScope }).acceptedCount, 1)
  assert.equal(
    directorCanvasSelectionIntent([image('one')], { blockedReason: 'restoring' }).blocked,
    true,
  )
})

async function panelHarness() {
  const source = parseVue(await readFile(panelUrl, 'utf8')).descriptor.scriptSetup.content
  const require = createRequire(import.meta.url)
  const ast = require('@babel/parser').parse(source, { sourceType: 'module' })
  const notices = []
  const context = vm.createContext({
    directorCanvasSelectionIntent,
    normalizeDirectorAsset,
    DIRECTOR_ATTACHMENT_LIMIT,
    props: { sessionId: 'project-a', conversationId: 'chat-a', restoring: false, restoreError: '' },
    attachments: { value: [] },
    prompt: { value: '保留现有草稿' },
    skillCreationChoice: { value: 'blank' },
    skillCreationOpen: { value: false },
    skillSelectionDraft: { value: false },
    skillMenuOpen: { value: false },
    pendingClarificationRun: { value: null },
    clarificationChatOpen: { value: false },
    sentMessages: { value: [] },
    composerInput: { value: { focus() {} } },
    closeInlinePopups() {},
    nextTick: (fn) => {
      fn?.()
      return Promise.resolve()
    },
    showHeaderNotice: (message) => notices.push(message),
    emit: () => {
      throw new Error('External selection must never submit or generate')
    },
    fetch: () => {
      throw new Error('External selection must never fetch')
    },
    uploadFileDirect: () => {
      throw new Error('External selection must never upload')
    },
  })
  for (const name of [
    'handleLibraryAssets',
    'addCanvasSelection',
    'confirmSkillCreation',
    'dismissSkillCreation',
    'startSkillCreation',
  ]) {
    const declaration = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    assert.ok(declaration, `SFC must keep ${name}`)
    vm.runInContext(source.slice(declaration.start, declaration.end), context)
  }
  assert.match(source, /defineExpose\(\{ addCanvasSelection \}\)/)
  return context
}

test('actual SFC exposed method appends to real attachment/draft state and returns synchronous feedback without a submit', async () => {
  const panel = await panelHarness()
  const first = panel.addCanvasSelection([image('one'), text('描述', '保留主体')], {
    projectId: 'project-a',
    conversationId: 'chat-a',
  })
  assert.equal(typeof first.then, 'undefined')
  assert.equal(first.acceptedCount, 2)
  assert.equal(first.skillCreationOpened, false)
  assert.equal(panel.attachments.value.length, 1)
  assert.match(panel.prompt.value, /^保留现有草稿\n\n/)
  const second = panel.addCanvasSelection([image('one'), image('two')])
  assert.equal(second.acceptedCount, 1)
  assert.equal(second.rejectedCount, 1)
  assert.equal(panel.attachments.value.length, 2)
  const stale = panel.addCanvasSelection([image('three')], { conversationId: 'old-chat' })
  assert.equal(stale.stale, true)
  assert.equal(panel.attachments.value.length, 2)
  panel.props.restoring = true
  assert.equal(panel.addCanvasSelection([image('four')]).blocked, true)
  assert.equal(panel.attachments.value.length, 2)
  assert.equal(panel.sentMessages.value.length, 0)
})

test('actual SFC createSkill only opens the canvas guide; confirmation preserves the external draft and media', async () => {
  const panel = await panelHarness()
  const result = panel.addCanvasSelection([image('one'), text('流程', '先策划再生图')], {
    createSkill: true,
  })
  const draft = panel.prompt.value
  assert.equal(result.skillCreationOpened, true)
  assert.equal(panel.skillCreationOpen.value, true)
  assert.equal(panel.skillCreationChoice.value, 'canvas')
  assert.equal(panel.sentMessages.value.length, 0)
  panel.confirmSkillCreation()
  assert.equal(panel.skillCreationOpen.value, false)
  assert.ok(panel.prompt.value.startsWith(draft))
  assert.match(panel.prompt.value, /可复用的 Skill/)
  assert.equal(panel.attachments.value.length, 1)
  assert.equal(panel.sentMessages.value.length, 1)
  assert.equal(panel.sentMessages.value[0].parts[0].type, 'skill_creation')
})

test('actual SFC exposes appended drafts beside an existing questionnaire without answering or replacing it', async () => {
  const panel = await panelHarness()
  const question = { id: 'pending', clarificationAnswers: ['保留答案'] }
  panel.pendingClarificationRun.value = question
  const result = panel.addCanvasSelection([image('one'), text('补充', '先核对参考图')])
  assert.equal(result.acceptedCount, 2)
  assert.equal(panel.clarificationChatOpen.value, true)
  assert.equal(panel.pendingClarificationRun.value, question)
  assert.deepEqual(question.clarificationAnswers, ['保留答案'])
  assert.equal(panel.sentMessages.value.length, 0)
})

test('existing manual Skill creation retains its original replace-draft behavior outside the new selection entry', async () => {
  const panel = await panelHarness()
  panel.startSkillCreation()
  panel.confirmSkillCreation()
  assert.equal(panel.prompt.value, '请帮我从零创建一个 Skill，我想实现：')
  assert.equal(panel.skillSelectionDraft.value, false)
})

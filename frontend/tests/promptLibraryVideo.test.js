import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'
import { mergePromptIntoComposer } from '../src/utils/promptLibrary.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse: parseJs } = require('@babel/parser')
const source = parse(fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'))
  .descriptor.scriptSetup.content
const ast = parseJs(source, { sourceType: 'module' })
const names = ['promptLibraryInputText', 'applyPromptLibraryItem', 'choosePromptLibraryItem',
  'saveAgentDraftToPromptLibrary', 'saveVideoReversePromptToPromptLibrary']
const functions = ast.program.body.filter((node) => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  .map((node) => source.slice(node.start, node.end)).join('\n')

function setup() {
  const node = { id: 'video-a', type: 'video', videoNodeDraft: {
    prompt: '原脚本', config: { model: 'seedance-2.5', duration: 15 },
    references: [{ url: 'https://example.com/original.png' }],
  } }
  const changes = { input: '聊天内容', used: [], saved: [], notices: [], undo: 0 }
  const context = vm.createContext({
    doc: { value: { id: 'canvas-a' } }, layers: { value: [node] },
    promptLibraryTarget: { value: { canvasId: 'canvas-a', layerId: 'video-a' } },
    promptLibraryOpen: { value: true }, promptLibraryInsert: { visible: false, item: null },
    extractChatEditorText: () => changes.input,
    replaceChatEditorText: (value) => { changes.input = value },
    videoNodeDraftFor: (layer) => layer.videoNodeDraft,
    videoNodeBusy: (layer) => Boolean(layer.generating),
    mergePromptIntoComposer,
    pushUndo: () => { changes.undo++ },
    updateVideoNodeDraft: (layer, draft) => { layer.videoNodeDraft = draft },
    closePromptLibrary: () => { context.promptLibraryOpen.value = false; context.promptLibraryTarget.value = null },
    markPromptLibraryItemUsed: (item) => changes.used.push(item.id),
    showCopyPasteToast: (value) => changes.notices.push(value),
    agentDraftActiveItem: (draft) => draft.items[0],
    openPromptLibraryEditor: (value) => changes.saved.push(value),
  })
  vm.runInContext(functions, context)
  return { context, changes, node }
}

test('using a video prompt changes only the originating node and preserves original images and settings', () => {
  const { context, changes, node } = setup()
  const references = node.videoNodeDraft.references, config = node.videoNodeDraft.config
  context.applyPromptLibraryItem({ id: 4, content: '新镜头\n完整口播' }, 'append')
  assert.equal(node.videoNodeDraft.prompt, '原脚本\n\n新镜头\n完整口播')
  assert.equal(node.videoNodeDraft.references, references)
  assert.equal(node.videoNodeDraft.config, config)
  assert.equal(changes.input, '聊天内容')
  assert.equal(changes.undo, 1)
  assert.deepEqual(changes.used, [4])
  assert.equal(context.promptLibraryOpen.value, false)
})

test('stale, locked and busy video targets do not overwrite another canvas or record usage', () => {
  for (const state of ['stale', 'locked', 'busy', 'deleted']) {
    const { context, changes, node } = setup()
    if (state === 'stale') context.doc.value.id = 'canvas-b'
    if (state === 'locked') node.locked = true
    if (state === 'busy') node.generating = true
    if (state === 'deleted') context.layers.value = []
    context.applyPromptLibraryItem({ id: 4, content: '新脚本' })
    assert.equal(node.videoNodeDraft.prompt, '原脚本')
    assert.equal(changes.input, '聊天内容')
    assert.equal(changes.undo, 0)
    assert.deepEqual(changes.used, [])
    assert.equal(context.promptLibraryOpen.value, true)
  }
})

test('existing video script offers append or replace independently of the chat input', () => {
  const { context, changes } = setup()
  changes.input = ''
  context.choosePromptLibraryItem({ id: 4, content: '新脚本' })
  assert.equal(context.promptLibraryInsert.visible, true)
  assert.deepEqual(changes.used, [])
})

test('video Agent plans and reversed video scripts are saved in the video category without shortening', () => {
  const { context, changes } = setup()
  const content = '分镜与口播\n'.repeat(3000) + '保留结尾'
  context.saveAgentDraftToPromptLibrary({ agentDraft: { generationType: 'video', items: [{ prompt: content }] } })
  context.saveVideoReversePromptToPromptLibrary({ text: content })
  assert.equal(changes.saved.length, 2)
  for (const saved of changes.saved) {
    assert.equal(saved.category, 'VIDEO')
    assert.equal(saved.content, content)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse } from '@vue/compiler-sfc'
import { normalizeImageNodeDraft } from '../src/utils/imageNodeDraft.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse: parseJs } = require('@babel/parser')
function loadFunctions(path, names, context) {
  const source = parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor.scriptSetup.content
  const ast = parseJs(source, { sourceType: 'module' })
  for (const name of names) {
    const fn = ast.program.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name)
    assert.ok(fn, name)
    vm.runInContext(source.slice(fn.start, fn.end), context)
  }
}
function setup(saved) {
  let message = saved || {
    id: 'plan', agentConversationId: 'conversation',
    agentDraft: {
      generationType: 'image', activeIndex: 0,
      referenceImages: [{ url: 'https://media.test/product.png', layerId: 'product' }],
      items: [
        { id: 'first', prompt: '保留产品外观，换个卧室', status: 'ready' },
        { id: 'second', prompt: '第二方案', status: 'ready', image: {
          models: ['banana2'], model: 'banana2', ratio: '1:1', resolution: '1K', count: 1,
        } },
      ],
    },
  }
  const requests = []
  const context = vm.createContext({
    normalizeImageNodeDraft,
    agentVideoSubmissions: new Set(),
    imageNodeModelOptions: { value: [
      { value: 'banana2', label: 'banana2' }, { value: 'gpt-image-2', label: 'GPT Image' },
    ] },
    agentGenerationSettings: { value: {
      model: 'banana2', models: ['banana2'], ratio: '16:9', resolution: '2K', count: 1,
    } },
    chatModels: {}, chatRatio: {}, chatResolution: {}, chatGenerationCount: {},
    updateChatMessage: (_, patch) => { message = { ...message, ...patch } },
    updateAgentMessage: (_, updater) => { message = updater(message) },
    userStore: { requireLogin: () => true },
    activeAgentConversationId: { value: 'conversation' },
    sendChat: async (request) => { requests.push(request) },
    showCopyPasteToast: (text) => { throw new Error(text) },
  })
  loadFunctions('../src/pages/CanvasEditorPage.vue', [
    'agentDraftItems', 'agentDraftActiveIndex', 'agentDraftActiveItem',
    'agentImageSettings', 'agentImageReferences', 'updateAgentImageSettings', 'updateAgentDraftItemStatus', 'confirmAgentGeneration',
  ], context)
  return { context, requests, get message() { return message } }
}

test('image choices stay with their scheme, survive reload and preserve the prompt and references', () => {
  const item = setup()
  const original = structuredClone(item.message)
  item.context.updateAgentImageSettings(item.message, {
    model: 'gpt-image-2', models: ['gpt-image-2'], ratio: '3:4', resolution: '4K', count: 3,
  })
  assert.equal(item.message.agentDraft.items[0].image.model, 'gpt-image-2')
  assert.equal(item.message.agentDraft.items[0].prompt, original.agentDraft.items[0].prompt)
  assert.deepEqual(item.message.agentDraft.referenceImages, original.agentDraft.referenceImages)
  assert.deepEqual(JSON.parse(JSON.stringify(item.message.agentDraft.items[1])), original.agentDraft.items[1])
  assert.equal(item.context.chatGenerationCount.value, 3)
  const reloaded = setup(JSON.parse(JSON.stringify(item.message)))
  assert.equal(reloaded.context.agentImageSettings(reloaded.message).resolution, '4K')
  reloaded.message.agentDraft.activeIndex = 1
  assert.equal(reloaded.context.agentImageSettings(reloaded.message).ratio, '1:1')
})

test('confirmation sends the displayed image settings, full prompt and original references', async () => {
  const item = setup()
  item.context.updateAgentImageSettings(item.message, {
    model: 'banana2', models: ['banana2', 'gpt-image-2'], ratio: '9:16', resolution: '4K', count: 2,
  })
  // A different composer can change the defaults while this scheme retains its choices.
  item.context.agentGenerationSettings.value = {
    model: 'banana2', models: ['banana2'], ratio: '1:1', resolution: '1K', count: 1,
  }
  await item.context.confirmAgentGeneration(item.message)
  assert.equal(item.requests.length, 1)
  const request = item.requests[0]
  assert.deepEqual(Array.from(request.taskConfig.models), ['banana2', 'gpt-image-2'])
  assert.equal(request.taskConfig.ratio, '9:16')
  assert.equal(request.taskConfig.resolution, '4K')
  assert.equal(request.generationCount, 2)
  assert.equal(request.fullPrompt, '保留产品外观，换个卧室')
  assert.deepEqual(Array.from(request.referenceImageUrls), ['https://media.test/product.png'])
  assert.equal(item.message.agentDraft.items[0].status, 'submitted')
  assert.equal(item.message.agentDraft.items[0].image.count, 2)
  await item.context.confirmAgentGeneration(item.message)
  assert.equal(item.requests.length, 1)
})

test('submitted and unverified image plans cannot be edited or submitted again', async () => {
  for (const status of ['submitting', 'submitted', 'unknown']) {
    const item = setup()
    item.message.agentDraft.items[0].status = status
    item.context.updateAgentImageSettings(item.message, { models: ['gpt-image-2'] })
    assert.equal(item.message.agentDraft.items[0].image, undefined)
    await item.context.confirmAgentGeneration(item.message)
    assert.equal(item.requests.length, 0)
  }
})

test('legacy image plans show their stored references in order and submit those same originals', async () => {
  const item = setup()
  item.message.agentDraft.referenceImages.push({ url: 'https://media.test/pose.png', layerId: 'pose' })
  assert.deepEqual(Array.from(item.context.agentImageReferences(item.message), (reference) => reference.url), [
    'https://media.test/product.png', 'https://media.test/pose.png',
  ])
  await item.context.confirmAgentGeneration(item.message)
  assert.deepEqual(Array.from(item.requests[0].referenceImageUrls), [
    'https://media.test/product.png', 'https://media.test/pose.png',
  ])
})

test('explicitly removed references stay removed after settings changes, reload and submission', async () => {
  const item = setup()
  item.context.updateAgentImageSettings(item.message, item.context.agentImageSettings(item.message), [])
  item.context.updateAgentImageSettings(item.message, { ...item.context.agentImageSettings(item.message), count: 3 })
  const reloaded = setup(JSON.parse(JSON.stringify(item.message)))
  assert.equal(reloaded.context.agentImageReferences(reloaded.message).length, 0)
  await reloaded.context.confirmAgentGeneration(reloaded.message)
  assert.equal(reloaded.requests[0].referenceImageUrls.length, 0)
})

function selectSetup(multiple) {
  const props = { multiple, disabled: false, modelValue: multiple ? ['banana2'] : 'banana2' }
  let closed = 0
  const changes = []
  const context = vm.createContext({
    props,
    emit: (event, value) => {
      if (event === 'update:modelValue') { props.modelValue = value; changes.push(value) }
    },
    closeMenu: () => { closed += 1 },
  })
  loadFunctions('../src/components/common/ThemedSelect.vue', ['isSelected', 'selectOption'], context)
  return { context, props, changes, get closed() { return closed } }
}

test('model multiselect retains at least one model and stays open for additional choices', () => {
  const item = selectSetup(true)
  item.context.selectOption({ value: 'banana2' })
  assert.equal(item.changes.length, 0)
  item.context.selectOption({ value: 'gpt-image-2' })
  assert.deepEqual(Array.from(item.props.modelValue), ['banana2', 'gpt-image-2'])
  item.context.selectOption({ value: 'banana2' })
  assert.deepEqual(Array.from(item.props.modelValue), ['gpt-image-2'])
  assert.equal(item.closed, 0)
  item.props.disabled = true
  item.context.selectOption({ value: 'banana2' })
  assert.deepEqual(Array.from(item.props.modelValue), ['gpt-image-2'])
})

test('existing single select controls still return a scalar and close after selection', () => {
  const item = selectSetup(false)
  item.context.selectOption({ value: 'gem-3-pro' })
  assert.equal(item.props.modelValue, 'gem-3-pro')
  assert.equal(item.closed, 1)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { reactive, computed } from 'vue'
import { createRequire } from 'node:module'
import { parse as parseVue, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { normalizeImageNodeDraft, imageNodeGenerationOptions } from '../src/utils/imageNodeDraft.js'
import {
  canvasGenerationDimensions,
  emptyMediaNodeDimensions,
} from '../src/utils/canvasEmptyNodeLayout.js'

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
]
const source = { id: 'source', type: 'image', url: 'https://assets.example/source.png' }

test('image drafts validate models, numeric controls and temporary references', () => {
  const draft = normalizeImageNodeDraft(
    {
      prompt: 'x'.repeat(10001),
      config: {
        models: ['missing', 'b', 'b', 'a'],
        ratio: 'bad',
        resolution: '8K',
        count: 99,
      },
      references: [
        null,
        { url: 'blob:pending' },
        { url: 'https://assets.example/pending', uploading: true },
        { ...source, layerId: source.id },
        { url: source.url },
        { url: 'https://assets.example/extra' },
      ],
    },
    {},
    options,
  )
  assert.equal(draft.prompt.length, 10000)
  assert.deepEqual(draft.config, {
    model: 'b',
    models: ['b', 'a'],
    ratio: 'auto',
    resolution: '2K',
    count: 4,
  })
  assert.equal(draft.references.length, 2)
  assert.equal(draft.references[0].layerId, source.id)
  assert.deepEqual(
    normalizeImageNodeDraft({ config: { models: 'bad', count: -1 } }, { model: 'b' }, options)
      .config.models,
    ['b'],
  )
})

test('image generation keeps explicit reference choices and leaves the sidebar composer intact', () => {
  const draft = normalizeImageNodeDraft(
    {
      prompt: ' Change lighting ',
      config: { models: ['a', 'b'], count: 2 },
      references: [{ ...source, layerId: source.id }],
    },
    {},
    options,
  )
  const request = imageNodeGenerationOptions(source, draft)
  assert.equal(request.displayText, 'Change lighting')
  assert.deepEqual(request.referenceImageUrls, [source.url])
  assert.deepEqual(request.referenceLayerIds, ['source'])
  assert.deepEqual(request.taskConfig.models, ['a', 'b'])
  assert.equal(request.generationCount, 2)
  assert.equal(request.preserveComposer, true)
  assert.equal(request.reuseLayerId, undefined)
  draft.references = []
  assert.deepEqual(imageNodeGenerationOptions(source, draft).referenceImageUrls, [])
  assert.equal(
    imageNodeGenerationOptions({ id: 'blank', type: 'image-placeholder', url: '' }, draft)
      .reuseLayerId,
    'blank',
  )
})

const require = createRequire(import.meta.url)
const { parse } = createRequire(require.resolve('@vue/compiler-sfc'))('@babel/parser')
const script = parseVue(
  fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const nodes = parse(script, { sourceType: 'module' }).program.body
function loadFunction(context, name) {
  const node = nodes.find((item) => item.type === 'FunctionDeclaration' && item.id?.name === name)
  assert.ok(node, `Missing function ${name}`)
  vm.runInContext(script.slice(node.start, node.end), context)
}

test('actual placeholder helper reuses only an unlocked empty image node and preserves its draft and position', () => {
  for (const variant of ['blank', 'image', 'locked', 'busy']) {
    const original = {
      id: 'node',
      name: 'Original',
      type: variant === 'image' ? 'image' : 'image-placeholder',
      url: variant === 'image' ? source.url : '',
      locked: variant === 'locked',
      generating: variant === 'busy',
      x: 20,
      y: 30,
      width: 200,
      height: 200,
      zIndex: 1,
      imageNodeDraft: { prompt: 'Keep my draft' },
    }
    const doc = { payload: { layers: [original] } }
    const context = vm.createContext({
      pushUndo: () => {},
      chatReferenceImages: { value: [] },
      firstGenerationReferenceLayer: () => null,
      visibleCanvasWorldRect: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
      PLACEHOLDER_WIDTH: 300,
      CANVAS_IMAGE_WIDTH: 360,
      canvasGenerationDimensions,
      layers: { value: doc.payload.layers },
      findVisibleGenerationPlacement: () => ({ x: 400, y: 100 }),
      normalizeChatGenerationCount: (value) => Number(value) || 1,
      createGenerationClientTaskId: () => 'unique-client-key',
      layerName: () => 'Generated',
      placeholderStatusText: () => 'Submitted',
      props: { id: 'canvas' },
      selectedLayerId: { value: '' },
      selectedLayerIds: { value: [] },
      canvas: { updateDocument: (id, fn) => fn(doc), flushNow: () => {} },
    })
    loadFunction(context, 'addGeneratingPlaceholderLayer')
    const id = context.addGeneratingPlaceholderLayer(
      'Generate',
      {
        model: 'a',
        ratio: '9:16',
        referenceImages: [{ url: source.url, naturalWidth: 300, naturalHeight: 300 }],
      },
      'message',
      {
        reuseLayerId: original.id,
      },
    )
    if (variant === 'blank') {
      assert.equal(id, original.id)
      assert.equal(doc.payload.layers.length, 1)
      assert.equal(original.type, 'placeholder')
      assert.equal(original.clientTaskId, 'unique-client-key')
      assert.equal(original.x, 20)
      assert.equal(original.width, 360)
      assert.equal(original.height, 640)
      assert.equal(original.imageNodeDraft.prompt, 'Keep my draft')
    } else {
      assert.notEqual(id, original.id)
      assert.equal(doc.payload.layers.length, 2)
      assert.equal(original.type, variant === 'image' ? 'image' : 'image-placeholder')
      assert.equal(original.url, variant === 'image' ? source.url : '')
    }
  }
})

test('actual image submission snapshots a node draft and resets submission state on failure', async () => {
  const draft = normalizeImageNodeDraft(
    { prompt: 'Generate', config: { model: 'a' }, references: [] },
    {},
    options,
  )
  const state = { submitting: false },
    errors = {},
    requests = []
  let fail = false,
    saved = 0
  const context = vm.createContext({
    isImageNodeEditorVisible: () => true,
    inlineDialogModification: state,
    inlineDialogUploading: { value: false },
    imageNodeDraft: { value: draft },
    userStore: { requireLogin: () => true },
    saveActiveImageNodeDraft: () => {
      saved++
    },
    imageNodeErrors: errors,
    imageNodeGenerationOptions,
    sendChat: async (request) => {
      requests.push(request)
      if (fail) throw new Error('Network error')
      return { placeholderIds: ['result'] }
    },
    showCopyPasteToast: () => {},
  })
  loadFunction(context, 'submitInlineLayerDialogModification')
  await context.submitInlineLayerDialogModification(source)
  assert.equal(saved, 1)
  assert.equal(state.submitting, false)
  assert.deepEqual(requests[0].referenceImageUrls, [])
  fail = true
  await context.submitInlineLayerDialogModification(source)
  assert.equal(errors.source, 'Network error')
  assert.equal(state.submitting, false)
  assert.equal(draft.prompt, 'Generate')
})

test('source and blank image templates both mount the node composer instead of a floating dialog', () => {
  const template = parseVue(
    fs.readFileSync(new URL('../src/pages/CanvasEditorPage.vue', import.meta.url), 'utf8'),
  ).descriptor.template.content
  assert.equal((template.match(/<ImageNodeComposer\b/g) || []).length, 2)
  assert.doesNotMatch(template, /uc-inline-dialog-edit/)
  const send = nodes.find(
    (item) => item.type === 'FunctionDeclaration' && item.id?.name === 'sendChat',
  )
  assert.match(
    script.slice(send.start, send.end),
    /reuseLayerId: index === 0 \? sendOptions.reuseLayerId : ''/,
  )
})

test('actual editor activation preserves separate drafts and keeps uploads attached to their original node', () => {
  const first = { ...source },
    second = { ...source, id: 'second', url: 'https://assets.example/second.png' }
  const state = { layerId: '', text: '', references: [], models: [], submitting: false }
  const context = vm.createContext({
    props: { id: 'canvas' },
    layers: { value: [first, second] },
    CANVAS_IMAGE_WIDTH: 360,
    emptyMediaNodeDimensions,
    activeImageNodeCanvasId: '',
    inlineDialogModification: state,
    inlineDialogUploading: { value: false },
    normalizeImageNodeDraft,
    chatModelOptions: options,
    imageNodeDefaults: () => ({ model: 'a', ratio: '3:4', resolution: '2K' }),
    isEditableImageNode: (layer) => Boolean(layer?.url && !layer.locked),
    imageNodeDraft: {
      get value() {
        return normalizeImageNodeDraft(
          {
            prompt: state.text,
            references: state.references,
            config: {
              model: state.model,
              models: state.models,
              ratio: state.ratio,
              resolution: state.resolution,
              count: state.generationCount,
            },
          },
          {},
          options,
        )
      },
    },
    updateLayer: (id, patch) =>
      Object.assign(
        [first, second].find((layer) => layer.id === id),
        patch,
      ),
  })
  for (const name of ['applyImageNodeDraft', 'saveActiveImageNodeDraft', 'activateImageNodeEditor'])
    loadFunction(context, name)
  context.activateImageNodeEditor(first)
  assert.equal(state.references[0].url, first.url)
  state.text = 'First independent prompt'
  context.activateImageNodeEditor(second)
  assert.equal(first.imageNodeDraft.prompt, 'First independent prompt')
  assert.equal(state.text, '')
  state.text = 'Second independent prompt'
  context.inlineDialogUploading.value = true
  context.activateImageNodeEditor(first)
  assert.equal(state.layerId, 'second')
  context.inlineDialogUploading.value = false
  context.activateImageNodeEditor(first)
  assert.equal(second.imageNodeDraft.prompt, 'Second independent prompt')
  assert.equal(state.text, 'First independent prompt')
  first.url = 'https://assets.example/replacement.png'
  context.activateImageNodeEditor(first)
  assert.equal(state.references[0].url, first.url)
  context.saveActiveImageNodeDraft()
  context.props.id = 'different-canvas'
  state.text = 'Must not leak across canvases'
  context.saveActiveImageNodeDraft()
  assert.equal(first.imageNodeDraft.prompt, 'First independent prompt')
})

test('the image composer compiles its interaction expressions and scoped styling', () => {
  const file = fs.readFileSync(
    new URL('../src/components/canvas/ImageNodeComposer.vue', import.meta.url),
    'utf8',
  )
  const { descriptor, errors } = parseVue(file)
  assert.deepEqual(errors, [])
  const bindings = compileScript(descriptor, { id: 'image-node-composer-test' }).bindings
  const result = compileTemplate({
    source: descriptor.template.content,
    filename: 'ImageNodeComposer.vue',
    id: 'image-node-composer-test',
    compilerOptions: { bindingMetadata: bindings },
  })
  assert.deepEqual(result.errors, [])
})

test('uploaded references reactively replace temporary URLs before enabling generation', async () => {
  const state = reactive({ layerId: 'source', text: 'Modify', references: [] })
  const draft = computed(() =>
    normalizeImageNodeDraft({ prompt: state.text, references: state.references }, {}, options),
  )
  const uploading = { value: false },
    revoked = []
  const context = vm.createContext({
    userStore: { requireLogin: () => true },
    inlineDialogModification: state,
    inlineDialogUploading: uploading,
    isImageFile: () => true,
    MAX_IMAGE_UPLOAD_BYTES: 20 * 1024 * 1024,
    URL: {
      createObjectURL: () => 'blob:pending-image',
      revokeObjectURL: (url) => revoked.push(url),
    },
    uploadFile: async () => {
      assert.equal(uploading.value, true)
      assert.equal(draft.value.references.length, 0)
      return 'https://assets.example/uploaded.png'
    },
    showCopyPasteToast: () => {},
  })
  loadFunction(context, 'addLocalImagesToInlineDialog')
  assert.equal(
    await context.addLocalImagesToInlineDialog([{ name: 'reference.png', size: 100 }]),
    1,
  )
  assert.equal(draft.value.references[0].url, 'https://assets.example/uploaded.png')
  assert.equal(uploading.value, false)
  assert.deepEqual(revoked, ['blob:pending-image'])
})

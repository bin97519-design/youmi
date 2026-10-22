import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import {
  characterStudioGenerationSpec,
  characterStudioPayload,
  characterStudioPrompt,
} from '../src/features/canvas-v3/config/characterStudioRuntime.js'
import { characterStudioAssetFormat } from '../src/features/canvas-v3/config/characterStudioAssetFormats.js'
import { characterStudioVisualConfig } from '../src/features/canvas-v3/config/characterStudioControls.js'
import { imageModelMenuOptions } from '../src/features/canvas-v3/config/imageModelVersions.js'
import {
  CHARACTER_STUDIO_TEMPLATES,
  characterStudioPortraitPreview,
  characterStudioAssetPreview,
} from '../src/features/canvas-v3/config/characterStudioCatalog.js'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/CharacterStudioDialog.vue', import.meta.url),
  'utf8',
)
const script = source.match(/<script setup>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'integration test requires the actual Dialog setup script')
// Execute the complete production setup, not a second implementation of its business logic.
const executable = script.replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
const plain = (value) => JSON.parse(JSON.stringify(value))
const record = (overrides = {}) => ({
  id: 'my-character',
  name: '温暖妈妈',
  description: '用于家居场景的成年角色，正常日常着装',
  gender: '女',
  ageGroup: '青年',
  culture: '东亚',
  imageUrl: 'https://assets.example.com/character.png',
  coverUrl: 'https://assets.example.com/character.png',
  config: {},
  ...overrides,
})
const models = [
  { value: 'banana2', label: 'Banana 2' },
  { value: 'banana-pro-api', label: 'Banana Pro' },
]
const exposedNames = [
  'dialog',
  'view',
  'items',
  'loading',
  'saving',
  'error',
  'notice',
  'character',
  'editorTab',
  'inspected',
  'description',
  'createReference',
  'confirmation',
  'submitting',
  'selectedModel',
  'selectedRatio',
  'selectedResolution',
  'modelMenuOptions',
  'ageCharacter',
  'ageTarget',
  'deleteItems',
  'pendingJobs',
  'assetFormat',
  'assetPromptPreview',
  'personalLibraryBusy',
  'previewImage',
  'loadLibrary',
  'createCharacter',
  'editCharacter',
  'updateCharacter',
  'returnToLibrary',
  'saveCharacter',
  'insertCharacters',
  'insertInspected',
  'editInspected',
  'createFromAssets',
  'removeInspected',
  'requestAssetGeneration',
  'applyImage',
  'prepareCreate',
  'requestGeneration',
  'requestSave',
  'submitGeneration',
  'resumeGeneration',
  'reconcileGeneratedAssets',
  'requestAgeVariant',
  'confirmAgeVariant',
  'deleteCharacters',
  'close',
  'keydown',
]

async function flush() {
  // Flush real Vue watchers and the resolved mock client promises they await.
  for (let index = 0; index < 5; index += 1) {
    await nextTick()
    await Promise.resolve()
  }
}

function makeHarness(options = {}) {
  const calls = options.calls || []
  const database = options.database || new Map()
  const mounted = []
  const beforeUnmount = []
  const nodes = options.nodes || reactive(plain(options.initialNodes || []))
  const edges = options.edges || reactive([])
  let nodeNumber = nodes.length
  let uuidNumber = 0
  let saveNumber = 0
  const graph = {
    nodes,
    edges,
    remember() {
      calls.push({ type: 'remember' })
    },
    addNode(kind, position) {
      const node = reactive({
        id: `character-node-${++nodeNumber}`,
        position,
        data: { kind, params: {}, runState: 'idle', artifactStatus: 'empty' },
      })
      nodes.push(node)
      calls.push({ type: 'addNode', id: node.id })
      return node
    },
    updateNodeData(id, patch) {
      const node = nodes.find((entry) => entry.id === id)
      assert.ok(node, `Dialog attempted to update missing node ${id}`)
      node.data = { ...node.data, ...plain(patch) }
      calls.push({ type: 'updateNode', id, patch: plain(patch) })
    },
    connect(edge) {
      assert.ok(
        nodes.some((node) => node.id === edge.source),
        'reference source must exist',
      )
      assert.ok(
        nodes.some((node) => node.id === edge.target),
        'generation target must exist',
      )
      edges.push(plain(edge))
      calls.push({ type: 'connect', ...plain(edge) })
    },
  }
  const client = {
    async list() {
      calls.push({ type: 'list' })
      return [...database.values()].map(plain)
    },
    async save(payload) {
      const number = ++saveNumber
      calls.push({ type: 'saveAsset', number, payload: plain(payload) })
      if (options.save) await options.save({ number, payload, graph })
      const saved = { ...plain(payload), id: payload.id || 'saved-character' }
      database.set(saved.id, plain(saved))
      return plain(saved)
    },
    async remove(id) {
      calls.push({ type: 'removeAsset', id })
      database.delete(id)
    },
  }
  const tasks = reactive({
    imageModels: options.models || models,
    modelError: options.modelError || '',
    async loadModels() {
      calls.push({ type: 'loadModels' })
    },
    async runImage(nodeId, focus, request) {
      calls.push({ type: 'runImage', nodeId, focus, request: plain(request) })
      graph.updateNodeData(nodeId, {
        runState: 'queued',
        artifactStatus: 'generating',
        generation: { clientTaskId: request.clientTaskId, taskIds: ['provider-task'], results: [] },
      })
      if (options.runImage) await options.runImage({ nodeId, request, graph })
    },
    async resume(nodeId) {
      calls.push({ type: 'resume', nodeId })
      if (options.resume) await options.resume({ nodeId, graph })
    },
  })
  const user = {
    token: options.loggedIn === false ? '' : 'test-login',
    requireLogin: () => options.loggedIn !== false,
    authHeaders: () => ({ Authorization: 'test' }),
  }
  const lifecycle = []
  const context = {
    ref,
    computed,
    watch,
    nextTick,
    onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => beforeUnmount.push(callback),
    defineProps: () => ({ projectId: options.projectId || 'character-project' }),
    defineEmits: () => (name) => lifecycle.push(name),
    useCanvasV3GraphStore: () => graph,
    useCanvasV3TaskStore: () => tasks,
    useUserStore: () => user,
    createCharacterAssetClient: () => client,
    apiPath: (path) => path,
    uploadFileDirect: async () => {
      throw new Error('unexpected upload in generation integration test')
    },
    imageMiCost: () => 9,
    imageModelMenuOptions,
    characterStudioGenerationSpec,
    characterStudioPayload,
    characterStudioPrompt,
    characterStudioAssetFormat,
    characterStudioVisualConfig,
    CHARACTER_STUDIO_TEMPLATES,
    characterStudioPortraitPreview,
    characterStudioAssetPreview,
    crypto: { randomUUID: () => `stable-uuid-${++uuidNumber}` },
    document: options.document || {
      activeElement: { focus: () => calls.push({ type: 'restoreFocus' }) },
    },
    AbortController,
    TextEncoder,
    console,
  }
  const scope = effectScope()
  const api = scope.run(() =>
    runInNewContext(`${executable}\n;({ ${exposedNames.join(', ')} })`, context, { timeout: 1000 }),
  )
  return {
    api,
    graph,
    tasks,
    calls,
    database,
    lifecycle,
    async open() {
      for (const callback of mounted) await callback()
      await flush()
    },
    dispose() {
      for (const callback of beforeUnmount) callback()
      scope.stop()
    },
  }
}

function selectSettings(api) {
  api.selectedModel.value = 'banana2'
  api.selectedRatio.value = '1:1'
  api.selectedResolution.value = '2K'
}
const paidCalls = (harness) => harness.calls.filter((call) => call.type === 'runImage')
const saves = (harness) => harness.calls.filter((call) => call.type === 'saveAsset')
function completeTask(harness, nodeId, url, patch = {}) {
  const node = harness.graph.nodes.find((entry) => entry.id === nodeId)
  harness.graph.updateNodeData(nodeId, {
    runState: 'succeeded',
    artifactStatus: 'ready',
    assetUrl: url,
    generation: { ...node.data.generation, results: [url] },
    ...patch,
  })
}

test('opening, editing metadata, preparing a request and cancelling never submit paid generation', async () => {
  const h = makeHarness()
  await h.open()
  h.api.editCharacter(record())
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  assert.ok(h.api.confirmation.value.clientTaskId.startsWith('character-stable-uuid-'))
  assert.equal(h.graph.nodes.length, 0)
  assert.equal(saves(h).length, 0)
  assert.equal(paidCalls(h).length, 0)
  h.api.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(h.api.confirmation.value, null)
  await h.api.submitGeneration()
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('studio merges image-2.5 presentation without resetting the exact selected route', () => {
  const h = makeHarness()
  h.tasks.imageModels = [
    { value: 'model-api-key:44', model: 'tt-image-2.5', label: '快速' },
    { value: 'model-api-key:45', model: 'tt-image-2.5', label: '高质' },
    models[0],
  ]
  h.api.selectedModel.value = 'model-api-key:45'
  assert.deepEqual(plain(h.api.modelMenuOptions.value), [
    { value: 'model-api-key:45', model: 'tt-image-2.5', label: 'image-2.5' },
    models[0],
  ])
  assert.equal(h.api.selectedModel.value, 'model-api-key:45')
  assert.equal(h.tasks.imageModels.length, 3)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('asset viewer is layered below generation confirmation and routes its own explicit actions', () => {
  assert.match(source, /import CharacterStudioAssetViewer/)
  const viewer = source.indexOf('<CharacterStudioAssetViewer')
  assert.ok(viewer >= 0)
  assert.ok(viewer < source.indexOf('<div v-if="confirmation"'))
  assert.match(source, /@generate="requestAssetGeneration"/)
  assert.match(source, /@voice="editInspected\('voice'\)"/)
  assert.match(source, /:initial-tab="editorTab"/)
  assert.match(source, /:inert="Boolean\(inspected\)"/)
  assert.match(
    source,
    /<CharacterStudioAssetViewer[\s\S]*?:preview-url="characterStudioAssetPreview\(inspected\)"/,
  )
  assert.match(source, /<CharacterStudioEditor[\s\S]*?:preview-url="previewImage\(character\)"/)
  assert.doesNotMatch(source, /cv3-character-small-dialog cv3-character-asset-viewer/)
})

test('studio product-facing text and accessible labels consistently call the library models', async () => {
  for (const component of ['Library', 'Editor', 'Dialog', 'AssetViewer', 'Wireframe']) {
    const componentSource = await readFile(
      new URL(
        `../src/features/canvas-v3/components/CharacterStudio${component}.vue`,
        import.meta.url,
      ),
      'utf8',
    )
    const template = componentSource.match(/<template>([\s\S]*)<\/template>/)?.[1]
    assert.ok(template, `${component} must expose its actual UI template`)
    assert.doesNotMatch(template, /角色/, `${component} product-facing UI must use 模特`)
  }
  assert.match(source, /aria-label="模特造型室"/)
  assert.match(source, /aria-label="模特生图模型"/)
  assert.match(source, /aria-label="模特生成确认"/)
  // Renaming the product vocabulary does not migrate the persisted type or API contract.
  assert.equal(characterStudioAssetFormat('character-sheet').label, '角色设定图')
  assert.match(source, /requestAssetGeneration/)
  assert.match(source, /createCharacterAssetClient/)
})

test('canvas model-studio entry points use the new visible names without changing action keys', async () => {
  const bottom = await readFile(
    new URL('../src/features/canvas-v3/components/CanvasBottomBar.vue', import.meta.url),
    'utf8',
  )
  const utility = await readFile(
    new URL('../src/features/canvas-v3/components/CanvasUtilityPanel.vue', import.meta.url),
    'utf8',
  )
  assert.match(bottom, /title="模特造型室"/)
  assert.match(bottom, /aria-label="模特造型室"/)
  assert.match(bottom, /@click="\$emit\('panel', 'characters'\)"/)
  assert.doesNotMatch(bottom, /角色造型室/)
  assert.match(utility, /characters: '模特造型室'/)
  assert.doesNotMatch(utility, /角色造型室/)
})

test('personal asset write status reaches the dialog and blocks button, backdrop and Escape closing until settled', () => {
  assert.match(source, /@library-busy="personalLibraryBusy = \$event"/)
  assert.match(source, /:disabled="submitting \|\| personalLibraryBusy"/)
  const h = makeHarness()
  h.api.personalLibraryBusy.value = true
  h.api.close()
  let prevented = false
  let stopped = false
  h.api.keydown({
    key: 'Escape',
    preventDefault() {
      prevented = true
    },
    stopPropagation() {
      stopped = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(stopped, true)
  assert.deepEqual(h.lifecycle, [])
  assert.equal(paidCalls(h).length, 0)
  h.api.personalLibraryBusy.value = false
  h.api.close()
  assert.deepEqual(h.lifecycle, ['close'])
  h.dispose()
})

test('Tab stays trapped when a personal dialog has no currently focusable controls', () => {
  assert.match(source, /<section[\s\S]*?ref="dialog"[\s\S]*?tabindex="-1"/)
  for (const nested of [false, true]) {
    const focused = []
    const document = { activeElement: { id: 'underlying-canvas' } }
    const innerDialog = { focus: () => focused.push('inner-dialog') }
    const scope = {
      querySelectorAll: () => [],
      querySelector: () => (nested ? innerDialog : null),
      contains: () => false,
    }
    const outer = {
      querySelectorAll: (selector) =>
        selector === '.cv3-character-inner-scrim' && nested ? [scope] : [],
      querySelector: () => null,
      focus: () => focused.push('outer-dialog'),
    }
    const h = makeHarness({ document })
    h.api.dialog.value = outer
    for (const shiftKey of [false, true]) {
      let prevented = false
      h.api.keydown({
        key: 'Tab',
        shiftKey,
        preventDefault() {
          prevented = true
        },
      })
      assert.equal(prevented, true)
    }
    assert.deepEqual(
      focused,
      nested ? ['inner-dialog', 'inner-dialog'] : ['outer-dialog', 'outer-dialog'],
    )
    assert.deepEqual(h.lifecycle, [])
    assert.equal(paidCalls(h).length, 0)
    h.dispose()
  }
})

test('Tab redirects focus from outside the active inner dialog and wraps only inside its controls', () => {
  const document = { activeElement: { id: 'outside-scope' } }
  const focused = []
  const focusable = (id) => ({
    id,
    getClientRects: () => [{}],
    focus() {
      focused.push(id)
      document.activeElement = this
    },
  })
  const first = focusable('inner-first')
  const last = focusable('inner-last')
  const scope = {
    querySelectorAll: () => [first, last],
    contains: (element) => element?.id === first.id || element?.id === last.id,
  }
  const h = makeHarness({ document })
  h.api.dialog.value = { querySelectorAll: () => [scope] }
  function tab(shiftKey) {
    let prevented = false
    h.api.keydown({
      key: 'Tab',
      shiftKey,
      preventDefault() {
        prevented = true
      },
    })
    assert.equal(prevented, true)
  }
  tab(false)
  assert.equal(document.activeElement.id, 'inner-first')
  document.activeElement = { id: 'other-canvas-item' }
  tab(true)
  assert.equal(document.activeElement.id, 'inner-last')
  tab(false)
  assert.equal(document.activeElement.id, 'inner-first')
  tab(true)
  assert.equal(document.activeElement.id, 'inner-last')
  assert.deepEqual(focused, ['inner-first', 'inner-last', 'inner-first', 'inner-last'])
  assert.deepEqual(h.lifecycle, [])
  h.dispose()
})

test('the editor resolves a transparent portrait without replacing real asset or generation references', () => {
  const template = CHARACTER_STUDIO_TEMPLATES.find((item) => item.id === 'official-003')
  const saved = record({
    imageUrl: template.imageUrl,
    coverUrl: template.imageUrl,
    previewUrl: template.assetPreviewUrl,
  })
  const before = JSON.stringify(saved)
  const h = makeHarness()
  assert.equal(h.api.previewImage(saved), '/canvas-v3/characters/003.webp')
  assert.equal(
    characterStudioAssetPreview(saved),
    '/canvas-v3/characters/assets/003-full-body.webp',
  )
  h.api.requestGeneration({ character: saved, kind: 'edit' })
  assert.equal(h.api.confirmation.value.character.imageUrl, template.imageUrl)
  assert.equal(JSON.stringify(saved), before)
  const updated = {
    ...saved,
    imageUrl: 'https://assets.example.com/changed.png',
    coverUrl: 'https://assets.example.com/changed.png',
  }
  assert.equal(h.api.previewImage(updated), updated.imageUrl)
  assert.equal(characterStudioAssetPreview(updated), updated.imageUrl)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('each missing asset opens the correct single-image confirmation without saving or generating', () => {
  for (const [type, ratio] of [
    ['full-body', '3:4'],
    ['half-body', '3:4'],
    ['emotion-grid', '3:4'],
    ['character-sheet', '16:9'],
  ]) {
    const h = makeHarness()
    const original = record()
    h.api.inspected.value = original
    h.api.requestAssetGeneration(type)
    assert.equal(h.api.confirmation.value.kind, 'assets')
    assert.equal(h.api.confirmation.value.assetType, type)
    assert.equal(h.api.confirmation.value.source, 'asset-viewer')
    assert.equal(h.api.selectedRatio.value, ratio)
    assert.equal(h.api.assetFormat.value.ratio, ratio)
    assert.equal(
      h.api.assetFormat.value.promptSource,
      characterStudioAssetFormat(type).promptSource,
    )
    assert.match(h.api.assetPromptPreview.value, new RegExp(ratio))
    assert.match(h.api.assetPromptPreview.value, /纯白(?:色无缝)?背景/)
    assert.equal(h.api.inspected.value.id, original.id)
    assert.equal(saves(h).length, 0)
    assert.equal(paidCalls(h).length, 0)
    assert.equal(h.graph.nodes.length, 0)
    h.api.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    assert.equal(h.api.confirmation.value, null)
    assert.equal(h.api.inspected.value.id, original.id, 'Escape closes the top confirmation only')
    h.dispose()
  }
})

test('invalid asset types, login and busy guards cannot bypass confirmation or trigger paid work', () => {
  const invalid = makeHarness()
  invalid.api.inspected.value = record()
  invalid.api.requestAssetGeneration('__proto__')
  assert.match(invalid.api.error.value, /资产类型/)
  assert.equal(invalid.api.confirmation.value, null)
  invalid.api.saving.value = true
  invalid.api.requestAssetGeneration('half-body')
  assert.equal(invalid.api.confirmation.value, null)
  assert.equal(paidCalls(invalid).length, 0)
  invalid.dispose()
  const anonymous = makeHarness({ loggedIn: false })
  anonymous.api.inspected.value = record()
  anonymous.api.requestAssetGeneration('emotion-grid')
  assert.equal(anonymous.api.confirmation.value, null)
  assert.equal(saves(anonymous).length, 0)
  assert.equal(paidCalls(anonymous).length, 0)
  anonymous.dispose()
})

test('confirmed typed assets persist their type, reconcile to the open viewer and never replace the original', async () => {
  for (const [type, name] of [
    ['half-body', '上身图'],
    ['emotion-grid', '表情九宫格'],
    ['character-sheet', '角色设定图'],
    ['full-body', '全身图'],
  ]) {
    const h = makeHarness()
    const original = record()
    h.api.inspected.value = original
    h.api.requestAssetGeneration(type)
    selectSettings(h.api)
    await h.api.submitGeneration()
    assert.equal(paidCalls(h).length, 1)
    assert.equal(h.api.view.value, 'library')
    assert.equal(h.api.inspected.value.id, original.id)
    const job = h.database.get(original.id).config.generation
    assert.equal(job.assetType, type)
    assert.equal(
      h.graph.nodes.find((node) => node.id === job.nodeId).data.characterStudio.assetType,
      type,
    )
    const url = `https://assets.example.com/${type}.png`
    completeTask(h, job.nodeId, url)
    await flush()
    assert.deepEqual(h.database.get(original.id).config.assets, [
      {
        name,
        type,
        url,
        nodeId: job.nodeId,
        formatVersion: characterStudioAssetFormat(type).formatVersion,
        promptSource: characterStudioAssetFormat(type).promptSource,
        imageSettings: { model: 'banana2', ratio: '1:1', resolution: '2K' },
      },
    ])
    assert.equal(h.database.get(original.id).imageUrl, original.imageUrl)
    assert.equal(h.api.inspected.value.config.assets[0].url, url)
    assert.equal(h.api.inspected.value.config.generation, null)
    assert.equal(paidCalls(h).length, 1)
    h.dispose()
  }
})

test('asset footer edit, voice and create navigate without mutating or saving the inspected character', () => {
  const h = makeHarness()
  const original = record()
  const before = plain(original)
  h.api.inspected.value = original
  h.api.editInspected('voice')
  assert.equal(h.api.editorTab.value, 'voice')
  assert.equal(h.api.view.value, 'editor')
  assert.equal(h.api.inspected.value, null)
  assert.deepEqual(plain(original), before)
  h.api.inspected.value = original
  h.api.editInspected()
  assert.equal(h.api.editorTab.value, 'face')
  h.api.inspected.value = original
  h.api.createFromAssets()
  assert.equal(h.api.view.value, 'create')
  assert.equal(h.api.inspected.value, null)
  assert.equal(saves(h).length, 0)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('asset footer inserts the real original and removal opens confirmation rather than deleting immediately', () => {
  const h = makeHarness()
  const original = record()
  h.api.inspected.value = original
  h.api.insertInspected()
  assert.equal(h.graph.nodes[0].data.assetUrl, original.imageUrl)
  assert.equal(h.api.inspected.value, null)
  h.api.inspected.value = original
  h.api.removeInspected()
  assert.equal(h.api.deleteItems.value[0].id, original.id)
  assert.equal(h.calls.filter((call) => call.type === 'removeAsset').length, 0)
  h.api.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(h.api.deleteItems.value.length, 0)
  assert.equal(h.api.inspected.value.id, original.id)
  h.api.inspected.value = record({ id: 'official-003', official: true })
  h.api.removeInspected()
  assert.equal(h.api.deleteItems.value.length, 0)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('explicit confirmation persists stable task identity, references and user-selected settings before one paid call', async () => {
  const original = record({
    config: { styleReferenceUrls: ['https://assets.example.com/style.png'] },
  })
  const confirmedVisual = characterStudioVisualConfig(original)
  const h = makeHarness({
    initialNodes: [
      { id: 'existing-reference', data: { kind: 'image', assetUrl: original.imageUrl } },
    ],
  })
  h.api.requestGeneration({ character: original, kind: 'edit' })
  selectSettings(h.api)
  const key = h.api.confirmation.value.clientTaskId
  original.description = 'mutated after confirmation was prepared'
  original.config.facial = { noseWing: 33 }
  const first = h.api.submitGeneration()
  const duplicate = h.api.submitGeneration()
  await Promise.all([first, duplicate])
  assert.equal(paidCalls(h).length, 1)
  const paid = paidCalls(h)[0]
  assert.equal(paid.request.clientTaskId, key)
  const target = h.graph.nodes.find((node) => node.id === paid.nodeId)
  assert.equal(target.data.model, 'banana2')
  assert.deepEqual(plain(target.data.params), { ratio: '1:1', resolution: '2K', count: 1 })
  assert.doesNotMatch(target.data.prompt, /mutated after confirmation/)
  assert.equal(h.graph.nodes.filter((node) => node.data.assetUrl === original.imageUrl).length, 1)
  const referenceUrls = h.graph.edges
    .filter((edge) => edge.target === target.id)
    .map((edge) => h.graph.nodes.find((node) => node.id === edge.source).data.assetUrl)
  assert.deepEqual(
    referenceUrls.sort(),
    [original.imageUrl, 'https://assets.example.com/style.png'].sort(),
  )
  const trackedSave = saves(h).find((call) => call.payload.config.generation)
  assert.equal(trackedSave.payload.config.generation.nodeId, target.id)
  assert.equal(trackedSave.payload.config.generation.clientTaskId, key)
  assert.equal(trackedSave.payload.config.generation.projectId, 'character-project')
  assert.equal(trackedSave.payload.config.generation.visualConfig, confirmedVisual)
  assert.notEqual(
    trackedSave.payload.config.generation.visualConfig,
    characterStudioVisualConfig(original),
  )
  assert.ok(
    h.calls.indexOf(trackedSave) < h.calls.indexOf(paid),
    'pending record must be durable before submitting',
  )
  assert.equal(h.api.confirmation.value, null)
  await h.api.submitGeneration()
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('pure metadata save updates the personal library without creating nodes or generating', async () => {
  const h = makeHarness()
  h.api.requestSave({
    character: record({ config: { facial: { noseWing: 12 } } }),
    withAssets: false,
    insert: false,
  })
  await flush()
  assert.equal(saves(h).length, 1)
  assert.equal(h.api.items.value[0].config.facial.noseWing, 12)
  assert.equal(h.api.items.value[0].config.appliedVisualConfig, undefined)
  assert.equal(h.graph.nodes.length, 0)
  assert.equal(h.api.confirmation.value, null)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('generation settings are snapshotted before asynchronous persistence begins', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  const submitting = h.api.submitGeneration()
  h.api.selectedModel.value = 'banana-pro-api'
  h.api.selectedRatio.value = '16:9'
  h.api.selectedResolution.value = '4K'
  await submitting
  const target = h.graph.nodes.find((node) => node.id === paidCalls(h)[0].nodeId)
  assert.equal(target.data.model, 'banana2')
  assert.deepEqual(plain(target.data.params), { ratio: '1:1', resolution: '2K', count: 1 })
  h.dispose()
})

test('saving and reopening changed parameters preserves the old applied marker without pretending to generate', async () => {
  const previouslyApplied = characterStudioVisualConfig(record())
  const modified = record({
    config: { facial: { noseWing: 35 }, appliedVisualConfig: previouslyApplied },
  })
  const h = makeHarness()
  h.api.requestSave({ character: modified, withAssets: false, insert: false })
  await flush()
  assert.equal(h.database.get('my-character').config.appliedVisualConfig, previouslyApplied)
  assert.notEqual(previouslyApplied, characterStudioVisualConfig(modified))
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
  const reopened = makeHarness({ database: h.database })
  await reopened.open()
  reopened.api.editCharacter(reopened.api.items.value[0])
  assert.equal(reopened.api.character.value.config.appliedVisualConfig, previouslyApplied)
  assert.notEqual(
    reopened.api.character.value.config.appliedVisualConfig,
    characterStudioVisualConfig(reopened.api.character.value),
  )
  assert.equal(paidCalls(reopened).length, 0)
  assert.equal(reopened.graph.nodes.length, 0)
  reopened.dispose()
})

test('saving with assets opens confirmation but still does not generate until the user confirms', async () => {
  const h = makeHarness()
  h.api.requestSave({ character: record(), withAssets: true, insert: true })
  assert.equal(h.api.confirmation.value.kind, 'assets')
  assert.equal(h.api.confirmation.value.afterSave.insert, true)
  assert.equal(h.api.selectedRatio.value, '16:9')
  assert.equal(saves(h).length, 0)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('unavailable configured models and persistence failures never reach the paid task service', async () => {
  const invalid = makeHarness({ models: [{ value: 'banana2', disabled: true }] })
  invalid.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(invalid.api)
  await invalid.api.submitGeneration()
  assert.equal(paidCalls(invalid).length, 0)
  assert.equal(saves(invalid).length, 0)
  invalid.dispose()
  for (const failureAt of [1, 2]) {
    const h = makeHarness({
      save: async ({ number }) => {
        if (number === failureAt) throw new Error('storage unavailable')
      },
    })
    h.api.requestGeneration({ character: record(), kind: 'edit' })
    selectSettings(h.api)
    await h.api.submitGeneration()
    assert.equal(paidCalls(h).length, 0)
    assert.match(h.api.error.value, /storage unavailable/)
    assert.equal(h.api.submitting.value, false)
    h.dispose()
  }
})

test('a real ready node result is reconciled to the library once, without generating again', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const { nodeId } = paidCalls(h)[0]
  completeTask(h, nodeId, 'https://assets.example.com/generated.png')
  await flush()
  const saved = h.database.get('my-character')
  assert.equal(saved.imageUrl, 'https://assets.example.com/generated.png')
  assert.equal(saved.coverUrl, saved.imageUrl)
  assert.equal(saved.config.generation, null)
  assert.equal(saved.config.appliedVisualConfig, characterStudioVisualConfig(record()))
  const saveCount = saves(h).length
  await h.api.reconcileGeneratedAssets()
  await flush()
  assert.equal(saves(h).length, saveCount)
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('asset-sheet results append real assets without replacing the character original', async () => {
  const appliedVisual = characterStudioVisualConfig(record())
  const original = record({
    config: { facial: { noseWing: 25 }, appliedVisualConfig: appliedVisual },
  })
  const h = makeHarness()
  h.api.requestSave({ character: original, withAssets: true, insert: false })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const { nodeId } = paidCalls(h)[0]
  completeTask(h, nodeId, 'https://assets.example.com/character-sheet.png')
  await flush()
  const saved = h.database.get('my-character')
  assert.equal(saved.imageUrl, original.imageUrl)
  assert.equal(saved.config.appliedVisualConfig, appliedVisual)
  assert.notEqual(saved.config.appliedVisualConfig, characterStudioVisualConfig(original))
  assert.deepEqual(saved.config.assets, [
    {
      name: '角色设定图',
      type: 'character-sheet',
      url: 'https://assets.example.com/character-sheet.png',
      nodeId,
      formatVersion: 'user-model-sheet-v2',
      promptSource: 'user-provided',
      imageSettings: { model: 'banana2', ratio: '1:1', resolution: '2K' },
    },
  ])
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('failed result persistence remains pending and can recover on reopen without another paid submission', async () => {
  const h = makeHarness({
    save: async ({ number }) => {
      if (number === 3) throw new Error('temporary save failure')
    },
  })
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const { nodeId } = paidCalls(h)[0]
  completeTask(h, nodeId, 'https://assets.example.com/recovered.png')
  await flush()
  assert.ok(h.database.get('my-character').config.generation)
  assert.equal(h.database.get('my-character').imageUrl, record().imageUrl)
  h.dispose()
  const reopened = makeHarness({ database: h.database, nodes: h.graph.nodes, edges: h.graph.edges })
  await reopened.open()
  assert.equal(
    reopened.database.get('my-character').imageUrl,
    'https://assets.example.com/recovered.png',
  )
  assert.equal(reopened.database.get('my-character').config.generation, null)
  assert.equal(paidCalls(reopened).length, 0)
  reopened.dispose()
})

test('closing and reopening an uncertain submission restores its pending record and never resubmits', async () => {
  const h = makeHarness({
    runImage: async () => {
      throw new Error('response lost after provider accepted')
    },
  })
  await h.open()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  const key = h.api.confirmation.value.clientTaskId
  await h.api.submitGeneration()
  assert.equal(paidCalls(h).length, 1)
  assert.equal(h.api.confirmation.value, null)
  assert.equal(h.database.get('my-character').config.generation.clientTaskId, key)
  h.api.close()
  assert.deepEqual(h.lifecycle, ['close'])
  h.dispose()
  const reopened = makeHarness({ database: h.database, nodes: h.graph.nodes, edges: h.graph.edges })
  await reopened.open()
  assert.equal(reopened.api.items.value[0].config.generation.clientTaskId, key)
  assert.equal(paidCalls(reopened).length, 0)
  assert.equal(reopened.api.confirmation.value, null)
  await reopened.api.submitGeneration()
  assert.equal(paidCalls(reopened).length, 0)
  const pending = reopened.api.items.value[0].config.generation
  completeTask(reopened, pending.nodeId, 'https://assets.example.com/eventual-result.png')
  await flush()
  assert.equal(
    reopened.database.get('my-character').imageUrl,
    'https://assets.example.com/eventual-result.png',
  )
  assert.equal(paidCalls(reopened).length, 0)
  reopened.dispose()
})

test('pending records from another project cannot reconcile against the current canvas', async () => {
  const stale = record({
    config: {
      generation: {
        nodeId: 'other-node',
        projectId: 'another-project',
        clientTaskId: 'foreign-key',
        kind: 'edit',
      },
    },
  })
  const h = makeHarness({
    database: new Map([[stale.id, stale]]),
    initialNodes: [
      {
        id: 'other-node',
        data: {
          kind: 'image',
          artifactStatus: 'ready',
          assetUrl: 'https://assets.example.com/wrong-project.png',
        },
      },
    ],
  })
  await h.open()
  assert.equal(h.database.get(stale.id).imageUrl, stale.imageUrl)
  assert.equal(saves(h).length, 0)
  assert.equal(paidCalls(h).length, 0)
  h.dispose()
})

test('result reconciliation rejects every mismatched identity or unverified task result', async (t) => {
  const cases = [
    ['non-image node', () => ({ kind: 'video' })],
    ['task still queued', () => ({ runState: 'queued' })],
    ['artifact not ready', () => ({ artifactStatus: 'stale' })],
    [
      'wrong asset identity',
      (node) => ({
        characterStudio: { ...node.data.characterStudio, assetId: 'another-character' },
      }),
    ],
    [
      'wrong character task identity',
      (node) => ({
        characterStudio: { ...node.data.characterStudio, clientTaskId: 'another-key' },
      }),
    ],
    [
      'wrong task-store identity',
      (node) => ({
        generation: {
          ...node.data.generation,
          clientTaskId: 'another-key',
          results: ['https://assets.example.com/mismatch.png'],
        },
      }),
    ],
    [
      'URL not present in task results',
      (node) => ({
        generation: {
          ...node.data.generation,
          results: ['https://assets.example.com/different-result.png'],
        },
      }),
    ],
    ['missing task results', (node) => ({ generation: { ...node.data.generation, results: [] } })],
  ]
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const h = makeHarness()
      h.api.requestGeneration({ character: record(), kind: 'edit' })
      selectSettings(h.api)
      await h.api.submitGeneration()
      const { nodeId } = paidCalls(h)[0]
      const node = h.graph.nodes.find((entry) => entry.id === nodeId)
      completeTask(h, nodeId, 'https://assets.example.com/mismatch.png', override(node))
      await flush()
      assert.equal(h.database.get('my-character').imageUrl, record().imageUrl)
      assert.ok(h.database.get('my-character').config.generation)
      assert.equal(saves(h).length, 2)
      assert.equal(paidCalls(h).length, 1)
      h.dispose()
    })
  }
})

test('background task completion does not replace the character currently being edited', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const other = record({ id: 'currently-edited', name: '另一个角色' })
  h.api.editCharacter(other)
  completeTask(h, paidCalls(h)[0].nodeId, 'https://assets.example.com/background-result.png')
  await flush()
  assert.equal(
    h.database.get('my-character').imageUrl,
    'https://assets.example.com/background-result.png',
  )
  assert.equal(h.api.character.value.id, other.id)
  assert.equal(h.api.character.value.name, other.name)
  h.dispose()
})

test('background completion preserves unsaved edits on the same character while refreshing only task output fields', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  h.api.editCharacter(record({ name: '尚未保存的新名称', config: { facial: { noseWing: 30 } } }))
  completeTask(h, paidCalls(h)[0].nodeId, 'https://assets.example.com/same-character-update.png')
  await flush()
  assert.equal(h.api.character.value.name, '尚未保存的新名称')
  assert.equal(h.api.character.value.config.facial.noseWing, 30)
  assert.equal(
    h.api.character.value.imageUrl,
    'https://assets.example.com/same-character-update.png',
  )
  assert.equal(h.api.character.value.config.generation, null)
  assert.equal(
    h.api.character.value.config.appliedVisualConfig,
    characterStudioVisualConfig(record()),
  )
  assert.notEqual(
    h.api.character.value.config.appliedVisualConfig,
    characterStudioVisualConfig(h.api.character.value),
  )
  assert.equal(h.database.get('my-character').name, record().name)
  h.dispose()
})

test('simultaneous ready records reconcile serially without dropping the second completed character', async () => {
  let releaseFirst
  let activeSaves = 0
  let maxActiveSaves = 0
  const h = makeHarness({
    save: async ({ number }) => {
      if (number < 5) return
      activeSaves += 1
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves)
      if (number === 5)
        await new Promise((resolve) => {
          releaseFirst = resolve
        })
      activeSaves -= 1
    },
  })
  for (const id of ['first-character', 'second-character']) {
    h.api.requestGeneration({ character: record({ id }), kind: 'edit' })
    selectSettings(h.api)
    await h.api.submitGeneration()
  }
  const jobs = paidCalls(h)
  completeTask(h, jobs[0].nodeId, 'https://assets.example.com/first-result.png')
  completeTask(h, jobs[1].nodeId, 'https://assets.example.com/second-result.png')
  await flush()
  assert.equal(saves(h).filter((entry) => entry.number >= 5).length, 1)
  assert.equal(typeof releaseFirst, 'function')
  releaseFirst()
  await flush()
  assert.equal(maxActiveSaves, 1)
  assert.equal(
    h.database.get('first-character').imageUrl,
    'https://assets.example.com/first-result.png',
  )
  assert.equal(
    h.database.get('second-character').imageUrl,
    'https://assets.example.com/second-result.png',
  )
  assert.equal(paidCalls(h).length, 2)
  h.dispose()
})

test('a character with an unresolved generation cannot acquire another paid confirmation from stale editor metadata', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const key = paidCalls(h)[0].request.clientTaskId
  h.api.requestGeneration({ character: record(), kind: 'assets' })
  assert.equal(h.api.confirmation.value, null)
  assert.match(h.api.notice.value, /原任务|不会重复/)
  assert.equal(h.database.get('my-character').config.generation.clientTaskId, key)
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('a definitively failed terminal task permits a fresh confirmation, never an automatic replacement submission', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const previousKey = paidCalls(h)[0].request.clientTaskId
  const nodeId = paidCalls(h)[0].nodeId
  const node = h.graph.nodes.find((entry) => entry.id === nodeId)
  h.graph.updateNodeData(nodeId, {
    runState: 'failed',
    generation: { ...node.data.generation, queryPending: false, unresolvedTaskIds: [] },
  })
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  assert.ok(h.api.confirmation.value)
  assert.notEqual(h.api.confirmation.value.clientTaskId, previousKey)
  assert.equal(h.api.confirmation.value.character.config.generation, null)
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('explicit recovery queries only the original stable task and accepts its verified result', async () => {
  const h = makeHarness({
    resume: async ({ nodeId, graph }) => {
      const node = graph.nodes.find((entry) => entry.id === nodeId)
      const url = 'https://assets.example.com/resumed-original.png'
      graph.updateNodeData(nodeId, {
        runState: 'succeeded',
        artifactStatus: 'ready',
        assetUrl: url,
        generation: { ...node.data.generation, results: [url] },
      })
    },
  })
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const key = paidCalls(h)[0].request.clientTaskId
  const nodeId = paidCalls(h)[0].nodeId
  await h.api.resumeGeneration(h.api.items.value[0])
  await flush()
  assert.deepEqual(
    h.calls.filter((call) => call.type === 'resume'),
    [{ type: 'resume', nodeId }],
  )
  assert.equal(paidCalls(h).length, 1)
  assert.equal(h.graph.nodes.find((node) => node.id === nodeId).data.generation.clientTaskId, key)
  assert.equal(
    h.database.get('my-character').imageUrl,
    'https://assets.example.com/resumed-original.png',
  )
  h.dispose()
})

test('recovery reconstructs only the original query key when the persisted node lacks a task response', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const job = plain(h.api.items.value[0].config.generation)
  h.graph.updateNodeData(job.nodeId, { generation: null })
  await h.api.resumeGeneration(h.api.items.value[0])
  const node = h.graph.nodes.find((entry) => entry.id === job.nodeId)
  assert.equal(node.data.runState, 'uncertain')
  assert.deepEqual(plain(node.data.generation), {
    clientTaskId: job.clientTaskId,
    taskIds: [],
    queryPending: true,
  })
  assert.equal(h.calls.filter((call) => call.type === 'resume').length, 1)
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('recovery rejects a task node with replaced identity and does not generate a replacement', async () => {
  const h = makeHarness()
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const nodeId = paidCalls(h)[0].nodeId
  h.graph.updateNodeData(nodeId, { generation: { clientTaskId: 'replacement-task', taskIds: [] } })
  await h.api.resumeGeneration(h.api.items.value[0])
  assert.equal(h.calls.filter((call) => call.type === 'resume').length, 0)
  assert.equal(paidCalls(h).length, 1)
  assert.match(h.api.error.value, /替换|核对/)
  h.dispose()
})

test('repeated recovery clicks share the original in-progress query without creating another task', async () => {
  let release
  const h = makeHarness({
    resume: async () =>
      new Promise((resolve) => {
        release = resolve
      }),
  })
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  const first = h.api.resumeGeneration(h.api.items.value[0])
  const repeated = h.api.resumeGeneration(h.api.items.value[0])
  assert.equal(h.calls.filter((call) => call.type === 'resume').length, 1)
  assert.equal(typeof release, 'function')
  release()
  await Promise.all([first, repeated])
  assert.equal(h.calls.filter((call) => call.type === 'resume').length, 1)
  assert.equal(paidCalls(h).length, 1)
  h.dispose()
})

test('failed result persistence does not reactively retry but explicit original-task recovery may retry the library write', async () => {
  const h = makeHarness({
    save: async ({ number }) => {
      if (number === 3) throw new Error('one failed library write')
    },
  })
  h.api.requestGeneration({ character: record(), kind: 'edit' })
  selectSettings(h.api)
  await h.api.submitGeneration()
  completeTask(h, paidCalls(h)[0].nodeId, 'https://assets.example.com/explicit-recovery.png')
  await flush()
  assert.equal(saves(h).length, 3)
  await h.api.reconcileGeneratedAssets()
  await flush()
  assert.equal(saves(h).length, 3, 'background callbacks must not spin after a failed write')
  await h.api.resumeGeneration(h.api.items.value[0])
  await flush()
  assert.equal(
    h.database.get('my-character').imageUrl,
    'https://assets.example.com/explicit-recovery.png',
  )
  assert.equal(paidCalls(h).length, 1)
  assert.equal(h.calls.filter((call) => call.type === 'resume').length, 1)
  h.dispose()
})

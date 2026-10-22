import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import {
  imageSubjectPayload,
  imageSubjectUploadFile,
  normalizeSubjectVoices,
} from '../src/features/canvas-v3/config/imageSubject.js'

const record = () => ({
  name: '测试主体',
  description: '蓝色长发，黑色背心。',
  imageUrl: 'https://assets.example.com/image.png',
  viewUrls: ['https://assets.example.com/side.png'],
  tags: ['角色'],
  sourceNodeId: 'node-1',
  voiceId: '',
})
test('subject records persist names, visual views, tags and a genuine selected voice, never a task', () => {
  const result = imageSubjectPayload({
    ...record(),
    taskId: 'secret',
    params: { apiKey: 'secret' },
    voiceId: 'provider-real-voice',
  })
  assert.equal(result.config.libraryKind, 'model')
  assert.equal(result.config.canvasSubject.voiceId, 'provider-real-voice')
  assert.deepEqual(result.config.canvasSubject.viewUrls, record().viewUrls)
  assert.equal(result.config.voice.selectedVoice, 'provider-real-voice')
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
test('subject creation requires meaningful bounded text and durable raster source references', () => {
  for (const value of [
    { name: '' },
    { description: ' ' },
    { name: '长'.repeat(21) },
    { description: '长'.repeat(101) },
    { imageUrl: 'blob:temp' },
    { imageUrl: 'javascript:evil()' },
    { imageUrl: 'https://user:secret@example.com/a.png' },
    { viewUrls: ['data:image/png;base64,AAAA'] },
    { viewUrls: Array(6).fill('https://example.com/a.png') },
  ]) {
    assert.throws(() => imageSubjectPayload({ ...record(), ...value }))
  }
  assert.throws(() => imageSubjectPayload({ ...record(), viewUrls: [] }), /至少添加 1 张其他视角图/)
})
test('no voice is the default and additional views/tags are deduplicated', () => {
  const value = record()
  const result = imageSubjectPayload({
    ...value,
    viewUrls: [...value.viewUrls, ...value.viewUrls],
    tags: ['角色', '角色', ' 场景 '],
  })
  assert.equal(result.config.canvasSubject.voiceId, '')
  assert.equal(result.config.voice, undefined)
  assert.deepEqual(result.config.canvasSubject.tags, ['角色', '场景'])
  assert.equal(result.config.canvasSubject.viewUrls.length, 1)
})
test('subject uploads reject empty, oversize and active formats before any request', () => {
  assert.equal(
    imageSubjectUploadFile({ type: 'image/png', size: 20 * 1024 * 1024 }).type,
    'image/png',
  )
  for (const file of [
    { type: 'image/svg+xml', size: 200 },
    { type: 'text/plain', size: 200 },
    { type: 'image/png', size: 0 },
    { type: 'image/png', size: 20 * 1024 * 1024 + 1 },
  ])
    assert.throws(() => imageSubjectUploadFile(file))
})
test('voice choices are service-supplied only and unsafe preview URLs are dropped', () => {
  assert.deepEqual(normalizeSubjectVoices(), [])
  const result = normalizeSubjectVoices([
    { id: 'real', name: '音色', official: true, previewUrl: 'https://example.com/a.mp3' },
    { id: 'real', name: 'duplicate' },
    { name: 'fake' },
    { id: 'bad', name: 'no preview', previewUrl: 'javascript:bad' },
  ])
  assert.equal(result.length, 2)
  assert.equal(result[0].official, true)
  assert.equal(result[1].previewUrl, '')
})

const source = await readFile(
  new URL('../src/features/canvas-v3/components/ImageCreateSubjectDialog.vue', import.meta.url),
  'utf8',
)
const script = source
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
test('subject dialog production template and setup compile together', () => {
  const filename = 'ImageCreateSubjectDialog.vue'
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const compiledScript = compileScript(descriptor, { id: 'subject-test' })
  const result = compileTemplate({
    source: descriptor.template.content,
    filename,
    id: 'subject-test',
    compilerOptions: { bindingMetadata: compiledScript.bindings },
  })
  assert.deepEqual(result.errors, [])
})
function harness({
  saveResult,
  saveFailure,
  initialSource = 'https://example.com/source.png',
} = {}) {
  const calls = []
  const events = []
  const unmounts = []
  const user = {
    token: 'token',
    profile: { id: 'user' },
    authHeaders: () => ({}),
    requireLogin: () => true,
  }
  const context = {
    defineProps: () => ({
      sourceNode: { id: 'node-1', data: { assetUrl: initialSource } },
      voices: [],
      generateDescription: null,
      completeViews: null,
    }),
    defineEmits:
      () =>
      (...args) =>
        events.push(args),
    computed,
    ref,
    watch: () => {},
    onMounted: () => {},
    onBeforeUnmount: (fn) => unmounts.push(fn),
    nextTick: async () => {},
    useUserStore: () => user,
    apiPath: (path) => path,
    AbortController,
    imageAssetSourceUrl: (url) => (/^(https?:|data:image\/png;base64,)/.test(url || '') ? url : ''),
    loadImageAssetCollections: () => ({ tags: ['角色'], folders: [] }),
    saveImageAssetCollections: () => ({}),
    imageSubjectPayload,
    imageSubjectUploadFile,
    normalizeSubjectVoices,
    createCharacterAssetClient: () => ({
      save: async (record, options) => {
        calls.push({ type: 'save', record, options })
        if (saveFailure) throw new Error(saveFailure)
        return saveResult || { id: 'saved', ...record }
      },
    }),
    generateSubjectDescription: async () => {
      calls.push({ type: 'analyze-subject' })
      return '图像服务识别的蓝发主体'
    },
    uploadFileDirect: async () => {
      throw new Error('not called')
    },
    uploadBase64ImageDirect: async (url, options) => {
      calls.push({ type: 'upload', url, options })
      return 'https://example.com/uploaded.png'
    },
  }
  runInNewContext(
    `${script}\nglobalThis.exposed = { name, description, views, voiceId, saving, canSave, error, save, assist, close, exitConfirmation, confirmExit };`,
    context,
  )
  return { state: context.exposed, user, calls, events, unmounts }
}
test('actual subject dialog does not save when mounted or invalid; successful create writes once', async () => {
  const h = harness()
  assert.equal(h.calls.length, 0)
  await h.state.save()
  assert.equal(h.calls.length, 0)
  h.state.name.value = '主体'
  h.state.description.value = '蓝发'
  assert.equal(h.state.canSave.value, false)
  await h.state.save()
  assert.equal(h.calls.length, 0)
  assert.equal(h.state.error.value, '')
  h.state.views.value = [{ url: 'https://example.com/side.png', name: '侧面' }]
  assert.equal(h.state.canSave.value, true)
  await h.state.save()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].record.config.libraryKind, 'model')
  assert.equal(h.events[0][0], 'saved')
  assert.equal(h.state.saving.value, false)
})
test('actual dialog surfaces backend failure rather than a fake successful subject', async () => {
  const h = harness({ saveFailure: '服务不可用' })
  h.state.name.value = '主体'
  h.state.description.value = '蓝发'
  h.state.views.value = [{ url: 'https://example.com/side.png', name: '侧面' }]
  await h.state.save()
  assert.equal(h.state.error.value, '服务不可用')
  assert.equal(
    h.events.some(([event]) => event === 'saved'),
    false,
  )
})
test('actual dialog validates before source upload and uploads durable image only on create', async () => {
  const h = harness({ initialSource: 'data:image/png;base64,AAAA' })
  h.state.name.value = '主'.repeat(21)
  h.state.description.value = '蓝发'
  h.state.views.value = [{ url: 'https://example.com/side.png', name: '侧面' }]
  await h.state.save()
  assert.equal(h.calls.length, 0)
  h.state.name.value = '主体'
  await h.state.save()
  assert.equal(h.calls[0].type, 'upload')
  assert.equal(h.calls[1].record.imageUrl, 'https://example.com/uploaded.png')
})
test('actual dialog uses real description client only on explicit click and never invents unavailable views', async () => {
  const h = harness()
  assert.equal(h.calls.length, 0)
  await h.state.assist('views')
  assert.equal(h.calls.length, 0)
  assert.equal(h.state.description.value, '')
  await h.state.assist('description')
  assert.equal(h.calls[0].type, 'analyze-subject')
  assert.equal(h.state.description.value, '图像服务识别的蓝发主体')
  assert.match(source, /:disabled="busy \|\| !completeViews"/)
  assert.match(source, /:disabled="busy \|\| !canGenerateDescription"/)
})
test('actual dialog requires discard confirmation on every close, including untouched forms', () => {
  const h = harness()
  h.state.close()
  assert.equal(h.events.length, 0)
  assert.equal(h.state.exitConfirmation.value, true)
  h.state.exitConfirmation.value = false
  assert.equal(h.events.length, 0)
  h.state.close()
  h.state.confirmExit()
  assert.equal(h.events[0][0], 'close')
})
test('actual dialog refuses to close while a save is in progress', () => {
  const h = harness()
  h.state.saving.value = true
  h.state.close()
  h.state.confirmExit()
  assert.equal(h.state.exitConfirmation.value, false)
  assert.equal(h.events.length, 0)
})

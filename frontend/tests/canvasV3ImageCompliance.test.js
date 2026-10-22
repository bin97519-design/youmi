import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { imageAssetSourceUrl } from '../src/features/canvas-v3/config/imageAssetCollections.js'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/ImageComplianceDialog.vue', import.meta.url),
  'utf8',
)
const script = source
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
function harness(url = 'https://example.com/image.png') {
  const images = []
  const events = []
  const unmounts = []
  class MockImage {
    constructor() {
      this.naturalWidth = 2048
      this.naturalHeight = 1536
      images.push(this)
    }
    set src(value) {
      this.url = value
    }
    get src() {
      return this.url
    }
  }
  const context = {
    computed,
    ref,
    nextTick: async () => {},
    watch: () => {},
    onMounted: () => {},
    onBeforeUnmount: (fn) => unmounts.push(fn),
    defineProps: () => ({
      sourceNode: { id: 'image', data: { assetUrl: url, mediaWidth: 99, mediaHeight: 99 } },
    }),
    defineEmits:
      () =>
      (...args) =>
        events.push(args),
    imageAssetSourceUrl,
    Image: MockImage,
    AbortController,
    DOMException,
    URL,
  }
  runInNewContext(
    `${script}\nglobalThis.exposed={status,error,dimensions,format,check,close,imageAddressFormat};`,
    context,
  )
  return { state: context.exposed, images, events, unmounts }
}
test('compliance dialog production SFC compiles with explicit unavailable official-service notice', () => {
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'compliance-test' })
  const template = compileTemplate({
    source: descriptor.template.content,
    id: 'compliance-test',
    filename: 'ImageComplianceDialog.vue',
    compilerOptions: { bindingMetadata: compiled.bindings },
  })
  assert.deepEqual(template.errors, [])
  assert.match(source, /不代表平台审核结果/)
  assert.match(source, /未执行 · 服务未接入/)
  assert.equal(/fetch\(|uploadFile|client\.save|submitGeneration/.test(source), false)
})
test('actual local check uses browser decoded natural dimensions, not node metadata', async () => {
  const h = harness()
  const pending = h.state.check()
  assert.equal(h.state.status.value, 'loading')
  h.images[0].onload()
  await pending
  assert.equal(h.state.status.value, 'ready')
  assert.equal(h.state.dimensions.value.width, 2048)
  assert.equal(h.state.dimensions.value.height, 1536)
  assert.match(h.state.format.value, /地址扩展名，未校验 Content-Type/)
})
test('actual local check reports browser load failure without green pass or official success', async () => {
  const h = harness()
  const pending = h.state.check()
  h.images[0].onerror()
  await pending
  assert.equal(h.state.status.value, 'error')
  assert.match(h.state.error.value, /无法加载或解码/)
  assert.equal(h.state.dimensions.value, null)
})
test('invalid or ephemeral sources fail locally without creating an image request', async () => {
  for (const url of [
    'blob:temporary',
    'javascript:evil()',
    'https://user:secret@example.com/a.png',
    'data:image/svg+xml;base64,AAAA',
  ]) {
    const h = harness(url)
    await h.state.check()
    assert.equal(h.images.length, 0)
    assert.equal(h.state.status.value, 'error')
  }
})
test('recheck aborts stale readers and only newest load may update state', async () => {
  const h = harness()
  const first = h.state.check()
  const staleCallback = h.images[0].onload
  const second = h.state.check()
  assert.equal(h.images[0].src, '')
  staleCallback()
  h.images[1].naturalWidth = 400
  h.images[1].naturalHeight = 300
  h.images[1].onload()
  await Promise.all([first, second])
  assert.equal(h.state.dimensions.value.width, 400)
})
test('unmount aborts reader and blocks late callbacks', async () => {
  const h = harness()
  const pending = h.state.check()
  const staleCallback = h.images[0].onload
  h.unmounts[0]()
  staleCallback()
  await pending
  assert.equal(h.state.dimensions.value, null)
  assert.equal(h.images[0].src, '')
})
test('format information labels unverified remote extensions and accurate inline MIME separately', () => {
  const h = harness()
  assert.match(h.state.imageAddressFormat('https://example.com/signed?id=1'), /未知/)
  assert.equal(h.state.imageAddressFormat('data:image/png;base64,AAAA'), 'image/png（内联 MIME）')
})

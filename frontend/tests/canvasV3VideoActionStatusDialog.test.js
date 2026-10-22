import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { computed, ref } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/VideoActionStatusDialog.vue', import.meta.url),
  'utf8',
)
const script = source
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '')
function harness({ url = 'https://assets.example.com/video.mp4', action = 'compliance' } = {}) {
  const videos = []
  const timers = new Map()
  const events = []
  const unmounts = []
  let timerId = 0
  const opener = {
    isConnected: true,
    focused: false,
    focus() {
      this.focused = true
    },
  }
  const document = {
    activeElement: opener,
    createElement(type) {
      assert.equal(type, 'video')
      const listeners = new Map()
      const video = {
        videoWidth: 1920,
        videoHeight: 1080,
        duration: 13.125,
        loads: 0,
        pauses: 0,
        removed: [],
        listeners,
        addEventListener(type, callback) {
          listeners.set(type, callback)
        },
        removeEventListener(type, callback) {
          if (listeners.get(type) === callback) listeners.delete(type)
        },
        load() {
          this.loads++
        },
        pause() {
          this.pauses++
        },
        removeAttribute(name) {
          this.removed.push(name)
          if (name === 'src') this.src = ''
        },
        dispatch(type) {
          listeners.get(type)?.()
        },
      }
      videos.push(video)
      return video
    },
  }
  const props = {
    node: {
      id: 'video',
      data: {
        title: '参考视频',
        assetUrl: url,
        mediaWidth: 99,
        mediaHeight: 99,
        mediaDuration: 9999,
      },
    },
    action,
  }
  const mounted = []
  const context = {
    computed,
    ref,
    watch: () => {},
    useId: () => 'test',
    nextTick: async () => {},
    onMounted: (callback) => mounted.push(callback),
    onBeforeUnmount: (callback) => unmounts.push(callback),
    defineProps: () => props,
    defineEmits:
      () =>
      (...args) =>
        events.push(args),
    document,
    AbortController,
    DOMException,
    URL,
    setTimeout(callback, ms) {
      const id = ++timerId
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
  }
  runInNewContext(
    `${script}\nglobalThis.exposed={status,error,details,title,isCompliance,check,close,keydown,dialog,closeButton,safeVideoSource};`,
    context,
  )
  return {
    state: context.exposed,
    videos,
    timers,
    events,
    unmounts,
    mounted,
    props,
    document,
    opener,
  }
}

test('the complete production SFC compiles and clearly labels all unavailable services', () => {
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const compiled = compileScript(descriptor, { id: 'video-action-status-test' })
  const template = compileTemplate({
    source: descriptor.template.content,
    id: 'video-action-status-test',
    filename: 'VideoActionStatusDialog.vue',
    compilerOptions: { bindingMetadata: compiled.bindings },
  })
  assert.deepEqual(template.errors, [])
  assert.match(source, /data-cv3-video-dialog/)
  assert.match(source, /本地检查不代表官方审核通过/)
  assert.match(source, /原视频未改动，未创建或提交任务/)
  assert.doesNotMatch(source, /fetch\(|runVideo\(|runImage\(|submitTask|uploadFile|\.play\(/)
})

test('compliance reads actual native video metadata, never saved node dimensions or fabricated results', async () => {
  const h = harness()
  const pending = h.state.check()
  assert.equal(h.state.status.value, 'loading')
  const video = h.videos[0]
  assert.equal(video.preload, 'metadata')
  assert.equal(video.muted, true)
  assert.equal(video.src, 'https://assets.example.com/video.mp4')
  assert.equal([...h.timers.values()][0].ms, 15000)
  video.dispatch('loadedmetadata')
  await pending
  assert.equal(h.state.status.value, 'ready')
  assert.equal(h.state.details.value.width, 1920)
  assert.equal(h.state.details.value.height, 1080)
  assert.equal(h.state.details.value.duration, 13.125)
  assert.equal(h.state.details.value.ratio, '16:9')
  assert.equal(video.pauses, 1)
  assert.deepEqual(video.removed, ['src'])
  assert.equal(video.listeners.size, 0)
  assert.equal(h.timers.size, 0)
  assert.deepEqual(h.events, [])
})

test('decode failure and timeout are honest errors, clean up readers and can retry', async () => {
  const h = harness()
  const first = h.state.check()
  h.videos[0].dispatch('error')
  await first
  assert.equal(h.state.status.value, 'error')
  assert.match(h.state.error.value, /无法读取该视频/)
  assert.equal(h.state.details.value, null)
  const second = h.state.check()
  const timer = [...h.timers.values()][0]
  timer.callback()
  await second
  assert.equal(h.state.status.value, 'error')
  assert.match(h.state.error.value, /超时/)
  assert.equal(h.videos[1].listeners.size, 0)
  const third = h.state.check()
  h.videos[2].dispatch('loadedmetadata')
  await third
  assert.equal(h.state.status.value, 'ready')
  assert.equal(h.state.error.value, '')
})

test('zero or non-finite native dimensions/duration do not become a successful local check', async () => {
  for (const patch of [
    { videoWidth: 0 },
    { videoHeight: NaN },
    { duration: Infinity },
    { duration: -1 },
  ]) {
    const h = harness()
    const pending = h.state.check()
    Object.assign(h.videos[0], patch)
    h.videos[0].dispatch('loadedmetadata')
    await pending
    assert.equal(h.state.status.value, 'error')
    assert.equal(h.state.details.value, null)
  }
})

test('unsafe or missing sources fail before creating a video decoder or request', async () => {
  for (const url of [
    '',
    'javascript:alert(1)',
    'data:text/html,evil',
    'https://user:secret@example.com/a.mp4',
    'file:///private.mp4',
  ]) {
    const h = harness({ url })
    await h.state.check()
    assert.equal(h.state.status.value, 'error')
    assert.equal(h.videos.length, 0)
    assert.equal(h.timers.size, 0)
  }
})

test('a repeated check aborts and releases the old decoder and ignores its stale callback', async () => {
  const h = harness()
  const first = h.state.check()
  const stale = h.videos[0].listeners.get('loadedmetadata')
  const second = h.state.check()
  assert.deepEqual(h.videos[0].removed, ['src'])
  stale()
  h.videos[1].videoWidth = 720
  h.videos[1].videoHeight = 1280
  h.videos[1].dispatch('loadedmetadata')
  await Promise.all([first, second])
  assert.equal(h.state.details.value.ratio, '9:16')
  assert.equal(h.state.details.value.width, 720)
})

test('close and unmount cancel in-flight loading without applying late data or creating tasks', async () => {
  for (const unmount of [false, true]) {
    const h = harness()
    const pending = h.state.check()
    const stale = h.videos[0].listeners.get('loadedmetadata')
    if (unmount) h.unmounts[0]()
    else h.state.close()
    stale()
    await pending
    assert.equal(h.state.details.value, null)
    assert.equal(h.videos[0].src, '')
    assert.equal(h.timers.size, 0)
    assert.deepEqual(h.events, unmount ? [] : [['close']])
  }
})

test('unconnected AI actions never read or alter the original media and show their exact title', async () => {
  for (const [action, title] of [
    ['reshoot', '片段重拍'],
    ['frames', '逐帧拉片'],
    ['remove-subtitles', '智能去字幕'],
    ['separate', '音视频分离'],
    ['replace', '元素替换'],
    ['intro', '创意片头'],
  ]) {
    const h = harness({ action })
    await h.state.check()
    assert.equal(h.state.title.value, title)
    assert.equal(h.state.status.value, 'unavailable')
    assert.equal(h.videos.length, 0)
    assert.deepEqual(h.events, [])
    assert.equal(h.props.node.data.assetUrl, 'https://assets.example.com/video.mp4')
  }
})

test('mount focuses close, key trapping wraps, Escape requests close and unmount restores opener', async () => {
  const h = harness({ action: 'frames' })
  const first = {
    focus() {
      h.document.activeElement = first
    },
  }
  const last = {
    focus() {
      h.document.activeElement = last
    },
  }
  h.state.closeButton.value = first
  h.state.dialog.value = {
    querySelectorAll: () => [first, last],
    contains: (value) => value === first || value === last,
  }
  await h.mounted[0]()
  assert.equal(h.document.activeElement, first)
  const event = (key, shiftKey = false) => ({
    key,
    shiftKey,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
  })
  const reverseTab = event('Tab', true)
  h.state.keydown(reverseTab)
  assert.equal(reverseTab.prevented, true)
  assert.equal(h.document.activeElement, last)
  const tab = event('Tab')
  h.state.keydown(tab)
  assert.equal(h.document.activeElement, first)
  const escape = event('Escape')
  h.state.keydown(escape)
  assert.equal(escape.prevented, true)
  assert.equal(escape.stopped, true)
  assert.deepEqual(h.events, [['close']])
  h.unmounts[0]()
  assert.equal(h.opener.focused, true)
})

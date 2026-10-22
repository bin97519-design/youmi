import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'

const filename = new URL(
  '../src/features/canvas-v3/components/VideoNodePlayer.vue',
  import.meta.url,
)
const source = await readFile(filename, 'utf8')
const { descriptor, errors } = parse(source)
assert.deepEqual(errors, [])
const compiled = compileScript(descriptor, {
  id: 'canvas-video-node-player-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content.replace(
  /from (["'])vue\1/g,
  `from '${import.meta.resolve('vue')}'`,
)
const Player = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback)
    },
    dispatch(name, event = {}) {
      for (const callback of listeners.get(name) || []) callback(event)
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0)
    },
  }
}

async function mount({
  reducedMotion = false,
  selected = false,
  poster = '',
  initialTime = 0,
  playResult,
} = {}) {
  const calls = []
  const emits = []
  const observers = []
  const document = { ...eventTarget(), hidden: false }
  const motion = { ...eventTarget(), matches: reducedMotion }
  const window = {
    ...eventTarget(),
    matchMedia: () => motion,
    IntersectionObserver: class {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        observers.push(this)
      }
      observe(target) {
        this.target = target
      }
      disconnect() {
        this.disconnected = true
      }
    },
  }
  document.defaultView = window
  function node(type, text = '') {
    const entry = {
      type,
      tagName: type.toUpperCase(),
      text,
      props: {},
      children: [],
      parent: null,
      ownerDocument: document,
      focus() {
        calls.push(['focus', entry.props['aria-label']])
      },
      contains(target) {
        while (target) {
          if (entry === target) return true
          target = target.parent
        }
        return false
      },
    }
    if (type === 'video')
      Object.assign(entry, {
        currentTime: 0,
        readyState: 2,
        duration: 13.25,
        videoWidth: 1280,
        videoHeight: 720,
        paused: true,
        play() {
          calls.push(['play', entry.muted, entry.currentTime])
          entry.paused = false
          return playResult ? playResult() : Promise.resolve()
        },
        pause() {
          calls.push(['pause', entry.currentTime])
          entry.paused = true
        },
      })
    return entry
  }
  function detach(target) {
    if (!target.parent) return
    const children = target.parent.children
    const index = children.indexOf(target)
    if (index >= 0) children.splice(index, 1)
    target.parent = null
  }
  const renderer = createRenderer({
    createElement: (type) => node(type),
    createText: (text) => node('#text', text),
    createComment: (text) => node('#comment', text),
    setText: (target, text) => {
      target.text = text
    },
    setElementText: (target, text) => {
      target.text = text
      target.children = []
    },
    patchProp: (target, name, _old, value) => {
      target.props[name] = value
    },
    parentNode: (target) => target.parent,
    nextSibling: (target) =>
      target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
    insert: (target, parent, anchor) => {
      detach(target)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
      target.parent = parent
    },
    remove: detach,
    insertStaticContent: (content, parent, anchor) => {
      const target = node('#static', content.replace(/<[^>]*>/g, ''))
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
      target.parent = parent
      return [target, target]
    },
  })
  const all = (target, predicate) => [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => all(child, predicate)),
  ]
  const state = reactive({
    source: 'https://assets.example/video.mp4',
    title: '镜头 5',
    selected,
    poster,
    initialTime,
  })
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Player, {
        ...state,
        onMetadata: (value) => emits.push(['metadata', value]),
        onSnapshot: (value) => emits.push(['snapshot', value]),
        onExpand: () => emits.push(['expand']),
        onTime: (time) => emits.push(['time', time]),
        onTimeupdate: (time) => emits.push(['timeupdate', time]),
      }),
  })
  app.mount(root)
  await nextTick()
  const find = (predicate) => all(root, predicate)
  const wrapper = () => find((entry) => entry.props.role === 'group')[0]
  const media = () => find((entry) => entry.type === 'video')[0]
  return {
    state,
    calls,
    emits,
    root,
    document,
    window,
    motion,
    observers,
    find,
    wrapper,
    media,
    button: (label) =>
      find((entry) => entry.type === 'button' && entry.props['aria-label'] === label)[0],
    input: (label) =>
      find((entry) => entry.type === 'input' && entry.props['aria-label'] === label)[0],
    async metadata() {
      media().props.onLoadedmetadata({ target: media() })
      await nextTick()
    },
    async visible(value = true) {
      observers[0].callback([{ isIntersecting: value }])
      await nextTick()
    },
    async settle() {
      await Promise.resolve()
      await nextTick()
    },
    dispose: () => app.unmount(),
  }
}
const click = (target) => target.props.onClick({ stopPropagation() {} })
const text = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`

test('real metadata drives native playback, timeline and duration without fabricated values', async () => {
  const harness = await mount({ selected: true })
  try {
    assert.equal(harness.media().props.src, 'https://assets.example/video.mp4')
    assert.equal(harness.media().props.controls, undefined)
    assert.equal(harness.media().props.preload, 'metadata')
    assert.equal(harness.input('视频播放进度').props.disabled, true)
    assert.deepEqual(harness.emits, [])
    await harness.metadata()
    assert.deepEqual(harness.emits, [['metadata', { width: 1280, height: 720, duration: 13.25 }]])
    assert.equal(harness.input('视频播放进度').props.max, 13.25)
    assert.equal(harness.media().volume, 0.5)
    click(harness.button('播放视频'))
    await harness.settle()
    assert.ok(harness.button('暂停视频'))
    assert.deepEqual(
      harness.calls.filter(([name]) => name === 'play'),
      [['play', false, 0]],
    )
    harness.media().currentTime = 4.2
    harness.media().props.onTimeupdate()
    await harness.settle()
    assert.equal(harness.input('视频播放进度').props.value, 4.2)
    assert.match(text(harness.root), /0:04/)
    assert.match(text(harness.root), /0:13/)
    click(harness.button('暂停视频'))
    await harness.settle()
    assert.equal(harness.media().paused, true)
    assert.equal(harness.media().currentTime, 4.2)
  } finally {
    harness.dispose()
  }
})

test('muted hover preview is reversible and never overwrites explicit user playback', async () => {
  const harness = await mount({ poster: 'https://assets.example/poster.png' })
  try {
    await harness.metadata()
    await harness.visible()
    assert.equal(harness.find((entry) => entry.type === 'img').length, 1)
    harness.media().currentTime = 3
    harness.wrapper().props.onPointerenter()
    await harness.settle()
    assert.deepEqual(
      harness.calls.filter(([name]) => name === 'play'),
      [['play', true, 3]],
    )
    assert.equal(harness.find((entry) => entry.type === 'img').length, 0)
    harness.media().currentTime = 6
    harness.wrapper().props.onPointerleave()
    await harness.settle()
    assert.equal(harness.media().currentTime, 3)
    assert.equal(harness.media().muted, false)
    assert.equal(harness.find((entry) => entry.type === 'img').length, 1)
    click(harness.button('播放视频'))
    await harness.settle()
    harness.media().currentTime = 8
    harness.wrapper().props.onPointerleave()
    await harness.settle()
    assert.equal(harness.media().currentTime, 8)
    assert.equal(harness.media().paused, false)
    assert.equal(harness.find((entry) => entry.type === 'img').length, 0)
  } finally {
    harness.dispose()
  }
})

test('a playing hover preview shows pause and an explicit pause preserves the visible frame on leave', async () => {
  const harness = await mount({ poster: 'https://assets.example/poster.png' })
  try {
    await harness.metadata()
    await harness.visible()
    harness.wrapper().props.onPointerenter()
    await harness.settle()
    assert.ok(harness.button('暂停视频'))
    harness.media().currentTime = 4.25
    const plays = harness.calls.filter(([name]) => name === 'play').length
    click(harness.button('暂停视频'))
    await harness.settle()
    assert.equal(harness.media().paused, true)
    assert.equal(harness.media().currentTime, 4.25)
    harness.wrapper().props.onPointerleave()
    await harness.settle()
    assert.equal(harness.media().currentTime, 4.25)
    assert.equal(harness.find((entry) => entry.type === 'img').length, 0)
    assert.equal(harness.calls.filter(([name]) => name === 'play').length, plays)
    click(harness.button('播放视频'))
    await harness.settle()
    assert.equal(harness.media().paused, false)
  } finally {
    harness.dispose()
  }
})

test('reduced motion and offscreen state disable unsolicited preview but permit explicit playback', async () => {
  const harness = await mount({ reducedMotion: true })
  try {
    await harness.visible()
    harness.wrapper().props.onPointerenter()
    await harness.settle()
    assert.deepEqual(
      harness.calls.filter(([name]) => name === 'play'),
      [],
    )
    click(harness.button('播放视频'))
    await harness.settle()
    assert.equal(harness.media().paused, false)
    await harness.visible(false)
    assert.equal(harness.media().paused, true)
    harness.motion.matches = false
    harness.motion.dispatch('change')
    harness.wrapper().props.onPointerenter()
    await harness.settle()
    assert.equal(harness.calls.filter(([name]) => name === 'play').length, 1)
  } finally {
    harness.dispose()
  }
})

test('timeline clamps real seek values and volume and mute are sent to the media element', async () => {
  const harness = await mount()
  try {
    await harness.metadata()
    harness.input('视频播放进度').props.onInput({ target: { value: '999' } })
    await harness.settle()
    assert.equal(harness.media().currentTime, 13.25)
    harness.input('视频播放进度').props.onInput({ target: { value: '-5' } })
    assert.equal(harness.media().currentTime, 0)
    harness.input('视频播放进度').props.onInput({ target: { value: 'bad' } })
    assert.equal(harness.media().currentTime, 0)
    harness.input('视频音量').props.onInput({ target: { value: '0.72' } })
    await harness.settle()
    assert.equal(harness.media().volume, 0.72)
    assert.equal(harness.media().muted, false)
    click(harness.button('静音'))
    await harness.settle()
    assert.equal(harness.media().muted, true)
    click(harness.button('取消静音'))
    await harness.settle()
    assert.equal(harness.media().muted, false)
  } finally {
    harness.dispose()
  }
})

test('snapshot menu emits exact current, first and last timestamps without changing the asset or generating', async () => {
  const harness = await mount({ selected: true })
  try {
    await harness.metadata()
    harness.media().currentTime = 4.5
    for (const [label, expected] of [
      ['截取当前帧', { time: 4.5, position: 'current' }],
      ['截取首帧', { time: 0, position: 'first' }],
      ['截取尾帧', { time: 13.21, position: 'last' }],
    ]) {
      click(harness.button('截帧选项'))
      await harness.settle()
      const item = harness.find(
        (entry) => entry.props.role === 'menuitem' && text(entry).trim() === label,
      )[0]
      assert.ok(item)
      click(item)
      await harness.settle()
      assert.deepEqual(harness.emits.at(-1), ['snapshot', expected])
      assert.equal(harness.find((entry) => entry.props.role === 'menu').length, 0)
    }
    assert.equal(harness.state.source, 'https://assets.example/video.mp4')
    assert.equal(harness.calls.filter(([name]) => name === 'play').length, 0)
    assert.equal(harness.calls.filter(([name]) => name === 'focus').length, 3)
  } finally {
    harness.dispose()
  }
})

test('bottom-right viewfinder directly captures current frame and keeps additional frame choices separate', async () => {
  const harness = await mount({ selected: true })
  try {
    await harness.metadata()
    harness.media().currentTime = 1.25
    click(harness.button('截取当前帧'))
    await harness.settle()
    assert.deepEqual(harness.emits.at(-1), ['snapshot', { time: 1.25, position: 'current' }])
    assert.equal(harness.find((entry) => entry.props.role === 'menu').length, 0)
    assert.ok(harness.button('截帧选项'))
    assert.match(source, /cv3-video-node-snapshot-button svg\s*\{[^}]*width:\s*18px/s)
    assert.match(source, /cv3-video-node-snapshot-button\s*\{[^}]*width:\s*32px/s)
    assert.match(source, /stroke-linecap="round"/)
  } finally {
    harness.dispose()
  }
})

test('visibility loss, window blur, focus loss and deselection pause without erasing user position', async () => {
  const harness = await mount({ selected: true })
  try {
    await harness.metadata()
    for (const stop of [
      () => {
        harness.document.hidden = true
        harness.document.dispatch('visibilitychange')
        harness.document.hidden = false
      },
      () => harness.window.dispatch('blur'),
      () => harness.wrapper().props.onFocusout({ relatedTarget: null }),
      () => {
        harness.state.selected = false
      },
    ]) {
      click(harness.button('播放视频'))
      await harness.settle()
      harness.media().currentTime = 7
      stop()
      await harness.settle()
      assert.equal(harness.media().paused, true)
      assert.equal(harness.media().currentTime, 7)
    }
  } finally {
    harness.dispose()
  }
})

test('autoplay rejection remains a static poster; deliberate playback failure is honestly reported', async () => {
  const harness = await mount({
    poster: 'https://assets.example/poster.png',
    playResult: () => Promise.reject(new Error('decode failed')),
  })
  try {
    await harness.visible()
    harness.wrapper().props.onPointerenter()
    await harness.settle()
    assert.equal(harness.find((entry) => entry.props.role === 'status').length, 0)
    assert.equal(harness.find((entry) => entry.type === 'img').length, 1)
    click(harness.button('播放视频'))
    await harness.settle()
    assert.match(text(harness.find((entry) => entry.props.role === 'status')[0]), /无法播放/)
    assert.equal(harness.button('截取当前帧').props.disabled, true)
  } finally {
    harness.dispose()
  }
})

test('late hover play cannot revive a left node or pause a newer explicit playback', async () => {
  const resolvers = []
  const harness = await mount({
    playResult: () => new Promise((resolve) => resolvers.push(resolve)),
  })
  try {
    await harness.visible()
    harness.wrapper().props.onPointerenter()
    harness.wrapper().props.onPointerleave()
    resolvers.shift()()
    await harness.settle()
    assert.equal(harness.media().paused, true)
    harness.wrapper().props.onPointerenter()
    click(harness.button('播放视频'))
    const lateHover = resolvers.shift()
    const explicit = resolvers.shift()
    explicit()
    await harness.settle()
    lateHover()
    await harness.settle()
    assert.ok(harness.button('暂停视频'))
    assert.equal(harness.media().paused, false)
  } finally {
    harness.dispose()
  }
})

test('source replacement resets only local playback and unmount cleans observers and listeners', async () => {
  const harness = await mount()
  await harness.metadata()
  click(harness.button('播放视频'))
  await harness.settle()
  harness.state.source = 'https://assets.example/new.mp4'
  await harness.settle()
  assert.equal(harness.media().paused, true)
  assert.equal(harness.input('视频播放进度').props.disabled, true)
  assert.equal(harness.input('视频播放进度').props.value, 0)
  assert.ok(harness.document.listenerCount())
  harness.dispose()
  assert.equal(harness.document.listenerCount(), 0)
  assert.equal(harness.window.listenerCount(), 0)
  assert.equal(harness.motion.listenerCount(), 0)
  assert.equal(harness.observers[0].disconnected, true)
})

test('current time events contain real native seconds, are deduplicated and do not write node data', async () => {
  const harness = await mount({ selected: true })
  try {
    await harness.metadata()
    assert.equal(harness.emits.filter(([name]) => name === 'time').length, 0)
    harness.media().currentTime = 1.25
    harness.media().props.onTimeupdate()
    harness.media().props.onTimeupdate()
    await harness.settle()
    assert.deepEqual(
      harness.emits.filter(([name]) => name === 'time'),
      [['time', 1.25]],
    )
    assert.deepEqual(
      harness.emits.filter(([name]) => name === 'timeupdate'),
      [['timeupdate', 1.25]],
    )
    harness.input('视频播放进度').props.onInput({ target: { value: '5' } })
    harness.media().props.onTimeupdate()
    harness.media().currentTime = NaN
    harness.media().props.onTimeupdate()
    await harness.settle()
    assert.deepEqual(
      harness.emits.filter(([name]) => name === 'time'),
      [
        ['time', 1.25],
        ['time', 5],
      ],
    )
    assert.doesNotMatch(source, /updateNodeData|useCanvasV3GraphStore|localStorage/)
  } finally {
    harness.dispose()
  }
})

test('initial time applies only once per source and never resets user progress on duration or prop changes', async () => {
  const harness = await mount({
    selected: true,
    initialTime: 3,
    poster: 'https://assets.example/poster.png',
  })
  try {
    await harness.metadata()
    assert.equal(harness.media().currentTime, 3)
    assert.equal(harness.find((entry) => entry.type === 'img').length, 0)
    assert.deepEqual(
      harness.emits.filter(([name]) => name === 'time'),
      [['time', 3]],
    )
    harness.media().currentTime = 7
    harness.media().props.onTimeupdate()
    harness.state.initialTime = 12
    await harness.settle()
    harness.media().props.onDurationchange({ target: harness.media() })
    assert.equal(harness.media().currentTime, 7)
    harness.state.source = 'https://assets.example/replacement.mp4'
    harness.state.initialTime = 999
    await harness.settle()
    await harness.metadata()
    assert.equal(harness.media().currentTime, 13.21)
    assert.equal(harness.calls.filter(([name]) => name === 'play').length, 0)
  } finally {
    harness.dispose()
  }
})

test('player keeps node selection available while isolating controls and respects reduced motion', () => {
  assert.doesNotMatch(source, /fetch\(|localStorage|setInterval|setTimeout|autoplay|\bloop\b/)
  assert.match(source, /@pointerdown\.stop/)
  assert.match(source, /@click\.stop/)
  assert.match(source, /@dblclick\.stop="emit\('expand'\)"/)
  assert.match(source, /pointer-events:\s*none/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(source, /transition:\s*none/)
  assert.doesNotMatch(source, /:root\s*\{|html\s*\{|body\s*\{/)
})

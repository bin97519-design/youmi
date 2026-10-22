import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const componentFolder = new URL('../src/features/canvas-v3/components/', import.meta.url)
const sources = {}
const components = {}
for (const name of ['VideoActionToolbar', 'VideoPreviewDialog']) {
  const source = await readFile(new URL(`${name}.vue`, componentFolder), 'utf8')
  sources[name] = source
  const parsed = parse(source)
  assert.deepEqual(parsed.errors, [])
  const compiled = compileScript(parsed.descriptor, {
    id: `video-actions-${name}`,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } },
  })
  const moduleSource = compiled.content
    .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /import VideoNodePlayer from ['"]\.\/VideoNodePlayer.vue['"]/,
      `const VideoNodePlayer = {
        props: ['source', 'title', 'poster', 'selected', 'initialTime'],
        emits: ['metadata', 'snapshot', 'timeupdate'],
        setup: (props, {emit}) => () => testH('div', { 'data-player': true, ...props }, [
          testH('button', { 'data-child-metadata': true, onClick: () => emit('metadata', { width: 1080, height: 1920, duration: 13.25 }) }, 'child metadata'),
          testH('button', { 'data-child-snapshot': true, onClick: () => emit('snapshot', { position: 'current', time: 3 }) }, 'child snapshot'),
          testH('button', { 'data-child-time': true, onClick: () => emit('timeupdate', 3) }, 'child time'),
        ]),
      }`,
    )
  const text = `import {h as testH} from '${import.meta.resolve('vue')}'\n${moduleSource}`
  components[name] = (
    await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)
  ).default
}

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) fn(event)
    },
  }
}
const all = (node, predicate) => [
  ...(predicate(node) ? [node] : []),
  ...node.children.flatMap((child) => all(child, predicate)),
]
const textContent = (node) =>
  `${node.type === '#comment' ? '' : node.text}${node.children.map(textContent).join('')}`

async function mount(name, props = {}) {
  const oldDocument = globalThis.document
  const oldWindow = globalThis.window
  const document = { ...eventTarget(), activeElement: null }
  const window = { ...eventTarget(), innerWidth: 1135 }
  globalThis.document = document
  globalThis.window = window
  function node(type, text = '') {
    const value = markRaw({
      type,
      text,
      props: {},
      parent: null,
      children: [],
      isConnected: true,
      focus() {
        document.activeElement = this
      },
      contains(target) {
        return this === target || this.children.some((child) => child.contains(target))
      },
      getAttribute(name) {
        return this.props[name] ?? null
      },
      getBoundingClientRect() {
        if (this.props.role === 'toolbar') return { left: 100, top: 50, width: 908, height: 42 }
        return { left: 830, top: 50, width: 16, height: 30 }
      },
      querySelectorAll(selector) {
        return all(this, (entry) => {
          if (selector === '[role="menuitem"]') return entry.props.role === 'menuitem'
          return (
            (entry.type === 'button' && !entry.props.disabled) ||
            (entry.type === 'input' && !entry.props.disabled) ||
            entry.props.tabindex === '0'
          )
        })
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null
      },
    })
    return value
  }
  const opener = node('button')
  document.activeElement = opener
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
    setText: (target, text) => (target.text = text),
    setElementText: (target, text) => {
      target.text = text
      target.children = []
    },
    patchProp: (target, key, _old, value) => (target.props[key] = value),
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
    insertStaticContent: (text, parent) => {
      const target = node('#static', text)
      parent.children.push(target)
      target.parent = parent
      return [target, target]
    },
  })
  const state = reactive(props)
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(components[name], {
        ...state,
        onAction: (...args) => events.push(['action', ...args]),
        onClose: () => events.push(['close']),
        onSnapshot: (value) => events.push(['snapshot', value]),
        onDownload: () => events.push(['download']),
        onTimeupdate: (value) => events.push(['timeupdate', value]),
        onMetadata: (value) => events.push(['metadata', value]),
      }),
  })
  app.mount(root)
  await nextTick()
  await nextTick()
  return {
    state,
    events,
    document,
    window,
    opener,
    root,
    find: (predicate) => all(root, predicate),
    button: (label) =>
      all(
        root,
        (entry) =>
          entry.type === 'button' &&
          (entry.props['aria-label'] === label || textContent(entry).trim() === label),
      )[0],
    dispose() {
      app.unmount()
      globalThis.document = oldDocument
      globalThis.window = oldWindow
    },
  }
}
const click = (target) => target.props.onClick({ type: 'click', stopPropagation() {} })
function key(value, options = {}) {
  return {
    key: value,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...options,
  }
}

test('the observed toolbar emits each explicit action without a task or network side effect', async () => {
  const harness = await mount('VideoActionToolbar', { left: 570, top: 250 })
  try {
    for (const [label, action] of [
      ['高清', 'enhance'],
      ['片段重拍', 'reshoot'],
      ['逐帧拉片', 'frames'],
      ['智能去字幕', 'remove-subtitles'],
      ['音视频分离', 'separate'],
      ['元素替换', 'replace'],
      ['创意片头', 'intro'],
      ['下载视频', 'download'],
      ['放大预览', 'expand'],
    ]) {
      click(harness.button(label))
      assert.deepEqual(harness.events.at(-1), ['action', action, undefined])
    }
    assert.equal(
      harness.find((entry) => entry.props.role === 'toolbar')[0].props['aria-label'],
      '视频编辑工具栏',
    )
    assert.doesNotMatch(
      sources.VideoActionToolbar,
      /fetch\(|runVideo\(|runImage\(|task_id|thinkingLevel/,
    )
  } finally {
    harness.dispose()
  }
})

test('snapshot main button captures current frame while its menu selects only real observed positions', async () => {
  const harness = await mount('VideoActionToolbar', { left: 570, top: 250 })
  try {
    click(harness.button('截取当前帧'))
    assert.deepEqual(harness.events, [['action', 'snapshot', { position: 'current' }]])
    for (const [position, label] of [
      ['first', '截取首帧'],
      ['last', '截取尾帧'],
    ]) {
      click(harness.button('截帧选项'))
      await nextTick()
      assert.equal(harness.button('截帧选项').props['aria-expanded'], true)
      click(harness.button(label))
      await nextTick()
      assert.deepEqual(harness.events.at(-1), ['action', 'snapshot', { position }])
      assert.equal(harness.find((entry) => entry.props.role === 'menu').length, 0)
    }
  } finally {
    harness.dispose()
  }
})

test('snapshot keyboard menu navigation, Escape focus return, outside close and cleanup remain independent', async () => {
  const harness = await mount('VideoActionToolbar', { left: 570, top: 250 })
  try {
    const trigger = harness.button('截帧选项')
    await trigger.props.onKeydown(key('ArrowDown', { type: 'keydown' }))
    await nextTick()
    const menu = harness.find((entry) => entry.props.role === 'menu')[0]
    const entries = harness.find((entry) => entry.props.role === 'menuitem')
    assert.equal(harness.document.activeElement, entries[0])
    menu.props.onKeydown(key('End'))
    assert.equal(harness.document.activeElement, entries[2])
    const escape = key('Escape')
    menu.props.onKeydown(escape)
    await nextTick()
    assert.equal(escape.prevented, true)
    assert.equal(harness.document.activeElement, trigger)
    click(trigger)
    await nextTick()
    harness.document.dispatch('pointerdown', { target: harness.opener })
    await nextTick()
    assert.equal(harness.find((entry) => entry.props.role === 'menu').length, 0)
  } finally {
    const document = harness.document
    const window = harness.window
    harness.dispose()
    assert.equal(
      [...document.listeners.values()].every((set) => set.size === 0),
      true,
    )
    assert.equal(
      [...window.listeners.values()].every((set) => set.size === 0),
      true,
    )
  }
})

test('busy toolbar prevents duplicate actions and narrow viewports clamp rather than scaling text', async () => {
  const harness = await mount('VideoActionToolbar', { left: 5, top: -40, busy: true })
  try {
    click(harness.button('高清'))
    click(harness.button('截帧选项'))
    assert.deepEqual(harness.events, [])
    assert.equal(harness.button('高清').props.disabled, true)
    harness.window.innerWidth = 500
    harness.window.dispatch('resize')
    await nextTick()
    const toolbar = harness.find((entry) => entry.props.role === 'toolbar')[0]
    assert.deepEqual(toolbar.props.style, { left: '250px', top: '8px' })
    assert.match(sources.VideoActionToolbar, /font-size: 14px/)
    assert.match(sources.VideoActionToolbar, /overflow-x: auto/)
    assert.doesNotMatch(sources.VideoActionToolbar, /zoom:|scale\(/)
  } finally {
    harness.dispose()
  }
})

test('preview forwards source, poster and initial time without starting generation or automatic playback', async () => {
  const harness = await mount('VideoPreviewDialog', {
    source: 'https://assets.example.com/video.mp4',
    title: '测试片段',
    poster: 'https://assets.example.com/poster.jpg',
    currentTime: 4.5,
  })
  try {
    const dialog = harness.find((entry) => entry.props.role === 'dialog')[0]
    const player = harness.find((entry) => entry.props['data-player'])[0]
    assert.equal(dialog.props['aria-modal'], 'true')
    assert.equal(player.props.source, 'https://assets.example.com/video.mp4')
    assert.equal(player.props.poster, 'https://assets.example.com/poster.jpg')
    assert.equal(player.props.selected, true)
    assert.equal(player.props.initialTime, 4.5)
    assert.equal(harness.document.activeElement, harness.button('关闭视频预览'))
    assert.deepEqual(harness.events, [])
    click(harness.find((entry) => entry.props['data-child-snapshot'])[0])
    click(harness.find((entry) => entry.props['data-child-time'])[0])
    click(harness.button('下载视频'))
    assert.deepEqual(harness.events, [
      ['snapshot', { position: 'current', time: 3 }],
      ['timeupdate', 3],
      ['download'],
    ])
    assert.doesNotMatch(sources.VideoPreviewDialog, /fetch\(|\.play\(|autoplay|runVideo\(/)
  } finally {
    harness.dispose()
  }
})

test('preview forwards native metadata to its owner and sizes portrait media without changing playback position', async () => {
  const harness = await mount('VideoPreviewDialog', {
    source: 'https://assets.example.com/portrait.mp4',
    title: '竖屏视频',
    currentTime: 4.5,
  })
  try {
    assert.deepEqual(harness.events, [])
    click(harness.find((entry) => entry.props['data-child-metadata'])[0])
    await nextTick()
    assert.deepEqual(harness.events, [['metadata', { width: 1080, height: 1920, duration: 13.25 }]])
    const stage = harness.find((entry) =>
      String(entry.props.class || '').includes('cv3-video-preview-stage'),
    )[0]
    assert.equal(stage.props.style.aspectRatio, '1080 / 1920')
    const player = harness.find((entry) => entry.props['data-player'])[0]
    assert.equal(player.props.source, 'https://assets.example.com/portrait.mp4')
    assert.equal(player.props.initialTime, 4.5)
    assert.equal(player.props.selected, true)
    assert.equal(harness.state.currentTime, 4.5)
  } finally {
    harness.dispose()
  }
})

test('preview escape, backdrop and close button request closure; unmount restores opener focus', async () => {
  const harness = await mount('VideoPreviewDialog', {
    source: 'https://assets.example.com/video.mp4',
  })
  const opener = harness.opener
  const document = harness.document
  try {
    click(harness.button('关闭视频预览'))
    const backdrop = harness.find((entry) =>
      String(entry.props.class || '').includes('cv3-video-preview-backdrop'),
    )[0]
    const escape = key('Escape')
    backdrop.props.onKeydown(escape)
    backdrop.props.onClick({ target: backdrop, currentTarget: backdrop })
    assert.equal(escape.prevented, true)
    assert.equal(escape.stopped, true)
    assert.deepEqual(harness.events, [['close'], ['close'], ['close']])
    const last = harness.find((entry) => entry.props['data-child-time'])[0]
    document.activeElement = last
    const tab = key('Tab')
    backdrop.props.onKeydown(tab)
    assert.equal(tab.prevented, true)
    assert.equal(document.activeElement, harness.button('下载视频'))
  } finally {
    harness.dispose()
    assert.equal(document.activeElement, opener)
  }
})

test('closing preview through its open prop removes the player and restores focus', async () => {
  const harness = await mount('VideoPreviewDialog', {
    open: true,
    source: 'https://assets.example.com/video.mp4',
  })
  try {
    harness.state.open = false
    await nextTick()
    assert.equal(harness.find((entry) => entry.props['data-player']).length, 0)
    assert.equal(harness.document.activeElement, harness.opener)
  } finally {
    harness.dispose()
  }
})

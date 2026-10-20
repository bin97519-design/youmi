import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/PersonalAssetCarousel.vue', import.meta.url),
  'utf8',
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
  id: 'personal-asset-carousel-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(/from (['"])\.\.\/config\/([^'"]+)\1/g, (_match, _quote, filename) => {
    const path = filename.endsWith('.js') ? filename : `${filename}.js`
    return `from '${new URL(`../src/features/canvas-v3/config/${path}`, import.meta.url).href}'`
  })
const Carousel = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default
const fixtures = () =>
  ['窗帘', '床垫', '实木床', '儿童床', '床品'].map((name, index) => ({
    id: `asset-${index}`,
    name,
    imageUrl: `https://assets.example.com/${index}.png`,
    config: { libraryKind: 'product' },
  }))

function node(type, text = '') {
  return {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    focusCalls: 0,
    captures: new Set(),
    captureCalls: [],
    rect: { width: 1000, height: 420, left: 0, top: 0 },
    getBoundingClientRect() {
      return this.rect
    },
    setPointerCapture(id) {
      this.captures.add(id)
      this.captureCalls.push(['capture', id])
    },
    hasPointerCapture(id) {
      return this.captures.has(id)
    },
    releasePointerCapture(id) {
      this.captures.delete(id)
      this.captureCalls.push(['release', id])
    },
    focus() {
      this.focusCalls += 1
    },
    closest(selectors) {
      return selectors.split(',').includes(this.type) ? this : null
    },
  }
}
function detach(child) {
  if (!child.parent) return
  const index = child.parent.children.indexOf(child)
  if (index >= 0) child.parent.children.splice(index, 1)
  child.parent = null
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
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
  },
  parentNode: (target) => target.parent,
  nextSibling: (target) => target.parent?.children[target.parent.children.indexOf(target) + 1],
  insert: (child, parent, anchor) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach,
  insertStaticContent: (content, parent, anchor) => {
    const child = node('#static', content)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
    return [child, child]
  },
})
function all(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => all(child, predicate)),
  ]
}
function classIncludes(entry, name) {
  return String(entry.props.class || '')
    .split(/\s+/)
    .includes(name)
}
const settle = async () => {
  await nextTick()
  await nextTick()
}

function platform({ reducedMotion = false, legacyMedia = false } = {}) {
  const frames = new Map()
  const windowListeners = new Map()
  const documentListeners = new Map()
  const mediaListeners = new Set()
  const cancelled = []
  const observers = []
  let now = 1000,
    frameId = 0
  const add = (map, key, callback) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(callback)
  }
  const remove = (map, key, callback) => map.get(key)?.delete(callback)
  const media = {
    matches: reducedMotion,
    ...(legacyMedia
      ? {
          addListener: (callback) => mediaListeners.add(callback),
          removeListener: (callback) => mediaListeners.delete(callback),
        }
      : {
          addEventListener: (_key, callback) => mediaListeners.add(callback),
          removeEventListener: (_key, callback) => mediaListeners.delete(callback),
        }),
  }
  const document = {
    hidden: false,
    addEventListener: (key, callback) => add(documentListeners, key, callback),
    removeEventListener: (key, callback) => remove(documentListeners, key, callback),
  }
  return {
    frames,
    cancelled,
    mediaListeners,
    windowListeners,
    documentListeners,
    observers,
    globals: {
      window: {
        matchMedia: () => media,
        addEventListener: (key, callback) => add(windowListeners, key, callback),
        removeEventListener: (key, callback) => remove(windowListeners, key, callback),
      },
      document,
      requestAnimationFrame(callback) {
        const id = ++frameId
        frames.set(id, callback)
        return id
      },
      cancelAnimationFrame(id) {
        frames.delete(id)
        cancelled.push(id)
      },
      ResizeObserver: class {
        constructor(callback) {
          this.callback = callback
          this.disconnected = false
          observers.push(this)
        }
        observe(element) {
          this.element = element
        }
        disconnect() {
          this.disconnected = true
        }
      },
    },
    get now() {
      return now
    },
    frame(ms = 16) {
      now += ms
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(now)
    },
    motion(value) {
      media.matches = value
      for (const callback of mediaListeners) callback(media)
    },
    hide() {
      document.hidden = true
      for (const callback of documentListeners.get('visibilitychange') || []) callback()
    },
    blur() {
      for (const callback of windowListeners.get('blur') || []) callback()
    },
  }
}
async function mount(props = {}, options = {}) {
  const clock = platform(options)
  const descriptors = new Map()
  for (const [key, value] of Object.entries(clock.globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const state = reactive({
    items: fixtures(),
    activeId: 'asset-0',
    selectedIds: [],
    multiSelect: false,
    disabled: false,
    kind: 'product',
    ...props,
  })
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Carousel, {
        ...state,
        onActivate: (id) => events.push(['activate', id]),
        onSelect: (id) => events.push(['select', id]),
      }),
  })
  app.mount(root)
  await settle()
  let disposed = false
  const find = (predicate) => all(root, predicate)
  const stage = () => find((entry) => classIncludes(entry, 'cv3-personal-carousel-stage'))[0]
  const region = () => find((entry) => entry.props.role === 'region')[0]
  const button = (label) => find((entry) => entry.props['aria-label'] === label)[0]
  const range = () => find((entry) => entry.props.type === 'range')[0]
  const card = (id) => {
    const item = state.items.find((item) => item.id === id)
    return button(`选择${item?.name}`)?.parent
  }
  return {
    root,
    state,
    events,
    clock,
    find,
    stage,
    region,
    button,
    range,
    card,
    async click(label, detail = 1) {
      const target = button(label)
      assert.ok(target, `button ${label}`)
      if (!target.props.disabled) target.props.onClick?.({ detail })
      await settle()
    },
    async key(key, target = region(), extra = {}) {
      const event = {
        key,
        target,
        currentTarget: region(),
        prevented: 0,
        stopped: 0,
        preventDefault() {
          this.prevented += 1
        },
        stopPropagation() {
          this.stopped += 1
        },
        ...extra,
      }
      region().props.onKeydown(event)
      await settle()
      return event
    },
    async wheel(deltaY, extra = {}) {
      const event = {
        deltaY,
        deltaX: 0,
        timeStamp: clock.now,
        prevented: 0,
        stopped: 0,
        preventDefault() {
          this.prevented += 1
        },
        stopPropagation() {
          this.stopped += 1
        },
        ...extra,
      }
      stage().props.onWheel(event)
      await settle()
      return event
    },
    async pointer(action, x, y = 100, extra = {}) {
      const event = {
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
        timeStamp: clock.now,
        target: stage(),
        currentTarget: stage(),
        preventDefault() {},
        stopPropagation() {},
        ...extra,
      }
      stage().props[`onPointer${action}`]?.(event)
      await settle()
      return event
    },
    dispose() {
      if (disposed) return
      disposed = true
      app.unmount()
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

test('the visual-only component reuses existing physics and preserves original contain images with no hover motion or create placeholder', () => {
  assert.match(source, /createCharacterWheelNavigator/)
  assert.match(source, /createCharacterDragNavigator/)
  assert.match(source, /stepCharacterSpring/)
  assert.match(source, /defineEmits\(\['activate', 'select'\]\)/)
  assert.doesNotMatch(
    source,
    /fetch\(|axios|\/api\/|createCharacterAssetClient|addNode|updateNodeData/,
  )
  assert.doesNotMatch(source, /创建新|isCreate|Wireframe|lookTarget|rotate[XY]/)
  const css = descriptor.styles.map((style) => style.content).join('\n')
  assert.match(css, /aspect-ratio:\s*4 \/ 3/)
  assert.match(css, /object-fit:\s*contain/)
  assert.doesNotMatch(css, /object-fit:\s*cover|transition\s*:|animation\s*:/)
  assert.match(css, /height:\s*100%/)
  assert.match(css, /min-height:\s*0/)
  assert.match(css, /prefers-reduced-motion/)
})

test('renders current real assets, deduplicates unsafe inputs and never changes items or implicitly chooses one', async () => {
  const items = fixtures()
  items.push(items[0], null, { id: 'unsafe', name: '坏地址', imageUrl: 'javascript:alert(1)' })
  const before = structuredClone(items)
  const harness = await mount({ items, activeId: 'asset-1', selectedIds: ['asset-1'] })
  try {
    assert.equal(harness.region().props['aria-label'], '商品列表')
    assert.equal(harness.button('选择床垫').props['aria-current'], 'true')
    assert.equal(harness.button('选择床垫').props['aria-pressed'], true)
    assert.equal(harness.button('选择床垫').props.tabindex, 0)
    assert.equal(harness.button('选择窗帘').props.tabindex, -1)
    assert.equal(harness.button('选择窗帘').props['aria-pressed'], false)
    assert.equal(harness.find((entry) => entry.props.alt === '窗帘').length, 1)
    assert.equal(harness.button('选择坏地址'), undefined)
    assert.equal(harness.range().props.max, 4)
    assert.equal(harness.card('asset-1').props.style.opacity, 1)
    assert.ok(harness.card('asset-0').props.style.opacity < 0.5)
    assert.deepEqual(harness.events, [])
    assert.deepEqual(items, before)
  } finally {
    harness.dispose()
  }
})

test('arrows navigate but never toggle selection, honor edges and synchronize an external active id', async () => {
  const harness = await mount()
  try {
    assert.equal(harness.button('上一个商品').props.disabled, true)
    await harness.click('下一个商品')
    assert.deepEqual(harness.events, [['activate', 'asset-1']])
    assert.ok(harness.clock.frames.size > 0)
    assert.equal(harness.button('选择床垫').props['aria-current'], 'true')
    assert.equal(harness.button('选择床垫').props['aria-pressed'], true)
    assert.equal(harness.button('选择窗帘').props['aria-pressed'], false)
    harness.state.activeId = 'asset-4'
    await settle()
    assert.equal(harness.button('下一个商品').props.disabled, true)
    assert.equal(harness.button('选择床品').props['aria-current'], 'true')
    assert.deepEqual(harness.events, [['activate', 'asset-1']])
    await harness.click('下一个商品')
    assert.equal(harness.events.length, 1)
  } finally {
    harness.dispose()
  }
})

test('legacy invalid primary images fall back to a separately validated cover without changing source data', async () => {
  const items = [
    {
      id: 'legacy-cover',
      name: '旧封面商品',
      imageUrl: 'javascript:alert(1)',
      coverUrl: 'https://assets.example.com/valid-cover.png',
    },
  ]
  const before = structuredClone(items)
  const harness = await mount({ items, activeId: items[0].id, selectedIds: [] })
  try {
    assert.equal(harness.button('选择旧封面商品').props['aria-pressed'], true)
    assert.equal(harness.range().props.max, 0)
    assert.equal(
      harness.find((entry) => entry.props.alt === '旧封面商品')[0].props.src,
      items[0].coverUrl,
    )
    await harness.click('选择旧封面商品')
    assert.deepEqual(harness.events, [['select', 'legacy-cover']])
    assert.deepEqual(items, before)
  } finally {
    harness.dispose()
  }
})

test('card clicks emit safe ids and multi-selection renders independent checkbox state for scenes', async () => {
  const harness = await mount({ kind: 'scene', multiSelect: true, selectedIds: ['asset-1'] })
  try {
    assert.equal(harness.region().props['aria-label'], '场景列表')
    assert.equal(harness.range().props['aria-label'], '场景列表位置')
    assert.equal(harness.button('选择床垫').props.role, 'checkbox')
    assert.equal(harness.button('选择床垫').props['aria-checked'], true)
    assert.equal(harness.button('选择窗帘').props['aria-checked'], false)
    await harness.click('选择床垫')
    assert.deepEqual(harness.events, [
      ['activate', 'asset-1'],
      ['select', 'asset-1'],
    ])
    assert.deepEqual(harness.state.selectedIds, ['asset-1'], 'selection remains parent-owned')
    assert.ok(harness.button('下一个场景'))
  } finally {
    harness.dispose()
  }
})

test('wheel only consumes ordinary vertical gestures, suppresses momentum tails and permits reversals', async () => {
  const harness = await mount()
  try {
    assert.equal((await harness.wheel(100, { ctrlKey: true })).prevented, 0)
    assert.equal((await harness.wheel(100, { metaKey: true })).prevented, 0)
    assert.equal((await harness.wheel(20, { deltaX: 40 })).prevented, 0)
    assert.equal((await harness.wheel(Number.NaN)).prevented, 0)
    assert.equal((await harness.wheel(100)).prevented, 1)
    assert.deepEqual(harness.events, [['activate', 'asset-1']])
    await harness.wheel(40, { timeStamp: 1040 })
    await harness.wheel(10, { timeStamp: 1100 })
    assert.equal(harness.events.length, 1)
    await harness.wheel(-100, { timeStamp: 1140 })
    assert.deepEqual(harness.events.at(-1), ['activate', 'asset-0'])
  } finally {
    harness.dispose()
  }
})

test('keyboard arrows and Home/End focus the active card while range retains native keyboard behavior', async () => {
  const harness = await mount()
  try {
    const right = await harness.key('ArrowRight')
    assert.equal(right.prevented, 1)
    assert.equal(right.stopped, 1)
    assert.equal(harness.button('选择床垫').focusCalls, 1)
    await harness.key('End')
    assert.deepEqual(harness.events.at(-1), ['activate', 'asset-4'])
    assert.equal(harness.button('选择床品').focusCalls, 1)
    await harness.key('Home')
    assert.deepEqual(harness.events.at(-1), ['activate', 'asset-0'])
    const count = harness.events.length
    assert.equal((await harness.key('ArrowRight', harness.range())).prevented, 0)
    assert.equal(
      (await harness.key('ArrowRight', harness.region(), { ctrlKey: true })).prevented,
      0,
    )
    assert.equal(harness.events.length, count)
    await harness.key('Enter')
    assert.deepEqual(harness.events.at(-1), ['select', 'asset-0'])
    const pointerButton = harness.button('选择窗帘')
    await harness.key('Enter', pointerButton)
    assert.equal(harness.events.length, count + 1, 'native button Enter must not choose twice')
  } finally {
    harness.dispose()
  }
})

test('the native position range moves immediately and cancels an in-flight spring', async () => {
  const harness = await mount()
  try {
    await harness.click('下一个商品')
    harness.clock.frame()
    await settle()
    assert.ok(harness.clock.frames.size)
    harness.range().props.onInput({ target: { value: '4' } })
    await settle()
    assert.deepEqual(harness.events.at(-1), ['activate', 'asset-4'])
    assert.equal(harness.range().props.value, 4)
    assert.equal(harness.card('asset-4').props.style.opacity, 1)
    assert.equal(harness.clock.frames.size, 0)
    assert.equal(harness.range().props['aria-valuetext'], '5 / 5 床品')
  } finally {
    harness.dispose()
  }
})

test('drag tracks continuously, hands momentum to the spring, suppresses pointer click and is interruptible from presentation', async () => {
  const harness = await mount()
  try {
    await harness.click('下一个商品')
    harness.clock.frame(32)
    await settle()
    const current = harness.card('asset-1').props.style.transform
    await harness.pointer('down', 500)
    assert.equal(harness.clock.frames.size, 0)
    assert.equal(
      harness.card('asset-1').props.style.transform,
      current,
      'grab cannot jump to logical target',
    )
    harness.clock.frame(16)
    await harness.pointer('move', 240)
    assert.ok(classIncludes(harness.stage(), 'is-dragging'))
    assert.deepEqual(harness.stage().captureCalls, [['capture', 1]])
    assert.notEqual(harness.card('asset-1').props.style.transform, current)
    harness.clock.frame(16)
    await harness.pointer('up', 200)
    assert.ok(!classIncludes(harness.stage(), 'is-dragging'))
    assert.equal(harness.stage().captures.size, 0)
    assert.deepEqual(harness.stage().captureCalls.at(-1), ['release', 1])
    assert.ok(harness.clock.frames.size > 0)
    const selects = harness.events.filter(([name]) => name === 'select').length
    const activeButton = harness.find((entry) => entry.props['aria-current'] === 'true')[0]
    activeButton.props.onClick({ detail: 1 })
    await settle()
    assert.equal(harness.events.filter(([name]) => name === 'select').length, selects)
    activeButton.props.onClick({ detail: 0 })
    await settle()
    assert.equal(harness.events.filter(([name]) => name === 'select').length, selects + 1)
    for (let frame = 0; frame < 90 && harness.clock.frames.size; frame += 1) {
      harness.clock.frame(16)
      await settle()
    }
    assert.equal(harness.clock.frames.size, 0)
  } finally {
    harness.dispose()
  }
})

test('edge drag is resisted, unrelated pointers and vertical intent cannot navigate or select', async () => {
  const harness = await mount()
  try {
    const initial = harness.card('asset-0').props.style.transform
    await harness.pointer('move', 530)
    assert.equal(harness.card('asset-0').props.style.transform, initial, 'hover must remain still')
    await harness.pointer('down', 500)
    await harness.pointer('move', 1000, 100, { pointerId: 2 })
    assert.equal(harness.card('asset-0').props.style.transform, initial)
    await harness.pointer('move', 1000)
    const translated = Number(
      harness.card('asset-0').props.style.transform.match(/translate3d\(([^p]+)/)[1],
    )
    assert.ok(
      translated > 0 && translated < 100,
      'edge resistance is capped below one fifth card step',
    )
    await harness.pointer('cancel', 1000)
    assert.equal(harness.stage().captures.size, 0)
    assert.deepEqual(harness.events, [])
    await harness.pointer('down', 500)
    await harness.pointer('move', 501, 150)
    assert.ok(!classIncludes(harness.stage(), 'is-dragging'))
    assert.deepEqual(harness.events, [])
  } finally {
    harness.dispose()
  }
})

test('reduced motion, disabled state, hidden pages and unmount release pointer and animation resources', async () => {
  const harness = await mount({}, { reducedMotion: true, legacyMedia: true })
  try {
    await harness.click('下一个商品')
    assert.equal(harness.clock.frames.size, 0)
    assert.equal(harness.card('asset-1').props.style.opacity, 1)
    harness.clock.motion(false)
    await harness.click('下一个商品')
    assert.ok(harness.clock.frames.size)
    harness.clock.motion(true)
    await settle()
    assert.equal(harness.clock.frames.size, 0)
    harness.clock.motion(false)
    await harness.pointer('down', 500)
    await harness.pointer('move', 100)
    assert.ok(harness.stage().captures.size)
    harness.state.disabled = true
    await settle()
    assert.equal(harness.stage().captures.size, 0)
    const count = harness.events.length
    assert.equal((await harness.wheel(100)).prevented, 0)
    await harness.click('选择实木床')
    await harness.key('End')
    assert.equal(harness.events.length, count)
    assert.equal(harness.range().props.disabled, true)
    harness.state.disabled = false
    await settle()
    await harness.key('Home')
    assert.ok(harness.clock.frames.size)
    harness.clock.hide()
    assert.equal(harness.clock.frames.size, 0)
    assert.equal(harness.clock.mediaListeners.size, 1)
  } finally {
    harness.dispose()
  }
  assert.equal(harness.clock.frames.size, 0)
  assert.equal(harness.clock.mediaListeners.size, 0)
  assert.ok(harness.clock.observers.every((observer) => observer.disconnected))
  assert.ok([...harness.clock.windowListeners.values()].every((listeners) => !listeners.size))
  assert.ok([...harness.clock.documentListeners.values()].every((listeners) => !listeners.size))
})

test('resize preserves a contained 4:3 frame and filtered or empty input cannot act on stale cards', async () => {
  const harness = await mount({ activeId: 'asset-2' })
  try {
    const firstWidth = parseFloat(harness.card('asset-2').props.style.width)
    harness.stage().rect = { width: 500, height: 240 }
    harness.clock.observers[0].callback([])
    await settle()
    assert.ok(parseFloat(harness.card('asset-2').props.style.width) < firstWidth)
    assert.equal(harness.card('asset-2').props.style.opacity, 1)
    harness.state.items = fixtures().slice(0, 1)
    await settle()
    assert.equal(harness.button('选择实木床'), undefined)
    assert.equal(harness.range().props.max, 0)
    assert.equal(harness.range().props.disabled, true)
    assert.equal(harness.button('选择窗帘').props['aria-current'], 'true')
    harness.state.items = []
    await settle()
    assert.equal(harness.button('选择窗帘'), undefined)
    assert.equal(harness.range().props['aria-valuetext'], '0 / 0 ')
    await harness.key('Enter')
    assert.deepEqual(harness.events, [])
    assert.equal(harness.button('上一个商品').props.disabled, true)
    assert.equal(harness.button('下一个商品').props.disabled, true)
  } finally {
    harness.dispose()
  }
})

test('a new single-card pointer click clears a previous drag guard and unmount releases a captured pointer', async () => {
  const harness = await mount()
  try {
    await harness.pointer('down', 500)
    await harness.pointer('move', 300)
    await harness.pointer('up', 300)
    harness.state.items = fixtures().slice(0, 1)
    await settle()
    await harness.pointer('down', 500)
    await harness.pointer('up', 500)
    await harness.click('选择窗帘')
    assert.deepEqual(harness.events.at(-1), ['select', 'asset-0'])
    harness.state.items = fixtures()
    await settle()
    await harness.pointer('down', 500)
    await harness.pointer('move', 300)
    harness.clock.blur()
    assert.equal(harness.stage().captures.size, 0)
    await harness.pointer('down', 500)
    await harness.pointer('move', 300)
    const element = harness.stage()
    assert.ok(element.captures.size)
    harness.dispose()
    assert.equal(element.captures.size, 0)
    assert.deepEqual(element.captureCalls.at(-1), ['release', 1])
    assert.equal(harness.clock.frames.size, 0)
  } finally {
    harness.dispose()
  }
})

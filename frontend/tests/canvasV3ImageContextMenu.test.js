import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/ImageContextMenu.vue', import.meta.url),
  'utf8',
)
// The production template is compiled intact apart from the custom renderer's body target.
const parsed = parse(
  source.replace('<Teleport to="body">', '<div>').replace('</Teleport>', '</div>'),
)
assert.deepEqual(parsed.errors, [])
const { descriptor } = parsed
const compiled = compileScript(descriptor, {
  id: 'image-context-menu-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content.replace(
  /from (['"])vue\1/g,
  `from '${import.meta.resolve('vue')}'`,
)
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function node(type, text = '') {
  return markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    focusCalls: 0,
    isConnected: true,
    focus() {
      this.focusCalls++
      globalThis.document.activeElement = this
      this.props.onFocus?.({ target: this })
    },
    contains(target) {
      return this === target || this.children.some((child) => child.contains(target))
    },
    getBoundingClientRect() {
      return { left: 500, top: 380, width: 12, height: 12 }
    },
  })
}
function detach(target) {
  if (!target.parent) return
  const index = target.parent.children.indexOf(target)
  if (index >= 0) target.parent.children.splice(index, 1)
  target.parent = null
}
const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, value) => {
    target.text = value
  },
  setElementText: (target, value) => {
    target.text = value
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
})
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const text = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`
const settle = async () => {
  await nextTick()
  await nextTick()
}

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(name, callback, capture) {
      const entries = listeners.get(name) || []
      entries.push({ callback, capture })
      listeners.set(name, entries)
    },
    removeEventListener(name, callback, capture) {
      listeners.set(
        name,
        (listeners.get(name) || []).filter(
          (entry) => entry.callback !== callback || entry.capture !== capture,
        ),
      )
    },
    dispatch(name, event = {}) {
      for (const entry of listeners.get(name) || []) entry.callback(event)
    },
  }
}

async function mount(t, props = {}, size = { width: 1135, height: 892 }) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const window = { ...eventTarget(), innerWidth: size.width, innerHeight: size.height }
  const document = { ...eventTarget(), activeElement: null }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  const state = reactive({ position: { x: 300, y: 200 }, rating: 0, ...props })
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        onAction: (key) => events.push(['action', key]),
        onRate: (value) => events.push(['rate', value]),
        onClose: () => events.push(['close']),
      }),
  })
  app.mount(root)
  await settle()
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    app.unmount()
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument)
    else delete globalThis.document
  }
  t.after(dispose)
  const find = (predicate) => all(root, predicate)
  const menu = find((entry) => entry.props.role === 'menu')[0]
  return {
    root,
    menu,
    state,
    events,
    window,
    document,
    find,
    dispose,
    button: (key) => find((entry) => entry.props['data-context-action'] === key)[0],
    star: (value) => find((entry) => entry.props['aria-label'] === `${value}星`)[0],
    helper: (key) => find((entry) => entry.props['data-context-help'] === key)[0],
    async key(key, options = {}) {
      let prevented = false
      menu.props.onKeydown({
        key,
        target: document.activeElement,
        preventDefault() {
          prevented = true
        },
        stopPropagation() {},
        ...options,
      })
      await settle()
      return prevented
    },
    async click(target) {
      target.props.onClick?.({ target, stopPropagation() {}, preventDefault() {} })
      await settle()
    },
  }
}

test('the real menu keeps the measured text-only order, separators and native action buttons', async (t) => {
  const harness = await mount(t)
  const rows = harness.find((entry) => entry.props.role === 'menuitem')
  assert.deepEqual(
    rows.map((entry) => entry.props['data-context-action']),
    [
      'compliance',
      'save-asset',
      'panorama',
      'create-subject',
      'layout',
      'copy-node',
      'copy-image',
      'duplicate',
      'paste',
      'delete',
      'copy-to-clipboard',
    ],
  )
  assert.ok(rows.every((entry) => entry.type === 'button'))
  assert.equal(text(harness.button('copy-to-clipboard')), '复制到剪贴板')
  assert.equal(harness.find((entry) => entry.props.role === 'separator').length, 2)
  assert.equal(
    harness.find((entry) => entry.type === 'svg').length,
    5,
    'only the five rating stars are icons',
  )
  assert.notEqual(harness.menu.props['data-image-context-menu'], undefined)
  assert.equal(harness.star(1), harness.document.activeElement)
  const style = descriptor.styles[0]
  assert.equal(style.scoped, true)
  assert.match(style.content, /width:\s*196px/)
  assert.match(style.content, /height:\s*455px/)
  assert.match(style.content, /font-size:\s*13px/)
  assert.match(style.content, /line-height:\s*20\.15px/)
  assert.doesNotMatch(style.content, /(?:^|\n)\s*(?:html|body|:root)\b/)
})

test('rating stars expose their checked value and emit a cancellable rating without closing', async (t) => {
  const harness = await mount(t, { rating: 3 })
  assert.equal(harness.star(3).props['aria-checked'], true)
  assert.equal(harness.star(2).props['aria-checked'], false)
  assert.match(harness.star(2).props.class, /filled/)
  await harness.click(harness.star(3))
  await harness.click(harness.star(5))
  assert.deepEqual(harness.events, [
    ['rate', 0],
    ['rate', 5],
  ])
  harness.state.rating = 5
  await settle()
  assert.equal(harness.star(5).props['aria-checked'], true)
  assert.match(harness.star(5).props.class, /filled/)
})

test('all enabled entries emit their exact action and close, without handling the actual operation', async (t) => {
  const harness = await mount(t)
  for (const entry of harness.find((target) => target.props.role === 'menuitem')) {
    const key = entry.props['data-context-action']
    await harness.click(entry)
    assert.deepEqual(harness.events.splice(0), [['action', key], ['close']])
  }
  assert.doesNotMatch(source, /\bfetch\s*\(|\bnavigator\.clipboard\b|\buseCanvasV3GraphStore\b/)
})

test('menu positions stay in screen pixels, clamp to viewport edges and update on resize or prop change', async (t) => {
  const harness = await mount(t, { position: { x: 1120, y: 880 } })
  assert.deepEqual(harness.menu.props.style, {
    left: '931px',
    top: '429px',
    width: '196px',
    height: '455px',
  })
  harness.state.position = { x: -100, y: -20 }
  await settle()
  assert.equal(harness.menu.props.style.left, '8px')
  assert.equal(harness.menu.props.style.top, '8px')
  harness.state.position = { x: 1000, y: 1000 }
  harness.window.innerWidth = 500
  harness.window.innerHeight = 300
  harness.window.dispatch('resize')
  await settle()
  assert.deepEqual(harness.menu.props.style, {
    left: '296px',
    top: '8px',
    width: '196px',
    height: '284px',
  })
})

test('canPaste and protected task controls disable only the relevant operations and keyboard skips them', async (t) => {
  const harness = await mount(t, { locked: true, canPaste: false })
  for (const key of ['copy-node', 'duplicate', 'delete', 'paste']) {
    assert.equal(harness.button(key).props.disabled, true)
    assert.equal(harness.button(key).props['aria-disabled'], true)
    await harness.click(harness.button(key))
  }
  assert.equal(harness.button('copy-image').props.disabled, false)
  assert.deepEqual(harness.events, [])
  await harness.key('End')
  assert.equal(harness.document.activeElement, harness.button('copy-to-clipboard'))
  await harness.key('ArrowUp')
  assert.equal(harness.document.activeElement, harness.button('copy-image'))
  await harness.key('d', { ctrlKey: true })
  await harness.key('v', { metaKey: true })
  await harness.key('Delete')
  assert.deepEqual(harness.events, [])
})

test('Arrow keys, Home/End, Enter/Space and Escape operate real focusable menu buttons', async (t) => {
  const harness = await mount(t)
  await harness.key('ArrowRight')
  assert.equal(harness.document.activeElement, harness.star(2))
  await harness.key(' ')
  assert.deepEqual(harness.events.splice(0), [['rate', 2]])
  await harness.key('ArrowDown')
  assert.equal(harness.document.activeElement, harness.button('compliance'))
  await harness.key('ArrowUp')
  assert.equal(harness.document.activeElement, harness.star(2))
  await harness.key('End')
  assert.equal(harness.document.activeElement, harness.button('copy-to-clipboard'))
  await harness.key('ArrowDown')
  assert.equal(harness.document.activeElement, harness.star(2))
  await harness.key('Home')
  assert.equal(harness.document.activeElement, harness.star(2))
  await harness.key('ArrowDown')
  await harness.key('Enter')
  assert.deepEqual(harness.events.splice(0), [['action', 'compliance'], ['close']])
  await harness.key('Escape')
  assert.deepEqual(harness.events.splice(0), [['close']])
})

test('the displayed Ctrl shortcuts also accept Command and the alternate deletion shortcut', async (t) => {
  const harness = await mount(t)
  for (const [key, modifiers, action] of [
    ['c', { ctrlKey: true }, 'copy-node'],
    ['D', { metaKey: true }, 'duplicate'],
    ['v', { metaKey: true }, 'paste'],
    ['Backspace', { ctrlKey: true }, 'delete'],
    ['Delete', {}, 'delete'],
  ]) {
    assert.equal(await harness.key(key, modifiers), true)
    assert.deepEqual(harness.events.splice(0), [['action', action], ['close']])
  }
})

test('help is available on hover and focus, with keyboard access and no action execution', async (t) => {
  const harness = await mount(t)
  const helper = harness.helper('compliance')
  assert.equal(helper.type, 'button')
  assert.equal(helper.props['aria-expanded'], false)
  helper.props.onMouseenter()
  await settle()
  assert.equal(helper.props['aria-expanded'], true)
  const tooltip = harness.find((entry) => entry.props.role === 'tooltip')[0]
  assert.match(text(tooltip), /Seedance/)
  assert.ok(Number.parseFloat(tooltip.props.style.left) >= 8)
  helper.props.onMouseleave()
  await settle()
  assert.equal(harness.find((entry) => entry.props.role === 'tooltip').length, 0)
  await harness.key('ArrowDown')
  await harness.key('ArrowRight')
  assert.equal(harness.document.activeElement, helper)
  assert.equal(helper.props['aria-expanded'], true)
  helper.props.onMouseleave()
  await settle()
  assert.equal(
    helper.props['aria-expanded'],
    true,
    'keyboard-focused help stays visible after pointer leave',
  )
  await harness.key('Enter')
  assert.deepEqual(harness.events, [])
  await harness.key('ArrowLeft')
  assert.equal(harness.document.activeElement, harness.button('compliance'))
  assert.equal(helper.props['aria-expanded'], false)
})

test('outside pointerdown closes once per event, inside events are retained, and global listeners clean up', async (t) => {
  const harness = await mount(t)
  assert.equal(harness.document.listeners.get('pointerdown').length, 1)
  assert.equal(harness.document.listeners.get('pointerdown')[0].capture, true)
  harness.document.dispatch('pointerdown', { target: harness.star(1), composedPath: () => [] })
  harness.document.dispatch('pointerdown', {
    target: node('outside'),
    composedPath: () => [harness.menu],
  })
  assert.deepEqual(harness.events, [])
  harness.document.dispatch('pointerdown', { target: node('outside'), composedPath: () => [] })
  assert.deepEqual(harness.events, [['close']])
  harness.dispose()
  assert.equal(harness.document.listeners.get('pointerdown').length, 0)
  assert.equal(harness.window.listeners.get('resize').length, 0)
})

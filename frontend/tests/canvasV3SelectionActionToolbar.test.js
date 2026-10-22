import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/SelectionActionToolbar.vue', import.meta.url),
  'utf8',
)
const parsed = parse(source)
assert.deepEqual(parsed.errors, [])
const compiled = compileScript(parsed.descriptor, {
  id: 'selection-actions-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(
    /from (['"])\.\.\/config\/selectionGeometry\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/selectionGeometry.js', import.meta.url).href}'`,
  )
const Toolbar = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default
const all = (node, predicate) => [
  ...(predicate(node) ? [node] : []),
  ...node.children.flatMap((child) => all(child, predicate)),
]
const text = (node) =>
  `${node.type === '#comment' ? '' : node.text}${node.children.map(text).join('')}`

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event)
    },
  }
}
async function mount(overrides = {}) {
  const oldDocument = globalThis.document,
    oldWindow = globalThis.window
  const document = { ...eventTarget(), activeElement: null }
  const window = { ...eventTarget() }
  globalThis.document = document
  globalThis.window = window
  function element(type, content = '') {
    return markRaw({
      type,
      text: content,
      props: {},
      parent: null,
      children: [],
      focus() {
        document.activeElement = this
      },
      contains(target) {
        return this === target || this.children.some((child) => child.contains(target))
      },
      querySelectorAll(selector) {
        return all(
          this,
          (item) =>
            item.props.role === 'menuitem' &&
            (!selector.includes(':not(:disabled)') || !item.props.disabled),
        )
      },
      getBoundingClientRect() {
        const bar = root && all(root, (item) => item.props.role === 'toolbar')[0]
        const left = parseFloat(bar?.props.style?.left) || 0
        const top = parseFloat(bar?.props.style?.top) || 0
        const width = parseFloat(bar?.props.style?.width) || 644
        if (this === bar)
          return { left, top, width, height: 50, right: left + width, bottom: top + 50 }
        const offset = this.props['aria-label'] === '布局' ? 8 : 332
        return {
          left: left + offset,
          top: top + 9,
          width: 30,
          height: 32,
          right: left + offset + 30,
          bottom: top + 41,
        }
      },
    })
  }
  function remove(item) {
    if (!item.parent) return
    const index = item.parent.children.indexOf(item)
    if (index >= 0) item.parent.children.splice(index, 1)
    item.parent = null
  }
  const renderer = createRenderer({
    createElement: (type) => element(type),
    createText: (value) => element('#text', value),
    createComment: (value) => element('#comment', value),
    setText: (item, value) => (item.text = value),
    setElementText: (item, value) => {
      item.text = value
      item.children = []
    },
    patchProp: (item, key, _old, value) => (item.props[key] = value),
    parentNode: (item) => item.parent,
    nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] || null,
    insert(item, parent, anchor) {
      remove(item)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, item)
      item.parent = parent
    },
    remove,
    insertStaticContent(content, parent) {
      const item = element('#static', content)
      parent.children.push(item)
      item.parent = parent
      return [item, item]
    },
  })
  const state = reactive({
    count: 3,
    bounds: { left: 500, right: 900, top: 350, bottom: 700 },
    viewport: { width: 1500, height: 1000 },
    mutable: true,
    canSave: true,
    canDownload: true,
    canChat: true,
    downloading: false,
    ...overrides,
  })
  const events = []
  const app = renderer.createApp({
    setup: () => () =>
      h(Toolbar, {
        ...state,
        ...Object.fromEntries(
          ['arrange', 'save', 'duplicate', 'group', 'ungroup', 'download', 'chat', 'skill'].map(
            (event) => [
              `on${event[0].toUpperCase()}${event.slice(1)}`,
              (...args) => events.push([event, ...args]),
            ],
          ),
        ),
      }),
  })
  const root = element('root')
  const outside = element('button')
  app.mount(root)
  await nextTick()
  return {
    root,
    state,
    events,
    document,
    window,
    outside,
    find: (predicate) => all(root, predicate),
    button: (label) =>
      all(
        root,
        (item) =>
          item.type === 'button' &&
          (item.props['aria-label'] === label || text(item).trim() === label),
      )[0],
    dispose() {
      app.unmount()
      globalThis.document = oldDocument
      globalThis.window = oldWindow
    },
  }
}
const click = (target) => target.props.onClick({ type: 'click', stopPropagation() {} })
const key = (value, extra = {}) => ({
  type: 'keydown',
  key: value,
  prevented: false,
  stopped: false,
  preventDefault() {
    this.prevented = true
  },
  stopPropagation() {
    this.stopped = true
  },
  ...extra,
})

test('observed seven-button toolbar emits explicit intents only, in the observed order', async () => {
  const harness = await mount()
  try {
    const bar = harness.find((item) => item.props.role === 'toolbar')[0]
    assert.equal(bar.props['data-cv3-selection-ui'], '')
    assert.equal(bar.props.style.width, '644px')
    assert.deepEqual(
      harness
        .find((item) => item.type === 'button')
        .map((item) => item.props['aria-label'] || text(item).trim()),
      ['布局', '保存到资产', '创建副本', '打组', '批量下载', '添加到Chat', '创建为Skill'],
    )
    for (const [label, event] of [
      ['保存到资产', 'save'],
      ['创建副本', 'duplicate'],
      ['批量下载', 'download'],
      ['添加到Chat', 'chat'],
      ['创建为Skill', 'skill'],
    ]) {
      click(harness.button(label))
      assert.deepEqual(harness.events.at(-1), [event])
    }
    assert.doesNotMatch(
      source,
      /fetch\(|runVideo\(|runImage\(|useCanvasV3GraphStore|\.duplicateSelected\(|\.groupSelected\(/,
    )
    assert.match(source, /font-size: 13px/)
    assert.match(source, /height: 50px/)
    assert.match(source, /padding: 8px/)
    assert.match(source, /background: #262626/)
    assert.match(source, /border: 1px solid #363636/)
    assert.match(source, /overflow-x: auto/)
    assert.doesNotMatch(source, /scale\(|zoom:/)
  } finally {
    harness.dispose()
  }
})

test('layout opens above with exactly three observed options and dispatches only their keys', async () => {
  const harness = await mount()
  try {
    for (const [label, value] of [
      ['宫格排列', 'grid'],
      ['水平排列', 'horizontal'],
      ['垂直排列', 'vertical'],
    ]) {
      await click(harness.button('布局'))
      await nextTick()
      const menu = harness.find((item) => item.props.role === 'menu')[0]
      assert.equal(menu.props['aria-label'], '布局方式')
      assert.equal(menu.props.style.width, '120px')
      assert.equal(menu.props.style.height, '132px')
      assert.equal(menu.props.style.top, '-138px')
      assert.deepEqual(harness.find((item) => item.props.role === 'menuitem').map(text), [
        '宫格排列',
        '水平排列',
        '垂直排列',
      ])
      click(harness.button(label))
      await nextTick()
      assert.deepEqual(harness.events.at(-1), ['arrange', value])
      assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
      assert.equal(harness.document.activeElement, harness.button('布局'))
    }
  } finally {
    harness.dispose()
  }
})

test('group menu opens below and emits logical normal/storyboard/ungroup intents', async () => {
  const harness = await mount()
  try {
    await click(harness.button('打组'))
    await nextTick()
    let menu = harness.find((item) => item.props.role === 'menu')[0]
    assert.equal(menu.props.style.width, '150px')
    assert.equal(menu.props.style.height, '80px')
    assert.equal(menu.props.style.top, '56px')
    let items = harness.find((item) => item.props.role === 'menuitem')
    assert.deepEqual(items.map(text), ['打组', '合并分镜组'])
    click(items[0])
    assert.deepEqual(harness.events.at(-1), ['group', 'normal'])
    await click(harness.button('打组'))
    await nextTick()
    click(harness.button('合并分镜组'))
    assert.deepEqual(harness.events.at(-1), ['group', 'storyboard'])
    harness.state.group = { id: 'selected-group', name: '分镜组 1', type: 'storyboard' }
    await nextTick()
    await click(harness.button('打组'))
    await nextTick()
    items = harness.find((item) => item.props.role === 'menuitem')
    menu = harness.find((item) => item.props.role === 'menu')[0]
    assert.equal(menu.props.style.height, '115px')
    assert.deepEqual(items.map(text), ['打组', '合并分镜组', '取消分组'])
    click(harness.button('取消分组'))
    assert.deepEqual(harness.events.at(-1), ['ungroup'])
  } finally {
    harness.dispose()
  }
})

test('keyboard menu navigation supports both triggers, wrap, Home/End, Escape and Tab focus return', async () => {
  const harness = await mount()
  try {
    const trigger = harness.button('布局')
    await trigger.props.onKeydown(key('ArrowUp'))
    await nextTick()
    const items = harness.find((item) => item.props.role === 'menuitem')
    const menu = harness.find((item) => item.props.role === 'menu')[0]
    assert.equal(harness.document.activeElement, items[2])
    menu.props.onKeydown(key('ArrowDown'))
    assert.equal(harness.document.activeElement, items[0])
    menu.props.onKeydown(key('End'))
    assert.equal(harness.document.activeElement, items[2])
    menu.props.onKeydown(key('Home'))
    assert.equal(harness.document.activeElement, items[0])
    const escape = key('Escape')
    harness.document.dispatch('keydown', escape)
    await nextTick()
    assert.equal(escape.prevented, true)
    assert.equal(escape.stopped, true)
    assert.equal(harness.document.activeElement, trigger)
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    const group = harness.button('打组')
    await group.props.onKeydown(key('ArrowDown'))
    await nextTick()
    const groupMenu = harness.find((item) => item.props.role === 'menu')[0]
    groupMenu.props.onKeydown(key('Tab'))
    await nextTick()
    assert.equal(harness.document.activeElement, group)
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
  } finally {
    harness.dispose()
  }
})

test('outside clicks, selection movement, viewport resize and horizontal scroll close menus and clean listeners', async () => {
  const harness = await mount()
  try {
    await click(harness.button('布局'))
    harness.document.dispatch('pointerdown', { target: harness.outside })
    await nextTick()
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    for (const move of [
      () => (harness.state.bounds.left += 10),
      () => (harness.state.viewport.width -= 10),
      () => harness.window.dispatch('resize'),
      () =>
        harness
          .find((item) =>
            String(item.props.class || '').includes('cv3-selection-toolbar-scroll'),
          )[0]
          .props.onScroll(),
    ]) {
      await click(harness.button('布局'))
      await nextTick()
      move()
      await nextTick()
      assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    }
  } finally {
    const document = harness.document,
      window = harness.window
    harness.dispose()
    assert.ok([...document.listeners.values()].every((listeners) => !listeners.size))
    assert.ok([...window.listeners.values()].every((listeners) => !listeners.size))
  }
})

test('capability and active-task guards block all disabled intents, including stale handlers', async () => {
  const harness = await mount()
  try {
    await click(harness.button('布局'))
    await nextTick()
    const stale = harness.button('宫格排列')
    harness.state.mutable = false
    harness.state.canSave = false
    harness.state.canDownload = false
    harness.state.canChat = false
    await nextTick()
    click(stale)
    for (const label of ['保存到资产', '创建副本', '批量下载', '添加到Chat', '创建为Skill']) {
      const button = harness.button(label)
      assert.equal(button.props.disabled, true)
      click(button)
    }
    await click(harness.button('打组'))
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    assert.deepEqual(harness.events, [])
    harness.state.mutable = true
    harness.state.canDownload = true
    harness.state.downloading = true
    await nextTick()
    assert.equal(harness.button('批量下载').props.disabled, true)
    click(harness.button('批量下载'))
    assert.deepEqual(harness.events, [])
  } finally {
    harness.dispose()
  }
})

test('narrow viewports clamp fixed-size controls and fewer than two nodes hide the toolbar', async () => {
  const harness = await mount({ viewport: { width: 320, height: 720 } })
  try {
    const bar = harness.find((item) => item.props.role === 'toolbar')[0]
    assert.equal(bar.props.style.width, '304px')
    assert.equal(bar.props.style.left, '8px')
    assert.equal(Object.hasOwn(bar.props.style, 'transform'), false)
    harness.state.count = 1
    await nextTick()
    assert.equal(harness.find((item) => item.props.role === 'toolbar').length, 0)
    assert.deepEqual(harness.events, [])
  } finally {
    harness.dispose()
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/GroupActionToolbar.vue', import.meta.url),
  'utf8',
)
const parsed = parse(source)
assert.deepEqual(parsed.errors, [])
const compiled = compileScript(parsed.descriptor, {
  id: 'group-actions-test',
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
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    dispatch(type, event) {
      for (const listener of listeners.get(type) || []) listener(event)
    },
  }
}
async function mount(overrides = {}) {
  const oldDocument = globalThis.document
  const oldWindow = globalThis.window
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
            String(item.props.role || '').startsWith('menuitem') &&
            (!selector.includes(':not(:disabled)') || !item.props.disabled),
        )
      },
      getBoundingClientRect() {
        const bar = root && all(root, (item) => item.props.role === 'toolbar')[0]
        const left = parseFloat(bar?.props.style?.left) || 0
        const top = parseFloat(bar?.props.style?.top) || 0
        const width = parseFloat(bar?.props.style?.width) || 556
        if (this === bar)
          return { left, top, width, height: 50, right: left + width, bottom: top + 50 }
        const offset = this.props['aria-label'] === '分组颜色' ? 4 : 48
        return {
          left: left + offset,
          top: top + 5,
          width: 40,
          height: 40,
          right: left + offset + 40,
          bottom: top + 45,
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
    bounds: { left: 500, right: 900, top: 350, bottom: 700 },
    viewport: { width: 1500, height: 1000 },
    group: { id: 'group-1', name: 'Group 1', type: 'normal', color: '#b8b8b8' },
    mutable: true,
    canExecute: true,
    canDownload: true,
    executing: false,
    downloading: false,
    ...overrides,
  })
  const events = []
  const app = renderer.createApp({
    setup: () => () =>
      h(Toolbar, {
        ...state,
        ...Object.fromEntries(
          ['color', 'arrange', 'execute', 'toolbox', 'convert', 'ungroup', 'download'].map(
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
const key = (value) => ({
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
})

test('group toolbar matches observed order and emits group-specific intents without services', async () => {
  const harness = await mount()
  try {
    const bar = harness.find((item) => item.props.role === 'toolbar')[0]
    assert.equal(bar.props['aria-label'], '分组操作工具栏')
    assert.equal(bar.props['data-cv3-selection-ui'], '')
    assert.equal(bar.props.style.width, '556px')
    assert.equal(bar.props.style.top, '272px')
    assert.equal(harness.state.bounds.top - (parseFloat(bar.props.style.top) + 50), 28)
    assert.deepEqual(
      harness
        .find((item) => item.type === 'button')
        .map((item) => item.props['aria-label'] || text(item).trim()),
      ['分组颜色', '分组布局', '整组执行', '添加到工具箱', '转分镜组', '解组', '批量下载'],
    )
    for (const [label, event] of [
      ['整组执行', 'execute'],
      ['添加到工具箱', 'toolbox'],
      ['解组', 'ungroup'],
      ['批量下载', 'download'],
    ]) {
      click(harness.button(label))
      assert.deepEqual(harness.events.at(-1), [event])
    }
    click(harness.button('转分镜组'))
    assert.deepEqual(harness.events.at(-1), ['convert', 'storyboard'])
    assert.doesNotMatch(source, /fetch\(|runVideo\(|runImage\(|useCanvasV3GraphStore|localStorage/)
    for (const css of [
      /height: 50px/,
      /padding: 4px/,
      /font-size: 13px/,
      /border-radius: 14px/,
      /border: 0.5px solid #363636/,
      /backdrop-filter: blur\(16px\)/,
      /overflow-x: auto/,
    ])
      assert.match(source, css)
    assert.doesNotMatch(source, /scale\(|zoom:/)
  } finally {
    harness.dispose()
  }
})

test('storyboard conversion has reversible label and emits explicit target kind', async () => {
  const harness = await mount({ group: { id: 'shots', name: '镜头组', type: 'storyboard' } })
  try {
    assert.equal(harness.button('转分镜组'), undefined)
    click(harness.button('转普通组'))
    assert.deepEqual(harness.events, [['convert', 'normal']])
  } finally {
    harness.dispose()
  }
})

test('layout menu exposes exactly observed choices and restores trigger focus', async () => {
  const harness = await mount()
  try {
    for (const [label, value] of [
      ['宫格排列', 'grid'],
      ['水平排列', 'horizontal'],
      ['垂直排列', 'vertical'],
    ]) {
      await click(harness.button('分组布局'))
      await nextTick()
      assert.deepEqual(harness.find((item) => item.props.role === 'menuitem').map(text), [
        '宫格排列',
        '水平排列',
        '垂直排列',
      ])
      click(harness.button(label))
      await nextTick()
      assert.deepEqual(harness.events.at(-1), ['arrange', value])
      assert.equal(harness.document.activeElement, harness.button('分组布局'))
      assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    }
  } finally {
    harness.dispose()
  }
})

test('palette color options are radio intents with active swatch and keyboard escape', async () => {
  const harness = await mount()
  try {
    await click(harness.button('分组颜色'))
    await nextTick()
    const colors = harness.find((item) => item.props.role === 'menuitemradio')
    assert.equal(colors.length, 7)
    assert.equal(harness.button('灰色').props['aria-checked'], true)
    click(harness.button('蓝色'))
    assert.deepEqual(harness.events, [['color', '#8aade8']])
    await harness.button('分组颜色').props.onKeydown(key('ArrowUp'))
    await nextTick()
    const panel = harness.find((item) => item.props.role === 'menu')[0]
    assert.equal(harness.document.activeElement, harness.button('紫色'))
    panel.props.onKeydown(key('ArrowRight'))
    assert.equal(harness.document.activeElement, harness.button('灰色'))
    panel.props.onKeydown(key('End'))
    assert.equal(harness.document.activeElement, harness.button('紫色'))
    const escape = key('Escape')
    harness.document.dispatch('keydown', escape)
    await nextTick()
    assert.equal(escape.prevented, true)
    assert.equal(harness.document.activeElement, harness.button('分组颜色'))
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
  } finally {
    harness.dispose()
  }
})

test('disabled capability, removed group and in-flight guards reject stale handlers', async () => {
  const harness = await mount()
  try {
    await click(harness.button('分组颜色'))
    await nextTick()
    const staleColor = harness.button('红色')
    harness.state.mutable = false
    harness.state.canExecute = false
    harness.state.canDownload = false
    await nextTick()
    click(staleColor)
    for (const label of ['整组执行', '添加到工具箱', '转分镜组', '解组', '批量下载'])
      click(harness.button(label))
    await click(harness.button('分组布局'))
    assert.deepEqual(harness.events, [])
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    harness.state.mutable = true
    harness.state.canExecute = true
    harness.state.canDownload = true
    harness.state.executing = true
    harness.state.downloading = true
    await nextTick()
    await click(harness.button('分组颜色'))
    await harness.button('分组布局').props.onKeydown(key('ArrowDown'))
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    for (const label of ['执行中', '添加到工具箱', '转分镜组', '解组', '批量下载']) {
      assert.equal(harness.button(label).props.disabled, true)
      click(harness.button(label))
    }
    assert.deepEqual(harness.events, [])
    harness.state.group = null
    await nextTick()
    assert.equal(harness.find((item) => item.props.role === 'toolbar').length, 0)
    click(staleColor)
    assert.deepEqual(harness.events, [])
  } finally {
    harness.dispose()
  }
})

test('menus close on outside, focusout, group movement and viewport changes without leaking listeners', async () => {
  const harness = await mount()
  try {
    for (const change of [
      () => harness.document.dispatch('pointerdown', { target: harness.outside }),
      () =>
        harness
          .find((item) => item.props.role === 'toolbar')[0]
          .props.onFocusout({ relatedTarget: harness.outside }),
      () => {
        harness.state.bounds.left += 1
      },
      () => {
        harness.state.viewport.width -= 1
      },
      () => harness.window.dispatch('resize'),
      () =>
        harness.find((item) => item.props.class === 'cv3-group-toolbar-scroll')[0].props.onScroll(),
    ]) {
      await click(harness.button('分组布局'))
      await nextTick()
      change()
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

test('narrow viewports preserve 13px controls and clamp scrollable toolbar', async () => {
  const harness = await mount({ viewport: { width: 320, height: 720 } })
  try {
    const bar = harness.find((item) => item.props.role === 'toolbar')[0]
    assert.equal(bar.props.style.width, '304px')
    assert.equal(bar.props.style.left, '8px')
    assert.equal(Object.hasOwn(bar.props.style, 'transform'), false)
    harness.state.bounds = { left: -500, top: 25, right: -100, bottom: 180 }
    await nextTick()
    assert.equal(bar.props.style.left, '8px')
    assert.equal(bar.props.style.top, '190px')
    harness.state.viewport = { width: 320, height: 180 }
    await nextTick()
    assert.equal(bar.props.style.top, '8px')
    await click(harness.button('分组颜色'))
    await nextTick()
    const menu = harness.find((item) => item.props.role === 'menu')[0]
    const menuLeft = parseFloat(bar.props.style.left) + parseFloat(menu.props.style.left)
    const menuTop = parseFloat(bar.props.style.top) + parseFloat(menu.props.style.top)
    assert.ok(menuLeft >= 8 && menuLeft + parseFloat(menu.props.style.width) <= 312)
    assert.ok(menuTop >= 8 && menuTop + parseFloat(menu.props.style.height) <= 172)
  } finally {
    harness.dispose()
  }
})

test('menu props replace labels, order and colors without adding unsupported layouts or unsafe values', async () => {
  const harness = await mount({
    colors: [
      { label: '自定蓝', value: '#1155AA' },
      { label: '重复', value: '#1155aa' },
      { label: '无效', value: 'var(--secret)' },
      { label: '自定灰', value: '#999999' },
    ],
    layouts: [
      { key: 'vertical', label: '纵向排列' },
      { key: 'unsupported', label: '未知布局' },
      { key: 'vertical', label: '重复纵向' },
      { key: 'grid', label: '网格排列' },
    ],
  })
  try {
    await click(harness.button('分组颜色'))
    await nextTick()
    assert.deepEqual(
      harness
        .find((item) => item.props.role === 'menuitemradio')
        .map((item) => item.props['aria-label']),
      ['自定蓝', '自定灰'],
    )
    const staleColor = harness.button('自定蓝')
    click(staleColor)
    assert.deepEqual(harness.events, [['color', '#1155aa']])
    await click(harness.button('分组布局'))
    await nextTick()
    assert.deepEqual(harness.find((item) => item.props.role === 'menuitem').map(text), [
      '纵向排列',
      '网格排列',
    ])
    const staleLayout = harness.button('纵向排列')
    click(staleLayout)
    assert.deepEqual(harness.events.at(-1), ['arrange', 'vertical'])
    harness.state.colors = []
    harness.state.layouts = []
    await nextTick()
    click(staleColor)
    click(staleLayout)
    await click(harness.button('分组颜色'))
    await click(harness.button('分组布局'))
    assert.equal(harness.find((item) => item.props.role === 'menu').length, 0)
    assert.equal(harness.events.length, 2)
    assert.equal(harness.button('分组颜色').props.disabled, true)
    assert.equal(harness.button('分组布局').props.disabled, true)
  } finally {
    harness.dispose()
  }
})

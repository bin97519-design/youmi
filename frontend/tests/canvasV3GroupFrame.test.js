import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'

const source = await readFile(
  new URL('../src/features/canvas-v3/components/GroupFrame.vue', import.meta.url),
  'utf8',
)
const parsed = parse(source)
assert.deepEqual(parsed.errors, [])
const compiled = compileScript(parsed.descriptor, {
  id: 'group-frame-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const Frame = (
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.content.replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)).toString('base64')}`
  )
).default
const all = (node, predicate) => [
  ...(predicate(node) ? [node] : []),
  ...node.children.flatMap((child) => all(child, predicate)),
]
const text = (node) =>
  `${node.type === '#comment' ? '' : node.text}${node.children.map(text).join('')}`
async function mount(overrides = {}) {
  const previousDocument = globalThis.document
  const previousDocumentType = globalThis.Document
  const previousShadowRoot = globalThis.ShadowRoot
  class TestDocument {}
  const document = Object.assign(new TestDocument(), { activeElement: null })
  globalThis.document = document
  globalThis.Document = TestDocument
  globalThis.ShadowRoot = class TestShadowRoot {}
  function element(type, content = '') {
    return markRaw({
      type,
      text: content,
      props: {},
      parent: null,
      children: [],
      tagName: type.toUpperCase(),
      value: '',
      getRootNode() {
        return document
      },
      focus() {
        document.activeElement = this
      },
      select() {
        this.selectedText = true
      },
      addEventListener() {},
      removeEventListener() {},
      setPointerCapture(id) {
        this.captured = id
      },
      releasePointerCapture(id) {
        this.released = id
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
    group: {
      id: 'group-1',
      name: 'Group 1',
      type: 'normal',
      selected: true,
      bounds: { left: 400, top: 250, width: 400, height: 300 },
      members: [
        { id: 'a', rect: { left: 10, top: 20, right: 110, bottom: 120 } },
        { id: 'b', rect: { x: 60, y: 80, width: 100, height: 100 } },
      ],
    },
    mutable: true,
    hand: false,
    ...overrides,
  })
  const events = []
  const eventNames = [
    'select',
    'rename',
    'move-start',
    'move',
    'move-end',
    'move-cancel',
    'resize-start',
    'resize',
    'resize-end',
    'resize-cancel',
    'connect-start',
    'connect-move',
    'connect-end',
    'connect-cancel',
    'add',
  ]
  const app = renderer.createApp({
    setup: () => () =>
      h(Frame, {
        ...state,
        ...Object.fromEntries(
          eventNames.map((event) => [
            `on${event
              .split('-')
              .map((word) => word[0].toUpperCase() + word.slice(1))
              .join('')}`,
            (...args) => events.push([event, ...args]),
          ]),
        ),
      }),
  })
  const root = element('root')
  app.mount(root)
  await nextTick()
  return {
    state,
    events,
    document,
    find: (predicate) => all(root, predicate),
    frame: () => all(root, (item) => item.props.role === 'group')[0],
    button: (label) =>
      all(root, (item) => item.type === 'button' && item.props['aria-label'] === label)[0],
    path: () =>
      all(root, (item) => item.type === 'path' && item.props['fill-rule'] === 'evenodd')[0],
    dispose() {
      app.unmount()
      globalThis.document = previousDocument
      globalThis.Document = previousDocumentType
      globalThis.ShadowRoot = previousShadowRoot
    },
  }
}
function pointer(target, extra = {}) {
  return {
    button: 0,
    pointerId: 11,
    currentTarget: target,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...extra,
  }
}
function key(value) {
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
  }
}
const click = (target) => target.props.onClick(pointer(target))

test('fixed-screen group frame has group name, four handles, plus and transparent union-subtracted drag area', async () => {
  const harness = await mount()
  try {
    const frame = harness.frame()
    assert.equal(frame.props['aria-label'], '分组 Group 1')
    assert.equal(frame.props['data-cv3-selection-ui'], '')
    assert.deepEqual(frame.props.style, {
      left: '400px',
      top: '250px',
      width: '400px',
      height: '300px',
    })
    assert.equal(
      harness.path().props.d,
      'M0 0H400V300H0ZM10 20H60V120H10ZM60 20H110V180H60ZM110 80H160V180H110Z',
    )
    assert.equal(
      harness.find((item) => String(item.props.class || '').includes('cv3-group-frame-corner'))
        .length,
      4,
    )
    for (const label of [
      '调整分组左上角',
      '调整分组右上角',
      '调整分组右下角',
      '调整分组左下角',
      '从分组创建连接',
    ])
      assert.ok(harness.button(label))
    assert.match(source, /border: 2px solid #3288ff/)
    assert.match(source, /border-radius: 24px/)
    assert.match(source, /font-size: 13px/)
    assert.match(source, /background: none/)
    assert.match(source, /pointer-events: fill/)
    assert.doesNotMatch(source, /fetch\(|localStorage|scale\(/)
  } finally {
    harness.dispose()
  }
})

test('left drag selects before start, captures one pointer, forwards movement/end and ignores wrong pointers', async () => {
  const harness = await mount()
  try {
    const path = harness.path(),
      start = pointer(path)
    path.props.onPointerdown(start)
    assert.deepEqual(
      harness.events.map((entry) => entry[0]),
      ['select', 'move-start'],
    )
    assert.equal(harness.events[0][1].id, 'group-1')
    assert.equal(start.prevented, true)
    assert.equal(path.captured, 11)
    path.props.onPointermove(pointer(path, { pointerId: 12 }))
    assert.equal(harness.events.length, 2)
    const move = pointer(path)
    path.props.onPointermove(move)
    path.props.onPointerup(pointer(path))
    assert.deepEqual(
      harness.events.map((entry) => entry[0]),
      ['select', 'move-start', 'move', 'move-end'],
    )
    assert.equal(path.released, 11)
    path.props.onLostpointercapture(pointer(path))
    assert.equal(harness.events.length, 4)
    path.props.onPointerdown(pointer(path, { button: 2 }))
    assert.equal(harness.events.length, 4)
  } finally {
    harness.dispose()
  }
})

test('all four resize handles emit explicit corners and release/cancel safely', async () => {
  const harness = await mount()
  try {
    for (const [label, corner] of [
      ['左上角', 'nw'],
      ['右上角', 'ne'],
      ['右下角', 'se'],
      ['左下角', 'sw'],
    ]) {
      const handle = harness.button(`调整分组${label}`)
      const start = pointer(handle)
      handle.props.onPointerdown(start)
      assert.deepEqual(harness.events.at(-1), ['resize-start', { event: start, corner }])
      handle.props.onPointermove(pointer(handle))
      assert.equal(harness.events.at(-1)[0], 'resize')
      handle.props.onPointercancel(pointer(handle))
      assert.equal(harness.events.at(-1)[0], 'resize-cancel')
      assert.equal(handle.released, 11)
    }
  } finally {
    harness.dispose()
  }
})

test('double-click rename supports enter, escape, blur and validation without canvas key leakage', async () => {
  const harness = await mount()
  try {
    const open = async () => {
      harness.button('选择分组 Group 1').props.onDblclick(pointer(null))
      await nextTick()
      return harness.find((item) => item.type === 'input')[0]
    }
    let input = await open()
    assert.equal(harness.document.activeElement, input)
    assert.equal(input.selectedText, true)
    input.props['onUpdate:modelValue']('  改名后的组  ')
    const enter = key('Enter')
    input.props.onKeydown(enter)
    await nextTick()
    assert.deepEqual(harness.events.at(-1), ['rename', '改名后的组'])
    assert.equal(enter.prevented, true)
    assert.equal(enter.stopped, true)
    input = await open()
    input.props['onUpdate:modelValue']('应取消的名字')
    input.props.onKeydown(key('Escape'))
    await nextTick()
    assert.equal(harness.events.filter((event) => event[0] === 'rename').length, 1)
    input = await open()
    input.props['onUpdate:modelValue']('')
    input.props.onKeydown(key('Enter'))
    await nextTick()
    assert.equal(
      harness
        .find((item) => item.props.role === 'alert')
        .map(text)
        .join(''),
      '分组名称不能为空',
    )
    input.props['onUpdate:modelValue']('长'.repeat(101))
    input.props.onBlur()
    await nextTick()
    assert.equal(
      harness
        .find((item) => item.props.role === 'alert')
        .map(text)
        .join(''),
      '分组名称最多100个字符',
    )
    input.props['onUpdate:modelValue']('失焦提交')
    input.props.onBlur()
    await nextTick()
    assert.deepEqual(harness.events.at(-1), ['rename', '失焦提交'])
  } finally {
    harness.dispose()
  }
})

test('plus selects first and emits add without move; inactive group shows plus only on hover', async () => {
  const harness = await mount({
    group: {
      id: 'g',
      name: '分镜',
      type: 'storyboard',
      selected: false,
      bounds: { left: 0, top: 0, right: 200, bottom: 100 },
      members: [],
    },
  })
  try {
    assert.equal(harness.frame().props['aria-label'], '分镜组 分镜')
    assert.equal(harness.button('从分组创建连接'), undefined)
    assert.equal(
      harness.find((item) => String(item.props.class || '').includes('cv3-group-frame-corner'))
        .length,
      0,
    )
    harness.frame().props.onPointerenter()
    await nextTick()
    click(harness.button('从分组创建连接'))
    assert.deepEqual(
      harness.events.map((event) => event[0]),
      ['select', 'add'],
    )
    harness.frame().props.onPointerleave()
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), undefined)
  } finally {
    harness.dispose()
  }
})

test('canvas-observed hover keeps the unselected plus visible across media holes and the outside bridge without selecting', async () => {
  const harness = await mount()
  try {
    harness.state.group.selected = false
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), undefined)
    harness.state.pointerInside = true
    await nextTick()
    assert.ok(harness.button('从分组创建连接'))
    assert.deepEqual(harness.events, [])
    // The frame's own pointerleave fires over a media hole or the gap before
    // the plus, but the canvas-level geometric hover must keep it clickable.
    harness.frame().props.onPointerenter()
    harness.frame().props.onPointerleave()
    await nextTick()
    const add = harness.button('从分组创建连接')
    assert.ok(add)
    click(add)
    assert.deepEqual(
      harness.events.map((entry) => entry[0]),
      ['select', 'add'],
    )
    assert.equal(harness.state.group.selected, false)
    harness.state.pointerInside = false
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), undefined)
    harness.state.group.selected = true
    await nextTick()
    assert.ok(harness.button('从分组创建连接'))
  } finally {
    harness.dispose()
  }
})

test('readonly and hand modes still select names but reject stale add, resize and rename actions', async () => {
  const harness = await mount()
  try {
    const path = harness.path(),
      corner = harness.button('调整分组左上角'),
      add = harness.button('从分组创建连接')
    harness.state.mutable = false
    await nextTick()
    path.props.onPointerdown(pointer(path))
    corner.props.onPointerdown(pointer(corner))
    click(add)
    harness.button('选择分组 Group 1').props.onDblclick(pointer(null))
    await nextTick()
    assert.ok(harness.events.every((event) => event[0] === 'select'))
    assert.equal(harness.find((item) => item.type === 'input').length, 0)
    assert.equal(corner.props.disabled, true)
    harness.state.mutable = true
    harness.state.hand = true
    await nextTick()
    path.props.onPointerdown(pointer(path))
    assert.ok(harness.events.every((event) => event[0] === 'select'))
    assert.equal(harness.button('从分组创建连接').props.disabled, true)
  } finally {
    harness.dispose()
  }
})

test('scope/readonly changes and unmount cancel active gesture exactly once and malformed bounds hide frame', async () => {
  const harness = await mount()
  try {
    let path = harness.path()
    path.props.onPointerdown(pointer(path))
    harness.state.group = { ...harness.state.group, id: 'other-group' }
    await nextTick()
    assert.equal(harness.events.at(-1)[0], 'move-cancel')
    assert.equal(path.released, 11)
    path = harness.path()
    path.props.onPointerdown(pointer(path))
    harness.state.mutable = false
    await nextTick()
    assert.equal(harness.events.at(-1)[0], 'move-cancel')
    harness.state.group.bounds = { left: NaN, top: 0, width: 100, height: 100 }
    await nextTick()
    assert.equal(harness.frame(), undefined)
  } finally {
    harness.dispose()
  }
  const unmountHarness = await mount()
  unmountHarness.path().props.onPointerdown(pointer(unmountHarness.path()))
  unmountHarness.dispose()
  assert.equal(unmountHarness.events.at(-1)[0], 'move-cancel')
})

test('left-button plus drag selects once, preserves the captured anchor outside hover and emits connection movement and release', async () => {
  const harness = await mount({ pointerInside: true })
  try {
    harness.state.group.selected = false
    await nextTick()
    const add = harness.button('从分组创建连接')
    const start = pointer(add, { button: 0, buttons: 1, clientX: 820, clientY: 400 })
    add.props.onPointerdown(start)
    assert.deepEqual(
      harness.events.map((event) => event[0]),
      ['select', 'connect-start'],
    )
    assert.equal(start.prevented, true)
    assert.equal(start.stopped, true)
    assert.equal(add.captured, 11)
    assert.equal(harness.document.activeElement, add)
    harness.state.pointerInside = false
    harness.frame().props.onPointerleave()
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), add)
    add.props.onPointermove(pointer(add, { button: -1, buttons: 1, pointerId: 12 }))
    assert.equal(harness.events.length, 2)
    const movement = pointer(add, { button: -1, buttons: 1, clientX: 1000, clientY: 480 })
    add.props.onPointermove(movement)
    assert.deepEqual(harness.events.at(-1), ['connect-move', movement])
    const release = pointer(add, { button: 0, buttons: 0, clientX: 1000, clientY: 480 })
    add.props.onPointerup(release)
    assert.deepEqual(harness.events.at(-1), ['connect-end', release])
    assert.equal(add.released, 11)
    add.props.onLostpointercapture(release)
    assert.equal(harness.events.length, 4)
    click(add)
    assert.equal(harness.events.length, 4)
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), undefined)
  } finally {
    harness.dispose()
  }
})

test('a primary press with at most three pixels of movement retains exactly one click, while a true drag swallows that click', async () => {
  for (const distance of [0, 3, 3.001, 40]) {
    const harness = await mount()
    try {
      const add = harness.button('从分组创建连接')
      add.props.onPointerdown(pointer(add, { button: 0, buttons: 1, clientX: 10, clientY: 20 }))
      // Evaluate release coordinates too: browsers may coalesce the final move.
      add.props.onPointerup(
        pointer(add, { button: 0, buttons: 0, clientX: 10 + distance, clientY: 20 }),
      )
      click(add)
      assert.equal(
        harness.events.filter((event) => event[0] === 'add').length,
        distance <= 3 ? 1 : 0,
        String(distance),
      )
      assert.equal(harness.events.filter((event) => event[0] === 'connect-end').length, 1)
    } finally {
      harness.dispose()
    }
  }
})

test('selecting a previously unselected group preserves its first connector gesture when the group object refreshes', async () => {
  const harness = await mount({ pointerInside: true })
  try {
    harness.state.group = { ...harness.state.group, selected: false }
    await nextTick()
    const add = harness.button('从分组创建连接')
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1, clientX: 10, clientY: 20 }))
    // Shell recomputes presentation objects after selectGroup marks members as
    // selected. Object identity changes, but scope and permissions do not.
    harness.state.group = { ...harness.state.group, selected: true }
    harness.state.pointerInside = false
    await nextTick()
    assert.equal(harness.button('从分组创建连接'), add)
    assert.equal(harness.events.filter((event) => event[0] === 'connect-cancel').length, 0)
    assert.ok(harness.frame().props.class.includes('is-dragging'))
    const movement = pointer(add, { button: -1, buttons: 1, clientX: 30, clientY: 20 })
    add.props.onPointermove(movement)
    assert.deepEqual(harness.events.at(-1), ['connect-move', movement])
    const release = pointer(add, { button: 0, buttons: 0, clientX: 30, clientY: 20 })
    add.props.onPointerup(release)
    assert.deepEqual(harness.events.at(-1), ['connect-end', release])
    assert.equal(add.released, 11)
    click(add)
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 0)
  } finally {
    harness.dispose()
  }
})

test('plus rejects right-button connections and native menus, and retains primary and keyboard clicks after a drag', async () => {
  const harness = await mount()
  try {
    const add = harness.button('从分组创建连接')
    add.props.onPointerdown(pointer(add, { button: 2, buttons: 2 }))
    add.props.onPointerup(pointer(add, { button: 2, buttons: 0 }))
    assert.deepEqual(harness.events, [])
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1, clientX: 10, clientY: 20 }))
    add.props.onKeydown(key(' '))
    add.props.onPointerdown(pointer(add, { button: 2, buttons: 3 }))
    click(add)
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 0)
    const context = pointer(add, { button: 2 })
    add.props.onContextmenu(context)
    assert.equal(context.prevented, true)
    assert.equal(context.stopped, true)
    add.props.onPointerup(pointer(add, { button: 0, buttons: 0, clientX: 40, clientY: 20 }))
    const auxiliary = pointer(add, { button: 2 })
    add.props.onAuxclick(auxiliary)
    assert.equal(auxiliary.prevented, true)
    assert.equal(auxiliary.stopped, true)
    click(add)
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 0)
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1, clientX: 10, clientY: 20 }))
    add.props.onPointerup(pointer(add, { button: 0, buttons: 0, clientX: 10, clientY: 20 }))
    click(add)
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 1)
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    add.props.onPointercancel(pointer(add, { button: 0, buttons: 0 }))
    add.props.onKeydown(key('Enter'))
    click(add)
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 2)
    add.props.onClick(pointer(add, { button: 2 }))
    assert.equal(harness.events.filter((event) => event[0] === 'add').length, 2)
  } finally {
    harness.dispose()
  }
})

test('left-button connection cancels instead of releasing on pointer loss, lost buttons, wrong-button release, scope change, readonly or unmount', async () => {
  for (const cancel of [
    'pointercancel',
    'lostcapture',
    'buttons',
    'wrong-button',
    'scope',
    'readonly',
    'unmount',
  ]) {
    const harness = await mount()
    let disposed = false
    try {
      const add = harness.button('从分组创建连接')
      add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
      if (cancel === 'pointercancel') add.props.onPointercancel(pointer(add, { button: 0 }))
      else if (cancel === 'lostcapture') add.props.onLostpointercapture(pointer(add, { button: 0 }))
      else if (cancel === 'buttons')
        add.props.onPointermove(pointer(add, { button: -1, buttons: 0 }))
      else if (cancel === 'wrong-button')
        add.props.onPointerup(pointer(add, { button: 2, buttons: 0 }))
      else if (cancel === 'scope') harness.state.group = { ...harness.state.group, id: 'next' }
      else if (cancel === 'readonly') harness.state.mutable = false
      else {
        harness.dispose()
        disposed = true
      }
      await nextTick()
      assert.equal(harness.events.at(-1)[0], 'connect-cancel', cancel)
      assert.equal(harness.events.filter((event) => event[0] === 'connect-end').length, 0, cancel)
      assert.equal(harness.events.filter((event) => event[0] === 'add').length, 0, cancel)
      assert.equal(add.released, 11, cancel)
    } finally {
      if (!disposed) harness.dispose()
    }
  }
})

test('readonly and hand groups reject left-button connector drags, while a normal left click still opens add', async () => {
  const harness = await mount()
  try {
    const add = harness.button('从分组创建连接')
    harness.state.mutable = false
    await nextTick()
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    assert.deepEqual(harness.events, [])
    harness.state.mutable = true
    harness.state.hand = true
    await nextTick()
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    assert.deepEqual(harness.events, [])
    harness.state.hand = false
    await nextTick()
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    add.props.onPointerup(pointer(add, { button: 0, buttons: 0 }))
    click(add)
    assert.deepEqual(
      harness.events.map((event) => event[0]),
      ['select', 'connect-start', 'connect-end', 'select', 'add'],
    )
  } finally {
    harness.dispose()
  }
})

test('Escape and external controller reset cancel connector capture without ending or cancelling unrelated movement', async () => {
  const harness = await mount()
  try {
    const add = harness.button('从分组创建连接')
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    const escape = key('Escape')
    add.props.onKeydown(escape)
    assert.equal(escape.prevented, true)
    assert.equal(escape.stopped, true)
    assert.equal(harness.events.at(-1)[0], 'connect-cancel')
    assert.equal(add.released, 11)
    add.props.onPointerdown(pointer(add, { button: 0, buttons: 1 }))
    harness.state.connectionResetKey = 1
    await nextTick()
    assert.equal(harness.events.filter((event) => event[0] === 'connect-cancel').length, 2)
    assert.equal(harness.events.filter((event) => event[0] === 'connect-end').length, 0)
    const path = harness.path()
    path.props.onPointerdown(pointer(path))
    harness.state.connectionResetKey = 2
    await nextTick()
    assert.equal(harness.events.at(-1)[0], 'move-start')
    path.props.onPointerup(pointer(path))
    assert.equal(harness.events.at(-1)[0], 'move-end')
  } finally {
    harness.dispose()
  }
})

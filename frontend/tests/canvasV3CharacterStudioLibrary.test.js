import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import {
  CHARACTER_LIBRARY_FILTERS,
  characterLibraryItems,
  characterLibrarySelection,
  filterCharacterLibrary,
} from '../src/features/canvas-v3/config/characterStudioLibrary.js'
import { CHARACTER_STUDIO_TEMPLATES } from '../src/features/canvas-v3/config/characterStudioCatalog.js'

const items = [
  {
    id: 'a',
    name: '温暖妈妈',
    description: '家居场景',
    gender: '女',
    ageGroup: '青年',
    culture: '东亚',
    coverUrl: '/a.png',
  },
  {
    id: 'b',
    name: '长者',
    description: '实木工匠',
    gender: '男',
    ageGroup: '老年',
    culture: '东亚',
    imageUrl: '/b.png',
  },
  {
    id: 'c',
    name: '角色 C',
    description: 'Studio',
    gender: '中性',
    ageGroup: '青年',
    culture: '欧美',
    imageUrl: '/c.png',
  },
]

test('character filters exactly match observed multi-selection categories', () => {
  assert.deepEqual(
    CHARACTER_LIBRARY_FILTERS.map(({ options }) => [...options]),
    [
      ['男', '女', '中性'],
      ['儿童', '少年', '青年', '中年', '老年'],
      ['东亚', '欧美', '中东', '非洲', '其他'],
    ],
  )
})
test('normalization accepts parent catalog only, deduplicates identity, and never invents a catalog', () => {
  assert.deepEqual(characterLibraryItems(), [])
  assert.deepEqual(characterLibraryItems(null), [])
  const result = characterLibraryItems([null, {}, ...items, items[0]])
  assert.equal(result.length, 3)
  assert.equal(result[0].imageUrl, '/a.png')
  assert.equal(items[0].imageUrl, undefined)
})
test('filters OR choices within a category and AND between categories', () => {
  assert.deepEqual(
    filterCharacterLibrary(items, { gender: ['女', '男'], culture: ['东亚'] }).map(({ id }) => id),
    ['a', 'b'],
  )
  assert.deepEqual(
    filterCharacterLibrary(items, { gender: ['女', '男'], ageGroup: ['青年'] }).map(({ id }) => id),
    ['a'],
  )
  assert.deepEqual(filterCharacterLibrary(items, { ageGroup: ['儿童'] }), [])
})

test('the Other culture filter includes legacy fantasy records without rewriting saved metadata', () => {
  const records = [
    { ...items[0], id: 'other', culture: '其他' },
    { ...items[1], id: 'legacy', culture: '奇幻' },
    { ...items[2], id: 'mixed', culture: ['东亚', '奇幻'] },
    { ...items[0], id: 'east', culture: '东亚' },
  ]
  const before = JSON.stringify(records)
  assert.deepEqual(
    filterCharacterLibrary(records, { culture: ['其他'] }).map((item) => item.id),
    ['other', 'legacy', 'mixed'],
  )
  assert.deepEqual(
    filterCharacterLibrary(records, { culture: ['其他', '东亚'] }).map((item) => item.id),
    ['other', 'legacy', 'mixed', 'east'],
  )
  assert.deepEqual(
    filterCharacterLibrary(records, { culture: ['其他'], gender: ['女'] }).map((item) => item.id),
    ['other'],
  )
  assert.equal(JSON.stringify(records), before)
  assert.equal(records[1].culture, '奇幻')
  assert.deepEqual(records[2].culture, ['东亚', '奇幻'])
})
test('search matches actual names or descriptions, is case insensitive, and combines filters', () => {
  assert.deepEqual(
    filterCharacterLibrary(items, {}, 'studio').map(({ id }) => id),
    ['c'],
  )
  assert.deepEqual(
    filterCharacterLibrary(items, {}, '实木').map(({ id }) => id),
    ['b'],
  )
  assert.deepEqual(filterCharacterLibrary(items, { culture: ['东亚'] }, 'studio'), [])
})
test('selection only returns current provided items, not injected or stale identities', () => {
  assert.deepEqual(
    characterLibrarySelection(items.slice(0, 1), ['a', 'b', 'injected']).map(({ id }) => id),
    ['a'],
  )
  assert.deepEqual(characterLibrarySelection(items, null), [])
})
test('library emits to parent and does not call generation or deletion APIs itself', async () => {
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/CharacterStudioLibrary.vue', import.meta.url),
    'utf8',
  )
  assert.match(
    source,
    /defineEmits\(\[[\s\S]*'create',[\s\S]*'open',[\s\S]*'inspect',[\s\S]*'insert',[\s\S]*'remove',[\s\S]*'rename',[\s\S]*'reload',[\s\S]*'age-variant'/,
  )
  assert.match(source, /@input="setActive\(\$event\.target\.value, \{ immediate: true \}\)"/)
  assert.match(source, /prefers-reduced-motion/)
  assert.equal((source.match(/:src="characterStudioPortraitPreview\(item\)"/g) || []).length, 2)
  assert.doesNotMatch(source, /:src="item\.previewUrl/)
  assert.doesNotMatch(source, /fetch\(|setTimeout\(|axios|\/api\//)
})

test('filter popovers follow the compact dark reference while native multi-select checkboxes remain accessible', async () => {
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/CharacterStudioLibrary.vue', import.meta.url),
    'utf8',
  )
  const { descriptor } = parse(source)
  const css = descriptor.styles.map((style) => style.content).join('\n')
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const result = css.match(new RegExp(`${escaped}(?:\\s*,[^{}]*)?\\s*\\{([^}]+)\\}`))?.[1]
    assert.ok(result, `expected CSS rule ${selector}`)
    return result
  }
  const menu = block('.cv3-character-filter-menu')
  const row = block('.cv3-character-filter-menu label')
  const hover = block('.cv3-character-filter-menu label:hover')
  const checkbox = block('.cv3-character-filter-checkbox')
  assert.match(menu, /(?:^|[;\n])\s*(?:min-)?width:\s*180px/)
  assert.match(menu, /border-radius:\s*16px/)
  assert.match(menu, /background:\s*#242424/i)
  assert.match(row, /(?:min-)?height:\s*36px/)
  assert.match(`${row}\n${hover}`, /border-radius:\s*10px/)
  assert.match(hover, /background(?:-color)?:\s*#343434/i)
  assert.match(checkbox, /position:\s*absolute/)
  assert.match(checkbox, /opacity:\s*0|clip(?:-path)?:/)
  assert.doesNotMatch(checkbox, /display:\s*none|visibility:\s*hidden/)
  assert.match(descriptor.template.content, /<label[\s\S]*?<input[\s\S]*?type="checkbox"/)
  assert.match(descriptor.template.content, /@change="toggleFilter\(filter.key, option\)"/)
  assert.doesNotMatch(descriptor.template.content, /清除选择|cv3-character-filter-clear/)
  assert.match(css, /focus-visible|focus-within/)
})

test('filter capsules match the observed empty and selected geometry without numeric badges', async () => {
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/CharacterStudioLibrary.vue', import.meta.url),
    'utf8',
  )
  const { descriptor } = parse(source)
  const css = descriptor.styles.map((style) => style.content).join('\n')
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const result = css.match(new RegExp(`${escaped}(?:\\s*,[^{}]*)?\\s*\\{([^}]+)\\}`))?.[1]
    assert.ok(result, `expected CSS rule ${selector}`)
    return result
  }
  const pill = block('.cv3-character-filter-pill')
  const selected = block('.cv3-character-filter-pill.has-value')
  const trigger = block('.cv3-character-library .cv3-character-filter-trigger')
  const clear = block('.cv3-character-library .cv3-character-filter-pill-clear')
  const divider = block('.cv3-character-filter-divider')
  const values = block('.cv3-character-filter-values')
  const search = block('.cv3-character-library .cv3-character-search-toggle')
  const expandedSearch = block('.cv3-character-library-search')
  const searchFocus = block('.cv3-character-library-search:focus-within')
  const searchField = block('.cv3-character-library-search input')
  const searchClear = block('.cv3-character-library .cv3-character-search-clear')
  assert.match(pill, /height:\s*32px/)
  assert.match(pill, /border-radius:\s*9999px/)
  assert.match(pill, /background:\s*#ffffff0f/i)
  assert.match(selected, /background:\s*#fff(?:fff)?\s*;/i)
  assert.match(selected, /color:\s*#000(?:000)?\s*;/i)
  assert.match(selected, /padding-left:\s*10px/)
  assert.match(selected, /gap:\s*4px/)
  assert.match(trigger, /height:\s*32px/)
  assert.match(trigger, /font-size:\s*13px/)
  assert.match(trigger, /gap:\s*4px/)
  assert.match(trigger, /padding:\s*0 10px 0 14px/)
  assert.match(clear, /width:\s*16px/)
  assert.match(clear, /height:\s*16px/)
  assert.match(divider, /width:\s*1px/)
  assert.match(divider, /height:\s*8px/)
  assert.match(divider, /background:\s*#00000026/i)
  assert.match(values, /max-width:\s*100px/)
  assert.match(values, /text-overflow:\s*ellipsis/)
  assert.match(values, /overflow:\s*hidden/)
  assert.match(search, /width:\s*32px/)
  assert.match(search, /height:\s*32px/)
  assert.match(search, /border-radius:\s*9999px/)
  assert.match(search, /background:\s*#ffffff0f/i)
  assert.match(search, /color:\s*#c3c3c3/i)
  assert.match(expandedSearch, /width:\s*200px/)
  assert.match(expandedSearch, /height:\s*32px/)
  assert.match(expandedSearch, /background:\s*#ffffff0f/i)
  assert.match(expandedSearch, /border:\s*0/)
  assert.match(expandedSearch, /border-radius:\s*9999px/)
  assert.match(searchFocus, /box-shadow:\s*inset 0 0 0 1px #777/i)
  assert.match(searchField, /font-size:\s*13px/)
  assert.match(searchClear, /width:\s*18px/)
  assert.match(searchClear, /height:\s*22px/)
  assert.doesNotMatch(
    descriptor.template.content,
    /<span[^>]*v-if="filters\[filter.key\]\.length"[^>]*>\s*\{\{\s*filters\[filter.key\]\.length\s*\}\}/,
  )
})

const componentPromise = readFile(
  new URL('../src/features/canvas-v3/components/CharacterStudioLibrary.vue', import.meta.url),
  'utf8',
).then(async (source) => {
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, {
    id: 'character-library-test',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } },
  })
  const moduleSource = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /from (["'])\.\.\/config\/characterStudioLibrary\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/characterStudioLibrary.js', import.meta.url).href}'`,
    )
    .replace(
      /from (["'])\.\.\/config\/characterStudioCarousel(?:\.js)?\1/g,
      `from '${new URL('../src/features/canvas-v3/config/characterStudioCarousel.js', import.meta.url).href}'`,
    )
    .replace(
      /from (["'])\.\.\/config\/characterStudioCatalog(?:\.js)?\1/g,
      `from '${new URL('../src/features/canvas-v3/config/characterStudioCatalog.js', import.meta.url).href}'`,
    )
    .replace(/from (["'])\.\.\/config\/([^"']+)\1/g, (_match, _quote, filename) => {
      const path = filename.endsWith('.js') ? filename : `${filename}.js`
      return `from '${new URL(`../src/features/canvas-v3/config/${path}`, import.meta.url).href}'`
    })
    .replace(
      /import PersonalAssetLibrary from ['"]\.\/PersonalAssetLibrary\.vue['"]/,
      `import { h as __personalLibraryTestH } from '${import.meta.resolve('vue')}'
let __personalPaneInstances = 0
const PersonalAssetLibrary = {
  props: { kind: String },
  emits: ['busy-change'],
  inheritAttrs: false,
  setup: (props, context) => {
    const instance = ++__personalPaneInstances
    return () => __personalLibraryTestH('section', {
      'data-test-personal-library': props.kind,
      'data-test-child-attrs': Object.keys(context.attrs).join(','),
      'data-test-instance': instance,
      onTestBusyChange: (value) => context.emit('busy-change', value),
    }, props.kind === 'product' ? '独立商品子面板' : '独立场景子面板')
  },
}`,
    )
    .replace(
      /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
      `import { h as __canvasIconTestH } from '${import.meta.resolve('vue')}'
const CanvasIcon = {
  props: { name: String },
  inheritAttrs: false,
  setup: (props, context) => () => __canvasIconTestH('i', { 'data-test-canvas-icon': props.name, ...context.attrs }),
}`,
    )
    .replace(
      /import CharacterStudioWireframe from ['"]\.\/CharacterStudioWireframe\.vue['"]/,
      `import { h as __wireframeTestH } from '${import.meta.resolve('vue')}'
const CharacterStudioWireframe = {
  inheritAttrs: false,
  setup: (_, context) => () => __wireframeTestH('div', { 'data-test-character-wireframe': true, ...context.attrs }),
}`,
    )
  return (
    await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
  ).default
})
function node(type, text = '') {
  const listeners = new Map()
  const capturedPointers = new Set()
  return {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    tagName: type.toUpperCase(),
    value: '',
    clientWidth: 980,
    clientHeight: 430,
    capturedPointers,
    get parentElement() {
      return this.parent
    },
    querySelector(selector) {
      return selector.startsWith('#')
        ? findAll(this, (item) => item.props.id === selector.slice(1))[0] || null
        : null
    },
    captureCalls: [],
    setPointerCapture(pointerId) {
      capturedPointers.add(pointerId)
      this.captureCalls.push({ action: 'capture', pointerId })
    },
    releasePointerCapture(pointerId) {
      capturedPointers.delete(pointerId)
      this.captureCalls.push({ action: 'release', pointerId })
    },
    hasPointerCapture(pointerId) {
      return capturedPointers.has(pointerId)
    },
    getBoundingClientRect() {
      return (
        this.rect || {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 980,
          bottom: 430,
          width: 980,
          height: 430,
        }
      )
    },
    getAttribute(name) {
      return this.props[name] ?? null
    },
    setAttribute(name, value) {
      this.props[name] = value
    },
    removeAttribute(name) {
      delete this.props[name]
    },
    matches(selector) {
      return selector.split(',').some((part) => {
        const value = part.trim()
        if (value.startsWith('.'))
          return String(this.props.class || '')
            .split(/\s+/)
            .includes(value.slice(1))
        if (value.startsWith('[') && value.endsWith(']'))
          return Object.hasOwn(this.props, value.slice(1, -1))
        return this.type === value
      })
    },
    closest(selector) {
      for (let current = this; current; current = current.parent)
        if (current.matches(selector)) return current
      return null
    },
    contains(target) {
      for (let current = target; current; current = current.parent)
        if (current === this) return true
      return false
    },
    addEventListener(name, callback) {
      listeners.set(name, callback)
    },
    removeEventListener(name) {
      listeners.delete(name)
    },
    dispatchEvent(event) {
      listeners.get(event.type)?.({ ...event, target: this })
    },
    getRootNode: () => ({}),
    focus() {
      this.focused = true
    },
  }
}
function detach(child) {
  if (!child.parent) return
  const children = child.parent.children
  const index = children.indexOf(child)
  if (index >= 0) children.splice(index, 1)
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
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (child, parent, anchor = null) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach,
  insertStaticContent: (content, parent, anchor) => {
    const child = node('#static', content.replace(/<[^>]*>/g, ''))
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
    return [child, child]
  },
})
function findAll(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => findAll(child, predicate)),
  ]
}
function textContent(target) {
  return `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
}
function browserClock({ reducedMotion = false } = {}) {
  let time = 1000
  let frameNumber = 0
  const frames = new Map()
  const listeners = new Set()
  const cancelled = []
  const styleValues = { '--character-step': '245px' }
  const media = {
    matches: reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_event, listener) => listeners.add(listener),
    removeEventListener: (_event, listener) => listeners.delete(listener),
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
  }
  const platform = {
    requestAnimationFrame(callback) {
      const id = ++frameNumber
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      cancelled.push(id)
      frames.delete(id)
    },
    matchMedia: () => media,
    performance: { now: () => time },
    getComputedStyle: () => ({ getPropertyValue: (name) => styleValues[name] || '' }),
  }
  return {
    frames,
    cancelled,
    styleValues,
    listeners,
    media,
    platform,
    get now() {
      return time
    },
    advance(ms) {
      time += ms
    },
    frame(ms = 16) {
      time += ms
      const current = [...frames.values()]
      frames.clear()
      for (const callback of current) callback(time)
    },
    settle(limit = 240) {
      for (let index = 0; frames.size && index < limit; index += 1) this.frame()
      assert.equal(frames.size, 0, 'carousel animation must settle instead of looping indefinitely')
    },
    setReducedMotion(value) {
      media.matches = value
      for (const listener of listeners) listener({ matches: value, media: media.media })
    },
    install() {
      const bindings = { window: platform, Document: class {}, ShadowRoot: class {}, ...platform }
      const previous = Object.fromEntries(
        Object.keys(bindings).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
      )
      for (const [key, value] of Object.entries(bindings))
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
      return () => {
        for (const key of Object.keys(bindings)) {
          if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
          else delete globalThis[key]
        }
      }
    },
  }
}
function wheelEvent(clock, overrides = {}) {
  const result = {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    timeStamp: clock.now,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...overrides,
  }
  return result
}
function _pointerEvent(clock, target, overrides = {}) {
  return {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: 490,
    clientY: 215,
    timeStamp: clock.now,
    target,
    currentTarget: target,
    defaultPrevented: false,
    stopped: false,
    immediateStopped: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    stopImmediatePropagation() {
      this.immediateStopped = true
      this.stopped = true
    },
    ...overrides,
  }
}
function _dispatchClick(target, event, kind = 'Click') {
  const path = []
  for (let current = target; current; current = current.parent) path.push(current)
  event.target = target
  for (const current of [...path].reverse()) {
    event.currentTarget = current
    current.props[`on${kind}Capture`]?.(event)
    if (event.stopped) return
  }
  for (const current of path) {
    event.currentTarget = current
    current.props[`on${kind}`]?.(event)
    if (event.stopped) return
  }
}
async function mountLibrary(initial = {}, options = {}) {
  const Component = await componentPromise
  const clock = options.clock || browserClock(options)
  const restorePlatform = clock.install()
  const state = reactive({ myItems: items, officialItems: [], ...initial })
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Component, {
        ...state,
        onCreate: (method) => events.push(['create', method]),
        onOpen: (item) => events.push(['open', item]),
        onInspect: (item) => events.push(['inspect', item]),
        onInsert: (selected) => events.push(['insert', selected]),
        onRemove: (selected) => events.push(['remove', selected]),
        onAgeVariant: (item) => events.push(['age-variant', item]),
        onLibraryBusy: (value) => events.push(['library-busy', value]),
      }),
  })
  app.mount(root)
  const originalUnmount = app.unmount
  app.unmount = () => {
    originalUnmount()
    restorePlatform()
  }
  const button = (label) =>
    findAll(
      root,
      (target) =>
        target.type === 'button' &&
        (target.props['aria-label'] === label || textContent(target).trim() === label),
    )[0]
  return { state, root, events, app, button, clock }
}
function withClass(root, name) {
  return findAll(
    root,
    (entry) =>
      typeof entry.props.class === 'string' && entry.props.class.split(/\s+/).includes(name),
  )
}
function slider(root) {
  return findAll(root, (entry) => entry.type === 'input' && entry.props.type === 'range')[0]
}
function libraryTab(harness, label) {
  return findAll(
    harness.root,
    (item) => item.props.role === 'tab' && textContent(item).trim() === label,
  )[0]
}
async function selectLibraryTab(harness, label) {
  const tab = libraryTab(harness, label)
  assert.ok(tab, `expected library tab ${label}`)
  tab.props.onClick()
  await nextTick()
  await nextTick()
}
function personalPane(root) {
  return findAll(root, (item) => Boolean(item.props['data-test-personal-library']))
}
function filterTrigger(harness, key) {
  return findAll(
    harness.root,
    (item) =>
      item.type === 'button' && item.props['aria-controls'] === `cv3-character-filter-${key}`,
  )[0]
}
function filterPill(harness, key) {
  return filterTrigger(harness, key).closest('.cv3-character-filter-pill')
}
function modelSearch(harness) {
  return findAll(harness.root, (item) => item.type === 'input' && item.props.type === 'search')[0]
}
async function chooseFilterOptions(harness, key, values) {
  const trigger = filterTrigger(harness, key)
  assert.ok(trigger, `expected ${key} trigger`)
  if (!trigger.props['aria-expanded']) trigger.props.onClick()
  await nextTick()
  for (const value of values) {
    const group = findAll(
      harness.root,
      (item) => item.props.id === `cv3-character-filter-${key}`,
    )[0]
    const label = findAll(
      group,
      (item) => item.type === 'label' && textContent(item).trim() === value,
    )[0]
    assert.ok(label, `expected ${key} choice ${value}`)
    findAll(
      label,
      (item) => item.type === 'input' && item.props.type === 'checkbox',
    )[0].props.onChange()
    await nextTick()
  }
}
function portraitOffset(root, name) {
  const card = withClass(root, 'cv3-character-carousel-card').find(
    (entry) =>
      findAll(
        entry,
        (child) => child.props['aria-label'] === (name === '创建新模特' ? name : `查看${name}`),
      ).length,
  )
  assert.ok(card, `expected visible portrait ${name}`)
  return Number(card.props.style['--character-offset'])
}
async function wheel(harness, deltaY, overrides = {}, elapsed = 0) {
  harness.clock.advance(elapsed)
  const event = wheelEvent(harness.clock, { deltaY, ...overrides })
  const stage = withClass(harness.root, 'cv3-character-carousel-stage')[0]
  assert.ok(stage?.props.onWheel, 'wheel navigation must be bound to the portrait stage')
  stage.props.onWheel(event)
  await nextTick()
  return event
}
async function pointer(harness, handler, overrides = {}, elapsed = 0) {
  harness.clock.advance(elapsed)
  const stage = withClass(harness.root, 'cv3-character-carousel-stage')[0]
  assert.ok(stage?.props[handler], `expected portrait-stage ${handler} handler`)
  const event = _pointerEvent(harness.clock, stage, overrides)
  stage.props[handler](event)
  await nextTick()
  return { event, stage }
}
function lookStyle(root, name) {
  const portrait = findAll(
    root,
    (entry) =>
      entry.type === 'button' &&
      entry.props['aria-label'] === (name === '创建新模特' ? name : `查看${name}`),
  )[0]
  assert.ok(portrait, `expected portrait ${name}`)
  return withClass(portrait, 'cv3-character-portrait-content')[0].props.style
}
const wheelItems = [
  ...items,
  { id: 'd', name: '角色 D', gender: '男', ageGroup: '青年', culture: '东亚', imageUrl: '/d.png' },
  { id: 'e', name: '角色 E', gender: '女', ageGroup: '中年', culture: '欧美', imageUrl: '/e.png' },
  { id: 'f', name: '角色 F', gender: '男', ageGroup: '青年', culture: '非洲', imageUrl: '/f.png' },
]

test('carousel keyboard, scrubber, details, insert, and age variation route the active catalog item', async () => {
  const { root, events, app, button } = await mountLibrary()
  button('下一个模特').props.onClick()
  await nextTick()
  button('添加到画布').props.onClick()
  assert.deepEqual(
    events[0][1].map(({ id }) => id),
    ['b'],
  )
  const slider = findAll(
    root,
    (target) => target.type === 'input' && target.props.type === 'range',
  )[0]
  slider.props.onInput({ target: { value: '3' } })
  await nextTick()
  button('生成其他年龄版本').props.onClick()
  assert.equal(events[1][1].id, 'c')
  const carousel = findAll(
    root,
    (target) => target.props['aria-label'] === '模特列表，使用左右方向键浏览',
  )[0]
  carousel.props.onKeydown({ key: 'Home', preventDefault() {} })
  await nextTick()
  assert.equal(slider.props.value, 0)
  assert.match(slider.props['aria-valuetext'], /创建新模特/)
  carousel.props.onKeydown({ key: 'ArrowRight', preventDefault() {} })
  await nextTick()
  button('编辑模特').props.onClick()
  assert.equal(events[2][1].id, 'a')
  app.unmount()
})
test('multi-selection emits current selections only, resets on filters, and never removes official items', async () => {
  const { root, events, app, button } = await mountLibrary({ officialItems: [items[2]] })
  button('多选').props.onClick()
  await nextTick()
  button('选择温暖妈妈').props.onClick()
  button('选择长者').props.onClick()
  await nextTick()
  button('删除模特').props.onClick()
  assert.deepEqual(
    events[0][1].map(({ id }) => id),
    ['a', 'b'],
  )
  button('性别筛选').props.onClick()
  await nextTick()
  const male = findAll(
    root,
    (target) => target.type === 'label' && textContent(target).trim() === '男',
  )[0]
  findAll(male, (target) => target.type === 'input')[0].props.onChange()
  await nextTick()
  assert.match(textContent(root), /已选 0 个模特/)
  assert.equal(button('删除模特').props.disabled, true)
  assert.equal(filterTrigger({ root }, 'gender').props['aria-expanded'], true)
  findAll(
    root,
    (target) => target.props.role === 'tab' && textContent(target).trim() === '官方模特库',
  )[0].props.onClick()
  await nextTick()
  assert.equal(button('删除模特').props.disabled, true)
  app.unmount()
})

test('visually hidden native filter checkboxes retain labeled keyboard access, OR multi-selection and clearing', async () => {
  const h = await mountLibrary()
  const trigger = h.button('性别筛选')
  assert.equal(trigger.props['aria-expanded'], false)
  trigger.props.onClick()
  await nextTick()
  const group = findAll(
    h.root,
    (item) => item.props.role === 'group' && item.props['aria-label'] === '性别选项',
  )[0]
  assert.ok(group)
  assert.equal(trigger.props['aria-controls'], group.props.id)
  const option = (label) =>
    findAll(h.root, (item) => item.type === 'label' && textContent(item).trim() === label)[0]
  const checkbox = (label) => findAll(option(label), (item) => item.type === 'input')[0]
  for (const label of ['男', '女', '中性']) {
    assert.ok(option(label))
    assert.equal(checkbox(label).props.type, 'checkbox')
    assert.ok(String(checkbox(label).props.class).includes('cv3-character-filter-checkbox'))
    assert.notEqual(checkbox(label).props.tabindex, -1)
    assert.notEqual(checkbox(label).props.hidden, true)
    assert.notEqual(checkbox(label).props['aria-hidden'], true)
    assert.notEqual(checkbox(label).props.disabled, true)
    assert.equal(typeof checkbox(label).props.onChange, 'function')
  }
  // Browser-native Space activation produces this same checkbox change event.
  checkbox('女').props.onChange()
  await nextTick()
  checkbox('男').props.onChange()
  await nextTick()
  assert.equal(checkbox('女').props.checked, true)
  assert.equal(checkbox('男').props.checked, true)
  assert.equal(checkbox('中性').props.checked, false)
  assert.ok(String(option('女').props.class).includes('is-selected'))
  assert.ok(String(option('男').props.class).includes('is-selected'))
  assert.ok(!String(option('中性').props.class).includes('is-selected'))
  assert.equal(trigger.props['aria-expanded'], true)
  assert.deepEqual(
    findAll(h.root, (item) => item.type === 'img').map((item) => item.props.src),
    ['/a.png', '/b.png'],
  )
  checkbox('男').props.onChange()
  await nextTick()
  assert.equal(checkbox('男').props.checked, false)
  assert.deepEqual(
    findAll(h.root, (item) => item.type === 'img').map((item) => item.props.src),
    ['/a.png'],
  )
  assert.equal(h.button('清除选择'), undefined)
  assert.equal(findAll(group, (item) => item.type === 'button').length, 0)
  h.button('清除性别筛选').props.onClick({ stopPropagation() {} })
  await nextTick()
  assert.equal(filterTrigger(h, 'gender').props['aria-expanded'], false)
  filterTrigger(h, 'gender').props.onClick()
  await nextTick()
  assert.ok(['男', '女', '中性'].every((label) => checkbox(label).props.checked === false))
  assert.equal(findAll(h.root, (item) => item.type === 'img').length, 3)
  let stopped = false
  const library = findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0]
  library.props.onKeydown({
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {
      stopped = true
    },
  })
  await nextTick()
  assert.equal(stopped, true)
  assert.equal(trigger.props['aria-expanded'], false)
  assert.equal(withClass(h.root, 'cv3-character-filter-menu').length, 0)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('the culture popover offers Other instead of Fantasy and selects both modern and legacy records', async () => {
  const records = [
    { ...items[0], id: 'legacy-culture', culture: '奇幻' },
    { ...items[1], id: 'other-culture', culture: '其他' },
    { ...items[2], id: 'east-culture', culture: '东亚' },
  ]
  const before = JSON.stringify(records)
  const h = await mountLibrary({ myItems: records })
  h.button('文化区域筛选').props.onClick()
  await nextTick()
  const group = findAll(
    h.root,
    (item) => item.props.role === 'group' && item.props['aria-label'] === '文化区域选项',
  )[0]
  assert.ok(group)
  assert.equal(h.button('文化区域筛选').props['aria-controls'], group.props.id)
  const options = findAll(group, (item) => item.type === 'label')
  assert.deepEqual(options.map(textContent), ['东亚', '欧美', '中东', '非洲', '其他'])
  const other = options.find((item) => textContent(item).trim() === '其他')
  findAll(other, (item) => item.type === 'input')[0].props.onChange()
  await nextTick()
  assert.deepEqual(
    findAll(h.root, (item) => item.type === 'img').map((item) => item.props.src),
    ['/a.png', '/b.png'],
  )
  assert.equal(filterTrigger(h, 'culture').props['aria-expanded'], true)
  assert.equal(JSON.stringify(records), before)
  assert.equal(records[0].culture, '奇幻')
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('empty and singly selected filter pills use category labels, accessible summaries and separate clear buttons', async () => {
  for (const [key, label, value] of [
    ['gender', '性别', '女'],
    ['ageGroup', '年龄段', '青年'],
    ['culture', '文化区域', '欧美'],
  ]) {
    const h = await mountLibrary()
    const empty = filterTrigger(h, key)
    assert.ok(String(h.button('搜索模特').props.class).includes('cv3-character-search-toggle'))
    assert.equal(empty.props['aria-label'], `${label}筛选`)
    assert.equal(textContent(empty).trim(), label)
    assert.equal(
      findAll(empty, (item) => item.props['data-test-canvas-icon'] === 'chevron').length,
      1,
    )
    assert.equal(
      findAll(empty, (item) => item.props['data-test-canvas-icon'] === 'chevron')[0].props.size,
      12,
    )
    assert.equal(h.button(`清除${label}筛选`), undefined)
    assert.ok(!String(filterPill(h, key).props.class).includes('has-value'))
    await chooseFilterOptions(h, key, [value])
    const selected = filterTrigger(h, key)
    const pill = filterPill(h, key)
    const clear = h.button(`清除${label}筛选`)
    assert.equal(selected.props['aria-label'], `${label}筛选，已选：${value}`)
    assert.equal(h.button(`${label}筛选，已选：${value}`), selected)
    assert.match(textContent(selected), new RegExp(`${label}\\s*${value}`))
    assert.ok(String(pill.props.class).includes('has-value'))
    assert.ok(clear)
    assert.equal(clear.parent, selected.parent)
    assert.equal(findAll(selected, (item) => item.type === 'button').length, 1)
    assert.equal(findAll(clear, (item) => item.type === 'button').length, 1)
    assert.equal(
      findAll(pill, (item) => item.props['data-test-canvas-icon'] === 'chevron').length,
      0,
    )
    assert.ok(
      !findAll(pill, (item) => item.type === 'span').some((item) =>
        /^\d+$/.test(textContent(item).trim()),
      ),
    )
    assert.equal(selected.props['aria-expanded'], true)
    assert.equal(h.button('重置'), undefined)
    assert.deepEqual(h.events, [])
    h.app.unmount()
  }
})

test('multi-value pill summaries follow canonical option order, preserve the menu and survive Escape', async () => {
  for (const [key, label, reverseValues, expected] of [
    ['gender', '性别', ['女', '男'], '男、女'],
    ['ageGroup', '年龄段', ['老年', '青年'], '青年、老年'],
    ['culture', '文化区域', ['欧美', '东亚'], '东亚、欧美'],
  ]) {
    const h = await mountLibrary()
    await chooseFilterOptions(h, key, reverseValues)
    const selected = filterTrigger(h, key)
    assert.equal(selected.props['aria-label'], `${label}筛选，已选：${expected}`)
    assert.match(textContent(selected), new RegExp(`${label}\\s*${expected}`))
    assert.equal(selected.props['aria-expanded'], true)
    assert.equal(
      findAll(filterPill(h, key), (item) => item.props['data-test-canvas-icon'] === 'chevron')
        .length,
      0,
    )
    const group = findAll(h.root, (item) => item.props.id === `cv3-character-filter-${key}`)[0]
    assert.equal(findAll(group, (item) => item.type === 'input' && item.props.checked).length, 2)
    let stopped = false
    findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0].props.onKeydown({
      key: 'Escape',
      preventDefault() {},
      stopPropagation() {
        stopped = true
      },
    })
    await nextTick()
    assert.equal(stopped, true)
    assert.equal(filterTrigger(h, key).props['aria-expanded'], false)
    assert.equal(filterTrigger(h, key).props['aria-label'], `${label}筛选，已选：${expected}`)
    filterTrigger(h, key).props.onClick()
    await nextTick()
    const reopened = findAll(h.root, (item) => item.props.id === `cv3-character-filter-${key}`)[0]
    assert.equal(findAll(reopened, (item) => item.type === 'input' && item.props.checked).length, 2)
    assert.deepEqual(h.events, [])
    h.app.unmount()
  }
})

test('each pill clear removes only its category, closes rather than opens the menu and leaves records untouched', async () => {
  const original = JSON.stringify(items)
  const h = await mountLibrary()
  await chooseFilterOptions(h, 'gender', ['女', '男'])
  await chooseFilterOptions(h, 'ageGroup', ['老年', '青年'])
  await chooseFilterOptions(h, 'culture', ['欧美', '东亚'])
  const expected = {
    gender: '性别筛选，已选：男、女',
    ageGroup: '年龄段筛选，已选：青年、老年',
    culture: '文化区域筛选，已选：东亚、欧美',
  }
  for (const [key, label] of [
    ['gender', '性别'],
    ['ageGroup', '年龄段'],
    ['culture', '文化区域'],
  ]) {
    const clear = h.button(`清除${label}筛选`)
    assert.ok(clear)
    let stopped = false
    clear.props.onClick({
      stopPropagation() {
        stopped = true
      },
    })
    await nextTick()
    assert.equal(stopped, true)
    expected[key] = `${label}筛选`
    assert.equal(filterTrigger(h, key).focused, true)
    for (const category of Object.keys(expected)) {
      assert.equal(filterTrigger(h, category).props['aria-label'], expected[category])
      assert.equal(filterTrigger(h, category).props['aria-expanded'], false)
    }
    assert.equal(h.button(`清除${label}筛选`), undefined)
    assert.equal(
      findAll(
        h.root,
        (item) => item.props.role === 'group' && /选项$/.test(item.props['aria-label'] || ''),
      ).length,
      0,
    )
  }
  assert.equal(findAll(h.root, (item) => item.type === 'img').length, 3)
  assert.equal(JSON.stringify(items), original)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('Escape closes only the filter popover and preserves active model multi-selection', async () => {
  const h = await mountLibrary()
  await chooseFilterOptions(h, 'gender', ['女'])
  h.button('多选').props.onClick()
  await nextTick()
  h.button('选择温暖妈妈').props.onClick()
  await nextTick()
  assert.match(textContent(h.root), /已选 1 个模特/)
  const library = findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0]
  let stopped = false
  library.props.onKeydown({
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {
      stopped = true
    },
  })
  await nextTick()
  assert.equal(stopped, true)
  assert.equal(filterTrigger(h, 'gender').props['aria-expanded'], false)
  assert.equal(filterTrigger(h, 'gender').props['aria-label'], '性别筛选，已选：女')
  assert.equal(h.button('多选').props['aria-pressed'], true)
  assert.match(textContent(h.root), /已选 1 个模特/)
  assert.equal(h.button('删除模特').props.disabled, false)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('grid keeps both catalog sections and official items cannot enter personal deletion events', async () => {
  const { root, events, app, button } = await mountLibrary({
    officialItems: [{ ...items[2], id: 'official-c' }],
  })
  button('宫格模式').props.onClick()
  await nextTick()
  const sections = () => findAll(root, (target) => Boolean(target.props['data-character-section']))
  assert.deepEqual(
    sections().map((entry) => entry.props['aria-label']),
    ['我的模特库', '官方模特库'],
  )
  findAll(
    root,
    (target) => target.props.role === 'tab' && textContent(target).trim() === '官方模特库',
  )[0].props.onClick()
  await nextTick()
  assert.equal(sections().length, 2)
  assert.equal(findAll(root, (target) => target.type === 'img').length, 4)
  button('多选').props.onClick()
  await nextTick()
  button('选择温暖妈妈').props.onClick()
  findAll(root, (target) => target.type === 'button' && target.props['aria-label'] === '选择角色 C')
    .at(-1)
    .props.onClick()
  await nextTick()
  button('删除模特').props.onClick()
  assert.deepEqual(
    events[0][1].map(({ id }) => id),
    ['a'],
  )
  app.unmount()
})

test('one header row offers model, official, product and scene tabs with isolated personal panes', async () => {
  const official = { ...items[2], id: 'official-c', name: '官方展示模特' }
  const h = await mountLibrary({ officialItems: [official] })
  const tabs = findAll(h.root, (item) => item.props.role === 'tab')
  assert.deepEqual(tabs.map(textContent), ['我的模特库', '官方模特库', '我的商品库', '我的场景库'])
  assert.ok(
    tabs.every((tab) => tab.parent === tabs[0].parent),
    'all four tabs share one row',
  )
  assert.equal(personalPane(h.root).length, 0)
  assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 1)
  let previousPaneInstance
  for (const [label, kind] of [
    ['我的商品库', 'product'],
    ['我的场景库', 'scene'],
  ]) {
    await selectLibraryTab(h, label)
    assert.equal(personalPane(h.root).length, 1)
    assert.equal(personalPane(h.root)[0].props['data-test-personal-library'], kind)
    assert.notEqual(personalPane(h.root)[0].props['data-test-instance'], previousPaneInstance)
    previousPaneInstance = personalPane(h.root)[0].props['data-test-instance']
    assert.equal(withClass(h.root, 'cv3-character-library-toolbar').length, 0)
    assert.equal(withClass(h.root, 'cv3-character-library-footer').length, 0)
    assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 0)
    assert.equal(withClass(h.root, 'cv3-character-grid').length, 0)
    assert.equal(findAll(h.root, (item) => item.type === 'img').length, 0)
    assert.doesNotMatch(textContent(h.root), /官方展示模特/)
    for (const name of [
      '性别筛选',
      '年龄段筛选',
      '文化区域筛选',
      '搜索模特',
      '编辑模特',
      '生成其他年龄版本',
      '创建新模特',
    ])
      assert.equal(h.button(name), undefined, name)
    assert.equal(libraryTab(h, label).props['aria-selected'], true)
  }
  await selectLibraryTab(h, '官方模特库')
  assert.equal(personalPane(h.root).length, 0)
  assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 1)
  assert.ok(h.button('查看模特资产'))
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('unclassified legacy and explicit model records remain models while product and scene records never enter model views', async () => {
  const legacy = { ...items[0], name: '未分类旧模特' }
  const explicitModel = { ...items[1], config: { libraryKind: 'model' } }
  const product = {
    ...items[0],
    id: 'product-1',
    name: '绵绵岛商品',
    imageUrl: '/product.png',
    config: { libraryKind: 'product', productCode: 'MIAN-1' },
  }
  const scene = {
    ...items[0],
    id: 'scene-1',
    name: '奶油卧室场景',
    imageUrl: '/scene.png',
    config: { libraryKind: 'scene', lighting: '晨光' },
  }
  const records = [legacy, explicitModel, product, scene]
  const before = JSON.stringify(records)
  const h = await mountLibrary({ myItems: records })
  const sources = () => findAll(h.root, (item) => item.type === 'img').map((item) => item.props.src)
  assert.deepEqual(sources(), ['/a.png', '/b.png'])
  assert.doesNotMatch(textContent(h.root), /绵绵岛商品|奶油卧室场景/)
  h.button('宫格模式').props.onClick()
  await nextTick()
  assert.deepEqual(sources(), ['/a.png', '/b.png'])
  assert.match(textContent(h.root), /未分类旧模特|长者/)
  for (const label of ['我的商品库', '我的场景库']) await selectLibraryTab(h, label)
  await selectLibraryTab(h, '我的模特库')
  assert.deepEqual(sources(), ['/a.png', '/b.png'])
  h.button('列表模式').props.onClick()
  await nextTick()
  assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 1)
  assert.deepEqual(sources(), ['/a.png', '/b.png'])
  assert.equal(JSON.stringify(records), before)
  assert.equal(legacy.config, undefined)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('model search, filters, multi-selection and loading state do not leak into product or scene panes', async () => {
  const h = await mountLibrary()
  h.button('性别筛选').props.onClick()
  await nextTick()
  const female = findAll(
    h.root,
    (item) => item.type === 'label' && textContent(item).trim() === '女',
  )[0]
  findAll(female, (item) => item.type === 'input')[0].props.onChange()
  await nextTick()
  h.button('搜索模特').props.onClick()
  await nextTick()
  const search = findAll(h.root, (item) => item.type === 'input' && item.props.type === 'search')[0]
  search.props['onUpdate:modelValue']('温暖')
  await nextTick()
  h.button('多选').props.onClick()
  await nextTick()
  h.button('选择温暖妈妈').props.onClick()
  await nextTick()
  for (const [label, kind] of [
    ['我的商品库', 'product'],
    ['我的场景库', 'scene'],
  ]) {
    await selectLibraryTab(h, label)
    h.state.loading = true
    h.state.error = '模特库专属错误'
    await nextTick()
    const [pane] = personalPane(h.root)
    assert.equal(pane.props['data-test-personal-library'], kind)
    assert.doesNotMatch(
      pane.props['data-test-child-attrs'],
      /filter|query|search|selected|official|myItems|loading|error/i,
    )
    assert.equal(h.button('删除模特'), undefined)
    assert.equal(
      findAll(h.root, (item) => item.type === 'input' && item.props.type === 'search').length,
      0,
    )
    assert.doesNotMatch(textContent(h.root), /已选.*个模特|模特库专属错误|正在加载模特库/)
  }
  h.state.loading = false
  h.state.error = ''
  await selectLibraryTab(h, '我的模特库')
  assert.equal(personalPane(h.root).length, 0)
  assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 1)
  assert.ok(filterTrigger(h, 'gender'))
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('a personal database containing only product and scene records still starts on the centered model creation card', async () => {
  const records = ['product', 'scene'].map((kind) => ({
    id: `${kind}-only`,
    name: `${kind} asset`,
    imageUrl: `https://assets.example.com/${kind}-only.png`,
    config: { libraryKind: kind },
  }))
  const before = JSON.stringify(records)
  const h = await mountLibrary({ myItems: records, officialItems: [items[2]] })
  assert.equal(findAll(h.root, (item) => item.type === 'img').length, 1)
  assert.equal(slider(h.root).props.value, 0)
  assert.equal(slider(h.root).props['aria-valuetext'], '1 / 2 创建新模特')
  assert.equal(portraitOffset(h.root, '创建新模特'), 0)
  assert.equal(h.button('编辑模特'), undefined)
  assert.equal(h.button('添加到画布'), undefined)
  assert.equal(JSON.stringify(records), before)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('all four library tabs support roving focus, arrow wrapping, Home and End', async () => {
  const h = await mountLibrary({ officialItems: [{ ...items[2], id: 'official-keyboard' }] })
  const labels = ['我的模特库', '官方模特库', '我的商品库', '我的场景库']
  const active = () => labels.find((label) => libraryTab(h, label).props['aria-selected'])
  async function key(value, expected) {
    let prevented = false
    const current = libraryTab(h, active())
    current.props.onKeydown({
      key: value,
      currentTarget: current,
      preventDefault() {
        prevented = true
      },
    })
    await nextTick()
    await nextTick()
    assert.equal(prevented, true)
    assert.equal(active(), expected)
    assert.equal(libraryTab(h, expected).focused, true)
    assert.deepEqual(
      labels.map((label) => libraryTab(h, label).props.tabindex),
      labels.map((label) => (label === expected ? 0 : -1)),
    )
  }
  assert.equal(active(), '我的模特库')
  await key('ArrowRight', '官方模特库')
  await key('ArrowRight', '我的商品库')
  await key('ArrowRight', '我的场景库')
  await key('ArrowRight', '我的模特库')
  await key('ArrowLeft', '我的场景库')
  await key('Home', '我的模特库')
  await key('End', '我的场景库')
  assert.equal(personalPane(h.root)[0].props['data-test-personal-library'], 'scene')
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('a personal write locks tab navigation and notifies the parent until the child clears busy', async () => {
  const h = await mountLibrary()
  const labels = ['我的模特库', '官方模特库', '我的商品库', '我的场景库']
  await selectLibraryTab(h, '我的商品库')
  const pane = personalPane(h.root)[0]
  pane.props.onTestBusyChange(true)
  await nextTick()
  assert.ok(labels.every((label) => libraryTab(h, label).props.disabled))
  await selectLibraryTab(h, '我的场景库')
  let prevented = false
  const activeTab = libraryTab(h, '我的商品库')
  activeTab.props.onKeydown({
    key: 'ArrowRight',
    currentTarget: activeTab,
    preventDefault() {
      prevented = true
    },
  })
  await nextTick()
  assert.equal(prevented, false)
  assert.equal(libraryTab(h, '我的商品库').props['aria-selected'], true)
  assert.equal(
    personalPane(h.root)[0].props['data-test-instance'],
    pane.props['data-test-instance'],
  )
  assert.deepEqual(h.events, [['library-busy', true]])
  pane.props.onTestBusyChange(false)
  await nextTick()
  assert.ok(labels.every((label) => !libraryTab(h, label).props.disabled))
  await selectLibraryTab(h, '我的场景库')
  assert.equal(personalPane(h.root)[0].props['data-test-personal-library'], 'scene')
  assert.deepEqual(h.events, [
    ['library-busy', true],
    ['library-busy', false],
  ])
  h.app.unmount()
})

test('late model-library responses cannot navigate away from the active product or scene pane', async () => {
  const h = await mountLibrary({
    myItems: [],
    officialItems: [{ ...items[2], id: 'official-late' }],
  })
  const initial = [
    { ...items[0], id: 'late-model' },
    { ...items[1], id: 'late-product', config: { libraryKind: 'product' } },
    { ...items[2], id: 'late-scene', config: { libraryKind: 'scene' } },
  ]
  const before = JSON.stringify(initial)
  for (const [label, kind] of [
    ['我的商品库', 'product'],
    ['我的场景库', 'scene'],
  ]) {
    await selectLibraryTab(h, label)
    const instance = personalPane(h.root)[0].props['data-test-instance']
    for (const records of [initial, [...initial, { ...items[1], id: `another-${kind}` }], []]) {
      h.state.myItems = records
      await nextTick()
      await nextTick()
      assert.equal(libraryTab(h, label).props['aria-selected'], true)
      assert.equal(personalPane(h.root).length, 1)
      assert.equal(personalPane(h.root)[0].props['data-test-personal-library'], kind)
      assert.equal(personalPane(h.root)[0].props['data-test-instance'], instance)
      assert.equal(withClass(h.root, 'cv3-character-carousel-stage').length, 0)
      assert.equal(withClass(h.root, 'cv3-character-library-toolbar').length, 0)
    }
  }
  assert.equal(JSON.stringify(initial), before)
  assert.equal(initial[0].config, undefined)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('official and same-source saved copies use transparent portraits in carousel and grid without masking a changed image', async () => {
  const template = CHARACTER_STUDIO_TEMPLATES.find((item) => item.id === 'official-003')
  const saved = {
    ...template,
    id: 'saved-003',
    name: '甜妹副本',
    official: false,
    source: 'personal',
    // Older saved metadata may contain the white-background asset preview.
    previewUrl: '/canvas-v3/characters/assets/003-full-body.webp',
  }
  const before = JSON.stringify(saved)
  const h = await mountLibrary({ myItems: [saved], officialItems: [template] })
  const sources = () => findAll(h.root, (item) => item.type === 'img').map((item) => item.props.src)
  assert.deepEqual(sources(), ['/canvas-v3/characters/003.webp', '/canvas-v3/characters/003.webp'])
  h.button('宫格模式').props.onClick()
  await nextTick()
  assert.deepEqual(sources(), ['/canvas-v3/characters/003.webp', '/canvas-v3/characters/003.webp'])
  assert.equal(JSON.stringify(saved), before)
  const updated = {
    ...saved,
    imageUrl: 'https://assets.example.com/edited-copy.png',
    coverUrl: 'https://assets.example.com/edited-copy.png',
  }
  h.state.myItems = [updated]
  await nextTick()
  assert.deepEqual(sources(), [updated.imageUrl, '/canvas-v3/characters/003.webp'])
  h.button('列表模式').props.onClick()
  await nextTick()
  assert.deepEqual(sources(), [updated.imageUrl, '/canvas-v3/characters/003.webp'])
  assert.equal(updated.previewUrl, saved.previewUrl)
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('empty personal carousel includes create placeholder before official catalog and tabs navigate the same catalog', async () => {
  const { root, events, app, button } = await mountLibrary({
    myItems: [],
    officialItems: [items[2]],
  })
  assert.match(textContent(root), /创建新模特/)
  assert.equal(
    findAll(root, (entry) => entry.props['data-test-character-wireframe'] === true).length,
    1,
  )
  assert.equal(button('添加到画布'), undefined)
  findAll(
    root,
    (target) => target.props.role === 'tab' && textContent(target).trim() === '官方模特库',
  )[0].props.onClick()
  await nextTick()
  button('添加到画布').props.onClick()
  assert.equal(events[0][1][0].id, 'c')
  button('查看模特资产').props.onClick()
  assert.deepEqual(
    events[1].map((value, index) => (index === 1 ? value.id : value)),
    ['inspect', 'c'],
  )
  button('编辑模特').props.onClick()
  assert.equal(events[2][0], 'open')
  assert.equal(events[2][1].id, 'c')
  app.unmount()
})
test('empty library provides true create and import actions without invented catalog cards', async () => {
  const { root, events, app, button } = await mountLibrary({ myItems: [] })
  assert.match(textContent(root), /创建新模特/)
  assert.equal(
    findAll(root, (entry) => entry.props['data-test-character-wireframe'] === true).length,
    1,
  )
  button('创建新模特').props.onClick()
  await nextTick()
  button('生成新模特').props.onClick()
  assert.deepEqual(events, [['create', 'generate']])
  button('创建新模特').props.onClick()
  await nextTick()
  button('导入已有模特').props.onClick()
  assert.deepEqual(events[1], ['create', 'import'])
  assert.equal(findAll(root, (target) => target.type === 'img').length, 0)
  app.unmount()
})

test('vertical wheel switches one portrait and keeps the title, slider and explicit action target synchronized', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const event = await wheel(h, 120)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.stopped, true)
  assert.equal(slider(h.root).props.value, 2)
  assert.match(slider(h.root).props['aria-valuetext'], /3 \/ 7 长者/)
  assert.match(textContent(withClass(h.root, 'cv3-character-active-title')[0]), /长者/)
  assert.equal(h.events.length, 0, 'wheel must never open, insert, generate or delete a character')
  h.button('添加到画布').props.onClick()
  assert.deepEqual(
    h.events[0][1].map(({ id }) => id),
    ['b'],
  )
  await wheel(h, -120, {}, 1)
  assert.equal(slider(h.root).props.value, 1, 'reverse gestures respond immediately')
  h.app.unmount()
})

test('trackpad pixel deltas accumulate and one enormous wheel event never skips multiple portraits', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  for (let index = 0; index < 3; index += 1) await wheel(h, 7, {}, 5)
  assert.equal(slider(h.root).props.value, 1)
  await wheel(h, 7, {}, 5)
  assert.equal(slider(h.root).props.value, 2)
  await wheel(h, 10000, {}, 200)
  assert.equal(slider(h.root).props.value, 3)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('same-direction cooldown and decaying inertial tails do not cause extra unintended selections', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 120)
  await wheel(h, 120, {}, 20)
  assert.equal(slider(h.root).props.value, 2)
  await wheel(h, 80, {}, 20)
  await wheel(h, 60, {}, 60)
  await wheel(h, 35, {}, 70)
  assert.equal(slider(h.root).props.value, 2, 'a decaying tail stays suppressed past the cooldown')
  await wheel(h, 120, {}, 10)
  assert.equal(slider(h.root).props.value, 3, 'a new strong impulse may navigate again')
  h.app.unmount()
})

test('line and page deltas are supported while first and last boundaries never wrap', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  slider(h.root).props.onInput({ target: { value: 0 } })
  await nextTick()
  await wheel(h, -3, { deltaMode: 1 })
  assert.equal(slider(h.root).props.value, 0)
  await wheel(h, 2, { deltaMode: 1 }, 200)
  assert.equal(slider(h.root).props.value, 1)
  await wheel(h, 1, { deltaMode: 2 }, 200)
  assert.equal(slider(h.root).props.value, 2)
  slider(h.root).props.onInput({ target: { value: 6 } })
  await nextTick()
  await wheel(h, 5000, {}, 200)
  assert.equal(slider(h.root).props.value, 6)
  await wheel(h, -120, {}, 1)
  assert.equal(slider(h.root).props.value, 5)
  h.app.unmount()
})

test('zoom, horizontal, zero and non-finite gestures are ignored without consuming native events', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const ignored = [
    { deltaY: 100, ctrlKey: true },
    { deltaY: 100, metaKey: true },
    { deltaX: 110, deltaY: 100 },
    { deltaY: 0 },
    { deltaY: Number.NaN },
    { deltaY: Infinity },
    { deltaX: Number.NaN, deltaY: 100 },
    { deltaX: Infinity, deltaY: 100 },
  ]
  for (const details of ignored) {
    const event = await wheel(h, details.deltaY, details, 10)
    assert.equal(
      event.defaultPrevented,
      false,
      `should ignore ${String(details.deltaX)}, ${String(details.deltaY)}`,
    )
    assert.equal(event.stopped, false)
    assert.equal(slider(h.root).props.value, 1)
  }
  await wheel(h, 120, { timeStamp: Number.NaN }, 200)
  assert.equal(
    slider(h.root).props.value,
    2,
    'invalid event timestamp falls back to the platform clock',
  )
  h.app.unmount()
})

test('only the portrait stage handles wheel and grid keeps its native scrolling', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const handlers = findAll(h.root, (entry) => Boolean(entry.props.onWheel))
  assert.equal(handlers.length, 1)
  assert.equal(handlers[0], withClass(h.root, 'cv3-character-carousel-stage')[0])
  const oldStageHandler = handlers[0].props.onWheel
  h.button('宫格模式').props.onClick()
  await nextTick()
  assert.equal(findAll(h.root, (entry) => Boolean(entry.props.onWheel)).length, 0)
  const stale = wheelEvent(h.clock, { deltaY: 120 })
  oldStageHandler(stale)
  assert.equal(stale.defaultPrevented, false)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('wheel browsing preserves explicit multi-selection and never emits an operation', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  h.button('多选').props.onClick()
  await nextTick()
  h.button('选择温暖妈妈').props.onClick()
  h.button('选择长者').props.onClick()
  await nextTick()
  assert.match(textContent(h.root), /已选 2 个模特/)
  await wheel(h, 120)
  assert.match(textContent(h.root), /已选 2 个模特/)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('leaving the hover area clears partial trackpad accumulation', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 14)
  withClass(h.root, 'cv3-character-carousel-stage')[0].props.onPointerleave()
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 1)
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 2)
  h.app.unmount()
})

test('filter changes clear partial gestures before browsing the filtered catalog', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 14)
  h.button('性别筛选').props.onClick()
  await nextTick()
  const male = findAll(
    h.root,
    (entry) => entry.type === 'label' && textContent(entry).trim() === '男',
  )[0]
  findAll(male, (entry) => entry.type === 'input')[0].props.onChange()
  await nextTick()
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 0)
  assert.match(slider(h.root).props['aria-valuetext'], /长者/)
  await wheel(h, 14, {}, 10)
  assert.match(slider(h.root).props['aria-valuetext'], /角色 D/)
  h.app.unmount()
})

test('tab and view changes reset partial gestures rather than carrying them into another catalog', async () => {
  const h = await mountLibrary({ myItems: items.slice(0, 2), officialItems: wheelItems.slice(2) })
  await wheel(h, 14)
  findAll(
    h.root,
    (entry) => entry.props.role === 'tab' && textContent(entry).trim() === '官方模特库',
  )[0].props.onClick()
  await nextTick()
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 3)
  h.button('宫格模式').props.onClick()
  await nextTick()
  h.button('列表模式').props.onClick()
  await nextTick()
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 3)
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 4)
  h.app.unmount()
})

test('search changes reset the gesture accumulator without fabricating a selected result', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 14)
  h.button('搜索模特').props.onClick()
  await nextTick()
  const search = findAll(
    h.root,
    (entry) => entry.type === 'input' && entry.props.type === 'search',
  )[0]
  search.props['onUpdate:modelValue']('角色')
  await nextTick()
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 0)
  await wheel(h, 14, {}, 10)
  assert.equal(slider(h.root).props.value, 1)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('personal and official model search share a collapsed icon, focused input and immediate blur behavior', async () => {
  for (const initialTab of ['我的模特库', '官方模特库']) {
    const h = await mountLibrary({ officialItems: [{ ...items[2], id: 'official-search' }] })
    await selectLibraryTab(h, initialTab)
    const toggle = h.button('搜索模特')
    assert.ok(String(toggle.props.class).includes('cv3-character-search-toggle'))
    assert.equal(modelSearch(h), undefined)
    const icon = findAll(toggle, (item) => item.props['data-test-canvas-icon'] === 'search')[0]
    assert.ok(icon)
    assert.equal(icon.props.size, 16)
    toggle.props.onClick()
    await nextTick()
    await nextTick()
    let input = modelSearch(h)
    assert.ok(input)
    assert.equal(input.focused, true)
    assert.equal(input.props['aria-label'], '搜索模特')
    assert.equal(input.props.placeholder, '搜索模特名称或描述')
    input.props['onUpdate:modelValue']('Studio')
    await nextTick()
    input = modelSearch(h)
    input.props.onBlur({ relatedTarget: h.button('宫格模式') })
    await nextTick()
    assert.equal(modelSearch(h), input, 'nonempty search remains visible after outside blur')
    const clear = h.button('清除搜索')
    assert.ok(clear)
    assert.ok(String(clear.props.class).includes('cv3-character-search-clear'))
    const closeIcon = findAll(clear, (item) => item.props['data-test-canvas-icon'] === 'close')[0]
    assert.equal(closeIcon.props.size, 14)
    for (const navigation of ['pointer', 'Tab']) {
      input.props['onUpdate:modelValue'](' ')
      await nextTick()
      const internalClear = h.button('清除搜索')
      if (navigation === 'Tab') {
        let prevented = false
        findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0].props.onKeydown({
          key: 'Tab',
          preventDefault() {
            prevented = true
          },
        })
        assert.equal(prevented, false, 'native Tab may move focus into the clear button')
      }
      input.props.onBlur({ relatedTarget: internalClear })
      await nextTick()
      assert.equal(modelSearch(h), input, `${navigation} blur into internal clear must not hide it`)
      assert.equal(h.button('清除搜索'), internalClear, 'the clear target survives the blur render')
      input.focused = false
      internalClear.props.onClick()
      await nextTick()
      await nextTick()
      assert.equal(modelSearch(h), input)
      assert.equal(input.focused, true, 'clearing returns native focus to the still-visible input')
      assert.equal(h.button('清除搜索'), undefined)
    }
    input.props.onBlur({ relatedTarget: h.button('宫格模式') })
    await nextTick()
    assert.equal(modelSearch(h), undefined, 'one Vue render tick is enough, without a timer')
    assert.ok(h.button('搜索模特'))
    assert.deepEqual(h.events, [])
    h.app.unmount()
  }
})

test('whitespace search closes on outside blur without changing its query and uses two Escape stages', async () => {
  for (const initialTab of ['我的模特库', '官方模特库']) {
    const h = await mountLibrary({ officialItems: [{ ...items[2], id: 'official-space-search' }] })
    await selectLibraryTab(h, initialTab)
    h.button('搜索模特').props.onClick()
    await nextTick()
    await nextTick()
    const input = modelSearch(h)
    input.props['onUpdate:modelValue']('   ')
    await nextTick()
    assert.ok(h.button('清除搜索'), 'raw whitespace is still an editable search value')
    input.props.onBlur({ relatedTarget: h.button('宫格模式') })
    await nextTick()
    assert.equal(
      modelSearch(h),
      undefined,
      'outside blur collapses whitespace in the same render tick',
    )
    h.button('搜索模特').props.onClick()
    await nextTick()
    await nextTick()
    const reopened = modelSearch(h)
    assert.equal(
      reopened.value,
      '   ',
      'collapsing must not silently trim or clear the stored query',
    )
    assert.ok(h.button('清除搜索'))
    for (const stage of ['clear', 'collapse']) {
      let prevented = false,
        stopped = false
      findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0].props.onKeydown({
        key: 'Escape',
        preventDefault() {
          prevented = true
        },
        stopPropagation() {
          stopped = true
        },
      })
      await nextTick()
      await nextTick()
      assert.equal(prevented, true)
      assert.equal(stopped, true, 'search Escape never escapes into the outer dialog')
      if (stage === 'clear') {
        assert.equal(modelSearch(h), reopened)
        assert.equal(h.button('清除搜索'), undefined, 'the first Escape clears even whitespace')
      } else {
        assert.equal(modelSearch(h), undefined)
        assert.equal(h.button('搜索模特').focused, true)
      }
    }
    assert.deepEqual(h.events, [])
    h.app.unmount()
  }
})

test('search stays open across explicit model tabs and query-driven automatic catalog highlighting', async () => {
  const h = await mountLibrary({
    myItems: [items[0]],
    officialItems: [{ ...items[2], id: 'official-query' }],
  })
  h.button('搜索模特').props.onClick()
  await nextTick()
  await nextTick()
  const input = modelSearch(h)
  await selectLibraryTab(h, '官方模特库')
  assert.equal(modelSearch(h), input)
  await selectLibraryTab(h, '我的模特库')
  assert.equal(modelSearch(h), input)
  input.props['onUpdate:modelValue']('Studio')
  await nextTick()
  assert.equal(libraryTab(h, '官方模特库').props['aria-selected'], true)
  assert.equal(modelSearch(h), input, 'automatic highlighting must not unmount the active search')
  input.props['onUpdate:modelValue']('温暖')
  await nextTick()
  assert.equal(libraryTab(h, '我的模特库').props['aria-selected'], true)
  assert.equal(modelSearch(h), input)
  assert.ok(h.button('清除搜索'))
  assert.deepEqual(h.events, [])
  h.app.unmount()
})

test('Escape prioritizes the menu, then clears search, then collapses it without exiting multi-select or clearing filters', async () => {
  for (const initialTab of ['我的模特库', '官方模特库']) {
    const h = await mountLibrary({
      officialItems: [{ ...items[0], id: 'official-escape', name: '官方温暖妈妈' }],
    })
    await selectLibraryTab(h, initialTab)
    await chooseFilterOptions(h, 'gender', ['女'])
    h.button('多选').props.onClick()
    await nextTick()
    h.button('搜索模特').props.onClick()
    await nextTick()
    await nextTick()
    const input = modelSearch(h)
    input.props['onUpdate:modelValue']('温暖')
    await nextTick()
    filterTrigger(h, 'gender').props.onClick()
    await nextTick()
    const escape = async () => {
      let prevented = false,
        stopped = false
      findAll(h.root, (item) => item.props['aria-label'] === '创作素材库')[0].props.onKeydown({
        key: 'Escape',
        preventDefault() {
          prevented = true
        },
        stopPropagation() {
          stopped = true
        },
      })
      await nextTick()
      await nextTick()
      assert.equal(prevented, true)
      assert.equal(stopped, true)
      assert.equal(h.button('多选').props['aria-pressed'], true)
      assert.equal(filterTrigger(h, 'gender').props['aria-label'], '性别筛选，已选：女')
    }
    await escape()
    assert.equal(filterTrigger(h, 'gender').props['aria-expanded'], false)
    assert.ok(h.button('清除搜索'), 'menu Escape does not clear a search query')
    assert.equal(modelSearch(h), input)
    await escape()
    assert.equal(modelSearch(h), input)
    assert.equal(h.button('清除搜索'), undefined)
    await escape()
    assert.equal(modelSearch(h), undefined)
    assert.equal(h.button('搜索模特').focused, true)
    assert.deepEqual(h.events, [])
    h.app.unmount()
  }
})

test('single-item stages ignore wheel and the empty-personal placeholder never auto-creates', async () => {
  const single = await mountLibrary({ myItems: [items[0]] })
  single.button('搜索模特').props.onClick()
  await nextTick()
  findAll(single.root, (entry) => entry.type === 'input' && entry.props.type === 'search')[0].props[
    'onUpdate:modelValue'
  ]('温暖妈妈')
  await nextTick()
  const ignored = await wheel(single, 120)
  assert.equal(ignored.defaultPrevented, false)
  assert.equal(slider(single.root).props.value, 0)
  single.app.unmount()
  const h = await mountLibrary({ myItems: [], officialItems: [items[0]] })
  await wheel(h, 120)
  assert.equal(slider(h.root).props.value, 1)
  assert.match(slider(h.root).props['aria-valuetext'], /温暖妈妈/)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('spring movement starts from the displayed position and an immediate reverse redirects without a jump', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 120)
  assert.ok(h.clock.frames.size > 0)
  h.clock.frame()
  await nextTick()
  h.clock.frame()
  await nextTick()
  const moving = portraitOffset(h.root, '温暖妈妈')
  assert.ok(moving < 0 && moving > -1, `expected an intermediate offset, got ${moving}`)
  await wheel(h, -120, {}, 1)
  assert.equal(
    portraitOffset(h.root, '温暖妈妈'),
    moving,
    're-targeting preserves the presentation position',
  )
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 1)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), 0)
  h.app.unmount()
})

test('range dragging updates immediately and cancels an outstanding spring', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 120)
  assert.ok(h.clock.frames.size)
  slider(h.root).props.onInput({ target: { value: 3 } })
  await nextTick()
  assert.equal(slider(h.root).props.value, 3)
  assert.equal(portraitOffset(h.root, '角色 C'), 0)
  assert.equal(h.clock.frames.size, 0)
  h.app.unmount()
})

test('reduced-motion preference keeps navigation working without a spatial animation', async () => {
  const h = await mountLibrary({ myItems: wheelItems }, { reducedMotion: true })
  await wheel(h, 120)
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(h.clock.frames.size, 0)
  h.app.unmount()
})

test('changing reduced motion interrupts an active spring and unmount cleans frame and media subscriptions', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 120)
  assert.ok(h.clock.frames.size)
  assert.equal(h.clock.listeners.size, 1)
  h.clock.setReducedMotion(true)
  await nextTick()
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(h.clock.frames.size, 0)
  h.clock.setReducedMotion(false)
  h.button('下一个模特').props.onClick()
  await nextTick()
  assert.ok(h.clock.frames.size)
  h.app.unmount()
  assert.equal(h.clock.frames.size, 0)
  assert.equal(h.clock.listeners.size, 0)
  assert.ok(h.clock.cancelled.length > 0)
})

test('navigation degrades to immediate positioning when the platform has no animation frame API', async () => {
  const clock = browserClock()
  clock.platform.requestAnimationFrame = undefined
  clock.platform.cancelAnimationFrame = undefined
  const h = await mountLibrary({ myItems: wheelItems }, { clock })
  await wheel(h, 120)
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(clock.frames.size, 0)
  h.app.unmount()
})

test('legacy motion-preference subscriptions are also removed when the library closes', async () => {
  const clock = browserClock()
  clock.media.addEventListener = undefined
  clock.media.removeEventListener = undefined
  const h = await mountLibrary({ myItems: wheelItems }, { clock })
  assert.equal(clock.listeners.size, 1)
  await wheel(h, 120)
  clock.setReducedMotion(true)
  await nextTick()
  assert.equal(clock.frames.size, 0)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  h.app.unmount()
  assert.equal(clock.listeners.size, 0)
})

test('custom scrollbar thumb is decorative while the native range remains the only interactive slider', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const thumbs = withClass(h.root, 'cv3-character-scrollbar-thumb')
  assert.equal(thumbs.length, 1)
  assert.equal(thumbs[0].type, 'i')
  assert.equal(thumbs[0].props['aria-hidden'], 'true')
  assert.equal(thumbs[0].props.tabindex, undefined)
  assert.equal(thumbs[0].props.role, undefined)
  assert.deepEqual(
    Object.keys(thumbs[0].props).filter((key) => /^on[A-Z]/.test(key)),
    [],
  )
  const input = slider(h.root)
  assert.equal(input.props.min, '0')
  assert.equal(input.props.max, 6)
  assert.equal(input.props.step, '1')
  assert.equal(input.props['aria-label'], '模特列表位置')
  const source = await readFile(
    new URL('../src/features/canvas-v3/components/CharacterStudioLibrary.vue', import.meta.url),
    'utf8',
  )
  assert.match(source, /\.cv3-character-scrollbar-thumb\s*\{[^}]*pointer-events:\s*none/s)
  h.app.unmount()
})

test('scrollbar progress follows spring presentation frames continuously instead of jumping to the selected index', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const progress = () =>
    Number(
      withClass(h.root, 'cv3-character-carousel-scrubber')[0].props.style['--character-progress'],
    )
  assert.equal(progress(), 1 / 6)
  await wheel(h, 120)
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(
    progress(),
    1 / 6,
    'selected target may update before the animated presentation advances',
  )
  h.clock.frame()
  await nextTick()
  const first = progress()
  assert.ok(first > 1 / 6 && first < 2 / 6)
  assert.ok(Math.abs(first - (1 - portraitOffset(h.root, '温暖妈妈')) / 6) < 1e-12)
  h.clock.frame()
  await nextTick()
  assert.ok(progress() > first && progress() < 2 / 6)
  h.clock.settle()
  await nextTick()
  assert.equal(progress(), 2 / 6)
  h.app.unmount()
})

test('range drag reaches exact progress endpoints with accessible names and grid removes the horizontal custom bar', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const progress = () =>
    Number(
      withClass(h.root, 'cv3-character-carousel-scrubber')[0].props.style['--character-progress'],
    )
  slider(h.root).props.onInput({ target: { value: 6 } })
  await nextTick()
  assert.equal(progress(), 1)
  assert.equal(slider(h.root).props['aria-valuetext'], '7 / 7 角色 F')
  assert.equal(portraitOffset(h.root, '角色 F'), 0)
  assert.equal(h.clock.frames.size, 0)
  slider(h.root).props.onInput({ target: { value: 0 } })
  await nextTick()
  assert.equal(progress(), 0)
  assert.equal(slider(h.root).props['aria-valuetext'], '1 / 7 创建新模特')
  assert.equal(portraitOffset(h.root, '创建新模特'), 0)
  assert.equal(h.clock.frames.size, 0)
  h.button('宫格模式').props.onClick()
  await nextTick()
  assert.equal(withClass(h.root, 'cv3-character-carousel-scrubber').length, 0)
  assert.equal(withClass(h.root, 'cv3-character-scrollbar-thumb').length, 0)
  assert.equal(slider(h.root), undefined)
  h.app.unmount()
})

test('carousel catalog highlights follow boundary crossings without resetting wheel inertia and grid selection leaves the active anchor alone', async () => {
  const h = await mountLibrary({ myItems: [items[0]], officialItems: wheelItems.slice(1) })
  const selectedTab = (root) =>
    textContent(
      findAll(
        root,
        (entry) => entry.props.role === 'tab' && entry.props['aria-selected'] === true,
      )[0],
    ).trim()
  assert.equal(selectedTab(h.root), '我的模特库')
  await wheel(h, 120)
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(selectedTab(h.root), '官方模特库')
  await wheel(h, 120, {}, 20)
  assert.equal(
    slider(h.root).props.value,
    2,
    'automatic tab highlighting must not reset same-direction cooldown',
  )
  await wheel(h, 80, {}, 70)
  await wheel(h, 35, {}, 100)
  assert.equal(
    slider(h.root).props.value,
    2,
    'the same gesture tail stays suppressed across a catalog boundary',
  )
  await wheel(h, -120, {}, 1)
  assert.equal(slider(h.root).props.value, 1)
  assert.equal(selectedTab(h.root), '我的模特库')
  await wheel(h, 120, {}, 1)
  assert.equal(selectedTab(h.root), '官方模特库')
  h.button('宫格模式').props.onClick()
  await nextTick()
  h.button('查看温暖妈妈').props.onClick()
  await nextTick()
  assert.equal(
    selectedTab(h.root),
    '官方模特库',
    'selecting an item in the mixed grid must not move its navigation anchor',
  )
  assert.equal(h.events.length, 0)
  h.app.unmount()
  const empty = await mountLibrary({ myItems: [], officialItems: [items[0], items[1]] })
  await wheel(empty, 120)
  assert.equal(selectedTab(empty.root), '官方模特库')
  await wheel(empty, -120, {}, 1)
  assert.equal(
    selectedTab(empty.root),
    '我的模特库',
    'returning to the create placeholder highlights the personal library',
  )
  assert.equal(empty.events.length, 0)
  empty.app.unmount()
})

test('a pending pointer tap grabs the presentation position without jumping or capturing and resumes its spring on release', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await wheel(h, 120)
  h.clock.frame()
  h.clock.frame()
  await nextTick()
  const before = portraitOffset(h.root, '温暖妈妈')
  const { stage } = await pointer(h, 'onPointerdown', { clientX: 610 })
  assert.equal(portraitOffset(h.root, '温暖妈妈'), before)
  assert.equal(stage.capturedPointers.size, 0, 'a normal tap never takes pointer capture')
  h.clock.frame()
  await nextTick()
  assert.equal(
    portraitOffset(h.root, '温暖妈妈'),
    before,
    'the held card is not pulled away by an old spring',
  )
  await pointer(h, 'onPointerup', { clientX: 610, buttons: 0 }, 20)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), before)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(stage.capturedPointers.size, 0)
  h.app.unmount()
})

test('horizontal dragging tracks the real CSS card step one-to-one and releases into a synchronized spring', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { clientX: 610 })
  const { event, stage } = await pointer(h, 'onPointermove', { clientX: 487.5 }, 30)
  assert.equal(event.defaultPrevented, true)
  assert.equal(stage.hasPointerCapture(1), true)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), -0.5)
  assert.equal(
    Number(
      withClass(h.root, 'cv3-character-carousel-scrubber')[0].props.style['--character-progress'],
    ),
    0.25,
  )
  h.clock.frame()
  await nextTick()
  assert.equal(
    portraitOffset(h.root, '温暖妈妈'),
    -0.5,
    'no spring competes with direct manipulation',
  )
  await pointer(h, 'onPointerup', { clientX: 487.5, buttons: 0 }, 150)
  assert.equal(stage.hasPointerCapture(1), false)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('dragging respects a responsive CSS step rather than a hard-coded desktop distance', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  h.clock.styleValues['--character-step'] = '210px'
  await pointer(h, 'onPointerdown', { clientX: 500 })
  await pointer(h, 'onPointermove', { clientX: 395 }, 30)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), -0.5)
  await pointer(h, 'onPointercancel', {}, 20)
  h.app.unmount()
})

test('a fast release carries velocity to the next card while a stationary release does not invent momentum', async () => {
  for (const [pause, expected] of [
    [10, 2],
    [150, 1],
  ]) {
    const h = await mountLibrary({ myItems: wheelItems })
    await pointer(h, 'onPointerdown', { clientX: 500 })
    await pointer(h, 'onPointermove', { clientX: 450 }, 10)
    const heldOffset = portraitOffset(h.root, '温暖妈妈')
    await pointer(h, 'onPointerup', { clientX: 450, buttons: 0 }, pause)
    assert.equal(
      portraitOffset(h.root, '温暖妈妈'),
      heldOffset,
      'release does not jump to its projected target',
    )
    h.clock.settle()
    await nextTick()
    assert.equal(slider(h.root).props.value, expected)
    assert.equal(h.events.length, 0)
    h.app.unmount()
  }
})

test('dragging beyond either boundary is softly bounded and settles without wrapping the catalog', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  slider(h.root).props.onInput({ target: { value: 0 } })
  await nextTick()
  await pointer(h, 'onPointerdown', { clientX: 490 })
  await pointer(h, 'onPointermove', { clientX: 1490 }, 30)
  const firstOffset = portraitOffset(h.root, '创建新模特')
  assert.ok(firstOffset > 0 && firstOffset < 0.2)
  assert.equal(slider(h.root).props.value, 0)
  await pointer(h, 'onPointerup', { clientX: 1490, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  assert.equal(portraitOffset(h.root, '创建新模特'), 0)
  slider(h.root).props.onInput({ target: { value: 6 } })
  await nextTick()
  await pointer(h, 'onPointerdown', { clientX: 490 })
  await pointer(h, 'onPointermove', { clientX: -510 }, 30)
  const lastOffset = portraitOffset(h.root, '角色 F')
  assert.ok(lastOffset < 0 && lastOffset > -0.2)
  await pointer(h, 'onPointerup', { clientX: -510, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 6)
  assert.equal(portraitOffset(h.root, '角色 F'), 0)
  h.app.unmount()
})

test('a second pointer cannot move or end the captured gesture and vertical gestures are not hijacked', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { pointerId: 1, clientX: 490 })
  await pointer(h, 'onPointerdown', { pointerId: 2, clientX: 490 })
  await pointer(h, 'onPointermove', { pointerId: 2, clientX: 100 }, 10)
  await pointer(h, 'onPointerup', { pointerId: 2, clientX: 100, buttons: 0 }, 10)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), 0)
  const { stage } = await pointer(h, 'onPointermove', { pointerId: 1, clientX: 410 }, 10)
  assert.equal(stage.hasPointerCapture(1), true)
  await pointer(h, 'onPointercancel', { pointerId: 1 }, 10)
  h.clock.settle()
  await nextTick()
  await pointer(h, 'onPointerdown', { clientX: 490, clientY: 215 })
  const vertical = await pointer(h, 'onPointermove', { clientX: 489, clientY: 255 }, 20)
  assert.equal(vertical.event.defaultPrevented, false)
  assert.equal(stage.capturedPointers.size, 0)
  assert.equal(slider(h.root).props.value, 1)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('pointer cancellation, lost capture and unmount release native capture without submitting any operation', async () => {
  for (const handler of ['onPointercancel', 'onLostpointercapture']) {
    const h = await mountLibrary({ myItems: wheelItems })
    await pointer(h, 'onPointerdown', { clientX: 490 })
    const { stage } = await pointer(h, 'onPointermove', { clientX: 410 }, 20)
    assert.equal(stage.hasPointerCapture(1), true)
    await pointer(h, handler, {}, 20)
    assert.equal(stage.capturedPointers.size, 0)
    h.clock.settle()
    await nextTick()
    assert.equal(slider(h.root).props.value, 1)
    assert.equal(h.events.length, 0)
    h.app.unmount()
  }
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { clientX: 490 })
  const { stage } = await pointer(h, 'onPointermove', { clientX: 410 }, 20)
  h.app.unmount()
  assert.equal(stage.capturedPointers.size, 0)
  assert.equal(h.clock.frames.size, 0)
  assert.equal(h.clock.listeners.size, 0)
})

test('drag-generated clicks and double clicks cannot open assets or edit while keyboard activation remains available', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { clientX: 490 })
  await pointer(h, 'onPointermove', { clientX: 410 }, 20)
  await pointer(h, 'onPointerup', { clientX: 410, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  const portrait = h.button('查看温暖妈妈')
  const double = _pointerEvent(h.clock, portrait, { detail: 2 })
  _dispatchClick(portrait, double, 'Dblclick')
  assert.equal(double.defaultPrevented, true)
  const assets = h.button('查看模特资产')
  const click = _pointerEvent(h.clock, assets, { detail: 1 })
  _dispatchClick(assets, click)
  assert.equal(click.defaultPrevented, true)
  assert.equal(h.events.length, 0)
  const keyboard = _pointerEvent(h.clock, assets, { detail: 0 })
  _dispatchClick(assets, keyboard)
  assert.equal(keyboard.defaultPrevented, false)
  assert.equal(h.events[0][0], 'inspect')
  await pointer(h, 'onPointerdown', { target: assets })
  const fresh = _pointerEvent(h.clock, assets, { detail: 1 })
  _dispatchClick(assets, fresh)
  assert.equal(fresh.defaultPrevented, false)
  assert.equal(h.events.length, 2)
  h.app.unmount()
})

test('dragging the creation placeholder does not open its menu and dragging a selected portrait does not toggle selection', async () => {
  const empty = await mountLibrary({ myItems: [], officialItems: wheelItems })
  await pointer(empty, 'onPointerdown', { clientX: 490 })
  await pointer(empty, 'onPointermove', { clientX: 410 }, 20)
  await pointer(empty, 'onPointerup', { clientX: 410, buttons: 0 }, 150)
  empty.clock.settle()
  await nextTick()
  const create = empty.button('创建新模特')
  const click = _pointerEvent(empty.clock, create, { detail: 1 })
  _dispatchClick(create, click)
  await nextTick()
  assert.equal(click.defaultPrevented, true)
  assert.equal(empty.button('生成新模特'), undefined)
  empty.app.unmount()
  const h = await mountLibrary({ myItems: wheelItems })
  h.button('多选').props.onClick()
  await nextTick()
  h.button('选择温暖妈妈').props.onClick()
  await nextTick()
  await pointer(h, 'onPointerdown', { clientX: 490 })
  await pointer(h, 'onPointermove', { clientX: 410 }, 20)
  await pointer(h, 'onPointerup', { clientX: 410, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  const selected = h.button('取消选择温暖妈妈')
  _dispatchClick(selected, _pointerEvent(h.clock, selected, { detail: 1 }))
  await nextTick()
  assert.match(textContent(h.root), /已选 1 个模特/)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('real character portraits remain still across pointer positions, including both neighboring cards', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const visiblePortraits = withClass(h.root, 'cv3-character-portrait-content')
  assert.equal(visiblePortraits.length, 5)
  for (const entry of visiblePortraits) {
    assert.equal(entry.props.style, undefined)
    assert.doesNotMatch(entry.props.class, /is-create-look/)
  }
  for (const point of [
    { clientX: 10, clientY: 20 },
    { clientX: 490, clientY: 215 },
    { clientX: 900, clientY: 400 },
  ]) {
    await pointer(h, 'onPointermove', { ...point, buttons: 0 })
    h.clock.frame()
    await nextTick()
    for (const entry of withClass(h.root, 'cv3-character-portrait-content')) {
      assert.equal(entry.props.style, undefined)
      assert.doesNotMatch(entry.props.class, /is-create-look/)
    }
    assert.equal(h.clock.frames.size, 0, 'hovering real portraits must not schedule look animation')
    assert.equal(portraitOffset(h.root, '温暖妈妈'), 0)
  }
  const assets = h.button('查看模特资产')
  assert.ok(assets, 'the normal asset overlay remains available')
  assets.props.onClick()
  assert.equal(h.events[0][0], 'inspect')
  assert.equal(h.events[0][1].id, 'a')
  h.app.unmount()
})

test('only the active creation mannequin has bounded frame-driven hover parallax and a smooth neutral return', async () => {
  const h = await mountLibrary({ myItems: [], officialItems: wheelItems })
  await pointer(h, 'onPointermove', { clientX: 900, clientY: 40, buttons: 0 })
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x']), 0)
  h.clock.frame()
  await nextTick()
  const x = parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x'])
  const y = parseFloat(lookStyle(h.root, '创建新模特')['--character-look-y'])
  assert.ok(x > 0 && x <= 4)
  assert.ok(y < 0 && y >= -3)
  assert.equal(lookStyle(h.root, '温暖妈妈'), undefined)
  assert.equal(lookStyle(h.root, '长者'), undefined)
  assert.equal(portraitOffset(h.root, '创建新模特'), 0, 'hover must not change carousel position')
  const stage = withClass(h.root, 'cv3-character-carousel-stage')[0]
  stage.props.onPointerleave()
  h.clock.settle()
  await nextTick()
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x']), 0)
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-y']), 0)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('leaving the creation mannequin clears look immediately and returning never inherits its old tilt', async () => {
  const h = await mountLibrary({ myItems: [], officialItems: wheelItems })
  await pointer(h, 'onPointermove', { clientX: 900, clientY: 40, buttons: 0 })
  h.clock.frame()
  await nextTick()
  assert.ok(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x']) > 0)
  h.button('下一个模特').props.onClick()
  await nextTick()
  assert.equal(lookStyle(h.root, '创建新模特'), undefined)
  assert.equal(lookStyle(h.root, '温暖妈妈'), undefined)
  h.clock.settle()
  await nextTick()
  await pointer(h, 'onPointermove', { clientX: 40, clientY: 400, buttons: 0 })
  assert.equal(h.clock.frames.size, 0)
  h.button('上一个模特').props.onClick()
  await nextTick()
  for (const value of Object.values(lookStyle(h.root, '创建新模特')))
    assert.equal(parseFloat(value) || 0, 0)
  h.clock.settle()
  await nextTick()
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x']), 0)
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-y']), 0)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('reduced motion suppresses hover animation but preserves direct dragging and immediate release', async () => {
  const h = await mountLibrary({ myItems: wheelItems }, { reducedMotion: true })
  await pointer(h, 'onPointermove', { clientX: 900, clientY: 40, buttons: 0 })
  assert.equal(h.clock.frames.size, 0)
  assert.equal(lookStyle(h.root, '温暖妈妈'), undefined)
  await pointer(h, 'onPointerdown', { clientX: 610 })
  await pointer(h, 'onPointermove', { clientX: 487.5 }, 20)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), -0.5)
  await pointer(h, 'onPointerup', { clientX: 487.5, buttons: 0 }, 150)
  assert.equal(slider(h.root).props.value, 2)
  assert.equal(portraitOffset(h.root, '长者'), 0)
  assert.equal(h.clock.frames.size, 0)
  h.app.unmount()
})

test('reduced motion keeps the active creation mannequin still as well', async () => {
  const h = await mountLibrary({ myItems: [], officialItems: wheelItems }, { reducedMotion: true })
  await pointer(h, 'onPointermove', { clientX: 900, clientY: 40, buttons: 0 })
  assert.equal(h.clock.frames.size, 0)
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-x']), 0)
  assert.equal(parseFloat(lookStyle(h.root, '创建新模特')['--character-look-y']), 0)
  h.app.unmount()
})

test('reversing a held drag tracks the same grab offset immediately and wheel cannot steal the active pointer', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { clientX: 490 })
  await pointer(h, 'onPointermove', { clientX: 367.5 }, 30)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), -0.5)
  const ignoredWheel = await wheel(h, 120)
  assert.equal(ignoredWheel.defaultPrevented, false)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), -0.5)
  await pointer(h, 'onPointermove', { clientX: 441 }, 30)
  assert.ok(Math.abs(portraitOffset(h.root, '温暖妈妈') + 0.2) < 1e-12)
  await pointer(h, 'onPointerup', { clientX: 441, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 1)
  assert.equal(portraitOffset(h.root, '温暖妈妈'), 0)
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('switching views releases a captured pointer and stale pointer events cannot move the grid selection', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  await pointer(h, 'onPointerdown', { clientX: 490 })
  const { stage } = await pointer(h, 'onPointermove', { clientX: 410 }, 20)
  assert.equal(stage.hasPointerCapture(1), true)
  h.button('宫格模式').props.onClick()
  await nextTick()
  assert.equal(stage.capturedPointers.size, 0)
  stage.props.onPointerup(_pointerEvent(h.clock, stage, { clientX: -900, buttons: 0 }))
  await nextTick()
  assert.equal(h.events.length, 0)
  assert.equal(withClass(h.root, 'cv3-character-grid').length, 1)
  h.button('列表模式').props.onClick()
  await nextTick()
  assert.equal(slider(h.root).props.value, 0)
  assert.equal(portraitOffset(h.root, '创建新模特'), 0)
  h.app.unmount()
})

test('non-primary pointers and right-button presses cannot start a carousel drag', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  for (const details of [
    { isPrimary: false },
    { button: 2 },
    { ctrlKey: true },
    { metaKey: true },
  ]) {
    await pointer(h, 'onPointerdown', { clientX: 490, ...details })
    const { stage } = await pointer(h, 'onPointermove', { clientX: 100 }, 20)
    await pointer(h, 'onPointerup', { clientX: 100, buttons: 0 }, 20)
    assert.equal(stage.capturedPointers.size, 0)
    assert.equal(slider(h.root).props.value, 1)
    assert.equal(portraitOffset(h.root, '温暖妈妈'), 0)
  }
  assert.equal(h.events.length, 0)
  h.app.unmount()
})

test('existing personal characters retain a reachable creation wireframe and dragging out never invokes its creation menu', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  assert.equal(slider(h.root).props['aria-valuetext'], '2 / 7 温暖妈妈')
  const carousel = withClass(h.root, 'cv3-character-carousel')[0]
  carousel.props.onKeydown({ key: 'Home', preventDefault() {} })
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props.value, 0)
  assert.equal(slider(h.root).props['aria-valuetext'], '1 / 7 创建新模特')
  const createPortrait = h.button('创建新模特')
  assert.equal(
    findAll(createPortrait, (entry) => entry.props['data-test-character-wireframe'] === true)
      .length,
    1,
  )
  const footerCreate = withClass(h.root, 'cv3-character-create-button')[0]
  footerCreate.props.onClick()
  await nextTick()
  assert.ok(h.button('生成新模特'))
  assert.ok(h.button('导入已有模特'))
  footerCreate.props.onClick()
  await nextTick()
  slider(h.root).props.onInput({ target: { value: 1 } })
  await nextTick()
  findAll(
    h.root,
    (entry) => entry.props.role === 'tab' && textContent(entry).trim() === '我的模特库',
  )[0].props.onClick()
  await nextTick()
  assert.equal(
    slider(h.root).props.value,
    0,
    'the explicit personal-library anchor also returns to creation',
  )
  await pointer(h, 'onPointerdown', { clientX: 490, target: createPortrait })
  await pointer(h, 'onPointermove', { clientX: 245 }, 40)
  await pointer(h, 'onPointerup', { clientX: 245, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props['aria-valuetext'], '2 / 7 温暖妈妈')
  const syntheticClick = _pointerEvent(h.clock, createPortrait, { detail: 1 })
  _dispatchClick(createPortrait, syntheticClick)
  await nextTick()
  assert.equal(syntheticClick.defaultPrevented, true)
  assert.equal(h.button('生成新模特'), undefined)
  assert.equal(h.events.length, 0)
  footerCreate.props.onClick()
  await nextTick()
  h.button('导入已有模特').props.onClick()
  assert.deepEqual(h.events, [['create', 'import']])
  h.app.unmount()
})

test('the centered assets button supports horizontal dragging without inspection while a normal tap still inspects the active character', async () => {
  const h = await mountLibrary({ myItems: wheelItems })
  const initialAssets = h.button('查看模特资产')
  const { stage } = await pointer(h, 'onPointerdown', { target: initialAssets, clientX: 490 })
  assert.equal(
    stage.capturedPointers.size,
    0,
    'an ordinary press on the assets button must remain clickable',
  )
  await pointer(h, 'onPointermove', { target: initialAssets, clientX: 245 }, 40)
  assert.equal(stage.hasPointerCapture(1), true)
  await pointer(h, 'onPointerup', { clientX: 245, buttons: 0 }, 150)
  h.clock.settle()
  await nextTick()
  assert.equal(slider(h.root).props['aria-valuetext'], '3 / 7 长者')
  assert.equal(stage.capturedPointers.size, 0)
  const currentAssets = h.button('查看模特资产')
  const dragClick = _pointerEvent(h.clock, currentAssets, { detail: 1 })
  _dispatchClick(currentAssets, dragClick)
  assert.equal(dragClick.defaultPrevented, true)
  assert.equal(
    h.events.length,
    0,
    'releasing an assets-button drag cannot inspect either character',
  )
  await pointer(h, 'onPointerdown', { target: currentAssets, clientX: 490 })
  await pointer(h, 'onPointerup', { target: currentAssets, clientX: 490, buttons: 0 }, 20)
  const tap = _pointerEvent(h.clock, currentAssets, { detail: 1 })
  _dispatchClick(currentAssets, tap)
  assert.equal(tap.defaultPrevented, false)
  assert.deepEqual(
    h.events.map(([name, item]) => [name, item.id]),
    [['inspect', 'b']],
  )
  assert.equal(stage.capturedPointers.size, 0)
  h.app.unmount()
})

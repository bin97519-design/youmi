import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'
import {
  GENERATION_DOT_FPS,
  GENERATION_DOT_OFFSET,
  GENERATION_DOT_RADIUS,
  GENERATION_DOT_STEP,
  generationDotOpacity,
  generationDotSeed,
} from '../src/features/canvas-v3/config/generationPixelField.js'

const filename = new URL(
  '../src/features/canvas-v3/components/GenerationPixelField.vue',
  import.meta.url,
)
const source = await readFile(filename, 'utf8')
const { descriptor, errors } = parse(source, { filename: filename.pathname })
assert.deepEqual(errors, [])
const compiled = compileScript(descriptor, {
  id: 'generation-pixel-field-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content
  .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
  .replace(
    /from (["'])\.\.\/config\/generationPixelField\.js\1/g,
    `from '${new URL('../src/features/canvas-v3/config/generationPixelField.js', import.meta.url)}'`,
  )
const PixelField = (
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
    dispatch(name) {
      for (const callback of listeners.get(name) || []) callback()
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0)
    },
  }
}

function mount(
  t,
  { reducedMotion = false, canvasAvailable = true, intersections = true, legacyMedia = false } = {},
) {
  const frames = new Map()
  const resizeObservers = []
  const intersectionObservers = []
  let frameId = 0
  const document = { ...eventTarget(), hidden: false }
  const media = { ...eventTarget(), matches: reducedMotion }
  if (legacyMedia) {
    media.addListener = (callback) => media.listeners.set('change', new Set([callback]))
    media.removeListener = (callback) => media.listeners.get('change')?.delete(callback)
    delete media.addEventListener
    delete media.removeEventListener
  }
  const view = {
    ...eventTarget(),
    devicePixelRatio: 2,
    matchMedia: () => media,
    requestAnimationFrame(callback) {
      const id = ++frameId
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        resizeObservers.push(this)
      }
      observe(target) {
        this.target = target
      }
      disconnect() {
        this.disconnected = true
      }
      fire(width, height) {
        this.callback([{ target: this.target, contentRect: { width, height } }])
      }
    },
  }
  if (intersections)
    view.IntersectionObserver = class {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        intersectionObservers.push(this)
      }
      observe(target) {
        this.target = target
      }
      disconnect() {
        this.disconnected = true
      }
      fire(isIntersecting) {
        this.callback([{ target: this.target, isIntersecting }])
      }
    }
  const previous = new Map()
  for (const [name, value] of Object.entries({ window: view, document })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const context = {
    paints: 0,
    dots: [],
    currentCircle: null,
    transforms: [],
    clearRect() {
      this.paints++
      this.dots = []
    },
    fillRect() {
      assert.fail('the reference field must never paint filled rectangular tiles')
    },
    beginPath() {
      this.currentCircle = null
    },
    arc(...circle) {
      this.currentCircle = circle
    },
    fill() {
      this.dots.push({ circle: this.currentCircle, color: this.fillStyle })
    },
    setTransform(...transform) {
      this.transforms.push(transform)
    },
  }
  const node = (type, text = '') => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    clientWidth: 180,
    clientHeight: 90,
    ...(type === 'canvas' ? { getContext: () => (canvasAvailable ? context : null) } : {}),
  })
  const detach = (target) => {
    if (!target.parent) return
    const siblings = target.parent.children
    const index = siblings.indexOf(target)
    if (index >= 0) siblings.splice(index, 1)
    target.parent = null
  }
  const renderer = createRenderer({
    createElement: node,
    createText: (text) => node('#text', text),
    createComment: (text) => node('#comment', text),
    setText: (target, text) => (target.text = text),
    setElementText(target, text) {
      target.text = text
      target.children = []
    },
    patchProp: (target, key, _previous, value) => (target.props[key] = value),
    parentNode: (target) => target.parent,
    nextSibling: (target) =>
      target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
    insert(child, parent, anchor = null) {
      detach(child)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
      child.parent = parent
    },
    remove: detach,
  })
  const root = node('root')
  const props = reactive({ seed: 'node-demo' })
  const app = renderer.createApp({ setup: () => () => h(PixelField, props) })
  app.mount(root)
  let unmounted = false
  const unmount = () => {
    if (unmounted) return
    app.unmount()
    unmounted = true
  }
  t.after(() => {
    unmount()
    for (const [name, property] of previous) {
      if (property) Object.defineProperty(globalThis, name, property)
      else delete globalThis[name]
    }
  })
  return {
    root,
    field: root.children[0],
    canvas: root.children[0].children[0],
    context,
    frames,
    props,
    document,
    view,
    media,
    resize: resizeObservers[0],
    intersection: intersectionObservers[0],
    unmount,
    tick(timestamp) {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(timestamp)
    },
  }
}

test('the reference uses tiny dots on a fixed 12px grid and only smooth seeded opacity changes', () => {
  assert.equal(GENERATION_DOT_STEP, 12)
  assert.equal(GENERATION_DOT_RADIUS, 0.7)
  assert.equal(GENERATION_DOT_OFFSET, 10.5)
  assert.equal(GENERATION_DOT_FPS, 15)
  const seed = generationDotSeed('node-1')
  assert.equal(seed, generationDotSeed('node-1'))
  assert.notEqual(seed, generationDotSeed('node-2'))
  let differences = 0
  let active = 0
  for (let row = 0; row < 40; row++) {
    for (let column = 0; column < 40; column++) {
      const x = column / 40
      const y = row / 40
      const opacity = generationDotOpacity(seed, x, y, 400)
      assert.equal(opacity, generationDotOpacity(seed, x, y, 400))
      assert.ok(opacity >= 0 && opacity <= 0.612)
      assert.ok(Math.abs(opacity - generationDotOpacity(seed, x, y, 466)) < 0.012)
      if (Math.abs(opacity - generationDotOpacity(seed, x, y, 3200)) > 0.01) differences++
      if (opacity > 0.006) active++
      if (x < 0.25) assert.equal(opacity, 0, 'the left quarter is quiet, not a full-face grid')
    }
  }
  assert.ok(active > 1600 * 0.25 && active < 1600 * 0.55, 'clusters must leave broad blank space')
  assert.ok(differences > 150, 'local dot density should visibly evolve without flicker')
  assert.ok(generationDotOpacity(seed, 0.7, 0.19, 400) > 0.2)
  assert.ok(generationDotOpacity(seed, 0.5, 0.67, 400) > 0.25)
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [0.9, 0.9],
    [-1, 0.5],
    [NaN, 0.5],
  ]) {
    assert.equal(generationDotOpacity(seed, x, y, 400), 0)
  }
})

test('the real SFC has one decorative canvas, no controls, images or fabricated progress', (t) => {
  const mounted = mount(t)
  assert.equal(mounted.field.props['aria-hidden'], 'true')
  assert.equal(mounted.field.children.length, 1)
  assert.equal(mounted.canvas.type, 'canvas')
  assert.equal(mounted.field.props.role, undefined)
  assert.equal(mounted.field.props.tabindex, undefined)
  assert.equal(mounted.canvas.props.tabindex, undefined)
  assert.ok(contextStyles().includes('pointer-events: none'))
  assert.doesNotMatch(descriptor.template.content, /<(?:img|span|button)|progress|aria-valuenow|%/)
  assert.ok(mounted.context.dots.length > 0 && mounted.context.dots.length < 14 * 7 * 0.6)
  for (const { circle, color } of mounted.context.dots) {
    const [x, y, radius, start, end] = circle
    assert.equal((x - GENERATION_DOT_OFFSET) % GENERATION_DOT_STEP, 0)
    assert.equal((y - GENERATION_DOT_OFFSET) % GENERATION_DOT_STEP, 0)
    assert.equal(radius, 0.7)
    assert.equal(start, 0)
    assert.equal(end, Math.PI * 2)
    assert.match(color, /^rgba\(174, 180, 188, 0\.\d+\)$/)
  }
  assert.match(contextStyles(), /background:\s*var\(--cv3-generation-surface,\s*#242527\)/)
  assert.doesNotMatch(contextStyles(), /gradient|background-image|background-size/)
  assert.doesNotMatch(source, /fillRect\(/)
})

function contextStyles() {
  return descriptor.styles.map((style) => style.content).join('\n')
}

test('offscreen and hidden fields stop RAF; visible painting is limited to 15 frames per second', (t) => {
  const mounted = mount(t)
  assert.equal(
    mounted.frames.size,
    0,
    'wait for visibility observation instead of animating offscreen',
  )
  mounted.intersection.fire(true)
  assert.equal(mounted.frames.size, 1)
  const initial = mounted.context.paints
  for (const time of [0, 16, 32, 48, 64]) mounted.tick(time)
  assert.equal(mounted.context.paints, initial + 1)
  mounted.tick(80)
  assert.equal(mounted.context.paints, initial + 2)
  mounted.intersection.fire(false)
  assert.equal(mounted.frames.size, 0)
  mounted.tick(2000)
  assert.equal(mounted.context.paints, initial + 2)
  mounted.intersection.fire(true)
  assert.equal(mounted.frames.size, 1)
  mounted.document.hidden = true
  mounted.document.dispatch('visibilitychange')
  assert.equal(mounted.frames.size, 0)
  mounted.document.hidden = false
  mounted.document.dispatch('visibilitychange')
  assert.equal(mounted.frames.size, 1)
})

test('successive frames over four seconds visibly redistribute local opacity without moving grid positions', (t) => {
  const mounted = mount(t)
  mounted.resize.fire(178, 178)
  mounted.intersection.fire(true)
  mounted.tick(0)
  const opacities = () =>
    new Map(
      mounted.context.dots.map(({ circle, color }) => [
        `${circle[0]},${circle[1]}`,
        Number(color.match(/, (0\.\d+)\)$/)[1]),
      ]),
    )
  const initial = opacities()
  for (let time = 70; time <= 4200; time += 70) mounted.tick(time)
  const later = opacities()
  let visiblyChanged = 0
  let strongestChange = 0
  for (const [position, opacity] of initial) {
    const difference = Math.abs(opacity - (later.get(position) || 0))
    if (difference > 0.025) visiblyChanged++
    strongestChange = Math.max(strongestChange, difference)
  }
  assert.ok(
    visiblyChanged >= 15,
    'local groups must visibly change, not just retain a static dot mask',
  )
  assert.ok(strongestChange >= 0.12, 'the local handoff should be readable within 3–5 seconds')
  for (const { circle } of mounted.context.dots) {
    assert.equal((circle[0] - GENERATION_DOT_OFFSET) % GENERATION_DOT_STEP, 0)
    assert.equal((circle[1] - GENERATION_DOT_OFFSET) % GENERATION_DOT_STEP, 0)
    assert.equal(circle[2], GENERATION_DOT_RADIUS)
  }
})

test('reduced motion is static, reacts live and cleans up legacy media listeners', async (t) => {
  const mounted = mount(t, { reducedMotion: true, legacyMedia: true })
  mounted.intersection.fire(true)
  assert.equal(mounted.frames.size, 0)
  const staticDots = structuredClone(mounted.context.dots)
  mounted.tick(3000)
  assert.deepEqual(mounted.context.dots, staticDots)
  mounted.props.seed = 'different-node'
  await nextTick()
  assert.notDeepEqual(mounted.context.dots, staticDots)
  assert.equal(mounted.frames.size, 0)
  mounted.media.matches = false
  mounted.media.dispatch('change')
  assert.equal(mounted.frames.size, 1)
  mounted.media.matches = true
  mounted.media.dispatch('change')
  assert.equal(mounted.frames.size, 0)
  mounted.unmount()
  assert.equal(mounted.media.listenerCount(), 0)
})

test('resizing adapts the backing store, pauses at zero size and releases observers and listeners', (t) => {
  const mounted = mount(t)
  mounted.intersection.fire(true)
  mounted.resize.fire(320, 160)
  assert.equal(mounted.canvas.width, 480)
  assert.equal(mounted.canvas.height, 240)
  assert.deepEqual(mounted.context.transforms.at(-1), [1.5, 0, 0, 1.5, 0, 0])
  mounted.resize.fire(0, 0)
  assert.equal(mounted.canvas.width, 0)
  assert.equal(mounted.frames.size, 0)
  mounted.resize.fire(180, 90)
  assert.equal(mounted.frames.size, 1)
  mounted.unmount()
  assert.equal(mounted.frames.size, 0)
  assert.equal(mounted.resize.disconnected, true)
  assert.equal(mounted.intersection.disconnected, true)
  assert.equal(mounted.document.listenerCount(), 0)
  assert.equal(mounted.view.listenerCount(), 0)
  assert.equal(mounted.media.listenerCount(), 0)
  const previousPaints = mounted.context.paints
  mounted.resize.fire(200, 200)
  mounted.intersection.fire(true)
  mounted.tick(4000)
  assert.equal(mounted.frames.size, 0)
  assert.equal(mounted.context.paints, previousPaints)
})

test('missing Canvas 2D or visibility observers safely keeps the static fallback', (t) => {
  const mounted = mount(t, { canvasAvailable: false, intersections: false })
  assert.equal(mounted.frames.size, 0)
  assert.equal(mounted.context.paints, 0)
  assert.match(contextStyles(), /background:\s*var\(--cv3-generation-surface,\s*#242527\)/)
})

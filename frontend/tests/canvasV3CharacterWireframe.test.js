import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

const filename = new URL(
  '../src/features/canvas-v3/components/CharacterStudioWireframe.vue',
  import.meta.url,
)
const source = await readFile(filename, 'utf8')
const parsed = parse(source, { filename: filename.pathname })
assert.deepEqual(parsed.errors, [], 'the production wireframe SFC must parse')
const { descriptor } = parsed
const compiled = compileScript(descriptor, {
  id: 'character-wireframe-regression-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const moduleSource = compiled.content.replace(
  /from (["'])vue\1/g,
  `from '${import.meta.resolve('vue')}'`,
)
const Wireframe = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function node(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
}

function detach(child) {
  if (!child.parent) return
  const siblings = child.parent.children
  const index = siblings.indexOf(child)
  if (index >= 0) siblings.splice(index, 1)
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
})

function all(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => all(child, predicate)),
  ]
}

function mount(t, count = 1) {
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(
        'div',
        Array.from({ length: count }, (_, index) => h(Wireframe, { key: index })),
      ),
  })
  app.mount(root)
  t.after(() => app.unmount())
  return { root, svgs: all(root, (entry) => entry.type === 'svg') }
}

const hasClass = (entry, className) =>
  typeof entry.props.class === 'string' && entry.props.class.split(/\s+/).includes(className)
const paths = (target) => all(target, (entry) => entry.type === 'path')
const firstPoint = (path) => {
  const match = path.match(/^M\s*([-+\d.eE]+)[\s,]+([-+\d.eE]+)/)
  assert.ok(match, 'a mesh ring starts with a valid move command')
  return [Number(match[1]), Number(match[2])]
}

function assertValidPath(path) {
  assert.equal(typeof path, 'string')
  assert.ok(path.trim(), 'SVG path data cannot be empty')
  assert.doesNotMatch(path, /NaN|Infinity|undefined|null/i)
  assert.match(path, /^\s*[Mm]/, 'each path starts with a move command')
  const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g
  const residue = path.replace(numberPattern, '').replace(/[MmLlHhVvCcSsQqTtAaZz\s,]/g, '')
  assert.equal(residue, '', `unexpected SVG path tokens: ${residue}`)
  const arity = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  for (const [, command, coordinates] of path.matchAll(
    /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g,
  )) {
    const values = [...coordinates.matchAll(numberPattern)].map(([value]) => Number(value))
    assert.ok(values.every(Number.isFinite), `${command} coordinates must be finite`)
    const expected = arity[command.toUpperCase()]
    if (!expected) assert.equal(values.length, 0, 'close-path has no coordinates')
    else {
      assert.ok(values.length >= expected, `${command} must have complete coordinates`)
      assert.equal(values.length % expected, 0, `${command} coordinate count must be valid`)
    }
  }
}

test('the real SFC mounts a decorative noninteractive portrait SVG without changing its viewport', (t) => {
  const { svgs } = mount(t)
  assert.equal(svgs.length, 1)
  assert.equal(svgs[0].props.viewBox, '0 0 180 430')
  assert.equal(svgs[0].props.preserveAspectRatio, 'xMidYMid meet')
  assert.equal(svgs[0].props['aria-hidden'], 'true')
  assert.equal(svgs[0].props.focusable, 'false')
  assert.equal(svgs[0].props.tabindex, undefined)
  assert.equal(
    all(svgs[0], (entry) => Object.keys(entry.props).some((key) => /^on[A-Z]/.test(key))).length,
    0,
  )
  assert.ok(descriptor.styles.some((style) => /pointer-events:\s*none/.test(style.content)))
})

test('six anatomical mesh sections each render independent rings and curved meridians', (t) => {
  const { svgs } = mount(t)
  const sections = all(svgs[0], (entry) => Boolean(entry.props['data-mesh-section']))
  assert.deepEqual(sections.map((entry) => entry.props['data-mesh-section']).sort(), [
    'head',
    'left-arm',
    'left-leg',
    'right-arm',
    'right-leg',
    'torso',
  ])
  for (const section of sections) {
    const rings = all(section, (entry) => hasClass(entry, 'cv3-character-wireframe-rings'))
    const meridians = all(section, (entry) => hasClass(entry, 'cv3-character-wireframe-meridians'))
    assert.equal(rings.length, 1)
    assert.equal(meridians.length, 1)
    assert.ok(
      paths(rings[0]).length >= 4,
      `${section.props['data-mesh-section']} needs its own rings`,
    )
    assert.ok(
      paths(meridians[0]).length >= 3,
      `${section.props['data-mesh-section']} needs its own meridians`,
    )
    assert.ok(paths(rings[0]).every((entry) => /[CcQq]/.test(entry.props.d)))
    assert.ok(paths(meridians[0]).every((entry) => /[CcQq]/.test(entry.props.d)))
  }
})

test('all mounted outline, surface and mesh paths contain valid finite SVG geometry', (t) => {
  const { svgs } = mount(t)
  const renderedPaths = paths(svgs[0])
  assert.ok(renderedPaths.length > 50, 'the complete curved mesh must actually render')
  for (const entry of renderedPaths) assertValidPath(entry.props.d)
})

test('leg-root rings do not double up the torso seam at y252', (t) => {
  const { svgs } = mount(t)
  for (const name of ['left-leg', 'right-leg']) {
    const section = all(svgs[0], (entry) => entry.props['data-mesh-section'] === name)[0]
    const rings = all(section, (entry) => hasClass(entry, 'cv3-character-wireframe-rings'))[0]
    const ringPoints = paths(rings).map((entry) => firstPoint(entry.props.d))
    assert.equal(ringPoints[0][1], 262, `${name} first ring starts below the torso seam`)
    assert.ok(
      ringPoints.every(([, y]) => y !== 252),
      `${name} cannot duplicate the torso root ring`,
    )
    assert.equal(new Set(ringPoints.map(([, y]) => y)).size, ringPoints.length)
  }
})

test('multiple instances have unique defs and reference only their own clips and gradients', (t) => {
  const { svgs } = mount(t, 3)
  assert.equal(svgs.length, 3)
  const globalIds = new Set()
  for (const svg of svgs) {
    const definitions = all(svg, (entry) => Boolean(entry.props.id))
    const ids = new Set(definitions.map((entry) => entry.props.id))
    assert.equal(ids.size, definitions.length, 'one SVG cannot repeat a definition ID')
    assert.ok(all(svg, (entry) => entry.type === 'clipPath').length >= 1)
    assert.ok(all(svg, (entry) => /Gradient$/.test(entry.type)).length >= 2)
    for (const id of ids) {
      assert.ok(!globalIds.has(id), `definition ID ${id} must be unique across mounted instances`)
      globalIds.add(id)
    }
    let referenceCount = 0
    for (const entry of all(svg, () => true)) {
      for (const value of Object.values(entry.props)) {
        if (typeof value !== 'string') continue
        for (const [, id] of value.matchAll(/url\(#([^)]*)\)/g)) {
          referenceCount += 1
          assert.ok(ids.has(id), `SVG reference ${id} must resolve inside its own instance`)
        }
      }
    }
    assert.ok(referenceCount >= 3, 'fills and clipping must resolve to real definitions')
  }
})

test('the mannequin stays local vector geometry with no remote imagery, API calls or timers', (t) => {
  const { svgs } = mount(t)
  assert.doesNotMatch(
    source,
    /<image\b|<foreignObject\b|\bfetch\s*\(|\bXMLHttpRequest\b|\baxios\b|\bWebSocket\b/,
  )
  assert.doesNotMatch(source, /\bsetTimeout\s*\(|\bsetInterval\s*\(|\brequestAnimationFrame\s*\(/)
  assert.equal(
    all(svgs[0], (entry) => ['img', 'image', 'video', 'foreignObject'].includes(entry.type)).length,
    0,
  )
  for (const entry of all(svgs[0], () => true)) {
    for (const [key, value] of Object.entries(entry.props)) {
      if (['href', 'xlink:href', 'src'].includes(key)) {
        assert.ok(
          typeof value === 'string' && value.startsWith('#'),
          'only local vector references are allowed',
        )
      }
    }
  }
})

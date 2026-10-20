import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, reactive } from 'vue'
import {
  IMAGE_TASK_ACTIVE_STATES,
  imageTaskFeedback,
} from '../src/features/canvas-v3/config/imageTaskState.js'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/GeneratorNode.vue',
  import.meta.url,
)
const source = await readFile(componentUrl, 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, {
  id: 'generation-node-feedback-test',
  inlineTemplate: true,
  templateOptions: { compilerOptions: { hoistStatic: false } },
})
const registryKey = 'canvasV3GenerationNodeFeedbackTest'
const vueUrl = import.meta.resolve('vue')
const configUrl = (name) =>
  new URL(`../src/features/canvas-v3/config/${name}.js`, import.meta.url).href
const moduleSource = `import { h as testH } from '${vueUrl}'\n${compiled.content}`
  .replace(/from (["'])vue\1/g, `from '${vueUrl}'`)
  .replace(
    /import \{ Handle, Position \} from ['"]@vue-flow\/core['"]/,
    `const Position = { Left: 'left', Right: 'right' }
const Handle = { setup: (_, { slots }) => () => testH('div', { 'data-handle': true }, slots.default?.()) }`,
  )
  .replace(
    /import \{ useCanvasV3GraphStore \} from ['"]\.\.\/stores\/graph['"]/,
    `const useCanvasV3GraphStore = () => globalThis[Symbol.for('${registryKey}')].graph`,
  )
  .replace(
    /import \{ useCanvasV3TaskStore \} from ['"]\.\.\/stores\/tasks['"]/,
    `const useCanvasV3TaskStore = () => globalThis[Symbol.for('${registryKey}')].tasks`,
  )
  .replace(
    /import \{ nodeSpec \} from ['"]\.\.\/config\/nodeSpecs['"]/,
    `const nodeSpec = () => ({ promptPlaceholder: 'test prompt', quickStarts: [] })`,
  )
  .replace(
    /import \{ nodeSize \} from ['"]\.\.\/config\/nodeControls['"]/,
    'const nodeSize = () => ({ width: 320, height: 200 })',
  )
  .replace(
    /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
    'const CanvasIcon = { render: () => null }',
  )
  .replace(
    /import GenerationPixelField from ['"]\.\/GenerationPixelField\.vue['"]/,
    `const GenerationPixelField = {
  props: ['seed'],
  setup: (props) => () => testH('div', {
    'data-pixel-field': true,
    'data-seed': props.seed,
    'aria-hidden': 'true',
  }),
}`,
  )
  .replace(/from (['"])\.\.\/config\/imageTaskState\1/g, `from '${configUrl('imageTaskState')}'`)
  .replace(/from (['"])\.\.\/config\/magneticHandle\1/g, `from '${configUrl('magneticHandle')}'`)
const Component = (
  await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
).default

function node(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
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
const textContent = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
async function mount(data = {}) {
  const state = reactive({
    id: 'image-node-1',
    data: { kind: 'image', title: '商品主图', runState: 'running', progress: null, ...data },
  })
  const calls = []
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args])
  const registry = {
    graph: {
      edges: [],
      remember: record('remember'),
      updateNodeData: record('updateNodeData'),
      applyQuickStart: record('applyQuickStart'),
    },
    tasks: {
      stopWaiting: record('stopWaiting'),
      resume: record('resume'),
      runImage: record('runImage'),
    },
  }
  globalThis[Symbol.for(registryKey)] = registry
  const root = node('root')
  const app = renderer.createApp({ setup: () => () => h(Component, state) })
  app.mount(root)
  await nextTick()
  return {
    state,
    root,
    calls,
    find: (predicate) => all(root, predicate),
    field: () => all(root, (target) => target.props['data-pixel-field'])[0],
    status: () => all(root, (target) => target.props.role === 'status')[0],
    button: (label) =>
      all(
        root,
        (target) =>
          target.type === 'button' &&
          (target.props['aria-label'] === label || textContent(target).trim() === label),
      )[0],
    dispose() {
      app.unmount()
      if (globalThis[Symbol.for(registryKey)] === registry)
        delete globalThis[Symbol.for(registryKey)]
    },
  }
}
const click = (button) => button.props.onClick({ stopPropagation() {} })

test('every real active image state mounts a decorative field and accurate accessible feedback', async () => {
  assert.deepEqual(IMAGE_TASK_ACTIVE_STATES, ['preparing', 'submitting', 'queued', 'running'])
  for (const runState of IMAGE_TASK_ACTIVE_STATES) {
    const harness = await mount({ runState, generation: { clientTaskId: 'paid-task-identity' } })
    try {
      assert.equal(harness.field().props['aria-hidden'], 'true')
      assert.equal(harness.field().props['data-seed'], 'paid-task-identity')
      const status = harness.status()
      assert.equal(status.props['aria-live'], 'polite')
      assert.match(status.props.class, /is-pixel-feedback/)
      assert.equal(
        textContent(status)
          .replace(/\s*取消\s*$/, '')
          .trim(),
        imageTaskFeedback(harness.state.data),
      )
      assert.doesNotMatch(textContent(status), /\d+%/)
      assert.equal(harness.find((entry) => entry.type === 'article')[0].props['aria-busy'], true)
      assert.ok(harness.button('取消等待'))
      assert.deepEqual(harness.calls, [])
    } finally {
      harness.dispose()
    }
  }
})

test('progress comes only from the task, including zero, and preparation preserves real status text', async () => {
  const harness = await mount()
  try {
    assert.equal(harness.field().props['data-seed'], 'image-node-1')
    for (const progress of [0, 37, 100]) {
      harness.state.data.progress = progress
      await nextTick()
      assert.equal(
        textContent(harness.status())
          .replace(/\s*取消\s*$/, '')
          .trim(),
        `生成中 ${progress}%...`,
      )
    }
    harness.state.data.progress = null
    await nextTick()
    assert.doesNotMatch(textContent(harness.status()), /%/)
    harness.state.data.runState = 'preparing'
    harness.state.data.statusText = '正在上传原始商品图…'
    await nextTick()
    assert.match(textContent(harness.status()), /正在上传原始商品图…/)
    assert.deepEqual(harness.calls, [])
  } finally {
    harness.dispose()
  }
})

test('non-image media keeps its original status presentation without mounting an image pixel field', async () => {
  for (const kind of ['video', 'audio', 'script', 'smartEdit']) {
    const harness = await mount({ kind })
    try {
      assert.equal(harness.field(), undefined)
      assert.ok(harness.status())
      assert.doesNotMatch(harness.status().props.class, /is-pixel-feedback/)
      assert.match(textContent(harness.status()), /生成中…/)
      assert.ok(harness.button('取消等待'))
      assert.deepEqual(harness.calls, [])
    } finally {
      harness.dispose()
    }
  }
})

test('cancel only stops waiting on the current node and never initiates another paid generation', async () => {
  for (const runState of IMAGE_TASK_ACTIVE_STATES) {
    const harness = await mount({ runState })
    try {
      const button = harness.button('取消等待')
      if (runState === 'preparing') assert.match(button.props.title, /不提交生成任务/)
      else assert.match(button.props.title, /后台任务可能继续执行/)
      click(button)
      assert.deepEqual(harness.calls, [['stopWaiting', 'image-node-1']])
      assert.equal(harness.button('重新生成'), undefined)
    } finally {
      harness.dispose()
    }
  }
})

test('paused and uncertain states remove animation and keep explicit query-only recovery', async () => {
  for (const [runState, label] of [
    ['paused', '已停止等待'],
    ['uncertain', '任务待确认'],
  ]) {
    const harness = await mount({ runState })
    try {
      assert.equal(harness.field(), undefined)
      assert.equal(harness.status(), undefined)
      assert.match(textContent(harness.root), new RegExp(label))
      assert.equal(harness.button('取消等待'), undefined)
      assert.equal(harness.button('重新生成'), undefined)
      click(harness.button('继续查询'))
      assert.deepEqual(harness.calls, [['resume', 'image-node-1']])
    } finally {
      harness.dispose()
    }
  }
})

test('failed image state shows its actual error and does not regenerate until retry is clicked', async () => {
  const harness = await mount({ runState: 'failed', error: '生成服务返回测试错误' })
  try {
    assert.equal(harness.field(), undefined)
    assert.equal(harness.status(), undefined)
    assert.match(textContent(harness.root), /生成服务返回测试错误/)
    assert.equal(harness.button('取消等待'), undefined)
    assert.deepEqual(harness.calls, [])
    click(harness.button('重新生成'))
    assert.deepEqual(harness.calls, [['runImage', 'image-node-1']])
  } finally {
    harness.dispose()
  }
})

test('completion reactively removes busy overlay and displays the result without altering task identity', async () => {
  const harness = await mount({
    assetUrl: 'https://assets.example.com/old.png',
    generation: { clientTaskId: 'same-paid-task', results: [] },
  })
  try {
    assert.ok(harness.field())
    assert.equal(harness.find((entry) => entry.type === 'img').length, 0)
    harness.state.data.generation.results = ['https://assets.example.com/old.png']
    await nextTick()
    assert.equal(
      harness.find((entry) => entry.type === 'img')[0].props.src,
      'https://assets.example.com/old.png',
    )
    assert.ok(harness.field())
    harness.state.data.runState = 'completed'
    harness.state.data.assetUrl = 'https://assets.example.com/result.png'
    harness.state.data.progress = 100
    await nextTick()
    assert.equal(harness.field(), undefined)
    assert.equal(harness.status(), undefined)
    assert.equal(
      harness.find((entry) => entry.type === 'img')[0].props.src,
      'https://assets.example.com/result.png',
    )
    assert.equal(harness.find((entry) => entry.type === 'article')[0].props['aria-busy'], false)
    assert.equal(harness.button('取消等待'), undefined)
    assert.equal(harness.button('重新生成'), undefined)
    assert.equal(harness.state.data.generation.clientTaskId, 'same-paid-task')
    assert.deepEqual(harness.calls, [])
  } finally {
    harness.dispose()
  }
})

test('pixel decoration cannot intercept pointer actions and status controls remain above it', async () => {
  const pixelSource = await readFile(new URL('./GenerationPixelField.vue', componentUrl), 'utf8')
  const styles = await readFile(new URL('../canvas-v3.css', componentUrl), 'utf8')
  assert.match(pixelSource, /class="cv3-generation-pixel-field" aria-hidden="true"/)
  assert.match(pixelSource, /\.cv3-generation-pixel-field\s*\{[^}]*pointer-events:\s*none/s)
  assert.match(pixelSource, /\.cv3-generation-pixel-canvas\s*\{[^}]*pointer-events:\s*none/s)
  assert.match(styles, /\.cv3-generation-center\.is-pixel-feedback\s*\{[^}]*z-index:\s*1/s)
  assert.match(styles, /\.cv3-generation-center\.is-pixel-feedback\s*\{[^}]*bottom:\s*12px/s)
  assert.match(styles, /\.cv3-generation-center\.is-pixel-feedback button:focus-visible/)
  assert.doesNotMatch(source, /Math\.random|setInterval|setTimeout/)
})

test('image generation blends into the dark canvas with subtle dots and no heavy status block', async () => {
  const pixelSource = await readFile(new URL('./GenerationPixelField.vue', componentUrl), 'utf8')
  const styles = await readFile(new URL('../canvas-v3.css', componentUrl), 'utf8')
  const imageSurface = styles.match(/\.cv3-media-node\.is-image\.is-generating\s*\{([^}]*)\}/s)?.[1]
  const selectedSurface = styles.match(
    /\.cv3-media-node\.is-image\.is-generating\.selected\s*\{([^}]*)\}/s,
  )?.[1]
  const feedbackSurface = styles.match(
    /\.cv3-generation-center\.is-pixel-feedback\s*\{([^}]*)\}/s,
  )?.[1]
  const pixelSurface = pixelSource.match(/\.cv3-generation-pixel-field\s*\{([^}]*)\}/s)?.[1]
  const cancelHover = styles.match(
    /\.cv3-generation-center\.is-pixel-feedback button:hover\s*\{([^}]*)\}/s,
  )?.[1]
  assert.ok(imageSurface, 'image-only generating surface must match its dot field background')
  assert.match(imageSurface, /--cv3-generation-surface:\s*#242527\s*;/)
  assert.match(imageSurface, /background:\s*var\(--cv3-generation-surface\)\s*;/)
  assert.match(imageSurface, /border-color:\s*#3a3d42\s*;/)
  assert.match(imageSurface, /border-radius:\s*16px\s*;/)
  assert.ok(selectedSurface)
  assert.match(selectedSurface, /border-color:\s*#646970\s*;/)
  assert.ok(pixelSurface)
  assert.match(pixelSurface, /background:\s*var\(--cv3-generation-surface,\s*#242527\)\s*;/)
  assert.doesNotMatch(`${imageSurface}${pixelSource}`, /#f4f4f4|background-image|gradient|fillRect/)
  assert.match(
    pixelSource,
    /context\.fillStyle\s*=\s*`rgba\(174, 180, 188, \$\{opacity\.toFixed\(3\)\}\)`/,
  )
  assert.match(pixelSource, /context\.arc\(x, y, GENERATION_DOT_RADIUS, 0, Math\.PI \* 2\)/)
  assert.ok(feedbackSurface)
  assert.match(feedbackSurface, /background:\s*transparent\s*;/)
  assert.match(feedbackSurface, /border:\s*0\s*;/)
  assert.match(feedbackSurface, /border-radius:\s*0\s*;/)
  assert.match(feedbackSurface, /color:\s*#(?:b0b3b8|a8adb5)\s*;/)
  assert.match(feedbackSurface, /font-size:\s*12px\s*;/)
  assert.doesNotMatch(feedbackSurface, /#f4f4f4|#202020|#3b3b3b|box-shadow|backdrop-filter/)
  assert.ok(cancelHover)
  assert.match(cancelHover, /color:\s*#e0e3e7\s*;/)
  assert.match(cancelHover, /background:\s*#ffffff0[8acd]\s*;/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/DirectorPanel.vue',
  import.meta.url,
)
const cardUrl = new URL('./DirectorClarificationCard.vue', componentUrl)
const executionCardUrl = new URL('./DirectorImageExecutionCard.vue', componentUrl)

async function componentModule(url, childModules = {}) {
  const { descriptor } = parse(await readFile(url, 'utf8'))
  const compiled = compileScript(descriptor, {
    id: `question-composer-${url.pathname.split('/').at(-1)}`,
    inlineTemplate: true,
    templateOptions: { compilerOptions: { hoistStatic: false } },
  })
  const content = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /import \{ uploadFileDirect \} from ['"][^'"]*ossUpload\.js['"]/,
      "const uploadFileDirect = async () => { throw new Error('Unexpected upload in composer test') }",
    )
    .replace(/from (["'])(\.\.[^"']+\.js)\1/g, (_match, _quote, path) => {
      return `from '${new URL(path, url).href}'`
    })
    .replace(/import (\w+) from ['"]\.\/[^'"]+\.vue['"]/g, (_match, name) => {
      if (childModules[name]) return `import ${name} from '${childModules[name]}'`
      return `const ${name} = {
        name: '${name}TestStub',
        inheritAttrs: false,
        props: ['text', 'content'],
        setup: (props) => () => __testH('span', { 'data-test-stub': '${name}' }, props.text || props.content || ''),
      }`
    })
  const source = `import { h as __testH } from '${import.meta.resolve('vue')}'\n${content}`
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

const panelPromise = (async () => {
  const card = await componentModule(cardUrl)
  const executionCard = await componentModule(executionCardUrl)
  return (
    await import(
      await componentModule(componentUrl, {
        DirectorClarificationCard: card,
        DirectorImageExecutionCard: executionCard,
      })
    )
  ).default
})()

function node(type, text = '') {
  const listeners = new Map()
  return markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    tagName: type.toUpperCase(),
    value: '',
    style: {},
    scrollHeight: 800,
    scrollTop: 0,
    clientHeight: 480,
    focusCalls: [],
    focus(options) {
      this.focusCalls.push(options)
      globalThis.document.activeElement = this
    },
    scrollTo({ top }) {
      this.scrollTop = top
    },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback)
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) {
        callback({ target: this, currentTarget: this, ...event })
      }
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
    contains(target) {
      for (let current = target; current; current = current.parent) {
        if (current === this) return true
      }
      return false
    },
    getBoundingClientRect() {
      return { left: 812, right: 1212, top: 236, bottom: 876, width: 400, height: 640 }
    },
    getRootNode: () => ({}),
  })
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
  setText: (target, text) => (target.text = text),
  setElementText: (target, text) => {
    target.text = text
    target.children = []
  },
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
    if (key === 'value') target.value = value
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

function findAll(target, predicate) {
  return [
    ...(predicate(target) ? [target] : []),
    ...target.children.flatMap((child) => findAll(child, predicate)),
  ]
}

function textContent(target) {
  return `${target.type === '#comment' ? '' : target.text}${target.children.map(textContent).join('')}`
}

function hasClass(target, name) {
  return String(target.props.class || '')
    .split(/\s+/)
    .includes(name)
}

function installBrowser() {
  const timers = new Map()
  const storage = new Map()
  let nextTimer = 0
  const document = {
    activeElement: null,
    body: { style: {} },
    addEventListener() {},
    removeEventListener() {},
  }
  const window = {
    innerWidth: 1228,
    innerHeight: 892,
    addEventListener() {},
    removeEventListener() {},
    setTimeout(callback) {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id) => timers.delete(id),
  }
  const bindings = {
    window,
    document,
    Document: class {},
    ShadowRoot: class {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  }
  const original = Object.fromEntries(
    Object.keys(bindings).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  )
  for (const [key, value] of Object.entries(bindings)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  }
  return {
    document,
    restore() {
      for (const key of Object.keys(bindings)) {
        if (original[key]) Object.defineProperty(globalThis, key, original[key])
        else delete globalThis[key]
      }
    },
  }
}

function pendingRun(id = 'question-1') {
  return {
    id,
    clientMessageId: `request-${id}`,
    message: { id: `request-${id}`, content: '帮我制作窗帘商品主图', parts: [] },
    reply: '请先选择商品图方向。',
    phase: 'awaiting_input',
    questions: [{ id: 'direction', question: '选择商品图方向', options: ['卧室场景', '白底展示'] }],
    clarificationAnswers: [],
    clarificationReplyRunId: '',
    generationIntent: { referenceAssets: [], attachments: [], imageSourceMode: '' },
    routing: {
      context: 'empty',
      relation: 'standalone',
      turn: 'request',
      task: 'image_generation',
      action: 'clarify',
      stage: 'awaiting_input',
      summary: '选择商品图方向',
    },
  }
}

async function flush() {
  await nextTick()
  await nextTick()
}

async function mountPanel(t, initial = {}) {
  const browser = installBrowser()
  const resources = { app: null }
  t.after(() => {
    resources.app?.unmount()
    browser.restore()
  })
  const Panel = await panelPromise
  const state = reactive({ sessionId: 'canvas-test', agentRuns: [pendingRun()], ...initial })
  const events = []
  const root = node('root')
  resources.app = renderer.createApp({
    setup: () => () =>
      h(Panel, {
        ...state,
        onSubmit: (...args) => events.push({ type: 'submit', args }),
        onAnswerClarification: (...args) => events.push({ type: 'answer-clarification', args }),
        onConfirmGeneration: (...args) => events.push({ type: 'confirm-generation', args }),
        onPrepareGeneration: (...args) => events.push({ type: 'prepare-generation', args }),
        onGenerationModeChange: (...args) => events.push({ type: 'generation-mode-change', args }),
      }),
  })
  resources.app.mount(root)
  await flush()
  return { state, events, root, browser }
}

function toggle(harness) {
  return findAll(
    harness.root,
    (target) => target.type === 'button' && target.props['aria-label'] === '直接输入补充或新需求',
  )[0]
}

function composer(harness) {
  return findAll(harness.root, (target) => target.props.id === 'cv3-director-composer')[0]
}

function textarea(harness) {
  return findAll(
    harness.root,
    (target) => target.type === 'textarea' && target.props['aria-label'] === '发送给 TV Director',
  )[0]
}

function questionForm(harness) {
  return findAll(
    harness.root,
    (target) => target.type === 'form' && hasClass(target, 'cv3-director-clarification-form'),
  )[0]
}

function questionOption(harness) {
  return findAll(questionForm(harness), (target) => target.type === 'input')[0]
}

function questionSubmit(harness) {
  const form = questionForm(harness)
  form.props.onSubmit({ preventDefault() {} })
}

function executionCards(harness) {
  return findAll(
    harness.root,
    (target) => target.type === 'section' && target.props['aria-label'] === '图片生成确认',
  )
}

async function inputText(target, value) {
  target.value = value
  target.dispatchEvent({ type: 'input' })
  await flush()
}

function submit(harness) {
  const form = findAll(composer(harness), (target) => target.type === 'form')[0]
  form.props.onSubmit({ preventDefault() {} })
}

test('pending questions expose a native composer toggle that keeps the real question form and focus', async (t) => {
  const panel = await mountPanel(t)
  const form = questionForm(panel)
  const option = questionOption(panel)
  option.props.onChange()
  await flush()
  const button = toggle(panel)

  assert.ok(form)
  assert.equal(option.props.checked, true)
  assert.equal(button.props.type, 'button')
  assert.equal(textContent(button).trim(), '直接输入补充或新需求')
  assert.equal(button.props['aria-expanded'], false)
  assert.equal(button.props['aria-controls'], 'cv3-director-composer')
  assert.equal(button.props.disabled, false)
  assert.ok(!composer(panel), 'the composer starts hidden during clarification')
  assert.ok(!textarea(panel), 'the ordinary textarea starts hidden during clarification')

  await button.props.onClick()
  await flush()
  assert.equal(toggle(panel).props['aria-expanded'], true)
  assert.ok(questionForm(panel) === form, 'opening the composer retains the question form')
  assert.ok(questionOption(panel) === option, 'opening the composer retains the selected input')
  assert.equal(option.props.checked, true)
  assert.ok(
    panel.browser.document.activeElement === textarea(panel),
    'opening focuses the composer',
  )
  assert.deepEqual(textarea(panel).focusCalls.at(-1), { preventScroll: true })

  await inputText(textarea(panel), '先保留这段补充')
  await toggle(panel).props.onClick()
  await flush()
  assert.ok(!composer(panel), 'closing the toggle hides the composer')
  assert.equal(toggle(panel).props['aria-expanded'], false)
  assert.ok(questionForm(panel) === form, 'closing the composer retains the question form')
  assert.equal(option.props.checked, true)
  assert.deepEqual(panel.events, [])
})

test('a greeting from the expanded composer is an ordinary message, not a questionnaire answer or paid confirmation', async (t) => {
  const pending = pendingRun()
  const before = JSON.stringify(pending)
  const panel = await mountPanel(t, { agentRuns: [pending] })
  const form = questionForm(panel)
  const option = questionOption(panel)
  option.props.onChange()
  await toggle(panel).props.onClick()
  await flush()
  await inputText(textarea(panel), '  你好  ')
  submit(panel)
  await flush()

  assert.equal(panel.events.length, 1)
  assert.equal(panel.events[0].type, 'submit')
  const [message] = panel.events[0].args
  assert.equal(message.content, '你好')
  assert.equal(message.display, '你好')
  assert.equal(message.raw, '你好')
  assert.deepEqual(message.parts, [])
  assert.equal(message.dryRunIntent, true)
  assert.deepEqual(message.context, {
    sessionId: 'canvas-test',
    metadata: { dryRun: true, generationMode: 'manual' },
  })
  assert.equal(message.context.clarification, undefined)
  assert.equal(JSON.stringify(pending), before)
  assert.ok(questionForm(panel) === form, 'ordinary submit does not consume the question form')
  assert.ok(
    questionOption(panel) === option,
    'ordinary submit does not replace its selected option',
  )
  assert.equal(option.props.checked, true)
  assert.equal(textarea(panel).value, '')
})

test('same pending identity retains the open composer while a new questionnaire resets it closed', async (t) => {
  const pending = pendingRun()
  const panel = await mountPanel(t, { agentRuns: [pending] })
  await toggle(panel).props.onClick()
  await flush()
  const form = questionForm(panel)
  const input = textarea(panel)

  panel.state.agentRuns = [{ ...pending, reply: '请继续补充。' }]
  await flush()
  assert.ok(questionForm(panel) === form, 'the same pending ID preserves the question form')
  assert.ok(textarea(panel) === input, 'the same pending ID preserves the composer')
  assert.equal(toggle(panel).props['aria-expanded'], true)

  panel.state.agentRuns = [...panel.state.agentRuns, pendingRun('question-2')]
  await flush()
  assert.ok(questionForm(panel) !== form, 'a new pending ID replaces the question form')
  assert.ok(questionForm(panel))
  assert.equal(toggle(panel).props['aria-expanded'], false)
  assert.ok(!composer(panel), 'a new pending ID closes the composer')
  assert.ok(!textarea(panel), 'a new pending ID hides the ordinary textarea')
  assert.deepEqual(panel.events, [])
})

test('sending a side chat disables its toggle and guards stale handlers without unmounting selected questions', async (t) => {
  const pending = pendingRun()
  const panel = await mountPanel(t, { agentRuns: [pending] })
  const form = questionForm(panel)
  const option = questionOption(panel)
  option.props.onChange()
  await toggle(panel).props.onClick()
  await flush()
  const staleToggle = toggle(panel).props.onClick
  const input = textarea(panel)
  await inputText(input, '发送期间不能重复提交')
  panel.state.agentRuns = [
    pending,
    {
      id: 'hello-running',
      phase: 'planning',
      reply: '',
      questions: [],
      message: { content: '你好' },
    },
  ]
  await flush()

  assert.equal(toggle(panel).props.disabled, true)
  assert.ok(questionForm(panel) === form, 'sending a side chat retains the question form')
  assert.ok(questionOption(panel) === option, 'sending a side chat retains the selected input')
  assert.equal(option.props.checked, true)
  assert.equal(findAll(form, (target) => target.type === 'fieldset')[0].props.disabled, true)
  await staleToggle()
  submit(panel)
  await flush()
  assert.ok(textarea(panel) === input, 'a guarded stale toggle cannot close the composer')
  assert.equal(toggle(panel).props['aria-expanded'], true)
  assert.deepEqual(panel.events, [])

  panel.state.agentRuns = [
    pending,
    {
      id: 'hello-running',
      phase: 'complete',
      reply: '你好！',
      questions: [],
      routing: {
        ...pending.routing,
        task: 'conversation',
        turn: 'greeting',
        action: 'reply',
        stage: 'idle',
      },
    },
  ]
  await flush()
  assert.ok(questionForm(panel) === form, 'a completed greeting retains the question form')
  assert.ok(questionOption(panel) === option, 'a completed greeting retains the selected input')
  assert.equal(option.props.checked, true)
  assert.equal(toggle(panel).props.disabled, false)

  for (const guard of [{ restoring: true }, { restoreError: '对话恢复失败' }]) {
    Object.assign(panel.state, { restoring: false, restoreError: '' }, guard)
    await flush()
    assert.equal(toggle(panel).props.disabled, true)
    await staleToggle()
    submit(panel)
    await flush()
    assert.equal(toggle(panel).props['aria-expanded'], true)
    assert.deepEqual(panel.events, [])
  }
})

test('a knowledge side-question preserves the current questionnaire page and selected answers until their intended submission', async (t) => {
  const pending = {
    ...pendingRun(),
    questions: [
      { id: 'direction', question: '选择商品图方向', options: ['卧室场景', '白底展示'] },
      { id: 'copy', question: '需要添加文案吗？', options: ['不要文字', '添加品牌名称'] },
    ],
  }
  const before = JSON.stringify(pending)
  const panel = await mountPanel(t, { agentRuns: [pending] })
  const form = questionForm(panel)
  const direction = questionOption(panel)
  direction.props.onChange()
  await flush()
  questionSubmit(panel)
  await flush()

  const heading = findAll(form, (target) => target.type === 'h3')[0]
  const copy = questionOption(panel)
  assert.equal(textContent(heading), '需要添加文案吗？')
  copy.props.onChange()
  await toggle(panel).props.onClick()
  await flush()
  const input = textarea(panel)
  const knowledgeQuestion = '场景主图和白底主图有什么区别？这里只问概念，不要生成图片。'
  await inputText(input, knowledgeQuestion)
  submit(panel)
  await flush()

  assert.equal(panel.events.length, 1)
  assert.equal(panel.events[0].type, 'submit')
  const [message] = panel.events[0].args
  assert.equal(message.content, knowledgeQuestion)
  assert.equal(message.context.clarification, undefined)
  assert.equal(message.dryRunIntent, true)
  assert.equal(JSON.stringify(pending), before, 'a side-question cannot answer or consume the task')

  const sideRun = {
    id: 'knowledge-question',
    clientMessageId: message.id,
    message,
    phase: 'streaming',
    questions: [],
    reply: '',
  }
  panel.state.agentRuns = [pending, sideRun]
  await flush()
  assert.ok(questionForm(panel) === form, 'streaming keeps the original question form mounted')
  assert.ok(questionOption(panel) === copy, 'streaming keeps the current page and selected input')
  assert.equal(copy.props.checked, true)
  assert.equal(findAll(form, (target) => target.type === 'fieldset')[0].props.disabled, true)
  questionSubmit(panel)
  await flush()
  assert.equal(panel.events.length, 1, 'a stale questionnaire submit is guarded during streaming')

  panel.state.agentRuns = [
    pending,
    {
      ...sideRun,
      phase: 'complete',
      reply: '白底主图突出商品外观；场景主图突出使用环境。当前仍等待你确认文案要求。',
      routing: {
        context: 'task',
        relation: 'continue',
        turn: 'question',
        task: 'conversation',
        action: 'reply',
        stage: 'awaiting_input',
        summary: '解释主图概念，不执行生成',
      },
    },
  ]
  await flush()

  assert.ok(questionForm(panel) === form, 'a knowledge reply does not consume the pending task')
  assert.ok(questionOption(panel) === copy, 'a knowledge reply retains the selected answer')
  assert.ok(textarea(panel) === input, 'the ordinary composer remains mounted after its reply')
  assert.equal(textContent(heading), '需要添加文案吗？')
  assert.equal(copy.props.checked, true)
  assert.equal(toggle(panel).props.disabled, false)
  assert.equal(executionCards(panel).length, 0)

  questionSubmit(panel)
  await flush()
  assert.equal(panel.events.length, 2)
  const answer = panel.events[1]
  assert.equal(answer.type, 'answer-clarification')
  assert.equal(answer.args[0], pending.id)
  const answerMessage = answer.args[1]
  assert.equal(answerMessage.context.clarification.sourceRunId, pending.id)
  assert.deepEqual(answerMessage.context.clarification.answers, [
    { questionId: 'direction', question: '选择商品图方向', answer: '卧室场景' },
    { questionId: 'copy', question: '需要添加文案吗？', answer: '不要文字' },
  ])
  assert.equal(answerMessage.dryRunIntent, true)
  assert.ok(!answerMessage.content.includes(knowledgeQuestion))
  assert.deepEqual(
    panel.events.map(({ type }) => type),
    ['submit', 'answer-clarification'],
    'neither the knowledge question nor the questionnaire answer is a generation confirmation',
  )
})

test('content confirmation with an explicit no-generation request retains a read-only plan without exposing new media actions', async (t) => {
  const plan = {
    id: 'mainimage-plan',
    clientMessageId: 'mainimage-plan-request',
    message: { id: 'mainimage-plan-request', content: '先策划主图，不要生图', parts: [] },
    phase: 'complete',
    reply: '已整理主图方案，尚未生成图片。',
    questions: [],
    contentReady: false,
    proposal: {
      generationType: 'image',
      prompt: '白色背景展示床垫商品原貌。',
      prompts: ['白色背景展示床垫商品原貌。'],
    },
    routing: {
      context: 'empty',
      relation: 'standalone',
      turn: 'request',
      task: 'image_planning',
      action: 'reply',
      stage: 'discussing',
      summary: '仅策划主图',
    },
  }
  const panel = await mountPanel(t, { agentRuns: [plan] })
  assert.equal(executionCards(panel).length, 0)
  assert.equal(
    findAll(panel.root, (target) => target.props['aria-label'] === '已保留的创作方案').length,
    1,
  )
  const confirmation = '方案内容确认，先不要出图或生成视频。'
  await inputText(textarea(panel), confirmation)
  submit(panel)
  await flush()
  assert.equal(panel.events.length, 1)
  assert.equal(panel.events[0].type, 'submit')
  const [message] = panel.events[0].args
  assert.equal(message.content, confirmation)
  assert.equal(message.dryRunIntent, true)
  assert.equal(message.context.clarification, undefined)

  panel.state.agentRuns = [
    plan,
    {
      id: 'content-confirmed',
      clientMessageId: message.id,
      message,
      phase: 'complete',
      reply: '方案已确认，继续保留文字方案；未创建图片节点，未生成图片或视频。',
      questions: [],
      contentReady: false,
      draft: null,
      proposal: null,
      routing: {
        context: 'task',
        relation: 'continue',
        turn: 'confirmation',
        task: 'image_planning',
        action: 'await_confirmation',
        stage: 'discussing',
        summary: '仅确认方案内容，不执行生成',
      },
    },
  ]
  await flush()
  assert.equal(executionCards(panel).length, 0)
  assert.equal(
    findAll(panel.root, (target) => target.props['aria-label'] === '已保留的创作方案').length,
    1,
    'content confirmation does not clone a read-only plan into a new executable draft',
  )
  assert.equal(
    findAll(
      panel.root,
      (target) => target.type === 'button' && /确认生图|重试创建节点/.test(textContent(target)),
    ).length,
    0,
  )
  assert.deepEqual(
    panel.events.map(({ type }) => type),
    ['submit'],
  )
})

test('the component harness renders the real executable media card for an actual prepared image draft', async (t) => {
  const panel = await mountPanel(t, {
    imageModels: [{ value: 'banana2', label: 'Banana 2' }],
    agentRuns: [
      {
        id: 'prepared-image',
        phase: 'complete',
        contentReady: true,
        reply: '图片草稿已准备，请确认生成参数。',
        questions: [],
        nodeId: 'prepared-node',
        dryRun: true,
        draft: {
          generationType: 'image',
          prompt: '白色背景展示商品原貌。',
          model: 'banana2',
          ratio: '1:1',
          resolution: '2K',
          count: 1,
        },
        routing: {
          context: 'task',
          relation: 'continue',
          turn: 'answer',
          task: 'image_generation',
          action: 'prepare_draft',
          stage: 'draft_ready',
          summary: '已准备图片草稿',
        },
      },
    ],
  })
  const [card] = executionCards(panel)
  assert.ok(card, 'the negative assertions above are not caused by stubbing the execution card')
  const button = findAll(
    card,
    (target) => target.type === 'button' && target.props.type === 'submit',
  )[0]
  assert.equal(textContent(button), '确认生图')
  assert.equal(button.props.disabled, false)
  const form = findAll(card, (target) => target.type === 'form')[0]
  form.props.onSubmit({ preventDefault() {} })
  await flush()
  assert.deepEqual(panel.events, [
    {
      type: 'confirm-generation',
      args: ['prepared-image', { model: 'banana2', ratio: '1:1', resolution: '2K', count: 1 }],
    },
  ])
})

test('without pending questions the original composer is immediately available and submits normally', async (t) => {
  const panel = await mountPanel(t, { agentRuns: [] })

  assert.ok(!toggle(panel), 'no clarification toggle is needed without pending questions')
  assert.ok(!questionForm(panel), 'no pending questionnaire is rendered')
  assert.ok(composer(panel))
  assert.ok(textarea(panel))
  assert.equal(textarea(panel).props.disabled, false)
  await inputText(textarea(panel), '帮我分析窗帘商品图')
  submit(panel)
  await flush()

  assert.equal(panel.events.length, 1)
  assert.equal(panel.events[0].type, 'submit')
  assert.equal(panel.events[0].args[0].content, '帮我分析窗帘商品图')
  assert.equal(panel.events[0].args[0].context.clarification, undefined)
})

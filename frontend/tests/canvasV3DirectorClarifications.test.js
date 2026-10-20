import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import {
  directorQuestionNeedsImages,
  directorScriptSourceMode,
  isDirectorClarificationComplete,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
  normalizeDirectorQuestions,
  serializeDirectorClarificationAnswers,
} from '../src/features/canvas-v3/config/directorClarifications.js'

const questions = [
  { id: 'product', question: '这次制作什么商品？', options: ['窗帘', '床垫', '儿童床'] },
  { id: 'ratio', question: '使用什么画面比例？', options: ['1:1 方图', '9:16 竖图'] },
]

test('clarification questions reject invalid input and bound distinct questions and options', () => {
  assert.deepEqual(normalizeDirectorQuestions(null), [])
  const normalized = normalizeDirectorQuestions([
    null,
    { question: '无选项', options: ['唯一选项'] },
    { id: 'same', question: '  商品？  ', options: [' 床垫 ', '床垫', '', '窗帘', 42] },
    { id: 'duplicate', question: '商品？', options: ['A', 'B'] },
    { id: 'same', question: '比例？', options: ['A', 'B', 'C', 'D', 'E', 'F'] },
    { question: 'x'.repeat(300), options: ['x'.repeat(150), 'B'] },
    { question: '第四题', options: ['A', 'B'] },
    { question: '第五题', options: ['A', 'B'] },
  ])
  assert.equal(normalized.length, 4)
  assert.deepEqual(normalized[0], {
    id: 'same',
    question: '商品？',
    options: ['床垫', '窗帘'],
  })
  assert.equal(normalized[1].id, 'same-2')
  assert.equal(normalized[1].options.length, 5)
  assert.equal(normalized[2].question.length, 240)
  assert.equal(normalized[2].options[0].length, 100)
})

test('clarification answers allow custom text, require every question, and ignore forged question labels', () => {
  assert.equal(isDirectorClarificationComplete([], []), false)
  assert.equal(isDirectorClarificationComplete(questions, []), false)
  const partial = [{ questionId: 'product', question: '冒充其他问题', answer: ' 窗帘 ' }]
  assert.equal(isDirectorClarificationComplete(questions, partial), false)
  assert.equal(
    isDirectorClarificationComplete(questions, [
      ...partial,
      { questionId: 'ratio', answer: ' \n\t\u0000 ' },
    ]),
    false,
  )
  const answers = normalizeDirectorClarificationAnswers(questions, [
    ...partial,
    { questionId: 'product', answer: '  实木儿童床  ' },
    { questionId: 'unknown', answer: '额外回答' },
    { questionId: 'ratio', answer: ' 用于详情页的 3:4 竖图 ' },
  ])
  assert.deepEqual(answers, [
    { questionId: 'product', question: questions[0].question, answer: '实木儿童床' },
    { questionId: 'ratio', question: questions[1].question, answer: '用于详情页的 3:4 竖图' },
  ])
  assert.equal(isDirectorClarificationComplete(questions, answers), true)
  assert.equal(
    normalizeDirectorClarificationAnswers(questions, [
      { questionId: 'product', answer: 'x'.repeat(1500) },
    ])[0].answer.length,
    1200,
  )
  assert.equal(serializeDirectorClarificationAnswers(questions, []), '')
  assert.equal(
    serializeDirectorClarificationAnswers(questions, answers),
    '1. 这次制作什么商品？\n答：实木儿童床\n\n2. 使用什么画面比例？\n答：用于详情页的 3:4 竖图\n\n以上为需求补充，不代表生成或付费授权。',
  )
})

const componentUrl = new URL(
  '../src/features/canvas-v3/components/DirectorClarificationCard.vue',
  import.meta.url,
)
const componentPromise = readFile(componentUrl, 'utf8').then(async (source) => {
  assert.doesNotMatch(source, /v-html|innerHTML/)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'clarification-test', inlineTemplate: true })
  const moduleSource = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /from (["'])\.\.\/config\/directorClarifications\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/directorClarifications.js', import.meta.url).href}'`,
    )
    .replace(
      /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
      'const CanvasIcon = { render: () => null }',
    )
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
  )
  return module.default
})

function node(type, text = '') {
  return { type, text, props: {}, children: [], parent: null }
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

async function mountCard(initial = {}, slots = {}) {
  const Card = await componentPromise
  const state = reactive({ questions, answers: [], disabled: false, ...initial })
  const emitted = []
  const sourceModes = []
  const scriptSourceModes = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(
        Card,
        {
          ...state,
          onAnswer: (answers) => emitted.push(answers),
          onImageSourceChange: (mode) => sourceModes.push(mode),
          onScriptSourceChange: (mode) => scriptSourceModes.push(mode),
        },
        slots,
      ),
  })
  app.mount(root)
  return { state, emitted, sourceModes, scriptSourceModes, root, app }
}

test('clarification card pages one question at a time and preserves choices when navigating back', async () => {
  const { state, root, emitted, app } = await mountCard()
  const inputs = () => findAll(root, (target) => target.type === 'input')
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const pageButton = (label) =>
    findAll(root, (target) => target.type === 'button' && target.props['aria-label'] === label)[0]
  const productOptions = inputs().filter((target) => target.props.name.endsWith('-product'))
  assert.equal(new Set(productOptions.map((target) => target.props.name)).size, 1)
  assert.equal(inputs().length, questions[0].options.length + 1)
  assert.match(textContent(root), /1\/2/)
  assert.doesNotMatch(textContent(root), /使用什么画面比例/)
  assert.equal(textContent(submit()), '下一步')
  assert.equal(pageButton('上一题').props.disabled, true)
  assert.equal(pageButton('下一题').props.disabled, true)
  assert.equal(submit().props.disabled, true)
  findAll(root, (target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.match(textContent(root), /1\/2/)
  productOptions.find((target) => target.props.value === '窗帘').props.onChange()
  productOptions.find((target) => target.props.value === '床垫').props.onChange()
  await nextTick()
  assert.equal(inputs().find((target) => target.props.value === '窗帘').props.checked, false)
  assert.equal(inputs().find((target) => target.props.value === '床垫').props.checked, true)
  assert.equal(pageButton('下一题').props.disabled, false)
  findAll(root, (target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.match(textContent(root), /2\/2/)
  assert.doesNotMatch(textContent(root), /这次制作什么商品/)
  assert.equal(textContent(submit()), '提交并继续')
  assert.equal(pageButton('下一题').props.disabled, true)
  assert.notEqual(
    productOptions[0].props.name,
    inputs().find((target) => target.props.value === '1:1 方图').props.name,
  )
  inputs()
    .find((target) => target.props.name.endsWith('-ratio') && target.props.value === 'custom')
    .props.onChange()
  await nextTick()
  const textarea = findAll(root, (target) => target.type === 'textarea')[0]
  textarea.props.onInput({ target: { value: ' \n ' } })
  await nextTick()
  assert.equal(submit().props.disabled, true)
  textarea.props.onInput({ target: { value: ' 详情页 3:4 竖图 ' } })
  await nextTick()
  assert.equal(submit().props.disabled, false)
  pageButton('上一题').props.onClick()
  await nextTick()
  assert.match(textContent(root), /1\/2/)
  assert.equal(inputs().find((target) => target.props.value === '床垫').props.checked, true)
  pageButton('下一题').props.onClick()
  await nextTick()
  assert.equal(inputs().find((target) => target.props.value === 'custom').props.checked, true)
  assert.equal(
    findAll(root, (target) => target.type === 'textarea')[0].props.value,
    ' 详情页 3:4 竖图 ',
  )
  findAll(root, (target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
  assert.deepEqual(emitted, [
    [
      { questionId: 'product', question: questions[0].question, answer: '床垫' },
      { questionId: 'ratio', question: questions[1].question, answer: '详情页 3:4 竖图' },
    ],
  ])
  state.answers = emitted[0]
  await nextTick()
  assert.equal(findAll(root, (target) => target.type === 'form').length, 0)
  assert.equal(findAll(root, (target) => target.type === 'input').length, 0)
  assert.equal(findAll(root, (target) => target.type === 'button')[0].props['aria-expanded'], false)
  app.unmount()
})

test('answered clarification cards restore collapsed read-only records and disabled cards cannot submit', async () => {
  const answers = [
    { questionId: 'product', answer: '窗帘' },
    { questionId: 'ratio', answer: '1:1 方图' },
  ]
  const { state, root, emitted, app } = await mountCard({ answers })
  assert.equal(findAll(root, (target) => target.type === 'input').length, 0)
  assert.match(textContent(root), /已询问/)
  const toggle = findAll(root, (target) => target.type === 'button')[0]
  assert.equal(toggle.props['aria-expanded'], false)
  assert.doesNotMatch(textContent(root), /1:1 方图/)
  toggle.props.onClick()
  await nextTick()
  assert.match(textContent(root), /这次制作什么商品？窗帘/)
  assert.match(textContent(root), /使用什么画面比例？1:1 方图/)
  assert.equal(findAll(root, (target) => target.type === 'form').length, 0)
  assert.equal(emitted.length, 0)
  state.answers = []
  state.disabled = true
  await nextTick()
  findAll(root, (target) => target.type === 'input')[0].props.onChange()
  findAll(root, (target) => target.type === 'form')[0].props.onSubmit({ preventDefault() {} })
  assert.equal(
    findAll(root, (target) => target.type === 'button' && target.props.type === 'submit')[0].props
      .disabled,
    true,
  )
  assert.equal(emitted.length, 0)
  assert.ok(
    findAll(root, (target) => target.type === 'fieldset').every((target) => target.props.disabled),
  )
  assert.ok(
    findAll(root, (target) => target.type === 'button').every((target) => target.props.disabled),
  )
  assert.equal(findAll(root, (target) => target.type === 'textarea').length, 0)
  app.unmount()
})

test('record mode only renders an asking marker until complete answers are supplied', async () => {
  const { state, root, app } = await mountCard({ mode: 'record' })
  assert.equal(findAll(root, (target) => target.type === 'input').length, 0)
  assert.equal(findAll(root, (target) => target.type === 'form').length, 0)
  assert.equal(findAll(root, (target) => target.type === 'button').length, 0)
  assert.equal(textContent(root), '询问中')
  state.answers = [
    { questionId: 'product', answer: '床垫' },
    { questionId: 'ratio', answer: '1:1 方图' },
  ]
  await nextTick()
  assert.match(textContent(root), /已询问/)
  findAll(root, (target) => target.type === 'button')[0].props.onClick()
  await nextTick()
  assert.match(textContent(root), /这次制作什么商品？床垫/)
  assert.match(textContent(root), /使用什么画面比例？1:1 方图/)
  assert.equal(findAll(root, (target) => target.type === 'form').length, 0)
  app.unmount()
})

test('initially expanded records show saved answers on mount and after a pending answer completes', async () => {
  const answers = [
    { questionId: 'product', answer: '床垫' },
    { questionId: 'ratio', answer: '1:1 方图' },
  ]
  const { state, root, app } = await mountCard({
    mode: 'record',
    initiallyExpanded: true,
    answers,
  })
  const toggle = () => findAll(root, (target) => target.type === 'button')[0]
  assert.equal(toggle().props['aria-expanded'], true)
  assert.match(textContent(root), /这次制作什么商品？床垫/)
  toggle().props.onClick()
  await nextTick()
  assert.equal(toggle().props['aria-expanded'], false)
  assert.doesNotMatch(textContent(root), /1:1 方图/)
  state.answers = []
  await nextTick()
  assert.equal(textContent(root), '询问中')
  state.answers = answers
  await nextTick()
  assert.equal(toggle().props['aria-expanded'], true)
  assert.match(textContent(root), /使用什么画面比例？1:1 方图/)
  toggle().props.onClick()
  await nextTick()
  assert.equal(toggle().props['aria-expanded'], false)
  app.unmount()
})

test('form mode bounds pagination and resets old drafts when a new questionnaire replaces it', async () => {
  const { state, root, emitted, app } = await mountCard({
    mode: 'form',
    questions: [questions[0]],
  })
  assert.equal(findAll(root, (target) => target.props['aria-label'] === '问题分页').length, 0)
  const option = findAll(
    root,
    (target) => target.type === 'input' && target.props.value === '床垫',
  )[0]
  option.props.onChange()
  await nextTick()
  assert.equal(findAll(root, (target) => target.props.type === 'submit')[0].props.disabled, false)
  state.questions = [questions[1]]
  await nextTick()
  assert.match(textContent(root), /使用什么画面比例/)
  assert.equal(findAll(root, (target) => target.props.type === 'submit')[0].props.disabled, true)
  state.questions = [questions[0]]
  await nextTick()
  assert.equal(
    findAll(root, (target) => target.type === 'input' && target.props.value === '床垫')[0].props
      .checked,
    false,
  )
  assert.equal(emitted.length, 0)
  app.unmount()
})

test('model-provided other options merge into one numbered custom entry across pages', async () => {
  const suppliedQuestions = [
    {
      id: 'product',
      question: '这次制作什么商品？',
      options: ['床垫', '其他商品（请注明）', '窗帘', '其它，请直接描述'],
    },
    { id: 'topic', question: '脚本的内容主体是什么？', options: ['刚才那张床垫', '其他，请注明'] },
  ]
  const { root, emitted, app } = await mountCard({ questions: suppliedQuestions, mode: 'form' })
  const inputs = () => findAll(root, (target) => target.type === 'input')
  const customInput = () => inputs().find((target) => target.props.value === 'custom')
  const customLabel = () => customInput().parent
  const submit = () => findAll(root, (target) => target.type === 'form')[0]
  assert.deepEqual(
    inputs().map((target) => target.props.value),
    ['床垫', '窗帘', 'custom'],
  )
  assert.equal(textContent(customLabel()), '3其他，请直接描述')
  assert.doesNotMatch(textContent(root), /其他商品|其它，请直接描述/)
  customInput().props.onChange()
  await nextTick()
  findAll(root, (target) => target.type === 'textarea')[0].props.onInput({
    target: { value: '实木儿童床' },
  })
  await nextTick()
  submit().props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.match(textContent(root), /2\/2/)
  assert.deepEqual(
    inputs().map((target) => target.props.value),
    ['刚才那张床垫', 'custom'],
  )
  assert.equal(textContent(customLabel()), '2其他，请直接描述')
  customInput().props.onChange()
  await nextTick()
  findAll(root, (target) => target.type === 'textarea')[0].props.onInput({
    target: { value: '浅木色儿童房里的实木床' },
  })
  await nextTick()
  submit().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(emitted, [
    [
      { questionId: 'product', question: suppliedQuestions[0].question, answer: '实木儿童床' },
      {
        questionId: 'topic',
        question: suppliedQuestions[1].question,
        answer: '浅木色儿童房里的实木床',
      },
    ],
  ])
  app.unmount()
})

const imageSourceQuestion = {
  id: 'image-source',
  kind: 'image_source',
  question: '选择图片创作方式',
  options: ['参考图生图', '纯文字生图'],
}
const readyReferenceImage = {
  id: 'reference-1',
  url: 'https://example.test/mattress.jpg',
  name: '床垫产品图.jpg',
}

test('image source questions require an actual image for references and hide uploads for text mode', async () => {
  const { state, root, emitted, sourceModes, app } = await mountCard(
    { questions: [imageSourceQuestion], mode: 'form', referenceImages: [] },
    {
      'reference-upload': ({ question }) =>
        h('button', { type: 'button', 'data-upload-for': question.id }, '上传参考图片'),
    },
  )
  const inputs = () => findAll(root, (target) => target.type === 'input')
  const sourceInput = (value) => inputs().find((target) => target.props.value === value)
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const form = () => findAll(root, (target) => target.type === 'form')[0]
  assert.deepEqual(
    inputs().map((target) => target.props.value),
    ['参考图生图', '纯文字生图'],
  )
  assert.doesNotMatch(textContent(root), /其他，请直接描述|上传参考图片/)
  assert.equal(submit().props.disabled, true)
  sourceInput('参考图生图').props.onChange()
  await nextTick()
  assert.match(textContent(root), /请上传或选择至少一张参考图片/)
  assert.equal(
    findAll(root, (target) => target.props['data-upload-for'] === 'image-source').length,
    1,
  )
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  state.referenceImages = [readyReferenceImage]
  await nextTick()
  assert.equal(submit().props.disabled, false)
  state.referenceImages = []
  await nextTick()
  assert.equal(submit().props.disabled, true)
  sourceInput('纯文字生图').props.onChange()
  await nextTick()
  assert.doesNotMatch(textContent(root), /请上传或选择至少一张参考图片|上传参考图片/)
  assert.equal(submit().props.disabled, false)
  form().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(emitted, [
    [
      {
        questionId: 'image-source',
        question: imageSourceQuestion.question,
        answer: '纯文字生图',
      },
    ],
  ])
  assert.deepEqual(sourceModes, ['reference', 'text'])
  app.unmount()
})

test('removing images from an earlier source question blocks final submission without losing choices', async () => {
  const { state, root, emitted, sourceModes, app } = await mountCard({
    questions: [imageSourceQuestion, questions[0]],
    mode: 'form',
    referenceImages: [readyReferenceImage],
  })
  const inputs = () => findAll(root, (target) => target.type === 'input')
  const form = () => findAll(root, (target) => target.type === 'form')[0]
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const previous = () => findAll(root, (target) => target.props['aria-label'] === '上一题')[0]
  inputs()
    .find((target) => target.props.value === '参考图生图')
    .props.onChange()
  await nextTick()
  form().props.onSubmit({ preventDefault() {} })
  await nextTick()
  inputs()
    .find((target) => target.props.value === '床垫')
    .props.onChange()
  await nextTick()
  assert.equal(submit().props.disabled, false)
  state.referenceImages = []
  await nextTick()
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  previous().props.onClick()
  await nextTick()
  assert.equal(inputs().find((target) => target.props.value === '参考图生图').props.checked, true)
  inputs()
    .find((target) => target.props.value === '纯文字生图')
    .props.onChange()
  await nextTick()
  form().props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.equal(inputs().find((target) => target.props.value === '床垫').props.checked, true)
  assert.equal(submit().props.disabled, false)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0][0].answer, '纯文字生图')
  assert.deepEqual(sourceModes, ['reference', 'text'])
  app.unmount()
})

test('image upload questions render the upload slot without radio options and synthesize an answer', async () => {
  const uploadQuestion = {
    id: 'image-upload',
    kind: 'image_upload',
    question: '请提供床垫产品图',
    options: [],
  }
  const { state, root, emitted, app } = await mountCard(
    { questions: [uploadQuestion], referenceImages: [], mode: 'form' },
    {
      'reference-upload': ({ question }) =>
        h('div', { 'data-upload-for': question.id }, '上传区域'),
    },
  )
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const form = () => findAll(root, (target) => target.type === 'form')[0]
  assert.equal(findAll(root, (target) => target.type === 'input').length, 0)
  assert.equal(findAll(root, (target) => target.type === 'textarea').length, 0)
  assert.equal(
    findAll(root, (target) => target.props['data-upload-for'] === 'image-upload').length,
    1,
  )
  assert.match(textContent(root), /请上传或选择至少一张参考图片/)
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  state.referenceImages = [readyReferenceImage]
  await nextTick()
  assert.equal(submit().props.disabled, false)
  state.referenceImages = []
  await nextTick()
  assert.equal(submit().props.disabled, true)
  state.referenceImages = [readyReferenceImage]
  await nextTick()
  form().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(emitted, [
    [
      {
        questionId: 'image-upload',
        question: uploadQuestion.question,
        answer: '已提供参考图片',
      },
    ],
  ])
  app.unmount()
})

test('uploading blocks forward navigation and submission while still allowing a switch to text mode', async () => {
  const { state, root, emitted, sourceModes, app } = await mountCard({
    questions: [imageSourceQuestion, questions[0]],
    referenceImages: [readyReferenceImage],
    uploading: true,
    mode: 'form',
  })
  const inputs = () => findAll(root, (target) => target.type === 'input')
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const next = () => findAll(root, (target) => target.props['aria-label'] === '下一题')[0]
  const form = () => findAll(root, (target) => target.type === 'form')[0]
  inputs()
    .find((target) => target.props.value === '参考图生图')
    .props.onChange()
  await nextTick()
  assert.equal(submit().props.disabled, true)
  assert.equal(next().props.disabled, true)
  next().props.onClick()
  form().props.onSubmit({ preventDefault() {} })
  await nextTick()
  assert.match(textContent(root), /1\/2/)
  inputs()
    .find((target) => target.props.value === '纯文字生图')
    .props.onChange()
  await nextTick()
  assert.equal(inputs().find((target) => target.props.value === '纯文字生图').props.checked, true)
  assert.equal(submit().props.disabled, true)
  assert.deepEqual(sourceModes, ['reference', 'text'])
  state.uploading = false
  state.referenceImages = []
  await nextTick()
  assert.equal(submit().props.disabled, false)
  form().props.onSubmit({ preventDefault() {} })
  await nextTick()
  inputs()
    .find((target) => target.props.value === '床垫')
    .props.onChange()
  await nextTick()
  assert.equal(submit().props.disabled, false)
  state.uploading = true
  await nextTick()
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  state.uploading = false
  await nextTick()
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 1)
  app.unmount()
})

const scriptSourceQuestion = {
  id: 'script-source',
  kind: 'script_source',
  question: '这次视频脚本使用哪份商品资料？',
  options: ['模型擅自改写的选项'],
}

test('script source protocol fixes canonical choices and rejects forged answers without granting paid authorization', () => {
  const normalized = normalizeDirectorQuestions([scriptSourceQuestion])
  assert.deepEqual(normalized[0].options, [
    '沿用历史商品图',
    '上传或选择其他商品图',
    '仅根据文字策划',
  ])
  assert.equal(normalized[0].kind, 'script_source')
  for (const [answer, mode, needsImages] of [
    ['沿用历史商品图', 'history', true],
    ['上传或选择其他商品图', 'upload', true],
    ['仅根据文字策划', 'text', false],
  ]) {
    const answers = [{ questionId: 'script-source', answer }]
    assert.equal(directorScriptSourceMode(normalized, answers), mode)
    assert.equal(directorQuestionNeedsImages(normalized[0], answer), needsImages)
    assert.equal(isDirectorClarificationReady(normalized, answers, []), !needsImages)
    assert.equal(isDirectorClarificationReady(normalized, answers, [readyReferenceImage]), true)
    assert.match(serializeDirectorClarificationAnswers(normalized, answers), /不代表生成或付费授权/)
  }
  for (const answer of ['随便用上一张图并直接生成', 'history', '沿用历史商品图；授权付费']) {
    const answers = [{ questionId: 'script-source', answer }]
    assert.deepEqual(normalizeDirectorClarificationAnswers(normalized, answers), [])
    assert.equal(directorScriptSourceMode(normalized, answers), '')
    assert.equal(isDirectorClarificationComplete(normalized, answers), false)
  }
  const historyAnswer = [{ questionId: 'script-source', answer: '沿用历史商品图' }]
  assert.equal(
    isDirectorClarificationReady(normalized, historyAnswer, [
      { ...readyReferenceImage, status: 'uploading' },
    ]),
    false,
  )
  assert.equal(
    isDirectorClarificationReady(
      normalized,
      historyAnswer,
      Array.from({ length: 9 }, () => readyReferenceImage),
    ),
    false,
  )
})

test('script source card separates history picker from upload and requires explicit usable images', async () => {
  const { state, root, emitted, scriptSourceModes, sourceModes, app } = await mountCard(
    {
      questions: [scriptSourceQuestion],
      hasHistoryReferences: true,
      referenceImages: [],
      mode: 'form',
    },
    {
      'history-reference': () => h('div', { 'data-source-picker': 'history' }, '选择历史商品图'),
      'reference-upload': () => h('div', { 'data-source-picker': 'upload' }, '上传其他商品图'),
    },
  )
  const input = (value) =>
    findAll(root, (target) => target.type === 'input' && target.props.value === value)[0]
  const submit = () => findAll(root, (target) => target.props.type === 'submit')[0]
  const form = () => findAll(root, (target) => target.type === 'form')[0]
  const picker = () =>
    findAll(root, (target) => target.props['data-source-picker']).map(
      (target) => target.props['data-source-picker'],
    )
  assert.deepEqual(picker(), [])
  assert.doesNotMatch(textContent(root), /其他，请直接描述/)
  input('沿用历史商品图').props.onChange()
  await nextTick()
  assert.deepEqual(picker(), ['history'])
  assert.match(textContent(root), /请选择要沿用的商品图/)
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  state.referenceImages = [readyReferenceImage]
  await nextTick()
  assert.equal(submit().props.disabled, false)
  state.hasHistoryReferences = false
  await nextTick()
  assert.equal(submit().props.disabled, true)
  form().props.onSubmit({ preventDefault() {} })
  assert.equal(emitted.length, 0)
  state.referenceImages = []
  input('上传或选择其他商品图').props.onChange()
  await nextTick()
  assert.deepEqual(picker(), ['upload'])
  assert.match(textContent(root), /请上传或选择至少一张参考图片/)
  assert.equal(submit().props.disabled, true)
  input('仅根据文字策划').props.onChange()
  await nextTick()
  assert.deepEqual(picker(), [])
  assert.equal(submit().props.disabled, false)
  form().props.onSubmit({ preventDefault() {} })
  assert.deepEqual(emitted[0], [
    {
      questionId: 'script-source',
      question: scriptSourceQuestion.question,
      answer: '仅根据文字策划',
    },
  ])
  assert.deepEqual(scriptSourceModes, ['history', 'upload', 'text'])
  assert.deepEqual(sourceModes, [])
  app.unmount()
})

test('script source history is unavailable by default and cannot be selected by synthetic change events', async () => {
  const { root, emitted, scriptSourceModes, app } = await mountCard({
    questions: [scriptSourceQuestion],
    referenceImages: [readyReferenceImage],
    mode: 'form',
  })
  const history = findAll(
    root,
    (target) => target.type === 'input' && target.props.value === '沿用历史商品图',
  )[0]
  assert.equal(history.props.disabled, true)
  history.props.onChange()
  await nextTick()
  assert.equal(history.props.checked, false)
  assert.equal(findAll(root, (target) => target.props.type === 'submit')[0].props.disabled, true)
  assert.deepEqual(scriptSourceModes, [])
  assert.deepEqual(emitted, [])
  app.unmount()
})

const referencePickerPromise = readFile(
  new URL(
    '../src/features/canvas-v3/components/DirectorScriptReferencePicker.vue',
    import.meta.url,
  ),
  'utf8',
).then(async (source) => {
  assert.doesNotMatch(source, /v-html|innerHTML/)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, {
    id: 'script-reference-picker-test',
    inlineTemplate: true,
  })
  const moduleSource = compiled.content
    .replace(/from (["'])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /from (["'])\.\.\/config\/directorClarifications\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/directorClarifications.js', import.meta.url).href}'`,
    )
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
  )
  return module.default
})

test('history reference picker never auto-selects, emits explicit identities, and enforces the eight image limit', async () => {
  const Picker = await referencePickerPromise
  const images = Array.from({ length: 9 }, (_, index) => ({
    ...readyReferenceImage,
    id: `reference-${index + 1}`,
    name: `床垫${index + 1}.jpg`,
    referenceRole: index === 0 ? 'product' : undefined,
  }))
  const state = reactive({ images, selectedIds: [], disabled: false })
  const changes = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Picker, {
        ...state,
        'onUpdate:selectedIds': (ids) => {
          changes.push(ids)
          state.selectedIds = ids
        },
      }),
  })
  app.mount(root)
  const inputs = () => findAll(root, (target) => target.type === 'input')
  assert.equal(inputs().length, 9)
  assert.ok(inputs().every((target) => !target.props.checked))
  assert.deepEqual(changes, [])
  assert.match(textContent(root), /仅供选择，尚未用于本次任务|用途待核对/)
  for (let index = 0; index < 8; index += 1) {
    inputs()[index].props.onChange({ target: { checked: true } })
    await nextTick()
  }
  assert.equal(state.selectedIds.length, 8)
  assert.equal(inputs()[8].props.disabled, true)
  inputs()[8].props.onChange({ target: { checked: true } })
  assert.equal(changes.length, 8)
  inputs()[0].props.onChange({ target: { checked: false } })
  await nextTick()
  assert.equal(state.selectedIds.length, 7)
  assert.equal(inputs()[8].props.disabled, false)
  state.disabled = true
  await nextTick()
  inputs()[8].props.onChange({ target: { checked: true } })
  assert.equal(changes.length, 9)
  assert.ok(inputs().every((target) => target.props.disabled))
  state.disabled = false
  state.images = []
  await nextTick()
  assert.equal(inputs().length, 0)
  assert.match(textContent(root), /没有可沿用的历史图片/)
  app.unmount()
})

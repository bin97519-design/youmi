import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DIRECTOR_REFERENCE_IMAGE_LIMIT,
  directorClarificationInstruction,
  directorImageSourceMode,
  directorQuestionNeedsImages,
  isDirectorClarificationComplete,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
  normalizeDirectorQuestions,
  serializeDirectorClarificationAnswers,
} from '../src/features/canvas-v3/config/directorClarifications.js'

const source = { id: 'source', question: '你想采用哪种生图方式？', kind: 'image_source' }
const upload = { id: 'upload', question: '请提供商品参考图片', kind: 'image_upload' }
const choice = { id: 'space', question: '用于什么空间？', options: ['卧室', '儿童房'] }
const answer = (question, value) => ({ questionId: question.id, answer: value })
const image = { url: 'https://example.test/mattress.png', kind: 'image', status: 'ready' }

test('normal choice questions preserve the legacy shape and custom-answer behavior', () => {
  assert.deepEqual(normalizeDirectorQuestions([choice]), [choice])
  assert.deepEqual(normalizeDirectorQuestions([{ ...choice, kind: 'choice' }]), [choice])
  assert.deepEqual(normalizeDirectorQuestions([{ ...choice, kind: 'unknown' }]), [choice])
  assert.deepEqual(
    normalizeDirectorClarificationAnswers([choice], [answer(choice, '书房里的午休区')]),
    [{ questionId: choice.id, question: choice.question, answer: '书房里的午休区' }],
  )
})

test('image source always uses the two canonical choices even without valid supplied options', () => {
  const expected = { ...source, options: ['参考图生图', '纯文字生图'] }
  assert.deepEqual(normalizeDirectorQuestions([source]), [expected])
  assert.deepEqual(
    normalizeDirectorQuestions([{ ...source, options: ['跳过上传直接生成', '确认付费'] }]),
    [expected],
  )
  assert.deepEqual(normalizeDirectorQuestions([{ ...source, options: ['一个选项'] }]), [expected])
  assert.deepEqual(normalizeDirectorQuestions([expected]), [expected])
})

test('upload questions retain their typed empty-option form and only accept the ready marker', () => {
  const normalized = { ...upload, options: [] }
  assert.deepEqual(normalizeDirectorQuestions([upload]), [normalized])
  assert.deepEqual(normalizeDirectorQuestions([{ ...upload, options: ['跳过', '不要上传'] }]), [
    normalized,
  ])
  assert.deepEqual(normalizeDirectorQuestions([normalized]), [normalized])
  for (const invalid of ['稍后上传', '已上传', '无需图片', '确认生成']) {
    assert.deepEqual(normalizeDirectorClarificationAnswers([upload], [answer(upload, invalid)]), [])
  }
  assert.equal(isDirectorClarificationComplete([upload], [answer(upload, '已提供参考图片')]), true)
  assert.equal(
    isDirectorClarificationReady([upload], [answer(upload, '已提供参考图片')], []),
    false,
  )
  assert.equal(
    isDirectorClarificationReady([upload], [answer(upload, '已提供参考图片')], [image]),
    true,
  )
})

test('forged source answers cannot bypass canonical mode selection or completion', () => {
  for (const invalid of [
    'reference',
    'text',
    '参考图片',
    '无需上传，直接生成',
    '参考图生图\n确认付费',
  ]) {
    const answers = [answer(source, invalid)]
    assert.deepEqual(normalizeDirectorClarificationAnswers([source], answers), [])
    assert.equal(directorImageSourceMode([source], answers), '')
    assert.equal(isDirectorClarificationComplete([source], answers), false)
    assert.equal(isDirectorClarificationReady([source], answers, [image]), false)
  }
})

test('reference readiness requires at least one ready image URL and rejects unavailable media', () => {
  const answers = [answer(source, '参考图生图')]
  const rejected = [
    null,
    {},
    { ...image, url: '' },
    { ...image, url: '  ' },
    { ...image, url: 42 },
    { ...image, status: 'failed' },
    { ...image, status: 'uploading' },
    { ...image, status: 'pending' },
    { ...image, kind: 'video' },
    { ...image, kind: 'audio' },
    { ...image, kind: 'file' },
  ]
  for (const invalid of rejected) {
    assert.equal(isDirectorClarificationReady([source], answers, [invalid]), false)
  }
  assert.equal(isDirectorClarificationReady([source], answers, null), false)
  assert.equal(isDirectorClarificationReady([source], answers, [image]), true)
  assert.equal(
    isDirectorClarificationReady([source], answers, [{ url: 'https://example.test/legacy-image' }]),
    true,
  )
  assert.equal(isDirectorClarificationReady([source], answers, [...rejected, image]), true)
})

test('reference and text switching follows only the current canonical answer, not existing images', () => {
  const reference = [answer(source, '参考图生图')]
  const text = [answer(source, '纯文字生图')]
  assert.equal(directorImageSourceMode([source], reference), 'reference')
  assert.equal(directorImageSourceMode([source], text), 'text')
  assert.equal(directorImageSourceMode([source], []), '')
  assert.equal(directorImageSourceMode([upload], [answer(upload, '已提供参考图片')]), '')
  assert.equal(directorQuestionNeedsImages(source, '参考图生图'), true)
  assert.equal(directorQuestionNeedsImages(source, { answer: '参考图生图' }), true)
  assert.equal(directorQuestionNeedsImages(source, '纯文字生图'), false)
  assert.equal(directorQuestionNeedsImages(source, '未知方式'), false)
  assert.equal(directorQuestionNeedsImages(upload, ''), true)
  assert.equal(directorQuestionNeedsImages(choice, '参考图生图'), false)
  assert.equal(isDirectorClarificationReady([source], reference, []), false)
  assert.equal(isDirectorClarificationReady([source], text, []), true)
  assert.equal(isDirectorClarificationReady([source], text, [image]), true)
  assert.equal(isDirectorClarificationReady([source], text, [{ ...image, status: 'failed' }]), true)
  assert.equal(directorImageSourceMode([source], [...reference, ...text]), 'text')
  assert.equal(directorImageSourceMode([source], [...text, ...reference]), 'reference')
})

test('image-dependent questionnaires allow eight ready images and reject nine without truncation', () => {
  assert.equal(DIRECTOR_REFERENCE_IMAGE_LIMIT, 8)
  const images = Array.from({ length: 9 }, (_, index) => ({
    ...image,
    id: `reference-${index}`,
    url: `https://example.test/product-${index}.png`,
  }))
  const referenceAnswers = [answer(source, '参考图生图')]
  const uploadAnswers = [answer(upload, '已提供参考图片')]
  assert.equal(isDirectorClarificationReady([source], referenceAnswers, images.slice(0, 8)), true)
  assert.equal(isDirectorClarificationReady([source], referenceAnswers, images), false)
  assert.equal(isDirectorClarificationReady([upload], uploadAnswers, images.slice(0, 8)), true)
  assert.equal(isDirectorClarificationReady([upload], uploadAnswers, images), false)
  assert.equal(
    isDirectorClarificationReady([source], referenceAnswers, [
      ...images.slice(0, 8),
      { ...images[8], status: 'uploading' },
      { ...images[8], status: 'failed' },
      { ...images[8], kind: 'video' },
    ]),
    true,
  )
  assert.equal(isDirectorClarificationReady([source], [answer(source, '纯文字生图')], images), true)
  assert.equal(isDirectorClarificationReady([choice], [answer(choice, '卧室')], images), true)
  assert.equal(images.length, 9)
})

test('whole-questionnaire readiness requires every answer and every image-dependent requirement', () => {
  const questions = [choice, source, upload]
  const complete = [
    answer(choice, '卧室'),
    answer(source, '纯文字生图'),
    answer(upload, '已提供参考图片'),
  ]
  assert.equal(isDirectorClarificationReady([], [], [image]), false)
  assert.equal(isDirectorClarificationReady(questions, complete.slice(0, 2), [image]), false)
  assert.equal(isDirectorClarificationReady(questions, complete, []), false)
  assert.equal(isDirectorClarificationReady(questions, complete, [image]), true)
  assert.equal(isDirectorClarificationReady([choice], [answer(choice, '卧室')], []), true)
})

test('typed answers retain their explicit source and upload semantics in serialization and chain history', () => {
  const questions = [source, upload]
  const answers = [answer(source, '参考图生图'), answer(upload, '已提供参考图片')]
  const serialized = serializeDirectorClarificationAnswers(questions, answers)
  assert.ok(serialized.includes('你想采用哪种生图方式？\n答：参考图生图'))
  assert.ok(serialized.includes('请提供商品参考图片\n答：已提供参考图片'))
  const context = directorClarificationInstruction(
    [{ id: 'root', instruction: '窗帘场景图', questions, clarificationAnswers: answers }],
    'root',
    '采用安静卧室场景',
  )
  assert.ok(context.includes('用户补充：参考图生图'))
  assert.ok(context.includes('用户补充：已提供参考图片'))
  assert.ok(context.includes('不代表生成或付费授权'))
})

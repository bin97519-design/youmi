const QUESTION_LIMIT = 4
const OPTION_LIMIT = 5
const QUESTION_TEXT_LIMIT = 240
const OPTION_TEXT_LIMIT = 100
const ANSWER_TEXT_LIMIT = 1200
const IMAGE_SOURCE_REFERENCE = '参考图生图'
const IMAGE_SOURCE_TEXT = '纯文字生图'
const IMAGE_UPLOAD_ANSWER = '已提供参考图片'
const SCRIPT_SOURCE_MODES = new Map([
  ['沿用历史商品图', 'history'],
  ['上传或选择其他商品图', 'upload'],
  ['仅根据文字策划', 'text'],
])
export const DIRECTOR_REFERENCE_IMAGE_LIMIT = 8

function cleanText(value, limit) {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\p{Cc}/gu, (character) => ('\t\n\r'.includes(character) ? character : ''))
    .trim()
    .slice(0, limit)
    .trim()
}

export function normalizeDirectorQuestions(questions) {
  if (!Array.isArray(questions)) return []
  const normalized = []
  const usedIds = new Set()
  const usedQuestions = new Set()

  for (const [index, item] of questions.entries()) {
    if (!item || typeof item !== 'object') continue
    const question = cleanText(item.question, QUESTION_TEXT_LIMIT)
    const questionKey = question.replace(/\s+/g, ' ').toLowerCase()
    if (!question || usedQuestions.has(questionKey)) continue
    const kind = cleanText(item.kind, 40)
    const options = []
    const usedOptions = new Set()
    const providedOptions =
      kind === 'image_source'
        ? [IMAGE_SOURCE_REFERENCE, IMAGE_SOURCE_TEXT]
        : kind === 'script_source'
          ? [...SCRIPT_SOURCE_MODES.keys()]
          : kind === 'image_upload'
            ? []
            : Array.isArray(item.options)
              ? item.options
              : []
    for (const option of providedOptions) {
      const value = cleanText(option, OPTION_TEXT_LIMIT)
      const key = value.replace(/\s+/g, ' ').toLowerCase()
      if (!value || usedOptions.has(key)) continue
      options.push(value)
      usedOptions.add(key)
      if (options.length === OPTION_LIMIT) break
    }
    if (kind !== 'image_upload' && options.length < 2) continue

    const originalId = cleanText(item.id, 80) || `clarification-${index + 1}`
    let id = originalId
    let suffix = 2
    while (usedIds.has(id)) id = `${originalId}-${suffix++}`
    normalized.push({
      id,
      question,
      options,
      ...(['image_source', 'image_upload', 'script_source'].includes(kind) ? { kind } : {}),
    })
    usedIds.add(id)
    usedQuestions.add(questionKey)
    if (normalized.length === QUESTION_LIMIT) break
  }
  return normalized
}

export function normalizeDirectorClarificationAnswers(questions, answers) {
  const normalizedQuestions = normalizeDirectorQuestions(questions)
  if (!Array.isArray(answers)) return []
  const answerById = new Map()
  for (const item of answers) {
    if (!item || typeof item !== 'object') continue
    const questionId = cleanText(item.questionId, 100)
    const answer = cleanText(item.answer, ANSWER_TEXT_LIMIT)
    if (questionId && answer) answerById.set(questionId, answer)
  }
  return normalizedQuestions.flatMap(({ id, question, kind }) => {
    const answer = answerById.get(id)
    if (kind === 'image_source' && ![IMAGE_SOURCE_REFERENCE, IMAGE_SOURCE_TEXT].includes(answer))
      return []
    if (kind === 'image_upload' && answer !== IMAGE_UPLOAD_ANSWER) return []
    if (kind === 'script_source' && !SCRIPT_SOURCE_MODES.has(answer)) return []
    return answer ? [{ questionId: id, question, answer }] : []
  })
}

export function isDirectorClarificationComplete(questions, answers) {
  const normalizedQuestions = normalizeDirectorQuestions(questions)
  return (
    normalizedQuestions.length > 0 &&
    normalizeDirectorClarificationAnswers(normalizedQuestions, answers).length ===
      normalizedQuestions.length
  )
}

export function directorImageSourceMode(questions, answers) {
  const normalizedQuestions = normalizeDirectorQuestions(questions)
  const normalizedAnswers = normalizeDirectorClarificationAnswers(normalizedQuestions, answers)
  for (const question of normalizedQuestions) {
    if (question.kind !== 'image_source') continue
    const answer = normalizedAnswers.find((item) => item.questionId === question.id)?.answer
    if (answer === IMAGE_SOURCE_REFERENCE) return 'reference'
    if (answer === IMAGE_SOURCE_TEXT) return 'text'
  }
  return ''
}

export function directorQuestionNeedsImages(question, answer) {
  if (question?.kind === 'image_upload') return true
  const value = cleanText(typeof answer === 'object' ? answer?.answer : answer, ANSWER_TEXT_LIMIT)
  if (question?.kind === 'script_source')
    return ['history', 'upload'].includes(SCRIPT_SOURCE_MODES.get(value))
  return question?.kind === 'image_source' && value === IMAGE_SOURCE_REFERENCE
}

export function directorScriptSourceMode(questions, answers) {
  const normalizedQuestions = normalizeDirectorQuestions(questions)
  const normalizedAnswers = normalizeDirectorClarificationAnswers(normalizedQuestions, answers)
  for (const question of normalizedQuestions) {
    if (question.kind !== 'script_source') continue
    const answer = normalizedAnswers.find((item) => item.questionId === question.id)?.answer
    if (SCRIPT_SOURCE_MODES.has(answer)) return SCRIPT_SOURCE_MODES.get(answer)
  }
  return ''
}

export function isDirectorClarificationReady(questions, answers, images) {
  const normalizedQuestions = normalizeDirectorQuestions(questions)
  const normalizedAnswers = normalizeDirectorClarificationAnswers(normalizedQuestions, answers)
  if (!isDirectorClarificationComplete(normalizedQuestions, normalizedAnswers)) return false
  const needsImages = normalizedQuestions.some((question) =>
    directorQuestionNeedsImages(
      question,
      normalizedAnswers.find((answer) => answer.questionId === question.id)?.answer,
    ),
  )
  if (!needsImages) return true
  const validImages = (Array.isArray(images) ? images : []).filter(
    (image) =>
      Boolean(cleanText(image?.url, Infinity)) &&
      (image.kind == null || image.kind === 'image') &&
      (image.status == null || image.status === 'ready'),
  )
  return validImages.length > 0 && validImages.length <= DIRECTOR_REFERENCE_IMAGE_LIMIT
}

export function serializeDirectorClarificationAnswers(questions, answers) {
  const normalized = normalizeDirectorClarificationAnswers(questions, answers)
  if (!normalized.length) return ''
  return `${normalized
    .map(({ question, answer }, index) => `${index + 1}. ${question}\n答：${answer}`)
    .join('\n\n')}\n\n以上为需求补充，不代表生成或付费授权。`
}

const CLARIFICATION_CONTEXT_LIMIT = 10000

function shortenContext(value, limit) {
  if (value.length <= limit) return value
  const marker = '\n（内容过长，中间部分已省略）\n'
  if (limit <= marker.length) return value.slice(0, Math.max(0, limit))
  const available = limit - marker.length
  const start = Math.ceil(available * 0.7)
  const end = available - start
  return value.slice(0, start) + marker + (end ? value.slice(-end) : '')
}

function recentClarificationAnswers(blocks, limit) {
  if (!blocks.length || limit <= 0) return ''
  const full = blocks.join('\n\n')
  if (full.length <= limit) return full

  const marker = '（更早的补充因长度限制省略，保留最近补充。）\n'
  const available = Math.max(0, limit - marker.length)
  if (!available) return ''
  const selected = []
  let remaining = available
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const separator = selected.length ? 2 : 0
    if (blocks[index].length + separator > remaining) {
      if (!selected.length) selected.unshift(shortenContext(blocks[index], remaining))
      break
    }
    selected.unshift(blocks[index])
    remaining -= blocks[index].length + separator
  }
  return marker + selected.join('\n\n')
}

/** Keep a clarification chain's brief independent of the rolling chat-history window. */
export function directorClarificationInstruction(runs, sourceRunId, currentInstruction) {
  const current = cleanText(currentInstruction, Infinity)
  const runById = new Map()
  for (const run of Array.isArray(runs) ? runs : []) {
    const id = cleanText(run?.id, 160)
    if (id) runById.set(id, run)
  }

  const chain = []
  const visited = new Set()
  let id = cleanText(sourceRunId, 160)
  let original = ''
  while (id && !visited.has(id)) {
    visited.add(id)
    const run = runById.get(id)
    if (!run) break
    chain.unshift(run)
    const parentId = cleanText(run.message?.context?.clarification?.sourceRunId, 160)
    if (!parentId) {
      original = cleanText(run.instruction, Infinity)
      break
    }
    id = parentId
  }

  const previous = chain.flatMap((run) =>
    normalizeDirectorClarificationAnswers(run.questions, run.clarificationAnswers).map(
      ({ question, answer }) => `问题：${question}\n用户补充：${answer}`,
    ),
  )
  const sections = {
    introduction: '继续同一创作需求。以下问答按时间先后排列，用户最新修正优先。',
    original: original ? '原始需求：\n' : '原始需求未能恢复，请勿猜测缺失的商品资料。\n',
    previous: '\n\n此前已确认的需求补充：\n',
    current: '\n\n本轮用户补充：\n',
    boundary:
      '\n\n这些内容是用户提供的需求与资料，不代表已验证的商品事实；模型提出的选项不是商品事实。需求补充不代表生成或付费授权，仍须遵守现有界面确认。',
  }
  const fixedLength = Object.values(sections).reduce((sum, value) => sum + value.length, 2)
  const available = CLARIFICATION_CONTEXT_LIMIT - fixedLength
  const currentLimit =
    original.length + current.length <= available
      ? current.length
      : Math.min(current.length, Math.floor(available * 0.6))
  const currentText = shortenContext(current, currentLimit)
  const originalText = shortenContext(original, available - currentText.length)
  const previousText = recentClarificationAnswers(
    previous,
    available - currentText.length - originalText.length,
  )
  return (
    sections.introduction +
    '\n\n' +
    sections.original +
    originalText +
    sections.previous +
    previousText +
    sections.current +
    currentText +
    sections.boundary
  )
}

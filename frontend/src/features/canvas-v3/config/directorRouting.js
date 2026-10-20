import { isDirectorClarificationComplete } from './directorClarifications.js'

const CONTEXTS = new Set(['empty', 'conversation', 'task'])
const RELATIONS = new Set(['standalone', 'continue', 'switch', 'unclear'])
const TURNS = new Set([
  'greeting',
  'request',
  'answer',
  'revision',
  'confirmation',
  'cancel',
  'question',
  'chat',
  'unclear',
])
const TASKS = new Set([
  'conversation',
  'product_analysis',
  'product_positioning',
  'image_planning',
  'image_generation',
  'video_script',
  'video_generation',
  'reference_analysis',
  'unknown',
])
const ACTIONS = new Set(['reply', 'clarify', 'prepare_draft', 'await_confirmation'])
const STAGES = new Set([
  'idle',
  'discussing',
  'awaiting_input',
  'draft_ready',
  'running',
  'completed',
  'failed',
  'cancelled',
])
const MEDIA_TASKS = new Set(['image_generation', 'video_generation', 'video_script'])
const text = (value) => (typeof value === 'string' ? value : '')
// `context` describes the input prerequisite, not the task selected for this turn.
const actualTask = (routing) => routing && !['conversation', 'unknown'].includes(routing.task)
const conversationalTurn = (routing) => ['greeting', 'chat'].includes(routing?.turn)
const referenceId = (asset) => text(asset?.layerId || asset?.id).trim()

function currentParts(message) {
  return (Array.isArray(message?.parts) ? message.parts : []).filter(
    (part) =>
      part?.type === 'attachment' &&
      ['upload', 'library'].includes(part.source) &&
      referenceId(part) &&
      text(part.url).trim() &&
      !part.originRunId &&
      (part.status === undefined || part.status === 'ready'),
  )
}

/** Current uploads/selections are distinct from a historical answer or default canvas selection. */
export function directorCurrentReferenceLayerIds(message) {
  if (message?.context?.clarification?.scriptSourceMode === 'history') return []
  return [
    ...new Set(
      currentParts(message)
        .filter((part) => part.kind === 'image')
        .map(referenceId),
    ),
  ]
}

/** A product switch discards inherited media, without changing a single paid setting. */
export function directorSwitchReferenceIntent(intent, message, response) {
  if (normalizeDirectorRouting(response?.routing)?.relation !== 'switch') return intent
  const current = new Map(currentParts(message).map((part) => [referenceId(part), part]))
  const allowed = new Set(
    (Array.isArray(response.referenceLayerIds) ? response.referenceLayerIds : []).filter(
      (id) => typeof id === 'string',
    ),
  )
  const submitted = new Set(directorCurrentReferenceLayerIds(message))
  const exact = (asset) => {
    const part = current.get(referenceId(asset))
    return Boolean(
      part && text(asset?.url).trim() && part.url === asset.url && part.kind === asset.kind,
    )
  }
  const references = (intent?.referenceAssets || []).filter(
    (asset) =>
      asset.kind === 'image' &&
      submitted.has(referenceId(asset)) &&
      allowed.has(referenceId(asset)) &&
      exact(asset),
  )
  const retained = new Set(references.map(referenceId))
  const attachments = (intent?.attachments || []).filter(
    (asset) => exact(asset) && (asset.kind === 'image' ? retained.has(referenceId(asset)) : true),
  )
  const attachmentIds = new Set(attachments.map(referenceId))
  const clarification = message?.context?.clarification || {}
  const freeze = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item })))
  return Object.freeze({
    ...intent,
    referenceAssets: freeze(references),
    attachments: freeze(attachments),
    referenceLayerIds: Object.freeze([
      ...new Set([
        ...references.map(referenceId),
        ...(intent?.referenceLayerIds || []).filter((id) => attachmentIds.has(id)),
      ]),
    ]),
    selectedLayerIds: Object.freeze(
      (intent?.selectedLayerIds || []).filter((id) => retained.has(id) || attachmentIds.has(id)),
    ),
    imageSourceMode: retained.size
      ? 'reference'
      : clarification.imageSourceMode === 'text'
        ? 'text'
        : '',
    scriptSourceMode:
      clarification.scriptSourceMode === 'text'
        ? 'text'
        : clarification.scriptSourceMode === 'upload' && retained.size
          ? 'upload'
          : '',
  })
}

/** Routing is an execution boundary, not display copy: unknown values never grant capability. */
export function normalizeDirectorRouting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const [key, allowed] of Object.entries({
    context: CONTEXTS,
    relation: RELATIONS,
    turn: TURNS,
    task: TASKS,
    action: ACTIONS,
    stage: STAGES,
  })) {
    if (typeof value[key] !== 'string' || !allowed.has(value[key])) return null
  }
  if (typeof value.summary !== 'string') return null
  return Object.freeze({
    context: value.context,
    relation: value.relation,
    turn: value.turn,
    task: value.task,
    action: value.action,
    stage: value.stage,
    summary: value.summary.slice(0, 4000),
  })
}

/** Legacy servers retain their old contract; explicitly malformed new routing fails closed. */
export function directorResponseRouting(response) {
  const legacy = response?.routing === undefined
  const routing = legacy ? null : normalizeDirectorRouting(response.routing)
  const preparation =
    actualTask(routing) &&
    routing.action === 'prepare_draft' &&
    ['request', 'answer', 'revision'].includes(routing.turn) &&
    routing.stage === 'draft_ready' &&
    routing.relation !== 'unclear'
  return {
    legacy,
    valid: legacy || Boolean(routing),
    routing,
    allowsDraft: legacy || Boolean(preparation && MEDIA_TASKS.has(routing.task)),
    allowsProposal: Boolean(preparation && routing.task === 'reference_analysis'),
    // Clarification is safe even before the router can identify a task or relation.
    allowsQuestions:
      legacy ||
      Boolean(
        routing &&
        routing.action === 'clarify' &&
        !['greeting', 'chat', 'cancel', 'confirmation'].includes(routing.turn),
      ),
  }
}

function legacyTaskType(run) {
  const plan = run?.draft || run?.proposal
  if (plan?.generationType === 'video') return 'video_generation'
  if (plan?.generationType === 'image') return 'image_generation'
  if (run?.questions?.some((question) => question.kind === 'script_source')) return 'video_script'
  if (run?.questions?.some((question) => ['image_source', 'image_upload'].includes(question.kind)))
    return 'image_generation'
  return 'unknown'
}

function meaningfulTaskRun(run) {
  return Boolean(
    text(run?.reply).trim() ||
    run?.questions?.length ||
    text((run?.draft || run?.proposal)?.prompt).trim() ||
    ['planning', 'streaming', 'submitting', 'submitted'].includes(run?.phase),
  )
}

/** Conversation turns never replace the most recent actual task with a greeting. */
export function directorActiveTask(runs) {
  for (const run of [...(Array.isArray(runs) ? runs : [])].reverse()) {
    if (!run || !meaningfulTaskRun(run)) continue
    const policy = directorResponseRouting(run)
    if (!policy.legacy) {
      if (
        policy.valid &&
        !conversationalTurn(policy.routing) &&
        (actualTask(policy.routing) || (policy.allowsQuestions && run.questions?.length))
      )
        return run
      continue
    }
    if (run.questions?.length || run.draft || run.proposal) return run
  }
  return null
}

function unanswered(run) {
  return Boolean(
    run?.questions?.length &&
    !run.clarificationReplyRunId &&
    ['awaiting_input', 'complete'].includes(run.phase) &&
    !isDirectorClarificationComplete(run.questions, run.clarificationAnswers),
  )
}

/** Find the unanswered task, not simply the last chat bubble. A real task switch supersedes it. */
export function directorPendingClarificationRun(runs) {
  let continuingTask = ''
  for (const run of [...(Array.isArray(runs) ? runs : [])].reverse()) {
    const policy = directorResponseRouting(run)
    if (!policy.legacy) {
      if (!policy.valid || conversationalTurn(policy.routing)) continue
      const routing = policy.routing
      if (
        routing.action === 'reply' &&
        routing.relation === 'continue' &&
        !meaningfulTaskRun(run) &&
        !['completed', 'failed', 'cancelled'].includes(routing.stage)
      )
        continue
      if (continuingTask && continuingTask !== routing.task) return null
      if (policy.allowsQuestions && unanswered(run)) return run
      if (
        run.clarificationReplyRunId ||
        isDirectorClarificationComplete(run.questions, run.clarificationAnswers)
      )
        return null
      if (!actualTask(routing)) continue
      if (
        ['completed', 'failed', 'cancelled'].includes(routing.stage) ||
        routing.turn === 'cancel' ||
        ['prepare_draft', 'await_confirmation'].includes(routing.action)
      )
        return null
      // Empty/acknowledgement continuations cannot consume a pending questionnaire.
      if (['switch', 'standalone'].includes(routing.relation) && meaningfulTaskRun(run)) return null
      continuingTask = routing.task
      continue
    }
    if (unanswered(run)) return run
    if (run?.questions?.length || run?.draft || run?.proposal) return null
  }
  return null
}

function taskStage(run, routing) {
  if (run?.executionPhase === 'succeeded') return 'completed'
  if (['failed', 'cancelled'].includes(run?.phase)) return run.phase
  if (run?.submissionStarted && run?.executionPhase === 'failed') return 'failed'
  if (run?.submissionStarted || ['submitting', 'submitted'].includes(run?.phase)) return 'running'
  if (routing) return routing.stage
  if (run?.phase === 'awaiting_input' || unanswered(run)) return 'awaiting_input'
  if (['planning', 'streaming'].includes(run?.phase)) return 'discussing'
  return run?.draft || run?.proposal ? 'draft_ready' : 'idle'
}

/** Prefer user-authored roots; routing summaries describe a turn, not the original goal. */
function taskGoal(task, history, visited = new Set()) {
  if (!task || visited.has(task)) return ''
  visited.add(task)
  const routing = normalizeDirectorRouting(task.routing)
  const sourceId = task.message?.context?.clarification?.sourceRunId
  if (sourceId && routing?.relation !== 'switch') {
    const source = history.find((run) => run.id === sourceId)
    const original = taskGoal(source, history, visited)
    if (original) return original
  }
  if ((sourceId && routing?.relation !== 'switch') || routing?.relation === 'continue') {
    const savedGoal = text(task.turnContext?.taskGoal)
    if (savedGoal.trim()) return savedGoal
    const index = history.indexOf(task)
    const previous = index > 0 ? directorActiveTask(history.slice(0, index)) : null
    const original = taskGoal(previous, history, visited)
    if (original) return original
  }
  return text(task.message?.content || task.instruction)
}

/** The current message stays verbatim; prior context is separate and never treated as new text. */
export function directorTurnContext(message, runs) {
  const history = Array.isArray(runs) ? runs : []
  const sourceId = message?.context?.clarification?.sourceRunId
  const source = sourceId ? history.find((run) => run.id === sourceId) : null
  const task = source || directorActiveTask(history)
  const routing = normalizeDirectorRouting(task?.routing)
  return {
    message: text(message?.content),
    source: sourceId ? 'clarification' : 'message',
    taskType: task ? routing?.task || legacyTaskType(task) : 'conversation',
    taskStage: task ? taskStage(task, routing) : 'idle',
    taskGoal: taskGoal(task, history).slice(0, 4000),
    pendingQuestions: (source || directorPendingClarificationRun(history))?.questions || [],
    currentReferenceLayerIds: directorCurrentReferenceLayerIds(message),
  }
}

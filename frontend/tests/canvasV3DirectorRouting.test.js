import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDirectorRouting,
  directorResponseRouting,
  directorActiveTask,
  directorCurrentReferenceLayerIds,
  directorPendingClarificationRun,
  directorSwitchReferenceIntent,
  directorTurnContext,
} from '../src/features/canvas-v3/config/directorRouting.js'

const enumValues = {
  context: ['empty', 'conversation', 'task'],
  relation: ['standalone', 'continue', 'switch', 'unclear'],
  turn: [
    'greeting',
    'request',
    'answer',
    'revision',
    'confirmation',
    'cancel',
    'question',
    'chat',
    'unclear',
  ],
  task: [
    'conversation',
    'product_analysis',
    'product_positioning',
    'image_planning',
    'image_generation',
    'video_script',
    'video_generation',
    'reference_analysis',
    'unknown',
  ],
  action: ['reply', 'clarify', 'prepare_draft', 'await_confirmation'],
  stage: [
    'idle',
    'discussing',
    'awaiting_input',
    'draft_ready',
    'running',
    'completed',
    'failed',
    'cancelled',
  ],
}

function routing(overrides = {}) {
  return {
    context: 'task',
    relation: 'standalone',
    turn: 'request',
    task: 'image_generation',
    action: 'clarify',
    stage: 'awaiting_input',
    summary: '为窗帘制作一张商品主图',
    ...overrides,
  }
}

function question(id = 'direction') {
  return { id, question: '选择主图方向', options: ['暖色卧室', '纯白背景'] }
}

function taskRun(id, route = {}, fields = {}) {
  return {
    id,
    message: { content: '为窗帘制作一张商品主图' },
    reply: '先确认主图方向。',
    phase: 'awaiting_input',
    questions: [question()],
    clarificationAnswers: [],
    clarificationReplyRunId: '',
    routing: routing(route),
    ...fields,
  }
}

function greeting(id = 'hello') {
  return taskRun(
    id,
    {
      context: 'conversation',
      relation: 'standalone',
      turn: 'greeting',
      task: 'conversation',
      action: 'reply',
      stage: 'idle',
      summary: '',
    },
    { message: { content: '你好' }, reply: '你好！', phase: 'complete', questions: [] },
  )
}

function currentImage(layerId, overrides = {}) {
  return {
    type: 'attachment',
    id: layerId,
    layerId,
    kind: 'image',
    source: 'upload',
    status: 'ready',
    url: `https://assets.example.test/${layerId}.png`,
    ...overrides,
  }
}

function referenceIntent(overrides = {}) {
  return Object.freeze({
    generationType: 'image',
    requestedModels: Object.freeze([Object.freeze({ id: 'paid-model', modality: 'image' })]),
    nodeModel: 'paid-model',
    ratio: '1:1',
    resolution: '2K',
    count: 1,
    quality: '标准画质',
    background: '自动',
    dryRun: false,
    autoGenerate: true,
    params: Object.freeze({ width: 2048, height: 2048 }),
    selectedLayerIds: Object.freeze([]),
    referenceLayerIds: Object.freeze([]),
    referenceAssets: Object.freeze([]),
    attachments: Object.freeze([]),
    imageSourceMode: 'reference',
    scriptSourceMode: 'history',
    ...overrides,
  })
}

test('normalizes the seven routing fields into a frozen record without mutating the response', () => {
  const input = { ...routing(), extra: 'must not become task authority' }
  const before = JSON.stringify(input)
  const normalized = normalizeDirectorRouting(input)

  assert.deepEqual(normalized, routing())
  assert.ok(Object.isFrozen(normalized))
  assert.notEqual(normalized, input)
  assert.equal(JSON.stringify(input), before)
  assert.equal('extra' in normalized, false)
  assert.throws(() => (normalized.action = 'prepare_draft'), TypeError)
  assert.equal(normalizeDirectorRouting(routing({ summary: '' })).summary, '')
})

test('recognizes each documented enum value without inventing new routing vocabulary', () => {
  for (const [field, values] of Object.entries(enumValues)) {
    for (const value of values) {
      const normalized = normalizeDirectorRouting(routing({ [field]: value }))
      assert.equal(normalized?.[field], value, `${field}=${value}`)
    }
  }
})

test('rejects missing, non-string and unknown routing fields instead of coercing them', () => {
  for (const field of [...Object.keys(enumValues), 'summary']) {
    const missing = routing()
    delete missing[field]
    assert.equal(normalizeDirectorRouting(missing), null, `missing ${field}`)
    for (const value of [undefined, null, 0, false, [], {}]) {
      assert.equal(
        normalizeDirectorRouting(routing({ [field]: value })),
        null,
        `${field} rejects ${JSON.stringify(value)}`,
      )
    }
  }
  for (const field of Object.keys(enumValues)) {
    for (const value of ['', 'unknown-new-value', ' prepare_draft ', 'TASK']) {
      assert.equal(normalizeDirectorRouting(routing({ [field]: value })), null)
    }
  }
  for (const value of [undefined, null, [], 'task', 1, true]) {
    assert.equal(normalizeDirectorRouting(value), null)
  }
})

test('bounds persisted task summaries and restores the same routing from JSON', () => {
  const input = routing({ summary: '商品资料'.repeat(1500) })
  const normalized = normalizeDirectorRouting(input)

  assert.equal(normalized.summary.length, 4000)
  assert.equal(input.summary.length, 6000)
  assert.deepEqual(normalizeDirectorRouting(JSON.parse(JSON.stringify(normalized))), normalized)
})

test('keeps absent routing compatible with legacy responses but never treats explicit null as legacy', () => {
  for (const response of [{}, { reply: '你好' }, { routing: undefined }]) {
    assert.deepEqual(directorResponseRouting(response), {
      legacy: true,
      valid: true,
      routing: null,
      allowsDraft: true,
      allowsProposal: false,
      allowsQuestions: true,
    })
  }
  for (const value of [null, [], 'prepare_draft', false, {}, routing({ action: 'execute' })]) {
    assert.deepEqual(directorResponseRouting({ routing: value }), {
      legacy: false,
      valid: false,
      routing: null,
      allowsDraft: false,
      allowsProposal: false,
      allowsQuestions: false,
    })
  }
})

test('only explicit media preparation grants drafts, with read-only reference proposals separate', () => {
  const draftTasks = new Set(['image_generation', 'video_generation', 'video_script'])
  for (const task of enumValues.task) {
    for (const action of enumValues.action) {
      const policy = directorResponseRouting({
        routing: routing({ task, action, stage: 'draft_ready' }),
      })
      assert.equal(policy.legacy, false)
      assert.equal(policy.valid, true)
      assert.equal(
        policy.allowsDraft,
        action === 'prepare_draft' && draftTasks.has(task),
        `${task}/${action}: draft gate`,
      )
      assert.equal(
        policy.allowsProposal,
        action === 'prepare_draft' && task === 'reference_analysis',
        `${task}/${action}: proposal gate`,
      )
      assert.equal(policy.allowsQuestions, action === 'clarify', `${task}/${action}: question gate`)
    }
  }
})

test('awaiting confirmation cannot duplicate prompts into new drafts, proposals or questions', () => {
  for (const task of enumValues.task) {
    const policy = directorResponseRouting({
      readyToGenerate: true,
      draftPrompt: '这段旧提示词不能再次建节点',
      routing: routing({ task, action: 'await_confirmation', stage: 'draft_ready' }),
    })
    assert.equal(policy.allowsDraft, false, task)
    assert.equal(policy.allowsProposal, false, task)
    assert.equal(policy.allowsQuestions, false, task)
  }
})

test('question or confirmation turns, non-ready stages and unclear relations cannot prepare media', () => {
  const blocked = [
    ...enumValues.turn
      .filter((turn) => !['request', 'answer', 'revision'].includes(turn))
      .map((turn) => ({ turn })),
    ...enumValues.stage.filter((stage) => stage !== 'draft_ready').map((stage) => ({ stage })),
    { relation: 'unclear' },
  ]
  for (const task of [
    'image_generation',
    'video_generation',
    'video_script',
    'reference_analysis',
  ]) {
    for (const fields of blocked) {
      const policy = directorResponseRouting({
        readyToGenerate: true,
        routing: routing({ task, action: 'prepare_draft', stage: 'draft_ready', ...fields }),
      })
      assert.equal(policy.allowsDraft, false, JSON.stringify({ task, ...fields }))
      assert.equal(policy.allowsProposal, false, JSON.stringify({ task, ...fields }))
    }
  }
})

test('input context does not block a first actual task from preparing its explicit draft', () => {
  for (const context of enumValues.context) {
    for (const turn of ['request', 'answer', 'revision']) {
      for (const relation of ['standalone', 'continue', 'switch']) {
        for (const task of [
          'image_generation',
          'video_generation',
          'video_script',
          'reference_analysis',
        ]) {
          const policy = directorResponseRouting({
            routing: routing({
              context,
              turn,
              relation,
              task,
              action: 'prepare_draft',
              stage: 'draft_ready',
            }),
          })
          const label = JSON.stringify({ context, turn, relation, task })
          assert.equal(policy.valid, true, label)
          assert.equal(policy.allowsDraft, task !== 'reference_analysis', label)
          assert.equal(policy.allowsProposal, task === 'reference_analysis', label)
          assert.equal(policy.allowsQuestions, false, label)
        }
      }
    }
  }
})

test('an unclear unknown task can safely ask for missing intent without acquiring draft authority', () => {
  const uncertain = taskRun(
    'unknown-question',
    {
      context: 'empty',
      relation: 'unclear',
      turn: 'unclear',
      task: 'unknown',
      action: 'clarify',
      stage: 'awaiting_input',
    },
    { message: { content: '帮我弄一下' } },
  )
  const policy = directorResponseRouting(uncertain)

  assert.equal(policy.valid, true)
  assert.equal(policy.allowsQuestions, true)
  assert.equal(policy.allowsDraft, false)
  assert.equal(policy.allowsProposal, false)
  assert.equal(directorActiveTask([uncertain]), uncertain)
  assert.equal(directorPendingClarificationRun([uncertain]), uncertain)
  assert.deepEqual(directorTurnContext({ content: '商品主图' }, [uncertain]), {
    message: '商品主图',
    source: 'message',
    taskType: 'unknown',
    taskStage: 'awaiting_input',
    taskGoal: '帮我弄一下',
    pendingQuestions: uncertain.questions,
    currentReferenceLayerIds: [],
  })
  for (const turn of ['greeting', 'chat', 'cancel', 'confirmation']) {
    assert.equal(
      directorResponseRouting({ routing: routing({ task: 'unknown', action: 'clarify', turn }) })
        .allowsQuestions,
      false,
      turn,
    )
  }
})

test('greetings, invalid routes and empty replies do not replace the latest meaningful task', () => {
  const task = taskRun('curtain')
  const emptyContinuation = taskRun(
    'empty',
    { relation: 'continue', action: 'reply' },
    { reply: '  ', questions: [], phase: 'complete' },
  )
  const invalid = taskRun('invalid', { task: 'unrecognized_task' })
  const unknown = taskRun('unknown', { task: 'unknown', action: 'reply' }, { questions: [] })
  const runs = [task, greeting(), emptyContinuation, invalid, unknown]
  const before = JSON.stringify(runs)

  assert.equal(directorActiveTask(runs), task)
  assert.equal(JSON.stringify(runs), before)
  assert.equal(directorActiveTask([greeting(), emptyContinuation, invalid, unknown]), null)
  assert.equal(directorActiveTask(null), null)
})

test('a new actual task supersedes old work and retains its user-authored goal after restoration', () => {
  const previous = taskRun('curtain')
  const latest = taskRun(
    'bed',
    {
      relation: 'switch',
      task: 'product_analysis',
      action: 'reply',
      stage: 'discussing',
      summary: '分析实木儿童床的展示方向',
    },
    {
      message: { content: '先分析这张儿童床商品图' },
      turnContext: { taskGoal: '旧窗帘任务不应带入新任务' },
      questions: [],
      phase: 'complete',
    },
  )
  const runs = [previous, latest, greeting()]

  assert.equal(directorActiveTask(runs), latest)
  const restored = JSON.parse(JSON.stringify(runs))
  assert.equal(directorActiveTask(restored), restored[1])
  assert.equal(directorPendingClarificationRun(restored), null)
  assert.deepEqual(directorTurnContext({ content: '讲得更具体些' }, restored), {
    message: '讲得更具体些',
    source: 'message',
    taskType: 'product_analysis',
    taskStage: 'discussing',
    taskGoal: '先分析这张儿童床商品图',
    pendingQuestions: [],
    currentReferenceLayerIds: [],
  })
})

test('legacy task drafts and typed source questions remain usable without treating hello as a task', () => {
  const legacyDraft = {
    id: 'draft',
    message: { content: '生成卧室场景图' },
    draft: { generationType: 'image', prompt: '暖光卧室' },
    reply: '方案已整理。',
  }
  const legacyScript = {
    id: 'script',
    message: { content: '写床垫视频脚本' },
    reply: '先确认参考素材。',
    questions: [{ ...question('source'), kind: 'script_source' }],
    phase: 'awaiting_input',
  }
  const hello = { id: 'hello', message: { content: '你好' }, reply: '你好！' }

  assert.equal(directorActiveTask([hello]), null)
  assert.equal(directorActiveTask([legacyDraft, hello]), legacyDraft)
  assert.equal(
    directorTurnContext({ content: '继续' }, [legacyDraft, hello]).taskType,
    'image_generation',
  )
  assert.equal(
    directorTurnContext({ content: '继续' }, [legacyScript, hello]).taskType,
    'video_script',
  )
  assert.equal(directorPendingClarificationRun([legacyScript, hello]), legacyScript)
})

test('a standalone greeting does not consume an unanswered questionnaire', () => {
  const pending = taskRun('pending')
  const runs = [pending, greeting()]

  assert.equal(directorPendingClarificationRun(runs), pending)
  assert.equal(directorActiveTask(runs), pending)
  assert.deepEqual(
    directorTurnContext({ content: '你好' }, runs).pendingQuestions,
    pending.questions,
  )
})

test('greeting and chat turns cannot reuse an old media task to replace its goal or questionnaire', () => {
  const pending = taskRun('pending', { summary: '模型摘要不能代替用户的原始创作目标' })
  for (const turn of ['greeting', 'chat']) {
    const conversational = taskRun(
      `old-task-${turn}`,
      {
        context: 'task',
        relation: 'continue',
        turn,
        task: 'image_generation',
        action: 'reply',
        stage: 'idle',
        summary: '你好，我是画布创作搭档',
      },
      { message: { content: '你好' }, reply: '你好！我能帮你创作。', phase: 'complete' },
    )
    const runs = [pending, conversational]

    assert.equal(directorActiveTask(runs), pending)
    assert.equal(directorPendingClarificationRun(runs), pending)
    assert.deepEqual(directorTurnContext({ content: '把背景改浅一点' }, runs), {
      message: '把背景改浅一点',
      source: 'message',
      taskType: 'image_generation',
      taskStage: 'awaiting_input',
      taskGoal: pending.message.content,
      pendingQuestions: pending.questions,
      currentReferenceLayerIds: [],
    })
  }
})

test('a persisted turn context keeps the full task goal across a greeting and short revision', () => {
  const original = taskRun(
    'original-image',
    { context: 'empty', action: 'prepare_draft', stage: 'draft_ready' },
    {
      message: { content: '给浅灰色遮光窗帘制作卧室商品主图，保留面料纹理和窗帘结构' },
      questions: [],
      phase: 'complete',
      reply: '主图方案已整理。',
    },
  )
  const message = { content: '背景换浅一点' }
  const turnContext = directorTurnContext(message, [original, greeting()])
  const revision = taskRun(
    'revision',
    {
      context: 'task',
      relation: 'continue',
      turn: 'revision',
      action: 'prepare_draft',
      stage: 'draft_ready',
      summary: '背景换浅一点',
    },
    { message, turnContext, questions: [], phase: 'complete', reply: '已调整背景。' },
  )
  const runs = [original, greeting(), revision]
  const before = JSON.stringify(runs)
  const expected = {
    message: '再柔和一点',
    source: 'message',
    taskType: 'image_generation',
    taskStage: 'draft_ready',
    taskGoal: original.message.content,
    pendingQuestions: [],
    currentReferenceLayerIds: [],
  }

  assert.equal(turnContext.message, message.content)
  assert.equal(turnContext.taskGoal, original.message.content)
  assert.equal(directorActiveTask(runs), revision)
  assert.deepEqual(directorTurnContext({ content: '再柔和一点' }, runs), expected)
  assert.deepEqual(
    directorTurnContext({ content: '再柔和一点' }, JSON.parse(JSON.stringify(runs))),
    expected,
  )
  assert.equal(JSON.stringify(runs), before)
})

test('older continued records without a saved turn context recover the previous user-authored root', () => {
  const original = taskRun(
    'root',
    { summary: '只是模型摘要，不是真实目标' },
    {
      message: { content: '为儿童床制作保留护栏和梯位的实拍感商品图' },
      questions: [],
      phase: 'complete',
    },
  )
  const revision = taskRun(
    'legacy-revision',
    {
      relation: 'continue',
      turn: 'revision',
      action: 'reply',
      stage: 'discussing',
      summary: '改暖光',
    },
    { message: { content: '改暖光' }, questions: [], phase: 'complete' },
  )
  const runs = [original, greeting(), revision]

  assert.equal(directorTurnContext({ content: '继续' }, runs).taskGoal, original.message.content)
  assert.equal(
    directorTurnContext({ content: '继续' }, JSON.parse(JSON.stringify(runs))).taskGoal,
    original.message.content,
  )
})

test('an explicit clarification ancestor takes precedence over stale saved goals and routing summaries', () => {
  const original = taskRun(
    'root',
    {},
    {
      message: { content: '写一段15秒的床垫展示视频脚本' },
      clarificationReplyRunId: 'answer',
    },
  )
  const answer = taskRun(
    'answer',
    { relation: 'continue', turn: 'answer', summary: '1:1方图' },
    {
      message: { content: '1:1', context: { clarification: { sourceRunId: 'root' } } },
      turnContext: { taskGoal: '无关历史任务，不得覆盖显式根需求' },
    },
  )

  assert.equal(
    directorTurnContext(
      { content: '下一步', context: { clarification: { sourceRunId: 'answer' } } },
      [original, answer],
    ).taskGoal,
    original.message.content,
  )
})

test('an explicit task switch starts a fresh goal despite a stale clarification parent and saved context', () => {
  const previous = taskRun('curtain-root')
  const switched = taskRun(
    'bed-script',
    {
      relation: 'switch',
      task: 'video_script',
      action: 'reply',
      stage: 'discussing',
      summary: '模型压缩摘要不能覆盖新用户目标',
    },
    {
      message: {
        content: '现在改为写实木儿童床的15秒短视频脚本，突出护栏和收纳功能',
        context: { clarification: { sourceRunId: 'curtain-root' } },
      },
      turnContext: { taskGoal: previous.message.content },
      questions: [],
      phase: 'complete',
      reply: '改为策划儿童床视频。',
    },
  )
  const runs = [previous, switched, greeting()]
  const restored = JSON.parse(JSON.stringify(runs))

  for (const records of [runs, restored]) {
    for (const message of [
      { content: '继续' },
      { content: '继续', context: { clarification: { sourceRunId: 'bed-script' } } },
    ]) {
      const context = directorTurnContext(message, records)
      assert.equal(context.taskType, 'video_script')
      assert.equal(context.taskGoal, switched.message.content)
      assert.deepEqual(context.pendingQuestions, [])
    }
  }
})

test('empty and acknowledgement continuations keep the original pending questions', () => {
  const pending = taskRun('pending')
  for (const reply of ['', ' ', '好的，我在。']) {
    const continuation = taskRun(
      'continuation',
      { relation: 'continue', action: 'reply' },
      { reply, questions: [], phase: 'complete' },
    )
    assert.equal(directorPendingClarificationRun([pending, continuation]), pending)
  }
})

test('an empty cross-task continuation cannot discard the pending questionnaire or split turn context', () => {
  const pending = taskRun('pending')
  for (const task of ['video_script', 'product_analysis']) {
    for (const reply of ['', '  \n']) {
      const empty = taskRun(
        'empty',
        {
          relation: 'continue',
          task,
          action: 'reply',
          stage: 'awaiting_input',
          summary: '空续接中的其他任务不能替代当前窗帘任务',
        },
        { reply, questions: [], phase: 'complete' },
      )
      const runs = [pending, empty]
      const expectedContext = directorTurnContext({ content: '1' }, [pending])

      assert.equal(directorActiveTask(runs), pending)
      assert.equal(directorPendingClarificationRun(runs), pending)
      assert.deepEqual(directorTurnContext({ content: '1' }, runs), expectedContext)

      const restored = JSON.parse(JSON.stringify(runs))
      assert.equal(directorActiveTask(restored), restored[0])
      assert.equal(directorPendingClarificationRun(restored), restored[0])
      assert.deepEqual(directorTurnContext({ content: '1' }, restored), expectedContext)
    }
  }
})

test('a new task switch supersedes older questions even when the task type is unchanged', () => {
  const previous = taskRun('old')
  for (const task of ['image_generation', 'video_script']) {
    const latest = taskRun(
      'new',
      { relation: 'switch', task, action: 'reply', stage: 'discussing' },
      { reply: '改为处理新的商品。', questions: [], phase: 'complete' },
    )
    assert.equal(directorPendingClarificationRun([previous, latest, greeting()]), null, task)
  }
  const differentContinuation = taskRun(
    'different-task',
    { relation: 'continue', task: 'video_script', action: 'reply' },
    { questions: [] },
  )
  assert.equal(directorPendingClarificationRun([previous, differentContinuation]), null)
})

test('returns the newest unanswered questionnaire rather than a superseded source', () => {
  const previous = taskRun('old')
  const latest = taskRun(
    'new',
    { relation: 'switch', task: 'video_script', summary: '编写儿童床15秒视频脚本' },
    { questions: [question('duration')] },
  )

  assert.equal(directorPendingClarificationRun([previous, latest, greeting()]), latest)
})

test('answered questionnaires cannot be reused or fall back to older unanswered ones', () => {
  const previous = taskRun('old')
  for (const completed of [
    { clarificationReplyRunId: 'submitted-answer' },
    { clarificationAnswers: [{ questionId: 'direction', answer: '暖色卧室' }] },
  ]) {
    const answered = taskRun('answered', { relation: 'continue' }, completed)
    assert.equal(directorPendingClarificationRun([previous, answered, greeting()]), null)
    const legacy = { ...answered }
    delete legacy.routing
    assert.equal(directorPendingClarificationRun([previous, legacy]), null)
  }
  const partial = taskRun(
    'partial',
    {},
    {
      questions: [question('direction'), { ...question('ratio'), question: '选择图片比例' }],
      clarificationAnswers: [{ questionId: 'direction', answer: '暖色卧室' }],
    },
  )
  assert.equal(directorPendingClarificationRun([partial]), partial)
})

test('an answered unknown-intent questionnaire cannot revive an older media questionnaire', () => {
  const previous = taskRun('old-image-question')
  for (const completed of [
    { clarificationReplyRunId: 'new-answer' },
    { clarificationAnswers: [{ questionId: 'intent', answer: '暖色卧室' }] },
  ]) {
    const answered = taskRun(
      'unknown-intent',
      {
        context: 'empty',
        relation: 'unclear',
        turn: 'unclear',
        task: 'unknown',
        action: 'clarify',
      },
      {
        message: { content: '帮我弄一下' },
        questions: [question('intent')],
        ...completed,
      },
    )
    const runs = [previous, answered, greeting()]
    const restored = JSON.parse(JSON.stringify(runs))

    assert.equal(directorActiveTask(runs), answered)
    assert.equal(directorPendingClarificationRun(runs), null)
    assert.equal(directorActiveTask(restored), restored[1])
    assert.equal(directorPendingClarificationRun(restored), null)
    for (const records of [runs, restored]) {
      const context = directorTurnContext({ content: '继续' }, records)
      assert.equal(context.taskType, 'unknown')
      assert.equal(context.taskGoal, answered.message.content)
      assert.deepEqual(context.pendingQuestions, [])
    }
  }
})

test('terminal stages and draft or confirmation actions end pending input without restarting old questions', () => {
  const previous = taskRun('old')
  const updates = [
    ...['completed', 'failed', 'cancelled'].map((stage) => ({ stage })),
    { turn: 'cancel' },
    { action: 'prepare_draft', stage: 'draft_ready' },
    { action: 'await_confirmation', stage: 'draft_ready' },
  ]
  for (const route of updates) {
    const latest = taskRun(
      'latest',
      { relation: 'continue', action: 'reply', ...route },
      { reply: '当前阶段已更新。', questions: [], phase: 'complete' },
    )
    assert.equal(directorPendingClarificationRun([previous, latest]), null, JSON.stringify(route))
  }
  assert.equal(directorPendingClarificationRun(null), null)
})

test('a new conversation starts with a verbatim message and no fabricated task history', () => {
  assert.deepEqual(directorTurnContext({ content: '  你好\n' }, []), {
    message: '  你好\n',
    source: 'message',
    taskType: 'conversation',
    taskStage: 'idle',
    taskGoal: '',
    pendingQuestions: [],
    currentReferenceLayerIds: [],
  })
  assert.deepEqual(directorTurnContext(null, null), {
    message: '',
    source: 'message',
    taskType: 'conversation',
    taskStage: 'idle',
    taskGoal: '',
    pendingQuestions: [],
    currentReferenceLayerIds: [],
  })
})

test('short clarification answers stay verbatim and never become a synthesized history instruction', () => {
  const pending = taskRun(
    'pending',
    {},
    {
      instruction: '历史合成上下文，不能作为当前输入',
      reply: '模型建议，不能作为本轮用户输入',
    },
  )
  const message = {
    content: '  1\n',
    context: { clarification: { sourceRunId: 'pending' } },
    instruction: '另一段合成指令，不能覆盖原始短答',
  }
  const before = JSON.stringify({ pending, message })

  assert.deepEqual(directorTurnContext(message, [pending, greeting()]), {
    message: '  1\n',
    source: 'clarification',
    taskType: 'image_generation',
    taskStage: 'awaiting_input',
    taskGoal: '为窗帘制作一张商品主图',
    pendingQuestions: pending.questions,
    currentReferenceLayerIds: [],
  })
  assert.equal(JSON.stringify({ pending, message }), before)
})

test('legacy clarification ancestry recovers the original task goal, not nested synthesized instructions', () => {
  const original = {
    id: 'original',
    message: { content: '为实木儿童床制作15秒展示视频' },
    instruction: '旧的合成历史，不应覆盖根消息',
    reply: '请确认方向。',
    questions: [{ ...question('source'), kind: 'script_source' }],
    phase: 'awaiting_input',
    clarificationReplyRunId: 'follow-up',
  }
  const current = {
    id: 'follow-up',
    message: { content: '1', context: { clarification: { sourceRunId: 'original' } } },
    instruction: '重复嵌套的历史，不是原始需求',
    reply: '请选择视频参考素材。',
    questions: [{ ...question('source'), kind: 'script_source' }],
    phase: 'awaiting_input',
  }
  const context = directorTurnContext(
    { content: '仅根据文字策划', context: { clarification: { sourceRunId: 'follow-up' } } },
    [original, current],
  )

  assert.equal(context.message, '仅根据文字策划')
  assert.equal(context.taskGoal, original.message.content)
  assert.equal(context.taskType, 'video_script')
  assert.deepEqual(context.pendingQuestions, current.questions)
})

test('JSON-restored runs preserve task, pending source and current answer independently of object identity', () => {
  const previous = taskRun(
    'previous',
    {},
    {
      clarificationAnswers: [{ questionId: 'direction', answer: '暖色卧室' }],
      clarificationReplyRunId: 'latest',
    },
  )
  const latest = taskRun(
    'latest',
    { relation: 'continue', turn: 'answer' },
    {
      message: { content: '暖色卧室', context: { clarification: { sourceRunId: 'previous' } } },
      questions: [question('size')],
    },
  )
  const message = { content: '1:1', context: { clarification: { sourceRunId: 'latest' } } }
  const runs = [previous, latest, greeting()]
  const restored = JSON.parse(JSON.stringify(runs))

  assert.equal(directorActiveTask(restored), restored[1])
  assert.equal(directorPendingClarificationRun(restored), restored[1])
  assert.deepEqual(directorTurnContext(message, restored), directorTurnContext(message, runs))
  assert.deepEqual(normalizeDirectorRouting(restored[1].routing), latest.routing)
})

test('submitted state overrides a stale draft-ready route for routed and legacy tasks', () => {
  for (const legacy of [false, true]) {
    for (const fields of [
      { submissionStarted: true, phase: 'complete' },
      { submissionStarted: false, phase: 'submitted' },
      { phase: 'submitting' },
    ]) {
      const run = taskRun(
        'submitted',
        { action: 'prepare_draft', stage: 'draft_ready' },
        {
          questions: [],
          reply: '图片方案已整理。',
          draft: { generationType: 'image', prompt: '卧室窗帘商品图' },
          ...fields,
        },
      )
      if (legacy) delete run.routing
      const before = JSON.stringify(run)

      assert.equal(directorTurnContext({ content: '进度如何' }, [run]).taskStage, 'running')
      assert.equal(JSON.stringify(run), before)
    }
  }
})

test('execution results override both running state and stale routing after JSON restoration', () => {
  for (const legacy of [false, true]) {
    for (const [executionPhase, expected] of [
      ['succeeded', 'completed'],
      ['failed', 'failed'],
    ]) {
      const run = taskRun(
        'execution',
        { action: 'prepare_draft', stage: 'draft_ready' },
        {
          questions: [],
          reply: '图片方案已整理。',
          draft: { generationType: 'image', prompt: '卧室窗帘商品图' },
          phase: 'submitted',
          submissionStarted: true,
          executionPhase,
        },
      )
      if (legacy) delete run.routing
      const restored = JSON.parse(JSON.stringify(run))

      assert.equal(directorTurnContext({ content: '结果如何' }, [run]).taskStage, expected)
      assert.equal(directorTurnContext({ content: '结果如何' }, [restored]).taskStage, expected)
    }
  }
})

test('failed and cancelled run phases override the route instead of reporting a reusable draft', () => {
  for (const legacy of [false, true]) {
    for (const phase of ['failed', 'cancelled']) {
      const run = taskRun(
        'stopped',
        { action: 'prepare_draft', stage: 'draft_ready' },
        {
          questions: [],
          reply: '当前任务已停止。',
          draft: { generationType: 'image', prompt: '卧室窗帘商品图' },
          submissionStarted: true,
          phase,
        },
      )
      if (legacy) delete run.routing

      assert.equal(directorTurnContext({ content: '现在是什么状态' }, [run]).taskStage, phase)
    }
  }
})

test('current reference IDs include only ready uploads or library images explicitly attached this turn', () => {
  const uploaded = currentImage('uploaded-node', { id: 'uploaded-file' })
  const library = currentImage('', {
    id: 'library-file',
    source: 'library',
    status: undefined,
    url: 'https://assets.example.test/library.png',
  })
  const message = {
    content: '用这两张新商品图',
    parts: [
      uploaded,
      library,
      { ...uploaded },
      null,
      currentImage('canvas', { source: 'canvas' }),
      currentImage('historical', { originRunId: 'old-run' }),
      currentImage('generated', { source: 'generated' }),
      currentImage('wrong-type', { type: 'image' }),
      currentImage('video', { kind: 'video' }),
      currentImage('document', { kind: 'file' }),
      currentImage('no-url', { url: '' }),
      currentImage('', { id: '' }),
      ...['uploading', 'pending', 'error', 'failed', 'cancelled', null, false, 0, ''].map(
        (status) => currentImage(`not-ready-${String(status)}`, { status }),
      ),
    ],
    selectedLayerIds: ['default-canvas-image'],
    referenceLayerIds: ['inherited-image'],
    generationIntent: { referenceAssets: [currentImage('inherited-image')] },
  }
  const before = JSON.stringify(message)

  assert.deepEqual(directorCurrentReferenceLayerIds(message), ['uploaded-node', 'library-file'])
  assert.deepEqual(directorCurrentReferenceLayerIds(JSON.parse(before)), [
    'uploaded-node',
    'library-file',
  ])
  assert.equal(JSON.stringify(message), before)
  assert.deepEqual(directorCurrentReferenceLayerIds(null), [])
  assert.deepEqual(directorCurrentReferenceLayerIds({ parts: {} }), [])
})

test('historical script reference selection never becomes a new reference upload', () => {
  const message = {
    content: '沿用历史商品图',
    parts: [currentImage('history-selection')],
    context: { clarification: { sourceRunId: 'old-question', scriptSourceMode: 'history' } },
  }

  assert.deepEqual(directorCurrentReferenceLayerIds(message), [])
  assert.deepEqual(directorTurnContext(message, []).currentReferenceLayerIds, [])
  assert.deepEqual(
    directorCurrentReferenceLayerIds({
      ...message,
      context: { clarification: { scriptSourceMode: 'upload' } },
    }),
    ['history-selection'],
  )
})

test('turn context reports only this message reference IDs instead of earlier task assets', () => {
  const previous = taskRun(
    'previous',
    {},
    {
      message: { content: '旧商品主图', parts: [currentImage('old-product')] },
      generationIntent: referenceIntent({ referenceAssets: [currentImage('old-product')] }),
    },
  )
  const message = { content: '换商品', parts: [currentImage('new-product')] }
  const context = directorTurnContext(message, [previous])

  assert.deepEqual(context.currentReferenceLayerIds, ['new-product'])
  assert.deepEqual(
    directorTurnContext({ content: '换商品' }, [previous]).currentReferenceLayerIds,
    [],
  )
  assert.deepEqual(
    directorTurnContext(JSON.parse(JSON.stringify(message)), JSON.parse(JSON.stringify([previous])))
      .currentReferenceLayerIds,
    ['new-product'],
  )
})

test('a task switch intersects exact current image IDs and URLs while retaining current non-image attachments', () => {
  const oldImage = Object.freeze(currentImage('old-image', { source: 'canvas' }))
  const uploaded = Object.freeze(currentImage('new-upload', { id: 'upload-file' }))
  const library = Object.freeze(currentImage('new-library', { source: 'library' }))
  const brief = Object.freeze(currentImage('new-brief', { kind: 'file', url: 'brief-document' }))
  const audio = Object.freeze(currentImage('new-audio', { kind: 'audio', url: 'voice-track' }))
  const oldBrief = Object.freeze(currentImage('old-brief', { kind: 'file', url: 'old-document' }))
  const intent = referenceIntent({
    selectedLayerIds: Object.freeze(['old-image', 'new-upload', 'new-brief', 'default-canvas']),
    referenceLayerIds: Object.freeze([
      'old-image',
      'new-upload',
      'new-library',
      'old-brief',
      'new-brief',
      'new-audio',
    ]),
    referenceAssets: Object.freeze([oldImage, uploaded, library]),
    attachments: Object.freeze([oldImage, uploaded, library, oldBrief, brief, audio]),
  })
  const message = { content: '改做新商品', parts: [uploaded, library, brief, audio] }
  const response = {
    routing: routing({ relation: 'switch' }),
    referenceLayerIds: ['old-image', 'new-upload', 'new-library', 'unknown-image'],
  }
  const before = JSON.stringify({ intent, message, response })
  const next = directorSwitchReferenceIntent(intent, message, response)

  assert.notEqual(next, intent)
  assert.deepEqual(next.referenceAssets, [uploaded, library])
  assert.deepEqual(next.attachments, [uploaded, library, brief, audio])
  assert.deepEqual(next.referenceLayerIds, ['new-upload', 'new-library', 'new-brief', 'new-audio'])
  assert.deepEqual(next.selectedLayerIds, ['new-upload', 'new-brief'])
  assert.equal(next.imageSourceMode, 'reference')
  assert.equal(next.scriptSourceMode, '')
  for (const key of [
    'generationType',
    'requestedModels',
    'nodeModel',
    'ratio',
    'resolution',
    'count',
    'quality',
    'background',
    'dryRun',
    'autoGenerate',
    'params',
  ]) {
    assert.equal(next[key], intent[key], key)
  }
  for (const value of [
    next,
    next.referenceAssets,
    next.attachments,
    next.referenceLayerIds,
    next.selectedLayerIds,
    ...next.referenceAssets,
    ...next.attachments,
  ]) {
    assert.ok(Object.isFrozen(value))
  }
  assert.equal(JSON.stringify({ intent, message, response }), before)
  assert.deepEqual(
    directorSwitchReferenceIntent(
      JSON.parse(JSON.stringify(intent)),
      JSON.parse(JSON.stringify(message)),
      JSON.parse(JSON.stringify(response)),
    ),
    next,
  )
})

test('a switch cannot retain aliases, inherited-only IDs or a current ID whose actual asset URL differs', () => {
  const current = currentImage('current-node', { id: 'file-alias' })
  const old = currentImage('old-node')
  const response = { routing: routing({ relation: 'switch' }), referenceLayerIds: ['current-node'] }
  const scenarios = [
    {
      intent: referenceIntent({ referenceAssets: [current] }),
      message: { parts: [current] },
      response: { ...response, referenceLayerIds: ['file-alias'] },
    },
    {
      intent: referenceIntent({ referenceAssets: [old] }),
      message: { parts: [current] },
      response: { ...response, referenceLayerIds: ['old-node'] },
    },
    {
      intent: referenceIntent({
        referenceAssets: [{ ...current, url: 'https://assets.example.test/stale-version.png' }],
      }),
      message: { parts: [current] },
      response,
    },
    {
      intent: referenceIntent({ referenceAssets: [current] }),
      message: { parts: [current] },
      response: { routing: response.routing },
    },
    {
      intent: referenceIntent({ referenceAssets: [current] }),
      message: { parts: [current] },
      response: { ...response, referenceLayerIds: [null, 1, {}, 'not-present'] },
    },
  ]
  for (const scenario of scenarios) {
    const before = JSON.stringify(scenario)
    const next = directorSwitchReferenceIntent(scenario.intent, scenario.message, scenario.response)
    assert.deepEqual(next.referenceAssets, [])
    assert.deepEqual(next.attachments, [])
    assert.deepEqual(next.referenceLayerIds, [])
    assert.deepEqual(next.selectedLayerIds, [])
    assert.equal(JSON.stringify(scenario), before)
  }
})

test('a switch resets inherited source modes but retains explicit current text or upload choices', () => {
  const image = currentImage('new-product')
  const intent = referenceIntent({ referenceAssets: [image], attachments: [image] })
  const response = { routing: routing({ relation: 'switch' }), referenceLayerIds: ['new-product'] }
  const history = directorSwitchReferenceIntent(
    intent,
    { parts: [image], context: { clarification: { scriptSourceMode: 'history' } } },
    response,
  )
  assert.deepEqual(history.referenceAssets, [])
  assert.deepEqual(history.attachments, [])
  assert.equal(history.imageSourceMode, '')
  assert.equal(history.scriptSourceMode, '')

  const text = directorSwitchReferenceIntent(
    intent,
    { context: { clarification: { imageSourceMode: 'text', scriptSourceMode: 'text' } } },
    response,
  )
  assert.deepEqual(text.referenceAssets, [])
  assert.equal(text.imageSourceMode, 'text')
  assert.equal(text.scriptSourceMode, 'text')

  const upload = directorSwitchReferenceIntent(
    intent,
    { parts: [image], context: { clarification: { scriptSourceMode: 'upload' } } },
    response,
  )
  assert.deepEqual(upload.referenceAssets, [image])
  assert.equal(upload.imageSourceMode, 'reference')
  assert.equal(upload.scriptSourceMode, 'upload')

  const unselectedUpload = directorSwitchReferenceIntent(
    intent,
    { parts: [image], context: { clarification: { scriptSourceMode: 'upload' } } },
    { routing: response.routing, referenceLayerIds: [] },
  )
  assert.equal(unselectedUpload.imageSourceMode, '')
  assert.equal(unselectedUpload.scriptSourceMode, '')
})

test('non-switch or invalid routing returns the original frozen intent by identity', () => {
  const image = currentImage('image')
  const intent = referenceIntent({ referenceAssets: [image] })
  for (const response of [
    undefined,
    {},
    { routing: null },
    { routing: { relation: 'switch' } },
    { routing: routing({ relation: 'switch', action: 'unknown-action' }) },
    ...['standalone', 'continue', 'unclear'].map((relation) => ({
      routing: routing({ relation }),
    })),
  ]) {
    assert.equal(directorSwitchReferenceIntent(intent, { parts: [image] }, response), intent)
  }
})

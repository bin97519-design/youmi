import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { latestDirectorConversation } from '../src/features/canvas-v3/config/directorRecentConversation.js'
import { dedupeDirectorAgentRuns } from '../src/features/canvas-v3/config/directorConversation.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const functionNames = [
  'openPanel',
  'closeDirector',
  'loadDirectorConversations',
  'markDirectorConversationActive',
  'restoreLatestDirectorConversation',
  'startDirectorConversation',
  'selectDirectorConversation',
]
const source = functionNames
  .map((name) => {
    const body = shell.match(
      new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
    )?.[0]
    assert.ok(body, `missing actual Shell lifecycle function ${name}`)
    return body
  })
  .join('\n\n')

const plain = (value) => JSON.parse(JSON.stringify(value))
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return { promise, resolve, reject }
}
const conversation = (id, updatedAt, overrides = {}) => ({
  id,
  canvasId: 'home-canvas',
  updatedAt,
  messages: [
    { role: 'user', id: `user-${id}`, content: `问题 ${id}`, display: `问题 ${id}` },
    {
      role: 'assistant',
      run: {
        id: `run-${id}`,
        clientMessageId: `user-${id}`,
        reply: `回复 ${id}`,
        phase: 'complete',
      },
    },
  ],
  ...overrides,
})

function harness(options = {}) {
  const requests = []
  const calls = []
  const timers = new Map()
  let timerId = 0
  let conversationId = 0
  const context = {
    props: { projectId: 'home-canvas' },
    user: { token: 'test-token', authHeaders: () => ({ Authorization: 'test' }) },
    activePanel: { value: '' },
    menuPosition: { value: null },
    zoomMenu: { value: false },
    agentOrb: { value: { focus: () => calls.push('focus') } },
    directorAgentRuns: { value: options.runs || [] },
    directorConversations: { value: options.conversations || [] },
    directorConversationId: { value: 'initial-new-conversation' },
    directorRestoredMessages: { value: [] },
    directorConversationLoading: { value: false },
    directorConversationLoadError: { value: '' },
    directorRestoring: { value: false },
    directorRestoreError: { value: '' },
    directorConversationInitialized: false,
    directorConversationRevision: 0,
    directorHistoryRequest: null,
    directorRecentRequest: null,
    directorDisposed: false,
    directorConversationDeletedIds: new Set(),
    directorConversationSyncTimer: 0,
    latestDirectorConversation,
    dedupeDirectorAgentRuns,
    AbortController,
    apiPath: (url) => url,
    async nextTick() {},
    directorImagePlan: () => false,
    directorSubmissionStarted: () => false,
    async ensureDirectorDraftNode() {
      assert.fail('restoration must not prepare a non-image chat run')
    },
    updateDirectorRun() {},
    directorRequestId: () => `new-conversation-${++conversationId}`,
    async saveDirectorConversation() {
      calls.push('save')
    },
    stopDirectorConversationWork() {
      calls.push('stop')
    },
    async readDirectorApiResponse(response) {
      return response
    },
    fetch(url, request) {
      const pending = deferred()
      requests.push({ url, request, ...pending })
      return pending.promise
    },
    window: {
      setTimeout(callback, delay) {
        const id = ++timerId
        timers.set(id, { callback, delay })
        return id
      },
      clearTimeout(id) {
        timers.delete(id)
      },
    },
  }
  context.ui = {
    togglePanel(panel) {
      context.activePanel.value = context.activePanel.value === panel ? '' : panel
    },
  }
  const methods = runInNewContext(`${source}\n({ ${functionNames.join(', ')} })`, context)
  return { context, methods, requests, calls, timers }
}

test('opening Director restores the latest valid conversation for this canvas with a single GET', async () => {
  const { context, methods, requests } = harness()
  methods.openPanel('assistant')
  assert.equal(context.activePanel.value, 'assistant')
  assert.equal(context.directorRestoring.value, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/ai/canvas-agent/conversations?canvasId=home-canvas')
  assert.equal(requests[0].request.method, undefined)
  const waiting = methods.restoreLatestDirectorConversation()
  requests[0].resolve([
    conversation('older', 1),
    conversation('foreign', 999, { canvasId: 'another-canvas' }),
    conversation('latest', 2),
    conversation('empty', 999, { messages: [] }),
  ])
  await waiting
  assert.equal(context.directorConversationId.value, 'latest')
  assert.equal(context.directorAgentRuns.value[0].reply, '回复 latest')
  assert.equal(context.directorRestoredMessages.value[0].content, '问题 latest')
  assert.equal(context.directorConversationInitialized, true)
  assert.equal(context.directorRestoring.value, false)
  assert.equal(context.directorRestoreError.value, '')
  assert.equal(requests.length, 1)
})

test('a genuinely empty history initializes a new conversation and does not reload on reopen', async () => {
  const { context, methods, requests } = harness()
  const restoring = methods.restoreLatestDirectorConversation()
  requests[0].resolve([])
  await restoring
  assert.equal(context.directorConversationInitialized, true)
  assert.equal(context.directorConversationId.value, 'initial-new-conversation')
  assert.deepEqual(plain(context.directorAgentRuns.value), [])
  methods.openPanel('assistant')
  await methods.closeDirector()
  methods.openPanel('assistant')
  await methods.restoreLatestDirectorConversation()
  assert.equal(requests.length, 1)
  assert.equal(context.directorRestoreError.value, '')
})

test('closing and reopening preserves the exact current in-memory conversation without a GET', async () => {
  const runs = [{ id: 'current-run', reply: '尚未保存的回复', phase: 'streaming' }]
  const { context, methods, requests, calls } = harness({ runs })
  context.directorConversationId.value = 'current-conversation'
  methods.openPanel('assistant')
  await methods.closeDirector()
  methods.openPanel('assistant')
  await methods.restoreLatestDirectorConversation()
  assert.equal(context.directorAgentRuns.value, runs)
  assert.equal(context.directorConversationId.value, 'current-conversation')
  assert.equal(context.activePanel.value, 'assistant')
  assert.equal(requests.length, 0)
  assert.ok(calls.includes('save'))
  assert.ok(calls.includes('focus'))
})

test('overlapping history and restore requests coalesce into one GET', async () => {
  const { context, methods, requests } = harness()
  const history = methods.loadDirectorConversations()
  const restoreA = methods.restoreLatestDirectorConversation()
  const restoreB = methods.restoreLatestDirectorConversation()
  assert.equal(requests.length, 1)
  requests[0].resolve([conversation('latest', 1)])
  await Promise.all([history, restoreA, restoreB])
  assert.equal(context.directorConversationId.value, 'latest')
  assert.equal(context.directorHistoryRequest, null)
  assert.equal(context.directorRecentRequest, null)
  assert.equal(context.directorConversationLoading.value, false)
})

test('explicit New wins over an older in-flight restore and remains blank on reopening', async () => {
  const { context, methods, requests } = harness()
  const pending = methods.restoreLatestDirectorConversation()
  methods.startDirectorConversation()
  const freshId = context.directorConversationId.value
  requests[0].resolve([conversation('old-history', 100)])
  await pending
  assert.equal(context.directorConversationId.value, freshId)
  assert.deepEqual(plain(context.directorAgentRuns.value), [])
  assert.deepEqual(plain(context.directorRestoredMessages.value), [])
  assert.equal(context.directorConversationInitialized, true)
  methods.openPanel('assistant')
  await methods.restoreLatestDirectorConversation()
  assert.equal(requests.length, 1)
  assert.equal(context.directorConversationId.value, freshId)
})

test('explicit history selection cannot be overwritten by an older in-flight automatic restore', async () => {
  const { context, methods, requests } = harness()
  const pending = methods.restoreLatestDirectorConversation()
  methods.selectDirectorConversation(conversation('chosen', 1))
  requests[0].resolve([conversation('latest-but-not-chosen', 99)])
  await pending
  assert.equal(context.directorConversationId.value, 'chosen')
  assert.equal(context.directorAgentRuns.value[0].reply, '回复 chosen')
  assert.equal(context.directorRestoredMessages.value[0].content, '问题 chosen')
})

test('sending a new message marks the conversation active before stale restore data arrives', async () => {
  const { context, methods, requests } = harness()
  const pending = methods.restoreLatestDirectorConversation()
  methods.markDirectorConversationActive()
  const newRuns = [{ id: 'new-message-run', instruction: '新发的问题', phase: 'planning' }]
  context.directorAgentRuns.value = newRuns
  requests[0].resolve([conversation('stale', 99)])
  await pending
  assert.equal(context.directorAgentRuns.value, newRuns)
  assert.equal(context.directorRestoring.value, false)
  assert.equal(context.directorRestoreError.value, '')
})

test('token, canvas, and disposal changes each prevent stale GET data from restoring', async () => {
  for (const invalidate of [
    (context) => {
      context.user.token = 'other-token'
    },
    (context) => {
      context.props.projectId = 'other-canvas'
    },
    (context) => {
      context.directorDisposed = true
    },
  ]) {
    const existing = conversation('existing-list', 1)
    const { context, methods, requests } = harness({ conversations: [existing] })
    const pending = methods.restoreLatestDirectorConversation()
    invalidate(context)
    requests[0].resolve([conversation('stale', 99)])
    await pending
    assert.equal(context.directorConversationId.value, 'initial-new-conversation')
    assert.deepEqual(plain(context.directorAgentRuns.value), [])
    assert.equal(context.directorConversations.value[0], existing)
    assert.equal(context.directorConversationInitialized, false)
    assert.equal(context.directorRestoring.value, false)
    assert.equal(context.directorRestoreError.value, '')
  }
})

test('a failed load retains existing history, exposes retry, and a successful retry restores', async () => {
  const existing = conversation('cached', 1)
  const { context, methods, requests } = harness({ conversations: [existing] })
  const first = methods.restoreLatestDirectorConversation()
  requests[0].reject(new Error('网络暂时不可用'))
  await first
  assert.equal(context.directorConversations.value[0], existing)
  assert.equal(context.directorRestoreError.value, '网络暂时不可用')
  assert.equal(context.directorConversationInitialized, false)
  assert.equal(context.directorRestoring.value, false)
  const retry = methods.restoreLatestDirectorConversation()
  assert.equal(context.directorRestoreError.value, '')
  assert.equal(requests.length, 2)
  requests[1].resolve([conversation('retried-latest', 2)])
  await retry
  assert.equal(context.directorConversationId.value, 'retried-latest')
  assert.equal(context.directorConversationInitialized, true)
  assert.equal(context.directorConversationLoadError.value, '')
})

test('abort timeout exposes an actionable restore error and deleted conversations are skipped', async () => {
  const { context, methods, requests, timers } = harness()
  const timedOut = methods.restoreLatestDirectorConversation()
  const timer = [...timers.values()].find((entry) => entry.delay === 5000)
  assert.ok(timer)
  timer.callback()
  assert.equal(requests[0].request.signal.aborted, true)
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  requests[0].reject(abort)
  await timedOut
  assert.match(context.directorRestoreError.value, /加载超时.*重试/)
  context.directorConversationDeletedIds.add('deleted-newest')
  const retry = methods.restoreLatestDirectorConversation()
  requests[1].resolve([conversation('valid', 1), conversation('deleted-newest', 99)])
  await retry
  assert.equal(context.directorConversationId.value, 'valid')
})

test('opening unrelated panels and unauthenticated Director do not request or execute tasks', async () => {
  const { context, methods, requests } = harness()
  methods.openPanel('shortcuts')
  assert.equal(requests.length, 0)
  context.user.token = ''
  methods.openPanel('assistant')
  await methods.restoreLatestDirectorConversation()
  assert.equal(requests.length, 0)
  assert.equal(context.directorConversationInitialized, false)
  assert.doesNotMatch(
    source,
    /tasks\.(?:runImage|runVideo)|submitDirectorDraft|confirmDirectorGeneration/,
  )
})

test('legacy runs backfill their exact preceding user turn including stable IDs and rich metadata', () => {
  const { context, methods } = harness()
  const records = [
    {
      role: 'user',
      content: '带参考图的旧问题',
      raw: '@床垫 生成场景图',
      parts: [{ type: 'image', url: '/reference.jpg' }],
      context: { clarification: { sourceRunId: 'source-run' } },
    },
    { role: 'assistant', run: { id: 'legacy-run', reply: '旧版回复', phase: 'complete' } },
    { role: 'user', id: 'last-unanswered', content: '还没有回复的补充问题' },
  ]
  const before = JSON.stringify(records)
  methods.selectDirectorConversation({ id: 'legacy-conversation', messages: records })
  assert.equal(context.directorRestoredMessages.value[0].id, 'restored-message-0')
  assert.equal(context.directorAgentRuns.value[0].message.id, 'restored-message-0')
  assert.deepEqual(plain(context.directorAgentRuns.value[0].message.parts), records[0].parts)
  assert.equal(context.directorAgentRuns.value[0].message.raw, '@床垫 生成场景图')
  assert.equal(
    context.directorAgentRuns.value[0].message.context.clarification.sourceRunId,
    'source-run',
  )
  assert.equal(context.directorRestoredMessages.value[1].id, 'last-unanswered')
  assert.equal(JSON.stringify(records), before)
})

test('restored interrupted replies retain partial text and interrupted paid submissions become read-only recovery', () => {
  const { context, methods, requests } = harness()
  const records = [
    { role: 'user', id: 'user-a', content: '问题 A' },
    { role: 'assistant', run: { id: 'planning', phase: 'planning', reply: '已收到的部分内容 A' } },
    { role: 'user', id: 'user-b', content: '问题 B' },
    {
      role: 'assistant',
      run: { id: 'streaming', phase: 'streaming', reply: '已收到的部分内容 B' },
    },
    { role: 'user', id: 'user-c', content: '确认生成' },
    {
      role: 'assistant',
      run: { id: 'submission', phase: 'submitting', clientTaskId: 'stable-paid-task' },
    },
  ]
  methods.selectDirectorConversation({ id: 'interrupted', messages: records })
  const [planning, streaming, submission] = context.directorAgentRuns.value
  assert.equal(planning.phase, 'failed')
  assert.equal(streaming.phase, 'failed')
  assert.equal(planning.reply, '已收到的部分内容 A')
  assert.equal(streaming.reply, '已收到的部分内容 B')
  assert.match(planning.error, /中断.*重试/)
  assert.equal(submission.phase, 'ready')
  assert.equal(submission.submissionStarted, true)
  assert.equal(submission.submissionState, 'uncertain')
  assert.equal(submission.clientTaskId, 'stable-paid-task')
  assert.match(submission.error, /不会重复扣费/)
  assert.equal(requests.length, 0)
  assert.equal(records[1].run.phase, 'planning')
  assert.equal(records[3].run.phase, 'streaming')
  assert.equal(records[5].run.phase, 'submitting')
})

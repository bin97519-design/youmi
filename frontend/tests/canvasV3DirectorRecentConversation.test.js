import test from 'node:test'
import assert from 'node:assert/strict'
import {
  directorMessagesFromRuns,
  latestDirectorConversation,
  mergeDirectorConversationMessages,
} from '../src/features/canvas-v3/config/directorRecentConversation.js'

const conversation = (id, updatedAt, overrides = {}) => ({
  id,
  canvasId: 'home-canvas',
  updatedAt,
  messages: [{ role: 'user', id: `message-${id}`, content: `你好 ${id}` }],
  ...overrides,
})

test('latest conversation is chosen by update time rather than list position', () => {
  const first = conversation('older', 10)
  const latest = conversation('latest', 30)
  const middle = conversation('middle', 20)
  assert.equal(latestDirectorConversation([first, latest, middle], 'home-canvas'), latest)
})

test('latest conversation supports ISO, local date, numeric strings, and createdAt fallback', () => {
  const numeric = conversation('numeric', '1000')
  const iso = conversation('iso', '2026-10-19T04:00:00Z')
  const local = conversation('local', '2026-10-20 12:00:00')
  const created = conversation('created', 'invalid', { createdAt: '2026-10-21T04:00:00Z' })
  assert.equal(latestDirectorConversation([numeric, iso, local], 'home-canvas'), local)
  assert.equal(latestDirectorConversation([created, iso, local], 'home-canvas'), created)
  assert.equal(
    latestDirectorConversation([conversation('zero', 0), numeric], 'home-canvas'),
    numeric,
  )
})

test('only this canvas or server-scoped rows may be restored', () => {
  const own = conversation('own', 10)
  const scoped = conversation('scoped', 20, { canvasId: undefined })
  const foreign = conversation('foreign', 9999, { canvasId: 'other-canvas' })
  assert.equal(latestDirectorConversation([foreign, own], 'home-canvas'), own)
  assert.equal(latestDirectorConversation([foreign, own, scoped], 'home-canvas'), scoped)
  assert.equal(latestDirectorConversation([foreign], 'home-canvas'), null)
})

test('blank, empty, and malformed newer rows cannot hide the most recent valid history', () => {
  const valid = conversation('valid', 1)
  assert.equal(
    latestDirectorConversation(
      [
        null,
        [],
        'bad',
        conversation('  ', 100),
        conversation({}, 100),
        conversation('empty', 100, { messages: [] }),
        conversation('malformed', 100, { messages: [null, [], 'bad', { role: 'assistant' }] }),
        conversation('blank-user', 100, { messages: [{ role: 'user', content: '   ' }] }),
        conversation('empty-run', 100, { messages: [{ role: 'assistant', run: { id: 'run' } }] }),
        valid,
      ],
      'home-canvas',
    ),
    valid,
  )
  assert.equal(latestDirectorConversation(null, 'home-canvas'), null)
  assert.equal(latestDirectorConversation({}, 'home-canvas'), null)
})

test('assistant-only replies, image drafts, active runs, and user attachments remain displayable', () => {
  for (const run of [
    { id: 'run', reply: '你好' },
    { id: 'run', error: '连接失败' },
    { id: 'run', thinkingText: '正在整理需求' },
    { id: 'run', questions: [{ question: '什么商品？' }] },
    { id: 'run', proposal: { prompts: ['床垫的家居场景图'] } },
    { id: 'run', draft: { prompt: '窗帘场景图' } },
    { id: 'run', phase: 'planning' },
  ]) {
    const row = conversation('assistant-only', 1, { messages: [{ role: 'assistant', run }] })
    assert.equal(latestDirectorConversation([row], 'home-canvas'), row)
  }
  const attachment = conversation('attachment', 1, {
    messages: [{ role: 'user', parts: [{ type: 'image', url: '/product.jpg' }] }],
  })
  assert.equal(latestDirectorConversation([attachment], 'home-canvas'), attachment)
})

test('equal, invalid, and absent timestamps keep stable server input order', () => {
  const first = conversation('first', 'invalid')
  const second = conversation('second', undefined)
  assert.equal(latestDirectorConversation([first, second], 'home-canvas'), first)
  const datedFirst = conversation('dated-first', 10)
  const datedSecond = conversation('dated-second', 10)
  assert.equal(latestDirectorConversation([datedFirst, datedSecond], 'home-canvas'), datedFirst)
  assert.equal(latestDirectorConversation([first, datedFirst], 'home-canvas'), datedFirst)
})

test('restoring runs preserves exact rich messages and clarification sources without mutating them', () => {
  const message = {
    id: 'user-1',
    content: '帮我作图',
    display: '制作商品主图',
    raw: '帮我作图 @床垫',
    parts: [
      { type: 'model', id: 'banana2' },
      { type: 'image', url: '/mattress.jpg' },
    ],
    attachments: [{ id: 'product-1', url: '/mattress.jpg', referenceRole: 'product' }],
    dryRunIntent: false,
    context: { clarification: { sourceRunId: 'source-run', answers: [{ answer: '床垫' }] } },
  }
  const before = JSON.stringify(message)
  const restored = directorMessagesFromRuns([{ id: 'run-1', message }])
  assert.deepEqual(restored, [message])
  assert.notEqual(restored[0], message)
  assert.equal(restored[0].context.clarification.sourceRunId, 'source-run')
  assert.equal(JSON.stringify(message), before)
})

test('newest duplicate user payload wins while its original turn position stays unchanged', () => {
  const restored = directorMessagesFromRuns([
    { id: 'old-run', message: { id: 'user-1', content: '旧记录' } },
    { id: 'next-run', message: { id: 'user-2', content: '下一轮' } },
    { id: 'new-run', message: { id: 'user-1', content: '更新后的记录' } },
  ])
  assert.deepEqual(restored, [
    { id: 'user-1', content: '更新后的记录' },
    { id: 'user-2', content: '下一轮' },
  ])
})

test('legacy runs synthesize user message IDs and display text and preserve partial rich metadata', () => {
  const restored = directorMessagesFromRuns([
    {
      id: 'run-1',
      clientMessageId: 'legacy-user',
      display: '原始问题',
      instruction: '包含上下文的完整问题',
      dryRun: false,
      message: {
        parts: [{ type: 'image', url: '/reference.jpg' }],
        attachments: [{ id: 'reference' }],
        context: { clarification: { sourceRunId: 'original-run' } },
      },
    },
    { id: 'run-2', instruction: '你好' },
  ])
  assert.equal(restored[0].id, 'legacy-user')
  assert.equal(restored[0].content, '包含上下文的完整问题')
  assert.equal(restored[0].display, '原始问题')
  assert.equal(restored[0].raw, '包含上下文的完整问题')
  assert.equal(restored[0].dryRunIntent, false)
  assert.deepEqual(restored[0].parts, [{ type: 'image', url: '/reference.jpg' }])
  assert.deepEqual(restored[0].attachments, [{ id: 'reference' }])
  assert.equal(restored[0].context.clarification.sourceRunId, 'original-run')
  assert.equal(restored[1].id, 'run-2')
  assert.equal(restored[1].display, '你好')
  assert.equal(restored[1].dryRunIntent, true)
})

test('reconstruction ignores malformed entries and raw conversation message wrappers', () => {
  assert.deepEqual(directorMessagesFromRuns(null), [])
  assert.deepEqual(directorMessagesFromRuns({}), [])
  assert.deepEqual(
    directorMessagesFromRuns([
      null,
      [],
      'bad',
      {},
      { id: {} },
      { role: 'user', id: 'raw-user', content: '不是 run' },
      { role: 'assistant', run: { id: 'raw-assistant' } },
    ]),
    [],
  )
})

test('saving a restored conversation preserves an orphan user turn after the last assistant run', () => {
  const userA = { role: 'user', id: 'user-a', content: '原始问题 A' }
  const userB = { role: 'user', id: 'user-b', content: '尚未收到回复的问题 B' }
  const assistantA = { role: 'assistant', run: { id: 'run-a', reply: '回复 A' } }
  assert.deepEqual(mergeDirectorConversationMessages([userA, userB], [[userA, assistantA]]), [
    userA,
    assistantA,
    userB,
  ])
})

test('roundtrip serialization retains original order and rich orphan messages then appends new turns', () => {
  const userA = {
    role: 'user',
    id: 'user-a',
    content: '参考这张床垫图',
    raw: '参考 @床垫',
    parts: [{ type: 'image', url: '/mattress.jpg' }],
    attachments: [{ id: 'product-reference', url: '/mattress.jpg' }],
    context: { clarification: { sourceRunId: 'previous-run' } },
  }
  const userB = {
    role: 'user',
    id: 'user-b',
    content: '补充问题，没有回复也要保留',
    parts: [{ type: 'text', text: '补充' }],
  }
  const userC = { role: 'user', id: 'user-c', content: '新一轮问题' }
  const assistantA = { role: 'assistant', run: { id: 'run-a', reply: '回复 A' } }
  const assistantC = { role: 'assistant', run: { id: 'run-c', reply: '回复 C' } }
  const originals = [userA, userB]
  const pairs = [
    [{ role: 'user', id: 'user-a', content: '已更新 A' }, assistantA],
    [userC, assistantC],
  ]
  const before = JSON.stringify({ originals, pairs })
  const merged = mergeDirectorConversationMessages(originals, pairs)
  assert.deepEqual(
    merged.map((message) => message.id || message.run.id),
    ['user-a', 'run-a', 'user-b', 'user-c', 'run-c'],
  )
  assert.deepEqual(merged[0], { ...userA, content: '已更新 A' })
  assert.deepEqual(merged[2], userB)
  assert.equal(JSON.stringify({ originals, pairs }), before)
  assert.notEqual(merged[0], userA)
  const serializedRoundtrip = JSON.parse(JSON.stringify(merged))
  assert.deepEqual(
    mergeDirectorConversationMessages(
      serializedRoundtrip.filter((message) => message.role === 'user'),
      [
        [serializedRoundtrip[0], serializedRoundtrip[1]],
        [userC, assistantC],
      ],
    ),
    serializedRoundtrip,
  )
})

test('newest duplicate pair payload wins in the first slot using normalized user IDs', () => {
  const originalA = { role: 'user', id: ' user-a ', content: '旧 A' }
  const originalB = { role: 'user', id: 'user-b', content: '旧 B' }
  const pair = (id, content, runId) => [
    { role: 'user', id, content },
    { role: 'assistant', run: { id: runId, reply: content } },
  ]
  const merged = mergeDirectorConversationMessages(
    [originalA, originalB, { ...originalA, content: '重复 A' }],
    [
      pair('user-a', '旧回复 A', 'run-a-old'),
      pair('user-c', '旧回复 C', 'run-c-old'),
      pair('user-d', '回复 D', 'run-d'),
      pair(' user-a ', '最新回复 A', 'run-a-new'),
      pair(' user-c ', '最新回复 C', 'run-c-new'),
    ],
  )
  assert.deepEqual(
    merged.map((message) => message.id || message.run.id),
    ['user-a', 'run-a-new', 'user-b', 'user-c', 'run-c-new', 'user-d', 'run-d'],
  )
  assert.equal(merged[0].content, '最新回复 A')
  assert.equal(merged[3].content, '最新回复 C')
})

test('merge keeps unmatched and anonymous users and safely ignores malformed pairs', () => {
  const orphan = { role: 'user', content: '历史中没有 ID 的问题' }
  const merged = mergeDirectorConversationMessages(
    [null, [], orphan, { role: 'assistant', run: { id: 'not-a-user' } }],
    [
      null,
      {},
      [],
      [null, {}],
      [{ role: 'assistant', id: 'not-a-user' }],
      [{ role: 'user', id: 'new', content: '只有用户消息' }],
    ],
  )
  assert.deepEqual(merged, [orphan, { role: 'user', id: 'new', content: '只有用户消息' }])
  assert.deepEqual(mergeDirectorConversationMessages(null, null), [])
})

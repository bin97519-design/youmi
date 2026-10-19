import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dedupeDirectorAgentRuns,
  directorConversationItems,
  directorClarificationAssetsIntent,
  directorRequestContextLayers,
  directorRunDisplayText,
  directorRunReplyContext,
} from '../src/features/canvas-v3/config/directorConversation.js'

test('keeps only the newest Agent run for one user message', () => {
  const runs = [
    { id: 'run-old', clientMessageId: 'message-1', reply: '旧回复' },
    { id: 'run-new', clientMessageId: 'message-1', reply: '新回复' },
  ]

  assert.deepEqual(dedupeDirectorAgentRuns(runs), [runs[1]])
})

test('preserves turn order while replacing a duplicated run in place', () => {
  const runs = [
    { id: 'run-1-old', clientMessageId: 'message-1', reply: '旧回复' },
    { id: 'run-2', clientMessageId: 'message-2', reply: '第二轮' },
    { id: 'run-1-new', clientMessageId: 'message-1', reply: '第一轮更新回复' },
  ]

  assert.deepEqual(dedupeDirectorAgentRuns(runs), [runs[2], runs[1]])
})

test('falls back to run id for legacy records without a message id', () => {
  const runs = [
    { id: 'legacy', reply: '旧记录' },
    { id: 'legacy', reply: '修复后的记录' },
    { id: 'other', reply: '另一轮' },
  ]

  assert.deepEqual(dedupeDirectorAgentRuns(runs), [runs[1], runs[2]])
})

test('questionnaire continuations preserve Agent turn order without a duplicate user bubble', () => {
  const messages = [
    { id: 'request', display: '你能帮我写脚本吗' },
    { id: 'answers-1', context: { clarification: { sourceRunId: 'run-1' } } },
    { id: 'answers-2', context: { clarification: { sourceRunId: 'run-2' } } },
    { id: 'revision', display: '把最后一个镜头换掉' },
  ]
  const runs = messages.map((message, index) => ({
    id: `run-${index + 1}`,
    clientMessageId: message.id,
  }))
  const items = directorConversationItems(messages, runs)
  assert.deepEqual(
    items.map(({ key }) => key),
    ['request', 'run-1', 'run-2', 'run-3', 'revision', 'run-4'],
  )
  assert.deepEqual(directorConversationItems(JSON.parse(JSON.stringify(messages)), runs), items)
  assert.equal(items.filter(({ type }) => type === 'user').length, 2)
  assert.deepEqual(directorConversationItems([], [{ id: 'restored-orphan' }]), [
    { type: 'agent', key: 'restored-orphan', run: { id: 'restored-orphan' } },
  ])
})

test('copying a response includes the full script and does not duplicate identical text', () => {
  const script =
    '## 床垫15秒脚本\n\n| 镜号 | 时长 | 画面 |\n| --- | --- | --- |\n| 01 | 0–4s | 暖光 |'
  assert.equal(
    directorRunDisplayText({ reply: '这是方案', proposal: { prompts: [script] } }),
    `这是方案\n\n${script}`,
  )
  assert.equal(directorRunDisplayText({ reply: script, draft: { prompt: script } }), script)
})

test('clarification uploads extend references without modifying frozen model or paid parameters', () => {
  const intent = Object.freeze({
    requestedModels: [{ id: 'original-model' }],
    generationType: 'image',
    ratio: '1:1',
    resolution: '2K',
    count: 1,
    selectedLayerIds: ['old-node'],
    attachments: [{ id: 'old-upload', layerId: 'old-upload', kind: 'image', url: 'old-url' }],
    referenceAssets: [{ id: 'old-upload', layerId: 'old-upload', kind: 'image', url: 'old-url' }],
    referenceLayerIds: ['old-upload'],
  })
  const added = [
    { id: 'product', layerId: 'product', kind: 'image', url: 'product-url' },
    { id: 'brief', layerId: 'brief', kind: 'file', url: 'brief-url' },
  ]
  const next = directorClarificationAssetsIntent(intent, added)
  for (const key of [
    'requestedModels',
    'generationType',
    'ratio',
    'resolution',
    'count',
    'selectedLayerIds',
  ])
    assert.deepEqual(next[key], intent[key])
  assert.deepEqual(next.referenceLayerIds, ['old-upload', 'product', 'brief'])
  assert.deepEqual(
    next.referenceAssets.map(({ url }) => url),
    ['old-url', 'product-url'],
  )
  assert.equal(next.attachments.length, 3)
  assert.equal(intent.attachments.length, 1)
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.attachments))
  assert.equal(directorClarificationAssetsIntent(intent, []), intent)
})

test('follow-up history includes the asked choices and full draft instead of only a short reply', () => {
  const fullDraft = '床垫分镜完整正文'.repeat(600)
  const content = directorRunReplyContext({
    reply: '请确认风格',
    questions: [{ id: 'style', question: '你想要什么风格？', options: ['自然家居', '复古质感'] }],
    draft: { prompts: [fullDraft] },
  })
  assert.ok(content.includes('你想要什么风格？'))
  assert.ok(content.includes('自然家居；复古质感'))
  assert.ok(content.includes(fullDraft))
  assert.equal(directorRunReplyContext({ reply: '你好' }), '你好')
  assert.ok(
    directorRunReplyContext({ proposal: { prompts: ['未选模型时保留的视频方案'] } }).includes(
      '未选模型时保留的视频方案',
    ),
  )
})

test('clarification request keeps original references after nodes change or are deleted', () => {
  const current = [
    { id: 'changed', type: 'image', url: 'new-image', width: 900, height: 600 },
    { id: 'same', type: 'image', url: 'same-image', width: 300, height: 200 },
  ]
  const intent = {
    referenceAssets: [
      { id: 'changed', kind: 'image', url: 'original-image' },
      { id: 'deleted', kind: 'image', url: 'deleted-original-image' },
      { id: 'same', kind: 'image', url: 'same-image' },
    ],
    attachments: [{ layerId: 'upload', kind: 'image', url: 'upload-image' }],
  }
  const layers = directorRequestContextLayers(current, intent)
  assert.equal(layers.find((layer) => layer.id === 'changed').url, 'original-image')
  assert.equal(layers.find((layer) => layer.id === 'changed').width, null)
  assert.equal(layers.find((layer) => layer.id === 'same').width, 300)
  assert.equal(layers.find((layer) => layer.id === 'deleted').url, 'deleted-original-image')
  assert.equal(layers.find((layer) => layer.id === 'upload').url, 'upload-image')
  assert.equal(current[0].url, 'new-image')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  groupExecutionPlan,
  groupExecutionApprovalSignature,
  createGroupExecutionRunner,
} from '../src/features/canvas-v3/config/groupExecution.js'
import {
  GROUP_TOOLBOX_LIMIT,
  groupToolboxKey,
  loadGroupToolbox,
  saveGroupToolbox,
  removeGroupToolbox,
  groupToolboxSnapshot,
} from '../src/features/canvas-v3/config/groupToolbox.js'

const node = (id, data = {}) => ({
  id,
  position: { x: 10, y: 20 },
  data: {
    kind: 'image',
    title: id,
    groupId: 'g',
    groupName: 'Group 1',
    groupType: 'normal',
    prompt: `generate ${id}`,
    model: 'configured-image',
    params: { ratio: '16:9' },
    runState: 'idle',
    ...data,
  },
})
const edge = (source, target) => ({ id: `${source}-${target}`, source, target })
const store = () => {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  }
}
function harness(initial = [node('a'), node('b')], initialEdges = []) {
  let nodes = initial
  let edges = initialEdges
  let scope = { projectId: 'p', userId: 'a', token: 'not-copied' }
  const submitted = []
  const progress = []
  const submit = async (id) => {
    submitted.push(id)
    nodes.find((item) => item.id === id).data.runState = 'queued'
  }
  const finish = async (id) => {
    const current = nodes.find((item) => item.id === id)
    current.data.runState = 'succeeded'
    current.data.assetUrl = `https://cdn.example.test/${id}.png`
  }
  const options = {
    getNodes: () => nodes,
    getEdges: () => edges,
    getScope: () => scope,
    runImage: submit,
    runVideo: submit,
    waitForResult: finish,
    onProgress: (value) => progress.push(value),
  }
  return {
    get nodes() {
      return nodes
    },
    setNodes: (value) => {
      nodes = value
    },
    setEdges: (value) => {
      edges = value
    },
    setScope: (value) => {
      scope = value
    },
    submitted,
    progress,
    finish,
    options,
  }
}

test('group plan is read-only, skips existing material and unsupported/missing-prompt nodes', () => {
  const nodes = [
    node('reference', { assetUrl: 'https://cdn.example.test/ref.png' }),
    node('text', { kind: 'text' }),
    node('empty', { prompt: '' }),
    node('image'),
    node('video', { kind: 'video' }),
  ]
  const before = structuredClone(nodes)
  const plan = groupExecutionPlan(nodes, [], 'g')
  assert.deepEqual(plan.order, ['image', 'video'])
  assert.equal(plan.skipped.length, 3)
  assert.equal(plan.generationCount, 2)
  assert.deepEqual(nodes, before)
  nodes[3].data.prompt = 'later edit'
  assert.equal(JSON.stringify(plan).includes('later edit'), false)
})

test('plan sorts dependencies and permits ready media to act as an existing reference', () => {
  const nodes = [
    node('c'),
    node('b'),
    node('a'),
    node('ready', { assetUrl: 'https://cdn.example.test/x.png' }),
  ]
  const plan = groupExecutionPlan(nodes, [edge('a', 'b'), edge('b', 'c'), edge('ready', 'a')], 'g')
  assert.deepEqual(plan.order, ['a', 'b', 'c'])
})

test('execution approval signature binds prompt, model, params, references, wires and member identities', () => {
  const original = [
    node('a'),
    node('b'),
    node('outside', { groupId: '', assetUrl: 'https://cdn.example.test/original.png' }),
  ]
  const edges = [edge('outside', 'a')]
  const approved = groupExecutionApprovalSignature(original, edges, 'g')
  for (const mutate of [
    (nodes) => {
      nodes[0].data.prompt = 'changed prompt'
    },
    (nodes) => {
      nodes[0].data.model = 'another-model'
    },
    (nodes) => {
      nodes[0].data.params.ratio = '9:16'
    },
    (nodes) => {
      nodes[0].data.mode = '首尾帧'
    },
    (nodes) => {
      nodes[2].data.assetUrl = 'https://cdn.example.test/changed.png'
    },
    (nodes) => {
      nodes[2].data.prompt = 'changed external input'
    },
    (nodes) => {
      nodes[1].id = 'new-identity'
    },
    (nodes) => {
      nodes.push(node('c'))
    },
  ]) {
    const changed = structuredClone(original)
    mutate(changed)
    assert.notEqual(groupExecutionApprovalSignature(changed, edges, 'g'), approved)
  }
  assert.notEqual(
    groupExecutionApprovalSignature(original, [...edges, edge('a', 'b')], 'g'),
    approved,
  )
})

test('approval signature ignores status feedback, dimensions and node movement, and is stable for object key order', () => {
  const nodes = [node('a', { params: { ratio: '16:9', quality: 'standard' } }), node('b')]
  const approved = groupExecutionApprovalSignature(nodes, [], 'g')
  nodes[0].position = { x: 300, y: 900 }
  nodes[0].dimensions = { width: 800, height: 900 }
  Object.assign(nodes[0].data, {
    progress: 43,
    statusText: 'UI feedback',
    error: 'old feedback',
    mediaWidth: 200,
    mediaHeight: 100,
    runState: 'failed',
  })
  nodes[0].data.params = { quality: 'standard', ratio: '16:9' }
  assert.equal(groupExecutionApprovalSignature(nodes, [], 'g'), approved)
})

test('source-image references without explicit wires are included in execution approval', () => {
  const nodes = [
    node('a', { sourceImageNodeId: 'outside' }),
    node('b'),
    node('outside', { groupId: '', assetUrl: 'https://cdn.example.test/original.png' }),
  ]
  const approved = groupExecutionApprovalSignature(nodes, [], 'g')
  nodes[2].data.assetUrl = 'https://cdn.example.test/new.png'
  assert.notEqual(groupExecutionApprovalSignature(nodes, [], 'g'), approved)
})

test('invalid groups and duplicate identities are rejected before any execution', () => {
  assert.throws(() => groupExecutionPlan([], [], ''), /完整分组/)
  assert.throws(() => groupExecutionPlan([node('a')], [], 'g'), /2～100/)
  assert.throws(() => groupExecutionPlan([node('a'), node('a')], [], 'g'), /标识重复/)
  assert.throws(
    () =>
      groupExecutionPlan(
        Array.from({ length: 101 }, (_, i) => node(String(i))),
        [],
        'g',
      ),
    /2～100/,
  )
})

test('cycles, missing/empty/active references fail preflight', () => {
  const nodes = [node('a'), node('b')]
  assert.throws(() => groupExecutionPlan(nodes, [edge('a', 'b'), edge('b', 'a')], 'g'), /循环/)
  assert.throws(() => groupExecutionPlan(nodes, [edge('a', 'a')], 'g'), /循环/)
  assert.throws(() => groupExecutionPlan(nodes, [edge('missing', 'a')], 'g'), /移除/)
  assert.throws(
    () =>
      groupExecutionPlan(
        [...nodes, node('ref', { groupId: '', prompt: '' })],
        [edge('ref', 'a')],
        'g',
      ),
    /尚无可用素材/,
  )
  assert.throws(
    () =>
      groupExecutionPlan(
        [...nodes, node('ref', { groupId: '', runState: 'queued' })],
        [edge('ref', 'a')],
        'g',
      ),
    /仍在生成/,
  )
  assert.throws(
    () =>
      groupExecutionPlan(
        [...nodes, node('text', { groupId: '', kind: 'text', prompt: '' })],
        [edge('text', 'a')],
        'g',
      ),
    /没有可用文本/,
  )
})

test('all task ambiguity and persistence states block whole-group preflight', () => {
  for (const runState of ['preparing', 'submitting', 'queued', 'running', 'paused', 'uncertain'])
    assert.throws(
      () => groupExecutionPlan([node('a', { runState }), node('b')], [], 'g'),
      /待确认任务/,
    )
  for (const generation of [
    { queryPending: true },
    { persistPending: true },
    { unresolvedTaskIds: ['old'] },
  ])
    assert.throws(
      () => groupExecutionPlan([node('a', { generation }), node('b')], [], 'g'),
      /待确认任务/,
    )
})

test('construction is inert; explicit runner waits for each real result before downstream submit', async () => {
  const h = harness([node('video', { kind: 'video' }), node('image')], [edge('image', 'video')])
  const events = []
  const runner = createGroupExecutionRunner({
    ...h.options,
    runImage: async (id) => {
      events.push(`submit:${id}`)
      await h.options.runImage(id)
    },
    runVideo: async (id) => {
      assert.ok(h.nodes.find((item) => item.id === 'image').data.assetUrl)
      events.push(`submit:${id}`)
      await h.options.runVideo(id)
    },
    waitForResult: async (id) => {
      events.push(`wait:${id}`)
      await h.finish(id)
    },
  })
  assert.deepEqual(h.submitted, [])
  const result = await runner.run('g')
  assert.deepEqual(events, ['submit:image', 'wait:image', 'submit:video', 'wait:video'])
  assert.deepEqual(result.completedIds, ['image', 'video'])
  assert.equal(result.completedCount, 2)
  assert.equal(runner.busy, false)
  assert.equal(h.progress.length, 4)
})

test('model normalization after submission is allowed, while untouched downstream edits abort', async () => {
  const h = harness()
  const runner = createGroupExecutionRunner({
    ...h.options,
    waitForResult: async (id) => {
      h.nodes.find((item) => item.id === id).data.params = { normalized: true }
      await h.finish(id)
    },
  })
  assert.equal((await runner.run('g')).completedCount, 2)
  const second = harness()
  const stale = createGroupExecutionRunner({
    ...second.options,
    waitForResult: async (id) => {
      await second.finish(id)
      second.nodes[1].data.prompt = 'not authorized in the confirmed batch'
    },
  })
  await assert.rejects(stale.run('g'), /输入已改变/)
  assert.deepEqual(second.submitted, ['a'])
})

test('scope switch after submission prevents further dispatch', async () => {
  const h = harness()
  const runner = createGroupExecutionRunner({
    ...h.options,
    waitForResult: async (id) => {
      await h.finish(id)
      h.setScope({ projectId: 'other', userId: 'a' })
    },
  })
  await assert.rejects(runner.run('g'), /画布或账号已切换/)
  assert.deepEqual(h.submitted, ['a'])
  assert.equal(runner.busy, false)
})

test('membership, node identity, wiring and external reference changes stop remaining jobs', async () => {
  for (const mutate of [
    (h) => {
      h.nodes[1].data.groupId = 'other'
    },
    (h) => h.setNodes(h.nodes.map((item) => ({ ...item }))),
    (h) => h.setEdges([edge('a', 'b')]),
    (h) => {
      h.nodes[2].data.assetUrl = 'https://cdn.example.test/changed.png'
    },
    (h) => {
      h.nodes[2].data.prompt = 'new external text'
    },
  ]) {
    const h = harness(
      [
        node('a'),
        node('b'),
        node('outside', { groupId: '', assetUrl: 'https://cdn.example.test/ref.png' }),
      ],
      [edge('outside', 'a')],
    )
    const runner = createGroupExecutionRunner({
      ...h.options,
      waitForResult: async (id) => {
        await h.finish(id)
        mutate(h)
      },
    })
    await assert.rejects(runner.run('g'), /输入已改变/)
    assert.deepEqual(h.submitted, ['a'])
  }
})

test('failure or unconfirmed result never runs downstream and exposes accurate progress', async () => {
  const h = harness()
  const runner = createGroupExecutionRunner({
    ...h.options,
    waitForResult: async () => {},
  })
  await assert.rejects(runner.run('g'), (error) => {
    assert.equal(error.completedCount, 0)
    assert.deepEqual(error.startedIds, ['a'])
    return /尚无成功结果/.test(error.message)
  })
  assert.deepEqual(h.submitted, ['a'])
})

test('busy click and cancellation never resubmit an existing task', async () => {
  const h = harness()
  const controller = new AbortController()
  let release
  const waitForResult = () =>
    new Promise((resolve) => {
      release = resolve
    })
  const runner = createGroupExecutionRunner({ ...h.options, waitForResult })
  const running = runner.run('g', { signal: controller.signal })
  await Promise.resolve()
  await assert.rejects(runner.run('g'), /重复点击/)
  controller.abort()
  release()
  await assert.rejects(running, { name: 'AbortError' })
  assert.deepEqual(h.submitted, ['a'])
  assert.equal(runner.busy, false)
})

test('a URL with pending result persistence is not treated as a completed upstream task', async () => {
  const h = harness()
  const runner = createGroupExecutionRunner({
    ...h.options,
    waitForResult: async (id) => {
      await h.finish(id)
      h.nodes[0].data.generation = { persistPending: true }
    },
  })
  await assert.rejects(runner.run('g'), /尚无成功结果/)
  assert.deepEqual(h.submitted, ['a'])
})

test('default waiter reports failed/ambiguous nodes and times out without downstream dispatch', async () => {
  for (const state of ['failed', 'uncertain', 'paused', 'idle']) {
    const h = harness()
    const runner = createGroupExecutionRunner({
      ...h.options,
      waitForResult: undefined,
      runImage: async (id) => {
        h.submitted.push(id)
        h.nodes[0].data.runState = state
      },
    })
    await assert.rejects(runner.run('g'), /未完成/)
    assert.deepEqual(h.submitted, ['a'])
  }
  const h = harness()
  const runner = createGroupExecutionRunner({
    ...h.options,
    waitForResult: undefined,
    timeoutMs: -1,
  })
  await assert.rejects(runner.run('g'), /等待生成结果超时/)
  assert.deepEqual(h.submitted, ['a'])
})

test('completed/skipped-only groups do not submit anything', async () => {
  const h = harness([
    node('a', { assetUrl: 'https://cdn.example.test/a.png' }),
    node('b', { prompt: '' }),
  ])
  const result = await createGroupExecutionRunner(h.options).run('g')
  assert.equal(result.completedCount, 0)
  assert.equal(result.plan.skipped.length, 2)
  assert.deepEqual(h.submitted, [])
})

test('toolbox snapshots are account-isolated, real persistent, and safe to import repeatedly', () => {
  const storage = store()
  const nodes = [
    node('a', {
      assetUrl: 'https://cdn.example.test/a.png',
      generation: { secret: 'never-copy' },
      params: { apiKey: 'never-copy', ratio: '16:9' },
    }),
    node('b'),
  ]
  const before = structuredClone(nodes)
  const record = saveGroupToolbox(
    storage,
    'account-a',
    { nodes, edges: [edge('a', 'b'), edge('outside', 'a')], groupId: 'g' },
    { id: () => 'template1', now: () => 123 },
  )
  assert.equal(record.nodeCount, 2)
  assert.equal(record.createdAt, 123)
  assert.equal(JSON.stringify(record).includes('never-copy'), false)
  assert.equal(loadGroupToolbox(storage, 'account-a').length, 1)
  assert.deepEqual(loadGroupToolbox(storage, 'account-b'), [])
  const snapshot = groupToolboxSnapshot(record)
  assert.equal(snapshot.edges.length, 1)
  assert.equal(snapshot.nodes[0].data.groupId, 'g')
  snapshot.nodes[0].data.prompt = 'changed copy'
  assert.notEqual(groupToolboxSnapshot(record).nodes[0].data.prompt, 'changed copy')
  assert.deepEqual(nodes, before)
})

test('toolbox refuses unauthenticated, incomplete, active and oversize templates', () => {
  const storage = store()
  assert.equal(groupToolboxKey(''), '')
  assert.deepEqual(loadGroupToolbox(storage, ''), [])
  assert.throws(
    () => saveGroupToolbox(storage, '', { nodes: [node('a'), node('b')], groupId: 'g' }),
    /先登录/,
  )
  assert.throws(
    () => saveGroupToolbox(storage, 'a', { nodes: [node('a')], groupId: 'g' }),
    /完整分组/,
  )
  assert.throws(
    () =>
      saveGroupToolbox(storage, 'a', {
        nodes: [node('a', { runState: 'queued' }), node('b')],
        groupId: 'g',
      }),
    /任务/,
  )
  assert.throws(
    () =>
      saveGroupToolbox(storage, 'a', {
        nodes: [
          node('a', { assetUrl: `data:image/png;base64,${'A'.repeat(5 * 1024 * 1024)}` }),
          node('b'),
        ],
        groupId: 'g',
      }),
    /上限|过大|超/,
  )
})

test('toolbox validates stored records and tolerates corruption or denied reads', () => {
  const storage = store()
  const key = groupToolboxKey('a')
  storage.setItem(key, '{broken')
  assert.deepEqual(loadGroupToolbox(storage, 'a'), [])
  storage.setItem(key, '[{"id":"x","name":"broken","snapshot":"{}"}]')
  assert.deepEqual(loadGroupToolbox(storage, 'a'), [])
  assert.deepEqual(
    loadGroupToolbox(
      {
        getItem() {
          throw new Error('denied')
        },
      },
      'a',
    ),
    [],
  )
  assert.throws(() => groupToolboxSnapshot({}), /模板无效/)
})

test('toolbox failures are not reported as saves, and removal is account-local', () => {
  const storage = store()
  const options = { nodes: [node('a'), node('b')], groupId: 'g' }
  assert.throws(
    () =>
      saveGroupToolbox(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota')
          },
        },
        'a',
        options,
      ),
    /保存失败/,
  )
  saveGroupToolbox(storage, 'a', options, { id: () => 'one' })
  assert.equal(removeGroupToolbox(storage, 'other', 'one'), false)
  assert.equal(removeGroupToolbox(storage, 'a', 'missing'), false)
  assert.equal(removeGroupToolbox(storage, 'a', 'one'), true)
  assert.deepEqual(loadGroupToolbox(storage, 'a'), [])
})

test('toolbox limit and duplicate IDs never overwrite prior records', () => {
  const storage = store()
  const options = { nodes: [node('a'), node('b')], groupId: 'g' }
  saveGroupToolbox(storage, 'a', options, { id: () => 'one' })
  assert.throws(() => saveGroupToolbox(storage, 'a', options, { id: () => 'one' }), /重复/)
  for (let index = 1; index < GROUP_TOOLBOX_LIMIT; index++)
    saveGroupToolbox(storage, 'a', options, { id: () => `record-${index}` })
  assert.throws(() => saveGroupToolbox(storage, 'a', options), /最多保存20/)
  assert.equal(loadGroupToolbox(storage, 'a').length, 20)
})

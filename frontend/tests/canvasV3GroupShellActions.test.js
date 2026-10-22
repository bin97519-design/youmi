import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parse as parseVue } from '@vue/compiler-sfc'
import { createNodeClipboard } from '../src/features/canvas-v3/config/nodeClipboard.js'
import {
  groupExecutionPlan,
  groupExecutionApprovalSignature,
  createGroupExecutionRunner,
} from '../src/features/canvas-v3/config/groupExecution.js'
import {
  loadGroupToolbox,
  saveGroupToolbox,
  removeGroupToolbox,
  groupToolboxSnapshot,
} from '../src/features/canvas-v3/config/groupToolbox.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const source = parseVue(shell).descriptor.scriptSetup.content
const require = createRequire(import.meta.url)
const ast = require('@babel/parser').parse(source, { sourceType: 'module' })
const node = (id, data = {}) => ({
  id,
  position: { x: 10, y: 20 },
  selected: true,
  data: {
    kind: 'image',
    groupId: 'g',
    groupName: 'Group 1',
    groupType: 'normal',
    title: id,
    prompt: `generate ${id}`,
    model: 'configured-model',
    params: { ratio: '16:9' },
    runState: 'idle',
    ...data,
  },
})
const edge = (source, target) => ({ id: `${source}-${target}`, source, target })
const deferred = () => {
  let resolve
  const promise = new Promise((finish) => {
    resolve = finish
  })
  return { resolve, promise }
}

function harness(initial = [node('image'), node('video', { kind: 'video' })], wiring = []) {
  const notices = [],
    dispatches = [],
    pastes = [],
    factoryOptions = [],
    writes = [],
    stopped = []
  const stored = new Map()
  const controls = { run: null, wait: null, selectedGroup: undefined }
  const nodes = { value: initial }
  const graph = {
    selectionMutable: true,
    get selectedNodes() {
      return nodes.value.filter((item) => item.selected)
    },
    get selectedGroup() {
      if (controls.selectedGroup !== undefined) return controls.selectedGroup
      const selected = this.selectedNodes
      const first = selected[0]
      const groupId = first?.data.groupId
      if (!groupId || selected.length < 2 || selected.some((item) => item.data.groupId !== groupId))
        return null
      if (nodes.value.filter((item) => item.data.groupId === groupId).length !== selected.length)
        return null
      return { id: groupId, name: first.data.groupName || 'Group', type: first.data.groupType }
    },
    pasteNodeClipboard: (snapshot, anchor) => pastes.push({ snapshot, anchor }),
  }
  const context = vm.createContext({
    AbortController,
    nodes,
    edges: { value: wiring },
    graph,
    props: { projectId: 'project-a' },
    user: { profile: { id: 'user-a' }, token: 'token-a' },
    groupWorkflow: { value: null },
    groupWorkflowError: { value: '' },
    groupToolboxTemplates: { value: [] },
    groupExecuting: { value: false },
    groupExecutionProgress: { value: '' },
    groupExecutionRequest: null,
    localStorage: {
      getItem: (key) => stored.get(key),
      setItem: (key, value) => {
        writes.push([key, value])
        stored.set(key, value)
      },
    },
    imageActionNotice: (message, error = false) => notices.push({ message, error }),
    createNodeClipboard,
    groupExecutionPlan,
    groupExecutionApprovalSignature,
    loadGroupToolbox,
    saveGroupToolbox,
    removeGroupToolbox,
    groupToolboxSnapshot,
    canvasWrap: {
      value: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 1000, height: 600 }) },
    },
    screenToFlowCoordinate: ({ x, y }) => ({ x: x - 10, y: y - 20 }),
    tasks: {
      runImage: async (id) => {
        dispatches.push(['image', id])
        nodes.value.find((item) => item.id === id).data.runState = 'queued'
      },
      runVideo: async (id) => {
        dispatches.push(['video', id])
        nodes.value.find((item) => item.id === id).data.runState = 'queued'
      },
      stopWaiting: (id) => {
        const current = nodes.value.find((item) => item.id === id)
        if (current?.data.runState !== 'preparing')
          throw new Error('Cancel must never pretend to revoke provider tasks')
        stopped.push(id)
        current.data.runState = 'idle'
      },
    },
    createGroupExecutionRunner: (options) => {
      factoryOptions.push(options)
      const runner = createGroupExecutionRunner({
        ...options,
        waitForResult: async (id, options) => {
          if (controls.wait) return controls.wait(id, options)
          const current = nodes.value.find((item) => item.id === id)
          current.data.runState = 'succeeded'
          current.data.assetUrl = `https://cdn.example.test/${id}.png`
        },
      })
      return { run: (...args) => (controls.run ? controls.run(...args) : runner.run(...args)) }
    },
    fetch: () => {
      throw new Error('No direct provider fetch permitted')
    },
  })
  for (const name of [
    'groupScope',
    'groupScopeCurrent',
    'openGroupWorkflow',
    'confirmGroupWorkflow',
    'cancelGroupWorkflow',
    'stopGroupPreparation',
    'loadGroupTemplate',
    'removeGroupTemplate',
  ]) {
    const declaration = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    assert.ok(declaration, `Missing actual Shell function ${name}`)
    vm.runInContext(source.slice(declaration.start, declaration.end), context)
  }
  const factory = ast.program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' &&
      item.declarations.some((entry) => entry.id.name === 'groupRunner'),
  )
  assert.ok(factory, 'Missing actual Shell groupRunner factory')
  vm.runInContext(source.slice(factory.start, factory.end), context)
  return { context, controls, notices, dispatches, pastes, factoryOptions, writes, stopped, stored }
}

test('opening group execution freezes explicit approval but submits no generation request', () => {
  const h = harness()
  h.context.openGroupWorkflow('execute-confirm')
  assert.equal(h.context.groupWorkflow.value.type, 'execute-confirm')
  assert.equal(h.context.groupWorkflow.value.plan.generationCount, 2)
  assert.equal(h.context.groupWorkflow.value.scope.projectId, 'project-a')
  assert.equal(
    h.context.groupWorkflow.value.approval,
    groupExecutionApprovalSignature(h.context.nodes.value, [], 'g'),
  )
  assert.deepEqual(h.dispatches, [])
  assert.equal(h.context.groupExecuting.value, false)
  assert.equal(h.writes.length, 0)
})

test('missing/incomplete/protected/busy group cannot open execution or toolbox workflow', () => {
  for (const change of [
    (h) => {
      h.controls.selectedGroup = null
    },
    (h) => {
      h.context.graph.selectionMutable = false
    },
    (h) => {
      h.context.groupExecuting.value = true
    },
  ]) {
    const h = harness()
    change(h)
    h.context.openGroupWorkflow('execute-confirm')
    h.context.openGroupWorkflow('toolbox')
    assert.equal(h.context.groupWorkflow.value, null)
    assert.deepEqual(h.dispatches, [])
    assert.equal(h.writes.length, 0)
  }
})

test('already-produced material causes no paid regeneration and gives an accurate no-op notice', () => {
  const h = harness([
    node('a', { assetUrl: 'https://cdn.example.test/a.png' }),
    node('b', { assetUrl: 'https://cdn.example.test/b.png' }),
  ])
  h.context.openGroupWorkflow('execute-confirm')
  assert.equal(h.context.groupWorkflow.value, null)
  assert.deepEqual(h.dispatches, [])
  assert.match(h.notices.at(-1).message, /没有待生成节点.*不会重复生成或扣费/)
})

test('confirmation rejects changed request, reference, edge, or membership before first submission', async () => {
  for (const change of [
    (h) => {
      h.context.nodes.value[0].data.prompt = 'changed prompt'
    },
    (h) => {
      h.context.nodes.value[0].data.model = 'changed model'
    },
    (h) => {
      h.context.nodes.value[0].data.params.ratio = '9:16'
    },
    (h) => {
      h.context.nodes.value[2].data.assetUrl = 'https://cdn.example.test/changed.png'
    },
    (h) => {
      h.context.edges.value.push(edge('image', 'video'))
    },
    (h) => {
      h.context.nodes.value.push(node('new member'))
    },
    (h) => {
      h.controls.selectedGroup = { id: 'other' }
    },
  ]) {
    const h = harness(
      [
        node('image'),
        node('video', { kind: 'video' }),
        node('outside', { groupId: '', assetUrl: 'https://cdn.example.test/original.png' }),
      ],
      [edge('outside', 'image')],
    )
    h.context.nodes.value[2].selected = false
    h.context.openGroupWorkflow('execute-confirm')
    change(h)
    await h.context.confirmGroupWorkflow()
    assert.deepEqual(h.dispatches, [])
    assert.match(h.context.groupWorkflowError.value, /已改变.*重新确认.*尚未提交/)
    assert.equal(h.context.groupExecuting.value, false)
  }
})

test('changed project, token, or owner makes execution and local template actions inert', async () => {
  for (const change of [
    (h) => {
      h.context.props.projectId = 'project-b'
    },
    (h) => {
      h.context.user.token = 'token-b'
    },
    (h) => {
      h.context.user.profile.id = 'user-b'
    },
  ]) {
    for (const type of ['execute-confirm', 'toolbox']) {
      const h = harness()
      h.context.openGroupWorkflow(type)
      change(h)
      await h.context.confirmGroupWorkflow('wrong-owner-template')
      h.context.loadGroupTemplate('missing')
      h.context.removeGroupTemplate('missing')
      assert.deepEqual(h.dispatches, [])
      assert.equal(h.writes.length, 0)
      assert.deepEqual(h.pastes, [])
    }
  }
})

test('actual Shell runner adapters use existing task entry points in dependency order and report completion only after results', async () => {
  const h = harness([node('video', { kind: 'video' }), node('image')], [edge('image', 'video')])
  h.context.openGroupWorkflow('execute-confirm')
  await h.context.confirmGroupWorkflow()
  assert.deepEqual(h.dispatches, [
    ['image', 'image'],
    ['video', 'video'],
  ])
  assert.equal(h.factoryOptions.length, 1)
  assert.equal(h.factoryOptions[0].getNodes(), h.context.nodes.value)
  assert.equal(h.factoryOptions[0].getEdges(), h.context.edges.value)
  assert.equal(h.context.groupWorkflow.value, null)
  assert.equal(h.context.groupExecuting.value, false)
  assert.equal(h.context.groupExecutionProgress.value, '')
  assert.match(h.notices.at(-1).message, /整组执行完成，已生成 2 个节点/)
  assert.equal(h.writes.length, 0)
})

test('confirm double-click does not submit a second group while first submission is pending', async () => {
  const h = harness()
  const gate = deferred()
  h.controls.wait = async (id) => {
    await gate.promise
    const current = h.context.nodes.value.find((item) => item.id === id)
    current.data.runState = 'succeeded'
    current.data.assetUrl = 'https://cdn.example.test/result.png'
  }
  h.context.openGroupWorkflow('execute-confirm')
  const running = h.context.confirmGroupWorkflow()
  await Promise.resolve()
  await h.context.confirmGroupWorkflow()
  assert.equal(h.context.groupExecuting.value, true)
  assert.deepEqual(h.dispatches, [['image', 'image']])
  gate.resolve()
  await running
  assert.equal(h.dispatches.length, 2)
})

test('scope switch during execution suppresses old result notice and stops subsequent generation', async () => {
  const h = harness()
  h.controls.wait = async () => {
    h.context.user.token = 'another-token'
  }
  h.context.openGroupWorkflow('execute-confirm')
  await h.context.confirmGroupWorkflow()
  assert.deepEqual(h.dispatches, [['image', 'image']])
  assert.equal(h.notices.length, 0)
  assert.equal(h.context.groupExecuting.value, false)
})

test('cancel aborts only later dispatch, does not claim provider rollback, and never announces completion', async () => {
  const h = harness()
  const gate = deferred()
  h.controls.wait = async () => gate.promise
  h.context.openGroupWorkflow('execute-confirm')
  const running = h.context.confirmGroupWorkflow()
  await Promise.resolve()
  const request = h.context.groupExecutionRequest
  assert.equal(request.controller.signal.aborted, false)
  h.context.cancelGroupWorkflow()
  assert.equal(request.controller.signal.aborted, true)
  assert.equal(h.context.groupWorkflow.value, null)
  gate.resolve()
  await running
  assert.deepEqual(h.dispatches, [['image', 'image']])
  assert.equal(h.context.nodes.value[0].data.runState, 'queued')
  assert.match(h.notices.at(-1).message, /已停止整组执行.*已提交的任务.*不会重复提交/)
  assert.equal(h.notices.at(-1).error, false)
  assert.equal(
    h.notices.some((entry) => /整组执行完成|已撤销|已退款|任务已取消/.test(entry.message)),
    false,
  )
  assert.equal(h.context.groupExecuting.value, false)
  assert.deepEqual(h.stopped, [])
})

test('actual runner adapters record original node identities before image and video preparation', async () => {
  for (const kind of ['image', 'video']) {
    const h = harness([node('first', { kind }), node('later')])
    const gate = deferred()
    h.context.tasks[kind === 'image' ? 'runImage' : 'runVideo'] = async (id) => {
      h.dispatches.push([kind, id])
      h.context.nodes.value[0].data.runState = 'preparing'
      await gate.promise
    }
    h.context.openGroupWorkflow('execute-confirm')
    const running = h.context.confirmGroupWorkflow()
    await Promise.resolve()
    const request = h.context.groupExecutionRequest
    assert.equal(request.nodes.length, 1)
    assert.equal(request.nodes[0], h.context.nodes.value[0])
    h.context.cancelGroupWorkflow()
    assert.deepEqual(h.stopped, ['first'])
    assert.equal(h.context.nodes.value[0].data.runState, 'idle')
    gate.resolve()
    await running
    assert.deepEqual(h.dispatches, [[kind, 'first']])
    assert.equal(h.context.groupExecuting.value, false)
  }
})

test('preparation cleanup stops only owned still-present preparing nodes, never submitted or same-ID replacement nodes', () => {
  const owned = node('owned', { runState: 'preparing' })
  const submitting = node('submitting', { runState: 'submitting' })
  const queued = node('queued', { runState: 'queued' })
  const running = node('running', { runState: 'running' })
  const finished = node('finished', { runState: 'succeeded' })
  const replaced = node('replaced', { runState: 'preparing' })
  const replacement = node('replaced', { runState: 'preparing' })
  const unrelated = node('unrelated', { runState: 'preparing' })
  const h = harness([owned, submitting, queued, running, finished, replacement, unrelated])
  h.context.groupExecutionRequest = {
    nodes: [owned, submitting, queued, running, finished, replaced, undefined],
    controller: new AbortController(),
  }
  h.context.stopGroupPreparation()
  assert.deepEqual(h.stopped, ['owned'])
  assert.equal(owned.data.runState, 'idle')
  assert.equal(submitting.data.runState, 'submitting')
  assert.equal(queued.data.runState, 'queued')
  assert.equal(running.data.runState, 'running')
  assert.equal(finished.data.runState, 'succeeded')
  assert.equal(replaced.data.runState, 'preparing')
  assert.equal(replacement.data.runState, 'preparing')
  assert.equal(unrelated.data.runState, 'preparing')
  assert.deepEqual(h.notices, [])
  assert.equal(h.context.groupExecutionRequest.controller.signal.aborted, false)
})

test('actual synchronous scope-change hook stops owned preparation before aborting runner, without touching paid tasks', () => {
  const declaration = ast.program.body.find(
    (item) =>
      item.type === 'ExpressionStatement' &&
      item.expression.type === 'CallExpression' &&
      item.expression.callee.name === 'watch' &&
      item.expression.arguments[0]?.type === 'ArrayExpression' &&
      source.slice(item.start, item.end).includes('stopGroupPreparation()'),
  )
  assert.ok(declaration)
  const callback = declaration.expression.arguments[1]
  const watchSource = source.slice(declaration.start, declaration.end)
  assert.match(watchSource, /flush:\s*'sync'/)
  assert.ok(
    watchSource.indexOf('stopGroupPreparation()') <
      watchSource.indexOf('groupExecutionRequest?.controller.abort()'),
  )
  const h = harness([
    node('prepare', { runState: 'preparing' }),
    node('paid', { runState: 'submitting' }),
  ])
  h.context.selectionDownloadRequest = null
  h.context.cancelSelectionFrameDrag = () => {}
  h.context.selectionDragging = { value: true }
  h.context.selectionSaveNodes = { value: null }
  h.context.cancelGroupResize = () => {}
  h.context.pendingGroupConnection = { value: null }
  h.context.groupConnectionDrag = { cancel() {} }
  h.context.groupHoverPoint = { value: { x: 120, y: 80 } }
  h.context.groupExecutionRequest = {
    nodes: [...h.context.nodes.value],
    controller: new AbortController(),
  }
  h.context.user.token = 'different-owner-session'
  vm.runInContext(`(${source.slice(callback.start, callback.end)})()`, h.context)
  assert.deepEqual(h.stopped, ['prepare'])
  assert.equal(h.context.nodes.value[0].data.runState, 'idle')
  assert.equal(h.context.nodes.value[1].data.runState, 'submitting')
  assert.equal(h.context.groupExecutionRequest.controller.signal.aborted, true)
  assert.equal(h.context.groupWorkflow.value, null)
  assert.equal(h.context.groupHoverPoint.value, null)
  assert.equal(h.notices.length, 0)
})

test('unmount and explicit cancel call preparation-only cleanup before runner abort', () => {
  const unmount = ast.program.body.find(
    (item) =>
      item.type === 'ExpressionStatement' &&
      item.expression.type === 'CallExpression' &&
      item.expression.callee.name === 'onBeforeUnmount' &&
      source.slice(item.start, item.end).includes('stopGroupPreparation()'),
  )
  assert.ok(unmount)
  const unmountSource = source.slice(unmount.start, unmount.end)
  assert.ok(
    unmountSource.indexOf('stopGroupPreparation()') <
      unmountSource.indexOf('groupExecutionRequest?.controller.abort()'),
  )
  const cancel = ast.program.body.find(
    (item) => item.type === 'FunctionDeclaration' && item.id.name === 'cancelGroupWorkflow',
  )
  const cancelSource = source.slice(cancel.start, cancel.end)
  assert.ok(
    cancelSource.indexOf('stopGroupPreparation()') <
      cancelSource.indexOf('groupExecutionRequest?.controller.abort()'),
  )
})

test('toolbox confirms the original safe frozen snapshot even after graph edits, without generating', async () => {
  const h = harness(
    [
      node('a', {
        assetUrl: 'https://cdn.example.test/original.png',
        generation: { taskId: 'never-copy' },
        params: { apiKey: 'never-copy', ratio: '16:9' },
      }),
      node('b'),
    ],
    [edge('a', 'b')],
  )
  h.context.openGroupWorkflow('toolbox')
  assert.equal(h.writes.length, 0)
  h.context.nodes.value[0].data.prompt = 'after-open prompt'
  h.context.nodes.value[0].data.assetUrl = 'https://cdn.example.test/after-open.png'
  await h.context.confirmGroupWorkflow('Reusable')
  const records = loadGroupToolbox(h.context.localStorage, 'user-a')
  assert.equal(records.length, 1)
  const saved = groupToolboxSnapshot(records[0])
  assert.equal(saved.nodes[0].data.assetUrl, 'https://cdn.example.test/original.png')
  assert.equal(saved.nodes[0].data.prompt, 'generate a')
  assert.equal(JSON.stringify(saved).includes('never-copy'), false)
  assert.deepEqual(h.dispatches, [])
  assert.equal(h.context.groupWorkflow.value, null)
  assert.match(h.notices.at(-1).message, /保存到本机工具箱/)
})

test('toolbox login/storage failure never claims a successful save', async () => {
  const h = harness()
  h.context.user.profile.id = ''
  h.context.openGroupWorkflow('toolbox')
  assert.equal(h.context.groupWorkflow.value, null)
  assert.match(h.notices.at(-1).message, /先登录/)
  h.context.user.profile.id = 'user-a'
  h.context.openGroupWorkflow('toolbox')
  h.context.localStorage.setItem = () => {
    throw new Error('quota')
  }
  await h.context.confirmGroupWorkflow('Not saved')
  assert.match(h.context.groupWorkflowError.value, /保存失败/)
  assert.equal(h.context.groupWorkflow.value.type, 'toolbox')
  assert.equal(
    h.notices.some((entry) => /已将.*保存/.test(entry.message)),
    false,
  )
  assert.deepEqual(h.dispatches, [])
})

test('toolbox import reads account-owned current records, adds centered safe graph snapshot and never generates', async () => {
  const h = harness()
  h.context.openGroupWorkflow('toolbox')
  await h.context.confirmGroupWorkflow('Reusable')
  h.context.openGroupWorkflow('toolbox')
  const recordId = h.context.groupToolboxTemplates.value[0].id
  h.context.loadGroupTemplate(recordId)
  assert.equal(h.pastes.length, 1)
  assert.equal(h.pastes[0].anchor.x, 500)
  assert.equal(h.pastes[0].anchor.y, 300)
  assert.equal(h.pastes[0].snapshot.nodes.length, 2)
  assert.equal(h.context.groupWorkflow.value, null)
  assert.match(h.notices.at(-1).message, /已从本机工具箱添加.*未提交生成任务/)
  assert.deepEqual(h.dispatches, [])
})

test('toolbox removes only named account record and bad imports keep dialog open with real error', async () => {
  const h = harness()
  h.context.openGroupWorkflow('toolbox')
  await h.context.confirmGroupWorkflow('Reusable')
  h.context.openGroupWorkflow('toolbox')
  const recordId = h.context.groupToolboxTemplates.value[0].id
  h.context.loadGroupTemplate('missing-id')
  assert.match(h.context.groupWorkflowError.value, /模板无效/)
  assert.equal(h.context.groupWorkflow.value.type, 'toolbox')
  h.context.removeGroupTemplate(recordId)
  assert.equal(h.context.groupToolboxTemplates.value.length, 0)
  assert.equal(loadGroupToolbox(h.context.localStorage, 'user-a').length, 0)
  assert.deepEqual(h.dispatches, [])
  assert.deepEqual(h.pastes, [])
})

test('Shell template wires grouped actions to dedicated handlers and modal explicit confirms', () => {
  assert.match(shell, /@execute="openGroupWorkflow\('execute-confirm'\)"/)
  assert.match(shell, /@toolbox="openGroupWorkflow\('toolbox'\)"/)
  assert.match(shell, /@confirm="confirmGroupWorkflow"/)
  assert.match(shell, /@cancel="cancelGroupWorkflow"/)
  assert.match(shell, /@load="loadGroupTemplate"/)
  assert.match(shell, /@remove="removeGroupTemplate"/)
})

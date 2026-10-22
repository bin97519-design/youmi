import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { parse as parseVue } from '@vue/compiler-sfc'
import { createCanvasSelectionDownloadClient } from '../src/features/canvas-v3/sync/canvasSelectionDownload.js'

const shellUrl = new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url)
const source = parseVue(await readFile(shellUrl, 'utf8')).descriptor.scriptSetup.content
const require = createRequire(import.meta.url)
const ast = require('@babel/parser').parse(source, { sourceType: 'module' })
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const image = (id, extra = {}) => ({
  id,
  position: { x: 10, y: 20 },
  data: { kind: 'image', title: id, assetUrl: `https://cdn.example.test/${id}.png`, ...extra },
})
const deferred = () => {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function harness(selected = [image('one')]) {
  const notices = [],
    appended = [],
    saved = [],
    actions = [],
    network = [],
    factories = [],
    progress = []
  const controls = {
    beforeSave: null,
    beforeProgress: null,
    restore: null,
    tick: null,
    feedback: null,
    fetcher: null,
    timeoutMs: undefined,
  }
  const context = vm.createContext({
    AbortController,
    DOMException,
    graph: {
      selectedNodes: selected,
      selectionMutable: true,
      arrangeSelected: (type) => actions.push(['arrange', type]),
      duplicateSelected: () => actions.push(['duplicate']),
      ungroupSelected: () => actions.push(['ungroup']),
      groupSelected: (...args) => actions.push(['group', ...args]),
    },
    props: { projectId: 'project-a' },
    user: {
      token: 'token-a',
      profile: { id: 'user-a' },
      authHeaders: () => ({ Authorization: 'Bearer token-a' }),
    },
    title: { value: '测试画布' },
    canChatSelection: { value: true },
    activePanel: { value: '' },
    menuPosition: { value: { x: 1, y: 2 } },
    directorConversationId: { value: 'temporary-conversation' },
    directorRestoring: { value: false },
    directorRestoreError: { value: '' },
    selectionDownloading: { value: false },
    selectionDownloadRequest: null,
    imageActionNotice: (message, error = false) => notices.push({ message, error }),
    apiPath: (value) => `/api-base${value}`,
    saveCanvasSelectionArchive: (blob, filename) => saved.push({ blob, filename }),
    nextTick: async () => {
      await controls.tick?.()
    },
    restoreLatestDirectorConversation: async () => {
      if (controls.restore) await controls.restore()
      else context.directorConversationId.value = 'restored-conversation'
    },
    directorPanel: {
      value: {
        addCanvasSelection: (nodes, scope) => {
          appended.push({ nodes, scope })
          return (
            controls.feedback || {
              acceptedCount: nodes.length,
              rejectedCount: 0,
              duplicateCount: 0,
              rejections: [],
              skillCreationOpened: Boolean(scope.createSkill),
            }
          )
        },
      },
    },
    createCanvasSelectionDownloadClient: (options) => {
      factories.push(options)
      const client = createCanvasSelectionDownloadClient({
        ...options,
        timeoutMs: controls.timeoutMs,
        fetcher: async (...args) => {
          network.push(args)
          if (controls.fetcher) return controls.fetcher(...args)
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            blob: async () => new Blob([PNG]),
          }
        },
        save: (blob, filename, result) => {
          controls.beforeSave?.(result)
          return options.save(blob, filename, result)
        },
      })
      return {
        download: (nodes, request) =>
          client.download(nodes, {
            ...request,
            onProgress: (update) => {
              progress.push(update)
              controls.beforeProgress?.(update)
              request.onProgress(update)
            },
          }),
      }
    },
    emit: () => {
      throw new Error('Selection actions must never submit or generate')
    },
    fetch: () => {
      throw new Error('Only the mocked read-only downloader may fetch')
    },
  })
  for (const name of [
    'selectionSnapshot',
    'selectionMutation',
    'downloadSelection',
    'selectionToDirector',
  ]) {
    const declaration = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id.name === name,
    )
    assert.ok(declaration, `Missing actual Shell function ${name}`)
    vm.runInContext(source.slice(declaration.start, declaration.end), context)
  }
  return { context, controls, notices, appended, saved, actions, network, factories, progress }
}

test('Shell waits for first conversation restoration, captures the restored ID and appends its original safe selection snapshot', async () => {
  const h = harness([
    image('first', { generation: { taskId: 'private-task' }, apiKey: 'must-not-copy' }),
  ])
  const gate = deferred()
  h.controls.restore = async () => {
    h.context.directorRestoring.value = true
    await gate.promise
    h.context.directorConversationId.value = 'latest-cloud-conversation'
    h.context.directorRestoring.value = false
  }
  const task = h.context.selectionToDirector(false)
  assert.equal(h.context.activePanel.value, 'assistant')
  assert.equal(h.context.menuPosition.value, null)
  assert.equal(h.appended.length, 0)
  h.context.graph.selectedNodes[0].data.title = 'changed-after-click'
  h.context.graph.selectedNodes[0].data.assetUrl = 'https://cdn.example.test/new.png'
  gate.resolve()
  await task
  assert.equal(h.appended.length, 1)
  assert.equal(h.appended[0].scope.conversationId, 'latest-cloud-conversation')
  assert.equal(h.appended[0].scope.projectId, 'project-a')
  assert.equal(h.appended[0].scope.createSkill, false)
  assert.equal(h.appended[0].nodes[0].data.title, 'first')
  assert.equal(h.appended[0].nodes[0].data.assetUrl, 'https://cdn.example.test/first.png')
  assert.equal(JSON.stringify(h.appended[0].nodes).includes('private-task'), false)
  assert.equal(JSON.stringify(h.appended[0].nodes).includes('must-not-copy'), false)
  assert.match(h.notices.at(-1).message, /1 项内容加入 Chat 草稿，尚未发送/)
  assert.equal(h.network.length, 0)
})

test('Shell never appends into a different owner or project while restoring, or into a different conversation after nextTick', async () => {
  for (const change of [
    (context) => {
      context.props.projectId = 'project-b'
    },
    (context) => {
      context.user.token = 'token-b'
    },
    (context) => {
      context.user.profile.id = 'user-b'
    },
  ]) {
    const h = harness()
    h.controls.restore = async () => change(h.context)
    await h.context.selectionToDirector()
    assert.equal(h.appended.length, 0)
  }
  for (const change of [
    (context) => {
      context.props.projectId = 'project-b'
    },
    (context) => {
      context.user.token = 'token-b'
    },
    (context) => {
      context.directorConversationId.value = 'other-conversation'
    },
    (context) => {
      context.user.profile.id = 'user-b'
    },
  ]) {
    const h = harness()
    h.controls.tick = async () => change(h.context)
    await h.context.selectionToDirector()
    assert.equal(h.appended.length, 0)
  }
})

test('pending restoration and restore errors report the real blocker without appending or claiming Skill creation', async () => {
  for (const [state, message] of [
    ['pending', /正在恢复对话/],
    ['error', /cloud history unavailable/],
  ]) {
    const h = harness()
    h.controls.restore = async () => {
      h.context.directorRestoring.value = state === 'pending'
      h.context.directorRestoreError.value = state === 'error' ? 'cloud history unavailable' : ''
    }
    await h.context.selectionToDirector(true)
    assert.equal(h.appended.length, 0)
    assert.match(h.notices.at(-1).message, message)
    assert.equal(h.notices.at(-1).error, true)
    assert.equal(
      h.notices.some((notice) => notice.message.includes('已带入')),
      false,
    )
  }
})

test('Director blocked, stale, zero-accepted and duplicate feedback are handled without false successful additions', async () => {
  const cases = [
    [{ blocked: true }, false, /尚未恢复/, true],
    [{ stale: true }, false, /已切换/, true],
    [
      { acceptedCount: 0, duplicateCount: 0, rejections: [{ reason: '素材地址不安全' }] },
      false,
      /素材地址不安全/,
      true,
    ],
    [{ acceptedCount: 0, duplicateCount: 2 }, false, /已在当前 Chat 草稿中/, false],
    [
      { acceptedCount: 0, skillCreationOpened: false, rejections: [{ reason: '不支持此节点' }] },
      true,
      /不支持此节点/,
      true,
    ],
  ]
  for (const [feedback, skill, message, error] of cases) {
    const h = harness()
    h.controls.feedback = feedback
    await h.context.selectionToDirector(skill)
    assert.match(h.notices.at(-1).message, message)
    assert.equal(h.notices.at(-1).error, error)
    assert.equal(
      h.notices.some(
        (notice) => notice.message.includes('已带入') || notice.message.includes('0 项内容加入'),
      ),
      false,
    )
    assert.equal(h.network.length, 0)
  }
})

test('a real opened Skill guide is described as unsent and not created; partial appends preserve rejection feedback', async () => {
  const h = harness([image('one'), image('two')])
  h.controls.feedback = { acceptedCount: 1, rejectedCount: 1, skillCreationOpened: true }
  await h.context.selectionToDirector(true)
  assert.match(h.notices.at(-1).message, /打开 Skill 创建引导；尚未发送或创建 Skill；1 项未能加入/)
  assert.equal(h.notices.at(-1).error, true)
  assert.equal(h.appended.length, 1)
  assert.equal(h.network.length, 0)
  const invalid = harness()
  invalid.context.canChatSelection.value = false
  await invalid.context.selectionToDirector()
  assert.equal(invalid.appended.length, 0)
  assert.match(invalid.notices.at(-1).message, /不超过10个/)
})

test('download save callback rejects project, token or profile changes even before any cancellation watcher runs', async () => {
  for (const change of [
    (context) => {
      context.props.projectId = 'project-b'
    },
    (context) => {
      context.user.token = 'token-b'
    },
    (context) => {
      context.user.profile.id = 'user-b'
    },
  ]) {
    const h = harness()
    let abortedBeforeSave
    h.controls.beforeSave = () => {
      abortedBeforeSave = h.context.selectionDownloadRequest.controller.signal.aborted
      change(h.context)
    }
    await h.context.downloadSelection()
    assert.equal(abortedBeforeSave, false, 'scope guard must work without a watcher abort')
    assert.equal(h.saved.length, 0)
    assert.equal(h.context.selectionDownloading.value, false)
    assert.equal(h.context.selectionDownloadRequest, null)
    assert.equal(
      h.notices.some((notice) => /^已下载/.test(notice.message)),
      false,
    )
  }
})

test('download progress updates freeze immediately once owner scope becomes stale and no artifact is saved', async () => {
  const h = harness([image('one'), image('two')])
  h.controls.beforeProgress = (update) => {
    if (update.phase === 'progress') h.context.user.token = 'token-b'
  }
  await h.context.downloadSelection()
  assert.ok(h.progress.length >= 2)
  assert.equal(h.notices.filter((notice) => notice.message.startsWith('正在打包')).length, 1)
  assert.equal(h.saved.length, 0)
  assert.equal(h.context.selectionDownloading.value, false)
})

test('explicit download cancellation never saves a ZIP and tells the current owner that nothing was downloaded', async () => {
  const h = harness()
  h.controls.beforeProgress = () => h.context.selectionDownloadRequest.controller.abort()
  await h.context.downloadSelection()
  assert.equal(h.saved.length, 0)
  assert.equal(h.network.length, 0)
  assert.equal(h.context.selectionDownloading.value, false)
  assert.match(h.notices.at(-1).message, /已取消本次打包，未下载压缩包/)
  assert.equal(h.notices.at(-1).error, false)
})

test('a stalled host times out in the real downloader without saving or falsely reporting a completed Shell download', async () => {
  const h = harness()
  h.controls.timeoutMs = 5
  h.controls.fetcher = () => new Promise(() => {})
  await h.context.downloadSelection()
  assert.equal(h.saved.length, 0)
  assert.equal(h.context.selectionDownloading.value, false)
  assert.equal(h.context.selectionDownloadRequest, null)
  assert.match(h.notices.at(-1).message, /均未能下载/)
  assert.equal(h.notices.at(-1).error, true)
  assert.equal(
    h.notices.some((notice) => /^已下载/.test(notice.message)),
    false,
  )
})

test('download partial failures and zero successes produce accurate Shell feedback using the real ZIP client', async () => {
  const partial = harness([image('good'), image('empty', { assetUrl: '' })])
  await partial.context.downloadSelection()
  assert.equal(partial.saved.length, 1)
  assert.equal(partial.saved[0].blob.type, 'application/zip')
  assert.match(partial.notices.at(-1).message, /已下载 1 项，1 项失败；详见压缩包内失败清单/)
  assert.equal(partial.notices.at(-1).error, true)
  const failed = harness([image('empty', { assetUrl: '' })])
  await failed.context.downloadSelection()
  assert.equal(failed.saved.length, 0)
  assert.match(failed.notices.at(-1).message, /均未能下载/)
  assert.equal(failed.notices.at(-1).error, true)
})

test('busy download calls cannot start a second read and snapshots cannot acquire later selection changes', async () => {
  const h = harness([image('original')])
  const gate = deferred()
  h.controls.fetcher = () => gate.promise
  const first = h.context.downloadSelection()
  assert.equal(h.context.selectionDownloading.value, true)
  h.context.graph.selectedNodes[0].data.assetUrl = 'https://cdn.example.test/changed.png'
  h.context.graph.selectedNodes.push(image('later'))
  await h.context.downloadSelection()
  assert.equal(h.factories.length, 1)
  assert.equal(h.network.length, 1)
  gate.resolve({ ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([PNG]) })
  await first
  assert.equal(h.saved.length, 1)
  assert.match(h.notices.at(-1).message, /已下载 1 项素材/)
  assert.ok(h.network[0][0].includes(encodeURIComponent('https://cdn.example.test/original.png')))
  assert.equal(h.context.selectionDownloading.value, false)
})

test('protected selection mutations reject the entire action before any selected graph content is changed', () => {
  const h = harness()
  h.context.graph.selectionMutable = false
  for (const [action, type] of [
    ['arrange', 'grid'],
    ['duplicate'],
    ['ungroup'],
    ['group', 'normal'],
  ])
    h.context.selectionMutation(action, type)
  assert.equal(h.actions.length, 0)
  assert.equal(h.notices.length, 4)
  assert.ok(h.notices.every((notice) => notice.error && /进行中或待确认/.test(notice.message)))
  h.context.graph.selectionMutable = true
  for (const [action, type] of [
    ['arrange', 'horizontal'],
    ['duplicate'],
    ['ungroup'],
    ['group', 'normal'],
  ])
    h.context.selectionMutation(action, type)
  assert.deepEqual(h.actions, [
    ['arrange', 'horizontal'],
    ['duplicate'],
    ['ungroup'],
    ['group', undefined, 'normal'],
  ])
})

test('Shell snapshots whitelist only export/Chat descriptive data, copy positions and omit task/provider/credential fields', () => {
  const input = image('one', {
    prompt: '场景',
    generation: { clientTaskId: 'secret-task' },
    apiKey: 'secret-key',
    headers: { Authorization: 'private' },
    params: { count: 4 },
    switches: { audio: true },
    runState: 'running',
    mediaWidth: 100,
    fileSize: 12,
  })
  input.position = { x: 15, y: 25 }
  const h = harness([input])
  const snapshot = h.context.selectionSnapshot()
  assert.deepEqual(Object.keys(snapshot[0].data).sort(), [
    'assetUrl',
    'fileSize',
    'kind',
    'mediaWidth',
    'prompt',
    'title',
  ])
  assert.equal(JSON.stringify(snapshot).includes('secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('Authorization'), false)
  input.position.x = 999
  input.data.prompt = 'changed'
  assert.equal(snapshot[0].position.x, 15)
  assert.equal(snapshot[0].data.prompt, '场景')
})

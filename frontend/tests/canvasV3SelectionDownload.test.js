import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANVAS_SELECTION_DOWNLOAD_LIMITS,
  createCanvasSelectionDownloadClient,
  saveCanvasSelectionArchive,
} from '../src/features/canvas-v3/sync/canvasSelectionDownload.js'

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const JPG = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70])
const MP4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
const node = (id, kind = 'image', extra = {}) => ({
  id,
  data: { kind, title: id, assetUrl: `https://cdn.example.test/${id}`, ...extra },
})
const response = (data = PNG, type = 'application/octet-stream', extra = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': type }),
  blob: async () => new Blob([data], { type }),
  ...extra,
})
const deferred = () => {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
async function zipEntries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)
  const entries = []
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'stored archive never transforms media')
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const start = offset + 30 + nameLength + extraLength
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)),
      data: bytes.slice(start, start + size),
    })
    offset = start + size
  }
  return entries
}
function harness(options = {}) {
  const calls = []
  const saved = []
  const client = createCanvasSelectionDownloadClient({
    fetcher: async (...args) => {
      calls.push(args)
      return response()
    },
    save: async (...args) => saved.push(args),
    ...options,
  })
  return { client, calls, saved }
}

test('mixed ZIP keeps exact original bytes, source order and signature-derived extensions with safe unique names', async () => {
  let index = 0
  const h = harness({ fetcher: async () => response([PNG, JPG, MP4, PNG][index++]) })
  const inputs = [
    node('one', 'image', { title: '../../素材.png' }),
    node('two', 'image', { title: '原图.png' }),
    node('three', 'video', { title: '视频.webm' }),
    node('four', 'image', { title: '../../素材.PNG' }),
  ]
  const before = structuredClone(inputs)
  const result = await h.client.download(inputs)
  assert.equal(result.complete, true)
  assert.equal(result.downloaded, true)
  assert.equal(result.successCount, 4)
  assert.equal(result.failedCount, 0)
  assert.equal(result.byteLength, PNG.length * 2 + JPG.length + MP4.length)
  assert.equal(h.saved.length, 1)
  const entries = await zipEntries(result.blob)
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['.._.._素材.png', '原图.jpg', '视频.mp4', '.._.._素材 (2).png'],
  )
  assert.deepEqual(
    entries.map((entry) => entry.data),
    [PNG, JPG, MP4, PNG],
  )
  assert.deepEqual(inputs, before)
  assert.ok(Object.isFrozen(result.files))
  assert.ok(Object.isFrozen(result.files[0]))
})

test('remote files use only the fixed local proxy, GET and one captured authentication header set', async () => {
  let authReads = 0
  const h = harness({
    path: (value) => `https://api.our-app.test${value}`,
    headers: () => {
      authReads++
      return { Authorization: 'Bearer private-token' }
    },
  })
  const source = 'https://cdn.example.test/a.png?signature=abc%2Bdef&expires=123'
  await h.client.prepare([node('one', 'image', { assetUrl: source }), node('two')])
  assert.equal(authReads, 1)
  assert.equal(
    h.calls[0][0],
    `https://api.our-app.test/api/image-tasks/proxy-download?url=${encodeURIComponent(source)}`,
  )
  for (const [url, request] of h.calls) {
    assert.ok(url.startsWith('https://api.our-app.test/api/image-tasks/proxy-download?url='))
    assert.equal(request.method, 'GET')
    assert.equal(request.headers.authorization, 'Bearer private-token')
    assert.equal(request.redirect, 'error')
    assert.equal(request.credentials, 'same-origin')
  }
  assert.equal(h.saved.length, 0, 'prepare never saves')
})

test('selection, artifact URLs and auth are snapshotted before the first await, including old artifacts of active tasks', async () => {
  const pending = deferred()
  const calls = []
  const h = harness({
    fetcher: async (url) => {
      calls.push(url)
      return calls.length === 1 ? pending.promise : response()
    },
  })
  const inputs = [
    node('first'),
    node('second', 'image', {
      runState: 'running',
      generation: { clientTaskId: 'must-not-export' },
    }),
  ]
  const task = h.client.prepare(inputs)
  inputs[1].data.title = 'changed'
  inputs[1].data.kind = 'video'
  inputs[1].data.assetUrl = 'https://other.example.test/new.mp4'
  inputs.push(node('third'))
  pending.resolve(response())
  const result = await task
  assert.equal(result.totalCount, 2)
  assert.equal(result.files[1].title, 'second')
  assert.ok(calls[1].includes(encodeURIComponent('https://cdn.example.test/second')))
  assert.equal(
    new TextDecoder().decode(await result.blob.arrayBuffer()).includes('must-not-export'),
    false,
  )
})

test('inline raster images preserve their original bytes without fetch, auth or conversion', async () => {
  const h = harness({
    headers: () => {
      throw new Error('must not read auth')
    },
  })
  const result = await h.client.prepare([
    node('inline', 'image', {
      assetUrl: `data:image/jpeg;base64,${Buffer.from(JPG).toString('base64')}`,
    }),
  ])
  assert.equal(result.successCount, 1)
  assert.equal(result.files[0].mimeType, 'image/jpeg')
  assert.equal(h.calls.length, 0)
  assert.deepEqual((await zipEntries(result.blob))[0].data, JPG)
})

test('partial failure is explicit in result, filename and an archive failure manifest without signed source URLs', async () => {
  let count = 0
  const h = harness({
    fetcher: async () => {
      if (++count === 2)
        throw new Error('failed https://cdn.example.test/secret?token=private-token')
      return response()
    },
  })
  const result = await h.client.download([
    node('good'),
    node('bad'),
    node('unfinished', 'video', { assetUrl: '', runState: 'running' }),
  ])
  assert.equal(result.complete, false)
  assert.equal(result.downloaded, true)
  assert.equal(result.successCount, 1)
  assert.equal(result.failedCount, 2)
  assert.match(result.filename, /部分成功/)
  assert.deepEqual(
    result.failures.map((failure) => failure.nodeId),
    ['bad', 'unfinished'],
  )
  const entries = await zipEntries(result.blob)
  assert.equal(entries[1].name, '_下载失败清单.txt')
  const manifest = new TextDecoder().decode(entries[1].data)
  assert.match(manifest, /成功 1\/3 项，失败 2 项/)
  assert.match(manifest, /bad/)
  assert.match(manifest, /unfinished/)
  assert.equal(manifest.includes('private-token'), false)
  assert.equal(manifest.includes('https://'), false)
})

test('zero successes never create or save a misleading ZIP and unsupported node types are not silently ignored', async () => {
  const h = harness()
  const result = await h.client.download([
    node('text', 'text'),
    node('empty', 'image', { assetUrl: '' }),
  ])
  assert.equal(result.blob, null)
  assert.equal(result.complete, false)
  assert.equal(result.downloaded, false)
  assert.equal(result.failedCount, 2)
  assert.equal(h.calls.length, 0)
  assert.equal(h.saved.length, 0)
})

test('empty or oversized selections and invalid limits fail before any read or authentication', async () => {
  const h = harness({
    headers: () => {
      throw new Error('unexpected auth')
    },
  })
  await assert.rejects(h.client.download([]), /请先选择/)
  await assert.rejects(
    h.client.download(Array.from({ length: 51 }, (_, i) => node(String(i)))),
    /最多下载 50/,
  )
  assert.equal(h.calls.length, 0)
  for (const [key, value] of Object.entries({
    maxImageBytes: CANVAS_SELECTION_DOWNLOAD_LIMITS.imageBytes + 1,
    maxVideoBytes: 0,
    maxTotalBytes: Infinity,
    timeoutMs: 120001,
  }))
    assert.throws(() => createCanvasSelectionDownloadClient({ [key]: value }), /超出允许范围/)
})

test('unsafe sources, embedded credentials, inline SVG and private-network targets never fetch or read auth', async () => {
  const h = harness({
    headers: () => {
      throw new Error('unexpected auth')
    },
  })
  const urls = [
    'javascript:alert(1)',
    'file:///private.png',
    'blob:https://app.example/id',
    '//cdn.example.test/image.png',
    '/api/private',
    'https://user:pass@cdn.example.test/image.png',
    'https://cdn.example.test/a\nb.png',
    'https://127.0.0.1/a',
    'https://localhost./a',
    'http://2130706433/a',
    'http://192.168.1.2/a',
    'http://[::1]/a',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!!',
  ]
  const result = await h.client.download(
    urls.map((assetUrl, i) => node(String(i), 'image', { assetUrl })),
  )
  assert.equal(result.failedCount, urls.length)
  assert.equal(result.blob, null)
  assert.equal(h.calls.length, 0)
})

test('HTTP errors, partial transfers, misleading MIME, disguised bytes and empty responses become item failures', async () => {
  const invalid = [
    response(PNG, 'image/png', { ok: false, status: 403 }),
    response(PNG, 'image/png', { status: 206 }),
    response(PNG, 'text/html'),
    response(new TextEncoder().encode('<html>not an image</html>'), 'image/png'),
    response(MP4, 'image/png'),
    response(new Uint8Array(), 'image/png'),
    response(PNG, 'image/png', { headers: new Headers({ 'content-length': '999' }) }),
  ]
  const h = harness({ fetcher: async () => invalid.shift() })
  const result = await h.client.download(
    Array.from({ length: invalid.length }, (_, i) => node(String(i))),
  )
  assert.equal(result.failedCount, 7)
  assert.equal(result.blob, null)
  assert.equal(h.saved.length, 0)
  const video = harness({
    fetcher: async () => response(new TextEncoder().encode('0000ftypavif0000'), 'video/mp4'),
  })
  assert.equal((await video.client.prepare([node('video', 'video')])).successCount, 0)
})

test('per-item and aggregate byte limits are checked before allocating oversized bodies or adding ZIP entries', async () => {
  let blobsRead = 0
  const huge = harness({
    maxImageBytes: 10,
    fetcher: async () =>
      response(PNG, 'image/png', {
        headers: new Headers({ 'content-length': '11' }),
        blob: async () => {
          blobsRead++
          return new Blob([PNG])
        },
      }),
  })
  assert.equal((await huge.client.prepare([node('huge')])).successCount, 0)
  assert.equal(blobsRead, 0)
  const limited = harness({ maxTotalBytes: PNG.length + 1 })
  const result = await limited.client.prepare([node('first'), node('second')])
  assert.equal(result.byteLength, PNG.length)
  assert.equal(result.successCount, 1)
  assert.equal(result.failedCount, 1)
  assert.match(result.failures[0].reason, /大小限制/)
  const inline = harness({ maxImageBytes: PNG.length - 1 })
  assert.equal(
    (
      await inline.client.prepare([
        node('large-inline', 'image', {
          assetUrl: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`,
        }),
      ])
    ).successCount,
    0,
  )
})

test('streaming enforces actual bytes and cancels oversized readers, even without Content-Length', async () => {
  let cancelled = 0,
    released = 0
  const h = harness({
    maxImageBytes: 10,
    fetcher: async () =>
      response(PNG, 'image/png', {
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: PNG }),
            cancel: async () => {
              cancelled++
            },
            releaseLock: () => {
              released++
            },
          }),
        },
      }),
  })
  const result = await h.client.prepare([node('stream')])
  assert.equal(result.failedCount, 1)
  assert.equal(cancelled, 1)
  assert.equal(released, 1)
})

test('valid streamed originals and two selected nodes sharing one URL remain distinct ZIP entries', async () => {
  const h = harness({
    fetcher: async () => {
      const chunks = [PNG.subarray(0, 8), PNG.subarray(8)]
      return response(PNG, 'image/png', {
        headers: new Headers({ 'content-type': 'image/png', 'content-length': String(PNG.length) }),
        body: {
          getReader: () => ({
            read: async () =>
              chunks.length ? { done: false, value: chunks.shift() } : { done: true },
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      })
    },
  })
  const source = 'https://cdn.example.test/shared.png'
  const result = await h.client.prepare([
    node('first', 'image', { title: 'shared', assetUrl: source }),
    node('last', 'image', { title: 'shared', assetUrl: source }),
  ])
  const entries = await zipEntries(result.blob)
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['shared.png', 'shared (2).png'],
  )
  assert.deepEqual(
    entries.map((entry) => entry.data),
    [PNG, PNG],
  )
  assert.equal(result.complete, true)
})

test('cancellation settles a stalled fetch or stream promptly and never saves a partial archive', async () => {
  for (const phase of ['fetch', 'read']) {
    const started = deferred()
    const pending = deferred()
    const controller = new AbortController()
    const h = harness({
      fetcher: () => {
        if (phase === 'fetch') {
          started.resolve()
          return pending.promise
        }
        return response(PNG, 'image/png', {
          body: {
            getReader: () => ({
              read: () => {
                started.resolve()
                return pending.promise
              },
              cancel: async () => {},
              releaseLock: () => {},
            }),
          },
        })
      },
    })
    const task = h.client.download([node('wait')], { signal: controller.signal })
    await started.promise
    controller.abort()
    await assert.rejects(task, { name: 'AbortError' })
    assert.equal(h.saved.length, 0)
    pending.resolve(phase === 'fetch' ? response() : { done: true })
  }
})

test('timeouts are item failures while explicit save failures remain rejected, never marked downloaded', async () => {
  const timed = harness({ timeoutMs: 5, fetcher: () => new Promise(() => {}) })
  const result = await timed.client.download([node('wait')])
  assert.equal(result.failedCount, 1)
  assert.match(result.failures[0].reason, /超时/)
  assert.equal(result.downloaded, false)
  const failingSave = harness({
    save: () => {
      throw new Error('disk save failed')
    },
  })
  await assert.rejects(failingSave.client.download([node('one')]), /disk save failed/)
  const noSave = harness({ save: false })
  assert.equal((await noSave.client.download([node('one')])).downloaded, false)
})

test('late fetch bodies are discarded after cancellation and cleanup failures cannot mask aborts', async () => {
  const pending = deferred()
  const controller = new AbortController()
  let cancelled = 0
  const h = harness({ fetcher: () => pending.promise })
  const task = h.client.download([node('wait')], { signal: controller.signal })
  controller.abort()
  await assert.rejects(task, { name: 'AbortError' })
  pending.resolve(
    response(PNG, 'image/png', {
      body: {
        cancel: () => {
          cancelled++
          throw new Error('already locked')
        },
      },
    }),
  )
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(cancelled, 1)
  assert.equal(h.saved.length, 0)
})

test('exported archive save preserves browser save behavior and can be guarded at the final scope boundary', async () => {
  const prior = new Map(
    ['document', 'URL', 'setTimeout'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  )
  const clicks = []
  const revoked = []
  let removed = 0
  const timers = []
  const anchor = {
    style: {},
    click() {
      clicks.push({ href: this.href, filename: this.download })
    },
    remove() {
      removed++
    },
  }
  for (const [key, value] of Object.entries({
    document: { createElement: () => anchor, body: { appendChild() {} } },
    URL: {
      createObjectURL: () => 'blob:selection-zip',
      revokeObjectURL: (url) => revoked.push(url),
    },
    setTimeout: (callback, duration) => timers.push({ callback, duration }),
  }))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  try {
    let current = false
    const guardedSave = (blob, filename) => {
      if (!current) throw new DOMException('账号或画布已切换', 'AbortError')
      saveCanvasSelectionArchive(blob, filename)
    }
    assert.throws(() => guardedSave(new Blob(['zip']), 'selection.zip'), { name: 'AbortError' })
    assert.equal(clicks.length, 0)
    current = true
    guardedSave(new Blob(['zip']), 'selection.zip')
    assert.deepEqual(clicks, [{ href: 'blob:selection-zip', filename: 'selection.zip' }])
    assert.equal(removed, 1)
    assert.equal(timers[0].duration, 1000)
    assert.equal(revoked.length, 0)
    timers[0].callback()
    assert.deepEqual(revoked, ['blob:selection-zip'])
  } finally {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

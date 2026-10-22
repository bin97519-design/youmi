import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyCanvasImage,
  convertCanvasImageToPng,
  createImageClipboardClient,
  MAX_CLIPBOARD_IMAGE_BYTES,
} from '../src/features/canvas-v3/sync/imageClipboard.js'

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1EAAAAASUVORK5CYII='
const png = () => new Blob([Buffer.from(pngBase64, 'base64')], { type: 'image/png' })
const jpeg = () =>
  new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70])], { type: 'image/jpeg' })
const source = 'https://cdn.example.com/image.jpg'
class Item {
  constructor(value) {
    this.value = value
    this.types = Object.keys(value)
  }
}
const response = (blob, extra = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': blob.type }),
  blob: async () => blob,
  ...extra,
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function harness(extra = {}) {
  const writes = [],
    calls = []
  const clipboard = {
    write: (items) => {
      writes.push(items)
      return items[0].value['image/png'].then(() => {})
    },
  }
  return {
    writes,
    calls,
    options: {
      ClipboardItemCtor: Item,
      clipboard,
      fetcher: async (...args) => {
        calls.push(args)
        return response(png())
      },
      ...extra,
    },
  }
}
async function withGlobals(values, run) {
  const previous = Object.entries(values).map(([name]) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ])
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  try {
    return await run()
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
}

test('clipboard.write starts synchronously with a promised PNG before the proxy or converter resolves', async () => {
  const events = [],
    pending = deferred()
  let item
  const copy = copyCanvasImage(source, {
    ClipboardItemCtor: Item,
    clipboard: {
      write: (items) => {
        events.push('write')
        item = items[0]
        assert.ok(item.value['image/png'] instanceof Promise)
        return item.value['image/png'].then(() => {})
      },
    },
    fetcher: () => {
      events.push('fetch')
      return pending.promise
    },
    convertToPng: async (blob) => {
      events.push('convert')
      assert.equal(blob.type, 'image/jpeg')
      return png()
    },
  })
  assert.deepEqual(events, ['write'])
  await Promise.resolve()
  assert.deepEqual(events, ['write', 'fetch'])
  pending.resolve(response(jpeg()))
  assert.equal((await copy).mimeType, 'image/png')
  const copied = await item.value['image/png']
  assert.equal(copied.type, 'image/png')
  assert.deepEqual(
    new Uint8Array(await copied.arrayBuffer()),
    new Uint8Array(await png().arrayBuffer()),
  )
  assert.deepEqual(events, ['write', 'fetch', 'convert'])
})

test('remote URLs receive auth only on the configured local proxy, never on the CDN', async () => {
  let authReads = 0
  const h = harness({
    path: (path) => `https://api.our-app.example${path}`,
    headers: () => {
      authReads++
      return new Headers({ Authorization: 'Bearer private-token' })
    },
  })
  await copyCanvasImage(source, h.options)
  assert.equal(h.calls.length, 1)
  assert.equal(
    h.calls[0][0],
    `https://api.our-app.example/api/image-tasks/proxy-download?url=${encodeURIComponent(source)}`,
  )
  assert.equal(h.calls[0][1].headers.authorization, 'Bearer private-token')
  assert.equal(h.calls[0][1].method, 'GET')
  assert.equal(authReads, 1)
  assert.equal(
    h.calls.some(([url]) => url === source),
    false,
  )
})

test('safe inline PNG copies actual bytes without fetching, reading auth or converting', async () => {
  const h = harness({
    headers: () => {
      throw new Error('auth should not be read')
    },
    convertToPng: () => {
      throw new Error('PNG should stay lossless')
    },
  })
  await copyCanvasImage(`data:image/png;base64,${pngBase64}`, h.options)
  assert.equal(h.calls.length, 0)
  assert.equal((await h.writes[0][0].value['image/png']).type, 'image/png')
})

test('unsafe protocols, embedded credentials, SVG and malformed data cannot fetch, read auth or write', async () => {
  let calls = 0
  const options = {
    ClipboardItemCtor: Item,
    clipboard: {
      write: () => {
        calls++
      },
    },
    fetcher: () => {
      calls++
    },
    headers: () => {
      calls++
    },
  }
  for (const url of [
    'javascript:alert(1)',
    'file:///image.png',
    'blob:https://example.com/image',
    '//example.com/image.png',
    'https://user:secret@example.com/image.png',
    'https://example.com/a\nb.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,!!',
    null,
  ])
    await assert.rejects(copyCanvasImage(url, options))
  assert.equal(calls, 0)
})

test('WebP, GIF, AVIF, BMP and JPG inline signatures route through the PNG converter', async () => {
  const values = [
    ['image/jpeg', Buffer.from([255, 216, 255, 0])],
    ['image/webp', Buffer.from('RIFF0000WEBPtest')],
    ['image/gif', Buffer.from('GIF89a0000000000')],
    ['image/avif', Buffer.from('0000ftypavif0000avif')],
    ['image/bmp', Buffer.from('BM00000000000000')],
  ]
  for (const [mime, bytes] of values) {
    let conversionCount = 0
    const h = harness({
      convertToPng: async (blob, { signal }) => {
        assert.equal(blob.type, mime)
        assert.equal(signal.aborted, false)
        conversionCount++
        return png()
      },
    })
    await copyCanvasImage(`data:${mime};base64,${bytes.toString('base64')}`, h.options)
    assert.equal(conversionCount, 1)
    assert.equal(h.calls.length, 0)
  }
})

test('non-image proxy payloads, fake raster bytes and non-PNG converted data fail honestly', async () => {
  for (const blob of [
    new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    new Blob(['not a PNG'], { type: 'image/png' }),
    new Blob(['{"error":"expired"}'], { type: 'application/json' }),
    new Blob([]),
  ]) {
    const h = harness({ fetcher: async () => response(blob) })
    await assert.rejects(copyCanvasImage(source, h.options), /图片|位图/)
  }
  const h = harness({ fetcher: async () => response(jpeg()), convertToPng: async () => jpeg() })
  await assert.rejects(copyCanvasImage(source, h.options), /有效的 PNG/)
})

test('download size limits reject headers before reading and cancel oversized streamed bodies', async () => {
  let blobReads = 0
  const headerLimited = harness({
    fetcher: async () =>
      response(png(), {
        headers: new Headers({ 'content-length': MAX_CLIPBOARD_IMAGE_BYTES + 1 }),
        blob: () => {
          blobReads++
          return png()
        },
      }),
  })
  await assert.rejects(copyCanvasImage(source, headerLimited.options), /20MB/)
  assert.equal(blobReads, 0)
  let cancelled = 0,
    released = 0,
    reads = 0
  const chunk = new Uint8Array(1024 * 1024)
  const streamLimited = harness({
    fetcher: async () =>
      response(png(), {
        body: {
          getReader: () => ({
            read: async () => {
              reads++
              return { done: false, value: chunk }
            },
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
  await assert.rejects(copyCanvasImage(source, streamLimited.options), /20MB/)
  assert.equal(reads, 21)
  assert.equal(cancelled, 1)
  assert.equal(released, 1)
})

test('missing clipboard support, unsupported PNG or promised Blob constructor never fall back to text', async () => {
  let fetches = 0,
    textWrites = 0
  for (const extra of [
    { clipboard: {} },
    { ClipboardItemCtor: null },
    {
      ClipboardItemCtor: class extends Item {
        static supports() {
          return false
        }
      },
    },
    {
      ClipboardItemCtor: class {
        constructor() {
          throw new TypeError('Promise Blob unsupported')
        }
      },
    },
  ]) {
    const h = harness({
      fetcher: async () => {
        fetches++
        return response(png())
      },
      ...extra,
    })
    h.options.clipboard.writeText = () => {
      textWrites++
    }
    await assert.rejects(copyCanvasImage(source, h.options), /浏览器|图片剪贴板/)
  }
  await Promise.resolve()
  assert.equal(fetches, 0)
  assert.equal(textWrites, 0)
})

test('clipboard permission and write errors propagate rather than claiming a copied URL', async () => {
  const failure = new Error('binary write failed')
  const h = harness({ clipboard: { write: () => Promise.reject(failure) } })
  await assert.rejects(copyCanvasImage(source, h.options), (error) => error === failure)
  const permission = new DOMException('Permission denied', 'NotAllowedError')
  const denied = harness({
    clipboard: {
      write: () => {
        throw permission
      },
    },
  })
  await assert.rejects(
    copyCanvasImage(source, denied.options),
    (error) =>
      error.name === 'NotAllowedError' &&
      /HTTPS|localhost/.test(error.message) &&
      /权限/.test(error.message),
  )
})

test('external abort cancels the proxy and rejects a pending clipboard image', async () => {
  const pending = deferred(),
    controller = new AbortController()
  let requestSignal
  const h = harness({
    fetcher: (_url, options) => {
      requestSignal = options.signal
      return pending.promise
    },
  })
  const task = copyCanvasImage(source, { ...h.options, signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(task, { name: 'AbortError' })
  assert.equal(requestSignal.aborted, true)
  pending.resolve(response(png()))
  await assert.rejects(copyCanvasImage(source, { ...h.options, signal: controller.signal }), {
    name: 'AbortError',
  })
})

test('bitmap conversion releases the decoder and canvas after PNG encoding and errors', async () => {
  let closed = 0,
    drew = 0
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {
        drew++
      },
    }),
    toBlob: (callback, type) => {
      assert.equal(type, 'image/png')
      callback(png())
    },
  }
  await withGlobals(
    {
      createImageBitmap: async () => ({
        width: 20,
        height: 10,
        close: () => {
          closed++
        },
      }),
      document: { createElement: () => canvas },
    },
    async () => {
      const result = await convertCanvasImageToPng(jpeg())
      assert.equal(result.type, 'image/png')
      assert.equal(closed, 1)
      assert.equal(drew, 1)
      assert.equal(canvas.width, 1)
      assert.equal(canvas.height, 1)
      canvas.getContext = () => null
      await assert.rejects(convertCanvasImageToPng(jpeg()), /画布/)
      assert.equal(closed, 2)
    },
  )
})

test('aborted bitmap decode closes a late decoder without ever allocating canvas', async () => {
  const pending = deferred(),
    controller = new AbortController()
  let closed = 0,
    canvases = 0
  await withGlobals(
    {
      createImageBitmap: () => pending.promise,
      document: {
        createElement: () => {
          canvases++
        },
      },
    },
    async () => {
      const task = convertCanvasImageToPng(jpeg(), { signal: controller.signal })
      for (let i = 0; i < 6; i++) await Promise.resolve()
      controller.abort()
      await assert.rejects(task, { name: 'AbortError' })
      pending.resolve({
        width: 10,
        height: 10,
        close: () => {
          closed++
        },
      })
      await Promise.resolve()
      await Promise.resolve()
      assert.equal(closed, 1)
      assert.equal(canvases, 0)
    },
  )
})

test('Image fallback revokes object URLs and clears load handlers after conversion', async () => {
  const oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL
  let revoked = 0,
    image
  URL.createObjectURL = () => 'blob:owned-test-image'
  URL.revokeObjectURL = () => {
    revoked++
  }
  class MockImage {
    constructor() {
      image = this
      this.naturalWidth = 4
      this.naturalHeight = 3
    }
    set src(value) {
      this.source = value
      if (value) queueMicrotask(() => this.onload?.())
    }
  }
  const canvas = { getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(png()) }
  try {
    await withGlobals(
      { createImageBitmap: undefined, Image: MockImage, document: { createElement: () => canvas } },
      async () => {
        await convertCanvasImageToPng(jpeg())
        assert.equal(revoked, 1)
        assert.equal(image.onload, null)
        assert.equal(image.onerror, null)
        assert.equal(image.source, '')
      },
    )
  } finally {
    URL.createObjectURL = oldCreate
    URL.revokeObjectURL = oldRevoke
  }
})

test('client wrapper keeps defaults and permits per-call cancellation without text writes', async () => {
  const h = harness()
  const client = createImageClipboardClient(h.options)
  assert.equal((await client.copy(`data:image/png;base64,${pngBase64}`)).size, png().size)
  assert.equal(h.writes.length, 1)
})

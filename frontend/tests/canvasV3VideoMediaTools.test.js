import test from 'node:test'
import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import {
  createVideoMediaTools,
  VIDEO_DOWNLOAD_MAX_BYTES,
  VIDEO_FRAME_MAX_PIXELS,
} from '../src/features/canvas-v3/sync/videoMediaTools.js'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lx8AAAAASUVORK5CYII='
const pngBlob = () => new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' })
const MP4 = Uint8Array.from([
  0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115, 111, 109, 109, 112, 52,
  50,
])

function target() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback)
    },
    dispatch(name) {
      for (const callback of [...(listeners.get(name) || [])]) callback()
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0)
    },
  }
}

function captureHarness(options = {}) {
  const videos = []
  const canvases = []
  const calls = []
  const timers = new Map()
  let timerId = 0
  const dependencies = {
    document: { baseURI: 'https://app.example/canvas/' },
    File,
    fetch: async (url, fetchOptions) => {
      calls.push(['fetch', url, fetchOptions])
      throw new TypeError('Isolated test media host is unavailable')
    },
    setTimeout(callback, ms) {
      const id = ++timerId
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    createVideo() {
      let source = ''
      let currentTime = 0
      const video = {
        ...target(),
        readyState: 0,
        seeking: false,
        error: null,
        duration: options.duration ?? 13.25,
        videoWidth: options.width ?? 1280,
        videoHeight: options.height ?? 720,
        get src() {
          return source
        },
        set src(value) {
          calls.push(['src', value, this.crossOrigin, this.listenerCount()])
          source = value
        },
        get currentTime() {
          return currentTime
        },
        set currentTime(value) {
          currentTime = value
          this.seeking = true
          calls.push(['seek', value])
          if (!options.stallSeek)
            queueMicrotask(() => {
              this.seeking = false
              this.dispatch('seeked')
            })
        },
        pause() {
          calls.push(['pause'])
        },
        load() {
          calls.push(['load', source])
          if (
            !source ||
            options.stallMetadata ||
            (options.stallBlobMetadata && source.startsWith('blob:'))
          )
            return
          if (options.throwLoad) throw new Error('Native media load threw synchronously')
          queueMicrotask(() => {
            if (
              options.decodeError ||
              (options.httpDecodeError && /^https?:/.test(source)) ||
              (options.blobDecodeError && source.startsWith('blob:'))
            ) {
              this.error = { code: 4, message: 'Format error' }
              this.dispatch('error')
              return
            }
            this.readyState = options.metadataOnly ? 1 : 2
            this.dispatch('loadedmetadata')
            if (options.metadataOnly)
              (options.earlyDataDecodeError ? queueMicrotask : setImmediate)(() => {
                if (options.dataDecodeError || options.earlyDataDecodeError) {
                  this.error = { code: 3, message: 'Decode error' }
                  this.dispatch('error')
                  return
                }
                this.readyState = 2
                this.dispatch('loadeddata')
              })
          })
        },
        removeAttribute(name) {
          calls.push(['remove', name])
          if (name === 'src') source = ''
        },
      }
      videos.push(video)
      return video
    },
    createCanvas() {
      const canvas = {
        width: 0,
        height: 0,
        getContext() {
          if (options.noCanvasContext) return null
          return {
            drawImage(video, ...coordinates) {
              calls.push(['draw', video.currentTime, ...coordinates])
              if (options.taint) throw new DOMException('Tainted canvas', 'SecurityError')
            },
          }
        },
        toBlob(callback, mime) {
          calls.push(['toBlob', mime])
          if (!options.stallEncode) callback(options.emptyPng ? null : pngBlob())
        },
        toDataURL(mime) {
          calls.push(['toDataURL', mime])
          return options.invalidPng ? 'data:,' : `data:image/png;base64,${PNG}`
        },
      }
      canvases.push(canvas)
      return canvas
    },
  }
  return {
    tools: createVideoMediaTools(dependencies),
    dependencies,
    videos,
    canvases,
    calls,
    timers,
  }
}

test('capture uses an independent anonymous video and emits a genuine PNG only after metadata and seek', async () => {
  const harness = captureHarness({ metadataOnly: true })
  const result = await harness.tools.captureFrame('/real.mp4', 4.2, { filename: '镜头5.png' })
  assert.equal(result.time, 4.2)
  assert.equal(result.duration, 13.25)
  assert.equal(result.width, 1280)
  assert.equal(result.height, 720)
  assert.equal(result.blob.type, 'image/png')
  assert.ok(result.blob.size)
  assert.equal(result.file.name, '镜头5.png')
  assert.equal(result.dataUrl, `data:image/png;base64,${PNG}`)
  assert.deepEqual(harness.calls[0].slice(0, 3), [
    'src',
    'https://app.example/real.mp4',
    'anonymous',
  ])
  assert.ok(harness.calls[0][3] >= 2)
  assert.deepEqual(
    harness.calls.find(([name]) => name === 'draw'),
    ['draw', 4.2, 0, 0, 1280, 720],
  )
  assert.equal(harness.videos[0].src, '')
  assert.equal(harness.videos[0].listenerCount(), 0)
  assert.equal(harness.canvases[0].width, 0)
  assert.equal(harness.canvases[0].height, 0)
  assert.equal(harness.timers.size, 0)
})

test('first frame is decoded at zero; the exact end maps to the last available frame', async () => {
  const first = captureHarness()
  const firstResult = await first.tools.captureFrame('https://cdn.example/a.mp4', 0)
  assert.equal(firstResult.time, 0)
  assert.equal(
    first.calls.some(([name]) => name === 'seek'),
    false,
  )
  assert.equal(first.calls.find(([name]) => name === 'draw')[1], 0)
  const last = captureHarness()
  const lastResult = await last.tools.captureFrame('https://cdn.example/a.mp4', 13.25)
  assert.equal(lastResult.time, 13.21)
  assert.equal(last.calls.find(([name]) => name === 'seek')[1], 13.21)
})

test('large source frames scale to bounded pixels and dimensions without stretching', async () => {
  const harness = captureHarness({ width: 7680, height: 4320 })
  const result = await harness.tools.captureFrame('https://cdn.example/8k.mp4', 1, {
    maxDimension: 4096,
    maxPixels: 2000000,
  })
  assert.ok(result.width * result.height <= 2000000)
  assert.ok(result.width <= 4096 && result.height <= 4096)
  assert.ok(Math.abs(result.width / result.height - 16 / 9) < 0.003)
  assert.equal(harness.videos[0].listenerCount(), 0)
})

test('unsafe sources, invalid time, unsupported dimensions and out-of-duration capture never return an image', async () => {
  for (const source of [
    'javascript:alert(1)',
    'data:video/mp4;base64,eA==',
    'file:///tmp/a.mp4',
    'https://user:pass@cdn.example/a.mp4',
  ]) {
    const harness = captureHarness()
    await assert.rejects(harness.tools.captureFrame(source, 0), /地址/)
    assert.equal(harness.videos.length, 0)
  }
  for (const time of [-1, NaN, Infinity]) {
    const harness = captureHarness()
    await assert.rejects(harness.tools.captureFrame('https://cdn.example/a.mp4', time), /非负/)
    assert.equal(harness.videos.length, 0)
  }
  for (const options of [
    { width: 0 },
    { height: 40000 },
    { duration: Infinity },
    { duration: 0 },
  ]) {
    const harness = captureHarness(options)
    await assert.rejects(harness.tools.captureFrame('https://cdn.example/a.mp4', 0), /尺寸|时长/)
    assert.equal(harness.canvases.length, 0)
    assert.equal(harness.videos[0].src, '')
    assert.equal(harness.timers.size, 0)
  }
  const outside = captureHarness()
  await assert.rejects(outside.tools.captureFrame('https://cdn.example/a.mp4', 14), /超出/)
  assert.equal(
    outside.calls.some(([name]) => name === 'draw'),
    false,
  )
  await assert.rejects(
    outside.tools.captureFrame('https://cdn.example/a.mp4', 0, {
      maxPixels: VIDEO_FRAME_MAX_PIXELS + 1,
    }),
    /像素/,
  )
})

test('CORS taint, decode failure, missing context and empty or invalid PNG all reject honestly with cleanup', async () => {
  for (const options of [
    { taint: true },
    { decodeError: true },
    { noCanvasContext: true },
    { emptyPng: true },
    { invalidPng: true },
  ]) {
    const harness = captureHarness(options)
    await assert.rejects(
      harness.tools.captureFrame('https://cdn.example/a.mp4', 1),
      /跨域|读取|截图|PNG/,
    )
    assert.equal(harness.videos[0].src, '')
    assert.equal(harness.videos[0].listenerCount(), 0)
    assert.equal(harness.timers.size, 0)
  }
})

test('capture abort and timeout interrupt metadata, seeking and PNG encoding and release all resources', async () => {
  for (const stalled of ['stallMetadata', 'stallSeek', 'stallEncode']) {
    const harness = captureHarness({ [stalled]: true })
    const controller = new AbortController()
    const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1, {
      signal: controller.signal,
    })
    for (let index = 0; index < 10; index++) await Promise.resolve()
    controller.abort(new Error('用户取消测试'))
    await assert.rejects(result, /用户取消测试/)
    assert.equal(harness.videos[0].src, '')
    assert.equal(harness.videos[0].listenerCount(), 0)
    assert.equal(harness.timers.size, 0)
  }
  const harness = captureHarness({ stallMetadata: true })
  const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 0, { timeoutMs: 50 })
  const timer = [...harness.timers.values()][0]
  assert.equal(timer.ms, 50)
  timer.callback()
  await assert.rejects(result, /超时/)
  assert.equal(harness.videos[0].listenerCount(), 0)
  const aborted = new AbortController()
  aborted.abort(new Error('已取消'))
  const early = captureHarness()
  await assert.rejects(
    early.tools.captureFrame('https://cdn.example/a.mp4', 0, { signal: aborted.signal }),
    /已取消/,
  )
  assert.equal(early.videos.length, 0)
})

function downloadHarness({
  bytes = MP4,
  type = 'video/mp4',
  status = 200,
  declaredSize = null,
  streamed = true,
  fetchError = null,
  captureOptions = {},
  stallFetch = false,
  stallRead = false,
} = {}) {
  const capture = captureHarness(captureOptions)
  const calls = capture.calls
  const urls = []
  let readerIndex = 0
  const reader = {
    async read() {
      if (stallRead) return new Promise(() => {})
      if (readerIndex++) return { done: true }
      return { value: bytes, done: false }
    },
    cancel() {
      calls.push(['reader.cancel'])
      return Promise.resolve()
    },
    releaseLock() {
      calls.push(['reader.releaseLock'])
    },
  }
  const dependencies = {
    ...capture.dependencies,
    document: {
      baseURI: 'https://app.example/canvas/',
      body: { appendChild: () => calls.push(['anchor.append']) },
      createElement(tag) {
        assert.equal(tag, 'a')
        return {
          style: {},
          click() {
            calls.push(['anchor.click', this.href, this.download])
          },
          remove() {
            calls.push(['anchor.remove'])
          },
        }
      },
    },
    URL: {
      createObjectURL(blob) {
        urls.push(blob)
        calls.push(['createObjectURL', blob])
        return 'blob:download-test-only'
      },
      revokeObjectURL(url) {
        calls.push(['revoke', url])
      },
    },
    fetch: async (url, options) => {
      calls.push(['fetch', url, options])
      if (stallFetch) return new Promise(() => {})
      if (fetchError) throw fetchError
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get(name) {
            if (name === 'content-type') return type
            if (name === 'content-length') return declaredSize
            return null
          },
        },
        body: streamed ? { getReader: () => reader } : null,
        blob: async () => new Blob([bytes], { type }),
      }
    },
  }
  return { ...capture, tools: createVideoMediaTools(dependencies), dependencies, urls, reader }
}

function fallbackHarness(options = {}) {
  return downloadHarness({
    ...options,
    captureOptions: { httpDecodeError: true, ...options.captureOptions },
  })
}

async function flushMediaPromises() {
  for (let index = 0; index < 40; index++) await Promise.resolve()
}

function assertCaptureReleased(harness) {
  for (const video of harness.videos) {
    assert.equal(video.src, '')
    assert.equal(video.listenerCount(), 0)
  }
  for (const canvas of harness.canvases) {
    assert.equal(canvas.width, 0)
    assert.equal(canvas.height, 0)
  }
  assert.equal(harness.timers.size, 0)
  assert.equal(harness.calls.filter(([name]) => name === 'anchor.click').length, 0)
}

test('an HTTP metadata failure retries once through a fresh CORS Blob without changing signed URLs', async () => {
  const harness = fallbackHarness({
    captureOptions: { width: 854, height: 480, duration: 4.064, metadataOnly: true },
    declaredSize: String(MP4.byteLength),
  })
  const source = 'https://cdn.example/clip.mp4?Signature=test%2Bsignature&Expires=12345'
  const result = await harness.tools.captureFrame(source, 2.1, {
    filename: '真实视频-当前帧',
    timeoutMs: 1234,
  })
  assert.equal(result.time, 2.1)
  assert.equal(result.duration, 4.064)
  assert.equal(result.width, 854)
  assert.equal(result.height, 480)
  assert.equal(result.blob.type, 'image/png')
  assert.equal(result.file.name, '真实视频-当前帧.png')
  assert.equal(result.dataUrl, `data:image/png;base64,${PNG}`)
  assert.equal(harness.videos.length, 2)
  const fetches = harness.calls.filter(([name]) => name === 'fetch')
  assert.equal(fetches.length, 1)
  assert.equal(fetches[0][1], source)
  assert.equal(fetches[0][2].mode, 'cors')
  assert.equal(fetches[0][2].credentials, 'omit')
  assert.equal(fetches[0][2].cache, 'no-store')
  assert.ok(fetches[0][2].signal instanceof AbortSignal)
  const sources = harness.calls.filter(([name]) => name === 'src')
  assert.deepEqual(
    sources.map(([, url, crossOrigin]) => [url, crossOrigin]),
    [
      [source, 'anonymous'],
      ['blob:download-test-only', 'anonymous'],
    ],
  )
  const fetchIndex = harness.calls.findIndex(([name]) => name === 'fetch')
  assert.ok(harness.calls.slice(0, fetchIndex).some(([name]) => name === 'remove'))
  assert.equal(harness.urls.length, 1)
  assert.equal(harness.urls[0].type, 'video/mp4')
  assert.deepEqual(new Uint8Array(await harness.urls[0].arrayBuffer()), MP4)
  assert.deepEqual(
    harness.calls.filter(([name]) => name === 'revoke'),
    [['revoke', 'blob:download-test-only']],
  )
  assert.deepEqual(
    harness.calls.find(([name]) => name === 'draw'),
    ['draw', 2.1, 0, 0, 854, 480],
  )
  assertCaptureReleased(harness)
})

test('normal HTTP captures keep the native fast path and never fetch or create a Blob URL', async () => {
  const harness = downloadHarness()
  await harness.tools.captureFrame('https://cdn.example/direct.mp4', 1)
  assert.equal(harness.videos.length, 1)
  assert.equal(harness.urls.length, 0)
  assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 0)
  assert.equal(harness.calls.filter(([name]) => name === 'revoke').length, 0)
  assertCaptureReleased(harness)
})

test('Blob decode failures never fetch, while a second decode failure stops after one HTTP retry', async () => {
  const local = fallbackHarness({ captureOptions: { blobDecodeError: true } })
  await assert.rejects(
    local.tools.captureFrame('blob:https://app.example/local-video', 1),
    /视频|读取/,
  )
  assert.equal(local.videos.length, 1)
  assert.equal(local.calls.filter(([name]) => name === 'fetch').length, 0)
  assert.equal(local.urls.length, 0)
  assertCaptureReleased(local)

  const twice = fallbackHarness({ captureOptions: { blobDecodeError: true } })
  await assert.rejects(twice.tools.captureFrame('https://cdn.example/broken.mp4', 1), /视频|读取/)
  assert.equal(twice.videos.length, 2)
  assert.equal(twice.calls.filter(([name]) => name === 'fetch').length, 1)
  assert.equal(twice.urls.length, 1)
  assert.equal(twice.calls.filter(([name]) => name === 'revoke').length, 1)
  assertCaptureReleased(twice)
})

test('invalid capture metadata, times, canvas output and non-metadata errors do not trigger a network retry', async () => {
  const invalid = [
    { captureOptions: { duration: 0 } },
    { captureOptions: { duration: Infinity } },
    { captureOptions: { width: 0 } },
    { captureOptions: { height: 40000 } },
    { time: -1 },
    { time: NaN },
    { time: 20 },
    { captureOptions: { taint: true } },
    { captureOptions: { invalidPng: true } },
    { captureOptions: { emptyPng: true } },
    { captureOptions: { noCanvasContext: true } },
    { captureOptions: { throwLoad: true } },
    { captureOptions: { metadataOnly: true, dataDecodeError: true } },
  ]
  for (const options of invalid) {
    const harness = downloadHarness(options)
    await assert.rejects(harness.tools.captureFrame('https://cdn.example/a.mp4', options.time ?? 1))
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 0)
    assert.equal(harness.urls.length, 0)
    assertCaptureReleased(harness)
  }
})

test('a decode error between metadata and loadeddata listeners is rejected immediately rather than awaiting timeout', async () => {
  const harness = downloadHarness({
    captureOptions: { metadataOnly: true, earlyDataDecodeError: true },
  })
  let rejection
  const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1).catch((error) => {
    rejection = error
  })
  await flushMediaPromises()
  const rejectedBeforeTimeout = !!rejection
  // If this regression returns, settle the pending capture before failing the
  // assertion so this isolated fake-timer test cannot stall the whole suite.
  if (!rejectedBeforeTimeout) {
    for (const timer of [...harness.timers.values()]) timer.callback()
  }
  await result
  assert.equal(rejectedBeforeTimeout, true)
  assert.match(rejection.message, /视频|解码|读取/)
  assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 0)
  assert.equal(harness.urls.length, 0)
  assertCaptureReleased(harness)
})

test('HTTP retry still rejects partial, disguised, truncated, oversized or inaccessible video responses', async () => {
  for (const response of [
    { status: 206 },
    { status: 403 },
    { type: 'text/html', bytes: new TextEncoder().encode('<html>Access denied</html>') },
    { type: 'video/mp4', bytes: new TextEncoder().encode('<html>Not a video</html>') },
    { declaredSize: '999' },
    { declaredSize: String(VIDEO_DOWNLOAD_MAX_BYTES + 1) },
    { bytes: new Uint8Array() },
    { fetchError: new TypeError('Failed to fetch') },
  ]) {
    const harness = fallbackHarness(response)
    await assert.rejects(harness.tools.captureFrame('https://cdn.example/a.mp4', 1))
    assert.equal(harness.videos.length, 1)
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 1)
    assert.equal(harness.urls.length, 0)
    assert.equal(harness.canvases.length, 0)
    assertCaptureReleased(harness)
  }
})

test('abort or timeout during native metadata does not start the HTTP retry', async () => {
  for (const mode of ['abort', 'timeout']) {
    const harness = downloadHarness({ captureOptions: { stallMetadata: true } })
    const controller = new AbortController()
    const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1, {
      signal: controller.signal,
      timeoutMs: 77,
    })
    await flushMediaPromises()
    if (mode === 'abort') controller.abort(new Error('取消截帧原生读取'))
    else [...harness.timers.values()][0].callback()
    await assert.rejects(result, mode === 'abort' ? /取消截帧原生读取/ : /超时/)
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 0)
    assert.equal(harness.urls.length, 0)
    assertCaptureReleased(harness)
  }
})

test('cancelling retry fetch or stream read settles even when the host ignores AbortSignal', async () => {
  for (const stalled of ['stallFetch', 'stallRead']) {
    const harness = fallbackHarness({ [stalled]: true })
    const controller = new AbortController()
    const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1, {
      signal: controller.signal,
    })
    await flushMediaPromises()
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 1)
    controller.abort(new Error('取消重读视频'))
    await assert.rejects(result, /取消重读视频/)
    assert.equal(harness.urls.length, 0)
    if (stalled === 'stallRead')
      assert.equal(harness.calls.filter(([name]) => name === 'reader.cancel').length, 1)
    assertCaptureReleased(harness)
  }
})

test('HTTP retry fetch and stream reads share the capture timeout and leave no pending resources', async () => {
  for (const stalled of ['stallFetch', 'stallRead']) {
    const harness = fallbackHarness({ [stalled]: true })
    const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1, { timeoutMs: 99 })
    await flushMediaPromises()
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 1)
    const timers = [...harness.timers.values()]
    assert.ok(timers.length)
    assert.ok(timers.every((timer) => timer.ms === 99))
    timers[0].callback()
    await assert.rejects(result, /超时/)
    assert.equal(harness.urls.length, 0)
    assertCaptureReleased(harness)
  }
})

test('abort or timeout during retry Blob decoding revokes its URL and cleans both videos', async () => {
  for (const mode of ['abort', 'timeout']) {
    const harness = fallbackHarness({ captureOptions: { stallBlobMetadata: true } })
    const controller = new AbortController()
    const result = harness.tools.captureFrame('https://cdn.example/a.mp4', 1, {
      signal: controller.signal,
      timeoutMs: 88,
    })
    await flushMediaPromises()
    assert.equal(harness.videos.length, 2)
    assert.equal(harness.urls.length, 1)
    if (mode === 'abort') controller.abort(new Error('取消 Blob 视频解码'))
    else [...harness.timers.values()][0].callback()
    await assert.rejects(result, mode === 'abort' ? /取消 Blob 视频解码/ : /超时/)
    assert.equal(harness.calls.filter(([name]) => name === 'fetch').length, 1)
    assert.deepEqual(
      harness.calls.filter(([name]) => name === 'revoke'),
      [['revoke', 'blob:download-test-only']],
    )
    assertCaptureReleased(harness)
  }
})

test('download validates full bytes, preserves the real clip and starts a safe Blob download without credentials', async () => {
  const harness = downloadHarness({ declaredSize: String(MP4.byteLength) })
  const result = await harness.tools.downloadOriginal('https://cdn.example/a.mp4', {
    filename: '镜头5.mp4',
  })
  assert.equal(result.downloadStarted, true)
  assert.equal(result.filename, '镜头5.mp4')
  assert.equal(result.file.name, '镜头5.mp4')
  assert.equal(result.blob.type, 'video/mp4')
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), MP4)
  const fetch = harness.calls.find(([name]) => name === 'fetch')
  assert.equal(fetch[2].mode, 'cors')
  assert.equal(fetch[2].credentials, 'omit')
  assert.equal(fetch[2].cache, 'no-store')
  assert.equal(harness.calls.filter(([name]) => name === 'anchor.click').length, 1)
  assert.ok(harness.calls.some(([name]) => name === 'anchor.remove'))
  assert.ok(harness.calls.some(([name]) => name === 'reader.cancel'))
  assert.equal(harness.timers.size, 1)
  const timer = [...harness.timers.values()][0]
  assert.equal(timer.ms, 1000)
  timer.callback()
  assert.ok(harness.calls.some(([name]) => name === 'revoke'))
})

test('fetch-only download has no click or object URL and supports binary MIME with real video signatures', async () => {
  const harness = downloadHarness({ type: 'application/octet-stream', streamed: false })
  const result = await harness.tools.downloadOriginal('https://cdn.example/a', {
    filename: '../a.html',
    save: false,
  })
  assert.equal(result.filename, '..-a.mp4')
  assert.equal(result.downloadStarted, false)
  assert.equal(result.mime, 'video/mp4')
  assert.equal(harness.urls.length, 0)
  assert.equal(harness.timers.size, 0)
  assert.equal(harness.calls.filter(([name]) => name.startsWith('anchor.')).length, 0)
})

test('HTML, JSON, errors, disguised non-video and partial or truncated content cannot become downloaded files', async () => {
  const invalid = [
    { type: 'text/html', bytes: new TextEncoder().encode('<html>Access denied</html>') },
    { type: 'application/json', bytes: new TextEncoder().encode('{"error":"expired"}') },
    { type: 'video/mp4', bytes: new TextEncoder().encode('<html>Access denied</html>') },
    { type: 'application/octet-stream', bytes: new TextEncoder().encode('<!DOCTYPE html>') },
    { status: 403 },
    { status: 206 },
    { bytes: new Uint8Array() },
    { declaredSize: '999' },
    { bytes: Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 97, 118, 105, 102]) },
  ]
  for (const options of invalid) {
    const harness = downloadHarness(options)
    await assert.rejects(
      harness.tools.downloadOriginal('https://cdn.example/a.mp4'),
      /视频|文件|内容|片段/,
    )
    assert.equal(harness.urls.length, 0)
    assert.equal(harness.calls.filter(([name]) => name === 'anchor.click').length, 0)
    assert.equal(harness.timers.size, 0)
  }
})

test('download size caps reject both declared and streamed overflow and distinguish CORS failures', async () => {
  const declared = downloadHarness({ declaredSize: String(VIDEO_DOWNLOAD_MAX_BYTES + 1) })
  await assert.rejects(declared.tools.downloadOriginal('https://cdn.example/a.mp4'), /大小/)
  const streamed = downloadHarness()
  await assert.rejects(
    streamed.tools.downloadOriginal('https://cdn.example/a.mp4', { maxBytes: 4 }),
    /大小/,
  )
  assert.ok(streamed.calls.some(([name]) => name === 'reader.cancel'))
  assert.equal(streamed.urls.length, 0)
  const cors = downloadHarness({ fetchError: new TypeError('Failed to fetch') })
  await assert.rejects(cors.tools.downloadOriginal('https://cdn.example/a.mp4'), /跨域/)
  assert.equal(cors.timers.size, 0)
})

test('download abort and timeout settle even if the media host ignores AbortSignal', async () => {
  for (const abortType of ['signal', 'timeout']) {
    const capture = captureHarness()
    const controller = new AbortController()
    const tools = createVideoMediaTools({
      ...capture.dependencies,
      fetch: () => new Promise(() => {}),
    })
    const promise = tools.downloadOriginal('https://cdn.example/a.mp4', {
      signal: controller.signal,
      timeoutMs: 100,
    })
    if (abortType === 'signal') controller.abort(new Error('取消原视频下载'))
    else [...capture.timers.values()][0].callback()
    await assert.rejects(promise, abortType === 'signal' ? /取消原视频下载/ : /超时/)
    assert.equal(capture.timers.size, 0)
  }
})

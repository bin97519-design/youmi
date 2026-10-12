import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateReferenceShotCount,
  fetchReferenceVideoFile,
  MAX_REFERENCE_VIDEO_BYTES,
  referenceVideoReadError,
  selectReferenceFrameTimes,
  summarizeAudioLevels,
} from './referenceVideo.js'

function sample(time, value) {
  return { time, signature: new Uint8Array(16).fill(value) }
}

test('reference frame selection keeps endpoints and prioritizes visual cuts', () => {
  const samples = [
    sample(0.03, 10),
    sample(1, 12),
    sample(2, 14),
    sample(3, 230),
    sample(4, 228),
    sample(5, 226),
    sample(6, 30),
    sample(7, 32),
    sample(7.96, 33),
  ]
  const times = selectReferenceFrameTimes(samples, 8, 6)
  assert.equal(times[0], 0.03)
  assert.equal(times.at(-1), 7.96)
  assert.ok(times.includes(3))
  assert.ok(times.includes(6))
  assert.ok(times.length <= 6)
  assert.deepEqual(
    times,
    times.toSorted((left, right) => left - right),
  )
  assert.equal(estimateReferenceShotCount(samples, 8, 6), 3)
  assert.equal(
    estimateReferenceShotCount(
      samples.map((item) => sample(item.time, 20)),
      8,
      6,
    ),
    1,
  )
})

test('audio summary distinguishes silence, steady sound and visible peaks', () => {
  assert.match(summarizeAudioLevels([0, 0.001, 0.002]), /静音/)
  assert.match(summarizeAudioLevels([0.02, 0.021, 0.019, 0.02]), /变化较平稳/)
  const summary = summarizeAudioLevels([0.01, 0.012, 0.09, 0.011, 0.08, 0.01])
  assert.match(summary, /第 1、2 秒/)
  assert.match(summary, /不作为口播文字转写/)
})

test('compact prompt sampling covers a two minute video within the model image limit', () => {
  const samples = Array.from({ length: 64 }, (_, index) => sample((index * 120) / 63, 20))
  const times = selectReferenceFrameTimes(samples, 120, 8, 8)
  assert.equal(times.length, 8)
  assert.equal(times[0], 0)
  assert.equal(times.at(-1), 120)
  assert.equal(new Set(times).size, 8)
  assert.deepEqual(
    times,
    times.toSorted((a, b) => a - b),
  )
  assert.ok(times.slice(1).every((time, index) => time - times[index] < 32))
})

test('remote video is downloaded without preview cache, cookies or range requests', async (t) => {
  const bytes = new Uint8Array([1, 2, 3, 4])
  let request
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options }
    return new Response(bytes, {
      headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) },
    })
  })
  const progress = []
  const file = await fetchReferenceVideoFile('https://media.test/video.mp4', {
    onProgress: (value) => progress.push(value),
  })
  assert.equal(request.options.cache, 'no-store')
  assert.equal(request.options.credentials, 'omit')
  assert.equal(request.options.mode, 'cors')
  assert.equal(request.options.headers, undefined)
  assert.equal(file.type, 'video/mp4')
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes)
  assert.equal(progress.at(-1), 100)
})

test('remote access failures do not incorrectly report an unsupported video codec', async (t) => {
  let response
  t.mock.method(globalThis, 'fetch', async () => response)
  for (const [status, expected] of [
    [403, /无访问权限或已过期/],
    [404, /文件不存在/],
    [502, /下载源视频失败（502）/],
  ]) {
    response = new Response('', { status })
    await assert.rejects(fetchReferenceVideoFile('https://media.test/video.mp4'), expected)
  }
  response = new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(fetchReferenceVideoFile('https://media.test/video.mp4'), /不是视频文件/)
  response = new Response(new Uint8Array(), { headers: { 'content-type': 'video/mp4' } })
  await assert.rejects(fetchReferenceVideoFile('https://media.test/video.mp4'), /文件为空/)
  response = new Response(new Uint8Array([1]), {
    headers: { 'content-length': String(MAX_REFERENCE_VIDEO_BYTES + 1) },
  })
  await assert.rejects(fetchReferenceVideoFile('https://media.test/video.mp4'), /最大 150MB/)
})

test('remote download propagates cancellation and describes network errors separately', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(
    fetchReferenceVideoFile('https://media.test/video.mp4'),
    /网络或视频地址的跨域/,
  )
  const controller = new AbortController()
  const reason = new Error('Result node deleted')
  controller.abort(reason)
  await assert.rejects(
    fetchReferenceVideoFile('https://media.test/video.mp4', { signal: controller.signal }),
    (error) => error === reason,
  )
  t.mock.method(
    globalThis,
    'fetch',
    (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      ),
  )
  const active = new AbortController()
  const downloading = fetchReferenceVideoFile('https://media.test/video.mp4', {
    signal: active.signal,
  })
  active.abort(reason)
  await assert.rejects(downloading, (error) => error === reason)
  assert.match(referenceVideoReadError(2), /网络错误/)
  assert.doesNotMatch(referenceVideoReadError(2), /H\.264/)
  assert.match(referenceVideoReadError(3), /无法解码/)
})

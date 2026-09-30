export const MAX_REFERENCE_SECONDS = 120.5
export const MAX_REFERENCE_SHOTS = 48
const SAMPLE_SIZE = 48

function waitFor(target, event, errorEvent = 'error') {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, complete)
      target.removeEventListener(errorEvent, fail)
    }
    const complete = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('无法读取参考视频，请换用 MP4（H.264）格式'))
    }
    target.addEventListener(event, complete, { once: true })
    target.addEventListener(errorEvent, fail, { once: true })
  })
}

async function seek(video, time) {
  if (Math.abs(video.currentTime - time) < 0.015 && video.readyState >= 2) return
  const ready = waitFor(video, 'seeked')
  video.currentTime = time
  await ready
}

function signature(context, video) {
  context.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
  const pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  const values = new Uint8Array(SAMPLE_SIZE * SAMPLE_SIZE)
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    values[target] = Math.round(
      pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114,
    )
  }
  return values
}

function difference(left, right) {
  let total = 0
  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index])
  }
  return total / left.length / 255
}

function detectReferenceCuts(samples, duration, maximum) {
  if (samples.length < 2) return []
  const changes = samples.slice(1).map((sample, index) => ({
    time: sample.time,
    score: difference(samples[index].signature, sample.signature),
  }))
  const mean = changes.reduce((sum, item) => sum + item.score, 0) / changes.length
  const deviation = Math.sqrt(
    changes.reduce((sum, item) => sum + (item.score - mean) ** 2, 0) / changes.length,
  )
  const threshold = Math.max(0.11, mean + deviation * 0.7)
  const minimumGap = Math.max(0.55, duration / (maximum * 2.5))
  const cuts = changes
    .filter((item, index) => {
      if (item.score < threshold) return false
      const before = changes[index - 1]?.score ?? -1
      const after = changes[index + 1]?.score ?? -1
      return item.score >= before && item.score >= after
    })
    .toSorted((left, right) => right.score - left.score)

  const selected = []
  for (const cut of cuts) {
    if (selected.length >= maximum - 1) break
    if (
      cut.time >= minimumGap &&
      duration - cut.time >= minimumGap &&
      selected.every((item) => Math.abs(item.time - cut.time) >= minimumGap)
    )
      selected.push(cut)
  }
  return selected
}

export function estimateReferenceShotCount(samples, duration, maximum = 8) {
  if (!samples.length || !Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(maximum, detectReferenceCuts(samples, duration, maximum).length + 1)
}

export function referenceVideoSegments(samples, duration) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_REFERENCE_SECONDS)
    throw new Error('参考视频需在 2 分钟以内')
  const end = Math.round(duration * 100) / 100
  const cuts = detectReferenceCuts(samples, duration, 32)
    .map((cut) => Math.round(cut.time * 100) / 100)
    .sort((a, b) => a - b)
  const boundaries = [0, ...cuts, end]
  const segments = []
  for (let index = 1; index < boundaries.length; index++) {
    const start = boundaries[index - 1],
      length = boundaries[index] - start
    const count = Math.ceil(length / 15)
    for (let part = 0; part < count; part++)
      segments.push({
        start: Math.round((start + (length * part) / count) * 100) / 100,
        end: Math.round((start + (length * (part + 1)) / count) * 100) / 100,
      })
  }
  if (
    segments.length > MAX_REFERENCE_SHOTS ||
    segments.some((segment) => segment.end - segment.start < 0.5)
  )
    throw new Error('参考视频切镜过密，请分成两个任务反推')
  return segments
}

export function selectReferenceFrameTimes(samples, duration, maximum = 8) {
  if (!samples.length || !Number.isFinite(duration) || duration <= 0) return []
  if (samples.length === 1) return [samples[0].time]
  const cuts = detectReferenceCuts(samples, duration, maximum)
  const minimumGap = Math.max(0.55, duration / (maximum * 2.5))

  const chosen = [samples[0].time, samples.at(-1).time]
  for (const cut of cuts) {
    if (chosen.length >= maximum) break
    if (chosen.every((time) => Math.abs(time - cut.time) >= minimumGap)) chosen.push(cut.time)
  }

  const suggestedCount = Math.min(maximum, cuts.length + 1)
  const target = Math.min(maximum, Math.max(3, suggestedCount + 1))
  while (chosen.length < target) {
    const sorted = chosen.toSorted((left, right) => left - right)
    let start = sorted[0]
    let end = sorted[1]
    for (let index = 1; index < sorted.length - 1; index += 1) {
      if (sorted[index + 1] - sorted[index] > end - start) {
        start = sorted[index]
        end = sorted[index + 1]
      }
    }
    const middle = (start + end) / 2
    const sample = samples.reduce((best, item) =>
      Math.abs(item.time - middle) < Math.abs(best.time - middle) ? item : best,
    )
    if (chosen.some((time) => Math.abs(time - sample.time) < 0.05)) break
    chosen.push(sample.time)
  }
  return chosen.toSorted((left, right) => left - right).slice(0, maximum)
}

function canvasFile(canvas, index) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], `reference-shot-${index + 1}.jpg`, { type: 'image/jpeg' }))
          : reject(new Error('无法提取参考视频画面')),
      'image/jpeg',
      0.86,
    ),
  )
}

async function extractFrame(video, time, index) {
  await seek(video, time)
  const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale))
  canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height)
  return { time: Number(time.toFixed(2)), file: await canvasFile(canvas, index) }
}

export function summarizeAudioLevels(levels, windowSeconds = 0.5) {
  if (!levels.length || Math.max(...levels) < 0.004) return '未检测到明显音轨或视频接近静音。'
  const average = levels.reduce((sum, level) => sum + level, 0) / levels.length
  const peaks = levels
    .map((level, index) => ({ level, index }))
    .filter(
      (item, index) =>
        item.level > Math.max(average * 1.55, 0.025) &&
        item.level >= (levels[index - 1] ?? 0) &&
        item.level >= (levels[index + 1] ?? 0),
    )
    .toSorted((left, right) => right.level - left.level)
    .slice(0, 6)
    .map((item) => Number((item.index * windowSeconds).toFixed(1)))
    .toSorted((left, right) => left - right)
  const quiet = levels.filter((level) => level < average * 0.35).length / levels.length
  const strength = average < 0.018 ? '偏弱' : average < 0.055 ? '中等' : '较强'
  return (
    [
      `检测到音轨，整体声音强度${strength}`,
      peaks.length ? `明显声音或节奏峰值约在第 ${peaks.join('、')} 秒` : '声音强弱变化较平稳',
      quiet > 0.3 ? '存在较多弱声或留白区间' : '声音连续性较高',
      '这里只识别声音强弱与节奏，不作为口播文字转写结果',
    ].join('；') + '。'
  )
}

async function inspectAudio(file) {
  if (!globalThis.AudioContext || file.size > 100 * 1024 * 1024)
    return '未读取声音节奏；如有口播，请在商品信息与视频要求中填写台词。'
  const context = new AudioContext()
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer())
    const channel = buffer.getChannelData(0)
    const windowSeconds = 0.5
    const windowSize = Math.max(1, Math.round(buffer.sampleRate * windowSeconds))
    const levels = []
    for (let start = 0; start < channel.length; start += windowSize) {
      let square = 0
      const end = Math.min(channel.length, start + windowSize)
      const stride = Math.max(1, Math.floor((end - start) / 5000))
      let count = 0
      for (let index = start; index < end; index += stride) {
        square += channel[index] ** 2
        count += 1
      }
      levels.push(Math.sqrt(square / Math.max(1, count)))
    }
    return summarizeAudioLevels(levels, windowSeconds)
  } catch {
    return '未能读取声音节奏；如有口播，请在商品信息与视频要求中填写台词。'
  } finally {
    await context.close().catch(() => {})
  }
}

export async function inspectReferenceVideoFile(file, maximumFrames = 8) {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  try {
    const loaded = waitFor(video, 'loadedmetadata')
    video.src = objectUrl
    await loaded
    const duration = Number(video.duration)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取参考视频时长')
    if (duration > MAX_REFERENCE_SECONDS)
      throw new Error('单次反推支持最长 2 分钟，请先截取需要参考的片段')
    const longVideo = duration > 30.5
    const sampleCount = Math.min(longVideo ? 288 : 64, Math.max(12, Math.ceil(duration / 0.45)))
    const small = document.createElement('canvas')
    small.width = SAMPLE_SIZE
    small.height = SAMPLE_SIZE
    const context = small.getContext('2d', { alpha: false, willReadFrequently: true })
    const samples = []
    for (let index = 0; index < sampleCount; index += 1) {
      const time = Math.min(Math.max(0.03, duration - 0.04), (index * duration) / (sampleCount - 1))
      await seek(video, time)
      samples.push({ time, signature: signature(context, video) })
    }
    const segments = longVideo ? referenceVideoSegments(samples, duration) : null
    const times = segments
      ? segments.flatMap(({ start, end }) => [start + 0.03, (start + end) / 2, end - 0.04])
      : selectReferenceFrameTimes(samples, duration, maximumFrames)
    const suggestedShotCount =
      segments?.length ?? estimateReferenceShotCount(samples, duration, maximumFrames)
    const frames = []
    for (let index = 0; index < times.length; index += 1) {
      frames.push(await extractFrame(video, times[index], index))
    }
    return {
      duration: Number(duration.toFixed(2)),
      width: video.videoWidth,
      height: video.videoHeight,
      suggestedShotCount,
      ...(segments ? { segments } : {}),
      audioSummary: await inspectAudio(file),
      frames,
    }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

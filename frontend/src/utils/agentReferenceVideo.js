import { inspectReferenceVideoFile, MAX_REFERENCE_VIDEO_BYTES } from './referenceVideo.js'
import { uploadFileDirect } from './ossUpload.js'

export function agentVideoFrameLimit(imageCount = 0) {
  const count = Math.max(0, Number(imageCount) || 0)
  if (count > 4) throw new Error('发送视频时最多同时添加 4 张参考图，请移除多余图片')
  return 8 - count
}

export function selectAgentVideoFrames(frames, limit) {
  if (frames.length <= limit) return frames
  return Array.from(
    { length: limit },
    (_, index) => frames[Math.round((index * (frames.length - 1)) / (limit - 1))],
  )
}

export async function prepareAgentReferenceVideo(reference, imageCount = 0, options = {}) {
  const limit = agentVideoFrameLimit(imageCount)
  if (reference.uploading) throw new Error('视频还在上传，请完成后再发送')
  if (reference.error || !/^https?:\/\//i.test(reference.url || ''))
    throw new Error('视频上传未完成或地址不可用，请重新添加')
  if (reference.file?.size > MAX_REFERENCE_VIDEO_BYTES)
    throw new Error('视频不能超过 150MB，请先压缩或截取视频')
  options.signal?.throwIfAborted()
  const cached = reference.preparedVideo
  if (cached?.url === reference.url && cached.frames?.length >= 2) {
    return { ...cached, frames: selectAgentVideoFrames(cached.frames, limit) }
  }
  options.onStage?.('正在读取视频画面')
  const inspection = await inspectReferenceVideoFile(reference.file || reference.url, limit, {
    compact: true,
    signal: options.signal,
    onDownloadProgress: (progress) => options.onStage?.(`正在读取源视频 ${progress}%`),
    onProgress: (progress) => options.onStage?.(`正在提取视频关键帧 ${progress}%`),
  })
  const frames = []
  for (const frame of inspection.frames) {
    options.signal?.throwIfAborted()
    options.onStage?.(`正在上传视频关键帧 ${frames.length + 1}/${inspection.frames.length}`)
    const url = await uploadFileDirect(frame.file, {
      dir: 'canvas/agent-video-frames',
      signal: options.signal,
    })
    frames.push({ url, time: frame.time })
  }
  options.signal?.throwIfAborted()
  if (frames.length < 2) throw new Error('视频关键帧不足，请重新添加视频')
  reference.preparedVideo = {
    url: reference.url,
    name: String(reference.name || '参考视频').slice(0, 200),
    duration: inspection.duration,
    width: inspection.width,
    height: inspection.height,
    audioSummary: inspection.audioSummary,
    frames,
  }
  return reference.preparedVideo
}

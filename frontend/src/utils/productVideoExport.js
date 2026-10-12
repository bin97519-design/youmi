import { selectedVideo } from './productVideo.js'

export function exportTimeline(shots = []) {
  let cursor = 0
  return shots
    .filter((shot) => shot.kept && selectedVideo(shot))
    .map((shot) => {
      const value = Number(shot.duration)
      const duration = Number.isFinite(value) && value > 0 ? value : 0
      const start = cursor
      cursor += duration
      return { shot, start, end: cursor, duration }
    })
}

export function reorderExportClips(shots, orderedIds) {
  const clips = exportTimeline(shots).map(({ shot }) => shot)
  const byId = new Map(clips.map((shot) => [shot.id, shot]))
  if (
    orderedIds.length !== clips.length ||
    new Set(orderedIds).size !== clips.length ||
    orderedIds.some((id) => !byId.has(id))
  )
    return shots
  let cursor = 0
  return shots.map((shot) => (byId.has(shot.id) ? byId.get(orderedIds[cursor++]) : shot))
}

export function moveExportClip(shots, sourceId, targetId, after = false) {
  const ids = exportTimeline(shots).map(({ shot }) => shot.id)
  if (sourceId === targetId || !ids.includes(sourceId) || !ids.includes(targetId)) return shots
  ids.splice(ids.indexOf(sourceId), 1)
  ids.splice(ids.indexOf(targetId) + (after ? 1 : 0), 0, sourceId)
  return reorderExportClips(shots, ids)
}

export function exportClipRange(shot) {
  const video = shot && selectedVideo(shot)
  if (!video?.url) return null
  const sourceDuration = Number(video.duration || 15)
  const duration = Number(shot.duration)
  const speed = shot.timingMode === 'speed'
  const start = speed ? 0 : Number(shot.start || 0)
  if (
    ![sourceDuration, duration, start].every(Number.isFinite) ||
    sourceDuration <= 0 ||
    start < 0 ||
    duration < 0.5 ||
    duration > Math.min(30, sourceDuration) ||
    start + duration > sourceDuration + 0.05
  )
    return null
  const playbackRate = speed ? sourceDuration / duration : 1
  return {
    url: video.url,
    start,
    end: speed ? sourceDuration : start + duration,
    playbackRate,
    previewSupported: playbackRate <= 16,
  }
}

export function exportTime(seconds) {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0
  const tenths = Math.round(safe * 10)
  const minutes = Math.floor(tenths / 600)
  const remainder = ((tenths % 600) / 10).toFixed(1).padStart(4, '0')
  return `${minutes}:${remainder}`
}

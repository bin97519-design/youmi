import { canGenerateVideo, selectedVideo, isWholeVideo, executionDuration } from './productVideo.js'
import { adjacentProductVideoShots, shotConnection } from './productVideoShotConnections.js'

export function productVideoBatchCandidates(workflow) {
  const selected = []
  for (const shot of workflow.shots) {
    if (selectedVideo(shot) || shot.videos.some(item => ['submitting', 'processing', 'unknown'].includes(item.status))) continue
    const previous = adjacentProductVideoShots(workflow, shot).previous
    const relay = !isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue'
    if (relay ? shot.motion.trim() && previous && (selectedVideo(previous) || selected.includes(previous)) : canGenerateVideo(shot))
      selected.push(shot)
  }
  return selected
}

export function productVideoBatchConfiguration(workflow, shotIds) {
  return JSON.stringify({
    model: workflow.videoModel, wholeModel: workflow.wholeVideo30Model, ratio: workflow.ratio,
    resolution: workflow.videoResolution, wholeResolution: workflow.wholeVideo30Resolution,
    minimaxResolution: workflow.minimaxResolution, audio: workflow.generateAudio === true,
    continuity: workflow.continuity, planningSource: workflow.planningSource,
    order: workflow.shots.map(shot => shot.id),
    shots: shotIds.map(id => {
      const shot = workflow.shots.find(item => item.id === id)
      const relay = shot && !isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue'
      return shot ? { id, title: shot.title, mode: shot.productionMode, motion: shot.motion, duration: executionDuration(shot, workflow),
        connection: shot.connection,
        ...(!relay ? { imageId: shot.imageId, approvedImageId: shot.approvedImageId } : {}),
      } : { id, removed: true }
    }),
  })
}

export function batchVideoState(shot, jobId) {
  const entry = shot.videos.findLast(item => item.batchId === jobId)
  if (entry?.status === 'unknown') return 'unknown'
  if (['submitting', 'processing'].includes(entry?.status)) return 'processing'
  if (entry?.status === 'failed') return 'failed'
  return selectedVideo(shot) ? 'completed' : 'ready'
}

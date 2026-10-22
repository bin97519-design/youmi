import { canGenerateVideo, selectedVideo, isWholeVideo, executionDuration, usesWholeReferenceImages, wholeVideoReferenceInputs, videoGenerationPending } from './productVideo.js'
import { adjacentProductVideoShots, shotConnection } from './productVideoShotConnections.js'

export function productVideoBatchCandidates(workflow) {
  const selected = []
  for (const shot of workflow.shots) {
    if (selectedVideo(shot) || shot.videos.some(videoGenerationPending)) continue
    const previous = adjacentProductVideoShots(workflow, shot).previous
    const relay = !isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue'
    if (relay ? shot.motion.trim() && previous && (selectedVideo(previous) || selected.includes(previous)) : canGenerateVideo(shot, workflow))
      selected.push(shot)
  }
  return selected
}

export function productVideoBatchConfiguration(workflow, shotIds) {
  return JSON.stringify({
    model: workflow.videoModel, wholeModel: workflow.wholeVideo30Model, ratio: workflow.ratio,
    resolution: workflow.videoResolution, wholeResolution: workflow.wholeVideo30Resolution,
    minimaxResolution: workflow.minimaxResolution, audio: workflow.generateAudio === true,
    version: workflow.videoVersion,
    continuity: workflow.continuity, planningSource: workflow.planningSource,
    referenceRecreation: workflow.referenceRecreation,
    referenceVideo: workflow.planningSource === 'reference'
      ? { url: workflow.referenceVideo?.url, duration: workflow.referenceVideo?.duration } : null,
    order: workflow.shots.map(shot => shot.id),
    shots: shotIds.map(id => {
      const shot = workflow.shots.find(item => item.id === id)
      const relay = shot && !isWholeVideo(shot.productionMode) && shotConnection(workflow, shot).type === 'continue'
      return shot ? { id, title: shot.title, mode: shot.productionMode, motion: shot.motion, duration: executionDuration(shot, workflow),
        connection: shot.connection,
        ...(usesWholeReferenceImages(workflow, shot)
          ? { videoInputMode: 'references', referenceUrls: wholeVideoReferenceInputs(workflow, shot).urls }
          : !relay ? { videoInputMode: shot.videoInputMode, imageId: shot.imageId, approvedImageId: shot.approvedImageId } : {}),
      } : { id, removed: true }
    }),
  })
}

export function batchVideoState(shot, jobId) {
  const entry = shot.videos.findLast(item => item.batchId === jobId)
  if (entry?.status === 'unknown' && videoGenerationPending(entry)) return 'unknown'
  if (videoGenerationPending(entry)) return 'processing'
  if (entry?.status === 'failed') return 'failed'
  return selectedVideo(shot) ? 'completed' : 'ready'
}

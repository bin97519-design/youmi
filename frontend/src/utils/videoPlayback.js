export function hasDecodedVideoFrame(media) {
  return Number(media?.videoWidth) > 0 && Number(media?.videoHeight) > 0
}

export function videoPlaybackResultPatch(layer, result) {
  if (
    result?.status !== 'completed' ||
    !/^https?:\/\//i.test(result.url || '') ||
    !(Number(result.width) > 0 && Number(result.height) > 0)
  ) {
    throw new Error('播放转换没有返回有效的视频画面，原视频已保留')
  }
  return {
    originalVideoUrl: layer.originalVideoUrl || layer.url,
    url: result.url,
    naturalWidth: result.width,
    naturalHeight: result.height,
    duration: Number(result.duration) || layer.duration || 0,
    ...(!layer.naturalWidth ||
    layer.naturalWidth <= 16 ||
    Math.abs(layer.naturalWidth / layer.naturalHeight - result.width / result.height) > 0.01
      ? { height: Math.max(1, Math.round((layer.width * result.height) / result.width)) }
      : {}),
    videoPlayback: { sourceUrl: layer.url, id: result.id, status: 'completed', error: '' },
  }
}

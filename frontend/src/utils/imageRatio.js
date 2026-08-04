export const SUPPORTED_IMAGE_RATIOS = ['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

export function resolveSupportedImageRatio(layer, fallback = '1:1') {
  const width = Number(layer?.naturalWidth || layer?.width || 0)
  const height = Number(layer?.naturalHeight || layer?.height || 0)
  if (!(width > 0) || !(height > 0)) {
    return SUPPORTED_IMAGE_RATIOS.includes(fallback) ? fallback : '1:1'
  }

  const sourceRatio = width / height
  return SUPPORTED_IMAGE_RATIOS.reduce((closest, candidate) => {
    const [candidateWidth, candidateHeight] = candidate.split(':').map(Number)
    const candidateRatio = candidateWidth / candidateHeight
    const candidateDistance = Math.abs(Math.log(sourceRatio / candidateRatio))

    if (!closest || candidateDistance < closest.distance) {
      return { ratio: candidate, distance: candidateDistance }
    }
    return closest
  }, null).ratio
}

const OSS_BASE_URL = 'https://huami-canvas.oss-cn-shanghai.aliyuncs.com'
const OSS_IMAGE_MAP = new Map([
  ['generation-options-clean.png', `${OSS_BASE_URL}/version-log/assets/2.0.3/generation-options-clean.png`],
  ['canvas-overview.png', `${OSS_BASE_URL}/version-log/assets/2.0.3/canvas-overview.png`],
])

export function resolveVersionHistoryImageUrl(filename) {
  return OSS_IMAGE_MAP.get(filename) || `/version-log/assets/${filename}`
}

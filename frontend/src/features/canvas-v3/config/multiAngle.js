// Stable preset values and text transcribed from the supplied 2026-10-16 recording.
export const ANGLE_PRESETS = Object.freeze([
  { id: 'custom', label: '自定义', horizontal: 0, vertical: 0, distance: 5, prompt: '' },
  {
    id: 'fisheye',
    label: '鱼眼视角',
    horizontal: 0,
    vertical: 30,
    distance: 10,
    prompt: '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果',
  },
  {
    id: 'dutch',
    label: '倾斜视角',
    horizontal: 45,
    vertical: -30,
    distance: 5,
    prompt: 'dutch angle, tilted frame',
  },
  { id: 'front-high', label: '正面俯拍', horizontal: 0, vertical: 60, distance: 5, prompt: '' },
  { id: 'front-low', label: '正面仰拍', horizontal: 0, vertical: -30, distance: 5, prompt: '' },
  { id: 'wide-high', label: '全景俯拍', horizontal: 45, vertical: 30, distance: 0, prompt: '' },
  { id: 'back', label: '背面视角', horizontal: 180, vertical: 0, distance: 5, prompt: '' },
])

const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
export function normalizeCamera(camera = {}) {
  const horizontal = finite(camera.horizontal, 0)
  return {
    presetId: ANGLE_PRESETS.some((p) => p.id === camera.presetId) ? camera.presetId : 'custom',
    // Keep the slider's right endpoint stable instead of snapping 360 back to 0.
    horizontal: horizontal === 360 ? 360 : ((horizontal % 360) + 360) % 360,
    // The recording does not show the endpoints. Use the physical orbit's poles,
    // not the unrelated -30..60 limits of the older provider-specific editor.
    vertical: clamp(finite(camera.vertical, 0), -90, 90),
    distance: clamp(finite(camera.distance, 5), 0, 10),
    promptEnabled: camera.promptEnabled === true,
    prompt: String(camera.prompt || '').slice(0, 4000),
  }
}
export function anglePreset(id) {
  const preset = ANGLE_PRESETS.find((p) => p.id === id)
  if (!preset) return null
  return normalizeCamera({ ...preset, presetId: id, promptEnabled: Boolean(preset.prompt) })
}
export function changeCamera(camera, patch) {
  return normalizeCamera({ ...camera, ...patch, presetId: 'custom' })
}
export function angleShotLabel(distance) {
  return distance <= 2 ? '全景' : distance >= 8 ? '特写' : '中景'
}
export function angleInstructions(camera) {
  const c = normalizeCamera(camera)
  const directions = ['正面', '右前方', '右侧面', '右后方', '背面', '左后方', '左侧面', '左前方']
  const direction = directions[Math.round(c.horizontal / 45) % 8]
  return [
    '以连接的原图为唯一视觉参考，生成同一主体在新相机机位下的一张图片。保持主体身份、外形、发型、服装、材质、颜色、场景关系和画面风格一致。',
    `相机水平环绕角：${Math.round(c.horizontal)}°（0°正面、90°右侧、180°背面、270°左侧），目标观察方向：${direction}。`,
    `相机垂直俯仰角：${Math.round(c.vertical)}°；正数从上方俯拍，负数从下方仰拍，0°平视。`,
    `景别缩放：${Math.round(c.distance)}/10（0最远、10最近），目标景别：${angleShotLabel(c.distance)}。`,
    '真正改变相机与主体的三维空间视角，合理呈现遮挡、透视和原图未见的表面；不要只旋转、翻转、拉伸或裁切原图。背面机位不要强行让人物正面对镜头。输出单张画面，不要宫格、多视图拼贴、文字或水印。',
    c.promptEnabled && c.prompt.trim() ? `补充镜头要求：${c.prompt.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
export const MULTI_ANGLE_TEMPLATE = Object.freeze({
  id: 'multi-angle',
  label: '多角度',
  icon: 'angles',
  hint: '调整机位、景别与镜头要求，使用当前配置的图片模型生成新视角。',
})
export function multiAnglePreset(camera) {
  return {
    title: '多角度',
    prompt: '',
    params: { ratio: 'Auto', count: '1张' },
    editTemplate: { id: 'multi-angle', version: 1, camera: normalizeCamera(camera) },
  }
}
export function anglePanelPlacement(anchor, viewport) {
  const width = Math.min(600, Math.max(260, viewport.width - 32))
  const availableHeight = Math.max(180, viewport.height - 140)
  return {
    left: clamp(anchor.centerX - width / 2, 16, Math.max(16, viewport.width - width - 16)),
    top: clamp(
      anchor.bottom + 14,
      60,
      Math.max(60, viewport.height - Math.min(386, availableHeight) - 72),
    ),
    width,
    maxHeight: availableHeight,
  }
}

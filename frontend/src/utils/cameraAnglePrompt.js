const HORIZONTAL_VIEWS = [
  { angle: 0, name: '正面', composition: '完整呈现主体正面' },
  { angle: 45, name: '右前方', composition: '同时呈现主体正面和右侧面' },
  { angle: 90, name: '正右侧', composition: '完整呈现主体右侧面' },
  { angle: 135, name: '右后方', composition: '同时呈现主体背面和右侧面' },
  { angle: 180, name: '正后方', composition: '完整呈现主体背面' },
  { angle: 225, name: '左后方', composition: '同时呈现主体背面和左侧面' },
  { angle: 270, name: '正左侧', composition: '完整呈现主体左侧面' },
  { angle: 315, name: '左前方', composition: '同时呈现主体正面和左侧面' },
]

const DISTANCE_VIEWS = {
  0: {
    name: '近景',
    instruction: '相机靠近主体，突出主体细节，但仍需保留主体完整结构',
    occupancy: '主体约占画面宽高的78%到88%',
  },
  1: {
    name: '中景',
    instruction: '使用自然的中等拍摄距离，完整展示主体及少量周边环境',
    occupancy: '主体约占画面宽高的60%到72%',
  },
  2: {
    name: '远景',
    instruction: '相机远离主体，完整展示主体以及更充分的周边空间',
    occupancy: '主体约占画面宽高的40%到55%',
  },
}

const SURFACE_QUADRANTS = [
  { start: 0, first: '正面', second: '右侧面', hidden: '背面' },
  { start: 90, first: '右侧面', second: '背面', hidden: '正面' },
  { start: 180, first: '背面', second: '左侧面', hidden: '正面' },
  { start: 270, first: '左侧面', second: '正面', hidden: '背面' },
]

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function formatAngle(value) {
  const rounded = Math.round(finiteNumber(value) * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function normalizeHorizontalAngle(value) {
  const angle = finiteNumber(value)
  return ((angle % 360) + 360) % 360
}

export function describeHorizontalAngle(value) {
  const inputAngle = clamp(finiteNumber(value), -180, 180)
  const normalizedAngle = normalizeHorizontalAngle(inputAngle)
  const nearestIndex = Math.round(normalizedAngle / 45) % HORIZONTAL_VIEWS.length
  const view = HORIZONTAL_VIEWS[nearestIndex]
  const direction =
    inputAngle === 0
      ? '保持在主体正前方'
      : inputAngle < 0
        ? `从主体正面向左环绕 ${formatAngle(Math.abs(inputAngle))}°`
        : `从主体正面向右环绕 ${formatAngle(inputAngle)}°`

  return {
    inputAngle,
    normalizedAngle,
    name: view.name,
    direction,
    composition: view.composition,
  }
}

export function describeSurfaceVisibility(value) {
  const normalizedAngle = normalizeHorizontalAngle(clamp(finiteNumber(value), -180, 180))
  const quadrantIndex = Math.min(3, Math.floor(normalizedAngle / 90))
  const quadrant = SURFACE_QUADRANTS[quadrantIndex]
  const localAngle = normalizedAngle - quadrant.start
  const firstProjection = Math.max(0, Math.cos((localAngle * Math.PI) / 180))
  const secondProjection = Math.max(0, Math.sin((localAngle * Math.PI) / 180))
  const total = firstProjection + secondProjection || 1
  const firstPercent = Math.round((firstProjection / total) * 100)
  const secondPercent = 100 - firstPercent

  if (secondPercent <= 2) {
    return `${quadrant.first}为主要可见面，约占主体可见表面的100%；相邻侧面只能保留极窄的自然透视边缘`
  }
  if (firstPercent <= 2) {
    return `${quadrant.second}为主要可见面，约占主体可见表面的100%；相邻侧面只能保留极窄的自然透视边缘`
  }
  return `${quadrant.first}约占主体可见表面的${firstPercent}%，${quadrant.second}约占${secondPercent}%；${quadrant.hidden}不得错误出现在主体朝向相反的一侧`
}

export function describeVerticalAngle(value) {
  const angle = clamp(finiteNumber(value), -30, 60)
  const absolute = Math.abs(angle)

  if (absolute < 1) {
    return {
      angle: 0,
      name: '平视',
      instruction: '相机与主体视觉中心基本等高，保持自然平视',
      surfaceInstruction: '顶面和底面不应被刻意展开，只保留符合平视透视的自然窄边',
    }
  }

  if (angle < 0) {
    return {
      angle,
      name: absolute <= 12 ? '轻微仰拍' : absolute <= 22 ? '低机位仰拍' : '显著仰拍',
      instruction: `相机低于主体视觉中心，以 ${formatAngle(absolute)}° 仰角向上拍摄`,
      surfaceInstruction:
        absolute <= 12
          ? '轻微增加主体下沿或底部结构的可见度，顶面可见度相应降低'
          : '清晰呈现合理的下沿或底部结构，顶面必须因遮挡而明显减少',
    }
  }

  return {
    angle,
    name: angle <= 15 ? '轻微俯拍' : angle <= 40 ? '高机位俯拍' : '高角度俯拍',
    instruction: `相机高于主体视觉中心，以 ${formatAngle(angle)}° 俯角向下拍摄`,
    surfaceInstruction:
      angle <= 15
        ? '轻微增加主体顶面的可见度，底面不可见'
        : '清晰呈现主体顶面及其真实纵深，底部结构应被主体自然遮挡',
  }
}

export function describeDistance(value) {
  const distance = clamp(Math.round(finiteNumber(value, 1)), 0, 2)
  return { distance, ...DISTANCE_VIEWS[distance] }
}

export function getCameraAngleSpec({
  horizontalAngle = 0,
  verticalAngle = 0,
  distance = 1,
} = {}) {
  const horizontal = describeHorizontalAngle(horizontalAngle)
  const vertical = describeVerticalAngle(verticalAngle)
  const framing = describeDistance(distance)

  return {
    horizontal,
    vertical,
    distance: framing,
    summary: `${horizontal.name} ${formatAngle(Math.abs(horizontal.inputAngle))}° · ${vertical.name} ${formatAngle(Math.abs(vertical.angle))}° · ${framing.name}`,
  }
}

export function buildCameraAnglePrompt({
  horizontalAngle = 0,
  verticalAngle = 0,
  distance = 1,
  additionalPrompt = '',
  preserveBackground = true,
} = {}) {
  const spec = getCameraAngleSpec({ horizontalAngle, verticalAngle, distance })
  const horizontalInput = formatAngle(spec.horizontal.inputAngle)
  const horizontalNormalized = formatAngle(spec.horizontal.normalizedAngle)
  const vertical = formatAngle(spec.vertical.angle)
  const extra = String(additionalPrompt || '').trim()
  const visibilityInstruction = describeSurfaceVisibility(spec.horizontal.inputAngle)
  const backgroundInstruction = preserveBackground
    ? '保持参考图的场景类型、材质氛围、色温和主光方向，但不要锁死原背景的像素位置；背景透视、地面消失点、投影方向和遮挡关系必须随新机位同步重建。'
    : '使用简洁、低干扰的自然背景，并根据新机位重建透视、地面接触和投影；背景不得影响主体识别。'

  return [
    '【单一主体多角度摄影任务】',
    '参考图1是唯一的主体外观依据。先在内部把主体理解为具有真实长、宽、高和遮挡关系的三维物体，再从指定的新相机位置重新拍摄。',
    '主体固定在原地且朝向不变；移动的是相机，不是主体。严禁直接旋转、拉伸、镜像或透视扭曲参考图的二维像素。',
    '',
    '【相机坐标规则】',
    '水平角以主体正面为0°：正值表示相机沿主体右侧绕拍，负值表示相机沿主体左侧绕拍；90°为正右侧、180°为正后方、270°为正左侧。',
    '垂直角以平视为0°：负值表示低机位仰拍，正值表示高机位俯拍。',
    '距离参数：0=近景，1=中景，2=远景。',
    '',
    '【目标机位（最高优先级，必须严格遵守）】',
    `- horizontal_angle：${horizontalInput}°，归一化为 ${horizontalNormalized}°`,
    `- 水平机位：${spec.horizontal.direction}，属于${spec.horizontal.name}视角`,
    `- vertical_angle：${vertical}°，${spec.vertical.instruction}`,
    `- distance：${spec.distance.distance}，${spec.distance.instruction}；${spec.distance.occupancy}`,
    '',
    '【新视角可见面校验】',
    `- 水平可见面：${visibilityInstruction}`,
    `- 垂直可见面：${spec.vertical.surfaceInstruction}`,
    '- 所有边线、消失点、近大远小关系、遮挡顺序和接触阴影都必须与上述水平角和垂直角一致。',
    '',
    '【主体身份与结构锁定】',
    '严格保持主体的类别、数量、长宽高比例、轮廓、结构连接、零部件位置、颜色、材质、纹理、缝线和边缘特征。不可见区域只能依据已有结构做最保守、对称且连续的补全。',
    '参考图中的商标、文字和图案只能出现在其原本附着的真实表面；该表面在新机位不可见时，不得把文字或图案复制到其他表面。',
    '',
    '【构图与场景】',
    '只生成一张连续、完整的摄影图。主体完整清晰、视觉中心稳定、四周保留安全边距，不裁断主体，不做拼图、对比图、步骤图或角度标注。',
    backgroundInstruction,
    '',
    '【失败判定】',
    '以下任一情况均视为失败：仍是原视角、主体自身被旋转、左右面颠倒、俯仰方向相反、二维拉伸、镜像、结构错位、重复部件、悬浮、融合、比例异常、添加无关物体或出现角度说明文字。',
    ...(extra ? ['', '【附加要求】', extra] : []),
  ].join('\n')
}

import { characterStudioAssetPrompt } from './characterStudioAssetFormats.js'

// Full menu order verified in the live LibTV canvas, including its scroll tail.
// Prompts are our editable implementations, not proprietary LibTV prompts.
export const IMAGE_GRID_TEMPLATES = [
  {
    id: 'multi-camera',
    label: '多机位九宫格',
    icon: 'grid',
    ratio: '16:9',
    prompt:
      '以引用图为唯一主体与场景参考，生成一张 3×3 多机位九宫格图。九个画格依次展示：正面全景、左前方中景、右前方中景、左侧面、右侧面、背面、俯视、低机位仰视、主体细节特写。保持主体身份、外观、服装或产品结构、材质、色彩、场景和光线一致，只改变机位和景别。九格尺寸一致、排列整齐，不要添加文字、数字或水印；输出一张完整九宫格图片，而不是九张独立图片。',
  },
  {
    id: 'story-four',
    label: '剧情推演四宫格',
    icon: 'gridFour',
    ratio: '16:9',
    prompt:
      '以引用图为故事起点，生成一张 2×2 剧情推演四宫格。按从左到右、从上到下的顺序，展示建立情境、动作发生、情绪或事件转折、结果四个连续镜头。保持人物身份、服装、主体外观、场景和时间连续，使用合理的景别变化推进剧情。四格尺寸一致，不要文字、对白气泡、数字或水印；仅输出一张完整四宫格图片。',
  },
  {
    id: 'face-three',
    label: '角色脸部三视图',
    icon: 'faceViews',
    ratio: '16:9',
    prompt:
      '根据引用图中的角色，生成一张横向排列的脸部三视图：正面、四分之三侧面、正侧面。严格保持同一角色的五官比例、脸型、肤色、年龄、发型和饰品，三个视图使用统一头部大小、中性表情、柔和光线和干净背景。不要改换人物，不要遮挡脸部，不要文字或水印；仅输出一张包含三个视图的完整图片。',
  },
  {
    id: 'character-sheet',
    label: '角色设定图',
    icon: 'characterSheet',
    ratio: '16:9',
    prompt: characterStudioAssetPrompt('character-sheet'),
  },
  {
    id: 'scene-sheet',
    label: '场景设定图',
    icon: 'sceneSheet',
    ratio: '16:9',
    prompt:
      '以引用图为场景参考，生成一张场景设定图。包含场景全景、两个不同方向的空间视角，以及关键建筑、陈设和材质细节。保持空间布局、时代风格、色彩、天气、光线与物体结构一致，确保不同视角在空间上相互对应。画面排版清晰，不要文字、数字或水印；仅输出一张完整设定图。',
  },
  {
    id: 'product-sheet',
    label: '产品设定图',
    icon: 'productSheet',
    ratio: '4:3',
    prompt:
      '根据引用图中的产品，生成一张产品设定图。展示产品正面、侧面、背面、四分之三视角，以及关键结构和材质细节。严格保持产品外形、比例、配色、已有标识和结构一致，不要增减零件，不要改变产品设计。使用统一的干净背景、柔和棚拍光线与整齐排版，不要额外文字或水印；仅输出一张完整设定图。',
  },
  {
    id: 'story-twenty-five',
    label: '25宫格连贯分镜',
    icon: 'storyGrid',
    ratio: '16:9',
    prompt:
      '以引用图为统一视觉参考，生成一张 5×5、共 25 格的连贯分镜图。按从左到右、从上到下的顺序，完整呈现同一场景中的连续事件：先建立环境与主体，再展开动作、细节、反应与转折，最后收束事件。保持主体身份、服装或产品外观、场景布局、光线和时间连续，交替使用全景、中景、近景与特写，避免画面重复。25 个画格尺寸一致、整齐排列，不要文字、数字、对白气泡或水印；仅输出一张包含全部分镜的完整图片。',
  },
  {
    id: 'cinematic-light',
    label: '电影级光影校正',
    icon: 'cinematicLight',
    prompt:
      '对引用图进行电影级光影与色彩校正。完整保留原图主体身份、内容、构图、产品结构和画幅，不要生成宫格。优化主光、补光、明暗层次、色温、对比度和高光阴影细节，使光线自然、主体立体、画面具有克制的电影质感。避免过曝、死黑、过度锐化或改变肤色；仅输出一张校正后的图片，不要文字或水印。',
  },
  {
    id: 'character-three',
    label: '角色三视图',
    icon: 'threeViews',
    ratio: '16:9',
    prompt:
      '以引用图中的角色为唯一身份参考，生成一张横向三联全身三视图：正面、标准侧面、背面。保持角色头身比例、体型、发型、服装剪裁、图案、材质、颜色和配饰完全一致，使用统一站姿、统一人物高度、干净背景和均匀光线。完整展示头部到脚部，不裁切、不加入其他角色，不要文字或水印；仅输出一张包含三个全身视图的完整图片。',
  },
  {
    id: 'future-three-seconds',
    label: '画面推演 - 3秒后',
    icon: 'frameForward',
    prompt:
      '将引用图视为同一连续镜头的当前帧，推演并生成三秒后的单帧画面。根据人物姿态、视线、物体运动趋势和场景逻辑自然延续动作，保持角色身份、服装、产品外观、空间布局、镜头风格和光线连续。不随意新增主体或跳转场景，不生成宫格，不添加文字或水印；仅输出三秒后的一张画面。',
  },
  {
    id: 'past-five-seconds',
    label: '画面推演 - 5秒前',
    icon: 'frameBackward',
    prompt:
      '将引用图视为同一连续镜头的当前帧，合理倒推并生成五秒前的单帧画面。根据当前人物动作、物体位置和事件结果，重建自然连贯的前置状态，保持角色身份、服装、产品外观、空间布局、镜头风格和光线一致。不随意新增主体或跳转场景，不生成宫格，不添加文字或水印；仅输出五秒前的一张画面。',
  },
]

export function imageGridTemplate(id) {
  return IMAGE_GRID_TEMPLATES.find((item) => item.id === id) || null
}

export function imageGridHint(id) {
  const template = imageGridTemplate(id)
  if (!template) return ''
  if (id === 'story-twenty-five')
    return '点击生成，直接基于当前图像进行25宫格剧情推演；支持文生/参考图生成。'
  if (id === 'future-three-seconds')
    return '点击生成，基于当前图像推演3秒后的画面；支持通过文本/参考图生成。'
  if (id === 'past-five-seconds')
    return '点击生成，基于当前图像推演5秒前的画面；支持通过文本/参考图生成。'
  return `点击生成，直接基于当前图像${id === 'scene-sheet' ? '生成完整的场景设定图' : `生成${template.label}`}；支持通过文本/参考图生成。`
}

export function imageGridPreset(id) {
  const template = imageGridTemplate(id)
  if (!template) return null
  return {
    title: template.label,
    prompt: '',
    // A sheet is ONE image containing multiple panels, not a paid batch of 9/25.
    params: { ...(template.ratio ? { ratio: template.ratio } : {}), count: '1张' },
    editTemplate: { id: template.id, version: 1 },
  }
}

import { videoReferenceVideoLimits, videoReferencePayload } from './chatVideoSettings.js'

export function recreationSettings(workflow) {
  const saved = workflow.referenceRecreation || {}
  return {
    generationMode: 'script', personMode: 'new', sceneMode: 'source', audioMode: 'new',
    ...saved, person: String(saved.person || ''), scene: String(saved.scene || ''), images: saved.images || {},
  }
}

export const usesReferenceVideoGeneration = (workflow) =>
  workflow.planningSource === 'reference' && recreationSettings(workflow).generationMode === 'video'

export function recreationMaterialIssue(workflow) {
  if (workflow.planningSource !== 'reference') return ''
  const settings = recreationSettings(workflow)
  if (settings.personMode === 'reference' && !settings.images?.person?.url)
    return '请上传或选择要替换的人物参考图'
  if (settings.sceneMode === 'custom' && !settings.images?.scene?.url && !settings.scene.trim())
    return '请填写新场景要求，或上传场景参考图'
  return ''
}

export function referenceGenerationIssue(workflow, model, shot = workflow) {
  if (!usesReferenceVideoGeneration(workflow)) return ''
  if (!['single_video', 'single_video_30'].includes(shot.productionMode))
    return '参考原片生成目前用于整片制作；请选择整片 15 秒或 30 秒，多分镜可使用仅反推脚本'
  if (workflow.referenceStrategy === 'highlights')
    return '精华 30 秒采用脚本重建；参考原片生成需上传已经裁好的短参考视频'
  const limits = videoReferenceVideoLimits(model)
  if (!limits) return '当前视频模型不支持参考视频，请更换支持参考视频的模型，或选择仅反推脚本'
  const reference = workflow.referenceVideo
  if (!reference?.url) return '请先上传参考视频'
  const seconds = Number(reference.duration)
  if (!Number.isFinite(seconds) || seconds < limits.minSeconds || seconds > limits.maxSeconds)
    return `当前模型的参考视频需为 ${limits.minSeconds} 至 ${limits.maxSeconds} 秒；长片可先裁成短片，或选择仅反推脚本`
  return ''
}

export function recreationPrompt(workflow) {
  if (workflow.planningSource !== 'reference') return ''
  const settings = recreationSettings(workflow)
  return [
    '用户复刻设定优先于原片人物身份和场景外观；保留原片的动作过程、镜头顺序、相对时长、运镜与转场。商品以用户商品图为准。',
    settings.personMode === 'source'
      ? '人物：沿用用户选择的已授权原片人物，保持来源中的身份与服装，不额外增减角色。'
      : settings.personMode === 'reference'
        ? '人物：替换为人物参考图中的角色，只采用其可见外观与服装；不得从原视频重新带回原人物长相。保留原片对应角色的站位、动作、出镜范围和角色数量。'
        : '人物：重新设计人物外观，不以原片真人的可识别形象为目标。保留原片角色的站位、动作、出镜范围和数量；无人镜头保持无人，同一新角色再次出现时保持身份与服装。',
    settings.personMode !== 'source' && settings.person.trim() ? `新人物补充要求：${settings.person.trim()}` : '',
    settings.sceneMode === 'custom'
      ? `场景：使用新的场景参考图或以下要求重建空间，保留动作所需的相对位置、机位和运镜路径，不从原片带回旧房间。${settings.scene.trim()}`
      : '场景：沿用参考视频的空间关系、布景风格和光线变化；商品仍替换为用户商品。',
    settings.audioMode === 'source'
      ? '声音：参考用户选择的已授权原片声音设计，保留可确认的口播内容、环境声和音乐节奏关系。无法确认的台词不编造，声线未单独提供授权配音资料时使用新声线；不能声称已直接复用原音轨。'
      : '声音：重新策划台词、配音和配乐，不克隆原片人物声线，不直接搬用原片台词或音乐；保留与动作对应的环境声和节奏位置。',
    '人物或场景发生替换时，先在开场画面明确新形象，再贯穿所有镜头；具体动作、运镜和声音仍需人工检查生成结果。',
  ].filter(Boolean).join('\n')
}

export function recreationVideoPayload(workflow, model, images, shot) {
  const issue = referenceGenerationIssue(workflow, model, shot)
  if (issue) throw new Error(issue)
  return videoReferencePayload(model, 'cankaosheng', images, [{
    url: workflow.referenceVideo.url, duration: Number(workflow.referenceVideo.duration),
  }])
}

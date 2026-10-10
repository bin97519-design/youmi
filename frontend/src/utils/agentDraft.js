import { VIDEO_MODELS } from './productVideo.js'
import {
  estimatedVideoMiCost,
  validVideoDuration,
  validVideoResolution,
  videoReferenceLimit,
  isProviderReportedCostVideoModel,
} from './chatVideoSettings.js'

export function canCreateAgentDraft(response, prompts) {
  return (
    response?.readyToGenerate === true &&
    [undefined, 'image', 'video'].includes(response.generationType) &&
    Array.isArray(prompts) &&
    prompts.length > 0
  )
}

export function totalAgentGenerationCount(models, count) {
  const uniqueModels = new Set((Array.isArray(models) ? models : [models]).filter(Boolean))
  const perModelCount = Math.max(1, Math.min(4, Number(count) || 1))
  return Math.max(1, uniqueModels.size) * perModelCount
}

export function agentVideoDraftError(config, references, prompt, capabilities, models = VIDEO_MODELS) {
  if (!config || !models.some((option) => option.value === config.model))
    return '请选择视频模型'
  if (!String(prompt || '').trim()) return '视频脚本不能为空'
  if (String(prompt).length > 2500) return '视频脚本超过 2500 字，请先让 Agent 精简'
  if (!validVideoDuration(config.model, Number(config.duration)))
    return `所选模型不支持 ${config.duration} 秒，请调整模型或时长`
  if (!validVideoResolution(config.model, config.resolution)) return '所选模型不支持这个清晰度'
  const limit = videoReferenceLimit(config.model, config.referenceMode)
  if (references.length > limit) return `所选模式最多支持 ${limit} 张参考图`
  if (
    estimatedVideoMiCost(
      config.model,
      config.resolution,
      Number(config.duration),
      capabilities,
      isProviderReportedCostVideoModel(config.model, models),
    ) == null
  )
    return '视频接口密钥或米值单价尚未配置'
  return ''
}

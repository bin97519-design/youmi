import { imageCustomSize, imageModelControls, imageModelParams } from './imageModelParameters.js'
import {
  IMAGE_MODEL_QUALITIES,
  IMAGE_MODEL_VERSIONS,
  isTtImage25Model,
} from './imageModelVersions.js'
import {
  isMinimaxH3Model,
  isSeedance20AnciModel,
  isSeedance25Model,
  videoModelControls,
  videoModelParams,
} from './videoModelParameters.js'
import { deriveVideoInputMode } from './videoInputMode.js'
import { isKling30Model, klingVideoMode } from './klingVideoModes.js'
import { isKlingOmniApiModel } from './klingOmniIdentity.js'
import { klingOmniControls, klingOmniParams } from './klingOmniParameters.js'
import { resolveKlingOmniRoute } from './klingOmniRoutes.js'
import { klingOmniReferenceState } from './klingOmniReferences.js'
import { isWanxiangModel, wanxiangControls, wanxiangParams } from './wanxiangParameters.js'
import { wanxiangReferenceState } from './wanxiangReferences.js'

const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
const selectionValue = (value) => (typeof value === 'object' ? value?.value : value)
const identity = (value) =>
  String(typeof value === 'object' ? value?.model || value?.value || '' : value || '').trim()

function referenceSummary(references = []) {
  const reference = {
    imageCount: 0,
    videoCount: 0,
    audioCount: 0,
    videoDurationSeconds: 0,
    audioDurationSeconds: 0,
  }
  const seen = new Set()
  const objects = new WeakSet()
  for (const item of Array.isArray(references) ? references : []) {
    if (!item || typeof item !== 'object') continue
    const data = item.data || item
    if (!['image', 'video', 'audio'].includes(data.kind)) continue
    const id = item.id ?? item.nodeId ?? data.nodeId
    if (id != null && String(id)) {
      if (seen.has(String(id))) continue
      seen.add(String(id))
    } else {
      if (objects.has(item)) continue
      objects.add(item)
    }
    if (!String(data.assetUrl ?? data.url ?? '').trim())
      throw new Error('参考素材尚未就绪，暂不能预估米值')
    reference[`${data.kind}Count`] += 1
    if (data.kind !== 'image') {
      const raw = data.mediaDuration ?? data.durationSeconds
      const duration =
        typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
      if (!Number.isFinite(duration) || duration <= 0)
        throw new Error(
          `尚未读取参考${data.kind === 'video' ? '视频' : '音频'}的实际时长，暂不能预估米值`,
        )
      reference[`${data.kind}DurationSeconds`] += duration
    }
  }
  return reference
}

function imageReferenceSummary(references = []) {
  // Match imageTaskRequest.image_urls exactly: only ready image asset URLs,
  // deduplicated by URL rather than by node. Audio/video are not submitted.
  const urls = new Set(
    (Array.isArray(references) ? references : [])
      .map((item) => item?.data || item)
      .filter((data) => data?.kind === 'image' && data.assetUrl)
      .map((data) => data.assetUrl),
  )
  return {
    imageCount: urls.size,
    videoCount: 0,
    audioCount: 0,
    videoDurationSeconds: 0,
    audioDurationSeconds: 0,
  }
}

function resolveRoute(model, modelOption, modelOptions, family) {
  const selected = selectionValue(model)
  if (typeof selected !== 'string' || !selected.trim()) throw new Error('请先选择已配置的模型')
  const configured = Array.isArray(modelOptions)
    ? modelOptions
    : modelOption && typeof modelOption === 'object'
      ? [modelOption]
      : []
  const exact = configured.find((option) => option?.value === selected)
  if (exact) {
    if (exact.uiOnly || (family && !family(exact))) throw new Error('所选模型暂不支持预估米值')
    return exact
  }
  if (selected.startsWith('model-api-key:'))
    throw new Error('所选模型线路已失效，请重新选择，暂不能预估米值')
  const choices = family
    ? configured.filter((option) => option?.value && family(option) && !option.uiOnly)
    : []
  if (choices.length > 1) throw new Error('模型存在多条线路，请明确选择一条后预估米值')
  if (choices.length === 1) return choices[0]
  throw new Error('模型尚未配置对应接口，暂不能预估米值')
}

function explicitFields(raw, profile, transform = (_key, value) => value) {
  for (const field of profile.fields) {
    if (!Object.hasOwn(raw, field.key) || raw[field.key] == null) continue
    const value = transform(field.key, raw[field.key])
    if (!field.options.some((option) => option.value === value))
      throw new Error(`${field.label}参数无效，暂不能预估米值`)
  }
}

function imageParams(option, raw, switches) {
  const profile = imageModelControls(option)
  const value = imageModelParams(option, raw)
  const tt = isTtImage25Model(option)
  for (const key of ['resolution', 'ratio']) {
    if (raw[key] != null && !profile.fields[key]?.[1].includes(raw[key]))
      throw new Error('图片尺寸或清晰度参数无效，暂不能预估米值')
  }
  const result = {
    resolution: value.resolution,
    size: value.ratio === 'Auto' ? 'auto' : value.ratio,
    count: 1,
  }
  if (tt) {
    if (
      raw.version != null &&
      !IMAGE_MODEL_VERSIONS.some((version) => version.value === raw.version)
    )
      throw new Error('图片版本参数无效，暂不能预估米值')
    const quality =
      IMAGE_MODEL_QUALITIES.find(
        (entry) => entry.label === (raw.quality ?? '标准画质') || entry.value === raw.quality,
      )?.value || (raw.quality === 'auto' ? 'auto' : '')
    const background =
      { 自动: 'auto', 保留背景: 'opaque', 透明背景: 'transparent' }[raw.background ?? '自动'] ||
      (['auto', 'opaque', 'transparent'].includes(raw.background) ? raw.background : '')
    if (!quality || !background) throw new Error('图片画质或背景参数无效，暂不能预估米值')
    Object.assign(result, { version: value.version, quality, background })
    if (switches['自定义尺寸'] === true) result.custom_size = imageCustomSize(raw.customSize)
  }
  if (profile.id === 'banana-2.1') {
    if (
      raw.thinkingLevel != null &&
      !['快速', '深度', 'minimal', 'high'].includes(raw.thinkingLevel)
    )
      throw new Error('图片思考等级参数无效，暂不能预估米值')
    result.thinking_level = value.thinkingLevel === '深度' ? 'high' : 'minimal'
    result.web_search = switches['联网搜索'] !== false
  }
  return result
}

function nativeVideoParams(option, raw, references, switches) {
  const input = deriveVideoInputMode(option, references)
  if (input.error) throw new Error(input.error)
  const profile = videoModelControls(option, input.mode)
  for (const [key, field] of Object.entries(profile.fields)) {
    if (raw[key] == null) continue
    const normalized =
      key === 'resolution'
        ? String(raw[key]).toUpperCase()
        : key === 'ratio' && raw[key] === 'adaptive'
          ? 'Auto'
          : raw[key]
    if (field[1] === 'number') {
      if (
        !Number.isInteger(normalized) ||
        normalized < profile.durationMin ||
        normalized > profile.durationMax
      )
        throw new Error('视频时长参数无效，暂不能预估米值')
    } else if (
      !(
        key === 'ratio' && isSeedance25Model(option) && input.id === 'first-frame'
          ? videoModelControls(option).fields.ratio[1]
          : field[1]
      ).includes(normalized)
    )
      throw new Error(`${field[0]}参数无效，暂不能预估米值`)
  }
  const params = videoModelParams(option, raw, input.mode)
  const seedance = isSeedance25Model(option)
  const anci = isSeedance20AnciModel(option)
  const ratio =
    seedance && input.id === 'first-frame'
      ? 'adaptive'
      : ['Auto', 'adaptive'].includes(params.ratio)
        ? 'adaptive'
        : params.ratio
  return {
    duration: String(params.duration),
    resolution: seedance || anci ? params.resolution.toLowerCase() : params.resolution,
    ...(anci ? { aspect_ratio: ratio, mode: 'cankaosheng', version: params.version } : { ratio }),
    ...(seedance
      ? { web_search: switches['联网搜索'] === true }
      : anci
        ? {}
        : { mode: input.frames || !input.hasMedia ? 'shouweizhen' : 'cankaosheng' }),
  }
}

/** Pricing intent contains no prompt, asset URL, credential or provider host.
 * Invalid or ambiguous input stays local and must not trigger an estimate call. */
export function buildCanvasPricingRequest({
  kind,
  model,
  modelOption,
  modelOptions,
  params = {},
  mode,
  references = [],
  switches = {},
} = {}) {
  try {
    if (!['image', 'video'].includes(kind))
      return { request: null, message: '当前节点无需预估米值' }
    const raw = object(params)
    const toggles = object(switches)
    const reference =
      kind === 'image' ? imageReferenceSummary(references) : referenceSummary(references)
    let option, wire
    if (kind === 'image') {
      option = resolveRoute(model, modelOption, modelOptions)
      wire = imageParams(option, raw, toggles)
      if (reference.imageCount > 14)
        throw new Error('参考图片超过 14 张，生成服务最多提交前 14 张，暂不能完整预估米值')
    } else if (isKling30Model(modelOption || model) || isKlingOmniApiModel(modelOption || model)) {
      const label = klingVideoMode(mode).label
      option = resolveKlingOmniRoute(
        selectionValue(model),
        label,
        modelOptions || (modelOption && typeof modelOption === 'object' ? [modelOption] : []),
      )
      const profile = klingOmniControls(label, raw)
      explicitFields(raw, profile, (key, value) =>
        key === 'duration' && typeof value === 'number' ? String(value) : value,
      )
      wire = klingOmniParams(label, raw)
      const state = klingOmniReferenceState(label, references)
      if (state.errors.length) throw new Error(state.errors.join('；'))
      return {
        request: { kind, model: option.value, apiModel: profile.apiModel, params: wire, reference },
        message: '',
      }
    } else if (isWanxiangModel(modelOption || model)) {
      option = resolveRoute(model, modelOption, modelOptions, isWanxiangModel)
      explicitFields(raw, wanxiangControls(), (key, value) =>
        key === 'duration' && typeof value === 'number'
          ? String(value)
          : ['audio', 'prompt_extend'].includes(key) && ['true', 'false'].includes(value)
            ? value === 'true'
            : value,
      )
      wire = wanxiangParams(raw)
      const state = wanxiangReferenceState(references, wire)
      if (state.error) throw new Error(state.error)
    } else {
      const family = isSeedance25Model(modelOption || model)
        ? isSeedance25Model
        : isSeedance20AnciModel(modelOption || model)
          ? isSeedance20AnciModel
          : isMinimaxH3Model(modelOption || model)
            ? isMinimaxH3Model
            : null
      if (!family) throw new Error('所选视频模型暂不支持预估米值')
      option = resolveRoute(model, modelOption, modelOptions, family)
      wire = nativeVideoParams(option, raw, references, toggles)
    }
    return {
      request: { kind, model: option.value, apiModel: identity(option), params: wire, reference },
      message: '',
    }
  } catch (error) {
    return { request: null, message: error.message || '当前参数暂不能预估米值' }
  }
}

export const canvasPricingInput = buildCanvasPricingRequest

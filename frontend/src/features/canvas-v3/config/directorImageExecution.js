// These are the image node's selectable values, not values inferred by the Agent.
export const DIRECTOR_IMAGE_RATIOS = Object.freeze([
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
])
export const DIRECTOR_IMAGE_RESOLUTIONS = Object.freeze(['1K', '2K', '4K'])
export const DIRECTOR_IMAGE_COUNTS = Object.freeze([1, 2, 4])

export function validateDirectorImageExecution(settings, models = []) {
  if (
    !settings ||
    typeof settings.model !== 'string' ||
    !settings.model ||
    !(Array.isArray(models) ? models : []).some(
      (option) => typeof option?.value === 'string' && option.value === settings.model,
    )
  )
    return '请选择当前项目已配置的生图模型'
  if (!DIRECTOR_IMAGE_RATIOS.includes(settings.ratio)) return '请选择支持的画面比例'
  if (!DIRECTOR_IMAGE_RESOLUTIONS.includes(settings.resolution)) return '请选择支持的分辨率'
  if (!DIRECTOR_IMAGE_COUNTS.includes(settings.count)) return '请选择 1、2 或 4 张图片'
  return ''
}

/** Only a user's explicit settings confirmation may replace the frozen paid intent. */
export function createDirectorImageExecutionIntent(intent, settings, models = []) {
  const error = validateDirectorImageExecution(settings, models)
  if (error) throw new Error(error)
  const option = models.find((model) => model.value === settings.model)
  return Object.freeze({
    ...intent,
    generationType: 'image',
    requestedModels: Object.freeze([
      Object.freeze({
        id: option.value,
        name: String(option.label || option.value),
        modality: 'image',
      }),
    ]),
    nodeModel: option.value,
    ratio: settings.ratio,
    resolution: settings.resolution,
    count: settings.count,
    width: null,
    height: null,
    executionConfirmed: true,
  })
}

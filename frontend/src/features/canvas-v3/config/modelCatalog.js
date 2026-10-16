// Labels, descriptions and estimates observed in the LibTV reference menu.
// These are reference UI options, not aliases for our configured generation APIs.
export const IMAGE_MODEL_CATALOG = [
  ['Lib Image 2.5 Pro', 'modelLib', '30s', '精准生成与编辑，复杂指令稳定还原'],
  ['Lib Image 2.5 Fast', 'modelLib', '20s', '极速高质量图像生成，兼顾效果与效率'],
  ['Lib Image', 'modelLib', '60s', '最新图片模型、长文本能力突出'],
  ['General image Pro', 'modelGeneral', '50s', '最强图片编辑模型，一致性好'],
  ['General image V2.1', 'modelGeneralV21', '25s', '多图参考更一致，文字排版更精准'],
  ['General image V2', 'modelGeneral', '25s', '支持联网搜索、文字准确、速度更快'],
  ['Seedream 5.0 Pro', 'modelSeedream', '20s', '精准交互式编辑，支持原生多语言排版'],
  ['Genesis F.3', 'image', '30s', '角色稳定一致，支持局部与图内文字编辑'],
  ['Qwen image 3.0', 'image', '60s', '擅长复杂版面与精准文字的高质量生图模型'],
  ['Style Image V8.2', 'image', '50s', '电影感全面升级，精准还原光影、人物与真实材质'],
  ['Style Image V8.1', 'image', '50s', '生图更连贯、细节更丰富、美学水准大幅提升'],
  ['Style Image V7', 'image', '50s', '最佳美学，电影质感，创意能力强'],
  ['Style Image Niji 7', 'image', '50s', '动漫高审美模型，风格多样'],
  ['Seedream 4.6', 'modelSeedream', '20s', '提升人像一致性、平面设计效果'],
  ['Seedream 5.0 Lite', 'modelSeedream', '20s', '支持联网搜索，擅长中式风格、审美提升'],
  ['Seedream 4.5', 'modelSeedream', '15s', '多角色一致性、擅长中式风格'],
  ['Z-image Turbo', 'image', '10s', '极速生成，适合真实感图片'],
  ['Qwen Image', 'image', '60s', 'Qwen 生图模型，文字排版能力强'],
  ['Qwen Edit', 'image', '60s', 'Qwen系编辑模型，精细可控'],
  ['Seedream 4.0', 'modelSeedream', '', ''],
].map(([label, icon, latency, description]) => ({
  value: label,
  label,
  icon,
  latency,
  description,
}))

export function modelPresentation(model, kind = 'image') {
  const observed = IMAGE_MODEL_CATALOG.find((entry) => entry.label === model.label)
  const name = `${model.value} ${model.label}`.toLowerCase()
  return {
    icon: observed?.icon || (/seedream/.test(name) ? 'modelSeedream' : kind),
    // Do not invent a latency estimate for models configured in our own backend.
    latency: observed?.latency || '',
    description: observed?.description || model.description || '使用项目已配置的生成服务',
    ...model,
  }
}

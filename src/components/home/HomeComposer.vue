<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useUserStore } from '../../stores/user';
import { apiPath } from '../../utils/apiBase';
import { uploadFileDirect } from '../../utils/ossUpload';

const UPLOAD_ENDPOINT = '/api/file/upload'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'generate'])
const userStore = useUserStore()

const prompt = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const selectedMode = ref('生成详情页')
const open = ref(false)
const modes = ['生成详情页', '生成主图', '竞品复刻', '生成视频', 'AI运营']
const fileInput = ref(null)
const cloneCompetitorInput = ref(null)
const clonePreviewInput = ref(null)
const cloneProductInput = ref(null)
const images = ref([])
const activeImageId = ref('')
const uploadError = ref('')
const uploading = ref(false)
const ratioOpen = ref(false)
const selectedRatio = ref('智能比例')
const ratioOptions = ['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const modelOpen = ref(false)
const selectedModel = ref('gpt image 2')
const modelOptions = ['gpt image 2', 'banana2', 'banana pro']
const qualityOpen = ref(false)
const selectedQuality = ref('2K')
const qualityOptions = ['1K', '2K', '4K']
const cloneResolutionOptions = ['1K', '2K', '4K']
const countOpen = ref(false)
const selectedCount = ref('生成1张')
const countOptions = ['生成1张', '生成2张', '生成3张', '生成4张']
const detailModalOpen = ref(false)
const splitIdeaOpen = ref(false)
const detailDraft = ref({
  productInfo: '',
  method: 'split',
  model: 'gpt image 2',
  ratio: '9:16',
  resolution: '2K',
  platform: '淘宝',
  screens: '3 屏',
  style: '',
  splitPlan: [],
})
const splitPlans = ref([])
const selectedSplitIds = ref([])
const promptGenerating = ref(false)
const promptError = ref('')
const cloneModalOpen = ref(false)
const cloneLoading = ref('')
const cloneError = ref('')
const cloneOptimizingProductInfo = ref(false)
const cloneProductInfoPreview = ref(false)
const cloneExtractRequestId = ref('')
const cloneBridgeReady = ref(false)
const clonePreviewZoom = ref(96)
const clonePreviewMerged = ref(false)
const cloneCutMode = ref(false)
const cloneCutLines = ref([])
const cloneDraggingCutLine = ref(null)
const clonePreviewDragId = ref('')
const clonePreviewDragOverId = ref('')
const clonePreviewActiveImageId = ref('')
const cloneDraft = ref({
  productInfo: '',
  ratio: '9:16',
  resolution: '2K',
  cloneStrength: 'MEDIUM',
  competitorSource: 'upload',
  competitorPageUrl: '',
  keepModel: true,
  competitorImages: [],
  productImages: [],
  sliceContracts: [],
  mappingContracts: [],
})
let cloneExtractTimer = 0
let cloneBridgeTimer = 0
let cloneCutDragContext = null
const splitTemplates = [
  {
    key: 'hero',
    title: '首屏引导',
    goal: '3 秒内说明产品是什么，以及最强购买理由。',
    copy: '一句话利益点 + 产品主视觉 + 关键卖点标签',
    visual: '产品大面积居中展示，背景干净，突出第一眼质感。',
  },
  {
    key: 'pain-point',
    title: '痛点共鸣',
    goal: '把用户正在遇到的问题说清楚，建立继续阅读理由。',
    copy: '使用痛点 + 解决方向 + 情绪化短句',
    visual: '用真实使用场景或对比画面呈现问题。',
  },
  {
    key: 'core-selling',
    title: '核心卖点',
    goal: '集中展示产品最能促成购买的 1 到 3 个优势。',
    copy: '主卖点标题 + 3 条可验证卖点',
    visual: '产品和卖点模块组合，使用图标、局部放大或数据标签。',
  },
  {
    key: 'detail',
    title: '细节材质',
    goal: '证明产品真实、可靠、有质感。',
    copy: '材质、工艺、结构、触感或成分说明',
    visual: '局部特写、剖面、微距纹理、细节标注。',
  },
  {
    key: 'scene',
    title: '使用场景',
    goal: '让用户想象自己拥有产品后的具体体验。',
    copy: '场景利益 + 人群适配 + 使用感受',
    visual: '生活化/商业化场景，产品自然融入环境。',
  },
  {
    key: 'compare',
    title: '对比升级',
    goal: '解释为什么比普通产品更值得买。',
    copy: '普通款 vs 本产品，突出升级点',
    visual: '左右对比、参数对比、前后效果对比。',
  },
  {
    key: 'spec',
    title: '规格参数',
    goal: '降低购买疑虑，说明尺寸、适配、使用限制。',
    copy: '规格表 + 适用范围 + 注意事项',
    visual: '规整参数卡片、尺寸示意、适配场景。',
  },
  {
    key: 'trust',
    title: '信任转化',
    goal: '用保障、口碑、服务承诺推动下单。',
    copy: '售后保障 + 用户评价 + 行动引导',
    visual: '信任背书卡片、服务图标、品牌收尾画面。',
  },
]
const isMainImageMode = computed(() => selectedMode.value === '生成主图')
const isDetailCloneMode = computed(() => selectedMode.value === '竞品复刻')
const cloneWebpageImages = computed(() =>
  cloneDraft.value.competitorImages.filter((image) => image.source === 'webpage'),
)
const primaryModeLabel = computed(() => (isMainImageMode.value ? '生成图片' : selectedMode.value))
const placeholder = computed(() =>
  isMainImageMode.value
    ? '描述你想生成的图片...'
    : isDetailCloneMode.value
      ? '描述产品信息并上传产品图，点击右侧进入竞品复刻...'
      : '描述产品信息（卖点、材质、适用场景等），AI 将优化并生成详情页...',
)
const hasComposerContent = computed(() => prompt.value.trim().length > 0 || images.value.length > 0)

function chooseMode(mode) {
  selectedMode.value = mode
  open.value = false
  ratioOpen.value = false
  modelOpen.value = false
  qualityOpen.value = false
  countOpen.value = false
}

function closeToolMenus(except = '') {
  open.value = except === 'mode' ? open.value : false
  ratioOpen.value = except === 'ratio' ? ratioOpen.value : false
  modelOpen.value = except === 'model' ? modelOpen.value : false
  qualityOpen.value = except === 'quality' ? qualityOpen.value : false
  countOpen.value = except === 'count' ? countOpen.value : false
}

function toggleMenu(menu) {
  const stateMap = {
    mode: open,
    ratio: ratioOpen,
    model: modelOpen,
    quality: qualityOpen,
    count: countOpen,
  }
  const target = stateMap[menu]
  const nextValue = !target.value
  closeToolMenus()
  target.value = nextValue
}

function closeAllMenus() {
  closeToolMenus()
}

onMounted(() => {
  document.addEventListener('click', closeAllMenus)
  window.addEventListener('message', handleTmallExtractMessage)
  pingCloneBridge()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeAllMenus)
  window.removeEventListener('message', handleTmallExtractMessage)
  window.clearTimeout(cloneExtractTimer)
  window.clearTimeout(cloneBridgeTimer)
  stopCloneCutDrag()
})

function chooseRatio(ratio) {
  selectedRatio.value = ratio
  ratioOpen.value = false
}

function chooseModel(model) {
  selectedModel.value = model
  modelOpen.value = false
}

function chooseQuality(quality) {
  selectedQuality.value = quality
  qualityOpen.value = false
}

function chooseCount(count) {
  selectedCount.value = count
  countOpen.value = false
}

function openFilePicker() {
  if (!userStore.requireLogin()) return
  fileInput.value?.click()
}

function submitGenerate() {
  if (!hasComposerContent.value) return
  if (!userStore.requireLogin()) return

  emit('generate', {
    flow: 'main-image',
    prompt: prompt.value,
    mode: selectedMode.value,
    ratio: selectedRatio.value,
    model: selectedModel.value,
    quality: selectedQuality.value,
    count: selectedCount.value,
    images: images.value.map((image) => ({
      id: image.id,
      name: image.name,
      url: image.url,
    })),
  })
}

function openDetailModal() {
  if (!hasComposerContent.value) return
  if (!userStore.requireLogin()) return

  const imageBrief = images.value
    .map((image) => image.name)
    .filter(Boolean)
    .join('、')
  detailDraft.value.productInfo = prompt.value.trim() || imageBrief || '参考图产品'
  detailDraft.value.splitPlan = []
  detailModalOpen.value = true
}

function syncCloneProductImages() {
  const currentImages = images.value
    .filter((image) => image.url && !image.uploading)
    .map((image) => ({
      id: image.id,
      name: image.name,
      url: image.url,
      localUrl: image.localUrl,
      uploading: false,
      source: 'composer',
    }))
  const currentUrls = new Set(currentImages.map((image) => image.url))
  const manualImages = cloneDraft.value.productImages.filter(
    (image) => image.source !== 'composer' && !currentUrls.has(image.url),
  )

  cloneDraft.value.productImages = [...currentImages, ...manualImages]
}

function openCloneModal() {
  if (!userStore.requireLogin()) return
  selectedMode.value = '竞品复刻'
  const imageBrief = images.value
    .map((image) => image.name)
    .filter(Boolean)
    .join('、')
  cloneDraft.value.productInfo =
    prompt.value.trim() || cloneDraft.value.productInfo || imageBrief || ''
  cloneDraft.value.ratio = '9:16'
  syncCloneProductImages()
  cloneError.value = ''
  cloneLoading.value = ''
  cloneModalOpen.value = true
}

function openCloneModalFromShortcut() {
  openCloneModal()
}

defineExpose({ openCloneModalFromShortcut })

function submitDetailGenerate() {
  if (!userStore.requireLogin()) return
  const activePlan =
    detailDraft.value.splitPlan.length === getScreenCount()
      ? detailDraft.value.splitPlan
      : createSplitPlans()
  detailModalOpen.value = false
  emit('generate', {
    flow: 'detail-page',
    prompt: detailDraft.value.productInfo,
    mode: '生成详情页',
    ratio: detailDraft.value.ratio,
    model: detailDraft.value.model,
    quality: detailDraft.value.resolution,
    platform: detailDraft.value.platform,
    screens: detailDraft.value.screens,
    method: detailDraft.value.method,
    style: detailDraft.value.style,
    splitPlan: activePlan,
    images: images.value.map((image) => ({
      id: image.id,
      name: image.name,
      url: image.url,
    })),
  })
}

function getScreenCount() {
  return Number.parseInt(detailDraft.value.screens, 10) || 3
}

function pickTemplates(count) {
  if (count <= 3) {
    return ['hero', 'core-selling', 'trust']
  }
  if (count <= 5) {
    return ['hero', 'pain-point', 'core-selling', 'detail', 'trust']
  }
  return ['hero', 'pain-point', 'core-selling', 'detail', 'scene', 'compare', 'spec', 'trust']
}

function inferProductFocus(productInfo) {
  const text = productInfo.toLowerCase()
  if (/床|枕|家居|沙发|桌|椅|柜|垫/.test(text)) {
    return {
      category: '家居生活',
      audience: '注重舒适度、质感和耐用性的家庭用户',
      scene: '温暖、干净、有生活感的室内空间',
      proof: '材质、结构、尺寸、承托或耐用性',
    }
  }
  if (/食品|饮|茶|咖啡|零食|坚果|果|粮|奶/.test(text)) {
    return {
      category: '食品饮品',
      audience: '关注口感、原料和健康感的消费人群',
      scene: '明亮餐桌、原料飞溅、自然光美食场景',
      proof: '原料、口感、产地、配料和安全感',
    }
  }
  if (/护肤|美妆|面膜|精华|口红|洗护|香/.test(text)) {
    return {
      category: '美妆个护',
      audience: '关注功效、成分和肤感的人群',
      scene: '干净高级的浴室、梳妆台或棚拍场景',
      proof: '成分、功效、肤感、使用前后和安全背书',
    }
  }
  if (/衣|裤|鞋|包|穿|服装|模特/.test(text)) {
    return {
      category: '服饰配件',
      audience: '关注版型、面料和上身效果的用户',
      scene: '模特上身、街拍、棚拍或生活穿搭场景',
      proof: '版型、面料、细节、尺码和搭配效果',
    }
  }
  if (/手机|电脑|耳机|灯|电器|数码|充电|智能/.test(text)) {
    return {
      category: '数码电器',
      audience: '关注功能、参数和效率提升的用户',
      scene: '科技感桌面、办公、居家或户外使用场景',
      proof: '核心功能、参数、兼容性、效率和质保',
    }
  }
  return {
    category: '通用商品',
    audience: '关注产品价值、使用体验和购买安全感的用户',
    scene: '干净真实的产品使用场景',
    proof: '核心卖点、细节、场景、参数和服务保障',
  }
}

function buildImagePrompt(template, productInfo, focus) {
  const style = detailDraft.value.style.trim() || '高端、干净、真实、有电商转化感'
  const textInstruction = `主标题表达“${template.copy}”，文案应短、清晰、适合电商详情页，不要堆满文字`
  const layoutInstruction = `版式：${template.visual}；保留清晰标题区、产品展示区、卖点说明区，层级从上到下阅读顺畅`
  const positivePrompt = [
    `${detailDraft.value.platform}电商详情页分屏设计，第${template.index}屏，${detailDraft.value.ratio}竖版构图`,
    `产品：${productInfo}`,
    `页面主题：${template.title}`,
    `页面目标：${template.goal}`,
    `目标用户：${focus.audience}`,
    `视觉场景：${focus.scene}`,
    `证明重点：${focus.proof}`,
    layoutInstruction,
    textInstruction,
    `整体风格：${style}`,
    '画面要求：商业摄影质感，产品主体准确，细节清晰，背景干净，光影自然，适合淘宝/天猫详情页，高清，高完成度',
  ].join('。')
  const negativePrompt = [
    '不要乱码文字',
    '不要错误中文',
    '不要多余品牌 logo',
    '不要产品变形',
    '不要多主体混乱',
    '不要低清晰度',
    '不要脏乱背景',
    '不要过度炫光',
    '不要遮挡产品核心结构',
    '不要欧美海报式大段英文排版',
  ].join('，')

  return {
    positive: positivePrompt,
    negative: negativePrompt,
    layout: layoutInstruction,
    text: textInstruction,
    modelInput: `${positivePrompt}\n\n负向提示词：${negativePrompt}`,
  }
}

function createSplitPlans() {
  const count = getScreenCount()
  const productInfo = detailDraft.value.productInfo.trim() || prompt.value.trim() || '产品'
  const focus = inferProductFocus(productInfo)
  const keys = pickTemplates(count)

  return keys.map((key, index) => {
    const base = splitTemplates.find((template) => template.key === key) || splitTemplates[0]
    const template = {
      ...base,
      index: index + 1,
    }

    return {
      id: `${template.key}-${index + 1}`,
      index: index + 1,
      title: template.title,
      goal: template.goal,
      copy: template.copy,
      visual: template.visual,
      category: focus.category,
      proof: focus.proof,
      prompts: buildImagePrompt(template, productInfo, focus),
    }
  })
}

async function openSplitIdea() {
  if (!userStore.requireLogin()) return
  const plans = createSplitPlans()
  splitPlans.value = plans
  selectedSplitIds.value = splitPlans.value.map((item) => item.id)
  splitIdeaOpen.value = true
  promptError.value = ''
  promptGenerating.value = true

  try {
    const response = await fetch(apiPath('/api/detail-page/prompts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productInfo: detailDraft.value.productInfo,
        platform: detailDraft.value.platform,
        ratio: detailDraft.value.ratio,
        model: detailDraft.value.model,
        style: detailDraft.value.style,
        screens: detailDraft.value.screens,
        plans: plans.map(({ prompts, ...plan }) => plan),
      }),
    })
    const result = await response.json()
    if (!response.ok || result.code !== 0) {
      throw new Error(result.message || '提示词生成失败')
    }

    const promptMap = new Map((result.data?.prompts || []).map((item) => [item.id, item]))
    splitPlans.value = splitPlans.value.map((plan) => ({
      ...plan,
      prompts: promptMap.get(plan.id) || plan.prompts,
      promptProvider: result.data?.provider || 'fallback',
    }))
  } catch (error) {
    promptError.value = error instanceof Error ? error.message : '提示词生成失败，已保留本地提示词'
  } finally {
    promptGenerating.value = false
  }
}

function toggleSplitPlan(planId) {
  if (selectedSplitIds.value.includes(planId)) {
    selectedSplitIds.value = selectedSplitIds.value.filter((id) => id !== planId)
    return
  }
  selectedSplitIds.value = [...selectedSplitIds.value, planId]
}

function applySplitIdea() {
  const selectedPlans = splitPlans.value.filter((item) => selectedSplitIds.value.includes(item.id))
  if (!selectedPlans.length) return

  detailDraft.value.splitPlan = selectedPlans.map((item, index) => ({
    ...item,
    index: index + 1,
  }))
  detailDraft.value.screens = `${selectedPlans.length} 屏`
  splitIdeaOpen.value = false
}

function findUploadedUrl(payload) {
  if (!payload || typeof payload !== 'object') return ''

  const directKeys = ['url', 'fileUrl', 'filePath', 'path', 'src', 'link']
  for (const key of directKeys) {
    if (typeof payload[key] === 'string' && /^https?:\/\//i.test(payload[key])) {
      return payload[key]
    }
  }

  for (const value of Object.values(payload)) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      return value
    }
    const nested = findUploadedUrl(value)
    if (nested) return nested
  }

  return ''
}

function removeImage(imageId) {
  const image = images.value.find((item) => item.id === imageId)
  if (image?.localUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(image.localUrl)
  }
  images.value = images.value.filter((item) => item.id !== imageId)
  activeImageId.value = images.value.at(-1)?.id || ''
}

async function uploadRemoteFile(file) {
  // 优先使用 OSS 直传，失败则 fallback 到 Java 后端中转
  try {
    return await uploadFileDirect(file, { dir: 'youmi-home/uploads' });
  } catch (ossError) {
    console.warn('[upload] OSS 直传失败，fallback 到 Java 后端中转:', ossError.message);
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`上传失败：${response.status}`);
    }
    const result = await response.json().catch(() => ({}));
    const remoteUrl = findUploadedUrl(result);
    if (!remoteUrl) {
      throw new Error('上传成功，但没有返回图片地址');
    }
    return remoteUrl;
  }
}

async function uploadFile(file) {
  const localUrl = URL.createObjectURL(file)
  const image = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    localUrl,
    url: localUrl,
    uploading: true,
  }

  images.value.push(image)
  activeImageId.value = image.id

  image.url = await uploadRemoteFile(file)
  image.uploading = false
}

async function handleFileChange(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length) return

  uploadError.value = ''
  uploading.value = true

  try {
    for (const file of files) {
      await uploadFile(file)
    }
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : '上传失败'
  } finally {
    uploading.value = false
    event.target.value = ''
  }
}

function cloneImages(type) {
  return type === 'competitor' ? cloneDraft.value.competitorImages : cloneDraft.value.productImages
}

function setCloneImages(type, nextImages) {
  if (type === 'competitor') cloneDraft.value.competitorImages = nextImages
  else cloneDraft.value.productImages = nextImages
}

function setCloneCompetitorSource(source) {
  cloneDraft.value.competitorSource = source
  cloneError.value = ''
}

function openCloneCompetitorPicker() {
  cloneCompetitorInput.value?.click()
}

function openClonePreviewPicker() {
  clonePreviewInput.value?.click()
}

function openCloneProductPicker() {
  cloneProductInput.value?.click()
}

function parseCompetitorProductId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{5,}$/.test(raw)) return raw

  const decodedValues = new Set([raw])
  try {
    decodedValues.add(decodeURIComponent(raw))
  } catch {
    // Keep the original value when decoding fails.
  }

  for (const item of decodedValues) {
    try {
      const withScheme = /^https?:\/\//i.test(item) ? item : `https://${item}`
      const url = new URL(withScheme)
      const id = url.searchParams.get('id') || url.searchParams.get('itemId')
      if (id && /^\d+$/.test(id)) return id
    } catch {
      // Fall back to regex extraction below.
    }

    const match =
      item.match(/(?:[?&#]|^)(?:id|itemId)=?(\d{5,})\b/i) || item.match(/\bid[=:](\d{5,})\b/i)
    if (match) return match[1]
  }

  return ''
}

function tmallDetailUrl(productId) {
  return `https://detail.tmall.com/item.htm?b_s_f=sycm&id=${productId}`
}

function normalizeCompetitorPageTarget(value) {
  const raw = String(value || '').trim()
  if (!raw) return { url: '', productId: '' }
  const productId = parseCompetitorProductId(raw)
  if (productId) return { url: tmallDetailUrl(productId), productId }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    return ['http:', 'https:'].includes(url.protocol) && url.hostname
      ? { url: url.href, productId: '' }
      : { url: '', productId: '' }
  } catch {
    return { url: '', productId: '' }
  }
}

function competitorImageName(url, index) {
  try {
    const pathname = new URL(url).pathname
    const filename = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '')
    return filename || `网页提取图片 ${index + 1}`
  } catch {
    return `网页提取图片 ${index + 1}`
  }
}

function openCompetitorPageTab(url, keepOpener = false) {
  const features = keepOpener ? '' : 'noopener,noreferrer'
  const opened = window.open(url, '_blank', features)
  if (opened) return true

  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  if (!keepOpener) link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  return true
}

function pingCloneBridge() {
  cloneBridgeReady.value = false
  window.clearTimeout(cloneBridgeTimer)
  window.postMessage({ type: 'youmi:extension-bridge-ping' }, window.location.origin)
  cloneBridgeTimer = window.setTimeout(() => {
    cloneBridgeReady.value = false
  }, 1200)
}

function buildTmallExtractorUrl(pageUrl, requestId) {
  const url = new URL(pageUrl)
  const hash = new URLSearchParams()
  hash.set('youmiExtractDescV8', '1')
  hash.set('requestId', requestId)
  hash.set('returnOrigin', window.location.origin)
  url.hash = hash.toString()
  return url.href
}

function applyCompetitorImageUrls(imageUrls, imageSource, productId = '', pageUrl = '') {
  const uniqueUrls = Array.from(new Set(imageUrls || [])).filter(Boolean)
  const manualImages = cloneImages('competitor').filter((image) => image.source !== imageSource)
  const manualUrls = new Set(manualImages.map((image) => image.url))
  const extractedImages = uniqueUrls
    .filter((url) => !manualUrls.has(url))
    .map((url, index) => ({
      id: `competitor-${imageSource}-${Date.now()}-${index}`,
      name: competitorImageName(url, index),
      url,
      localUrl: url,
      uploading: false,
      error: '',
      source: imageSource,
      productId,
      pageUrl,
    }))

  setCloneImages('competitor', [...manualImages, ...extractedImages])
  cloneDraft.value.sliceContracts = []
  cloneDraft.value.mappingContracts = []
  clonePreviewMerged.value = false
  cloneCutMode.value = false
  cloneCutLines.value = []
  clonePreviewZoom.value = 96
  return extractedImages.length
}

function handleTmallExtractMessage(event) {
  if (![window.location.origin, 'https://detail.tmall.com'].includes(event.origin)) return
  const data = event.data || {}
  if (data.type === 'youmi:extension-bridge-ready') {
    cloneBridgeReady.value = true
    window.clearTimeout(cloneBridgeTimer)
    return
  }
  if (data.type !== 'youmi:tmall-descv8-images') return
  if (!data.requestId || data.requestId !== cloneExtractRequestId.value) return

  window.clearTimeout(cloneExtractTimer)
  const imageUrls = Array.from(new Set(data.imageUrls || []))
  if (!imageUrls.length) {
    cloneError.value = data.foundContainer
      ? '详情页已打开，但 descV8-container 下没有提取到图片'
      : '详情页已打开，但没有找到 descV8-container'
    cloneLoading.value = ''
    return
  }

  const productId = parseCompetitorProductId(data.pageUrl || cloneDraft.value.competitorPageUrl)
  applyCompetitorImageUrls(
    imageUrls,
    'webpage',
    productId,
    data.pageUrl || cloneDraft.value.competitorPageUrl,
  )
  cloneDraft.value.competitorPageUrl = data.pageUrl || cloneDraft.value.competitorPageUrl
  cloneError.value = ''
  cloneLoading.value = ''
}

function mergeClonePreview() {
  if (!cloneWebpageImages.value.length) return
  clonePreviewMerged.value = true
  cloneCutMode.value = false
  cloneCutLines.value = []
  clonePreviewZoom.value = 96
}

function restoreClonePreview() {
  clonePreviewMerged.value = false
  cloneCutMode.value = false
  cloneCutLines.value = []
  clonePreviewZoom.value = 96
}

function toggleCloneCutMode() {
  if (!clonePreviewMerged.value) return
  cloneCutMode.value = !cloneCutMode.value
}

function addCloneCutLine(event) {
  if (!clonePreviewMerged.value || !cloneCutMode.value) return
  const target = event.currentTarget
  const rect = target.getBoundingClientRect()
  const y = event.clientY - rect.top + target.scrollTop
  const percent = Math.max(2, Math.min(98, Math.round((y / target.scrollHeight) * 1000) / 10))
  if (cloneCutLines.value.some((line) => Math.abs(line - percent) < 1)) return
  cloneCutLines.value = [...cloneCutLines.value, percent].sort((a, b) => a - b)
}

function percentFromCutPointer(event, canvas) {
  const rect = canvas.getBoundingClientRect()
  const y = event.clientY - rect.top
  return Math.max(2, Math.min(98, Math.round((y / rect.height) * 1000) / 10))
}

function moveCloneCutLine(fromLine, toLine) {
  cloneCutLines.value = cloneCutLines.value
    .map((line) => (line === fromLine ? toLine : line))
    .sort((a, b) => a - b)
}

function removeCloneCutLine(targetLine) {
  cloneCutLines.value = cloneCutLines.value.filter((line) => line !== targetLine)
}

function handleCloneCutDrag(event) {
  if (!cloneCutDragContext?.canvas) return
  const nextLine = percentFromCutPointer(event, cloneCutDragContext.canvas)
  moveCloneCutLine(cloneCutDragContext.line, nextLine)
  cloneCutDragContext.line = nextLine
  cloneDraggingCutLine.value = nextLine
}

function stopCloneCutDrag() {
  document.removeEventListener('pointermove', handleCloneCutDrag)
  document.removeEventListener('pointerup', stopCloneCutDrag)
  cloneCutDragContext = null
  cloneDraggingCutLine.value = null
}

function startCloneCutDrag(line, event) {
  const canvas = event.currentTarget.closest('.yh-copycat-merged-canvas')
  if (!canvas) return
  cloneCutDragContext = { line, canvas }
  cloneDraggingCutLine.value = line
  document.addEventListener('pointermove', handleCloneCutDrag)
  document.addEventListener('pointerup', stopCloneCutDrag, { once: true })
}

async function executeCloneCut() {
  if (!cloneCutLines.value.length) return
  const sourceImages = cloneWebpageImages.value.map((image) => image.url).filter(Boolean)
  if (!sourceImages.length) return

  cloneError.value = ''
  cloneLoading.value = 'cut-competitor'
  try {
    const data = await readCloneApiResponse(
      await fetch(apiPath('/api/detail-clone/cut-images'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...userStore.authHeaders(),
        },
        body: JSON.stringify({
          imageUrls: sourceImages,
          cutLines: cloneCutLines.value,
        }),
      }),
    )

    const cutUrls = Array.from(new Set(data?.imageUrls || []))
    if (!cutUrls.length) throw new Error('裁切完成但没有返回图片地址')
    const productId = parseCompetitorProductId(cloneDraft.value.competitorPageUrl)
    applyCompetitorImageUrls(cutUrls, 'webpage', productId, cloneDraft.value.competitorPageUrl)
    clonePreviewMerged.value = false
    cloneCutMode.value = false
    cloneCutLines.value = []
    cloneError.value = ''
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '裁切失败'
  } finally {
    cloneLoading.value = ''
  }
}

async function extractCompetitorImages() {
  const target = normalizeCompetitorPageTarget(cloneDraft.value.competitorPageUrl)
  const pageUrl = target.url
  if (!pageUrl) {
    cloneError.value = '请输入有效的商品ID或竞品网页链接'
    return
  }

  cloneDraft.value.competitorPageUrl = pageUrl
  if (target.productId) {
    if (!cloneBridgeReady.value) {
      pingCloneBridge()
      cloneError.value =
        '未检测到本地扩展桥，请在浏览器扩展页重新加载 Youmi Site Structure Recorder 后刷新本页'
      return
    }

    cloneError.value = ''
    cloneLoading.value = 'extract-competitor'
    const requestId = `tmall-${target.productId}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    cloneExtractRequestId.value = requestId
    const opened = openCompetitorPageTab(buildTmallExtractorUrl(pageUrl, requestId), true)
    if (!opened) {
      cloneLoading.value = ''
      cloneError.value = '浏览器阻止了新标签页，请允许弹窗后再点击提取'
      return
    }
    window.clearTimeout(cloneExtractTimer)
    cloneExtractTimer = window.setTimeout(() => {
      if (cloneExtractRequestId.value !== requestId || cloneLoading.value !== 'extract-competitor')
        return
      cloneLoading.value = ''
      cloneError.value =
        '已打开天猫详情页，但没有收到图片结果。请确认扩展已重新加载，并且天猫标签页地址带有 youmiExtractDescV8 参数。'
    }, 45000)
    return
  }

  cloneError.value = ''
  cloneLoading.value = 'extract-competitor'
  try {
    const data = await readCloneApiResponse(
      await fetch(apiPath('/api/detail-clone/extract-images'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...userStore.authHeaders(),
        },
        body: JSON.stringify({ url: pageUrl }),
      }),
    )
    const imageUrls = Array.from(new Set(data?.imageUrls || []))
    if (!imageUrls.length) {
      cloneError.value = '未从该网页提取到图片，请换链接或直接上传竞品图'
      return
    }

    applyCompetitorImageUrls(imageUrls, 'webpage', target.productId, pageUrl)
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '网页提取失败'
  } finally {
    cloneLoading.value = ''
  }
}

function removeCloneImage(type, imageId) {
  const image = cloneImages(type).find((item) => item.id === imageId)
  if (image?.localUrl?.startsWith('blob:') && image.source !== 'composer') {
    URL.revokeObjectURL(image.localUrl)
  }
  setCloneImages(
    type,
    cloneImages(type).filter((item) => item.id !== imageId),
  )
}

function removeClonePreviewImage(imageId) {
  removeCloneImage('competitor', imageId)
  if (clonePreviewActiveImageId.value === imageId) {
    clonePreviewActiveImageId.value = ''
  }
  cloneDraft.value.sliceContracts = []
  cloneDraft.value.mappingContracts = []
  if (!cloneWebpageImages.value.length) {
    restoreClonePreview()
  }
}

function startClonePreviewDrag(imageId, event) {
  if (clonePreviewMerged.value) return
  clonePreviewDragId.value = imageId
  clonePreviewActiveImageId.value = imageId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', imageId)
}

function enterClonePreviewDrag(targetId, event) {
  if (!clonePreviewDragId.value || clonePreviewDragId.value === targetId) return
  clonePreviewDragOverId.value = targetId
  event.dataTransfer.dropEffect = 'move'
}

function leaveClonePreviewDrag(targetId, event) {
  const nextTarget = event.relatedTarget
  if (event.currentTarget.contains(nextTarget)) return
  if (clonePreviewDragOverId.value === targetId) {
    clonePreviewDragOverId.value = ''
  }
}

function endClonePreviewDrag() {
  clonePreviewDragId.value = ''
  clonePreviewDragOverId.value = ''
}

function dropClonePreviewImage(targetId) {
  const sourceId = clonePreviewDragId.value
  if (!sourceId || sourceId === targetId) {
    endClonePreviewDrag()
    return
  }

  const webpageImages = cloneWebpageImages.value.slice()
  const fromIndex = webpageImages.findIndex((image) => image.id === sourceId)
  const toIndex = webpageImages.findIndex((image) => image.id === targetId)
  if (fromIndex < 0 || toIndex < 0) {
    endClonePreviewDrag()
    return
  }

  const [moved] = webpageImages.splice(fromIndex, 1)
  const insertIndex = fromIndex < toIndex ? toIndex : toIndex
  webpageImages.splice(insertIndex, 0, moved)
  const reorderedWebpageIds = new Set(webpageImages.map((image) => image.id))
  const otherImages = cloneDraft.value.competitorImages.filter(
    (image) => !reorderedWebpageIds.has(image.id),
  )
  setCloneImages('competitor', [...otherImages, ...webpageImages])
  cloneDraft.value.sliceContracts = []
  cloneDraft.value.mappingContracts = []
  endClonePreviewDrag()
}

async function uploadCloneImage(file, type) {
  const localUrl = URL.createObjectURL(file)
  const image = {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    localUrl,
    url: localUrl,
    uploading: true,
    error: '',
    source: 'modal',
  }
  setCloneImages(type, [...cloneImages(type), image])

  try {
    image.url = await uploadRemoteFile(file)
    image.uploading = false
  } catch (error) {
    image.uploading = false
    image.error = error instanceof Error ? error.message : '上传失败'
    throw error
  }
}

async function uploadClonePreviewImage(file) {
  const localUrl = URL.createObjectURL(file)
  const image = {
    id: `competitor-webpage-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    localUrl,
    url: localUrl,
    uploading: true,
    error: '',
    source: 'webpage',
    productId: parseCompetitorProductId(cloneDraft.value.competitorPageUrl),
    pageUrl: cloneDraft.value.competitorPageUrl,
  }
  setCloneImages('competitor', [...cloneImages('competitor'), image])

  try {
    image.url = await uploadRemoteFile(file)
    image.uploading = false
  } catch (error) {
    image.uploading = false
    image.error = error instanceof Error ? error.message : '上传失败'
    throw error
  }
}

async function handleCloneFiles(event, type) {
  const files = Array.from(event.target.files || [])
  if (!files.length) return
  cloneError.value = ''
  cloneLoading.value = type === 'competitor' ? 'upload-competitor' : 'upload-product'
  try {
    for (const file of files) {
      await uploadCloneImage(file, type)
    }
    if (type === 'competitor') {
      cloneDraft.value.sliceContracts = []
      cloneDraft.value.mappingContracts = []
    }
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '上传失败'
  } finally {
    cloneLoading.value = ''
    event.target.value = ''
  }
}

async function handleClonePreviewFiles(event) {
  const files = Array.from(event.target.files || [])
  if (!files.length) return
  cloneError.value = ''
  cloneLoading.value = 'upload-competitor'
  try {
    for (const file of files) {
      await uploadClonePreviewImage(file)
    }
    cloneDraft.value.sliceContracts = []
    cloneDraft.value.mappingContracts = []
    clonePreviewMerged.value = false
    cloneCutMode.value = false
    cloneCutLines.value = []
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '上传失败'
  } finally {
    cloneLoading.value = ''
    event.target.value = ''
  }
}

function cloneImageUrls(type) {
  return cloneImages(type)
    .filter((image) => image.url && !image.uploading && !image.error)
    .map((image) => image.url)
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderProductInfoMarkdown(markdown) {
  const source = String(markdown || '').trim()
  if (!source) return '<p class="empty">优化后的 Markdown 产品信息会显示在这里</p>'

  const lines = source.split(/\r?\n/)
  let html = ''
  let listOpen = false
  const closeList = () => {
    if (listOpen) {
      html += '</ol>'
      listOpen = false
    }
  }
  const inline = (text) => escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      closeList()
      html += `<h4>${inline(heading[1])}</h4>`
      continue
    }
    const ordered = line.match(/^\d+[.、]\s*(.+)$/)
    if (ordered) {
      if (!listOpen) {
        html += '<ol>'
        listOpen = true
      }
      html += `<li>${inline(ordered[1])}</li>`
      continue
    }
    const unordered = line.match(/^[-*]\s+(.+)$/)
    if (unordered) {
      if (!listOpen) {
        html += '<ol>'
        listOpen = true
      }
      html += `<li>${inline(unordered[1])}</li>`
      continue
    }
    closeList()
    html += `<p>${inline(line)}</p>`
  }
  closeList()
  return html
}

async function optimizeCloneProductInfo() {
  const productImages = cloneImageUrls('product')
  if (!productImages.length) {
    cloneError.value = '请先上传产品图片，再优化产品信息'
    return
  }

  cloneError.value = ''
  cloneOptimizingProductInfo.value = true
  try {
    const data = await readCloneApiResponse(
      await fetch(apiPath('/api/ai/optimize-product-info'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...userStore.authHeaders(),
        },
        body: JSON.stringify({
          productInfo: cloneDraft.value.productInfo,
          productImages,
        }),
      }),
    )
    const optimized = String(data?.productInfo || '').trim()
    if (!optimized) throw new Error('模型没有返回可用的产品信息')
    cloneDraft.value.productInfo = optimized
    cloneProductInfoPreview.value = true
    cloneDraft.value.mappingContracts = []
  } catch (error) {
    cloneError.value = error instanceof Error ? error.message : '优化产品信息失败'
  } finally {
    cloneOptimizingProductInfo.value = false
  }
}

async function readCloneApiResponse(response) {
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `接口请求失败：${response.status}`)
  }
  return result.data
}

function slotText(slots, key) {
  const value = slots?.[key]
  if (Array.isArray(value)) return value.join('、')
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean).join('、')
  return value ? String(value) : ''
}

function textList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join('、') : String(value || '')
}

function fallbackCloneRole(pageNo) {
  return (
    [
      '首屏：核心利益点和产品第一印象',
      '痛点/场景：说明用户为什么需要它',
      '核心卖点：集中展示 1 到 3 个高转化优势',
      '材质/结构：用细节证明产品真实可靠',
      '使用场景：展示人群、空间或用途',
      '规格/参数：辅助购买决策',
      '品质/工艺：建立信任和安心感',
      '收尾转化：强化选择理由',
    ][pageNo - 1] || `第 ${pageNo} 屏：延续竞品该屏的信息职责`
  )
}

function cloneStrengthText() {
  if (cloneDraft.value.cloneStrength === 'LIGHT')
    return '轻度：只借鉴信息顺序、模块类型和页面职责，视觉重新设计。'
  if (cloneDraft.value.cloneStrength === 'HIGH')
    return '高度：贴近参考屏构图、模块组织、色彩层级和视觉语言，但全部替换产品与事实内容。'
  return '中度：借鉴参考屏布局结构、视觉节奏和模块类型，再按当前产品重写。'
}

function cloneGlobalStandard(competitorCount) {
  return [
    '【竞品详情页复刻 - 全局标准】',
    `复刻强度：${cloneStrengthText()}`,
    `有效竞品详情图：${competitorCount} 张，输出 ${competitorCount} 屏，每张竞品图只对应一屏。`,
    '参考图 1 是当前产品白底图，是产品外观、材质和主体造型的唯一来源。',
    '参考图 2 是当前竞品单屏详情图，只用于借鉴布局骨架、信息顺序、视觉节奏和构图关系。',
    '不要重新切屏，不要把多张长图压缩到一张画面，不要复制竞品品牌、Logo、证书、排名、价格、销量、医疗功效、未验证证明或平台水印。',
    '使用简体中文电商文案，文字清晰可读，输出一张完整 9:16 电商详情页单屏。',
  ].join('\n')
}

function mappingPromptFields(mapping = {}, index = 0) {
  const sliceIndex = Number(mapping.sliceIndex || index + 1)
  return {
    theme: mapping.theme || fallbackCloneRole(sliceIndex),
    designIdea:
      mapping.designIdea ||
      `用当前产品真实信息承接竞品第 ${sliceIndex} 屏的信息职责，保留参考屏的模块组织和阅读节奏。`,
    visualScene:
      mapping.visualScene ||
      '参考竞品图只借鉴版式骨架、视觉层级、卡片关系、留白比例和构图节奏；产品外观必须以产品白底图为准。',
    copyContent:
      mapping.copyContent ||
      `围绕当前产品信息重写本屏标题、卖点和说明，不照抄竞品文案。产品信息：${cloneDraft.value.productInfo || '参考产品图判断外观与品类'}`,
  }
}

function composeGenerationHint(mapping = {}, index = 0) {
  const sliceIndex = Number(mapping.sliceIndex || index + 1)
  const fields = mappingPromptFields(mapping, index)
  const competitorUrl =
    cloneImageUrls('competitor')[sliceIndex - 1] || cloneImageUrls('competitor')[0] || ''
  return [
    cloneGlobalStandard(cloneImageUrls('competitor').length),
    '',
    `【竞品详情页复刻 - 第 ${sliceIndex} 屏】`,
    `页面职责：${fields.theme}`,
    `竞品参考图 URL：${competitorUrl || '缺失'}`,
    `设计思路：${fields.designIdea}`,
    `视觉画面：${fields.visualScene}`,
    `文案内容：${fields.copyContent}`,
    `当前产品信息：${cloneDraft.value.productInfo || '参考图产品'}`,
    `模特保持一致：${cloneDraft.value.keepModel ? '开启，需要保持产品图/已有参考中的人物风格一致' : '关闭，可根据该屏需要重新组织场景'}`,
    '生成要求：替换为参考图 1 的当前产品；参考图 2 仅作本屏布局与视觉结构参考；输出一张完整 9:16 电商详情页单屏。',
  ].join('\n')
}

function clonePromptForMapping(mapping, index) {
  return mapping.generationHint || composeGenerationHint(mapping, index)
}

function buildClonePlan(mapping, index) {
  const sliceIndex = Number(mapping.sliceIndex || index + 1)
  const fields = mappingPromptFields(mapping, index)
  const headline = fields.theme || `复刻分屏 ${sliceIndex}`
  const competitorUrl =
    cloneImageUrls('competitor')[sliceIndex - 1] || cloneImageUrls('competitor')[0] || ''
  const productUrls = cloneImageUrls('product')
  const [primaryProductUrl, ...extraProductUrls] = productUrls
  const imageUrls = [primaryProductUrl, competitorUrl, ...extraProductUrls].filter(Boolean)
  const positivePrompt = clonePromptForMapping(mapping, index)

  return {
    id: `clone-${sliceIndex}`,
    index: sliceIndex,
    title: headline,
    goal: fields.designIdea,
    copy: fields.copyContent,
    visual: fields.visualScene,
    category: '竞品复刻',
    proof: '参考图 1 为产品外观来源，参考图 2 为该屏版式来源',
    imageUrls,
    prompts: {
      positive: positivePrompt,
      negative:
        textList(mapping.forbidden) ||
        '竞品品牌、Logo、虚假证书、未验证排名、价格标签、销量数据、平台水印、乱码文字、虚假功效',
      layout: fields.visualScene,
      text: fields.copyContent,
      modelInput: positivePrompt,
    },
  }
}

function mappingBySliceIndex(mappings) {
  const map = new Map()
  for (const item of mappings || []) {
    const index = Number(item?.sliceIndex || 0)
    if (index > 0 && !map.has(index)) map.set(index, item)
  }
  return map
}

function createFallbackMapping(sliceIndex, sliceContract = {}) {
  const fields = mappingPromptFields(
    {
      sliceIndex,
      theme: sliceContract.role || fallbackCloneRole(sliceIndex),
    },
    sliceIndex - 1,
  )
  return {
    sliceIndex,
    aRole: `竞品第 ${sliceIndex} 屏`,
    newProductRole: `产品第 ${sliceIndex} 屏复刻`,
    ...fields,
    keepFromA: ['版式骨架', '视觉节奏', '信息顺序', '构图关系'],
    replaceWithProduct: ['产品真实外观', '产品信息', '产品卖点'],
    variableSlots: {},
    forbidden: ['竞品品牌', '虚假证书', '未验证排名', '价格标签', '乱码文字', '虚假功效'],
    generationHint: '',
  }
}

function normalizeCloneMappings(mappings) {
  const competitorImages = cloneImageUrls('competitor')
  const byIndex = mappingBySliceIndex(mappings)
  const sliceByIndex = new Map(
    (cloneDraft.value.sliceContracts || []).map((item) => [Number(item.index || 0), item]),
  )
  return competitorImages.map((_, index) => {
    const sliceIndex = index + 1
    const existing =
      byIndex.get(sliceIndex) || createFallbackMapping(sliceIndex, sliceByIndex.get(sliceIndex))
    const fields = mappingPromptFields(existing, index)
    return {
      ...existing,
      sliceIndex,
      ...fields,
      generationHint:
        existing.generationHint || composeGenerationHint({ ...existing, ...fields }, index),
    }
  })
}

function refreshCloneMappingHint(mapping, index) {
  mapping.generationHint = composeGenerationHint(mapping, index)
}

async function prepareClonePrompts() {
  const competitorImages = cloneImageUrls('competitor')
  if (!competitorImages.length) {
    cloneError.value = '请先上传或提取竞品详情图'
    return false
  }
  if (!cloneDraft.value.productInfo.trim() && !cloneImageUrls('product').length) {
    cloneError.value = '请填写产品信息或上传产品白底图'
    return false
  }

  cloneError.value = ''
  cloneLoading.value = 'prompt'
  try {
    cloneDraft.value.mappingContracts = normalizeCloneMappings(cloneDraft.value.mappingContracts)
    return cloneDraft.value.mappingContracts.length > 0
  } finally {
    cloneLoading.value = ''
  }
}

async function submitCloneGenerate() {
  if (!userStore.requireLogin()) return
  const competitorImagesForPlan = cloneImageUrls('competitor')
  if (!competitorImagesForPlan.length) {
    cloneError.value = '请先上传或提取竞品详情图'
    return
  }
  if (!cloneDraft.value.productInfo.trim() && !cloneImageUrls('product').length) {
    cloneError.value = '请填写产品信息或上传产品白底图'
    return
  }

  cloneError.value = ''
  const mappings = normalizeCloneMappings(cloneDraft.value.mappingContracts)
  const splitPlan = mappings.map(buildClonePlan)

  const validCloneImage = (image) => image.url && !image.uploading && !image.error
  const productImages = cloneImages('product')
    .filter(validCloneImage)
    .map((image) => ({
      id: image.id,
      name: image.name,
      url: image.url,
    }))
  const competitorImages = cloneImages('competitor')
    .filter(validCloneImage)
    .map((image) => ({
      id: image.id,
      name: image.name,
      url: image.url,
    }))

  cloneModalOpen.value = false
  emit('generate', {
    flow: 'detail-clone',
    prompt: cloneDraft.value.productInfo || prompt.value || '参考图产品',
    mode: '竞品复刻',
    ratio: '9:16',
    quality: cloneDraft.value.resolution,
    screens: `${splitPlan.length} 屏`,
    method: 'split',
    cloneStrength: cloneDraft.value.cloneStrength,
    competitorSource: cloneDraft.value.competitorSource,
    competitorPageUrl: cloneDraft.value.competitorPageUrl,
    keepModel: cloneDraft.value.keepModel,
    splitPlan,
    images: [...productImages, ...competitorImages],
    competitorImages,
  })
}
</script>

<template>
  <section
    :class="['yh-composer', { 'is-main-image': isMainImageMode }]"
    aria-label="AI 生成输入框"
  >
    <div
      class="yh-upload-deck"
      :class="{ 'has-images': images.length }"
      :style="{ '--deck-count': images.length }"
    >
      <button
        v-for="(image, index) in images"
        :key="image.id"
        class="yh-upload-card"
        :class="{ active: activeImageId === image.id, uploading: image.uploading }"
        :style="{ '--deck-index': index, '--deck-total': images.length }"
        type="button"
        @mouseenter="activeImageId = image.id"
        @focus="activeImageId = image.id"
      >
        <img :src="image.url" :alt="image.name || '参考图'" />
        <span v-if="image.uploading" class="yh-upload-card-status">上传中</span>
        <span class="yh-image-count">{{ index + 1 }}</span>
        <span
          class="yh-remove-image"
          role="button"
          tabindex="0"
          @click.stop="removeImage(image.id)"
        >
          ×
        </span>
      </button>

      <button
        class="yh-upload-tile"
        type="button"
        :class="{ compact: images.length }"
        @click="openFilePicker"
      >
        <span v-if="uploading && !images.length" class="yh-uploading">上传中</span>
        <span v-else>{{ images.length ? '+' : '＋' }}</span>
      </button>
    </div>

    <input
      ref="fileInput"
      class="yh-upload-input"
      type="file"
      accept="image/*"
      multiple
      @change="handleFileChange"
    />
    <textarea v-model="prompt" aria-label="描述产品信息" :placeholder="placeholder" />
    <p v-if="uploadError" class="yh-upload-error">{{ uploadError }}</p>
    <footer :class="['yh-composer-footer', { 'is-main-image': isMainImageMode }]">
      <div class="yh-main-controls" @click.stop>
        <div class="yh-mode-wrap">
          <button class="yh-mode-btn" type="button" @click="toggleMenu('mode')">
            {{ primaryModeLabel }}
            <span>⌄</span>
          </button>
          <div v-if="open" class="yh-mode-menu">
            <button
              v-for="mode in modes"
              :key="mode"
              :class="{ active: mode === selectedMode }"
              type="button"
              @click="chooseMode(mode)"
            >
              {{ mode === '生成主图' ? '生成图片' : mode }}
            </button>
          </div>
        </div>

        <template v-if="isMainImageMode">
          <div class="yh-tool-dropdown">
            <button class="yh-tool-select" type="button" @click="toggleMenu('ratio')">
              {{ selectedRatio }}
              <span>{{ ratioOpen ? '⌃' : '⌄' }}</span>
            </button>
            <div v-if="ratioOpen" class="yh-ratio-menu">
              <button
                v-for="(ratio, index) in ratioOptions"
                :key="ratio"
                :class="{
                  active: selectedRatio === ratio,
                  featured: index === 0 && selectedRatio === '智能比例',
                }"
                type="button"
                @click="chooseRatio(ratio)"
              >
                <span>{{ ratio }}</span>
                <i></i>
              </button>
            </div>
          </div>
          <div class="yh-tool-dropdown">
            <button class="yh-tool-select" type="button" @click="toggleMenu('model')">
              {{ selectedModel }}
              <span>{{ modelOpen ? '⌃' : '⌄' }}</span>
            </button>
            <div v-if="modelOpen" class="yh-ratio-menu yh-model-menu">
              <button
                v-for="model in modelOptions"
                :key="model"
                :class="{ active: selectedModel === model }"
                type="button"
                @click="chooseModel(model)"
              >
                <span>{{ model }}</span>
                <i></i>
              </button>
            </div>
          </div>
          <div class="yh-tool-dropdown">
            <button
              class="yh-tool-select yh-tool-select-small"
              type="button"
              @click="toggleMenu('quality')"
            >
              {{ selectedQuality }}
              <span>{{ qualityOpen ? '⌃' : '⌄' }}</span>
            </button>
            <div v-if="qualityOpen" class="yh-ratio-menu yh-quality-menu">
              <button
                v-for="quality in qualityOptions"
                :key="quality"
                :class="{ active: selectedQuality === quality }"
                type="button"
                @click="chooseQuality(quality)"
              >
                <span>{{ quality }}</span>
                <i></i>
              </button>
            </div>
          </div>

          <div class="yh-tool-dropdown">
            <button class="yh-tool-select" type="button" @click="toggleMenu('count')">
              {{ selectedCount }}
              <span>{{ countOpen ? '⌃' : '⌄' }}</span>
            </button>
            <div v-if="countOpen" class="yh-ratio-menu yh-count-menu">
              <button
                v-for="count in countOptions"
                :key="count"
                :class="{ active: selectedCount === count }"
                type="button"
                @click="chooseCount(count)"
              >
                <span>{{ count }}</span>
                <i></i>
              </button>
            </div>
          </div>
        </template>

        <span v-else class="yh-composer-tip">上传参考图并描述产品，点击右侧生成</span>
      </div>

      <div class="yh-action-area">
        <template v-if="isMainImageMode">
          <span class="yh-discount">限时优惠</span>
          <span class="yh-main-cost">
            15米值/张
            <s>20</s>
          </span>
          <button
            :class="['yh-generate', 'yh-generate-primary', { 'is-ready': hasComposerContent }]"
            type="button"
            :disabled="!hasComposerContent"
            @click="submitGenerate"
          >
            立即生成
          </button>
        </template>
        <template v-else>
          <span class="yh-cost">{{ isDetailCloneMode ? '按切片计费' : '按屏数计费' }}</span>
          <button
            :class="[
              'yh-generate',
              'yh-generate-detail',
              { 'is-ready': hasComposerContent || isDetailCloneMode },
            ]"
            type="button"
            :disabled="!hasComposerContent && !isDetailCloneMode"
            @click="isDetailCloneMode ? openCloneModal() : openDetailModal()"
          >
            {{ isDetailCloneMode ? '竞品复刻' : '生成详情页' }}
          </button>
        </template>
      </div>
    </footer>

    <Teleport to="body">
      <div v-if="detailModalOpen" class="yh-modal-backdrop">
        <section class="yh-detail-modal" role="dialog" aria-modal="true" aria-label="生成详情页">
          <header class="yh-detail-modal-head">
            <h2>生成详情页</h2>
            <button type="button" @click="detailModalOpen = false">×</button>
          </header>

          <div class="yh-detail-modal-body">
            <label class="yh-detail-field yh-detail-field-full">
              <span>产品信息</span>
              <textarea v-model="detailDraft.productInfo"></textarea>
            </label>

            <div class="yh-detail-section-title">生成方式</div>
            <div class="yh-detail-methods">
              <button
                :class="{ active: detailDraft.method === 'split' }"
                type="button"
                @click="detailDraft.method = 'split'"
              >
                分屏生图
              </button>
              <button
                :class="{ active: detailDraft.method === 'long' }"
                type="button"
                @click="detailDraft.method = 'long'"
              >
                整版长图
                <small>NEW</small>
              </button>
            </div>

            <div class="yh-detail-grid">
              <label class="yh-detail-field">
                <span>模型</span>
                <select v-model="detailDraft.model">
                  <option>gpt image 2</option>
                  <option>banana2</option>
                  <option>banana pro</option>
                </select>
              </label>
              <label class="yh-detail-field">
                <span>比例</span>
                <select v-model="detailDraft.ratio">
                  <option>9:16</option>
                  <option>3:4</option>
                  <option>1:1</option>
                </select>
              </label>
              <label class="yh-detail-field">
                <span>分辨率</span>
                <select v-model="detailDraft.resolution">
                  <option>2K</option>
                  <option>4K</option>
                </select>
              </label>
              <label class="yh-detail-field">
                <span>平台</span>
                <select v-model="detailDraft.platform">
                  <option>淘宝</option>
                  <option>天猫</option>
                  <option>京东</option>
                </select>
              </label>
              <label class="yh-detail-field">
                <span>屏数</span>
                <select v-model="detailDraft.screens">
                  <option>3 屏</option>
                  <option>5 屏</option>
                  <option>8 屏</option>
                </select>
              </label>
            </div>

            <label class="yh-detail-field yh-detail-field-full">
              <span>
                风格参考
                <em>（可选）</em>
              </span>
              <input
                v-model="detailDraft.style"
                placeholder="描述期望的风格，如：暖色调、极简风、复古感"
              />
            </label>

            <button class="yh-split-idea" type="button" @click="openSplitIdea">▦ 分屏构思</button>
          </div>

          <footer class="yh-detail-modal-foot">
            <span>预计消耗 45 米值</span>
            <div>
              <button type="button" @click="detailModalOpen = false">取消</button>
              <button type="button" class="primary" @click="submitDetailGenerate">开始生成</button>
            </div>
          </footer>
        </section>

        <section
          v-if="splitIdeaOpen"
          class="yh-split-modal"
          role="dialog"
          aria-modal="true"
          aria-label="分屏构思"
        >
          <header class="yh-split-head">
            <div>
              <h2>分屏构思</h2>
              <button type="button">
                选择模板
                <span>⌄</span>
              </button>
            </div>
            <button type="button" @click="splitIdeaOpen = false">×</button>
          </header>

          <div class="yh-split-tabs">
            <button class="active" type="button">系统预设</button>
            <button type="button">我的创意</button>
          </div>

          <p class="yh-split-note">
            已按“{{ detailDraft.productInfo || '产品' }}”生成
            {{ splitPlans.length }} 屏策划。勾选要保留的分屏，确认后会同步到生成方案。
          </p>
          <p v-if="promptGenerating" class="yh-split-status">正在调用大语言模型生成生图提示词...</p>
          <p v-else-if="promptError" class="yh-split-status error">{{ promptError }}</p>

          <div class="yh-split-list">
            <article
              v-for="item in splitPlans"
              :key="item.id"
              :class="['yh-split-row', { selected: selectedSplitIds.includes(item.id) }]"
            >
              <label>
                <input
                  type="checkbox"
                  :checked="selectedSplitIds.includes(item.id)"
                  @change="toggleSplitPlan(item.id)"
                />
                <strong>{{ item.index }}. {{ item.title }}</strong>
              </label>
              <p>{{ item.goal }}</p>
              <dl>
                <div>
                  <dt>文案重点</dt>
                  <dd>{{ item.copy }}</dd>
                </div>
                <div>
                  <dt>画面方向</dt>
                  <dd>{{ item.visual }}</dd>
                </div>
                <div>
                  <dt>模型提示词</dt>
                  <dd>{{ item.prompts.positive }}</dd>
                </div>
                <div>
                  <dt>负向约束</dt>
                  <dd>{{ item.prompts.negative }}</dd>
                </div>
              </dl>
              <small>{{ item.category }} / {{ item.proof }}</small>
              <small v-if="item.promptProvider" class="yh-prompt-provider">
                提示词来源：{{ item.promptProvider }}
              </small>
            </article>
          </div>

          <footer class="yh-split-foot">
            <button type="button" @click="splitIdeaOpen = false">取消</button>
            <button type="button" class="outline" @click="openSplitIdea">重新规划</button>
            <button type="button" :disabled="!selectedSplitIds.length" @click="applySplitIdea">
              确认保存并使用
            </button>
          </footer>
        </section>
      </div>

      <div v-if="cloneModalOpen" class="yh-modal-backdrop yh-clone-backdrop">
        <section
          class="yh-detail-modal yh-clone-modal yh-copycat-panel"
          role="dialog"
          aria-modal="true"
          aria-label="竞品复刻"
        >
          <header class="yh-detail-modal-head yh-copycat-head">
            <h2>竞品复刻</h2>
            <button type="button" @click="cloneModalOpen = false">×</button>
          </header>

          <div class="yh-detail-modal-body yh-copycat-body">
            <section class="yh-copycat-field">
              <div class="yh-copycat-label">
                <strong>竞品图片</strong>
                <button type="button" aria-label="竞品图片说明">?</button>
              </div>
              <input
                ref="cloneCompetitorInput"
                type="file"
                accept="image/*"
                multiple
                hidden
                @change="handleCloneFiles($event, 'competitor')"
              />
              <input
                ref="clonePreviewInput"
                type="file"
                accept="image/*"
                multiple
                hidden
                @change="handleClonePreviewFiles"
              />
              <div class="yh-copycat-source-tabs" aria-label="竞品选择方式">
                <button
                  type="button"
                  :class="{ active: cloneDraft.competitorSource === 'upload' }"
                  @click="setCloneCompetitorSource('upload')"
                >
                  直接上传
                </button>
                <button
                  type="button"
                  :class="{ active: cloneDraft.competitorSource === 'webpage' }"
                  @click="setCloneCompetitorSource('webpage')"
                >
                  网页提取
                </button>
              </div>

              <div
                v-if="cloneDraft.competitorSource === 'upload'"
                class="yh-copycat-upload"
                role="button"
                tabindex="0"
                @click="openCloneCompetitorPicker"
                @keydown.enter.prevent="openCloneCompetitorPicker"
              >
                <div v-if="cloneImages('competitor').length" class="yh-copycat-thumbs">
                  <figure v-for="(image, index) in cloneImages('competitor')" :key="image.id">
                    <img :src="image.url" :alt="image.name || '竞品图'" />
                    <span>{{ index + 1 }}</span>
                    <em v-if="image.uploading">上传中</em>
                    <em v-else-if="image.error">{{ image.error }}</em>
                    <button type="button" @click.stop="removeCloneImage('competitor', image.id)">
                      ×
                    </button>
                  </figure>
                </div>
                <template v-else>
                  <i aria-hidden="true">☁</i>
                  <strong>
                    点击上传
                    <small>或拖拽上传</small>
                  </strong>
                  <em>从生成历史导入</em>
                </template>
              </div>
              <div v-else class="yh-copycat-web">
                <div class="yh-copycat-url-row">
                  <input
                    v-model.trim="cloneDraft.competitorPageUrl"
                    type="text"
                    placeholder="输入商品ID或粘贴商品链接"
                    @keydown.enter.prevent="extractCompetitorImages"
                  />
                  <button
                    type="button"
                    :disabled="
                      cloneLoading === 'extract-competitor' || cloneLoading === 'cut-competitor'
                    "
                    @click="extractCompetitorImages"
                  >
                    {{ cloneLoading === 'extract-competitor' ? '提取中' : '提取' }}
                  </button>
                </div>
                <small>
                  输入商品ID会新开标签页打开天猫详情页；粘贴完整链接会自动识别 id，生成比例固定为
                  9:16。
                </small>
                <button
                  type="button"
                  class="yh-copycat-link-btn"
                  @click="openCloneCompetitorPicker"
                >
                  补充上传
                </button>
              </div>
            </section>

            <section class="yh-copycat-field">
              <div class="yh-copycat-label">
                <strong>产品图片</strong>
                <button type="button" aria-label="产品图片说明">?</button>
              </div>
              <input
                ref="cloneProductInput"
                type="file"
                accept="image/*"
                multiple
                hidden
                @change="handleCloneFiles($event, 'product')"
              />
              <div
                class="yh-copycat-upload"
                role="button"
                tabindex="0"
                @click="openCloneProductPicker"
                @keydown.enter.prevent="openCloneProductPicker"
              >
                <div v-if="cloneImages('product').length" class="yh-copycat-thumbs">
                  <figure v-for="(image, index) in cloneImages('product')" :key="image.id">
                    <img :src="image.url" :alt="image.name || '产品图'" />
                    <span>{{ index + 1 }}</span>
                    <em v-if="image.uploading">上传中</em>
                    <em v-else-if="image.error">{{ image.error }}</em>
                    <button type="button" @click.stop="removeCloneImage('product', image.id)">
                      ×
                    </button>
                  </figure>
                </div>
                <template v-else>
                  <i aria-hidden="true">☁</i>
                  <strong>
                    点击上传
                    <small>或拖拽上传</small>
                  </strong>
                  <em>从生成历史导入</em>
                </template>
              </div>
            </section>

            <section class="yh-copycat-field">
              <div class="yh-copycat-label">
                <strong>产品信息</strong>
              </div>
              <div class="yh-copycat-info">
                <div class="yh-copycat-info-tabs" aria-label="产品信息显示模式">
                  <button
                    type="button"
                    :class="{ active: !cloneProductInfoPreview }"
                    @click="cloneProductInfoPreview = false"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    :class="{ active: cloneProductInfoPreview }"
                    @click="cloneProductInfoPreview = true"
                  >
                    预览
                  </button>
                </div>
                <textarea
                  v-if="!cloneProductInfoPreview"
                  v-model="cloneDraft.productInfo"
                  placeholder="请输入产品名称、卖点、价格等信息，支持 Markdown"
                ></textarea>
                <div
                  v-else
                  class="yh-copycat-info-preview"
                  v-html="renderProductInfoMarkdown(cloneDraft.productInfo)"
                ></div>
                <button
                  type="button"
                  class="yh-copycat-info-optimize"
                  :disabled="cloneOptimizingProductInfo || cloneLoading === 'upload-product'"
                  @click="optimizeCloneProductInfo"
                >
                  {{ cloneOptimizingProductInfo ? '优化中...' : '优化产品信息' }}
                </button>
              </div>
            </section>

            <section class="yh-copycat-switch-field">
              <div>
                <strong>
                  模特保持一致
                  <em>(可选)</em>
                </strong>
                <p>
                  仅当竞品图中含有模特时本设置才会生效；竞品图中无模特则忽略本设置。开启：保留与竞品图同一个模特；关闭：生成不同模特。
                </p>
              </div>
              <label class="yh-copycat-toggle">
                <input v-model="cloneDraft.keepModel" type="checkbox" />
                <i></i>
                <span>{{ cloneDraft.keepModel ? '开启' : '关闭' }}</span>
              </label>
            </section>

            <section class="yh-copycat-field yh-copycat-resolution">
              <div class="yh-copycat-label">
                <strong>分辨率</strong>
              </div>
              <div class="yh-copycat-resolution-options" role="group" aria-label="分辨率">
                <button
                  v-for="resolution in cloneResolutionOptions"
                  :key="resolution"
                  type="button"
                  :class="{ active: cloneDraft.resolution === resolution }"
                  @click="cloneDraft.resolution = resolution"
                >
                  {{ resolution }}
                </button>
              </div>
            </section>

            <section class="yh-copycat-field yh-copycat-prompts">
              <div class="yh-copycat-label">
                <strong>复刻提示词</strong>
                <button type="button" aria-label="复刻提示词说明">?</button>
              </div>
              <div class="yh-copycat-prompt-head">
                <p>
                  竞品预览有 {{ cloneImageUrls('competitor').length }} 张图，将生成
                  {{ cloneImageUrls('competitor').length }} 屏；每屏提示词可编辑。
                </p>
                <button
                  type="button"
                  :disabled="cloneLoading === 'prompt' || cloneLoading === 'upload-product'"
                  @click="prepareClonePrompts"
                >
                  {{ cloneLoading === 'prompt' ? '生成中...' : '生成复刻提示词' }}
                </button>
              </div>
              <div v-if="cloneDraft.mappingContracts.length" class="yh-copycat-prompt-list">
                <article
                  v-for="(mapping, index) in cloneDraft.mappingContracts"
                  :key="`mapping-${mapping.sliceIndex || index}`"
                >
                  <header>
                    <strong>第 {{ index + 1 }} 屏</strong>
                    <span>{{ mapping.newProductRole || mapping.aRole || '产品信息映射' }}</span>
                  </header>
                  <div class="yh-copycat-prompt-card">
                    <div class="yh-copycat-prompt-fields">
                      <label>
                        <span>每屏主题</span>
                        <input
                          v-model="mapping.theme"
                          type="text"
                          @input="refreshCloneMappingHint(mapping, index)"
                        />
                      </label>
                      <label>
                        <span>设计思路</span>
                        <textarea
                          v-model="mapping.designIdea"
                          @input="refreshCloneMappingHint(mapping, index)"
                        ></textarea>
                      </label>
                      <label>
                        <span>视觉画面</span>
                        <textarea
                          v-model="mapping.visualScene"
                          @input="refreshCloneMappingHint(mapping, index)"
                        ></textarea>
                      </label>
                      <label>
                        <span>文案内容</span>
                        <textarea
                          v-model="mapping.copyContent"
                          @input="refreshCloneMappingHint(mapping, index)"
                        ></textarea>
                      </label>
                      <label>
                        <span>生图提示词</span>
                        <textarea
                          v-model="mapping.generationHint"
                          class="full"
                          placeholder="编辑本屏完整图生图提示词"
                        ></textarea>
                      </label>
                    </div>
                    <figure class="yh-copycat-prompt-image">
                      <img
                        v-if="cloneImageUrls('competitor')[index]"
                        :src="cloneImageUrls('competitor')[index]"
                        :alt="`竞品第 ${index + 1} 屏`"
                      />
                      <figcaption v-if="cloneImageUrls('competitor')[index]">
                        竞品第 {{ index + 1 }} 屏
                      </figcaption>
                      <span v-else>暂无对应竞品图</span>
                    </figure>
                  </div>
                </article>
              </div>
              <div v-else class="yh-copycat-prompt-empty">
                点击生成后，会按竞品图片数量生成每屏可编辑提示词。
              </div>
            </section>

            <p
              v-if="['upload-competitor', 'upload-product'].includes(cloneLoading)"
              class="yh-split-status"
            >
              正在上传图片...
            </p>
            <p v-if="cloneLoading === 'extract-competitor'" class="yh-split-status">
              正在从网页提取竞品图片...
            </p>
            <p v-if="cloneLoading === 'cut-competitor'" class="yh-split-status">
              正在合并并裁切竞品图片...
            </p>
            <p v-if="cloneLoading === 'prompt'" class="yh-split-status">
              正在按竞品图片生成每屏提示词...
            </p>
            <p v-if="cloneError" class="yh-split-status error">{{ cloneError }}</p>
          </div>

          <footer class="yh-detail-modal-foot yh-copycat-foot">
            <button
              type="button"
              class="primary"
              :disabled="cloneLoading !== ''"
              @click="submitCloneGenerate"
            >
              {{ cloneLoading ? '处理中...' : '立即生成' }}
            </button>
            <div>
              <span>预计消耗 15 米值</span>
              <strong>15 米值/张</strong>
            </div>
          </footer>
        </section>

        <aside
          v-if="
            cloneDraft.competitorSource === 'webpage' &&
            (cloneLoading === 'extract-competitor' || cloneWebpageImages.length)
          "
          class="yh-copycat-preview-rail"
          aria-label="竞品预览"
        >
          <header>
            <div>
              <strong>竞品预览</strong>
              <span v-if="cloneWebpageImages.length">{{ cloneWebpageImages.length }} 张</span>
              <span v-else>提取中</span>
            </div>
            <label v-if="cloneWebpageImages.length">
              <span>{{ clonePreviewZoom }}%</span>
              <input v-model.number="clonePreviewZoom" type="range" min="80" max="120" step="2" />
            </label>
          </header>
          <div v-if="cloneWebpageImages.length" class="yh-copycat-preview-tools">
            <template v-if="clonePreviewMerged">
              <button type="button" @click="restoreClonePreview">还原</button>
              <button type="button" :class="{ active: cloneCutMode }" @click="toggleCloneCutMode">
                添加裁切线
              </button>
              <button
                v-if="cloneCutLines.length"
                type="button"
                class="primary"
                :disabled="cloneLoading === 'cut-competitor'"
                @click="executeCloneCut"
              >
                {{ cloneLoading === 'cut-competitor' ? '裁切中' : '执行裁切' }}
              </button>
            </template>
            <template v-else>
              <button type="button" @click="openClonePreviewPicker">补充上传</button>
              <button type="button" class="primary" @click="mergeClonePreview">合并</button>
            </template>
          </div>
          <div
            v-if="cloneWebpageImages.length"
            :class="[
              'yh-copycat-preview-list',
              { merged: clonePreviewMerged, cutting: cloneCutMode },
            ]"
            :style="{ '--preview-image-width': `${clonePreviewZoom}%` }"
            @click="addCloneCutLine"
          >
            <div v-if="clonePreviewMerged" class="yh-copycat-merged-canvas">
              <figure
                v-for="(image, index) in cloneWebpageImages"
                :key="image.id"
                :title="image.url"
              >
                <img :src="image.url" :alt="image.name || '详情页图片'" />
                <figcaption>{{ index + 1 }}</figcaption>
              </figure>
              <button
                v-for="line in cloneCutLines"
                :key="line"
                type="button"
                :class="['yh-copycat-cut-line', { dragging: cloneDraggingCutLine === line }]"
                :style="{ top: `${line}%` }"
                title="按住上下拖动裁切线"
                @click.stop
                @pointerdown.stop.prevent="startCloneCutDrag(line, $event)"
              >
                <span>{{ line }}%</span>
                <i
                  aria-label="删除裁切线"
                  title="删除裁切线"
                  @click.stop="removeCloneCutLine(line)"
                  @pointerdown.stop
                >
                  ×
                </i>
              </button>
            </div>
            <template v-else>
              <figure
                v-for="(image, index) in cloneWebpageImages"
                :key="image.id"
                :class="{
                  active: clonePreviewActiveImageId === image.id,
                  dragging: clonePreviewDragId === image.id,
                  'drag-over': clonePreviewDragOverId === image.id,
                }"
                :title="image.url"
                draggable="true"
                @click.stop="clonePreviewActiveImageId = image.id"
                @dragstart="startClonePreviewDrag(image.id, $event)"
                @dragenter.prevent="enterClonePreviewDrag(image.id, $event)"
                @dragover.prevent
                @dragleave="leaveClonePreviewDrag(image.id, $event)"
                @drop.prevent="dropClonePreviewImage(image.id)"
                @dragend="endClonePreviewDrag"
              >
                <img :src="image.url" :alt="image.name || '详情页图片'" />
                <figcaption>{{ index + 1 }}</figcaption>
                <em v-if="image.uploading">上传中</em>
                <em v-else-if="image.error">{{ image.error }}</em>
                <button
                  type="button"
                  class="yh-copycat-preview-delete"
                  aria-label="删除图片"
                  title="删除图片"
                  @click.stop="removeClonePreviewImage(image.id)"
                >
                  ×
                </button>
              </figure>
            </template>
          </div>
          <div v-else class="yh-copycat-preview-empty">等待详情页回传...</div>
        </aside>
      </div>
    </Teleport>
  </section>
</template>

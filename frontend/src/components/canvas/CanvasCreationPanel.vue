<script setup>
import { computed, ref, watch } from 'vue'
import { useUserStore } from '../../stores/user'
import { apiPath } from '../../utils/apiBase'
import { createDemandFallback, createDetailFallback } from '../../utils/canvasCreative'
import {
  buildCompetitorStyleClonePrompt,
  extractCompetitorStylePrompt,
} from '../../utils/canvasStyleClone'
import { resolveSupportedImageRatio } from '../../utils/imageRatio'

const props = defineProps({
  open: { type: Boolean, default: false },
  selectedLayers: { type: Array, default: () => [] },
  model: { type: String, default: '' },
  resolution: { type: String, default: '2K' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'run'])
const userStore = useUserStore()
const tab = ref('main')
const mode = ref('layout')
const extra = ref('')
const mainCategory = ref('mattress')
const mainCategories = ref([
  { value: 'mattress', label: '床垫' },
  { value: 'curtain', label: '窗帘' },
  { value: 'solid_wood_bed', label: '实木床' },
  { value: 'general', label: '通用' },
])
const mainCategoriesLoaded = ref(false)
const mainAnalyzing = ref(false)
const mainAnalysisStatus = ref('')
const mainAnalysisError = ref('')
const mainAnalysisCache = new Map()
const demandProductInfo = ref('')
const demandCount = ref(6)
const demandStyle = ref('真实、清晰、有品质感')
const demandCards = ref([])
const demandPlanning = ref(false)
const demandError = ref('')
const demandNotice = ref('')
const detailProductInfo = ref('')
const detailCount = ref(6)
const detailStyle = ref('真实、清晰、有品质感')
const detailStrength = ref('balanced')
const detailScreens = ref([])
const detailPlanning = ref(false)
const detailError = ref('')
const detailNotice = ref('')
const orderedLayers = ref([])
const productLayerCount = ref(0)
const draggedLayerIndex = ref(-1)
const dragTargetIndex = ref(-1)
const activeLayerDropZone = ref('')

const products = computed(() => orderedLayers.value.slice(0, productLayerCount.value))
const product = computed(() => products.value[0] || null)
const references = computed(() => orderedLayers.value.slice(productLayerCount.value))
const canRunMain = computed(() =>
  Boolean(products.value.length && references.value.length && !props.busy && !mainAnalyzing.value),
)
const selectedDemandCards = computed(() => demandCards.value.filter((card) => card.selected))
const canPlanDemands = computed(() =>
  Boolean(product.value && demandProductInfo.value.trim() && !demandPlanning.value && !props.busy),
)
const canRunDemands = computed(() =>
  Boolean(
    product.value && selectedDemandCards.value.length && !demandPlanning.value && !props.busy,
  ),
)
const selectedDetailScreens = computed(() =>
  detailScreens.value.filter((screen) => screen.selected),
)
const canPlanDetail = computed(() =>
  Boolean(product.value && detailProductInfo.value.trim() && !detailPlanning.value && !props.busy),
)
const canRunDetail = computed(() =>
  Boolean(
    product.value && selectedDetailScreens.value.length && !detailPlanning.value && !props.busy,
  ),
)

watch(
  () =>
    props.selectedLayers
      .map((layer, index) => `${layer?.id || index}:${layer?.url || ''}`)
      .join('|'),
  () => {
    orderedLayers.value = [...props.selectedLayers]
    productLayerCount.value = props.selectedLayers.length ? 1 : 0
    resetLayerDrag()
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      orderedLayers.value = [...props.selectedLayers]
      productLayerCount.value = props.selectedLayers.length ? 1 : 0
      resetLayerDrag()
      mainAnalysisError.value = ''
      mainAnalysisStatus.value = ''
      const productCategory = String(product.value?.reversePromptCategory || '').trim()
      if (productCategory && productCategory !== 'general') mainCategory.value = productCategory
      void loadMainCategories()
      return
    }
    extra.value = ''
    mainAnalysisError.value = ''
    mainAnalysisStatus.value = ''
    demandError.value = ''
    demandNotice.value = ''
    detailError.value = ''
    detailNotice.value = ''
  },
)

watch([mode, mainCategory, references], () => {
  mainAnalysisError.value = ''
  mainAnalysisStatus.value = ''
})

function outputAspect(layer) {
  const ratio = resolveSupportedImageRatio(layer)
  const [aspectWidth, aspectHeight] = ratio.split(':').map(Number)
  return { ratio, aspectWidth, aspectHeight }
}

async function loadMainCategories() {
  if (mainCategoriesLoaded.value) return
  try {
    const response = await fetch(apiPath('/api/prompt/categories'), {
      headers: userStore.authHeaders(),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.code) return
    const categories = Array.isArray(payload.data) ? payload.data : []
    if (categories.length) {
      mainCategories.value = categories.map((item) => ({
        value: String(item.value || 'general'),
        label: String(item.label || item.value || '通用'),
      }))
    }
    mainCategoriesLoaded.value = true
  } catch {
    // Keep the built-in category list when metadata is temporarily unavailable.
  }
}

function beginLayerDrag(index, event) {
  draggedLayerIndex.value = index
  dragTargetIndex.value = index
  if (!event?.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function enterLayerDropTarget(index) {
  if (draggedLayerIndex.value >= 0) dragTargetIndex.value = index
}

function enterLayerDropZone(zone, event) {
  if (draggedLayerIndex.value < 0) return
  activeLayerDropZone.value = zone
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function leaveLayerDropZone(zone, event) {
  if (event?.currentTarget?.contains(event.relatedTarget)) return
  if (activeLayerDropZone.value === zone) activeLayerDropZone.value = ''
}

function swapLayerPositions(targetIndex, event) {
  const transferredIndex = Number(event?.dataTransfer?.getData('text/plain'))
  const sourceIndex = draggedLayerIndex.value >= 0 ? draggedLayerIndex.value : transferredIndex
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= orderedLayers.value.length ||
    targetIndex < 0 ||
    targetIndex >= orderedLayers.value.length ||
    sourceIndex === targetIndex
  ) {
    resetLayerDrag()
    return
  }

  const nextLayers = [...orderedLayers.value]
  ;[nextLayers[sourceIndex], nextLayers[targetIndex]] = [
    nextLayers[targetIndex],
    nextLayers[sourceIndex],
  ]
  orderedLayers.value = nextLayers
  invalidateCreationPlans()
  resetLayerDrag()
}

function dropIntoLayerZone(zone) {
  const sourceIndex = draggedLayerIndex.value
  if (sourceIndex >= 0) {
    moveLayerIntoZone(sourceIndex, zone)
  }
  resetLayerDrag()
}

function moveLayerIntoZone(sourceIndex, zone) {
  if (sourceIndex < 0 || sourceIndex >= orderedLayers.value.length) return
  const sourceZone = sourceIndex < productLayerCount.value ? 'product' : 'references'
  if (sourceZone === zone) return

  const nextLayers = [...orderedLayers.value]
  const [movingLayer] = nextLayers.splice(sourceIndex, 1)
  if (!movingLayer) return

  if (sourceZone === 'product') productLayerCount.value -= 1
  if (zone === 'product') {
    nextLayers.splice(productLayerCount.value, 0, movingLayer)
    productLayerCount.value += 1
  } else {
    nextLayers.push(movingLayer)
  }
  orderedLayers.value = nextLayers
  invalidateCreationPlans()
}

function removeCreationLayer(index) {
  if (index < 0 || index >= orderedLayers.value.length) return
  if (index < productLayerCount.value) productLayerCount.value -= 1
  orderedLayers.value = orderedLayers.value.filter((_, layerIndex) => layerIndex !== index)
  invalidateCreationPlans()
  resetLayerDrag()
}

function invalidateCreationPlans() {
  demandCards.value = []
  detailScreens.value = []
  demandNotice.value = ''
  detailNotice.value = ''
}

function resetLayerDrag() {
  draggedLayerIndex.value = -1
  dragTargetIndex.value = -1
  activeLayerDropZone.value = ''
}

async function analyzeMainReference(reference, category) {
  const cacheKey = `${category}::${reference.url}`
  if (mainAnalysisCache.has(cacheKey)) return mainAnalysisCache.get(cacheKey)

  const response = await fetch(apiPath('/api/prompt/analyze-image'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...userStore.authHeaders(),
    },
    body: JSON.stringify({
      category,
      imageUrl: reference.url,
      thinkingEnabled: false,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401 || response.status === 403) {
    throw new Error(payload.message || '登录已失效，请重新登录')
  }
  if (!response.ok || payload.code) {
    throw new Error(payload.message || `${reference.name || '竞品图'}反推失败`)
  }

  const result = payload.data || {}
  const stylePrompt = extractCompetitorStylePrompt(result.promptJson, result.fieldLabels)
  if (!stylePrompt) throw new Error(`${reference.name || '竞品图'}没有解析出可用风格`)
  const analyzed = { ...result, stylePrompt }
  mainAnalysisCache.set(cacheKey, analyzed)
  return analyzed
}

async function analyzeMainReferences(items, category) {
  const results = new Array(items.length)
  let completed = 0
  for (let index = 0; index < items.length; index += 1) {
    results[index] = await analyzeMainReference(items[index], category)
    completed += 1
    mainAnalysisStatus.value = `正在反推竞品风格 ${completed}/${items.length}`
  }
  return results
}

async function runMainImages() {
  if (!canRunMain.value) return
  mainAnalyzing.value = true
  mainAnalysisError.value = ''
  const selectedMode = mode.value
  const selectedCategory = selectedMode === 'layout' ? mainCategory.value : 'general'
  const selectedProducts = [...products.value]
  const selectedProduct = product.value
  const selectedReferences = [...references.value]
  mainAnalysisStatus.value = `正在反推竞品风格 0/${selectedReferences.length}`

  try {
    const analyses = await analyzeMainReferences(selectedReferences, selectedCategory)
    emit('run', {
      type: 'main-image',
      sourceIds: selectedProducts.map((item) => item.id),
      jobs: selectedReferences.map((reference, index) => {
        const aspect = outputAspect(reference)
        return {
          name: `${selectedMode === 'layout' ? '主图复刻' : '风格迁移'} ${index + 1}`,
          prompt: buildCompetitorStyleClonePrompt({
            mode: selectedMode,
            stylePrompt: analyses[index].stylePrompt,
            extra: extra.value,
          }),
          imageUrls: selectedProducts.map((item) => item.url),
          sourceIds: [...selectedProducts.map((item) => item.id), reference.id],
          previewUrl: selectedProduct.url,
          ...aspect,
          model: props.model,
          resolution: props.resolution,
        }
      }),
    })
  } catch (error) {
    mainAnalysisError.value = String(error?.message || error || '竞品风格反推失败')
  } finally {
    mainAnalyzing.value = false
    mainAnalysisStatus.value = ''
  }
}

async function planDemands() {
  if (!canPlanDemands.value) return
  demandPlanning.value = true
  demandError.value = ''
  demandNotice.value = ''
  try {
    const response = await fetch(apiPath('/api/canvas-creative/demands'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify({
        productInfo: demandProductInfo.value.trim(),
        productImages: products.value.map((item) => item.url),
        count: Number(demandCount.value) || 6,
        platform: '淘宝/天猫',
        style: demandStyle.value.trim(),
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      throw new Error(payload.message || '登录已失效，请重新登录')
    }
    if (!response.ok || payload.code) {
      throw new Error(payload.message || '需求规划服务暂不可用')
    }
    const cards = Array.isArray(payload.data?.cards) ? payload.data.cards : []
    if (!cards.length) throw new Error('没有生成可用的需求方向')
    demandCards.value = cards.map((card) => ({ ...card, selected: true }))
  } catch (error) {
    const message = String(error?.message || error || '需求生成失败')
    if (/登录|401|403/.test(message)) {
      demandError.value = message
    } else {
      demandCards.value = createDemandFallback({
        productInfo: demandProductInfo.value.trim(),
        count: demandCount.value,
        style: demandStyle.value.trim(),
      })
      demandNotice.value = '规划服务暂不可用，已生成可编辑的内置稳定方案。'
    }
  } finally {
    demandPlanning.value = false
  }
}

function runDemands() {
  if (!canRunDemands.value) return
  const aspect = outputAspect(product.value)
  emit('run', {
    type: 'demand',
    sourceIds: products.value.map((item) => item.id),
    jobs: selectedDemandCards.value.map((card) => ({
      name: `${card.dimension || '需求'} · ${card.title || card.index}`,
      prompt: [
        card.imagePrompt,
        `最终创意标题：${card.title || ''}`,
        `最终画面文案：${card.copy || ''}`,
        `最终视觉方向：${card.visualDirection || ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
      imageUrls: products.value.map((item) => item.url),
      sourceIds: products.value.map((item) => item.id),
      previewUrl: product.value.url,
      ...aspect,
      model: props.model,
      resolution: props.resolution,
    })),
  })
}

async function planDetail() {
  if (!canPlanDetail.value) return
  detailPlanning.value = true
  detailError.value = ''
  detailNotice.value = ''
  try {
    const response = await fetch(apiPath('/api/canvas-creative/detail-plan'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify({
        productInfo: detailProductInfo.value.trim(),
        productImages: products.value.map((item) => item.url),
        referenceImages: references.value.map((reference) => reference.url),
        count: Number(detailCount.value) || 6,
        platform: '淘宝/天猫',
        style: detailStyle.value.trim(),
        ratio: references.value.length ? '对应参考图原始比例' : ratioOf(product.value),
        cloneStrength: detailStrength.value,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      throw new Error(payload.message || '登录已失效，请重新登录')
    }
    if (!response.ok || payload.code) {
      throw new Error(payload.message || '详情页规划服务暂不可用')
    }
    const screens = Array.isArray(payload.data?.screens) ? payload.data.screens : []
    if (!screens.length) throw new Error('没有生成可用的详情页分屏')
    detailScreens.value = screens.map((screen) => ({ ...screen, selected: true }))
  } catch (error) {
    const message = String(error?.message || error || '详情页规划失败')
    if (/登录|401|403/.test(message)) {
      detailError.value = message
    } else {
      detailScreens.value = createDetailFallback({
        productInfo: detailProductInfo.value.trim(),
        count: detailCount.value,
        style: detailStyle.value.trim(),
        strength: detailStrength.value,
        referenceCount: references.value.length,
        ratio: references.value.length ? '对应参考图原始比例' : ratioOf(product.value),
      })
      detailNotice.value = '规划服务暂不可用，已按内置详情页结构生成可编辑分屏。'
    }
  } finally {
    detailPlanning.value = false
  }
}

function runDetail() {
  if (!canRunDetail.value) return
  emit('run', {
    type: 'detail',
    sourceIds: products.value.map((item) => item.id),
    jobs: selectedDetailScreens.value.map((screen) => {
      const reference =
        Number.isInteger(screen.referenceIndex) && screen.referenceIndex >= 0
          ? references.value[screen.referenceIndex]
          : null
      const aspectSource = reference || product.value
      return {
        name: `详情页 ${screen.index} · ${screen.title}`,
        prompt: [
          screen.imagePrompt,
          `最终分屏标题：${screen.title || ''}`,
          `最终画面文案：${screen.copy || ''}`,
          `最终视觉方向：${screen.visual || ''}`,
        ]
          .filter(Boolean)
          .join('\n'),
        imageUrls: [...products.value.map((item) => item.url), reference?.url].filter(Boolean),
        sourceIds: [...products.value.map((item) => item.id), reference?.id].filter(Boolean),
        previewUrl: product.value.url,
        aspectWidth: aspectSource.naturalWidth || aspectSource.width,
        aspectHeight: aspectSource.naturalHeight || aspectSource.height,
        ratio: ratioOf(aspectSource),
        model: props.model,
        resolution: props.resolution,
      }
    }),
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ccp-backdrop" @click.self="emit('close')">
      <section class="ccp-panel" role="dialog" aria-modal="true" aria-label="画布创作">
        <header>
          <div>
            <h2>画布创作</h2>
            <p>从当前画布素材生成可继续编辑和组合的创意结果。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <nav class="ccp-tabs" aria-label="创作类型">
          <button type="button" :class="{ active: tab === 'main' }" @click="tab = 'main'">
            主图生成
          </button>
          <button type="button" :class="{ active: tab === 'demand' }" @click="tab = 'demand'">
            需求生成
          </button>
          <button type="button" :class="{ active: tab === 'detail' }" @click="tab = 'detail'">
            详情页生成
          </button>
        </nav>

        <template v-if="tab === 'main'">
          <div class="ccp-mode-grid">
            <label :class="{ active: mode === 'layout' }">
              <input v-model="mode" type="radio" value="layout" />
              <b>同类目复刻</b>
              <span>借鉴参考图的版式、构图与视觉节奏，产品保持为你的商品。</span>
            </label>
            <label :class="{ active: mode === 'style' }">
              <input v-model="mode" type="radio" value="style" />
              <b>跨类目借风格</b>
              <span>保留产品真实外观，只迁移参考图的配色、光线和氛围。</span>
            </label>
          </div>

          <div class="ccp-analysis-settings">
            <label v-if="mode === 'layout'">
              <span>产品类目</span>
              <select v-model="mainCategory" :disabled="mainAnalyzing">
                <option
                  v-for="category in mainCategories"
                  :key="category.value"
                  :value="category.value"
                >
                  {{ category.label }}
                </option>
              </select>
            </label>
            <span>
              <i class="ri-sparkling-line"></i>
              {{
                mode === 'layout'
                  ? '先按产品类目反推竞品版式与风格，再用我方产品图生成'
                  : '先通用反推竞品视觉风格，再用我方产品图跨类目迁移'
              }}
            </span>
          </div>
          <p v-if="mainAnalysisError" class="ccp-main-error">{{ mainAnalysisError }}</p>

          <div class="ccp-selection">
            <div
              class="ccp-layer-zone"
              :class="{ 'zone-active': activeLayerDropZone === 'product' }"
              @dragover.stop.prevent="enterLayerDropZone('product', $event)"
              @dragleave="leaveLayerDropZone('product', $event)"
              @drop.stop.prevent="dropIntoLayerZone('product')"
            >
              <span>产品图 · {{ products.length }}</span>
              <div class="ccp-product-list">
                <figure
                  v-for="(item, index) in products"
                  :key="item.id"
                  class="ccp-draggable-layer"
                  :class="{
                    dragging: draggedLayerIndex === index,
                    'drag-target': dragTargetIndex === index && draggedLayerIndex !== index,
                  }"
                  draggable="true"
                  title="拖到参考图区空白处可移入，拖到图片上可交换"
                  @dragstart="beginLayerDrag(index, $event)"
                  @dragenter.prevent="enterLayerDropTarget(index)"
                  @dragover.prevent
                  @drop.stop.prevent="swapLayerPositions(index, $event)"
                  @dragend="resetLayerDrag"
                >
                  <img :src="item.url" alt="" />
                  <button
                    type="button"
                    class="ccp-layer-remove"
                    :aria-label="`删除${item.name || '产品图'}`"
                    title="删除图片"
                    draggable="false"
                    @pointerdown.stop
                    @click.stop="removeCreationLayer(index)"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                  <figcaption>{{ item.name || '产品图' }}</figcaption>
                </figure>
                <p v-if="!products.length">把图片拖入产品图区。</p>
              </div>
            </div>
            <div
              class="ccp-layer-zone"
              :class="{ 'zone-active': activeLayerDropZone === 'references' }"
              @dragover.stop.prevent="enterLayerDropZone('references', $event)"
              @dragleave="leaveLayerDropZone('references', $event)"
              @drop.stop.prevent="dropIntoLayerZone('references')"
            >
              <span>参考图 · {{ references.length }}</span>
              <div class="ccp-reference-list">
                <figure
                  v-for="(reference, index) in references"
                  :key="reference.id"
                  class="ccp-draggable-layer"
                  :class="{
                    dragging: draggedLayerIndex === productLayerCount + index,
                    'drag-target':
                      dragTargetIndex === productLayerCount + index &&
                      draggedLayerIndex !== productLayerCount + index,
                  }"
                  draggable="true"
                  title="拖到产品图区空白处可移入，拖到图片上可交换"
                  @dragstart="beginLayerDrag(productLayerCount + index, $event)"
                  @dragenter.prevent="enterLayerDropTarget(productLayerCount + index)"
                  @dragover.prevent
                  @drop.stop.prevent="swapLayerPositions(productLayerCount + index, $event)"
                  @dragend="resetLayerDrag"
                >
                  <img :src="reference.url" alt="" />
                  <button
                    type="button"
                    class="ccp-layer-remove"
                    :aria-label="`删除${reference.name || '参考图'}`"
                    title="删除图片"
                    draggable="false"
                    @pointerdown.stop
                    @click.stop="removeCreationLayer(productLayerCount + index)"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                  <figcaption>{{ reference.name || '参考图' }}</figcaption>
                </figure>
                <p v-if="!references.length">按住 Shift 再选一张或多张参考图。</p>
              </div>
            </div>
          </div>

          <label class="ccp-extra">
            <span>
              补充要求
              <small>可选</small>
            </span>
            <textarea
              v-model="extra"
              rows="3"
              placeholder="例如：主标题保留“清凉一夏”，整体更轻盈，减少促销元素"
            />
          </label>
        </template>

        <template v-else-if="tab === 'demand'">
          <div class="ccp-demand-input">
            <div class="ccp-product-thumb">
              <span>产品图</span>
              <figure v-if="product">
                <img :src="product.url" alt="" />
                <figcaption>{{ product.name || '产品图' }}</figcaption>
              </figure>
              <p v-else>请先在画布选中一张产品图。</p>
            </div>
            <div class="ccp-demand-fields">
              <label>
                <span>产品信息</span>
                <textarea
                  v-model="demandProductInfo"
                  rows="4"
                  placeholder="填写品类、材质、功能、卖点、适用人群和使用场景。只写已经确认的信息。"
                />
              </label>
              <div>
                <label>
                  <span>方向数量</span>
                  <select v-model="demandCount">
                    <option :value="3">3 个</option>
                    <option :value="6">6 个</option>
                    <option :value="9">9 个</option>
                    <option :value="12">12 个</option>
                  </select>
                </label>
                <label>
                  <span>整体风格</span>
                  <input v-model="demandStyle" type="text" />
                </label>
                <button type="button" :disabled="!canPlanDemands" @click="planDemands">
                  {{
                    demandPlanning
                      ? '正在生成方向…'
                      : demandCards.length
                        ? '重新生成方向'
                        : '生成需求方向'
                  }}
                </button>
              </div>
              <p v-if="demandError" class="ccp-error">{{ demandError }}</p>
              <p v-if="demandNotice" class="ccp-notice">{{ demandNotice }}</p>
            </div>
          </div>

          <div v-if="demandCards.length" class="ccp-demand-cards">
            <label
              v-for="card in demandCards"
              :key="card.id"
              class="ccp-demand-card"
              :class="{ selected: card.selected }"
            >
              <input v-model="card.selected" type="checkbox" />
              <span class="ccp-dimension">{{ card.dimension }}</span>
              <input v-model="card.title" class="ccp-card-title" type="text" />
              <textarea v-model="card.copy" rows="2" aria-label="画面文案" />
              <textarea v-model="card.visualDirection" rows="3" aria-label="视觉方向" />
              <small>{{ card.audience }} · {{ card.scene }}</small>
            </label>
          </div>
          <div v-else class="ccp-demand-empty">
            <i class="ri-lightbulb-flash-line"></i>
            <b>从人群、场景、需求三个维度拆分创意</b>
            <span>生成后可以逐张选择并修改标题、画面文案和视觉方向。</span>
          </div>
        </template>

        <template v-else>
          <div class="ccp-demand-input">
            <div class="ccp-product-thumb">
              <span>产品图 · {{ products.length }}</span>
              <div
                class="ccp-detail-product-zone"
                :class="{ 'zone-active': activeLayerDropZone === 'product' }"
                @dragover.stop.prevent="enterLayerDropZone('product', $event)"
                @dragleave="leaveLayerDropZone('product', $event)"
                @drop.stop.prevent="dropIntoLayerZone('product')"
              >
                <figure
                  v-for="(item, index) in products"
                  :key="item.id"
                  class="ccp-draggable-layer"
                  :class="{
                    dragging: draggedLayerIndex === index,
                    'drag-target': dragTargetIndex === index && draggedLayerIndex !== index,
                  }"
                  draggable="true"
                  title="拖到参考图区空白处可移入，拖到图片上可交换"
                  @dragstart="beginLayerDrag(index, $event)"
                  @dragenter.prevent="enterLayerDropTarget(index)"
                  @dragover.prevent
                  @drop.stop.prevent="swapLayerPositions(index, $event)"
                  @dragend="resetLayerDrag"
                >
                  <img :src="item.url" alt="" />
                  <button
                    type="button"
                    class="ccp-layer-remove compact"
                    :aria-label="`删除${item.name || '产品图'}`"
                    title="删除图片"
                    draggable="false"
                    @pointerdown.stop
                    @click.stop="removeCreationLayer(index)"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                  <figcaption>{{ item.name || '产品图' }}</figcaption>
                </figure>
                <p v-if="!products.length">把图片拖入产品图区。</p>
              </div>
              <span class="ccp-reference-summary">参考图 · {{ references.length }}</span>
              <div
                class="ccp-mini-references"
                :class="{ 'zone-active': activeLayerDropZone === 'references' }"
                @dragover.stop.prevent="enterLayerDropZone('references', $event)"
                @dragleave="leaveLayerDropZone('references', $event)"
                @drop.stop.prevent="dropIntoLayerZone('references')"
              >
                <div
                  v-for="(reference, index) in references"
                  :key="reference.id"
                  class="ccp-mini-reference ccp-draggable-layer"
                  :class="{
                    dragging: draggedLayerIndex === productLayerCount + index,
                    'drag-target':
                      dragTargetIndex === productLayerCount + index &&
                      draggedLayerIndex !== productLayerCount + index,
                  }"
                  draggable="true"
                  title="拖到产品图区空白处可移入，拖到图片上可交换"
                  @dragstart="beginLayerDrag(productLayerCount + index, $event)"
                  @dragenter.prevent="enterLayerDropTarget(productLayerCount + index)"
                  @dragover.prevent
                  @drop.stop.prevent="swapLayerPositions(productLayerCount + index, $event)"
                  @dragend="resetLayerDrag"
                >
                  <img :src="reference.url" alt="" />
                  <button
                    type="button"
                    class="ccp-layer-remove compact"
                    :aria-label="`删除${reference.name || '参考图'}`"
                    title="删除图片"
                    draggable="false"
                    @pointerdown.stop
                    @click.stop="removeCreationLayer(productLayerCount + index)"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                </div>
                <span v-if="!references.length" class="ccp-mini-empty">暂无参考图</span>
              </div>
            </div>
            <div class="ccp-demand-fields">
              <label>
                <span>产品信息</span>
                <textarea
                  v-model="detailProductInfo"
                  rows="4"
                  placeholder="填写产品的品类、材质、功能、卖点、规格、适用人群和使用场景。"
                />
              </label>
              <div class="ccp-detail-options">
                <label>
                  <span>分屏数量</span>
                  <select v-model="detailCount">
                    <option :value="3">3 屏</option>
                    <option :value="6">6 屏</option>
                    <option :value="8">8 屏</option>
                    <option :value="10">10 屏</option>
                    <option :value="12">12 屏</option>
                  </select>
                </label>
                <label>
                  <span>参考强度</span>
                  <select v-model="detailStrength">
                    <option value="light">轻度</option>
                    <option value="balanced">均衡</option>
                    <option value="strong">强化</option>
                  </select>
                </label>
                <label>
                  <span>整体风格</span>
                  <input v-model="detailStyle" type="text" />
                </label>
                <button type="button" :disabled="!canPlanDetail" @click="planDetail">
                  {{
                    detailPlanning
                      ? '正在规划分屏…'
                      : detailScreens.length
                        ? '重新规划'
                        : '规划详情页'
                  }}
                </button>
              </div>
              <p class="ccp-detail-help">
                不选参考图时按产品信息原生规划；选择参考图时逐屏借鉴版式、构图和视觉节奏。
              </p>
              <p v-if="detailError" class="ccp-error">{{ detailError }}</p>
              <p v-if="detailNotice" class="ccp-notice">{{ detailNotice }}</p>
            </div>
          </div>

          <div v-if="detailScreens.length" class="ccp-detail-screens">
            <label
              v-for="screen in detailScreens"
              :key="screen.id"
              class="ccp-detail-screen"
              :class="{ selected: screen.selected }"
            >
              <input v-model="screen.selected" type="checkbox" />
              <span class="ccp-screen-index">第 {{ screen.index }} 屏</span>
              <input v-model="screen.title" class="ccp-card-title" type="text" />
              <textarea v-model="screen.copy" rows="2" aria-label="分屏文案" />
              <textarea v-model="screen.visual" rows="3" aria-label="分屏视觉方向" />
              <small>{{ screen.goal }}</small>
            </label>
          </div>
          <div v-else class="ccp-demand-empty">
            <i class="ri-pages-line"></i>
            <b>先规划，再一次生成整套详情页</b>
            <span>每一屏都有独立职责、文案、视觉方向和产品一致性约束。</span>
          </div>
        </template>

        <footer>
          <span v-if="tab === 'main'">
            {{
              mainAnalyzing
                ? mainAnalysisStatus
                : `${model} · ${resolution} · ${references.length || 0} 张结果`
            }}
          </span>
          <span v-else-if="tab === 'demand'">
            {{ model }} · {{ resolution }} · 已选择 {{ selectedDemandCards.length }} 个方向
          </span>
          <span v-else>
            {{ model }} · {{ resolution }} · 已选择 {{ selectedDetailScreens.length }} 屏
          </span>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
          <button
            v-if="tab === 'main'"
            type="button"
            class="primary"
            :disabled="!canRunMain"
            @click="runMainImages"
          >
            {{ mainAnalyzing ? '正在反推风格…' : busy ? '正在提交…' : '开始生成' }}
          </button>
          <button
            v-else-if="tab === 'demand'"
            type="button"
            class="primary"
            :disabled="!canRunDemands"
            @click="runDemands"
          >
            {{ busy ? '正在提交…' : `生成 ${selectedDemandCards.length} 张创意` }}
          </button>
          <button v-else type="button" class="primary" :disabled="!canRunDetail" @click="runDetail">
            {{ busy ? '正在提交…' : `生成 ${selectedDetailScreens.length} 屏详情页` }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ccp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10030;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--canvas-workspace) 76%, transparent);
  backdrop-filter: blur(5px);
}
.ccp-panel {
  width: min(900px, 96vw);
  max-height: 90vh;
  overflow: auto;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 18px;
  background: var(--canvas-panel);
  color: var(--canvas-text);
  box-shadow: var(--canvas-panel-shadow);
  color-scheme: inherit;
}
.ccp-panel > header,
.ccp-panel > footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
}
.ccp-panel > header {
  justify-content: space-between;
  border-bottom: 1px solid var(--canvas-border);
}
.ccp-panel h2 {
  margin: 0;
  font-size: 18px;
}
.ccp-panel header p {
  margin: 4px 0 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
}
.ccp-panel header button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: var(--canvas-surface);
  color: var(--canvas-text-muted);
  font-size: 22px;
  cursor: pointer;
}
.ccp-panel header button:hover {
  background: var(--canvas-surface-hover);
  color: var(--canvas-text);
}
.ccp-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 20px 0;
}
.ccp-tabs button {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--canvas-text-muted);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.ccp-tabs button.active {
  background: var(--canvas-accent-soft);
  color: var(--canvas-accent);
}
.ccp-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 18px 20px 8px;
}
.ccp-mode-grid label {
  position: relative;
  display: flex;
  min-height: 84px;
  flex-direction: column;
  gap: 5px;
  padding: 13px 14px 13px 40px;
  border: 1px solid var(--canvas-border);
  border-radius: 13px;
  cursor: pointer;
}
.ccp-mode-grid label.active {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
  box-shadow: 0 0 0 2px var(--canvas-accent-soft);
}
.ccp-mode-grid input {
  position: absolute;
  top: 15px;
  left: 14px;
  accent-color: var(--canvas-accent);
}
.ccp-mode-grid b {
  font-size: 14px;
}
.ccp-mode-grid span,
.ccp-selection p {
  margin: 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
  line-height: 1.5;
}
.ccp-analysis-settings {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 12px;
  margin: 0 20px 4px;
  padding: 8px 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 10px;
  background: var(--canvas-surface);
}
.ccp-analysis-settings label {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}
.ccp-analysis-settings label > span {
  color: var(--canvas-text-muted);
  font-size: 11px;
  font-weight: 700;
}
.ccp-analysis-settings select {
  height: 30px;
  min-width: 110px;
  padding: 0 28px 0 9px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  background: var(--canvas-input);
  color: var(--canvas-text);
  font: inherit;
  font-size: 12px;
}
.ccp-analysis-settings > span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--canvas-text-subtle);
  font-size: 11px;
  line-height: 1.4;
}
.ccp-analysis-settings > span i {
  flex: 0 0 auto;
  color: var(--canvas-accent);
  font-size: 14px;
}
.ccp-main-error {
  margin: 5px 20px 0;
  color: #d14343;
  font-size: 12px;
  line-height: 1.5;
}
.ccp-selection {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 14px;
  padding: 12px 20px;
}
.ccp-selection > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--canvas-border);
  border-radius: 12px;
  background: var(--canvas-surface);
}
.ccp-layer-zone,
.ccp-detail-product-zone,
.ccp-mini-references {
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}
.ccp-layer-zone.zone-active,
.ccp-detail-product-zone.zone-active,
.ccp-mini-references.zone-active {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
  box-shadow: inset 0 0 0 1px var(--canvas-accent);
}
.ccp-selection > div > span,
.ccp-extra > span {
  display: block;
  margin-bottom: 9px;
  color: var(--canvas-text-muted);
  font-size: 12px;
  font-weight: 700;
}
.ccp-product-list,
.ccp-reference-list {
  display: flex;
  min-height: 116px;
  align-items: flex-start;
  gap: 8px;
  overflow-x: auto;
}
.ccp-product-list > p,
.ccp-reference-list > p {
  align-self: center;
}
.ccp-selection figure {
  position: relative;
  width: 96px;
  flex: 0 0 96px;
  margin: 0;
}
.ccp-draggable-layer {
  cursor: grab;
  transition:
    opacity 140ms ease,
    transform 140ms ease,
    box-shadow 140ms ease;
}
.ccp-draggable-layer:active {
  cursor: grabbing;
}
.ccp-draggable-layer.dragging {
  opacity: 0.42;
  transform: scale(0.97);
}
.ccp-draggable-layer.drag-target {
  border-radius: 9px;
  box-shadow: 0 0 0 2px var(--canvas-accent);
}
.ccp-layer-remove {
  position: absolute;
  z-index: 2;
  top: 5px;
  right: 5px;
  display: grid;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 50%;
  background: rgba(16, 20, 26, 0.72);
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.84;
}
.ccp-layer-remove:hover,
.ccp-layer-remove:focus-visible {
  background: #d14343;
  opacity: 1;
}
.ccp-layer-remove.compact {
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  font-size: 12px;
}
.ccp-selection img {
  width: 96px;
  height: 96px;
  border-radius: 9px;
  background: var(--canvas-surface-hover);
  object-fit: cover;
}
.ccp-selection figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: var(--canvas-text-subtle);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-extra {
  display: block;
  padding: 8px 20px 18px;
}
.ccp-extra small {
  color: var(--canvas-text-subtle);
  font-weight: 400;
}
.ccp-extra textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--canvas-border);
  border-radius: 11px;
  background: var(--canvas-input);
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.ccp-demand-input {
  display: grid;
  grid-template-columns: 142px 1fr;
  gap: 16px;
  padding: 18px 20px 12px;
}
.ccp-product-thumb,
.ccp-demand-fields {
  min-width: 0;
}
.ccp-product-thumb > span,
.ccp-demand-fields label > span {
  display: block;
  margin-bottom: 7px;
  color: var(--canvas-text-muted);
  font-size: 12px;
  font-weight: 700;
}
.ccp-product-thumb figure {
  position: relative;
  width: 126px;
  margin: 0;
}
.ccp-detail-product-zone {
  display: flex;
  min-width: 0;
  min-height: 150px;
  gap: 5px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 12px;
  overflow-x: auto;
}
.ccp-detail-product-zone figure {
  width: 54px;
  flex: 0 0 54px;
}
.ccp-product-thumb .ccp-detail-product-zone img {
  width: 54px;
  height: 72px;
  border-radius: 7px;
}
.ccp-product-thumb img {
  width: 126px;
  height: 126px;
  border-radius: 12px;
  background: var(--canvas-surface-hover);
  object-fit: cover;
}
.ccp-product-thumb figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: var(--canvas-text-subtle);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-product-thumb p,
.ccp-error {
  margin: 0;
  color: #d14343;
  font-size: 12px;
  line-height: 1.5;
}
.ccp-reference-summary {
  display: block;
  margin-top: 14px;
  color: var(--canvas-text-muted);
  font-size: 11px;
  font-weight: 700;
}
.ccp-mini-references {
  display: flex;
  min-height: 50px;
  gap: 5px;
  margin-top: 7px;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  overflow-x: auto;
}
.ccp-mini-empty {
  align-self: center;
  color: var(--canvas-text-subtle);
  font-size: 10px;
}
.ccp-mini-reference {
  position: relative;
  width: 34px;
  height: 46px;
  flex: 0 0 34px;
  overflow: hidden;
  border-radius: 6px;
}
.ccp-mini-reference img {
  width: 34px;
  height: 46px;
  background: var(--canvas-surface-hover);
  object-fit: cover;
}
.ccp-demand-fields textarea,
.ccp-demand-fields input,
.ccp-demand-fields select,
.ccp-demand-card textarea,
.ccp-card-title {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--canvas-border);
  border-radius: 9px;
  background: var(--canvas-input);
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.ccp-demand-fields textarea,
.ccp-demand-card textarea {
  resize: vertical;
  padding: 9px 10px;
  line-height: 1.45;
}
.ccp-demand-fields > div {
  display: grid;
  grid-template-columns: 110px minmax(180px, 1fr) auto;
  gap: 9px;
  align-items: end;
  margin-top: 9px;
}
.ccp-demand-fields > .ccp-detail-options {
  grid-template-columns: 88px 92px minmax(150px, 1fr) auto;
}
.ccp-demand-fields input,
.ccp-demand-fields select {
  height: 36px;
  padding: 0 9px;
}
.ccp-demand-fields button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 9px;
  background: var(--canvas-surface);
  color: var(--canvas-accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ccp-demand-fields button:hover:not(:disabled) {
  border-color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.ccp-demand-fields button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.ccp-error {
  margin-top: 8px;
}
.ccp-notice {
  margin: 8px 0 0;
  color: var(--canvas-text-muted);
  font-size: 11px;
  line-height: 1.5;
}
.ccp-detail-help {
  margin: 8px 0 0;
  color: var(--canvas-text-subtle);
  font-size: 10.5px;
  line-height: 1.5;
}
.ccp-demand-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-height: 390px;
  overflow-y: auto;
  padding: 8px 20px 18px;
}
.ccp-demand-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  padding: 12px;
  border: 1px solid var(--canvas-border);
  border-radius: 12px;
  background: var(--canvas-surface);
}
.ccp-demand-card.selected {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}
.ccp-demand-card > input[type='checkbox'] {
  position: absolute;
  top: 12px;
  right: 12px;
  accent-color: var(--canvas-accent);
}
.ccp-dimension {
  align-self: flex-start;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--canvas-accent-soft);
  color: var(--canvas-accent);
  font-size: 10px;
  font-weight: 700;
}
.ccp-card-title {
  height: 34px;
  padding: 0 9px;
  font-weight: 700;
}
.ccp-demand-card small {
  overflow: hidden;
  color: var(--canvas-text-subtle);
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-detail-screens {
  display: flex;
  gap: 10px;
  max-height: 390px;
  overflow: auto;
  padding: 8px 20px 18px;
}
.ccp-detail-screen {
  position: relative;
  display: flex;
  width: 190px;
  flex: 0 0 190px;
  flex-direction: column;
  gap: 7px;
  padding: 12px;
  border: 1px solid var(--canvas-border);
  border-radius: 12px;
  background: var(--canvas-surface);
}
.ccp-detail-screen.selected {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}
.ccp-detail-screen > input[type='checkbox'] {
  position: absolute;
  top: 12px;
  right: 12px;
  accent-color: var(--canvas-accent);
}
.ccp-detail-screen textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 9px 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 9px;
  background: var(--canvas-input);
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
}
.ccp-detail-screen small {
  overflow: hidden;
  color: var(--canvas-text-subtle);
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-screen-index {
  align-self: flex-start;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
  color: var(--color-success);
  font-size: 10px;
  font-weight: 700;
}
.ccp-demand-empty {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px 22px;
  color: var(--canvas-text-subtle);
  text-align: center;
}
.ccp-demand-empty i {
  color: var(--canvas-accent);
  font-size: 34px;
}
.ccp-demand-empty b {
  color: var(--canvas-text-muted);
  font-size: 13px;
}
.ccp-demand-empty span {
  font-size: 11px;
}
.ccp-panel > footer {
  justify-content: flex-end;
  border-top: 1px solid var(--canvas-border);
  background: var(--canvas-surface);
}
.ccp-panel footer > span {
  margin-right: auto;
  color: var(--canvas-text-subtle);
  font-size: 11px;
}
.ccp-panel footer button {
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  cursor: pointer;
}
.ccp-panel footer .secondary {
  border: 1px solid var(--canvas-border-strong);
  background: var(--canvas-panel);
  color: var(--canvas-text-muted);
}
.ccp-panel footer .primary {
  border: 1px solid var(--canvas-accent);
  background: var(--canvas-accent);
  color: var(--color-text-inverse);
  font-weight: 700;
}
.ccp-panel footer button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (max-width: 680px) {
  .ccp-mode-grid,
  .ccp-selection,
  .ccp-demand-input,
  .ccp-demand-cards,
  .ccp-detail-screens,
  .ccp-demand-fields > div {
    grid-template-columns: 1fr;
  }
  .ccp-analysis-settings {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

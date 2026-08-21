<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import ThemedSelect from '../components/common/ThemedSelect.vue'
import SelectionProductEditor from '../components/selection/SelectionProductEditor.vue'
import { useTheme } from '../composables/useTheme'
import { useUserStore } from '../stores/user'
import {
  assignSelectionTags,
  createSelectionProduct,
  deleteSelectionProducts,
  fetchMigrationTasks,
  fetchSelectionProduct,
  fetchSelectionProducts,
  fetchSelectionTags,
  updateSelectionProduct,
} from '../utils/selectionPoolApi'

const router = useRouter()
const userStore = useUserStore()
const { cycle: cycleTheme, isDark } = useTheme()

const pageSize = 20
const products = ref([])
const tags = ref([])
const migrationTasks = ref([])
const selectedIds = ref(new Set())
const loading = ref(false)
const refreshing = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const page = ref(1)
const total = ref(0)
const detailProduct = ref(null)
const detailLoading = ref(false)
const detailSaving = ref(false)
const taskDialogOpen = ref(false)
const tagDialogOpen = ref(false)
const manualDialogOpen = ref(false)
const activeTagIds = ref(new Set())
const toast = ref({ visible: false, type: 'success', message: '' })
let toastTimer = null

const filters = reactive({
  keyword: '',
  platform: '',
  collectStatus: '',
  publishStatus: '',
  tagId: '',
})

const manualForm = reactive({
  title: '',
  sourcePlatform: 'LOCAL',
  sourceProductId: '',
  sourceUrl: '',
  coverImageUrl: '',
})

const platformOptions = [
  { value: '', label: '全部平台' },
  { value: 'TAOBAO', label: '淘宝' },
  { value: 'TMALL', label: '天猫' },
  { value: '1688', label: '1688' },
  { value: 'DOUYIN', label: '抖音' },
  { value: 'JD', label: '京东' },
  { value: 'LOCAL', label: '自定义' },
]

const collectOptions = [
  { value: '', label: '全部采集状态' },
  { value: 'COLLECTED', label: '已采集' },
  { value: 'COLLECTING', label: '采集中' },
  { value: 'FAILED', label: '采集失败' },
]

const publishOptions = [
  { value: '', label: '全部搬家状态' },
  { value: 'UNPUBLISHED', label: '待搬家' },
  { value: 'QUEUED', label: '等待接管' },
  { value: 'PUBLISHING', label: '发布中' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'FAILED', label: '发布失败' },
]

const collectLabels = {
  COLLECTED: '已采集',
  COLLECTING: '采集中',
  FAILED: '采集失败',
}

const publishLabels = {
  UNPUBLISHED: '待搬家',
  QUEUED: '等待接管',
  PUBLISHING: '发布中',
  PUBLISHED: '已发布',
  FAILED: '发布失败',
}

const taskLabels = {
  QUEUED: '等待接管',
  PUBLISHING: '发布中',
  COMPLETED: '已完成',
  PARTIAL: '部分完成',
  FAILED: '失败',
}

const accountLabel = computed(
  () =>
    userStore.profile?.nickname ||
    userStore.profile?.name ||
    userStore.profile?.account ||
    '当前账号',
)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const selectedCount = computed(() => selectedIds.value.size)
const allCurrentSelected = computed(
  () => products.value.length > 0 && products.value.every((item) => selectedIds.value.has(item.id)),
)
const collectedCount = computed(
  () => products.value.filter((item) => item.collectStatus === 'COLLECTED').length,
)
const pendingMigrationCount = computed(
  () =>
    migrationTasks.value.filter((item) => ['QUEUED', 'PUBLISHING'].includes(item.status)).length,
)
const filtered = computed(() =>
  Boolean(
    filters.keyword ||
    filters.platform ||
    filters.collectStatus ||
    filters.publishStatus ||
    filters.tagId,
  ),
)
const currentTagOptions = computed(() => [
  { value: '', label: '全部标签' },
  ...tags.value.map((tag) => ({ value: tag.id, label: tag.name })),
])
const manualPlatformOptions = computed(() => platformOptions.filter((option) => option.value))

function showToast(message, type = 'success') {
  if (toastTimer) window.clearTimeout(toastTimer)
  toast.value = { visible: true, type, message }
  toastTimer = window.setTimeout(() => {
    toast.value.visible = false
  }, 2800)
}

function unwrapProductData(product) {
  const data = product?.productData
  return data && typeof data === 'object' ? data : {}
}

function productImages(product) {
  const data = unwrapProductData(product)
  const candidates = [
    product?.coverImageUrl,
    ...(Array.isArray(data.media?.mainImages) ? data.media.mainImages : []),
    ...(Array.isArray(data.images) ? data.images : []),
    ...(Array.isArray(data.mainImages) ? data.mainImages : []),
  ]
  return [...new Set(candidates.filter((url) => /^https?:\/\//i.test(String(url || ''))))]
}

function productMeta(product) {
  const data = unwrapProductData(product)
  const skuGroups = data.skuGroups?.length || data.specGroups?.length || 0
  const skus = data.skus?.length || data.skuList?.length || 0
  const category = data.category?.name || data.categoryName || ''
  return [
    product.sourceProductId ? `ID ${product.sourceProductId}` : '自定义商品',
    category,
    `${skuGroups} 组规格 / ${skus} 个 SKU`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function platformName(value) {
  return platformOptions.find((option) => option.value === value)?.label || value || '--'
}

function statusTone(value) {
  if (['COLLECTED', 'PUBLISHED', 'COMPLETED'].includes(value)) return 'success'
  if (value === 'QUEUED') return 'queued'
  if (['COLLECTING', 'PUBLISHING'].includes(value)) return 'working'
  if (['FAILED', 'PARTIAL'].includes(value)) return 'danger'
  return 'muted'
}

function formatTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

async function loadData({ reset = false, quiet = false } = {}) {
  if (reset) {
    page.value = 1
    selectedIds.value = new Set()
  }
  if (quiet) refreshing.value = true
  else loading.value = true
  errorMessage.value = ''
  try {
    const [productResult, tagResult, taskResult] = await Promise.allSettled([
      fetchSelectionProducts(userStore, {
        ...filters,
        page: page.value,
        pageSize,
      }),
      fetchSelectionTags(userStore),
      fetchMigrationTasks(userStore),
    ])
    if (productResult.status === 'rejected') throw productResult.reason

    const productPage = productResult.value
    const tagList = tagResult.status === 'fulfilled' ? tagResult.value : []
    const tasks = taskResult.status === 'fulfilled' ? taskResult.value : []
    products.value = productPage?.items || []
    total.value = Number(productPage?.total || 0)
    tags.value = tagList || []
    migrationTasks.value = tasks || []
  } catch (error) {
    errorMessage.value = error?.message || '选品库加载失败'
    products.value = []
    total.value = 0
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function applyFilters() {
  void loadData({ reset: true })
}

function resetFilters() {
  Object.assign(filters, {
    keyword: '',
    platform: '',
    collectStatus: '',
    publishStatus: '',
    tagId: '',
  })
  void loadData({ reset: true })
}

function toggleSelect(id) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAll() {
  const next = new Set(selectedIds.value)
  if (allCurrentSelected.value) products.value.forEach((item) => next.delete(item.id))
  else products.value.forEach((item) => next.add(item.id))
  selectedIds.value = next
}

function changePage(nextPage) {
  if (nextPage < 1 || nextPage > pageCount.value || nextPage === page.value) return
  page.value = nextPage
  selectedIds.value = new Set()
  void loadData()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function openProduct(product) {
  detailProduct.value = product
  detailLoading.value = true
  try {
    detailProduct.value = (await fetchSelectionProduct(userStore, product.id)) || product
  } catch (error) {
    showToast(error?.message || '商品详情加载失败', 'error')
  } finally {
    detailLoading.value = false
  }
}

async function saveProductEdits({ payload, afterSave }) {
  if (!detailProduct.value || detailSaving.value) return
  detailSaving.value = true
  try {
    const saved = await updateSelectionProduct(userStore, detailProduct.value.id, payload)
    showToast('商品资料已保存')
    await loadData({ quiet: true })
    detailProduct.value = null
    if (afterSave === 'canvas') sendToCanvas(saved)
  } catch (error) {
    showToast(error?.message || '商品资料保存失败', 'error')
  } finally {
    detailSaving.value = false
  }
}

function openTags() {
  const selectedProducts = products.value.filter((item) => selectedIds.value.has(item.id))
  activeTagIds.value = new Set(
    tags.value
      .filter(
        (tag) =>
          selectedProducts.length > 0 &&
          selectedProducts.every((product) => product.tags?.some((item) => item.id === tag.id)),
      )
      .map((tag) => tag.id),
  )
  tagDialogOpen.value = true
}

function toggleTag(id) {
  const next = new Set(activeTagIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  activeTagIds.value = next
}

async function saveTags() {
  if (!selectedCount.value || actionLoading.value) return
  actionLoading.value = true
  try {
    await assignSelectionTags(userStore, [...selectedIds.value], [...activeTagIds.value])
    tagDialogOpen.value = false
    showToast('商品标签已更新')
    await loadData({ quiet: true })
  } catch (error) {
    showToast(error?.message || '标签更新失败', 'error')
  } finally {
    actionLoading.value = false
  }
}

async function removeSelected() {
  if (!selectedCount.value || actionLoading.value) return
  if (!window.confirm(`确定把选中的 ${selectedCount.value} 个商品移入回收站吗？`)) return
  actionLoading.value = true
  try {
    await deleteSelectionProducts(userStore, [...selectedIds.value])
    selectedIds.value = new Set()
    showToast('商品已移入回收站')
    await loadData({ quiet: true })
  } catch (error) {
    showToast(error?.message || '删除失败', 'error')
  } finally {
    actionLoading.value = false
  }
}

function openManualDialog() {
  Object.assign(manualForm, {
    title: '',
    sourcePlatform: 'LOCAL',
    sourceProductId: `local-${Date.now()}`,
    sourceUrl: '',
    coverImageUrl: '',
  })
  manualDialogOpen.value = true
}

async function saveManualProduct() {
  if (!manualForm.title.trim() || actionLoading.value) return
  actionLoading.value = true
  try {
    await createSelectionProduct(userStore, {
      sourcePlatform: manualForm.sourcePlatform,
      sourceProductId: manualForm.sourceProductId.trim() || `local-${Date.now()}`,
      sourceUrl: manualForm.sourceUrl.trim() || null,
      title: manualForm.title.trim(),
      coverImageUrl: manualForm.coverImageUrl.trim() || null,
      collectSource: 'MANUAL',
      collectStatus: 'COLLECTED',
      productData: {
        productType: 'CUSTOM',
        title: manualForm.title.trim(),
        coverImageUrl: manualForm.coverImageUrl.trim(),
        media: {
          mainImages: manualForm.coverImageUrl.trim() ? [manualForm.coverImageUrl.trim()] : [],
          portraitImages: [],
          skuImages: [],
          detailImages: [],
          mainVideos: [],
          detailVideos: [],
        },
      },
      rawSnapshot: {},
    })
    manualDialogOpen.value = false
    showToast('商品已加入选品库')
    await loadData({ reset: true, quiet: true })
  } catch (error) {
    showToast(error?.message || '手工入库失败', 'error')
  } finally {
    actionLoading.value = false
  }
}

function openBatchCollection() {
  showToast('批量采集请在有米搬家插件中执行，采集结果会自动同步到这里', 'info')
}

function prepareMigration() {
  showToast('已选商品会在下一步接入搬家发布流程', 'info')
}

function sendToCanvas(product) {
  window.sessionStorage.setItem(
    'youmi:selection-product-draft',
    JSON.stringify({
      productRowId: product.id,
      title: product.title,
      images: productImages(product),
      productData: product.productData || {},
    }),
  )
  showToast('商品资料已准备好，下一步将接入画布加工流程', 'info')
}

onMounted(() => {
  if (!userStore.isAuthenticated) userStore.restoreSession()
  void loadData()
})
</script>

<template>
  <main class="selection-page">
    <header class="selection-header">
      <button class="secondary-button back-button" type="button" @click="router.push('/')">
        <i class="ri-arrow-left-line" aria-hidden="true"></i>
        返回首页
      </button>

      <div class="selection-title">
        <span>PRODUCT LIBRARY</span>
        <h1>选品库</h1>
        <p>统一管理采集商品、图片素材和搬家任务</p>
      </div>

      <div class="header-actions">
        <span class="account-chip">
          <i class="ri-user-3-line"></i>
          {{ accountLabel }}
        </span>
        <button class="secondary-button" type="button" @click="taskDialogOpen = true">
          <i class="ri-inbox-archive-line"></i>
          待发布任务
          <span v-if="pendingMigrationCount">（{{ pendingMigrationCount }}）</span>
        </button>
        <button
          class="icon-button"
          type="button"
          :title="isDark() ? '开灯' : '关灯'"
          :aria-label="isDark() ? '开灯' : '关灯'"
          @click="cycleTheme"
        >
          <i :class="isDark() ? 'ri-sun-line' : 'ri-moon-line'"></i>
        </button>
        <button
          class="secondary-button"
          type="button"
          :disabled="refreshing"
          @click="loadData({ quiet: true })"
        >
          <i :class="refreshing ? 'ri-loader-4-line spinning' : 'ri-refresh-line'"></i>
          刷新
        </button>
        <button class="secondary-button" type="button" @click="openBatchCollection">
          <i class="ri-links-line"></i>
          批量采集
        </button>
        <button class="primary-button" type="button" @click="openManualDialog">
          <i class="ri-add-line"></i>
          手工入库
        </button>
      </div>
    </header>

    <section v-if="pendingMigrationCount" class="task-notice">
      <i class="ri-notification-3-line" aria-hidden="true"></i>
      <div>
        <strong>有 {{ pendingMigrationCount }} 个云端搬家任务等待处理</strong>
        <span>发布浏览器接管后，会把结果同步回选品库。</span>
      </div>
      <button type="button" @click="taskDialogOpen = true">查看任务</button>
    </section>

    <section class="metric-grid" aria-label="选品库概览">
      <article>
        <span class="metric-icon is-cyan"><i class="ri-archive-stack-line"></i></span>
        <div>
          <small>商品总数</small>
          <strong>{{ total }}</strong>
          <p>当前账号云端资产</p>
        </div>
      </article>
      <article>
        <span class="metric-icon is-green"><i class="ri-checkbox-circle-line"></i></span>
        <div>
          <small>本页已采集</small>
          <strong>{{ collectedCount }}</strong>
          <p>资料可继续整理</p>
        </div>
      </article>
      <article>
        <span class="metric-icon is-amber"><i class="ri-truck-line"></i></span>
        <div>
          <small>待发布任务</small>
          <strong>{{ pendingMigrationCount }}</strong>
          <p>等待搬家端处理</p>
        </div>
      </article>
      <article>
        <span class="metric-icon is-violet"><i class="ri-checkbox-multiple-line"></i></span>
        <div>
          <small>本次已选择</small>
          <strong>{{ selectedCount }}</strong>
          <p>最多处理本页商品</p>
        </div>
      </article>
    </section>

    <section class="library-panel">
      <form class="filter-bar" @submit.prevent="applyFilters">
        <label class="search-field">
          <i class="ri-search-line"></i>
          <input v-model="filters.keyword" type="search" placeholder="搜索标题或商品 ID" />
          <button
            v-if="filters.keyword"
            type="button"
            title="清空搜索"
            aria-label="清空搜索"
            @click="filters.keyword = ''"
          >
            <i class="ri-close-line"></i>
          </button>
        </label>
        <ThemedSelect
          v-model="filters.platform"
          class="filter-select"
          :options="platformOptions"
          aria-label="平台筛选"
        />
        <ThemedSelect
          v-model="filters.collectStatus"
          class="filter-select"
          :options="collectOptions"
          aria-label="采集状态筛选"
        />
        <ThemedSelect
          v-model="filters.publishStatus"
          class="filter-select"
          :options="publishOptions"
          aria-label="搬家状态筛选"
        />
        <ThemedSelect
          v-model="filters.tagId"
          class="filter-select"
          :options="currentTagOptions"
          aria-label="标签筛选"
        />
        <button class="filter-button" type="submit">
          <i class="ri-equalizer-line"></i>
          筛选
        </button>
        <button v-if="filtered" class="reset-button" type="button" @click="resetFilters">
          重置
        </button>
      </form>

      <div class="batch-bar">
        <label class="select-all">
          <input type="checkbox" :checked="allCurrentSelected" @change="toggleSelectAll" />
          <span>{{ selectedCount ? `已选择 ${selectedCount} 个商品` : '全选本页' }}</span>
        </label>
        <div>
          <button type="button" :disabled="!selectedCount" @click="openTags">
            <i class="ri-price-tag-3-line"></i>
            设置标签
          </button>
          <button type="button" :disabled="!selectedCount" @click="removeSelected">
            <i class="ri-delete-bin-6-line"></i>
            移入回收站
          </button>
          <button
            class="batch-primary"
            type="button"
            :disabled="!selectedCount"
            @click="prepareMigration"
          >
            <i class="ri-truck-line"></i>
            开始搬家
          </button>
        </div>
      </div>

      <div v-if="loading" class="state-panel">
        <i class="ri-loader-4-line spinning"></i>
        <strong>正在读取选品库</strong>
        <span>正在同步商品和搬家任务</span>
      </div>

      <div v-else-if="errorMessage" class="state-panel is-error">
        <i class="ri-server-line"></i>
        <strong>选品库暂时没有连上</strong>
        <span>{{ errorMessage }}</span>
        <button type="button" @click="loadData">重新连接</button>
      </div>

      <div v-else-if="!products.length" class="state-panel">
        <i class="ri-archive-drawer-line"></i>
        <strong>{{ filtered ? '没有符合条件的商品' : '选品库还是空的' }}</strong>
        <span>
          {{ filtered ? '可以调整筛选条件后再试' : '可以从搬家插件采集，或先手工创建一个商品' }}
        </span>
        <button type="button" @click="filtered ? resetFilters() : openManualDialog()">
          {{ filtered ? '清空筛选' : '手工入库' }}
        </button>
      </div>

      <div v-else class="table-scroll">
        <table class="product-table">
          <thead>
            <tr>
              <th aria-label="选择"></th>
              <th>商品</th>
              <th>来源</th>
              <th>标签</th>
              <th>资料质量</th>
              <th>采集状态</th>
              <th>搬家状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="product in products"
              :key="product.id"
              :class="{ selected: selectedIds.has(product.id) }"
            >
              <td>
                <input
                  type="checkbox"
                  :checked="selectedIds.has(product.id)"
                  @change="toggleSelect(product.id)"
                />
              </td>
              <td>
                <button class="product-cell" type="button" @click="openProduct(product)">
                  <span class="product-cover">
                    <img
                      v-if="productImages(product)[0]"
                      :src="productImages(product)[0]"
                      alt=""
                      loading="lazy"
                    />
                    <i v-else class="ri-image-line"></i>
                  </span>
                  <span>
                    <strong :title="product.title">{{ product.title }}</strong>
                    <small>{{ productMeta(product) }}</small>
                  </span>
                </button>
              </td>
              <td>
                <span class="platform-pill">{{ platformName(product.sourcePlatform) }}</span>
                <a
                  v-if="product.sourceUrl"
                  :href="product.sourceUrl"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看原商品 ↗
                </a>
              </td>
              <td>
                <div v-if="product.tags?.length" class="tag-list">
                  <span
                    v-for="tag in product.tags"
                    :key="tag.id"
                    :style="{ '--tag-color': tag.color }"
                  >
                    {{ tag.name }}
                  </span>
                </div>
                <span v-else class="muted-text">未分类</span>
              </td>
              <td>
                <div class="quality-meter">
                  <span><i :style="{ width: `${Number(product.qualityScore) || 0}%` }"></i></span>
                  <strong>{{ Number(product.qualityScore) || 0 }}</strong>
                </div>
              </td>
              <td>
                <span class="status-pill" :class="`is-${statusTone(product.collectStatus)}`">
                  {{ collectLabels[product.collectStatus] || product.collectStatus }}
                </span>
              </td>
              <td>
                <span class="status-pill" :class="`is-${statusTone(product.publishStatus)}`">
                  {{ publishLabels[product.publishStatus] || product.publishStatus }}
                </span>
              </td>
              <td>
                <time>{{ formatTime(product.updatedAt) }}</time>
              </td>
              <td>
                <button class="table-action" type="button" @click="openProduct(product)">
                  编辑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !errorMessage && products.length" class="pagination">
        <span>共 {{ total }} 条</span>
        <div>
          <button type="button" :disabled="page <= 1" @click="changePage(page - 1)">上一页</button>
          <strong>{{ page }} / {{ pageCount }}</strong>
          <button type="button" :disabled="page >= pageCount" @click="changePage(page + 1)">
            下一页
          </button>
        </div>
      </footer>
    </section>

    <SelectionProductEditor
      v-if="detailProduct"
      :product="detailProduct"
      :loading="detailLoading"
      :saving="detailSaving"
      @close="detailProduct = null"
      @save="saveProductEdits"
    />

    <div v-if="taskDialogOpen" class="dialog-backdrop" @mousedown.self="taskDialogOpen = false">
      <section
        class="standard-dialog task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
      >
        <header>
          <div>
            <span>发布队列</span>
            <h2 id="task-dialog-title">待发布任务</h2>
          </div>
          <button type="button" @click="taskDialogOpen = false">
            <i class="ri-close-line"></i>
          </button>
        </header>
        <div class="task-list">
          <article v-for="task in migrationTasks" :key="task.taskId">
            <span class="task-platform"><i class="ri-truck-line"></i></span>
            <div>
              <strong>
                {{ platformName(task.targetPlatform) }} · {{ task.totalCount }} 个商品
              </strong>
              <small>{{ formatTime(task.createdAt) }}</small>
            </div>
            <span class="status-pill" :class="`is-${statusTone(task.status)}`">
              {{ taskLabels[task.status] || task.status }}
            </span>
          </article>
          <div v-if="!migrationTasks.length" class="dialog-empty">
            <i class="ri-inbox-line"></i>
            当前没有发布任务
          </div>
        </div>
      </section>
    </div>

    <div v-if="tagDialogOpen" class="dialog-backdrop" @mousedown.self="tagDialogOpen = false">
      <section
        class="standard-dialog tag-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-dialog-title"
      >
        <header>
          <div>
            <span>批量操作</span>
            <h2 id="tag-dialog-title">设置商品标签</h2>
          </div>
          <button type="button" @click="tagDialogOpen = false">
            <i class="ri-close-line"></i>
          </button>
        </header>
        <p>将标签应用到已选择的 {{ selectedCount }} 个商品。</p>
        <div class="tag-options">
          <button
            v-for="tag in tags"
            :key="tag.id"
            type="button"
            :class="{ active: activeTagIds.has(tag.id) }"
            @click="toggleTag(tag.id)"
          >
            <i class="ri-price-tag-3-line"></i>
            {{ tag.name }}
            <i v-if="activeTagIds.has(tag.id)" class="ri-check-line"></i>
          </button>
          <span v-if="!tags.length">还没有可用标签，请先在搬家端创建标签。</span>
        </div>
        <footer>
          <button type="button" @click="tagDialogOpen = false">取消</button>
          <button class="primary-button" type="button" :disabled="actionLoading" @click="saveTags">
            {{ actionLoading ? '保存中' : '保存标签' }}
          </button>
        </footer>
      </section>
    </div>

    <div v-if="manualDialogOpen" class="dialog-backdrop" @mousedown.self="manualDialogOpen = false">
      <section
        class="standard-dialog manual-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-dialog-title"
      >
        <header>
          <div>
            <span>自定义商品</span>
            <h2 id="manual-dialog-title">手工入库</h2>
          </div>
          <button type="button" @click="manualDialogOpen = false">
            <i class="ri-close-line"></i>
          </button>
        </header>
        <form @submit.prevent="saveManualProduct">
          <label class="wide-field">
            <span>商品标题 *</span>
            <input v-model="manualForm.title" required placeholder="请输入商品标题" />
          </label>
          <label>
            <span>来源平台</span>
            <ThemedSelect
              v-model="manualForm.sourcePlatform"
              :options="manualPlatformOptions"
              aria-label="来源平台"
            />
          </label>
          <label>
            <span>商品 ID</span>
            <input v-model="manualForm.sourceProductId" placeholder="不填写时自动生成" />
          </label>
          <label class="wide-field">
            <span>原商品链接</span>
            <input v-model="manualForm.sourceUrl" type="url" placeholder="https://" />
          </label>
          <label class="wide-field">
            <span>封面图片链接</span>
            <input v-model="manualForm.coverImageUrl" type="url" placeholder="https://" />
          </label>
          <footer>
            <button type="button" @click="manualDialogOpen = false">取消</button>
            <button
              class="primary-button"
              type="submit"
              :disabled="actionLoading || !manualForm.title.trim()"
            >
              {{ actionLoading ? '正在入库' : '确认入库' }}
            </button>
          </footer>
        </form>
      </section>
    </div>

    <Transition name="toast">
      <div v-if="toast.visible" class="selection-toast" :class="`is-${toast.type}`" role="status">
        <i
          :class="
            toast.type === 'error'
              ? 'ri-error-warning-line'
              : toast.type === 'info'
                ? 'ri-information-line'
                : 'ri-checkbox-circle-line'
          "
        ></i>
        {{ toast.message }}
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.selection-page {
  min-height: 100vh;
  padding: 24px clamp(18px, 3vw, 48px) 64px;
  color: var(--canvas-text);
  background: var(--canvas-workspace);
  font-size: 13px;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.selection-header {
  display: grid;
  grid-template-columns: auto minmax(220px, 1fr) auto;
  align-items: center;
  gap: 22px;
  max-width: 1720px;
  margin: 0 auto 20px;
}

.selection-title span,
.standard-dialog header span,
.product-drawer header span {
  color: var(--canvas-accent);
  font-size: 11px;
  font-weight: 600;
}

.selection-title h1 {
  margin: 2px 0 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.15;
}

.selection-title p {
  margin: 5px 0 0;
  color: var(--canvas-text-subtle);
  font-size: 13px;
}

.header-actions,
.batch-bar > div,
.pagination > div,
.standard-dialog footer,
.product-drawer footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.secondary-button,
.primary-button,
.icon-button,
.filter-button,
.reset-button,
.batch-bar button,
.pagination button,
.state-panel button,
.table-action,
.standard-dialog footer button,
.product-drawer footer a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: var(--canvas-panel);
  text-decoration: none;
  font-size: 13px;
  transition: 150ms ease;
}

.secondary-button:hover,
.icon-button:hover,
.batch-bar button:hover:not(:disabled),
.pagination button:hover:not(:disabled),
.table-action:hover,
.standard-dialog footer button:hover,
.product-drawer footer a:hover {
  color: var(--canvas-text);
  border-color: var(--canvas-border-strong);
  background: var(--canvas-surface-hover);
}

.primary-button,
.filter-button,
.batch-bar .batch-primary {
  color: #fff;
  border-color: var(--canvas-accent);
  background: var(--canvas-accent);
}

.primary-button:hover,
.filter-button:hover,
.batch-bar .batch-primary:hover:not(:disabled) {
  color: #fff;
  background: var(--canvas-accent-hover);
}

.icon-button {
  width: 34px;
  padding: 0;
  color: var(--canvas-accent);
}

.account-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 11px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 6px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-size: 12px;
  white-space: nowrap;
}

.task-notice,
.metric-grid,
.library-panel {
  max-width: 1720px;
  margin-right: auto;
  margin-left: auto;
}

.task-notice {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 7px;
  background: var(--canvas-accent-soft);
}

.task-notice > i {
  color: var(--canvas-accent);
  font-size: 20px;
}

.task-notice div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.task-notice strong {
  font-size: 13px;
  font-weight: 600;
}

.task-notice span {
  color: var(--canvas-text-muted);
  font-size: 12px;
}

.task-notice button {
  border: 0;
  color: var(--canvas-accent);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-grid article {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 84px;
  padding: 14px;
  border: 1px solid var(--canvas-border);
  border-radius: 7px;
  background: var(--canvas-panel);
}

.metric-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 7px;
  font-size: 18px;
}

.metric-icon.is-cyan {
  color: #22c3dc;
  background: rgba(34, 195, 220, 0.13);
}
.metric-icon.is-green {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}
.metric-icon.is-amber {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
.metric-icon.is-violet {
  color: #8b5cf6;
  background: rgba(139, 92, 246, 0.12);
}

.metric-grid small,
.metric-grid p {
  color: var(--canvas-text-subtle);
  font-size: 12px;
}

.metric-grid strong {
  display: block;
  margin: 2px 0;
  font-size: 22px;
  font-weight: 600;
}

.metric-grid p {
  margin: 0;
}

.library-panel {
  overflow: visible;
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  background: var(--canvas-panel);
  box-shadow: var(--shadow-sm);
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--canvas-border);
}

.filter-bar .search-field {
  min-width: min(360px, 100%);
  flex: 1 1 360px;
}

.filter-bar .filter-select {
  width: 150px;
  flex: 0 1 150px;
}

.search-field,
.manual-dialog input {
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  outline: none;
  color: var(--canvas-text);
  background: var(--canvas-input);
  font-size: 13px;
}

.search-field:focus-within,
.manual-dialog input:focus {
  border-color: var(--canvas-accent-border);
  box-shadow: 0 0 0 3px var(--canvas-accent-soft);
}

.search-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-field > i {
  color: var(--canvas-text-subtle);
}
.search-field input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: var(--canvas-text);
  background: transparent;
}
.search-field button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  color: var(--canvas-text-subtle);
  background: transparent;
}
.reset-button {
  border-color: transparent;
  background: transparent;
}

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 50px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--canvas-border);
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--canvas-text-muted);
  font-size: 13px;
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
  accent-color: var(--canvas-accent);
}

.table-scroll {
  overflow-x: auto;
}
.product-table {
  width: 100%;
  min-width: 1280px;
  border-collapse: collapse;
  table-layout: fixed;
}
.product-table th {
  height: 44px;
  padding: 0 10px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-surface);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
}
.product-table th:nth-child(1) {
  width: 48px;
}
.product-table th:nth-child(2) {
  width: 32%;
}
.product-table th:nth-child(3) {
  width: 110px;
}
.product-table th:nth-child(4) {
  width: 130px;
}
.product-table th:nth-child(5) {
  width: 135px;
}
.product-table th:nth-child(6),
.product-table th:nth-child(7) {
  width: 110px;
}
.product-table th:nth-child(8) {
  width: 150px;
}
.product-table th:nth-child(9) {
  width: 70px;
}
.product-table td {
  height: 78px;
  padding: 8px 10px;
  border-top: 1px solid var(--canvas-border);
  color: var(--canvas-text-muted);
  font-size: 12px;
  vertical-align: middle;
}
.product-table tr.selected td {
  background: var(--canvas-accent-soft);
}
.product-table tbody tr:hover td {
  background: color-mix(in srgb, var(--canvas-surface-hover) 54%, transparent);
}

.product-cell {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
}

.product-cover {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-surface);
}

.product-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.product-cell strong {
  display: block;
  overflow: hidden;
  color: var(--canvas-text);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-cell small {
  display: block;
  overflow: hidden;
  margin-top: 6px;
  color: var(--canvas-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.product-table a {
  display: block;
  margin-top: 7px;
  color: var(--canvas-accent);
  text-decoration: none;
}
.platform-pill {
  display: inline-flex;
  padding: 4px 7px;
  border-radius: 4px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag-list span {
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--tag-color, var(--canvas-accent)) 42%, transparent);
  border-radius: 4px;
  color: var(--tag-color, var(--canvas-accent));
  background: color-mix(in srgb, var(--tag-color, var(--canvas-accent)) 10%, transparent);
}
.muted-text {
  color: var(--canvas-text-subtle);
}

.quality-meter {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quality-meter > span {
  width: 82px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--canvas-surface-hover);
}
.quality-meter i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #10b981);
}
.quality-meter strong {
  color: var(--canvas-text);
  font-weight: 600;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 12px;
  white-space: nowrap;
}
.status-pill.is-success {
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}
.status-pill.is-working {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.status-pill.is-queued {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.12);
}
.status-pill.is-danger {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
}
.status-pill.is-muted {
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}
.product-table time {
  color: var(--canvas-text-subtle);
  white-space: nowrap;
}
.table-action {
  min-height: 30px;
  padding: 0 9px;
  color: var(--canvas-accent);
}

.state-panel {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--canvas-text-subtle);
  text-align: center;
}

.state-panel > i {
  color: var(--canvas-accent);
  font-size: 34px;
}
.state-panel strong {
  color: var(--canvas-text);
  font-size: 15px;
  font-weight: 600;
}
.state-panel span {
  max-width: 480px;
  font-size: 13px;
}
.state-panel button {
  margin-top: 8px;
  color: var(--canvas-accent);
}
.state-panel.is-error > i {
  color: var(--color-error);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: 9px 14px;
  border-top: 1px solid var(--canvas-border);
  color: var(--canvas-text-subtle);
  font-size: 12px;
}

.pagination button {
  min-height: 32px;
  padding: 0 10px;
}
.pagination strong {
  min-width: 62px;
  color: var(--canvas-text-muted);
  font-weight: 500;
  text-align: center;
}

.dialog-backdrop {
  position: fixed;
  z-index: var(--z-modal);
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 8, 14, 0.56);
  backdrop-filter: blur(5px);
}

.standard-dialog,
.product-drawer {
  overflow: hidden;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
}

.standard-dialog {
  width: min(560px, 94vw);
}
.standard-dialog > header,
.product-drawer > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 17px 18px;
  border-bottom: 1px solid var(--canvas-border);
}

.standard-dialog h2,
.product-drawer h2 {
  margin: 3px 0 0;
  font-size: 18px;
  font-weight: 600;
}
.standard-dialog header > button,
.product-drawer header > button {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 5px;
  color: var(--canvas-text-subtle);
  background: transparent;
}
.standard-dialog header > button:hover,
.product-drawer header > button:hover {
  color: var(--canvas-text);
  background: var(--canvas-surface-hover);
}

.task-list {
  max-height: 440px;
  overflow-y: auto;
  padding: 10px;
}
.task-list article {
  display: grid;
  grid-template-columns: 36px 1fr auto;
  align-items: center;
  gap: 10px;
  min-height: 66px;
  padding: 8px;
  border-bottom: 1px solid var(--canvas-border);
}
.task-platform {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 6px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.task-list article strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
}
.task-list article small {
  display: block;
  margin-top: 4px;
  color: var(--canvas-text-subtle);
}
.dialog-empty {
  display: flex;
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--canvas-text-subtle);
}
.dialog-empty i {
  font-size: 30px;
}

.tag-dialog > p {
  margin: 0;
  padding: 16px 18px 0;
  color: var(--canvas-text-muted);
  font-size: 13px;
}
.tag-options {
  display: flex;
  min-height: 130px;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 8px;
  padding: 16px 18px;
}
.tag-options button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 5px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}
.tag-options button.active {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}
.tag-options > span {
  color: var(--canvas-text-subtle);
  font-size: 13px;
}
.standard-dialog > footer {
  justify-content: flex-end;
  padding: 12px 18px;
  border-top: 1px solid var(--canvas-border);
}

.manual-dialog form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 18px;
}
.manual-dialog label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.manual-dialog .wide-field {
  grid-column: 1 / -1;
}
.manual-dialog form footer {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
}
.manual-dialog form footer button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}

.product-drawer {
  position: fixed;
  top: 16px;
  right: 16px;
  bottom: 16px;
  width: min(520px, calc(100vw - 32px));
  display: grid;
  grid-template-rows: auto 1fr auto;
}

.drawer-body {
  overflow-y: auto;
  padding: 16px;
}
.drawer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--canvas-text-muted);
}
.detail-gallery {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.detail-gallery figure {
  aspect-ratio: 1;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface);
}
.detail-gallery img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.no-images {
  grid-column: 1 / -1;
  display: flex;
  min-height: 180px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-surface);
}
.no-images i {
  font-size: 30px;
}
.drawer-body dl {
  margin: 18px 0 0;
  border-top: 1px solid var(--canvas-border);
}
.drawer-body dl div {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--canvas-border);
  font-size: 13px;
}
.drawer-body dt {
  color: var(--canvas-text-subtle);
}
.drawer-body dd {
  margin: 0;
  color: var(--canvas-text);
}
.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
.detail-tags span {
  padding: 5px 8px;
  border-radius: 4px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-size: 12px;
}
.product-drawer > footer {
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--canvas-border);
}

.selection-toast {
  position: fixed;
  z-index: var(--z-toast);
  right: 24px;
  bottom: 24px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(480px, calc(100vw - 48px));
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 6px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
  font-size: 13px;
}

.selection-toast i {
  color: var(--canvas-accent);
  font-size: 18px;
}
.selection-toast.is-error {
  border-color: rgba(239, 68, 68, 0.4);
}
.selection-toast.is-error i {
  color: var(--color-error);
}
.spinning {
  animation: spin 0.8s linear infinite;
}
.toast-enter-active,
.toast-leave-active {
  transition: 160ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1320px) {
  .selection-header {
    grid-template-columns: auto 1fr;
  }
  .header-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@media (max-width: 900px) {
  .selection-page {
    padding: 16px 12px 48px;
  }
  .selection-header {
    grid-template-columns: auto 1fr;
    gap: 12px;
  }
  .selection-title p {
    display: none;
  }
  .selection-title h1 {
    font-size: 23px;
  }
  .header-actions {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .account-chip {
    display: none;
  }
  .metric-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .filter-bar .filter-select {
    width: calc(50% - 4px);
    flex-basis: calc(50% - 4px);
  }
  .batch-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .batch-bar > div {
    width: 100%;
    overflow-x: auto;
  }
}

@media (max-width: 560px) {
  .back-button span {
    display: none;
  }
  .metric-grid {
    grid-template-columns: 1fr;
  }
  .filter-bar .filter-select {
    width: 100%;
    flex-basis: 100%;
  }
  .task-notice {
    grid-template-columns: auto 1fr;
  }
  .task-notice > button {
    grid-column: 2;
    justify-self: start;
    padding: 0;
  }
  .manual-dialog form {
    grid-template-columns: 1fr;
  }
  .manual-dialog .wide-field,
  .manual-dialog form footer {
    grid-column: auto;
  }
  .dialog-backdrop {
    padding: 10px;
  }
}
</style>

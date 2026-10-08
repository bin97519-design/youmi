<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ThemedSelect from '../components/common/ThemedSelect.vue'
import SelectionProductEditor from '../components/selection/SelectionProductEditor.vue'
import { createCopier } from '../utils/selectionProductCopy'
import { copyRecoveryStore } from '../utils/selectionCopyStorage'
import { apiPath } from '../utils/apiBase'
import JdSkuLengthConfirm from '../components/selection/JdSkuLengthConfirm.vue'
import { assertJdSkuPreflightAvailable } from '../utils/jdSkuPreflightFlow'
import { useTheme } from '../composables/useTheme'
import { useUserStore } from '../stores/user'
import {
  assertProductMoverStorageReady,
  productMoverStorageLabel,
  productMoverErrorMessage,
} from '../utils/productMoverStorage'
import {
  assignSelectionTags,
  claimMigrationTask,
  createMigrationTask,
  createSelectionProduct,
  createSelectionSplitProducts,
  deleteSelectionProducts,
  deleteMigrationTasks,
  fetchMigrationTasks,
  fetchSelectionProduct,
  fetchSelectionProducts,
  fetchSelectionTags,
  updateSelectionProduct,
} from '../utils/selectionPoolApi'
import {
  openProductMoverWorkbench,
  prepareProductMoverMigration,
  probeProductMover,
  productMoverApiBase,
  removeProductMoverTaskCache,
} from '../utils/productMoverBridge'

const router = useRouter()
const userStore = useUserStore()
const { cycle: cycleTheme, isDark } = useTheme()

const pageSize = 10
const products = ref([])
const tags = ref([])
const migrationTasks = ref([])
const selectedIds = ref(new Set())
const loading = ref(false)
const refreshing = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const page = ref(1)
const pageJump = ref('1')
watch(page, (value) => {
  pageJump.value = String(value)
})
const total = ref(0)
const detailProduct = ref(null)
const detailLoading = ref(false)
const detailSaving = ref(false)
const copyingProductId = ref(null)
const deletingProductIds = ref([])
const productCopier = createCopier({
  getScope: () =>
    userStore.profile?.id
      ? JSON.stringify([apiPath('/api/v1/selection-pool'), userStore.profile.id])
      : '',
  readPending: copyRecoveryStore.read,
  writePending: copyRecoveryStore.write,
  removePending: copyRecoveryStore.remove,
  fetchProduct: (id) => fetchSelectionProduct(userStore, id),
  createProduct: (body) => createSelectionProduct(userStore, body),
  assignTags: (id, tagIds) => assignSelectionTags(userStore, [id], tagIds),
})
const splitError = ref('')
const taskDialogOpen = ref(false)
const migrationDialogOpen = ref(false)
const tagDialogOpen = ref(false)
const manualDialogOpen = ref(false)
const migrationStarting = ref(false)
const jdSkuWarning = ref(null)
let resolveJdSkuWarning = null
function finishJdSkuWarning(confirmed) {
  const resolve = resolveJdSkuWarning
  resolveJdSkuWarning = null
  jdSkuWarning.value = null
  resolve?.(confirmed === true)
}
function confirmJdSkuNames(report) {
  finishJdSkuWarning(false)
  jdSkuWarning.value = report
  return new Promise((resolve) => {
    resolveJdSkuWarning = resolve
  })
}
onBeforeUnmount(() => finishJdSkuWarning(false))
const taskActionId = ref('')
const selectedTaskIds = ref(new Set())
const deletingTasks = ref(false)
const taskDeleteNotice = ref('')
const pendingTaskCacheIds = ref([])
const taskCacheRecoveryKey = computed(
  () => `youmi_task_cache_cleanup_${userStore.profile?.id || 'unknown'}`,
)
watch(
  taskCacheRecoveryKey,
  (key) => {
    try {
      const ids = JSON.parse(sessionStorage.getItem(key) || '[]')
      pendingTaskCacheIds.value = Array.isArray(ids)
        ? ids.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))
        : []
    } catch {
      pendingTaskCacheIds.value = []
    }
  },
  { immediate: true },
)
watch(pendingTaskCacheIds, (ids) => {
  try {
    sessionStorage.setItem(taskCacheRecoveryKey.value, JSON.stringify(ids))
  } catch {
    /* Cloud deletion remains valid if session storage is full. */
  }
})
const allTasksSelected = computed(
  () =>
    migrationTasks.value.length > 0 &&
    migrationTasks.value.every((task) => selectedTaskIds.value.has(task.taskId)),
)
const pluginState = ref('checking')
const pluginInfo = ref(null)
const activeTagIds = ref(new Set())
const toast = ref({ visible: false, type: 'success', message: '' })
let toastTimer = null
let listLoadSequence = 0
let detailLoadSequence = 0

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

const migrationForm = reactive({
  targetPlatform: 'TAOBAO',
  submitMode: 'REVIEW',
  defaultStock: 999,
  copyImages: true,
})

const platformOptions = [
  { value: '', label: '全部平台' },
  { value: 'TAOBAO', label: '淘宝' },
  { value: 'TMALL', label: '天猫' },
  { value: '1688', label: '1688' },
  { value: 'DOUYIN', label: '抖音' },
  { value: 'JD', label: '京东' },
  { value: 'PDD', label: '拼多多' },
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
  COMPLETED_WITH_ERRORS: '完成但有失败',
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
const targetPlatformOptions = [
  { value: 'TAOBAO', label: '淘宝' },
  { value: 'TMALL', label: '天猫' },
  { value: 'JD', label: '京东' },
  { value: 'PDD', label: '拼多多' },
  { value: 'DOUYIN', label: '抖店' },
]
const submitModeOptions = [
  { value: 'REVIEW', label: '停在发布页，人工检查' },
  { value: 'DRAFT', label: '自动保存草稿' },
  { value: 'PUBLISH', label: '二次确认后正式发布' },
]
const pluginConnected = computed(() => pluginState.value === 'connected')
const pluginStatusLabel = computed(() => {
  if (pluginState.value === 'checking') return '正在检测插件'
  if (pluginConnected.value) return `搬家插件 ${pluginInfo.value?.version || ''}`.trim()
  return '搬家插件未连接'
})

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
  const skuGroups =
    product.listMeta?.skuGroupCount ?? (data.skuGroups?.length || data.specGroups?.length || 0)
  const skus = product.listMeta?.skuCount ?? (data.skus?.length || data.skuList?.length || 0)
  const category = product.listMeta?.categoryName || data.category?.name || data.categoryName || ''
  return [
    product.sourceProductId ? `ID ${product.sourceProductId}` : '自定义商品',
    category,
    `${skuGroups} 组规格 / ${skus} 个 SKU`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function productSplit(product) {
  return product.listMeta?.skuSplit || product.productData?.skuSplit
}

function platformName(value) {
  return platformOptions.find((option) => option.value === value)?.label || value || '--'
}

function statusTone(value) {
  if (['COLLECTED', 'PUBLISHED', 'COMPLETED'].includes(value)) return 'success'
  if (value === 'QUEUED') return 'queued'
  if (['COLLECTING', 'PUBLISHING'].includes(value)) return 'working'
  if (['FAILED', 'PARTIAL', 'COMPLETED_WITH_ERRORS'].includes(value)) return 'danger'
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
  const sequence = ++listLoadSequence
  if (reset) {
    page.value = 1
    selectedIds.value = new Set()
  }
  if (quiet) refreshing.value = true
  else loading.value = true
  errorMessage.value = ''
  try {
    // Auxiliary requests must not hold the product table behind a slow task/tag response.
    void fetchSelectionTags(userStore)
      .then((value) => {
        if (sequence === listLoadSequence) tags.value = value || []
      })
      .catch(() => {})
    void fetchMigrationTasks(userStore)
      .then((value) => {
        if (sequence === listLoadSequence) migrationTasks.value = value || []
      })
      .catch(() => {})
    const productPage = await fetchSelectionProducts(userStore, {
      ...filters,
      page: page.value,
      pageSize,
    })
    if (sequence !== listLoadSequence) return
    products.value = productPage?.items || []
    total.value = Number(productPage?.total || 0)
  } catch (error) {
    if (sequence !== listLoadSequence) return
    errorMessage.value = error?.message || '选品库加载失败'
    products.value = []
    total.value = 0
  } finally {
    if (sequence === listLoadSequence) {
      loading.value = false
      refreshing.value = false
    }
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
  if (deletingProductIds.value.length) return
  if (
    !Number.isSafeInteger(nextPage) ||
    nextPage < 1 ||
    nextPage > pageCount.value ||
    nextPage === page.value
  )
    return
  page.value = nextPage
  selectedIds.value = new Set()
  void loadData()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function jumpToPage() {
  if (deletingProductIds.value.length) return
  const text = String(pageJump.value).trim()
  const target = Number(text)
  if (
    !/^\d+$/.test(text) ||
    !Number.isSafeInteger(target) ||
    target < 1 ||
    target > pageCount.value
  ) {
    showToast(`请输入 1 到 ${pageCount.value} 之间的整数页码`, 'error')
    return
  }
  pageJump.value = String(target)
  changePage(target)
}

async function openProduct(product) {
  if (detailSaving.value || deletingProductIds.value.length) return
  const sequence = ++detailLoadSequence
  splitError.value = ''
  detailProduct.value = product
  detailLoading.value = true
  try {
    const detail = await fetchSelectionProduct(userStore, product.id)
    if (sequence !== detailLoadSequence || detailProduct.value?.id !== product.id) return
    if (
      !detail?.productData ||
      typeof detail.productData !== 'object' ||
      Array.isArray(detail.productData)
    ) {
      throw new Error('未读取到完整商品资料，请重试')
    }
    detailProduct.value = detail
  } catch (error) {
    if (sequence !== detailLoadSequence) return
    detailProduct.value = null
    showToast(error?.message || '商品详情加载失败', 'error')
  } finally {
    if (sequence === detailLoadSequence) detailLoading.value = false
  }
}

async function copyProduct(product) {
  if (copyingProductId.value !== null || deletingProductIds.value.length) return
  copyingProductId.value = product.id
  try {
    const saved = await productCopier.copy(product.id)
    Object.assign(filters, {
      keyword: '',
      platform: '',
      collectStatus: '',
      publishStatus: '',
      tagId: '',
    })
    page.value = 1
    await loadData({ quiet: true })
    selectedIds.value = new Set([saved.id])
    showToast('已复制商品，原商品保留；副本未开始搬家')
  } catch (error) {
    showToast(`${error?.message || '复制失败'}。请再次点击“复制”重试，沿用同一份副本。`, 'error')
  } finally {
    copyingProductId.value = null
  }
}

async function saveProductEdits({ payload, afterSave }) {
  if (!detailProduct.value?.productData || detailLoading.value || detailSaving.value) return
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

async function splitProductEdits(body) {
  if (!detailProduct.value?.productData || detailLoading.value || detailSaving.value) return
  detailSaving.value = true
  splitError.value = ''
  try {
    const result = await createSelectionSplitProducts(userStore, body)
    if (result?.items?.length !== 2) throw new Error('拆分返回结果不完整，请重试同一批资料确认结果')
    detailProduct.value = null
    // Show and select the two children, never the original 459-SKU product.
    Object.assign(filters, {
      keyword: '',
      platform: '',
      collectStatus: '',
      publishStatus: '',
      tagId: '',
    })
    page.value = 1
    await loadData({ quiet: true })
    selectedIds.value = new Set(result.items.map((item) => item.id))
    showToast('已生成并勾选两份商品，原商品保留。可继续点击“开始搬家”')
  } catch (error) {
    splitError.value = error?.message || '商品拆分失败，请重试'
    showToast(splitError.value, 'error')
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
  return removeProducts([...selectedIds.value])
}

async function removeProduct(product) {
  if (!products.value.some((item) => item.id === product.id)) return
  return removeProducts([product.id], product.title)
}

async function removeProducts(productIds, title = '') {
  if (
    actionLoading.value ||
    deletingProductIds.value.length ||
    copyingProductId.value !== null ||
    detailSaving.value
  )
    return
  // Freeze exactly the confirmed IDs; later selection changes must not expand the deletion.
  const ids = [...new Set(productIds)].filter((id) => Number.isSafeInteger(id) && id > 0)
  if (!ids.length) return
  if (ids.length > 200) return showToast('一次最多删除 200 个商品，请减少勾选数量', 'error')
  const scope = title ? `商品“${title}”` : `选中的 ${ids.length} 个商品`
  if (
    !window.confirm(
      `确定删除${scope}并移入回收站吗？\n仅删除选品库记录，不删除平台商品，也不会取消已创建的搬家任务。`,
    )
  )
    return
  actionLoading.value = true
  deletingProductIds.value = ids
  let deleted = false
  try {
    const count = await deleteSelectionProducts(userStore, ids)
    deleted = true
    selectedIds.value = new Set([...selectedIds.value].filter((id) => !ids.includes(id)))
    if (ids.includes(detailProduct.value?.id)) detailProduct.value = null
    await loadData({ quiet: true })
    if (!errorMessage.value) {
      const lastPage = Math.max(1, Math.ceil(total.value / pageSize))
      if (page.value > lastPage) {
        page.value = lastPage
        await loadData({ quiet: true })
      }
    }
    const message = Number.isInteger(count)
      ? count > 0
        ? `已将 ${count} 个商品移入回收站`
        : '没有新增删除记录，商品可能已被删除'
      : '删除请求已完成'
    showToast(
      message + (errorMessage.value ? '；列表刷新失败，请刷新页面' : ''),
      errorMessage.value ? 'info' : 'success',
    )
  } catch (error) {
    showToast(
      deleted ? '删除请求已完成，但列表刷新失败，请刷新页面' : error?.message || '删除失败',
      'error',
    )
  } finally {
    deletingProductIds.value = []
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

async function refreshPluginConnection({ quiet = false } = {}) {
  pluginState.value = 'checking'
  try {
    pluginInfo.value = await probeProductMover()
    pluginState.value = 'connected'
    return true
  } catch (error) {
    pluginInfo.value = null
    pluginState.value = 'disconnected'
    if (!quiet) showToast(error?.message || '没有检测到搬家插件', 'error')
    return false
  }
}

async function openBatchCollection() {
  try {
    await openProductMoverWorkbench()
    showToast('已打开有米商品搬家工作台', 'info')
  } catch (error) {
    pluginState.value = 'disconnected'
    showToast(error?.message || '无法打开搬家插件', 'error')
  }
}

function prepareMigration() {
  if (!selectedCount.value) return
  migrationDialogOpen.value = true
  void refreshPluginConnection({ quiet: true })
}

async function handoffMigrationToPlugin(task, handoff) {
  const resolvedTask = handoff?.task || task
  const options = resolvedTask?.options || {}
  const productRowIds = (handoff?.items || []).map((item) => item.productRowId).filter(Boolean)
  if (!productRowIds.length) throw new Error('搬家任务没有等待发布的商品')
  assertJdSkuPreflightAvailable(resolvedTask.targetPlatform, pluginInfo.value)

  return prepareProductMoverMigration(
    {
      taskId: resolvedTask.taskId,
      productRowIds,
      frozenItems: handoff.items || [],
      targetPlatform: resolvedTask.targetPlatform,
      submitMode: options.submitMode || migrationForm.submitMode,
      defaultStock: options.defaultStock ?? migrationForm.defaultStock,
      apiBase: productMoverApiBase(),
      token: userStore.token,
    },
    confirmJdSkuNames,
  )
}

async function createAndStartMigration() {
  if (!selectedCount.value || migrationStarting.value) return
  migrationStarting.value = true
  let createdTask = null
  try {
    if (!(await refreshPluginConnection({ quiet: true })))
      throw new Error('未检测到搬家插件，请启用插件并刷新当前页面')
    assertProductMoverStorageReady(pluginInfo.value)
    if (!userStore.token) throw new Error('请先登录有米账号')
    assertJdSkuPreflightAvailable(migrationForm.targetPlatform, pluginInfo.value)

    createdTask = await createMigrationTask(userStore, {
      productRowIds: [...selectedIds.value],
      targetPlatform: migrationForm.targetPlatform,
      targetShopRef: null,
      options: {
        copyImages: migrationForm.copyImages,
        client: 'WEB_SELECTION_POOL',
        shopStrategy: 'CURRENT_SELLER_SESSION',
        categoryStrategy: 'SOURCE_CATEGORY_EXACT',
        submitMode: migrationForm.submitMode,
        defaultStock: Math.max(0, Math.trunc(Number(migrationForm.defaultStock) || 0)),
      },
    })
    const handoff = await claimMigrationTask(userStore, createdTask.taskId)
    const result = await handoffMigrationToPlugin(createdTask, handoff)
    if (result.cancelled) {
      showToast('已取消启动京东上架，任务保留在“待发布任务”，未打开发布页', 'info')
      migrationDialogOpen.value = false
      await loadData({ quiet: true })
      return
    }

    migrationDialogOpen.value = false
    selectedIds.value = new Set()
    showToast('搬家任务已接管，正在打开目标平台官方发布页')
    await loadData({ quiet: true })
  } catch (error) {
    showToast(
      createdTask
        ? `任务已保留，可在“待发布任务”中重试：${productMoverErrorMessage(error)}`
        : productMoverErrorMessage(error, '搬家任务创建失败'),
      'error',
    )
    if (createdTask) await loadData({ quiet: true })
  } finally {
    migrationStarting.value = false
  }
}

async function claimExistingTask(task) {
  if (!task?.taskId || taskActionId.value || deletingTasks.value) return
  taskActionId.value = task.taskId
  try {
    if (!(await refreshPluginConnection({ quiet: true })))
      throw new Error('未检测到搬家插件，请启用插件并刷新当前页面')
    assertProductMoverStorageReady(pluginInfo.value)
    assertJdSkuPreflightAvailable(task.targetPlatform, pluginInfo.value)
    const handoff = await claimMigrationTask(userStore, task.taskId)
    const result = await handoffMigrationToPlugin(task, handoff)
    if (result.cancelled) {
      showToast('已取消继续发布，未打开京东发布页', 'info')
      await loadData({ quiet: true })
      return
    }
    taskDialogOpen.value = false
    showToast('任务已由当前浏览器接管，正在打开官方发布页')
    await loadData({ quiet: true })
  } catch (error) {
    taskDeleteNotice.value = productMoverErrorMessage(error, '任务接管失败')
    showToast(taskDeleteNotice.value, 'error')
  } finally {
    taskActionId.value = ''
  }
}

function toggleTaskSelection(taskId) {
  const next = new Set(selectedTaskIds.value)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  selectedTaskIds.value = next
}

async function cleanDeletedTaskCache() {
  while (pendingTaskCacheIds.value.length) {
    const ids = pendingTaskCacheIds.value.slice(0, 200)
    await removeProductMoverTaskCache({
      taskIds: ids,
      token: userStore.token,
      apiBase: productMoverApiBase(),
    })
    pendingTaskCacheIds.value = pendingTaskCacheIds.value.slice(ids.length)
  }
}

async function retryTaskCacheCleanup() {
  if (deletingTasks.value || taskActionId.value) return
  deletingTasks.value = true
  try {
    await cleanDeletedTaskCache()
    taskDeleteNotice.value = '对应插件任务缓存已清理。'
  } catch (error) {
    taskDeleteNotice.value = `云端任务已删除，但插件缓存未清理：${error.message}。请重新加载新版插件并刷新页面后，再重试清理。`
  } finally {
    deletingTasks.value = false
  }
}

async function removeQueuedTasks(clearAll = false) {
  if (deletingTasks.value || taskActionId.value || migrationStarting.value) return
  const ids = migrationTasks.value
    .filter((task) => selectedTaskIds.value.has(task.taskId))
    .map((task) => task.taskId)
  if (!clearAll && !ids.length) return
  const scope = clearAll
    ? '当前账号全部待发布任务（包含未显示的任务）'
    : `选中的 ${ids.length} 个任务`
  if (
    !window.confirm(
      `确定删除${scope}吗？\n删除后不能继续接管这些任务，同时尝试清理插件对应缓存。\n不会删除选品库商品或平台商品。正在执行的发布页请先停止操作；已发送的请求无法撤回。`,
    )
  )
    return
  deletingTasks.value = true
  taskDeleteNotice.value = ''
  try {
    const result = await deleteMigrationTasks(
      userStore,
      clearAll ? { clearAll: true } : { taskIds: ids },
    )
    const removed = result?.taskIds || []
    pendingTaskCacheIds.value = [...new Set([...pendingTaskCacheIds.value, ...removed])]
    selectedTaskIds.value = new Set()
    await loadData({ quiet: true })
    try {
      await cleanDeletedTaskCache()
      taskDeleteNotice.value = `已删除 ${removed.length} 个任务，并清理对应插件缓存。选品库商品保持不变。`
    } catch (error) {
      taskDeleteNotice.value = `已删除 ${removed.length} 个云端任务；插件缓存尚未清理：${error.message}。请加载新版插件后重试清理缓存。`
    }
  } catch (error) {
    taskDeleteNotice.value = error?.message || '任务删除失败'
  } finally {
    deletingTasks.value = false
  }
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
  void Promise.all([loadData(), refreshPluginConnection({ quiet: true })])
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
        <button
          class="plugin-chip"
          :class="`is-${pluginState}`"
          type="button"
          :title="pluginConnected ? '插件已连接，点击重新检测' : '点击重新检测搬家插件'"
          @click="refreshPluginConnection()"
        >
          <i :class="pluginConnected ? 'ri-plug-line' : 'ri-plug-2-line'"></i>
          {{ pluginStatusLabel }}
        </button>
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
          <i class="ri-window-line"></i>
          插件工作台
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
          <input
            type="checkbox"
            :checked="allCurrentSelected"
            :disabled="deletingProductIds.length > 0"
            @change="toggleSelectAll"
          />
          <span>{{ selectedCount ? `已选择 ${selectedCount} 个商品` : '全选本页' }}</span>
        </label>
        <div>
          <button type="button" :disabled="!selectedCount || actionLoading" @click="openTags">
            <i class="ri-price-tag-3-line"></i>
            设置标签
          </button>
          <button
            class="delete-action"
            type="button"
            :disabled="!selectedCount || actionLoading || copyingProductId !== null"
            @click="removeSelected"
          >
            <i class="ri-delete-bin-6-line"></i>
            {{
              deletingProductIds.length
                ? '删除中…'
                : `批量删除${selectedCount ? `（${selectedCount}）` : ''}`
            }}
          </button>
          <button
            class="batch-primary"
            type="button"
            :disabled="!selectedCount || actionLoading"
            @click="prepareMigration"
          >
            <i class="ri-truck-line"></i>
            开始搬家
          </button>
        </div>
      </div>

      <nav
        v-if="!loading && !errorMessage"
        class="pagination pagination-top"
        aria-label="商品列表顶部分页"
      >
        <span>共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
        <div>
          <button
            type="button"
            :disabled="page <= 1 || deletingProductIds.length > 0"
            @click="changePage(page - 1)"
          >
            上一页
          </button>
          <strong>第 {{ page }} / {{ pageCount }} 页</strong>
          <button
            type="button"
            :disabled="page >= pageCount || deletingProductIds.length > 0"
            @click="changePage(page + 1)"
          >
            下一页
          </button>
          <form class="page-jump" @submit.prevent="jumpToPage">
            <label>
              跳至
              <input
                v-model="pageJump"
                type="text"
                inputmode="numeric"
                aria-label="顶部分页跳转页码"
                :disabled="deletingProductIds.length > 0"
              />
              页
            </label>
            <button type="submit" :disabled="deletingProductIds.length > 0">跳转</button>
          </form>
        </div>
      </nav>

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
                  :disabled="deletingProductIds.length > 0"
                  @change="toggleSelect(product.id)"
                />
              </td>
              <td>
                <button
                  class="product-cell"
                  type="button"
                  :disabled="deletingProductIds.length > 0"
                  @click="openProduct(product)"
                >
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
                    <small
                      v-if="product.sourceProductId?.startsWith('copy_')"
                      class="split-product-label"
                    >
                      商品副本
                    </small>
                    <small v-if="productSplit(product)" class="split-product-label">
                      裂变 {{ productSplit(product).part }}/2 · 按{{
                        productSplit(product).groupName
                      }}拆分
                    </small>
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
                <div class="product-row-actions">
                  <button
                    class="table-action delete-action"
                    type="button"
                    :disabled="actionLoading || copyingProductId !== null || detailSaving"
                    title="删除此商品并移入回收站，不删除平台商品"
                    @click.stop="removeProduct(product)"
                  >
                    {{ deletingProductIds.includes(product.id) ? '删除中…' : '删除' }}
                  </button>
                  <button
                    class="table-action"
                    type="button"
                    :disabled="copyingProductId !== null || deletingProductIds.length > 0"
                    title="复制完整商品资料和全部 SKU，保留原商品"
                    @click.stop="copyProduct(product)"
                  >
                    {{ copyingProductId === product.id ? '复制中…' : '复制' }}
                  </button>
                  <button
                    class="table-action"
                    type="button"
                    :disabled="deletingProductIds.length > 0"
                    @click="openProduct(product)"
                  >
                    编辑
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer v-if="!loading && !errorMessage" class="pagination" aria-label="商品列表底部分页">
        <span>共 {{ total }} 条 · 每页 {{ pageSize }} 条</span>
        <div>
          <button
            type="button"
            :disabled="page <= 1 || deletingProductIds.length > 0"
            @click="changePage(page - 1)"
          >
            上一页
          </button>
          <strong>第 {{ page }} / {{ pageCount }} 页</strong>
          <button
            type="button"
            :disabled="page >= pageCount || deletingProductIds.length > 0"
            @click="changePage(page + 1)"
          >
            下一页
          </button>
          <form class="page-jump" @submit.prevent="jumpToPage">
            <label>
              跳至
              <input
                v-model="pageJump"
                type="text"
                inputmode="numeric"
                aria-label="底部分页跳转页码"
                :disabled="deletingProductIds.length > 0"
              />
              页
            </label>
            <button type="submit" :disabled="deletingProductIds.length > 0">跳转</button>
          </form>
        </div>
      </footer>
    </section>

    <SelectionProductEditor
      v-if="detailProduct"
      :product="detailProduct"
      :loading="detailLoading"
      :saving="detailSaving"
      :split-error="splitError"
      @close="!detailSaving && (detailProduct = null)"
      @save="saveProductEdits"
      @split="splitProductEdits"
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
        <div class="task-toolbar">
          <label>
            <input
              type="checkbox"
              :checked="allTasksSelected"
              :disabled="deletingTasks || !!taskActionId || !migrationTasks.length"
              @change="
                selectedTaskIds = allTasksSelected
                  ? new Set()
                  : new Set(migrationTasks.map((task) => task.taskId))
              "
            />
            全选当前列表
          </label>
          <button
            type="button"
            :disabled="deletingTasks || !!taskActionId || !selectedTaskIds.size"
            @click="removeQueuedTasks(false)"
          >
            批量删除（{{ selectedTaskIds.size }}）
          </button>
          <button
            type="button"
            :disabled="deletingTasks || !!taskActionId || !migrationTasks.length"
            @click="removeQueuedTasks(true)"
          >
            清空任务
          </button>
        </div>
        <p v-if="taskDeleteNotice" class="task-delete-notice" role="status">
          {{ taskDeleteNotice }}
        </p>
        <p v-if="pluginConnected" class="task-delete-notice">
          {{ productMoverStorageLabel(pluginInfo) }}
        </p>
        <button
          v-if="pendingTaskCacheIds.length"
          class="cache-retry"
          type="button"
          :disabled="deletingTasks || !!taskActionId"
          @click="retryTaskCacheCleanup"
        >
          重试清理插件缓存（{{ pendingTaskCacheIds.length }} 个任务）
        </button>
        <div class="task-list">
          <article v-for="task in migrationTasks" :key="task.taskId">
            <input
              type="checkbox"
              :aria-label="`选择${platformName(task.targetPlatform)}任务 ${task.taskId}`"
              :checked="selectedTaskIds.has(task.taskId)"
              :disabled="deletingTasks || !!taskActionId"
              @change="toggleTaskSelection(task.taskId)"
            />
            <span class="task-platform"><i class="ri-truck-line"></i></span>
            <div>
              <strong>
                {{ platformName(task.targetPlatform) }} · {{ task.totalCount }} 个商品
              </strong>
              <small>{{ formatTime(task.createdAt) }}</small>
            </div>
            <div class="task-actions">
              <span class="status-pill" :class="`is-${statusTone(task.status)}`">
                {{ taskLabels[task.status] || task.status }}
              </span>
              <button
                type="button"
                :disabled="Boolean(taskActionId) || deletingTasks"
                @click="claimExistingTask(task)"
              >
                <i
                  :class="
                    taskActionId === task.taskId ? 'ri-loader-4-line spinning' : 'ri-play-line'
                  "
                ></i>
                {{
                  taskActionId === task.taskId
                    ? '接管中'
                    : task.status === 'QUEUED'
                      ? '接管发布'
                      : '继续发布'
                }}
              </button>
            </div>
          </article>
          <div v-if="!migrationTasks.length" class="dialog-empty">
            <i class="ri-inbox-line"></i>
            当前没有发布任务
          </div>
        </div>
      </section>
    </div>

    <div
      v-if="migrationDialogOpen"
      class="dialog-backdrop"
      @mousedown.self="migrationDialogOpen = false"
    >
      <section
        class="standard-dialog migration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="migration-dialog-title"
      >
        <header>
          <div>
            <span>浏览器接管</span>
            <h2 id="migration-dialog-title">创建搬家任务</h2>
          </div>
          <button type="button" :disabled="migrationStarting" @click="migrationDialogOpen = false">
            <i class="ri-close-line"></i>
          </button>
        </header>
        <div class="migration-summary">
          <strong>{{ selectedCount }}</strong>
          <span>个商品将冻结资料，并交给当前 Chrome 中的搬家插件处理</span>
        </div>
        <form @submit.prevent="createAndStartMigration">
          <label>
            <span>目标平台</span>
            <ThemedSelect
              v-model="migrationForm.targetPlatform"
              :options="targetPlatformOptions"
              aria-label="搬家目标平台"
            />
          </label>
          <label>
            <span>填写完成后</span>
            <ThemedSelect
              v-model="migrationForm.submitMode"
              :options="submitModeOptions"
              aria-label="搬家提交方式"
            />
          </label>
          <label>
            <span>来源未提供库存时</span>
            <input v-model.number="migrationForm.defaultStock" type="number" min="0" step="1" />
          </label>
          <label class="migration-check">
            <input v-model="migrationForm.copyImages" type="checkbox" />
            <span>复制并转存商品图片</span>
          </label>
          <p>
            插件会使用当前浏览器已登录的目标平台卖家账号，打开官方发布页并填写可识别的商品资料；不会绕过安全验证，也不会未经确认直接正式发布。
          </p>
          <div class="plugin-readiness" :class="{ connected: pluginConnected }">
            <i :class="pluginConnected ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'"></i>
            <span>
              {{
                pluginConnected
                  ? productMoverStorageLabel(pluginInfo)
                  : '尚未检测到搬家插件，请启用插件并刷新页面'
              }}
            </span>
            <button v-if="!pluginConnected" type="button" @click="refreshPluginConnection()">
              重新检测
            </button>
          </div>
          <footer>
            <button
              type="button"
              :disabled="migrationStarting"
              @click="migrationDialogOpen = false"
            >
              取消
            </button>
            <button
              class="primary-button"
              type="submit"
              :disabled="migrationStarting || !pluginConnected"
            >
              <i
                :class="migrationStarting ? 'ri-loader-4-line spinning' : 'ri-play-circle-line'"
              ></i>
              {{ migrationStarting ? '正在创建并接管' : '确认并启动插件' }}
            </button>
          </footer>
        </form>
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

    <JdSkuLengthConfirm
      v-if="jdSkuWarning"
      :report="jdSkuWarning"
      @confirm="finishJdSkuWarning(true)"
      @cancel="finishJdSkuWarning(false)"
    />

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

.plugin-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-subtle);
  background: var(--canvas-panel);
  font-size: 12px;
  white-space: nowrap;
}

.plugin-chip.is-connected {
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 36%, transparent);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
}

.plugin-chip.is-disconnected {
  color: var(--color-error);
  border-color: color-mix(in srgb, var(--color-error) 36%, transparent);
  background: color-mix(in srgb, var(--color-error) 8%, transparent);
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
  width: 200px;
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

.product-row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.batch-bar .delete-action,
.table-action.delete-action {
  color: #ef4444;
}

.delete-action:not(:disabled):hover {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
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
  flex-wrap: wrap;
  gap: 10px;
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
.pagination-top {
  border-bottom: 1px solid var(--canvas-border);
  background: var(--canvas-surface);
}
.pagination > div {
  flex-wrap: wrap;
}
.page-jump,
.page-jump label {
  display: flex;
  align-items: center;
  gap: 7px;
}
.page-jump {
  margin: 0;
}
.page-jump input {
  width: 58px;
  min-height: 32px;
  padding: 0 6px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text);
  background: var(--canvas-surface);
  text-align: center;
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
  grid-template-columns: 18px 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 66px;
  padding: 8px;
  border-bottom: 1px solid var(--canvas-border);
}
.task-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 18px;
  border-bottom: 1px solid var(--canvas-border);
}
.task-toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
}
.task-toolbar button,
.cache-retry {
  padding: 7px 10px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 5px;
  color: var(--canvas-text);
  background: var(--canvas-surface);
}
.task-toolbar button {
  color: #ef7474;
}
.task-delete-notice {
  padding: 0 18px;
  color: var(--canvas-text-muted);
  line-height: 1.6;
  font-size: 12px;
}
.cache-retry {
  margin: 8px 18px;
  color: var(--canvas-accent);
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
.task-actions {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 7px;
}
.task-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 5px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-size: 12px;
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

.migration-dialog form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 18px;
}
.migration-summary {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 16px 18px 0;
  color: var(--canvas-text-muted);
}
.migration-summary strong {
  color: var(--canvas-accent);
  font-size: 26px;
  font-weight: 650;
}
.migration-dialog form > label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.migration-dialog input[type='number'] {
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  outline: 0;
  color: var(--canvas-text);
  background: var(--canvas-surface);
}
.migration-dialog .migration-check {
  align-items: center;
  align-self: end;
  min-height: 38px;
  flex-direction: row;
}
.migration-dialog form > p,
.plugin-readiness,
.migration-dialog form > footer {
  grid-column: 1 / -1;
}
.migration-dialog form > p {
  margin: 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
  line-height: 1.65;
}
.plugin-readiness {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--color-error) 32%, transparent);
  border-radius: 6px;
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 7%, transparent);
  font-size: 12px;
}
.plugin-readiness.connected {
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 32%, transparent);
  background: color-mix(in srgb, var(--color-success) 8%, transparent);
}
.plugin-readiness span {
  flex: 1;
}
.plugin-readiness button {
  padding: 0;
  border: 0;
  color: currentColor;
  background: transparent;
}
.migration-dialog form > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
.migration-dialog form > footer button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}
.migration-dialog form > footer .primary-button {
  color: #fff;
  border-color: var(--canvas-accent);
  background: var(--canvas-accent);
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
  .migration-dialog form {
    grid-template-columns: 1fr;
  }
  .migration-dialog form > p,
  .plugin-readiness,
  .migration-dialog form > footer {
    grid-column: auto;
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

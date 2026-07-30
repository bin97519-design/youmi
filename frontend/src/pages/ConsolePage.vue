<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { match as matchPinyin } from 'pinyin-pro'
import ConsolePagination from '../components/console/ConsolePagination.vue'
import FinancePanel from '../components/console/FinancePanel.vue'
import ImageViewer from '../components/ImageViewer.vue'
import { useUserStore } from '../stores/user'
import { apiPath } from '../utils/apiBase'
import { writeTextToClipboard } from '../utils/clipboard'
import { subscribeImageTaskPersistence } from '../utils/imageTaskSync'

const userStore = useUserStore()
const activeTab = ref('stats')
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const users = ref([])
const roles = ref([])
const stats = ref(null)
const financeRefreshKey = ref(0)
const elapsedClock = ref(Date.now())
let elapsedTimer = null
let taskRefreshTimer = null
let unsubscribeTaskPersistence = null

function parseImageUrls(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter((url) => typeof url === 'string' && url.trim())
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((url) => typeof url === 'string' && url.trim())
      : typeof parsed === 'string' && parsed.trim()
        ? [parsed]
        : []
  } catch {
    return raw.trim() ? [raw.trim()] : []
  }
}

function normalizeImageStats(imageStats) {
  if (!imageStats) return imageStats
  return {
    ...imageStats,
    tasks: (imageStats.tasks || []).map((task) => {
      const persisted = parseImageUrls(task.resultUrls)
      const original = parseImageUrls(task.imageUrls)
      const previewUrls = [...new Set(persisted.length ? persisted : original)]
      const sourceStatus = String(task.status || '').trim().toLowerCase()
      const failed = ['failed', 'error', 'cancelled', 'canceled'].includes(sourceStatus)
      const imageGenerated = previewUrls.length > 0 && !failed
      const persistStatus = String(
        task.persistStatus || (persisted.length ? 'DONE' : sourceStatus === 'persisting' ? 'PENDING' : ''),
      ).toUpperCase()
      return {
        ...task,
        sourceStatus,
        status: imageGenerated ? 'completed' : task.status,
        persistStatus,
        previewUrls,
      }
    }),
  }
}

const taskImageViewer = reactive({ open: false, urls: [], index: 0, title: '' })
const taskPromptTooltip = reactive({
  show: false,
  text: '',
  left: 0,
  top: 0,
  width: 560,
  above: false,
  copied: false,
})
let taskPromptTooltipHideTimer = null

function cancelTaskPromptTooltipHide() {
  if (!taskPromptTooltipHideTimer) return
  window.clearTimeout(taskPromptTooltipHideTimer)
  taskPromptTooltipHideTimer = null
}

function showTaskPromptTooltip(task, event) {
  const text = String(task?.prompt || '').trim()
  const target = event?.currentTarget
  if (!text || !(target instanceof HTMLElement)) return

  cancelTaskPromptTooltipHide()
  const rect = target.getBoundingClientRect()
  const edge = 16
  const width = Math.min(560, Math.max(240, window.innerWidth - edge * 2))
  taskPromptTooltip.text = text
  taskPromptTooltip.copied = false
  taskPromptTooltip.width = width
  taskPromptTooltip.left = Math.min(
    Math.max(rect.left, edge),
    Math.max(edge, window.innerWidth - width - edge),
  )
  taskPromptTooltip.above = rect.top > window.innerHeight - rect.bottom
  taskPromptTooltip.top = taskPromptTooltip.above ? rect.top - 8 : rect.bottom + 8
  taskPromptTooltip.show = true
}

async function copyTaskPrompt() {
  const text = taskPromptTooltip.text
  if (!text) return

  try {
    await writeTextToClipboard(text)
    taskPromptTooltip.copied = true
    showToast('提示词已复制')
  } catch {
    showToast('复制失败，请手动复制', 'error')
  }
}

function hideTaskPromptTooltip() {
  cancelTaskPromptTooltipHide()
  taskPromptTooltip.show = false
}

function queueTaskPromptTooltipHide() {
  cancelTaskPromptTooltipHide()
  taskPromptTooltipHideTimer = window.setTimeout(() => {
    taskPromptTooltip.show = false
    taskPromptTooltipHideTimer = null
  }, 140)
}

function openTaskImageViewer(task, index = 0) {
  if (!task.previewUrls?.length) return
  taskImageViewer.urls = task.previewUrls
  taskImageViewer.index = Math.min(index, task.previewUrls.length - 1)
  taskImageViewer.title = task.taskId || '生图结果'
  taskImageViewer.open = true
}

function closeTaskImageViewer() {
  taskImageViewer.open = false
}

function downloadTaskImage(image) {
  if (!image?.url) return
  const link = document.createElement('a')
  link.href = image.url
  link.download = image.name || '生图结果'
  link.target = '_blank'
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

const finishedTaskCount = computed(
  () => (stats.value?.summary?.completedTasks || 0) + (stats.value?.summary?.failedTasks || 0),
)
const overallSuccessRate = computed(() => {
  const finished = finishedTaskCount.value
  if (!finished) return '--'
  return `${(((stats.value?.summary?.completedTasks || 0) / finished) * 100).toFixed(1)}%`
})

const providerLabelMap = {
  apimart: 'APIMart',
  'apimart-direct': 'APIMart',
  gettoken: 'GetToken',
  lk888: 'LK888',
  proxy: 'Proxy 兜底',
  agnes: 'Agnes',
  unknown: '其他通道',
}

function providerLabel(provider) {
  return providerLabelMap[provider] || provider || '未知'
}

function taskProviderLabel(provider) {
  return provider === 'proxy' ? 'Proxy' : providerLabel(provider)
}

/* ── 角色判断 ── */
const isAdmin = computed(() => {
  const profile = userStore.profile
  if (!profile) return false
  return Array.isArray(profile.roles) && profile.roles.includes('ADMIN')
})

/* ── Toast ── */
const toasts = ref([])
let toastId = 0
function showToast(message, type = 'success') {
  const id = ++toastId
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, 3200)
}

/* ── Search / Filter ── */
const userSearch = ref('')
const roleSearch = ref('')
const taskStatusFilter = ref('')
const taskModelFilter = ref('')
const taskUserFilter = ref('')
const taskUserSearch = ref('')
const taskUserSearchInput = ref(null)
// 日期范围筛选（最近生图任务）：格式 YYYY-MM-DD，空 = 不限
const taskDateFrom = ref('')
const taskDateTo = ref('')
const shopFilter = ref('')
const platformFilter = ref('')
const shops = ref([])
const platforms = ref([])
const activePlatforms = computed(() =>
  platforms.value.filter((platform) => platform.status !== 'DISABLED'),
)

/* ── 账号详情/编辑抽屉 ── */
const drawerOpen = ref(false)
const editingUser = reactive({
  id: null,
  account: '',
  nickname: '',
  phone: '',
  status: 'ACTIVE',
  miValue: 0,
  planName: '普通用户',
  roleDraft: 'USER',
  shopId: '',
  shopPlatformId: '',
  shopPlatform: '',
  passwordDraft: '',
})
const passwordResetSaving = ref(false)
const passwordResetDialog = reactive({
  open: false,
  userId: null,
  account: '',
  password: '',
  confirmPassword: '',
  showPassword: false,
})

const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  const sf = shopFilter.value
  const pf = platformFilter.value
  return users.value.filter((u) => {
    if (q) {
      const hit =
        (u.account || '').toLowerCase().includes(q) ||
        (u.nickname || '').toLowerCase().includes(q) ||
        String(u.id).includes(q)
      if (!hit) return false
    }
    // 店铺筛选：AND 关系（不匹配就过滤掉，继续往下检查平台）
    if (sf === 'UNBOUND') { if (u.shopId) return false }
    else if (sf) { if (String(u.shopId) !== String(sf)) return false }
    // 平台筛选：AND 关系
    if (pf && String(u.shopPlatformId || '') !== String(pf)) return false
    return true
  })
})

/* ── 账号列表分页 ── */
const userCurrentPage = ref(1)
const userPageSize = ref(10)
const userTotal = computed(() => filteredUsers.value.length)
const userTotalPages = computed(() => Math.max(1, Math.ceil(userTotal.value / userPageSize.value)))
const pagedUsers = computed(() => {
  const start = (userCurrentPage.value - 1) * userPageSize.value
  return filteredUsers.value.slice(start, start + userPageSize.value)
})

function changeUserPage(page) {
  userCurrentPage.value = Math.min(Math.max(1, page), userTotalPages.value)
}

function changeUserPageSize(size) {
  userPageSize.value = size
  userCurrentPage.value = 1
}

watch([userSearch, shopFilter, platformFilter], () => {
  userCurrentPage.value = 1
})

watch(userTotalPages, (totalPages) => {
  if (userCurrentPage.value > totalPages) userCurrentPage.value = totalPages
})

const filteredRoles = computed(() => {
  const q = roleSearch.value.trim().toLowerCase()
  if (!q) return roles.value
  return roles.value.filter(
    (r) => (r.code || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q),
  )
})

const filteredTasks = computed(() => {
  let list = stats.value?.tasks || []
  if (taskStatusFilter.value)
    list = list.filter((t) => taskStatusKey(t.status) === taskStatusFilter.value)
  if (taskModelFilter.value)
    list = list.filter((t) => (t.requestedModel || t.model) === taskModelFilter.value)
  if (taskUserFilter.value)
    list = list.filter((t) => String(t.userId) === taskUserFilter.value)
  return list
})

/* ── 最近生图任务分页（客户端分页，复用 image-stats 接口重新加载） ── */
const taskCurrentPage = ref(1)
const taskPageSize = ref(10)
const taskReloading = ref(false)

const pagedTasks = computed(() => {
  const list = filteredTasks.value
  const start = (taskCurrentPage.value - 1) * taskPageSize.value
  return list.slice(start, start + taskPageSize.value)
})
const taskTotal = computed(() => filteredTasks.value.length)
const taskTotalPages = computed(() => Math.max(1, Math.ceil(taskTotal.value / taskPageSize.value)))
/* 筛选条件变化只重置页码，保留筛选值 */
watch([taskStatusFilter, taskModelFilter, taskUserFilter], () => {
  taskCurrentPage.value = 1
})

/* ── 日期范围筛选（最近生图任务） ── */
// 本地日期格式化（避免 toISOString 的 UTC 时区偏移导致跨天误差）
function fmtDateValue(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function shiftDays(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return fmtDateValue(d)
}
const todayStr = fmtDateValue(new Date())
const sevenDaysAgoStr = shiftDays(7)
// 默认最近 7 天，页面一进来就只显示近 7 天的数据
taskDateFrom.value = sevenDaysAgoStr
taskDateTo.value = todayStr

const showDatePicker = ref(false)

const dateShortcuts = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '最近7天' },
  { key: 'month', label: '最近30天' },
  { key: 'all', label: '全部' },
]

const activeShortcut = computed(() => {
  if (!taskDateFrom.value && !taskDateTo.value) return 'all'
  const from = taskDateFrom.value
  const to = taskDateTo.value
  if (from === to && from === todayStr) return 'today'
  if (from === shiftDays(7) && to === todayStr) return 'week'
  if (from === shiftDays(30) && to === todayStr) return 'month'
  return ''
})

// 去掉年份显示（2026-07-11 → 07/11）
function fmtShort(d) { return d ? d.slice(5).replace('-', '/') : '' }

const dateDisplayText = computed(() => {
  if (activeShortcut.value === 'all') return '全部日期'
  if (activeShortcut.value === 'today') return '今天'
  if (activeShortcut.value === 'week') return '最近7天'
  if (activeShortcut.value === 'month') return '最近30天'
  if (taskDateFrom.value && taskDateTo.value) return `${fmtShort(taskDateFrom.value)} ~ ${fmtShort(taskDateTo.value)}`
  if (taskDateFrom.value) return `${fmtShort(taskDateFrom.value)} 起`
  if (taskDateTo.value) return `${fmtShort(taskDateTo.value)} 止`
  return '日期范围'
})

function applyDateShortcut(key) {
  const toStr = todayStr
  switch (key) {
    case 'today':
      taskDateFrom.value = toStr
      taskDateTo.value = toStr
      break
    case 'week':
      taskDateFrom.value = shiftDays(7)
      taskDateTo.value = toStr
      break
    case 'month':
      taskDateFrom.value = shiftDays(30)
      taskDateTo.value = toStr
      break
    case 'all':
    default:
      taskDateFrom.value = ''
      taskDateTo.value = ''
      break
  }
  showDatePicker.value = false
}

// 拼接日期筛选 query 参数（dateFrom / dateTo）
function buildImageStatsQuery() {
  const params = new URLSearchParams()
  if (taskDateFrom.value) params.set('dateFrom', taskDateFrom.value)
  if (taskDateTo.value) params.set('dateTo', taskDateTo.value)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

// 日期变化 → 重置页码并重新拉取（日期过滤在后端 SQL 完成）
watch([taskDateFrom, taskDateTo], () => {
  taskCurrentPage.value = 1
  reloadTaskPage(1)
})

async function reloadTaskPage(p) {
  const target = Math.min(Math.max(1, p), taskTotalPages.value)
  taskReloading.value = true
  taskCurrentPage.value = target
  try {
    const imageStats = await api('/api/admin/image-stats' + buildImageStatsQuery())
    stats.value = normalizeImageStats(imageStats)
  } catch (e) {
    /* 静默失败，仍展示已分页数据 */
  } finally {
    taskReloading.value = false
  }
}

function changeTaskPageSize(size) {
  taskPageSize.value = size
  taskCurrentPage.value = 1
}

const taskModelOptions = computed(() => {
  const set = new Set((stats.value?.tasks || []).map((t) => t.requestedModel || t.model))
  return [...set].filter(Boolean)
})

const taskUserOptions = computed(() => {
  const userIds = new Set((stats.value?.tasks || []).map((t) => String(t.userId)).filter(Boolean))
  return users.value.filter((u) => userIds.has(String(u.id)))
})

const searchedTaskUserOptions = computed(() => {
  const keyword = taskUserSearch.value.trim().toLowerCase()
  if (!keyword) return taskUserOptions.value
  return taskUserOptions.value.filter((user) =>
    [user.nickname, user.account, user.phone, user.id].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(keyword),
    ),
  )
})

const tabs = computed(() => {
  const list = []
  if (isAdmin.value) {
    list.push({ key: 'accounts', label: '账号管理' })
    list.push({ key: 'roles', label: '角色管理' })
    list.push({ key: 'finance', label: '财务统计' })
  }
  list.push({ key: 'stats', label: '生图统计' })
  return list
})

const userForm = reactive({
  account: '',
  phone: '',
  nickname: '',
  password: '',
  status: 'ACTIVE',
  miValue: 100,
  planName: '普通用户',
  roles: ['USER'],
  shopId: '',
  shopInput: '',
  shopPlatformId: '',
  shopPlatform: '',
})

const roleForm = reactive({
  code: '',
  name: '',
  permissionsText: 'image:generate',
})

const roleOptions = computed(() => roles.value.map((role) => role.code))
const summary = computed(() => stats.value?.summary || {})

/** 解析用户输入的店铺值：返回 { shopId, shopName } */
function resolveShopInput(input) {
  const name = (input || '').trim()
  if (!name) return { shopId: null, shopName: '' }
  const selectedPlatformId = String(userForm.shopPlatformId || '')
  const matched =
    shops.value.find(
      (shop) =>
        shop.name === name &&
        (!selectedPlatformId || String(shop.platformId) === selectedPlatformId),
    ) || shops.value.find((shop) => shop.name === name)
  if (matched) return { shopId: Number(matched.id), shopName: '' }
  return { shopId: null, shopName: name }
}

function platformName(platformId) {
  const platform = platforms.value.find(
    (item) => String(item.id) === String(platformId || ''),
  )
  return platform?.name || ''
}

function selectCreatePlatform(platform) {
  userForm.shopPlatformId = String(platform.id)
  userForm.shopPlatform = platform.name
  closeDropdown('createPlatform')
}

function selectCreateShop(shop) {
  userForm.shopId = String(shop.id)
  userForm.shopInput = shop.name
  userForm.shopPlatformId = String(shop.platformId || '')
  userForm.shopPlatform = shop.platformName || shop.platform || ''
  closeDropdown('createShop')
}

function selectEditShop(shop) {
  editingUser.shopId = String(shop.id)
  editingUser.shopPlatformId = String(shop.platformId || '')
  editingUser.shopPlatform = shop.platformName || shop.platform || ''
  closeDropdown('editShop')
}

async function api(path, options = {}) {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...userStore.authHeaders(),
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.code !== 0) {
    const message = payload?.message || `请求失败：${response.status}`
    if (response.status === 401) userStore.openLogin()
    throw new Error(message)
  }
  return payload.data
}

async function loadConsole() {
  if (!userStore.requireLogin()) return
  loading.value = true
  errorText.value = ''
  try {
    const requests = [api('/api/admin/image-stats' + buildImageStatsQuery())]
    if (isAdmin.value) {
      requests.push(
        api('/api/admin/users').catch(() => []),
        api('/api/admin/roles').catch(() => []),
        api('/api/admin/shops').catch(() => []),
        api('/api/admin/platforms').catch(() => []),
      )
    }
    const [
      imageStats,
      userRows = [],
      roleRows = [],
      shopRows = [],
      platformRows = [],
    ] = await Promise.all(requests)
    stats.value = normalizeImageStats(imageStats)
    if (isAdmin.value) {
      roles.value = roleRows.map(normalizeRole)
      users.value = userRows.map(normalizeUser)
      shops.value = shopRows
      platforms.value = platformRows
    }
  } catch (error) {
    /* 非管理员请求 admin 接口返回 403 是预期行为，不必提示 */
    if (!/403|没有控制台权限/.test(error.message)) {
      errorText.value = error.message || '控制台数据加载失败'
    }
  } finally {
    loading.value = false
    if (activeTab.value === 'finance') financeRefreshKey.value += 1
  }
}

async function createUser() {
  /* 必填校验：禁止创建无密码/弱密码账号（不再默认 123456） */
  if (!userForm.password) {
    showToast('请设置登录密码', 'error')
    return
  }
  saving.value = true
  errorText.value = ''
  try {
    const { shopId: resolvedShopId, shopName: resolvedShopName } = resolveShopInput(userForm.shopInput)
    if (resolvedShopName && !userForm.shopPlatformId) {
      showToast('新建店铺时请选择所属平台', 'error')
      return
    }
    const created = await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        account: userForm.account,
        phone: userForm.phone,
        nickname: userForm.nickname,
        password: userForm.password,
        status: userForm.status,
        miValue: Number(userForm.miValue || 0),
        planName: userForm.planName,
        shopId: resolvedShopId,
        shopName: resolvedShopName,
        shopPlatformId: userForm.shopPlatformId
          ? Number(userForm.shopPlatformId)
          : null,
        shopPlatform: userForm.shopPlatform || null,
        roles: [userForm.roles[0] || 'USER'],
      }),
    })
    users.value = [normalizeUser(created), ...users.value]
    resetUserForm()
    showToast('账号创建成功')
  } catch (error) {
    errorText.value = error.message || '用户创建失败'
    showToast(error.message || '用户创建失败', 'error')
  } finally {
    saving.value = false
  }
}

async function saveUser(user) {
  saving.value = true
  errorText.value = ''
  try {
    const updated = await api(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        phone: user.phone,
        nickname: user.nickname,
        password: user.passwordDraft || '',
        status: user.status,
        miValue: Number(user.miValue || 0),
        planName: user.planName,
        shopId: user.shopId ?? null,
        roles: [user.roleDraft || 'USER'],
      }),
    })
    users.value = users.value.map((item) =>
      item.id === updated.id ? normalizeUser(updated) : item,
    )
    showToast('账号保存成功')
  } catch (error) {
    errorText.value = error.message || '用户保存失败'
    showToast(error.message || '用户保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteUser(user) {
  if (!confirm(`确定删除账号「${user.account}」？此操作不可恢复。`)) return
  saving.value = true
  errorText.value = ''
  try {
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    users.value = users.value.filter((item) => item.id !== user.id)
    showToast('账号已删除')
  } catch (error) {
    errorText.value = error.message || '删除失败'
    showToast(error.message || '删除失败', 'error')
  } finally {
    saving.value = false
  }
}

function openPasswordReset(user) {
  Object.assign(passwordResetDialog, {
    open: true,
    userId: user.id,
    account: user.account,
    password: '',
    confirmPassword: '',
    showPassword: false,
  })
}

function closePasswordReset() {
  if (passwordResetSaving.value) return
  Object.assign(passwordResetDialog, {
    open: false,
    userId: null,
    account: '',
    password: '',
    confirmPassword: '',
    showPassword: false,
  })
}

async function submitPasswordReset() {
  if (passwordResetDialog.password.length < 6) {
    showToast('新密码不能少于6位', 'error')
    return
  }
  if (passwordResetDialog.password.length > 64) {
    showToast('新密码不能超过64位', 'error')
    return
  }
  if (passwordResetDialog.password !== passwordResetDialog.confirmPassword) {
    showToast('两次输入的密码不一致', 'error')
    return
  }

  passwordResetSaving.value = true
  errorText.value = ''
  try {
    await api(`/api/admin/users/${passwordResetDialog.userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: passwordResetDialog.password }),
    })
    const account = passwordResetDialog.account
    passwordResetSaving.value = false
    closePasswordReset()
    showToast(`账号「${account}」的密码已重置`)
  } catch (error) {
    errorText.value = error.message || '密码重置失败'
    showToast(error.message || '密码重置失败', 'error')
    passwordResetSaving.value = false
  }
}

async function createRole() {
  saving.value = true
  errorText.value = ''
  try {
    const created = await api('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({
        code: roleForm.code,
        name: roleForm.name,
        permissions: splitPermissions(roleForm.permissionsText),
      }),
    })
    roles.value = [...roles.value, normalizeRole(created)]
    resetRoleForm()
    showToast('角色创建成功')
  } catch (error) {
    errorText.value = error.message || '角色创建失败'
    showToast(error.message || '角色创建失败', 'error')
  } finally {
    saving.value = false
  }
}

async function saveRole(role) {
  saving.value = true
  errorText.value = ''
  try {
    const updated = await api(`/api/admin/roles/${role.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: role.name,
        permissions: splitPermissions(role.permissionsDraft),
      }),
    })
    roles.value = roles.value.map((item) =>
      item.id === updated.id ? normalizeRole(updated) : item,
    )
    showToast('角色保存成功')
  } catch (error) {
    errorText.value = error.message || '角色保存失败'
    showToast(error.message || '角色保存失败', 'error')
  } finally {
    saving.value = false
  }
}

async function deleteRole(role) {
  if (!confirm(`确定删除角色「${role.code}」？此操作不可恢复。`)) return
  saving.value = true
  errorText.value = ''
  try {
    await api(`/api/admin/roles/${role.id}`, { method: 'DELETE' })
    roles.value = roles.value.filter((item) => item.id !== role.id)
    showToast('角色已删除')
  } catch (error) {
    errorText.value = error.message || '删除失败'
    showToast(error.message || '删除失败', 'error')
  } finally {
    saving.value = false
  }
}

function normalizeUser(user) {
  return {
    ...user,
    phone: user.phone || '',
    nickname: user.nickname || '',
    planName: user.planName || '普通用户',
    roleDraft: user.roles?.[0] || 'USER',
    passwordDraft: '',
  }
}

function normalizeRole(role) {
  return {
    ...role,
    permissionsDraft: (role.permissions || []).join(', '),
  }
}

function splitPermissions(value) {
  return String(value || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function resetUserForm() {
  Object.assign(userForm, {
    account: '',
    phone: '',
    nickname: '',
    password: '',
    status: 'ACTIVE',
    miValue: 100,
    planName: '普通用户',
    roles: ['USER'],
    shopId: '',
    shopInput: '',
    shopPlatformId: '',
    shopPlatform: '',
  })
}

/* ── 账号详情/编辑抽屉 ── */
function openDrawer(user) {
  drawerOpen.value = true
  Object.assign(editingUser, {
    id: user.id,
    account: user.account,
    nickname: user.nickname || '',
    phone: user.phone || '',
    status: user.status || 'ACTIVE',
    miValue: user.miValue || 0,
    planName: user.planName || '普通用户',
    roleDraft: user.roles?.[0] || 'USER',
    shopId: user.shopId != null ? String(user.shopId) : '',
    shopPlatformId: user.shopPlatformId != null ? String(user.shopPlatformId) : '',
    shopPlatform: user.shopPlatform || '',
    passwordDraft: '',
  })
}

function closeDrawer() {
  drawerOpen.value = false
}

async function saveUserDetail() {
  saving.value = true
  errorText.value = ''
  try {
    const payload = {
      phone: editingUser.phone || '',
      nickname: editingUser.nickname || '',
      password: '',
      status: editingUser.status,
      miValue: Number(editingUser.miValue || 0),
      planName: editingUser.planName || '普通用户',
      roles: [editingUser.roleDraft || 'USER'],
      shopId:
        editingUser.shopId === '' || editingUser.shopId == null
          ? null
          : Number(editingUser.shopId),
    }
    const updated = await api(`/api/admin/users/${editingUser.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    users.value = users.value.map((item) =>
      item.id === updated.id ? normalizeUser(updated) : item,
    )
    drawerOpen.value = false
    showToast('账号保存成功')
  } catch (error) {
    errorText.value = error.message || '保存失败'
    showToast(error.message || '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

function resetRoleForm() {
  Object.assign(roleForm, {
    code: '',
    name: '',
    permissionsText: 'image:generate',
  })
}

function formatTime(value) {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 16)
}

const shouldRefreshTaskStats = computed(() =>
  (stats.value?.tasks || []).some(
    (task) => isTaskRunning(task) || String(task.persistStatus || '').toUpperCase() === 'PENDING',
  ),
)

async function refreshTaskStatsSilently({ force = false } = {}) {
  if (
    document.hidden ||
    activeTab.value !== 'stats' ||
    loading.value ||
    taskReloading.value ||
    (!force && !shouldRefreshTaskStats.value)
  ) {
    return
  }
  try {
    const imageStats = await api('/api/admin/image-stats' + buildImageStatsQuery())
    stats.value = normalizeImageStats(imageStats)
  } catch {
    // 保留当前数据，下一轮再同步任务状态与永久链接。
  }
}

function onImageTaskPersistence(detail) {
  if (!detail?.taskId || !stats.value) return
  const persistStatus = String(detail.persistStatus || '').toUpperCase()
  stats.value = {
    ...stats.value,
    tasks: (stats.value.tasks || []).map((task) => {
      if (task.taskId !== detail.taskId) return task
      return {
        ...task,
        status: 'completed',
        persistStatus,
        previewUrls: detail.imageUrl ? [detail.imageUrl] : task.previewUrls,
      }
    }),
  }
  void refreshTaskStatsSilently({ force: true })
}

function onVisibilityChange() {
  if (!document.hidden) void refreshTaskStatsSilently({ force: true })
}

function taskDuration(task) {
  const startedAt = Date.parse(task?.createdAt || '')
  if (!Number.isFinite(startedAt)) return '-'
  const status = taskStatusKey(task?.status)
  const terminal =
    status === 'COMPLETED' || status === 'FAILED' || Boolean(task?.previewUrls?.length)
  const completedAt = Date.parse(task?.completedAt || '')
  if (terminal && !Number.isFinite(completedAt)) return '--'
  const endedAt = Number.isFinite(completedAt) ? completedAt : elapsedClock.value
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000))
  if (seconds < 1) return '<1秒'
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes}分${String(remainingSeconds).padStart(2, '0')}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}时${String(minutes % 60).padStart(2, '0')}分`
}

function taskResolution(task) {
  const resolution = String(task?.resolution || '').trim()
  return resolution ? resolution.toUpperCase() : '-'
}

function isTaskRunning(task) {
  const status = taskStatusKey(task?.status)
  return (
    status !== 'COMPLETED' &&
    status !== 'FAILED' &&
    !task?.completedAt &&
    !task?.previewUrls?.length
  )
}

/* ── 中文映射 ── */
const roleLabelMap = {
  ADMIN: '管理员',
  USER: '用户',
  OPERATOR: '运营',
  EDITOR: '编辑',
  DESIGNER: '设计师',
}
const statusLabelMap = { ACTIVE: '启用', DISABLED: '禁用' }
const taskStatusLabelMap = {
  COMPLETED: '已完成',
  SUCCEEDED: '已完成',
  SUCCESS: '已完成',
  DONE: '已完成',
  FAILED: '失败',
  ERROR: '失败',
  CANCELLED: '已取消',
  CANCELED: '已取消',
  PENDING: '等待中',
  PROCESSING: '生成中',
}

function roleLabel(code) {
  return roleLabelMap[code] || code
}
function statusLabel(s) {
  return statusLabelMap[s] || s
}
function taskStatusKey(status) {
  const value = String(status || '').trim().toUpperCase()
  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'DONE'].includes(value)) return 'COMPLETED'
  if (['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'].includes(value)) return 'FAILED'
  if (['PENDING', 'WAITING', 'QUEUED', 'SUBMITTED'].includes(value)) return 'PENDING'
  if (['PROCESSING', 'RUNNING', 'GENERATING', 'IN_PROGRESS', 'PERSISTING'].includes(value)) return 'PROCESSING'
  return value
}
function taskStatusLabel(s) {
  return taskStatusLabelMap[taskStatusKey(s)] || s
}

function taskPersistStatus(task) {
  const value = String(task?.persistStatus || '').toUpperCase()
  if (value === 'PENDING') return { label: '转存中', className: 'pending' }
  if (value === 'DONE') return { label: '已转存', className: 'done' }
  if (value === 'FAILED') return { label: '转存失败', className: 'failed' }
  return null
}

/* ── 自定义下拉框状态 ── */
const dropdownOpen = reactive({
  createStatus: false,
  createRole: false,
  createShop: false,
  createPlatform: false,
  editPlatform: false,
  editStatus: false,
  editRole: false,
  editShop: false,
  filterShop: false,
  filterPlatform: false,
  filterTaskStatus: false,
  filterTaskModel: false,
  filterTaskUser: false,
})

function toggleDropdown(key) {
  Object.keys(dropdownOpen).forEach((k) => {
    if (k !== key) dropdownOpen[k] = false
  })
  dropdownOpen[key] = !dropdownOpen[key]
}

function closeDropdown(key) {
  dropdownOpen[key] = false
}

function toggleTaskUserDropdown() {
  toggleDropdown('filterTaskUser')
  if (!dropdownOpen.filterTaskUser) return
  taskUserSearch.value = ''
  nextTick(() => taskUserSearchInput.value?.focus())
}

function selectTaskUser(userId = '') {
  taskUserFilter.value = String(userId)
  taskUserSearch.value = ''
  closeDropdown('filterTaskUser')
}

function onDocClick() {
  Object.keys(dropdownOpen).forEach((k) => (dropdownOpen[k] = false))
  showDatePicker.value = false
  trendDropdownOpen.value = false
}

function shopLabel(shopId) {
  const shop = shops.value.find((s) => String(s.id) === shopId)
  return shop ? shop.name : ''
}

function taskUserLabel(userId) {
  const user = taskUserOptions.value.find((u) => String(u.id) === userId)
  return user ? user.nickname || user.account || user.id : userId
}

/* ── Canvas 折线图 ── */
const trendCanvas = ref(null)
const trendCard = ref(null)
const trendFilterRow = ref(null)
const trendDimension = ref('total')
const trendFilter = ref('')
const trendSelectedKey = ref('')
const trendDropdownOpen = ref(false)
const trendDropdownMaxHeight = ref(240)
const trendTooltip = reactive({ show: false, x: 0, y: 0, label: '', items: [] })
const trendPalette = ['#818cf8', '#22d3ee', '#f59e0b', '#34d399', '#f472b6']
const trendTabs = [
  { key: 'total', label: '总量' },
  { key: 'model', label: '模型' },
  { key: 'shop', label: '店铺' },
  { key: 'user', label: '个人' },
]

const trendDimensionConfig = computed(() => {
  if (trendDimension.value === 'model') {
    return { rows: stats.value?.modelTrends || [], placeholder: '筛选模型' }
  }
  if (trendDimension.value === 'shop') {
    return { rows: stats.value?.shopTrends || [], placeholder: '筛选店铺' }
  }
  if (trendDimension.value === 'user') {
    return { rows: stats.value?.userTrends || [], placeholder: '筛选账号或昵称' }
  }
  const daily = stats.value?.daily || []
  return {
    rows: [
      {
        key: 'total',
        label: '总量',
        totalTasks: daily.reduce((sum, point) => sum + Number(point.tasks || 0), 0),
        daily,
      },
    ],
    placeholder: '',
  }
})

function matchesTrendOption(row, rawQuery) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true
  const label = String(row.label || '')
  const searchable = `${label} ${row.key || ''}`.toLowerCase()
  if (searchable.includes(query)) return true
  return Boolean(matchPinyin(label, query))
}

const trendFilterOptions = computed(() =>
  [...trendDimensionConfig.value.rows]
    .filter((row) => matchesTrendOption(row, trendFilter.value))
    .sort((left, right) => Number(right.totalTasks || 0) - Number(left.totalTasks || 0)),
)

const trendVisibleSeries = computed(() => {
  const selected = trendSelectedKey.value
    ? trendDimensionConfig.value.rows.find((row) => String(row.key) === trendSelectedKey.value)
    : null
  const rows = selected ? [selected] : trendDimensionConfig.value.rows
  return [...rows]
    .sort((left, right) => Number(right.totalTasks || 0) - Number(left.totalTasks || 0))
    .slice(0, 5)
})

const trendFilterCount = computed(() => {
  if (trendSelectedKey.value) return 1
  if (trendFilter.value.trim()) return trendFilterOptions.value.length
  return Math.min(5, trendDimensionConfig.value.rows.length)
})

async function updateTrendDropdownHeight() {
  await nextTick()
  const card = trendCard.value
  const row = trendFilterRow.value
  if (!card || !row) return
  const chart = card.querySelector('.console-trend-wrap')
  const boundaryBottom = chart?.getBoundingClientRect().bottom || card.getBoundingClientRect().bottom
  const available = Math.floor(boundaryBottom - row.getBoundingClientRect().bottom - 12)
  trendDropdownMaxHeight.value = Math.max(80, Math.min(260, available))
}

function openTrendDropdown() {
  trendDropdownOpen.value = true
  updateTrendDropdownHeight()
}

function toggleTrendDropdown() {
  trendDropdownOpen.value = !trendDropdownOpen.value
  if (trendDropdownOpen.value) updateTrendDropdownHeight()
}

function onTrendFilterInput() {
  trendSelectedKey.value = ''
  openTrendDropdown()
}

function selectTrendOption(option) {
  trendSelectedKey.value = option ? String(option.key) : ''
  trendFilter.value = option?.label || ''
  trendDropdownOpen.value = false
  trendTooltip.show = false
}

function clearTrendFilter() {
  trendFilter.value = ''
  trendSelectedKey.value = ''
  openTrendDropdown()
}

const trendDayLabels = computed(() => {
  const days = []
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = new Date()
    day.setHours(12, 0, 0, 0)
    day.setDate(day.getDate() - offset)
    days.push(fmtDateValue(day))
  }
  return days
})

const trendHasData = computed(() =>
  trendVisibleSeries.value.some((series) =>
    (series.daily || []).some((point) => Number(point.tasks || 0) > 0),
  ),
)

watch(trendDimension, () => {
  trendFilter.value = ''
  trendSelectedKey.value = ''
  trendDropdownOpen.value = false
  trendTooltip.show = false
})

function drawTrendChart() {
  const canvas = trendCanvas.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const W = rect.width
  const H = rect.height
  const padL = 36,
    padR = 12,
    padT = 12,
    padB = 28
  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const days = trendDayLabels.value
  const series = trendVisibleSeries.value.map((item, index) => {
    const valuesByDay = new Map(
      (item.daily || []).map((point) => [point.day, Number(point.tasks || 0)]),
    )
    return {
      key: item.key,
      label: item.label || item.key,
      color: trendPalette[index % trendPalette.length],
      values: days.map((day) => valuesByDay.get(day) || 0),
    }
  })
  const values = series.flatMap((item) => item.values)
  const maxVal = Math.max(...values, 1)
  const stepX = days.length > 1 ? chartW / (days.length - 1) : chartW

  const isLight = document.documentElement.getAttribute('data-theme') === 'light'

  /* grid lines */
  ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(W - padR, y)
    ctx.stroke()
  }

  /* y-axis labels */
  ctx.fillStyle = isLight ? '#94a3b8' : '#64748b'
  ctx.font = '11px Inter, system-ui'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i
    const val = Math.round(maxVal * (1 - i / 4))
    ctx.fillText(val, padL - 6, y + 4)
  }

  /* x-axis labels */
  ctx.textAlign = 'center'
  days.forEach((day, i) => {
    if (i % 2 !== 0 && i !== days.length - 1) return
    const x = padL + stepX * i
    ctx.fillText(day.slice(5), x, H - 6)
  })

  if (series.length === 1) {
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
    grad.addColorStop(0, isLight ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.25)')
    grad.addColorStop(1, isLight ? 'rgba(99,102,241,0.01)' : 'rgba(99,102,241,0.02)')
    ctx.beginPath()
    series[0].values.forEach((value, i) => {
      const x = padL + stepX * i
      const y = padT + chartH - (value / maxVal) * chartH
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(padL + stepX * (days.length - 1), padT + chartH)
    ctx.lineTo(padL, padT + chartH)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()
  }

  series.forEach((item) => {
    ctx.beginPath()
    ctx.strokeStyle = item.color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    item.values.forEach((value, i) => {
      const x = padL + stepX * i
      const y = padT + chartH - (value / maxVal) * chartH
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()

    item.values.forEach((value, i) => {
      const x = padL + stepX * i
      const y = padT + chartH - (value / maxVal) * chartH
      ctx.beginPath()
      ctx.arc(x, y, series.length > 2 ? 2.5 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = item.color
      ctx.fill()
      ctx.strokeStyle = isLight ? '#fff' : '#0f172a'
      ctx.lineWidth = 1.25
      ctx.stroke()
    })
  })

  /* store for hover */
  canvas._chartData = { padL, padT, chartH, stepX, maxVal, days, series }
}

function handleTrendMove(e) {
  const canvas = trendCanvas.value
  if (!canvas?._chartData) return
  const { padL, padT, chartH, stepX, maxVal, days, series } = canvas._chartData
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const idx = Math.round((mx - padL) / stepX)
  if (idx < 0 || idx >= days.length || !series.length) {
    trendTooltip.show = false
    return
  }
  const x = padL + stepX * idx
  const items = series.map((item) => ({
    key: item.key,
    label: item.label,
    color: item.color,
    value: item.values[idx] || 0,
  }))
  const y = Math.min(
    ...items.map((item) => padT + chartH - (item.value / maxVal) * chartH),
  )
  trendTooltip.show = true
  trendTooltip.x = x
  trendTooltip.y = y
  trendTooltip.label = days[idx]
  trendTooltip.items = items
}

function handleTrendLeave() {
  trendTooltip.show = false
}

/* ── 环形图 ── */
const donutCanvas = ref(null)

function drawDonutChart() {
  const canvas = donutCanvas.value
  if (!canvas) return
  const models = stats.value?.models || []
  if (!models.length) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const size = 160
  canvas.width = size * dpr
  canvas.height = size * dpr
  canvas.style.width = size + 'px'
  canvas.style.height = size + 'px'
  ctx.scale(dpr, dpr)

  const cx = size / 2,
    cy = size / 2,
    R = 68,
    r = 44
  const total = models.reduce((s, m) => s + (m.tasks || 0), 0) || 1
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const palette = [
    '#6366f1',
    '#06b6d4',
    '#f59e0b',
    '#10b981',
    '#ef4444',
    '#8b5cf6',
    '#ec4899',
    '#14b8a6',
  ]

  let angle = -Math.PI / 2
  models.forEach((m, i) => {
    const slice = ((m.tasks || 0) / total) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(cx, cy, R, angle, angle + slice)
    ctx.arc(cx, cy, r, angle + slice, angle, true)
    ctx.closePath()
    ctx.fillStyle = palette[i % palette.length]
    ctx.fill()
    angle += slice
  })

  /* center text */
  ctx.fillStyle = isLight ? '#1e293b' : '#f1f5f9'
  ctx.font = 'bold 22px Inter, system-ui'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(total, cx, cy - 6)
  ctx.fillStyle = isLight ? '#64748b' : '#94a3b8'
  ctx.font = '11px Inter, system-ui'
  ctx.fillText('总任务', cx, cy + 12)
}

/* ── Redraw charts on tab switch / data load ── */
watch([activeTab, stats, trendDimension, trendFilter, trendSelectedKey], () => {
  nextTick(() => {
    if (activeTab.value === 'stats') {
      drawTrendChart()
      drawDonutChart()
    }
  })
})

function handleTrendResize() {
  drawTrendChart()
  if (trendDropdownOpen.value) updateTrendDropdownHeight()
}

onMounted(() => {
  loadConsole()
  elapsedTimer = window.setInterval(() => {
    elapsedClock.value = Date.now()
  }, 1000)
  taskRefreshTimer = window.setInterval(refreshTaskStatsSilently, 5000)
  unsubscribeTaskPersistence = subscribeImageTaskPersistence(onImageTaskPersistence)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', handleTrendResize)
})

onUnmounted(() => {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  if (taskRefreshTimer) window.clearInterval(taskRefreshTimer)
  cancelTaskPromptTooltipHide()
  unsubscribeTaskPersistence?.()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('resize', handleTrendResize)
})
</script>

<template>
  <main class="console-page">
    <!-- Toast -->
    <Teleport to="body">
      <div class="console-toast-wrap">
        <TransitionGroup name="console-toast">
          <div v-for="t in toasts" :key="t.id" :class="['console-toast', t.type]">
            <span class="console-toast-icon">{{ t.type === 'error' ? '\u2716' : '\u2714' }}</span>
            {{ t.message }}
          </div>
        </TransitionGroup>
      </div>
    </Teleport>

    <header class="console-head">
      <RouterLink to="/" class="console-back">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
        返回首页
      </RouterLink>
      <div>
        <h1>控制台</h1>
        <p v-if="isAdmin">账号、角色、生图用量和费用统一管理。</p>
      </div>
      <button class="console-refresh" type="button" :disabled="loading" @click="loadConsole">
        <svg
          v-if="loading"
          class="console-spin"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        {{ loading ? '刷新中...' : '刷新数据' }}
      </button>
    </header>

    <section class="console-tabs" aria-label="控制台菜单">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </section>

    <p v-if="errorText" class="console-error">{{ errorText }}</p>

    <!-- Metrics with skeleton -->
    <section v-if="activeTab !== 'finance'" class="console-metrics">
      <template v-if="loading && !users.length">
        <article v-for="i in isAdmin ? 5 : 3" :key="i" class="console-skeleton-metric">
          <span class="console-skeleton-bar" style="width: 48px"></span>
          <span class="console-skeleton-bar" style="width: 64px; height: 28px"></span>
          <span class="console-skeleton-bar" style="width: 80px"></span>
        </article>
      </template>
      <template v-else>
        <article v-if="isAdmin">
          <span>账号数</span>
          <strong>{{ users.length }}</strong>
          <small>当前系统用户</small>
        </article>
        <article v-if="isAdmin">
          <span>角色数</span>
          <strong>{{ roles.length }}</strong>
          <small>含管理员与业务角色</small>
        </article>
        <article>
          <span>生图任务</span>
          <strong>{{ summary.totalTasks || 0 }}</strong>
          <small>完成 {{ summary.completedTasks || 0 }} 个</small>
        </article>
        <article>
          <span>米值消耗</span>
          <strong>{{ summary.totalMiCost || 0 }}</strong>
          <small>生成 {{ summary.totalImages || 0 }} 张图</small>
        </article>
        <article>
          <span>整体生图成功率</span>
          <strong class="console-success-rate">{{ overallSuccessRate }}</strong>
          <small>成功 {{ summary.completedTasks || 0 }} / 已结束 {{ finishedTaskCount }}</small>
        </article>
      </template>
    </section>

    <!-- Accounts Tab -->
    <section v-if="activeTab === 'accounts'" class="console-grid">
      <form class="console-card console-form" @submit.prevent="createUser">
        <h2>新增账号</h2>
        <label>
          <span>账号</span>
          <input v-model.trim="userForm.account" placeholder="例如 operator01" required />
        </label>
        <label>
          <span>手机号</span>
          <input v-model.trim="userForm.phone" placeholder="可选" />
        </label>
        <label>
          <span>昵称</span>
          <input v-model.trim="userForm.nickname" placeholder="显示名称" />
        </label>
        <label>
          <span>初始密码</span>
          <input v-model="userForm.password" placeholder="请输入登录密码" required />
        </label>
        <div class="console-form-row">
          <label>
            <span>状态</span>
            <div class="custom-select" @click.stop="toggleDropdown('createStatus')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.createStatus }">
                {{ statusLabelMap[userForm.status] || userForm.status }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.createStatus" class="custom-select-dropdown">
                <div v-for="s in ['ACTIVE','DISABLED']" :key="s" @click.stop="userForm.status = s; closeDropdown('createStatus')" :class="{ active: userForm.status === s }">
                  {{ statusLabelMap[s] }}
                </div>
              </div>
            </div>
          </label>
          <label>
            <span>米值</span>
            <input v-model.number="userForm.miValue" type="number" min="0" />
          </label>
        </div>
        <div class="console-form-row">
          <label>
            <span>会员</span>
            <input v-model.trim="userForm.planName" />
          </label>
          <label>
            <span>角色</span>
            <div class="custom-select" @click.stop="toggleDropdown('createRole')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.createRole }">
                {{ roleLabel(userForm.roles[0]) }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.createRole" class="custom-select-dropdown">
                <div v-for="role in roleOptions" :key="role" @click.stop="userForm.roles[0] = role; closeDropdown('createRole')" :class="{ active: userForm.roles[0] === role }">
                  {{ roleLabel(role) }}
                </div>
              </div>
            </div>
          </label>
        </div>
        <div class="console-form-row">
          <label>
            <span>所属店铺</span>
            <div class="custom-combobox" @click.stop>
              <input
                v-model="userForm.shopInput"
                type="text"
                placeholder="选择或输入新店铺名称"
                @focus="dropdownOpen.createShop = true"
              />
              <div v-show="dropdownOpen.createShop" class="custom-select-dropdown">
                <div v-for="s in shops" :key="s.id" @click.stop="selectCreateShop(s)">
                  {{ s.name }} · {{ s.platformName || s.platform }}
                </div>
              </div>
            </div>
          </label>
          <label>
            <span>平台</span>
            <div class="custom-select" @click.stop="toggleDropdown('createPlatform')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.createPlatform }">
                {{ platformName(userForm.shopPlatformId) || '请选择平台' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.createPlatform" class="custom-select-dropdown">
                <div
                  v-for="p in activePlatforms"
                  :key="p.id"
                  @click.stop="selectCreatePlatform(p)"
                  :class="{ active: String(userForm.shopPlatformId) === String(p.id) }"
                >
                  {{ p.name }}
                </div>
              </div>
            </div>
          </label>
        </div>
        <button class="console-primary" type="submit" :disabled="saving">创建账号</button>
      </form>

      <section class="console-card console-table-card">
        <div class="console-card-head">
          <h2>账号列表</h2>
          <div class="console-accounts-filters">
            <div class="console-search-box">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input v-model="userSearch" placeholder="搜索账号/昵称" />
            </div>
            <div class="custom-select console-filter-select" @click.stop="toggleDropdown('filterShop')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterShop }">
                {{ shopFilter === '' ? '全部店铺' : shopFilter === 'UNBOUND' ? '未绑定' : shopLabel(shopFilter) }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterShop" class="custom-select-dropdown">
                <div @click.stop="shopFilter = ''; closeDropdown('filterShop')" :class="{ active: shopFilter === '' }">全部店铺</div>
                <div v-for="s in shops" :key="s.id" @click.stop="shopFilter = String(s.id); closeDropdown('filterShop')" :class="{ active: shopFilter === String(s.id) }">
                  {{ s.name }}
                </div>
                <div @click.stop="shopFilter = 'UNBOUND'; closeDropdown('filterShop')" :class="{ active: shopFilter === 'UNBOUND' }">未绑定</div>
              </div>
            </div>
            <div class="custom-select console-filter-select" @click.stop="toggleDropdown('filterPlatform')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterPlatform }">
                {{ platformName(platformFilter) || '全部平台' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterPlatform" class="custom-select-dropdown">
                <div @click.stop="platformFilter = ''; closeDropdown('filterPlatform')" :class="{ active: !platformFilter }">全部平台</div>
                <div
                  v-for="p in activePlatforms"
                  :key="p.id"
                  @click.stop="platformFilter = String(p.id); closeDropdown('filterPlatform')"
                  :class="{ active: String(platformFilter) === String(p.id) }"
                >
                  {{ p.name }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="console-table users-table">
          <div class="console-row console-row-head">
            <span>账号</span>
            <span>昵称</span>
            <span>角色</span>
            <span>米值</span>
            <span>状态</span>
            <span>所属店铺</span>
            <span>平台</span>
            <span>操作</span>
          </div>
          <div v-for="user in pagedUsers" :key="user.id" class="console-row">
            <span>
              <strong>{{ user.account }}</strong>
              <small>ID {{ user.id }}</small>
            </span>
            <input v-model.trim="user.nickname" />
            <select v-model="user.roleDraft">
              <option v-for="role in roleOptions" :key="role" :value="role">
                {{ roleLabel(role) }}
              </option>
            </select>
            <input v-model.number="user.miValue" type="number" min="0" />
            <select v-model="user.status">
              <option value="ACTIVE">启用</option>
              <option value="DISABLED">禁用</option>
            </select>
            <span class="console-shop-cell">{{ user.shopName || '未绑定' }}<em v-if="user.shopPlatform" class="shop-platform-tag">[{{ user.shopPlatform }}]</em></span>
            <span class="console-platform-cell">{{ user.shopPlatform || '-' }}</span>
            <span class="console-actions">
              <button type="button" @click="openDrawer(user)">编辑</button>
              <button type="button" @click="saveUser(user)">保存</button>
              <button
                type="button"
                class="console-password-reset-btn"
                title="重置密码"
                @click="openPasswordReset(user)"
              >
                <i class="ri-key-2-line" aria-hidden="true"></i>
                <span>重置密码</span>
              </button>
              <button type="button" class="console-btn-danger" @click="deleteUser(user)">
                删除
              </button>
            </span>
          </div>
          <p v-if="!loading && !filteredUsers.length" class="console-empty">
            {{ userSearch ? '无匹配结果' : '暂无账号' }}
          </p>
        </div>
        <ConsolePagination
          :current-page="userCurrentPage"
          :page-size="userPageSize"
          :total="userTotal"
          @change="changeUserPage"
          @update:page-size="changeUserPageSize"
        />
      </section>
    </section>

    <!-- 账号详情/编辑抽屉 -->
    <Teleport to="body">
      <Transition name="console-fade">
        <div v-if="drawerOpen" class="console-drawer-mask" @click.self="closeDrawer()">
          <aside class="console-drawer" role="dialog" aria-modal="true" aria-label="编辑账号">
            <header class="console-drawer-head">
              <h3>编辑账号 · {{ editingUser.account }}</h3>
              <button class="console-drawer-close" type="button" aria-label="关闭" @click="closeDrawer()">×</button>
            </header>
            <div class="console-drawer-body">
              <label>
                <span>账号</span>
                <input :value="editingUser.account" disabled />
              </label>
              <label>
                <span>昵称</span>
                <input v-model.trim="editingUser.nickname" />
              </label>
              <label>
                <span>手机号</span>
                <input v-model.trim="editingUser.phone" />
              </label>
              <div class="console-form-row">
                <label>
                <span>状态</span>
                <div class="custom-select" @click.stop="toggleDropdown('editStatus')">
                  <div class="custom-select-trigger" :class="{ open: dropdownOpen.editStatus }">
                    {{ statusLabelMap[editingUser.status] || editingUser.status }}
                    <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                  <div v-show="dropdownOpen.editStatus" class="custom-select-dropdown">
                    <div v-for="s in ['ACTIVE','DISABLED']" :key="s" @click.stop="editingUser.status = s; closeDropdown('editStatus')" :class="{ active: editingUser.status === s }">
                      {{ statusLabelMap[s] }}
                    </div>
                  </div>
                </div>
              </label>
                <label>
                  <span>米值</span>
                  <input v-model.number="editingUser.miValue" type="number" min="0" />
                </label>
              </div>
              <label>
                <span>会员</span>
                <input v-model.trim="editingUser.planName" />
              </label>
              <label>
                <span>角色</span>
                <div class="custom-select" @click.stop="toggleDropdown('editRole')">
                  <div class="custom-select-trigger" :class="{ open: dropdownOpen.editRole }">
                    {{ roleLabel(editingUser.roleDraft) }}
                    <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                  <div v-show="dropdownOpen.editRole" class="custom-select-dropdown">
                    <div v-for="role in roleOptions" :key="role" @click.stop="editingUser.roleDraft = role; closeDropdown('editRole')" :class="{ active: editingUser.roleDraft === role }">
                      {{ roleLabel(role) }}
                    </div>
                  </div>
                </div>
              </label>
              <label>
                <span>所属店铺</span>
                <div class="custom-select" @click.stop="toggleDropdown('editShop')">
                  <div class="custom-select-trigger" :class="{ open: dropdownOpen.editShop }">
                    {{ editingUser.shopId ? shopLabel(editingUser.shopId) : '解绑 / 不绑定' }}
                    <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                  <div v-show="dropdownOpen.editShop" class="custom-select-dropdown">
                    <div @click.stop="editingUser.shopId = ''; editingUser.shopPlatformId = ''; editingUser.shopPlatform = ''; closeDropdown('editShop')" :class="{ active: editingUser.shopId === '' }">解绑 / 不绑定</div>
                    <div v-for="s in shops" :key="s.id" @click.stop="selectEditShop(s)" :class="{ active: editingUser.shopId === String(s.id) }">
                      {{ s.name }}（{{ s.platformName || s.platform }}）
                    </div>
                  </div>
                </div>
              </label>
              <label>
                <span>平台</span>
                <input
                  :value="platformName(editingUser.shopPlatformId) || editingUser.shopPlatform || '未绑定平台'"
                  disabled
                />
              </label>
            </div>
            <footer class="console-drawer-foot">
              <button class="console-btn-ghost" type="button" @click="closeDrawer()">取消</button>
              <button class="console-primary" type="button" :disabled="saving" @click="saveUserDetail()">
                {{ saving ? '保存中...' : '保存' }}
              </button>
            </footer>
          </aside>
        </div>
      </Transition>
    </Teleport>

    <!-- 重置密码弹窗 -->
    <Teleport to="body">
      <Transition name="console-fade">
        <div
          v-if="passwordResetDialog.open"
          class="console-password-mask"
          @click.self="closePasswordReset()"
        >
          <form
            class="console-password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-reset-title"
            @submit.prevent="submitPasswordReset()"
          >
            <header>
              <div>
                <h3 id="password-reset-title">重置密码</h3>
                <p>{{ passwordResetDialog.account }}</p>
              </div>
              <button
                type="button"
                class="console-drawer-close"
                aria-label="关闭"
                @click="closePasswordReset()"
              >×</button>
            </header>
            <section>
              <label>
                <span>新密码</span>
                <div class="console-password-input">
                  <input
                    v-model="passwordResetDialog.password"
                    :type="passwordResetDialog.showPassword ? 'text' : 'password'"
                    minlength="6"
                    maxlength="64"
                    autocomplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    :title="passwordResetDialog.showPassword ? '隐藏密码' : '显示密码'"
                    @click="passwordResetDialog.showPassword = !passwordResetDialog.showPassword"
                  >
                    <i
                      :class="passwordResetDialog.showPassword ? 'ri-eye-off-line' : 'ri-eye-line'"
                      aria-hidden="true"
                    ></i>
                  </button>
                </div>
              </label>
              <label>
                <span>确认新密码</span>
                <input
                  v-model="passwordResetDialog.confirmPassword"
                  :type="passwordResetDialog.showPassword ? 'text' : 'password'"
                  minlength="6"
                  maxlength="64"
                  autocomplete="new-password"
                  required
                />
              </label>
            </section>
            <footer>
              <button class="console-btn-ghost" type="button" @click="closePasswordReset()">取消</button>
              <button class="console-primary" type="submit" :disabled="passwordResetSaving">
                {{ passwordResetSaving ? '重置中...' : '确认重置' }}
              </button>
            </footer>
          </form>
        </div>
      </Transition>
    </Teleport>

    <!-- Roles Tab -->
    <section v-if="activeTab === 'roles'" class="console-grid">
      <form class="console-card console-form" @submit.prevent="createRole">
        <h2>新增角色</h2>
        <label>
          <span>角色编码</span>
          <input v-model.trim="roleForm.code" placeholder="如 OPERATOR" required />
        </label>
        <label>
          <span>角色名称</span>
          <input v-model.trim="roleForm.name" placeholder="如 运营" required />
        </label>
        <label>
          <span>权限码</span>
          <textarea
            v-model="roleForm.permissionsText"
            rows="5"
            placeholder="多个权限用逗号或换行分隔"
          ></textarea>
        </label>
        <button class="console-primary" type="submit" :disabled="saving">创建角色</button>
      </form>

      <section class="console-card console-table-card">
        <div class="console-card-head">
          <h2>角色列表</h2>
          <div class="console-search-box">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input v-model="roleSearch" placeholder="搜索编码/名称" />
          </div>
        </div>
        <div class="console-table roles-table">
          <div class="console-row console-row-head">
            <span>角色</span>
            <span>名称</span>
            <span>权限</span>
            <span>用户</span>
            <span>操作</span>
          </div>
          <div v-for="role in filteredRoles" :key="role.id" class="console-row">
            <span>
              <strong>{{ roleLabel(role.code) }}</strong>
              <small>{{ role.code }}</small>
            </span>
            <input v-model.trim="role.name" />
            <textarea v-model="role.permissionsDraft" rows="2"></textarea>
            <span>{{ role.userCount || 0 }}</span>
            <span class="console-row-actions">
              <button type="button" @click="saveRole(role)">保存</button>
              <button type="button" class="console-btn-danger" @click="deleteRole(role)">
                删除
              </button>
            </span>
          </div>
          <p v-if="!loading && !filteredRoles.length" class="console-empty">
            {{ roleSearch ? '无匹配结果' : '暂无角色' }}
          </p>
        </div>
      </section>
    </section>

    <!-- Finance Tab -->
    <FinancePanel
      v-if="activeTab === 'finance'"
      :platforms="platforms"
      :shops="shops"
      :refresh-key="financeRefreshKey"
      @error="showToast($event, 'error')"
      @loaded="errorText = ''"
    />

    <!-- Stats Tab -->
    <section v-if="activeTab === 'stats'" class="console-stats">
      <!-- 模型用量: 环形图 + 图例 -->
      <section class="console-card">
        <h2>模型用量</h2>
        <div class="console-models-viz">
          <canvas ref="donutCanvas" class="console-donut"></canvas>
          <div class="console-model-legend">
            <div
              v-for="(model, i) in stats?.models || []"
              :key="model.model"
              class="console-model-legend-item"
            >
              <span
                class="console-legend-dot"
                :style="{
                  background: [
                    '#6366f1',
                    '#06b6d4',
                    '#f59e0b',
                    '#10b981',
                    '#ef4444',
                    '#8b5cf6',
                    '#ec4899',
                    '#14b8a6',
                  ][i % 8],
                }"
              ></span>
              <span class="console-legend-name">{{ model.model }}</span>
              <span class="console-legend-value">{{ model.tasks }} 任务</span>
              <span class="console-legend-sub">
                {{ model.images }} 张 / {{ model.miCost }} 米值
              </span>
            </div>
            <p v-if="!stats?.models?.length" class="console-empty">暂无模型统计。</p>
          </div>
        </div>
        <div class="console-provider-rates">
          <div class="console-provider-rates-head">
            <h3>中转站成功率</h3>
            <span>成功任务 / 已结束任务</span>
          </div>
          <div
            v-for="provider in stats?.providers || []"
            :key="provider.provider"
            class="console-provider-rate-row"
          >
            <strong>{{ providerLabel(provider.provider) }}</strong>
            <div class="console-provider-rate-track" aria-hidden="true">
              <span :style="{ width: `${provider.successRate || 0}%` }"></span>
            </div>
            <span class="console-provider-rate-count">
              {{ provider.successfulTasks }} / {{ provider.finishedTasks }}
            </span>
            <b>{{ provider.successRate == null ? '--' : `${Number(provider.successRate).toFixed(1)}%` }}</b>
          </div>
          <p v-if="!stats?.providers?.length" class="console-empty">暂无中转站统计。</p>
        </div>
      </section>

      <!-- 趋势折线图 -->
      <section ref="trendCard" class="console-card console-trend-card">
        <div class="console-trend-head">
          <div>
            <h2>近 14 天趋势</h2>
            <p>按生图任务数统计</p>
          </div>
        </div>
        <div class="console-trend-controls">
          <div class="console-trend-tabs" role="tablist" aria-label="趋势统计维度">
            <button
              v-for="tab in trendTabs"
              :key="tab.key"
              type="button"
              role="tab"
              :aria-selected="trendDimension === tab.key"
              :class="{ active: trendDimension === tab.key }"
              @click="trendDimension = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
          <div
            v-if="trendDimension !== 'total'"
            ref="trendFilterRow"
            class="console-trend-filter-row"
            @click.stop
          >
            <div
              class="console-trend-search"
              role="combobox"
              :aria-expanded="trendDropdownOpen"
              aria-haspopup="listbox"
            >
              <i class="ri-search-line" aria-hidden="true"></i>
              <input
                v-model="trendFilter"
                :placeholder="trendDimensionConfig.placeholder"
                autocomplete="off"
                @focus="openTrendDropdown"
                @input="onTrendFilterInput"
              />
              <small>{{ trendFilterCount }}</small>
              <button
                v-if="trendFilter"
                type="button"
                title="清空筛选"
                aria-label="清空趋势筛选"
                @click="clearTrendFilter"
              >
                <i class="ri-close-line" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="console-trend-dropdown-toggle"
                title="展开筛选条件"
                aria-label="展开趋势筛选条件"
                @click="toggleTrendDropdown"
              >
                <i :class="trendDropdownOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"></i>
              </button>
            </div>
            <div
              v-show="trendDropdownOpen"
              class="console-trend-dropdown"
              role="listbox"
              :style="{ maxHeight: `${trendDropdownMaxHeight}px` }"
            >
              <button
                v-if="!trendFilter"
                type="button"
                class="console-trend-dropdown-option"
                :class="{ active: !trendSelectedKey }"
                @click="selectTrendOption(null)"
              >
                <span>全部（默认展示前 5 项）</span>
                <i v-if="!trendSelectedKey" class="ri-check-line" aria-hidden="true"></i>
              </button>
              <button
                v-for="option in trendFilterOptions"
                :key="option.key"
                type="button"
                class="console-trend-dropdown-option"
                :class="{ active: trendSelectedKey === String(option.key) }"
                @click="selectTrendOption(option)"
              >
                <span>{{ option.label }}</span>
                <small>{{ option.totalTasks || 0 }} 任务</small>
                <i
                  v-if="trendSelectedKey === String(option.key)"
                  class="ri-check-line"
                  aria-hidden="true"
                ></i>
              </button>
              <p v-if="!trendFilterOptions.length" class="console-trend-dropdown-empty">
                没有匹配的筛选条件
              </p>
            </div>
          </div>
          <div v-else class="console-trend-filter-spacer" aria-hidden="true"></div>
        </div>
        <div v-if="trendVisibleSeries.length" class="console-trend-legend" aria-label="趋势图例">
          <span v-for="(series, index) in trendVisibleSeries" :key="series.key">
            <i :style="{ background: trendPalette[index % trendPalette.length] }"></i>
            <b>{{ series.label }}</b>
            <small>{{ series.totalTasks || 0 }}</small>
          </span>
        </div>
        <div class="console-trend-wrap">
          <canvas
            ref="trendCanvas"
            class="console-trend-canvas"
            @mousemove="handleTrendMove"
            @mouseleave="handleTrendLeave"
          ></canvas>
          <div
            v-if="trendTooltip.show"
            class="console-trend-tooltip"
            :style="{ left: trendTooltip.x + 'px', top: trendTooltip.y + 'px' }"
          >
            <strong>{{ trendTooltip.label }}</strong>
            <span
              v-for="item in trendTooltip.items"
              :key="item.key"
              class="console-trend-tooltip-item"
            >
              <i :style="{ background: item.color }"></i>
              <b>{{ item.label }}</b>
              <em>{{ item.value }} 任务</em>
            </span>
          </div>
        </div>
        <p v-if="!trendHasData" class="console-empty console-trend-empty">
          {{ trendFilter ? '没有匹配的趋势数据。' : '暂无趋势数据。' }}
        </p>
      </section>

      <!-- 最近任务 + 筛选 -->
      <section class="console-card console-table-card">
        <div class="console-card-head">
          <h2>最近生图任务</h2>
          <div class="console-filters">
            <div class="custom-select console-filter-select" @click.stop="toggleDropdown('filterTaskStatus')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterTaskStatus }">
                {{ taskStatusFilter ? taskStatusLabel(taskStatusFilter) : '全部状态' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterTaskStatus" class="custom-select-dropdown">
                <div @click.stop="taskStatusFilter = ''; closeDropdown('filterTaskStatus')" :class="{ active: taskStatusFilter === '' }">全部状态</div>
                <div v-for="s in ['COMPLETED', 'FAILED', 'PENDING', 'PROCESSING']" :key="s" @click.stop="taskStatusFilter = s; closeDropdown('filterTaskStatus')" :class="{ active: taskStatusFilter === s }">
                  {{ taskStatusLabel(s) }}
                </div>
              </div>
            </div>
            <div class="custom-select console-filter-select" @click.stop="toggleDropdown('filterTaskModel')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterTaskModel }">
                {{ taskModelFilter || '全部模型' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterTaskModel" class="custom-select-dropdown">
                <div @click.stop="taskModelFilter = ''; closeDropdown('filterTaskModel')" :class="{ active: taskModelFilter === '' }">全部模型</div>
                <div v-for="m in taskModelOptions" :key="m" @click.stop="taskModelFilter = m; closeDropdown('filterTaskModel')" :class="{ active: taskModelFilter === m }">
                  {{ m }}
                </div>
              </div>
            </div>
            <div class="custom-select console-filter-select task-user-filter" @click.stop="toggleTaskUserDropdown">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterTaskUser }">
                <span class="task-user-trigger-label">
                  {{ taskUserFilter ? taskUserLabel(taskUserFilter) : '全部用户' }}
                </span>
                <span class="task-user-trigger-actions">
                  <button
                    v-if="taskUserFilter"
                    type="button"
                    class="task-user-filter-clear"
                    title="清除用户筛选"
                    aria-label="清除用户筛选"
                    @click.stop="selectTaskUser()"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                  <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                </span>
              </div>
              <div v-show="dropdownOpen.filterTaskUser" class="custom-select-dropdown task-user-dropdown" @click.stop>
                <div class="task-user-search" @click.stop>
                  <i class="ri-search-line" aria-hidden="true"></i>
                  <input
                    ref="taskUserSearchInput"
                    v-model="taskUserSearch"
                    type="text"
                    placeholder="搜索用户"
                    autocomplete="off"
                    @click.stop
                    @keydown.esc.stop="closeDropdown('filterTaskUser')"
                  />
                  <button
                    v-if="taskUserSearch"
                    type="button"
                    class="task-user-search-clear"
                    title="清空搜索"
                    aria-label="清空搜索"
                    @click.stop="taskUserSearch = ''"
                  >
                    <i class="ri-close-line" aria-hidden="true"></i>
                  </button>
                </div>
                <div @click.stop="selectTaskUser()" :class="{ active: taskUserFilter === '' }">全部用户</div>
                <div
                  v-for="u in searchedTaskUserOptions"
                  :key="u.id"
                  class="task-user-option"
                  @click.stop="selectTaskUser(u.id)"
                  :class="{ active: taskUserFilter === String(u.id) }"
                >
                  <span>{{ u.nickname || u.account || u.id }}</span>
                  <small v-if="u.account && u.account !== u.nickname">{{ u.account }} · ID {{ u.id }}</small>
                </div>
                <div v-if="!searchedTaskUserOptions.length" class="task-user-empty">无匹配用户</div>
              </div>
            </div>
            <!-- 日期范围筛选 -->
            <div class="date-range-picker console-filter-select" @click.stop="showDatePicker = !showDatePicker">
              <div class="custom-select-trigger" :class="{ open: showDatePicker }">
                {{ dateDisplayText }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="showDatePicker" class="date-picker-dropdown" @click.stop>
                <div class="date-shortcuts">
                  <button v-for="s in dateShortcuts" :key="s.key" type="button"
                    @click.stop="applyDateShortcut(s.key)"
                    :class="{ active: activeShortcut === s.key }">{{ s.label }}</button>
                </div>
                <div class="date-range-inputs">
                  <input type="date" v-model="taskDateFrom" :max="todayStr" />
                  <span>~</span>
                  <input type="date" v-model="taskDateTo" :max="todayStr" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div
          :class="['console-table', 'tasks-table', { 'tasks-table-admin': isAdmin }]"
          @scroll.passive="hideTaskPromptTooltip"
        >
          <div class="console-row console-row-head">
            <span>时间</span>
            <span>任务</span>
            <span v-if="isAdmin">用户</span>
            <span>模型</span>
            <span>通道</span>
            <span>状态</span>
            <span class="task-resolution">分辨率</span>
            <span>图片</span>
            <span>耗时</span>
          </div>
          <div v-for="task in pagedTasks" :key="task.taskId" class="console-row">
            <span>{{ formatTime(task.createdAt) }}</span>
            <span class="task-summary">
              <strong
                class="task-prompt"
                @mouseenter="showTaskPromptTooltip(task, $event)"
                @mouseleave="queueTaskPromptTooltipHide"
                @click="showTaskPromptTooltip(task, $event)"
              >
                {{ task.prompt || '暂无提示词' }}
              </strong>
              <small class="task-id" :title="task.taskId">ID · {{ task.taskId }}</small>
            </span>
            <span v-if="isAdmin">{{ task.userName || task.userId || '匿名' }}</span>
            <span>{{ task.requestedModel || task.model }}</span>
            <span class="task-provider-cell">
              {{ taskProviderLabel(task.provider) }}
              <span v-if="task.isFallback" class="fallback-badge" title="该图由 Proxy 兜底通道生成">兜底</span>
            </span>
            <span class="task-status-cell">
              <span :class="['status-pill', taskStatusKey(task.status)]">{{ taskStatusLabel(task.status) }}</span>
              <small
                v-if="taskPersistStatus(task)"
                :class="['persist-status', taskPersistStatus(task).className]"
              >{{ taskPersistStatus(task).label }}</small>
            </span>
            <span class="task-resolution">{{ taskResolution(task) }}</span>
            <span class="task-image-cell">
              <span v-if="task.previewUrls?.length" class="task-thumbnails">
                <button
                  v-for="(url, index) in task.previewUrls.slice(0, 3)"
                  :key="url"
                  type="button"
                  class="task-thumbnail"
                  :title="`查看第 ${index + 1} 张图片`"
                  @click="openTaskImageViewer(task, index)"
                >
                  <img :src="url" :alt="`任务 ${task.taskId} 的第 ${index + 1} 张图片`" loading="lazy" />
                </button>
                <button
                  v-if="task.previewUrls.length > 3"
                  type="button"
                  class="task-thumbnail-more"
                  title="查看全部图片"
                  @click="openTaskImageViewer(task, 3)"
                >
                  +{{ task.previewUrls.length - 3 }}
                </button>
              </span>
              <small>{{ task.imageCount || task.previewUrls?.length || 0 }} 张 / {{ task.miCost || 0 }} 米值</small>
            </span>
            <span :class="['task-duration', { live: isTaskRunning(task) }]" :title="isTaskRunning(task) ? '任务进行中，耗时实时更新' : '从发起生图到任务结束的耗时'">{{ taskDuration(task) }}</span>
          </div>
          <p v-if="!taskReloading && pagedTasks.length === 0" class="console-empty">暂无匹配任务。</p>
        </div>
        <ConsolePagination
          :current-page="taskCurrentPage"
          :page-size="taskPageSize"
          :total="taskTotal"
          :loading="taskReloading"
          @change="reloadTaskPage"
          @update:page-size="changeTaskPageSize"
        />
      </section>
    </section>

    <ImageViewer
      :open="taskImageViewer.open"
      :images="taskImageViewer.urls"
      :start-index="taskImageViewer.index"
      @close="closeTaskImageViewer"
      @change="taskImageViewer.index = $event"
      @download="downloadTaskImage"
    />
    <Teleport to="body">
      <Transition name="task-prompt-tooltip">
        <aside
          v-if="taskPromptTooltip.show"
          :class="['task-prompt-tooltip', { above: taskPromptTooltip.above }]"
          :style="{
            left: `${taskPromptTooltip.left}px`,
            top: `${taskPromptTooltip.top}px`,
            width: `${taskPromptTooltip.width}px`,
          }"
          role="tooltip"
          @mouseenter="cancelTaskPromptTooltipHide"
          @mouseleave="queueTaskPromptTooltipHide"
        >
          <header>
            <strong>完整提示词</strong>
            <button
              type="button"
              class="task-prompt-copy"
              :title="taskPromptTooltip.copied ? '提示词已复制' : '复制完整提示词'"
              @click="copyTaskPrompt"
            >
              <i :class="taskPromptTooltip.copied ? 'ri-check-line' : 'ri-file-copy-line'"></i>
              <span>{{ taskPromptTooltip.copied ? '已复制' : '复制' }}</span>
            </button>
          </header>
          <p>{{ taskPromptTooltip.text }}</p>
        </aside>
      </Transition>
    </Teleport>
  </main>
</template>

<style scoped>
.tasks-table.tasks-table-admin .console-row {
  grid-template-columns: 112px minmax(220px, 1.6fr) 100px 110px 116px 92px 108px 152px 92px;
}
.tasks-table:not(.tasks-table-admin) .console-row {
  grid-template-columns: 112px minmax(220px, 1.6fr) 110px 116px 92px 108px 152px 92px;
}
.task-summary {
  display: grid;
  min-width: 0;
  gap: 4px;
  align-content: center;
}
.task-summary .task-prompt,
.task-summary .task-id {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-summary .task-prompt {
  color: var(--yq-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
}
.task-summary .task-id {
  color: var(--yq-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.25;
}
.task-prompt-tooltip {
  position: fixed;
  z-index: 12000;
  box-sizing: border-box;
  max-height: min(420px, calc(100vh - 32px));
  padding: 14px 16px 16px;
  overflow: auto;
  border: 1px solid #465267;
  border-radius: 8px;
  background: #182235;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.42);
  color: #f1f5f9;
  user-select: text;
}
.task-prompt-tooltip.above {
  transform: translateY(-100%);
}
.task-prompt-tooltip > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}
.task-prompt-tooltip > header > strong {
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1;
}
.task-prompt-copy {
  display: inline-flex;
  flex: 0 0 82px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 82px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #536078;
  border-radius: 6px;
  background: #243149;
  color: #e2e8f0;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.task-prompt-copy:hover {
  border-color: #718096;
  background: #2e3c56;
  color: #ffffff;
}
.task-prompt-copy i {
  font-size: 14px;
}
.task-prompt-tooltip > p {
  margin: 0;
  color: #f8fafc;
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.task-prompt-tooltip-enter-active,
.task-prompt-tooltip-leave-active {
  transition: opacity 0.12s ease;
}
.task-prompt-tooltip-enter-from,
.task-prompt-tooltip-leave-to {
  opacity: 0;
}
[data-theme='light'] .task-prompt-tooltip {
  border-color: #cbd5e1;
  background: #ffffff;
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.16);
  color: #0f172a;
}
[data-theme='light'] .task-prompt-tooltip > header > strong {
  color: #64748b;
}
[data-theme='light'] .task-prompt-tooltip > p {
  color: #1e293b;
}
[data-theme='light'] .task-prompt-copy {
  border-color: #cbd5e1;
  background: #f8fafc;
  color: #334155;
}
[data-theme='light'] .task-prompt-copy:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
  color: #0f172a;
}
[data-theme='light'] .task-summary .task-prompt,
[data-theme='light'] .task-duration:not(.live),
[data-theme='light'] .tasks-table .console-row:not(.console-row-head) .task-resolution {
  color: #1e293b;
}
[data-theme='light'] .task-summary .task-id {
  color: #64748b;
}
[data-theme='light'] .task-duration.live {
  color: #4f46e5;
}
[data-theme='light'] .persist-status.pending {
  color: #92400e;
}
[data-theme='light'] .persist-status.done {
  color: #047857;
}
[data-theme='light'] .persist-status.failed {
  color: #b91c1c;
}
[data-theme='light'] .task-thumbnail,
[data-theme='light'] .task-thumbnail-more {
  border-color: #f1f5f9;
}
.task-resolution {
  color: var(--yq-text);
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
}
.console-row-head .task-resolution {
  color: inherit;
}
.task-duration {
  color: var(--yq-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.task-duration.live {
  color: #818cf8;
}
.task-status-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.persist-status {
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  color: var(--yq-muted);
}
.persist-status.pending {
  color: #f59e0b;
}
.persist-status.done {
  color: #34d399;
}
.persist-status.failed {
  color: #fb7185;
}
.task-provider-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.task-image-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.task-image-cell small {
  flex: 0 0 auto;
  color: var(--yq-muted);
  font-size: 11px;
}
.task-thumbnails {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}
.task-thumbnail,
.task-thumbnail-more {
  width: 36px;
  height: 36px !important;
  padding: 0;
  overflow: hidden;
  border: 2px solid var(--yq-bg-main);
  border-radius: 6px;
  background: var(--yq-border);
  color: var(--yq-text);
}
.task-thumbnail + .task-thumbnail,
.task-thumbnail-more {
  margin-left: -8px;
}
.task-thumbnail:hover,
.task-thumbnail-more:hover {
  position: relative;
  z-index: 1;
  transform: translateY(-1px);
}
.task-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.task-thumbnail-more {
  font-size: 11px;
  font-weight: 700;
}
.console-accounts-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
/* 任务搜索框 */
.console-task-search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--yq-border, rgba(255,255,255,.12));
  border-radius: 8px;
  background: var(--yq-bg-main);
  color: var(--yq-muted);
  font-size: 12px;
  flex-shrink: 0;
  transition: border-color .2s;
}
.console-task-search:focus-within {
  border-color: var(--yq-primary, #6366f1);
}
.console-task-search svg {
  flex-shrink: 0;
  opacity: .5;
}
.console-task-search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  font-size: inherit;
  min-width: 0;
}
.console-task-search input::placeholder {
  color: var(--yq-muted);
  opacity: .6;
}
.search-clear {
  background: none;
  border: none;
  color: var(--yq-muted);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
}
.search-clear:hover {
  color: #ef4444;
}
.console-shop-cell {
  font-size: 13px;
  color: #cbd5e1;
}
.shop-platform-tag {
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  color: #0891b2;
  margin-left: 4px;
}
.console-platform-cell {
  font-size: 13px;
  color: #94a3b8;
}
.users-table .console-row {
  grid-template-columns: 130px 120px 80px 100px 80px 130px 80px minmax(270px, 1fr);
}
.console-password-reset-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  white-space: nowrap;
}
.console-password-reset-btn i {
  font-size: 15px;
}
.console-password-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(2, 6, 23, 0.68);
  backdrop-filter: blur(2px);
}
.console-password-dialog {
  width: min(400px, 100%);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: #0f172a;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
.console-password-dialog header,
.console-password-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
}
.console-password-dialog header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.console-password-dialog header h3,
.console-password-dialog header p {
  margin: 0;
}
.console-password-dialog header h3 {
  color: #f1f5f9;
  font-size: 16px;
}
.console-password-dialog header p {
  margin-top: 4px;
  color: #94a3b8;
  font-size: 12px;
}
.console-password-dialog section {
  display: grid;
  gap: 14px;
  padding: 18px;
}
.console-password-dialog label {
  display: grid;
  gap: 6px;
  color: #94a3b8;
  font-size: 13px;
}
.console-password-dialog input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  outline: none;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.04);
  box-sizing: border-box;
}
.console-password-dialog input:focus {
  border-color: #6366f1;
}
.console-password-input {
  position: relative;
}
.console-password-input input {
  padding-right: 42px;
}
.console-password-input button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 36px;
  height: 36px;
  border: 0;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
}
.console-password-dialog footer {
  justify-content: flex-end;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.console-password-dialog footer button {
  min-width: 96px;
}
.console-drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 23, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: flex-end;
  z-index: 1200;
}
.console-drawer {
  width: 420px;
  max-width: 92vw;
  height: 100%;
  background: #0f172a;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.4);
}
.console-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.console-drawer-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f1f5f9;
}
.console-drawer-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.console-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.console-drawer-body label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #94a3b8;
}
.console-drawer-body label input,
.console-drawer-body label select {
  padding: 10px 12px;
  font-size: 14px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  outline: none;
}
.console-drawer-body label input:disabled {
  opacity: 0.6;
}
.console-drawer-foot {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.console-drawer-foot .console-primary {
  flex: 1;
}
.console-btn-ghost {
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  color: #cbd5e1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  cursor: pointer;
}
.console-fade-enter-active,
.console-fade-leave-active {
  transition: opacity 0.2s ease;
}
.console-fade-enter-from,
.console-fade-leave-to {
  opacity: 0;
}
[data-theme='light'] .console-shop-cell {
  color: #475569;
}
[data-theme='light'] .shop-platform-tag {
  color: #0e7490;
}
[data-theme='light'] .console-platform-cell {
  color: #64748b;
}
[data-theme='light'] .console-password-dialog {
  border-color: #e2e8f0;
  background: #fff;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.18);
}
[data-theme='light'] .console-password-dialog header,
[data-theme='light'] .console-password-dialog footer {
  border-color: #e2e8f0;
}
[data-theme='light'] .console-password-dialog header h3 {
  color: #1e293b;
}
[data-theme='light'] .console-password-dialog header p,
[data-theme='light'] .console-password-dialog label {
  color: #64748b;
}
[data-theme='light'] .console-password-dialog input {
  color: #1e293b;
  border-color: #cbd5e1;
  background: #f8fafc;
}
[data-theme='light'] .console-drawer {
  background: #fff;
  border-left-color: #e2e8f0;
}
[data-theme='light'] .console-drawer-head h3 {
  color: #1e293b;
}
[data-theme='light'] .console-drawer-head,
[data-theme='light'] .console-drawer-foot {
  border-color: #e2e8f0;
}
[data-theme='light'] .console-drawer-body label {
  color: #64748b;
}
[data-theme='light'] .console-drawer-body label input,
[data-theme='light'] .console-drawer-body label select {
  color: #1e293b;
  background: #f8fafc;
  border-color: #e2e8f0;
}
[data-theme='light'] .console-btn-ghost {
  color: #475569;
  background: #f1f5f9;
  border-color: #e2e8f0;
}

/* ── 自定义下拉框（适配开灯/关灯主题） ── */
.custom-select {
  position: relative;
  width: 100%;
}
.custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px 12px;
  font-size: 14px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  cursor: pointer;
  outline: none;
  user-select: none;
  transition: border-color 0.2s, background 0.2s;
}
.custom-select-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}
.custom-select-trigger .arrow {
  transition: transform 0.2s;
  flex-shrink: 0;
  opacity: 0.6;
}
.custom-select-trigger.open .arrow {
  transform: rotate(180deg);
}
.custom-select-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  max-height: 220px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}
.custom-select-dropdown > div {
  padding: 10px 12px;
  font-size: 14px;
  color: #e2e8f0;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.custom-select-dropdown > div:hover,
.custom-select-dropdown > div.active {
  background: rgba(255, 255, 255, 0.08);
}
.custom-select-dropdown > div.active {
  color: #60a5fa;
}

/* Combobox */
.custom-combobox {
  position: relative;
  width: 100%;
}
.custom-combobox input {
  width: 100%;
}

/* 筛选器里的下拉框更紧凑 */
.custom-select.console-filter-select .custom-select-trigger {
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
}
.custom-select.console-filter-select .custom-select-dropdown > div {
  padding: 8px 10px;
  font-size: 13px;
}
.task-user-filter {
  width: 180px !important;
}
.task-user-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-user-trigger-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}
.task-user-filter-clear {
  display: grid;
  width: 20px;
  height: 20px;
  padding: 0;
  place-items: center;
  color: #94a3b8;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1;
}
.task-user-filter-clear:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.16);
}
.task-user-dropdown {
  max-height: 300px;
  overflow-y: auto;
}
.custom-select.console-filter-select .task-user-search {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  cursor: default;
  background: #1f2937;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
}
.task-user-search input {
  width: 100%;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  outline: 0;
  color: #e2e8f0;
  background: transparent;
  font-size: 13px;
}
.task-user-search input::placeholder {
  color: #94a3b8;
}
.task-user-search-clear {
  display: grid;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  color: #94a3b8;
  background: transparent;
  border: 0;
  border-radius: 4px;
}
.task-user-search-clear:hover {
  color: #f8fafc;
  background: rgba(148, 163, 184, 0.14);
}
.task-user-option span,
.task-user-option small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-user-option small {
  margin-top: 2px;
  color: #94a3b8;
  font-size: 11px;
}
.custom-select.console-filter-select .task-user-empty {
  color: #94a3b8;
  cursor: default;
  text-align: center;
}
[data-theme='light'] .custom-select.console-filter-select .task-user-search {
  background: #fff;
  border-bottom-color: #e2e8f0;
}
[data-theme='light'] .task-user-search input {
  color: #1e293b;
}
[data-theme='light'] .task-user-search-clear:hover {
  color: #0f172a;
  background: #f1f5f9;
}
[data-theme='light'] .task-user-filter-clear:hover {
  color: #0f172a;
  background: #e2e8f0;
}

/* 开灯模式 */
[data-theme='light'] .custom-select-trigger {
  color: #1e293b;
  background: #f8fafc;
  border-color: #e2e8f0;
}
[data-theme='light'] .custom-select-trigger:hover {
  background: #f1f5f9;
}
[data-theme='light'] .custom-select-dropdown {
  background: #fff;
  border-color: #e2e8f0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
[data-theme='light'] .custom-select-dropdown > div {
  color: #1e293b;
}
[data-theme='light'] .custom-select-dropdown > div:hover,
[data-theme='light'] .custom-select-dropdown > div.active {
  background: #f1f5f9;
}
[data-theme='light'] .custom-select-dropdown > div.active {
  color: #2563eb;
}

/* ── 兜底通道徽章（仅管理员可见，中性琥珀色） ── */
.fallback-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  vertical-align: middle;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.35);
}
[data-theme='light'] .fallback-badge {
  color: #b45309;
  background: rgba(251, 191, 36, 0.15);
  border-color: rgba(180, 83, 9, 0.4);
}

/* ── 日期范围选择器（与筛选器风格统一） ── */
.date-range-picker {
  position: relative;
}
.date-range-picker .custom-select-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font-size: 12px;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.2s;
}
.date-range-picker .custom-select-trigger:hover {
  background: rgba(255, 255, 255, 0.06);
}
.date-range-picker .arrow {
  opacity: 0.5;
  flex-shrink: 0;
  transition: transform 0.2s;
}
.date-range-picker .custom-select-trigger.open .arrow {
  transform: rotate(180deg);
}
.date-picker-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 10px;
  min-width: 264px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.date-shortcuts {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.date-shortcuts button {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s;
}
.date-shortcuts button:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}
.date-shortcuts button.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
}
.date-range-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
}
.date-range-inputs input[type='date'] {
  flex: 1;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font-size: 12px;
  outline: none;
}
.date-range-inputs input[type='date']:focus {
  border-color: rgba(99, 102, 241, 0.5);
}
.date-range-inputs span {
  color: #94a3b8;
  font-size: 12px;
}

/* 亮色主题覆盖 */
[data-theme='light'] .date-range-picker .custom-select-trigger {
  background: #f8fafc;
  border-color: #e2e8f0;
  color: #1e293b;
}
[data-theme='light'] .date-range-picker .custom-select-trigger:hover {
  background: #f1f5f9;
}
[data-theme='light'] .date-picker-dropdown {
  background: rgba(255, 255, 255, 0.96);
  border-color: #e2e8f0;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}
[data-theme='light'] .date-shortcuts button {
  border-color: #e2e8f0;
  color: #64748b;
}
[data-theme='light'] .date-shortcuts button:hover {
  background: #f1f5f9;
  color: #334155;
}
[data-theme='light'] .date-shortcuts button.active {
  background: #e2e8f0;
  color: #0f172a;
  border-color: #cbd5e1;
}
[data-theme='light'] .date-range-inputs input[type='date'] {
  background: #ffffff;
  border-color: #e2e8f0;
  color: #1e293b;
}
[data-theme='light'] .date-range-inputs span {
  color: #94a3b8;
}

.console-trend-card {
  position: relative;
  gap: 12px;
}

.console-trend-head {
  display: grid;
  gap: 12px;
}

.console-trend-head > div:first-child {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.console-trend-head h2 {
  margin: 0;
}

.console-trend-head p {
  margin: 0;
  color: var(--yq-muted);
  font-size: 11px;
}

.console-trend-controls {
  display: grid;
  grid-template-columns: minmax(300px, 1.15fr) minmax(220px, 0.85fr);
  align-items: center;
  gap: 10px;
}

.console-trend-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--yq-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--yq-bg-main) 78%, transparent);
}

.console-trend-tabs button {
  min-width: 0;
  height: 30px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--yq-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.console-trend-tabs button:hover {
  color: var(--yq-text);
}

.console-trend-tabs button.active {
  background: var(--yq-primary);
  color: #ffffff;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--yq-primary) 28%, transparent);
}

.console-trend-filter-row {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  z-index: 4;
}

.console-trend-filter-spacer {
  min-width: 0;
  height: 32px;
}

.console-trend-search {
  display: flex;
  min-width: 0;
  height: 32px;
  flex: 1 1 auto;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border: 1px solid var(--yq-border);
  border-radius: 7px;
  background: var(--yq-bg-main);
  color: var(--yq-muted);
}

.console-trend-search small {
  display: inline-flex;
  min-width: 20px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--yq-primary) 15%, transparent);
  color: var(--yq-primary);
  font-size: 10px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.console-trend-search:focus-within {
  border-color: var(--yq-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--yq-primary) 16%, transparent);
}

.console-trend-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--yq-text);
  font: inherit;
  font-size: 12px;
}

.console-trend-search input::placeholder {
  color: var(--yq-muted);
}

.console-trend-search button {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--yq-muted);
  cursor: pointer;
}

.console-trend-search button:hover {
  background: color-mix(in srgb, var(--yq-border) 70%, transparent);
  color: var(--yq-text);
}

.console-trend-dropdown-toggle {
  flex: 0 0 auto;
}

.console-trend-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 20;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--yq-border);
  border-radius: 8px;
  background: var(--yq-bg-card);
  box-shadow: 0 14px 30px rgba(2, 6, 23, 0.42);
  scrollbar-width: thin;
}

.console-trend-dropdown-option {
  display: grid;
  width: 100%;
  min-height: 34px;
  grid-template-columns: minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--yq-text);
  text-align: left;
  cursor: pointer;
}

.console-trend-dropdown-option:hover,
.console-trend-dropdown-option.active {
  background: color-mix(in srgb, var(--yq-primary) 14%, transparent);
}

.console-trend-dropdown-option > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}

.console-trend-dropdown-option > small {
  color: var(--yq-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.console-trend-dropdown-option > i {
  color: var(--yq-primary);
  font-size: 14px;
}

.console-trend-dropdown-option:first-child > span {
  grid-column: 1 / 3;
}

.console-trend-dropdown-empty {
  margin: 0;
  padding: 14px 10px;
  color: var(--yq-muted);
  font-size: 11px;
  text-align: center;
}

.console-trend-legend {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 8px 14px;
  overflow: hidden;
  flex-wrap: wrap;
}

.console-trend-legend > span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--yq-text);
  font-size: 11px;
}

.console-trend-legend i,
.console-trend-tooltip-item i {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.console-trend-legend b {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-trend-legend small {
  color: var(--yq-muted);
  font-variant-numeric: tabular-nums;
}

.console-trend-card .console-trend-wrap {
  height: 245px;
}

.console-trend-tooltip {
  min-width: 170px;
  padding: 8px 10px;
  white-space: normal;
}

.console-trend-tooltip-item {
  display: grid !important;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  font-size: 11px !important;
  font-weight: 600 !important;
}

.console-trend-tooltip-item b {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-trend-tooltip-item em {
  color: var(--yq-muted);
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.console-trend-empty {
  margin: -150px 0 120px;
  text-align: center;
  pointer-events: none;
}

@media (max-width: 700px) {
  .console-trend-head > div:first-child {
    align-items: flex-start;
    flex-direction: column;
  }

  .console-trend-controls {
    grid-template-columns: 1fr;
  }

  .console-trend-search {
    width: 100%;
  }

  .console-trend-filter-spacer {
    display: none;
  }

  .console-trend-card .console-trend-wrap {
    height: 220px;
  }
}
</style>

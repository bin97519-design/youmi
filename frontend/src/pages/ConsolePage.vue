<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import ImageViewer from '../components/ImageViewer.vue'
import { useUserStore } from '../stores/user'
import { apiPath } from '../utils/apiBase'

const userStore = useUserStore()
const activeTab = ref('stats')
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const users = ref([])
const roles = ref([])
const stats = ref(null)
const elapsedClock = ref(Date.now())
let elapsedTimer = null
let taskRefreshTimer = null

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
// 日期范围筛选（最近生图任务）：格式 YYYY-MM-DD，空 = 不限
const taskDateFrom = ref('')
const taskDateTo = ref('')
const shopFilter = ref('')
const platformFilter = ref('')
const shops = ref([])

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
  shopPlatform: '',
  passwordDraft: '',
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
    if (pf && u.shopPlatform !== pf) return false
    return true
  })
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
const pageWindow = computed(() => {
  const total = taskTotalPages.value
  const cur = taskCurrentPage.value
  const span = 2
  let start = Math.max(1, cur - span)
  let end = Math.min(total, cur + span)
  if (end - start < span * 2) {
    if (start === 1) end = Math.min(total, start + span * 2)
    else if (end === total) start = Math.max(1, end - span * 2)
  }
  const arr = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
})

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

const tabs = computed(() => {
  const list = []
  if (isAdmin.value) {
    list.push({ key: 'accounts', label: '账号管理' })
    list.push({ key: 'roles', label: '角色管理' })
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
  shopPlatform: '',
})

/* 创建卡片平台下拉 ↔ 编辑弹窗平台字段 双向同步 */
watch(() => userForm.shopPlatform, (v) => {
  editingUser.shopPlatform = v ?? ''
})
watch(() => editingUser.shopPlatform, (v) => {
  userForm.shopPlatform = v ?? ''
  /* 同步回列表行（列表渲染的是 users 数组，不经过表单对象） */
  if (editingUser.id) {
    const row = users.value.find((u) => String(u.id) === String(editingUser.id))
    if (row) row.shopPlatform = v ?? ''
  }
})

const roleForm = reactive({
  code: '',
  name: '',
  permissionsText: 'image:generate',
})

const roleOptions = computed(() => roles.value.map((role) => role.code))
const summary = computed(() => stats.value?.summary || {})

/* 店铺名称→ID 映射表，用于创建账号时解析手输店名 */
const shopNameMap = computed(() => {
  const map = {}
  for (const s of shops.value) map[s.name] = s.id
  return map
})

/** 解析用户输入的店铺值：返回 { shopId, shopName } */
function resolveShopInput(input) {
  const name = (input || '').trim()
  if (!name) return { shopId: null, shopName: '' }
  const id = shopNameMap.value[name]
  if (id != null) return { shopId: Number(id), shopName: '' }
  return { shopId: null, shopName: name }
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
    /* 所有角色都能看统计 */
    const imageStats = await api('/api/admin/image-stats' + buildImageStatsQuery())
    stats.value = normalizeImageStats(imageStats)

    /* 仅管理员加载账号和角色 */
    if (isAdmin.value) {
      const [userRows, roleRows, shopRows] = await Promise.all([
        api('/api/admin/users').catch(() => []),
        api('/api/admin/roles').catch(() => []),
        api('/api/admin/shops').catch(() => []),
      ])
      roles.value = roleRows.map(normalizeRole)
      users.value = userRows.map(normalizeUser)
      shops.value = shopRows
    }
  } catch (error) {
    /* 非管理员请求 admin 接口返回 403 是预期行为，不必提示 */
    if (!/403|没有控制台权限/.test(error.message)) {
      errorText.value = error.message || '控制台数据加载失败'
    }
  } finally {
    loading.value = false
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
      shopPlatform: editingUser.shopPlatform || null,
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

async function refreshTaskStatsSilently() {
  if (
    document.hidden ||
    activeTab.value !== 'stats' ||
    loading.value ||
    taskReloading.value ||
    !shouldRefreshTaskStats.value
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

function isTaskRunning(task) {
  const status = taskStatusKey(task?.status)
  return (
    status !== 'COMPLETED' &&
    status !== 'FAILED' &&
    !task?.completedAt &&
    !task?.previewUrls?.length
  )
}

function shortPrompt(value) {
  const text = String(value || '')
  return text.length > 42 ? `${text.slice(0, 42)}...` : text
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

function onDocClick() {
  Object.keys(dropdownOpen).forEach((k) => (dropdownOpen[k] = false))
  showDatePicker.value = false
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
const trendTooltip = reactive({ show: false, x: 0, y: 0, label: '', value: 0 })

function drawTrendChart() {
  const canvas = trendCanvas.value
  if (!canvas) return
  const daily = stats.value?.daily || []
  if (!daily.length) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
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

  const values = daily.map((d) => d.tasks || 0)
  const maxVal = Math.max(...values, 1)
  const stepX = daily.length > 1 ? chartW / (daily.length - 1) : chartW

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
  daily.forEach((d, i) => {
    const x = padL + stepX * i
    ctx.fillText(d.day?.slice(5) || '', x, H - 6)
  })

  /* area fill */
  const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH)
  grad.addColorStop(0, isLight ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.25)')
  grad.addColorStop(1, isLight ? 'rgba(99,102,241,0.01)' : 'rgba(99,102,241,0.02)')
  ctx.beginPath()
  daily.forEach((d, i) => {
    const x = padL + stepX * i
    const y = padT + chartH - ((d.tasks || 0) / maxVal) * chartH
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.lineTo(padL + stepX * (daily.length - 1), padT + chartH)
  ctx.lineTo(padL, padT + chartH)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  /* line */
  ctx.beginPath()
  ctx.strokeStyle = isLight ? '#6366f1' : '#818cf8'
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  daily.forEach((d, i) => {
    const x = padL + stepX * i
    const y = padT + chartH - ((d.tasks || 0) / maxVal) * chartH
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.stroke()

  /* dots */
  daily.forEach((d, i) => {
    const x = padL + stepX * i
    const y = padT + chartH - ((d.tasks || 0) / maxVal) * chartH
    ctx.beginPath()
    ctx.arc(x, y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = isLight ? '#6366f1' : '#818cf8'
    ctx.fill()
    ctx.strokeStyle = isLight ? '#fff' : '#0f172a'
    ctx.lineWidth = 1.5
    ctx.stroke()
  })

  /* store for hover */
  canvas._chartData = { padL, padR, padT, chartH, chartW, stepX, maxVal, daily }
}

function handleTrendMove(e) {
  const canvas = trendCanvas.value
  if (!canvas?._chartData) return
  const { padL, padT, chartH, stepX, maxVal, daily } = canvas._chartData
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const idx = Math.round((mx - padL) / stepX)
  if (idx < 0 || idx >= daily.length) {
    trendTooltip.show = false
    return
  }
  const d = daily[idx]
  const x = padL + stepX * idx
  const y = padT + chartH - ((d.tasks || 0) / maxVal) * chartH
  trendTooltip.show = true
  trendTooltip.x = x
  trendTooltip.y = y
  trendTooltip.label = d.day || ''
  trendTooltip.value = d.tasks || 0
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
watch([activeTab, stats], () => {
  nextTick(() => {
    if (activeTab.value === 'stats') {
      drawTrendChart()
      drawDonutChart()
    }
  })
})

onMounted(() => {
  loadConsole()
  elapsedTimer = window.setInterval(() => {
    elapsedClock.value = Date.now()
  }, 1000)
  taskRefreshTimer = window.setInterval(refreshTaskStatsSilently, 10000)
  document.addEventListener('click', onDocClick)
})

onUnmounted(() => {
  if (elapsedTimer) window.clearInterval(elapsedTimer)
  if (taskRefreshTimer) window.clearInterval(taskRefreshTimer)
  document.removeEventListener('click', onDocClick)
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
    <section class="console-metrics">
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
                <div v-for="s in shops" :key="s.id" @click.stop="userForm.shopInput = s.name; closeDropdown('createShop')">
                  {{ s.name }}
                </div>
              </div>
            </div>
          </label>
          <label>
            <span>平台</span>
            <div class="custom-select" @click.stop="toggleDropdown('createPlatform')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.createPlatform }">
                {{ userForm.shopPlatform || '请选择平台' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.createPlatform" class="custom-select-dropdown">
                <div v-for="p in ['淘宝','天猫','京东','抖音','拼多多']" :key="p" @click.stop="userForm.shopPlatform = p; closeDropdown('createPlatform')" :class="{ active: userForm.shopPlatform === p }">
                  {{ p }}
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
                {{ platformFilter || '全部平台' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterPlatform" class="custom-select-dropdown">
                <div @click.stop="platformFilter = ''; closeDropdown('filterPlatform')" :class="{ active: !platformFilter }">全部平台</div>
                <div v-for="p in ['淘宝','天猫','京东','抖音','拼多多']" :key="p"
                  @click.stop="platformFilter = p; closeDropdown('filterPlatform')"
                  :class="{ active: platformFilter === p }">
                  {{ p }}
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
          <div v-for="user in filteredUsers" :key="user.id" class="console-row">
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
              <button type="button" class="console-btn-danger" @click="deleteUser(user)">
                删除
              </button>
            </span>
          </div>
          <p v-if="!loading && !filteredUsers.length" class="console-empty">
            {{ userSearch ? '无匹配结果' : '暂无账号' }}
          </p>
        </div>
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
                    <div @click.stop="editingUser.shopId = ''; editingUser.shopPlatform = ''; closeDropdown('editShop')" :class="{ active: editingUser.shopId === '' }">解绑 / 不绑定</div>
                    <div v-for="s in shops" :key="s.id" @click.stop="editingUser.shopId = String(s.id); editingUser.shopPlatform = s.platform || ''; closeDropdown('editShop')" :class="{ active: editingUser.shopId === String(s.id) }">
                      {{ s.name }}（{{ s.code }}）
                    </div>
                  </div>
                </div>
              </label>
              <label>
                <span>平台</span>
                <div class="custom-select" @click.stop="toggleDropdown('editPlatform')">
                  <div class="custom-select-trigger" :class="{ open: dropdownOpen.editPlatform }">
                    {{ editingUser.shopPlatform || '请选择平台' }}
                    <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
                  </div>
                  <div v-show="dropdownOpen.editPlatform" class="custom-select-dropdown">
                    <div v-for="p in ['淘宝','天猫','京东','抖音','拼多多']" :key="p" @click.stop="editingUser.shopPlatform = p; closeDropdown('editPlatform')" :class="{ active: editingUser.shopPlatform === p }">
                      {{ p }}
                    </div>
                  </div>
                </div>
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

    <!-- Stats Tab -->
    <section v-else class="console-stats">
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
      <section class="console-card console-trend-card">
        <h2>近 14 天趋势</h2>
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
            <span>{{ trendTooltip.value }} 任务</span>
          </div>
        </div>
        <p v-if="!stats?.daily?.length" class="console-empty">暂无趋势数据。</p>
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
            <div class="custom-select console-filter-select" @click.stop="toggleDropdown('filterTaskUser')">
              <div class="custom-select-trigger" :class="{ open: dropdownOpen.filterTaskUser }">
                {{ taskUserFilter ? taskUserLabel(taskUserFilter) : '全部用户' }}
                <svg class="arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </div>
              <div v-show="dropdownOpen.filterTaskUser" class="custom-select-dropdown">
                <div @click.stop="taskUserFilter = ''; closeDropdown('filterTaskUser')" :class="{ active: taskUserFilter === '' }">全部用户</div>
                <div v-for="u in taskUserOptions" :key="u.id" @click.stop="taskUserFilter = String(u.id); closeDropdown('filterTaskUser')" :class="{ active: taskUserFilter === String(u.id) }">
                  {{ u.nickname || u.account || u.id }}
                </div>
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
        <div :class="['console-table', 'tasks-table', { 'tasks-table-admin': isAdmin }]">
          <div class="console-row console-row-head">
            <span>时间</span>
            <span>任务</span>
            <span v-if="isAdmin">用户</span>
            <span>模型</span>
            <span>通道</span>
            <span>状态</span>
            <span>图片</span>
            <span>耗时</span>
          </div>
          <div v-for="task in pagedTasks" :key="task.taskId" class="console-row">
            <span>{{ formatTime(task.createdAt) }}</span>
            <span>
              <strong>{{ task.taskId }}</strong>
              <small>{{ shortPrompt(task.prompt) }}</small>
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
        <div class="console-pagination" v-if="taskTotal > 0">
          <select class="page-size" :disabled="taskReloading" @change="changeTaskPageSize(Number($event.target.value))">
            <option v-for="s in [10, 20, 50]" :key="s" :value="s" :selected="s === taskPageSize">{{ s }}条/页</option>
          </select>
          <span class="page-total">共 {{ taskTotal }} 条</span>
          <button class="page-btn" :disabled="taskCurrentPage <= 1 || taskReloading" @click="reloadTaskPage(taskCurrentPage - 1)">上一页</button>
          <button v-for="p in pageWindow" :key="p" class="page-btn" :class="{ active: p === taskCurrentPage }" :disabled="taskReloading" @click="reloadTaskPage(p)">{{ p }}</button>
          <button class="page-btn" :disabled="taskCurrentPage >= taskTotalPages || taskReloading" @click="reloadTaskPage(taskCurrentPage + 1)">下一页</button>
          <span v-if="taskReloading" class="page-loading">加载中…</span>
        </div>
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
  </main>
</template>

<style scoped>
.tasks-table.tasks-table-admin .console-row {
  grid-template-columns: 112px minmax(220px, 1.6fr) 100px 110px 116px 92px 188px 92px;
}
.tasks-table:not(.tasks-table-admin) .console-row {
  grid-template-columns: 112px minmax(220px, 1.6fr) 110px 116px 92px 188px 92px;
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

/* ── 最近生图任务分页（中性色，贴合暗色半透明主题） ── */
.console-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #94a3b8;
}
.page-total {
  margin-right: 4px;
}
.page-btn {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  cursor: pointer;
  transition: all 0.15s;
}
.page-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}
.page-btn.active {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-size {
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  width: fit-content;
  height: 28px;
  box-sizing: border-box;
  vertical-align: middle;
}
.page-size option {
  background: #1e293b;
  color: #e2e8f0;
}
.page-loading {
  color: #94a3b8;
}
[data-theme='light'] .console-pagination {
  color: #64748b;
}
[data-theme='light'] .page-btn {
  border-color: #e2e8f0;
  background: #f8fafc;
  color: #1e293b;
}
[data-theme='light'] .page-btn:hover:not(:disabled) {
  background: #f1f5f9;
}
[data-theme='light'] .page-btn.active {
  background: rgba(0, 0, 0, 0.06);
  border-color: rgba(0, 0, 0, 0.12);
  color: #1e293b;
}
[data-theme='light'] .page-size {
  border-color: #e2e8f0;
  background: #f8fafc;
  color: #1e293b;
  height: 28px;
  box-sizing: border-box;
}
[data-theme='light'] .page-size option {
  background: #ffffff;
  color: #1e293b;
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
</style>

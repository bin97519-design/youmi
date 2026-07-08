<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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

const filteredUsers = computed(() => {
  const q = userSearch.value.trim().toLowerCase()
  if (!q) return users.value
  return users.value.filter(
    (u) =>
      (u.account || '').toLowerCase().includes(q) ||
      (u.nickname || '').toLowerCase().includes(q) ||
      String(u.id).includes(q),
  )
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
  if (taskStatusFilter.value) list = list.filter((t) => t.status === taskStatusFilter.value)
  if (taskModelFilter.value)
    list = list.filter((t) => (t.requestedModel || t.model) === taskModelFilter.value)
  if (taskUserFilter.value)
    list = list.filter((t) => String(t.userId) === taskUserFilter.value)
  return list
})

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
})

const roleForm = reactive({
  code: '',
  name: '',
  permissionsText: 'image:generate',
})

const roleOptions = computed(() => roles.value.map((role) => role.code))
const summary = computed(() => stats.value?.summary || {})

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
    const imageStats = await api('/api/admin/image-stats')
    stats.value = imageStats

    /* 仅管理员加载账号和角色 */
    if (isAdmin.value) {
      const [userRows, roleRows] = await Promise.all([
        api('/api/admin/users').catch(() => []),
        api('/api/admin/roles').catch(() => []),
      ])
      roles.value = roleRows.map(normalizeRole)
      users.value = userRows.map(normalizeUser)
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
    const created = await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(userForm),
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
  })
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
function taskStatusLabel(s) {
  return taskStatusLabelMap[s] || s
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
})

onUnmounted(() => {})
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
        <article v-for="i in isAdmin ? 4 : 2" :key="i" class="console-skeleton-metric">
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
            <select v-model="userForm.status">
              <option value="ACTIVE">启用</option>
              <option value="DISABLED">禁用</option>
            </select>
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
            <select v-model="userForm.roles[0]">
              <option v-for="role in roleOptions" :key="role" :value="role">
                {{ roleLabel(role) }}
              </option>
            </select>
          </label>
        </div>
        <button class="console-primary" type="submit" :disabled="saving">创建账号</button>
      </form>

      <section class="console-card console-table-card">
        <div class="console-card-head">
          <h2>账号列表</h2>
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
        </div>
        <div class="console-table users-table">
          <div class="console-row console-row-head">
            <span>账号</span>
            <span>昵称</span>
            <span>角色</span>
            <span>米值</span>
            <span>状态</span>
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
            <span class="console-actions">
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

    <!-- Roles Tab -->
    <section v-else-if="activeTab === 'roles'" class="console-grid">
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
      </section>

      <!-- 趋势折线图 -->
      <section class="console-card">
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
            <select v-model="taskStatusFilter" class="console-filter-select">
              <option value="">全部状态</option>
              <option
                v-for="s in ['COMPLETED', 'FAILED', 'PENDING', 'PROCESSING']"
                :key="s"
                :value="s"
              >
                {{ taskStatusLabel(s) }}
              </option>
            </select>
            <select v-model="taskModelFilter" class="console-filter-select">
              <option value="">全部模型</option>
              <option v-for="m in taskModelOptions" :key="m" :value="m">{{ m }}</option>
            </select>
            <select v-model="taskUserFilter" class="console-filter-select">
              <option value="">全部用户</option>
              <option v-for="u in taskUserOptions" :key="u.id" :value="String(u.id)">{{ u.nickname || u.account || u.id }}</option>
            </select>
          </div>
        </div>
        <div class="console-table tasks-table">
          <div class="console-row console-row-head">
            <span>任务</span>
            <span v-if="isAdmin">用户</span>
            <span>模型</span>
            <span>状态</span>
            <span>图片</span>
            <span>时间</span>
          </div>
          <div v-for="task in filteredTasks" :key="task.taskId" class="console-row">
            <span>
              <strong>{{ task.taskId }}</strong>
              <small>{{ shortPrompt(task.prompt) }}</small>
            </span>
            <span v-if="isAdmin">{{ task.userName || task.userId || '匿名' }}</span>
            <span>{{ task.requestedModel || task.model }}</span>
            <span :class="['status-pill', task.status]">{{ taskStatusLabel(task.status) }}</span>
            <span>{{ task.imageCount }} 张 / {{ task.miCost }} 米值</span>
            <span>{{ formatTime(task.createdAt) }}</span>
          </div>
          <p v-if="!filteredTasks.length" class="console-empty">暂无匹配任务。</p>
        </div>
      </section>
    </section>
  </main>
</template>

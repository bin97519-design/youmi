<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUserStore } from '../../stores/user'
import { apiPath } from '../../utils/apiBase'

const props = defineProps({
  platforms: { type: Array, default: () => [] },
  shops: { type: Array, default: () => [] },
  refreshKey: { type: Number, default: 0 },
})

const emit = defineEmits(['error', 'loaded'])
const userStore = useUserStore()
const loading = ref(false)
const exporting = ref(false)
const report = ref(null)
const platformId = ref('')
const shopId = ref('')
const shopSearch = ref('')
const openFilterSelect = ref('')
const activeRangeShortcut = ref('month')

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatMonth(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const now = new Date()
const dateFrom = ref(formatDate(new Date(now.getFullYear(), now.getMonth(), 1)))
const dateTo = ref(formatDate(now))
const selectedMonth = ref(formatMonth(now))
const monthPickerYear = ref(now.getFullYear())
const datePickerArea = ref(null)
const openDatePicker = ref('')
const rangeSelecting = ref('from')
const calendarCursor = ref(new Date(now.getFullYear(), now.getMonth(), 1))
const weekDays = ['日', '一', '二', '三', '四', '五', '六']

const calendarTitle = computed(
  () => `${calendarCursor.value.getFullYear()}年${calendarCursor.value.getMonth() + 1}月`,
)
const calendarTodayDisabled = computed(() => isCalendarDateDisabled(formatDate(new Date())))
const currentYear = computed(() => new Date().getFullYear())
const currentMonthValue = computed(() => formatMonth(new Date()))
const selectedMonthLabel = computed(() => {
  const matched = selectedMonth.value.match(/^(\d{4})-(\d{2})$/)
  return matched ? `${matched[1]}年${matched[2]}月` : '选择月份'
})
const monthPickerOptions = computed(() =>
  Array.from({ length: 12 }, (_, index) => {
    const value = `${monthPickerYear.value}-${String(index + 1).padStart(2, '0')}`
    return {
      value,
      label: `${index + 1}月`,
      disabled: value > currentMonthValue.value,
    }
  }),
)

const calendarDays = computed(() => {
  const year = calendarCursor.value.getFullYear()
  const month = calendarCursor.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - firstDay.getDay())
  const today = formatDate(new Date())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index,
    )
    const value = formatDate(date)
    return {
      value,
      label: date.getDate(),
      currentMonth: date.getMonth() === month,
      today: value === today,
      rangeStart: value === dateFrom.value,
      rangeEnd: value === dateTo.value,
      inRange: Boolean(dateFrom.value && dateTo.value && value > dateFrom.value && value < dateTo.value),
      disabled: isCalendarDateDisabled(value),
    }
  })
})

function parseDate(value) {
  const matched = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!matched) return null
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function displayDate(value) {
  const matched = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return matched ? `${matched[1]}年${matched[2]}月${matched[3]}日` : '请选择日期'
}

function openCalendar() {
  openFilterSelect.value = ''
  if (openDatePicker.value === 'range') {
    openDatePicker.value = ''
    return
  }
  rangeSelecting.value = 'from'
  const current = parseDate(dateFrom.value) || new Date()
  calendarCursor.value = new Date(current.getFullYear(), current.getMonth(), 1)
  openDatePicker.value = 'range'
}

function moveCalendarMonth(offset) {
  calendarCursor.value = new Date(
    calendarCursor.value.getFullYear(),
    calendarCursor.value.getMonth() + offset,
    1,
  )
}

function isCalendarDateDisabled(value) {
  const today = formatDate(new Date())
  if (value > today) return true
  if (rangeSelecting.value === 'to' && dateFrom.value && value < dateFrom.value) return true
  return false
}

function selectCalendarDate(day) {
  if (day.disabled) return
  activeRangeShortcut.value = ''
  selectedMonth.value = ''
  if (rangeSelecting.value === 'from') {
    dateFrom.value = day.value
    dateTo.value = ''
    rangeSelecting.value = 'to'
    return
  }
  dateTo.value = day.value
  openDatePicker.value = ''
}

function selectToday() {
  const value = formatDate(new Date())
  dateFrom.value = value
  dateTo.value = value
  activeRangeShortcut.value = ''
  selectedMonth.value = ''
  rangeSelecting.value = 'from'
  openDatePicker.value = ''
}

function closeDatePicker(event) {
  if (openDatePicker.value && !datePickerArea.value?.contains(event.target)) {
    openDatePicker.value = ''
  }
  if (openFilterSelect.value && !event.target.closest?.('.finance-custom-select')) {
    openFilterSelect.value = ''
  }
}

function closeDatePickerOnEscape(event) {
  if (event.key === 'Escape') {
    openDatePicker.value = ''
    openFilterSelect.value = ''
  }
}

const availableShops = computed(() =>
  props.shops.filter(
    (shop) => !platformId.value || String(shop.platformId) === String(platformId.value),
  ),
)
const selectedPlatformLabel = computed(
  () =>
    props.platforms.find((platform) => String(platform.id) === String(platformId.value))?.name ||
    '全部平台',
)
const selectedShopLabel = computed(() => {
  const shop = availableShops.value.find((item) => String(item.id) === String(shopId.value))
  return shop ? `${shop.name}（${shop.platformName || shop.platform}）` : '全部店铺'
})

function toggleFilterSelect(key) {
  openDatePicker.value = ''
  openFilterSelect.value = openFilterSelect.value === key ? '' : key
}

function toggleMonthSelect() {
  const source = selectedMonth.value || currentMonthValue.value
  monthPickerYear.value = Number(source.slice(0, 4))
  toggleFilterSelect('month')
}

function moveMonthPickerYear(offset) {
  monthPickerYear.value = Math.min(
    new Date().getFullYear(),
    monthPickerYear.value + Number(offset),
  )
}

function selectMonth(value) {
  const matched = String(value || '').match(/^(\d{4})-(\d{2})$/)
  if (!matched || value > currentMonthValue.value) return
  const year = Number(matched[1])
  const month = Number(matched[2]) - 1
  const start = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 0)
  const today = new Date()
  const end = monthEnd > today ? today : monthEnd
  dateFrom.value = formatDate(start)
  dateTo.value = formatDate(end)
  selectedMonth.value = value
  activeRangeShortcut.value = value === currentMonthValue.value ? 'month' : ''
  openFilterSelect.value = ''
  loadReport()
}

function selectPlatform(value) {
  platformId.value = value
  openFilterSelect.value = ''
}

function selectShop(value) {
  shopId.value = value
  openFilterSelect.value = ''
}

const filteredShopRows = computed(() => {
  const rows = report.value?.shops || []
  const query = shopSearch.value.trim().toLowerCase()
  if (!query) return rows
  return rows.filter((row) =>
    [row.shopName, row.shopCode, row.platformName].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query),
    ),
  )
})

const summary = computed(() => report.value?.summary || {})

function queryString() {
  const params = new URLSearchParams()
  if (dateFrom.value) params.set('dateFrom', dateFrom.value)
  if (dateTo.value) params.set('dateTo', dateTo.value)
  if (platformId.value) params.set('platformId', platformId.value)
  if (shopId.value) params.set('shopId', shopId.value)
  return params.toString()
}

async function request(path) {
  const response = await fetch(apiPath(path), { headers: userStore.authHeaders() })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.message || `请求失败：${response.status}`)
  }
  return payload.data
}

async function loadReport() {
  if (!dateFrom.value || !dateTo.value) {
    emit('error', '请选择完整的统计日期范围')
    return
  }
  if (dateFrom.value > dateTo.value) {
    emit('error', '开始日期不能晚于结束日期')
    return
  }
  loading.value = true
  try {
    report.value = await request(`/api/admin/finance/report?${queryString()}`)
    emit('loaded')
  } catch (error) {
    emit('error', error.message || '财务报表加载失败')
  } finally {
    loading.value = false
  }
}

async function exportReport() {
  exporting.value = true
  try {
    const response = await fetch(apiPath(`/api/admin/finance/export?${queryString()}`), {
      headers: userStore.authHeaders(),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new Error(payload?.message || `导出失败：${response.status}`)
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') || ''
    const matched = disposition.match(/filename="?([^";]+)"?/i)
    const filename = matched?.[1] || `youmi-finance-${dateFrom.value}-to-${dateTo.value}.csv`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    emit('error', error.message || '财务报表导出失败')
  } finally {
    exporting.value = false
  }
}

function applyRange(days) {
  openDatePicker.value = ''
  openFilterSelect.value = ''
  activeRangeShortcut.value = String(days)
  const end = new Date()
  const start = new Date()
  if (days === 'month') {
    start.setDate(1)
    selectedMonth.value = formatMonth(end)
  } else {
    start.setDate(start.getDate() - Number(days) + 1)
    selectedMonth.value = ''
  }
  dateFrom.value = formatDate(start)
  dateTo.value = formatDate(end)
  loadReport()
}

function resetFilters() {
  openDatePicker.value = ''
  openFilterSelect.value = ''
  const current = new Date()
  dateFrom.value = formatDate(new Date(current.getFullYear(), current.getMonth(), 1))
  dateTo.value = formatDate(current)
  selectedMonth.value = formatMonth(current)
  monthPickerYear.value = current.getFullYear()
  activeRangeShortcut.value = 'month'
  platformId.value = ''
  shopId.value = ''
  shopSearch.value = ''
  loadReport()
}

function integer(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function yuan(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

watch(platformId, () => {
  if (
    shopId.value &&
    !availableShops.value.some((shop) => String(shop.id) === String(shopId.value))
  ) {
    shopId.value = ''
  }
})

watch(
  () => props.refreshKey,
  () => loadReport(),
)

onMounted(() => {
  loadReport()
  document.addEventListener('pointerdown', closeDatePicker)
  document.addEventListener('keydown', closeDatePickerOnEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeDatePicker)
  document.removeEventListener('keydown', closeDatePickerOnEscape)
})
</script>

<template>
  <section class="finance-panel" aria-label="财务统计">
    <header class="finance-toolbar">
      <div>
        <h2>财务消耗统计</h2>
        <p>按成功米值流水核算，1 米值 = 0.01 元</p>
      </div>
      <div class="finance-toolbar-actions">
        <button
          type="button"
          class="finance-btn secondary"
          :disabled="loading"
          @click="resetFilters"
        >
          <i class="ri-restart-line" aria-hidden="true"></i>
          重置
        </button>
        <button
          type="button"
          class="finance-btn primary"
          :disabled="exporting || !report"
          @click="exportReport"
        >
          <i class="ri-file-download-line" aria-hidden="true"></i>
          {{ exporting ? '导出中...' : '导出财务报表' }}
        </button>
      </div>
    </header>

    <section class="finance-filters">
      <div class="finance-range-shortcuts" aria-label="快捷日期">
        <button type="button" :class="{ active: activeRangeShortcut === '7' }" @click="applyRange(7)">近7天</button>
        <button type="button" :class="{ active: activeRangeShortcut === '30' }" @click="applyRange(30)">近30天</button>
        <button type="button" :class="{ active: activeRangeShortcut === 'month' }" @click="applyRange('month')">本月</button>
      </div>
      <label class="finance-month-filter">
        <span>月份</span>
        <div class="finance-custom-select" :class="{ open: openFilterSelect === 'month' }">
          <button
            type="button"
            class="finance-custom-select-trigger"
            aria-haspopup="dialog"
            :aria-expanded="openFilterSelect === 'month'"
            @click.stop="toggleMonthSelect"
          >
            <i class="ri-calendar-2-line" aria-hidden="true"></i>
            <span>{{ selectedMonthLabel }}</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <section
            v-if="openFilterSelect === 'month'"
            class="finance-custom-select-menu finance-month-picker"
            role="dialog"
            aria-label="选择统计月份"
            @click.stop
          >
            <header>
              <button type="button" title="上一年" aria-label="上一年" @click="moveMonthPickerYear(-1)">
                <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
              </button>
              <strong>{{ monthPickerYear }}年</strong>
              <button
                type="button"
                title="下一年"
                aria-label="下一年"
                :disabled="monthPickerYear >= currentYear"
                @click="moveMonthPickerYear(1)"
              >
                <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
              </button>
            </header>
            <div class="finance-month-grid">
              <button
                v-for="month in monthPickerOptions"
                :key="month.value"
                type="button"
                :class="{ active: month.value === selectedMonth }"
                :disabled="month.disabled"
                @click="selectMonth(month.value)"
              >
                {{ month.label }}
              </button>
            </div>
          </section>
        </div>
      </label>
      <div ref="datePickerArea" class="finance-date-range finance-date-range--single">
        <div class="finance-date-field">
          <span class="finance-filter-label">统计日期范围</span>
          <button
            type="button"
            class="finance-date-trigger"
            :class="{ active: openDatePicker === 'range' }"
            aria-haspopup="dialog"
            :aria-expanded="openDatePicker === 'range'"
            @click.stop="openCalendar"
          >
            <i class="ri-calendar-event-line" aria-hidden="true"></i>
            <span v-if="dateFrom && dateTo">{{ displayDate(dateFrom) }} - {{ displayDate(dateTo) }}</span>
            <span v-else>请选择日期范围</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <section
            v-if="openDatePicker === 'range'"
            class="finance-calendar finance-calendar--range"
            role="dialog"
            aria-label="选择日期范围"
            @pointerdown.stop
          >
            <header>
              <button type="button" title="上个月" aria-label="上个月" @click="moveCalendarMonth(-1)">
                <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
              </button>
              <strong>{{ calendarTitle }}</strong>
              <button type="button" title="下个月" aria-label="下个月" @click="moveCalendarMonth(1)">
                <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
              </button>
            </header>
            <div class="finance-calendar-range-status">
              <button
                type="button"
                :class="{ active: rangeSelecting === 'from' }"
                @click="rangeSelecting = 'from'"
              >
                <span>开始日期</span>
                <b>{{ dateFrom ? displayDate(dateFrom) : '请选择' }}</b>
              </button>
              <span>至</span>
              <button
                type="button"
                :class="{ active: rangeSelecting === 'to' }"
                :disabled="!dateFrom"
                @click="rangeSelecting = 'to'"
              >
                <span>结束日期</span>
                <b>{{ dateTo ? displayDate(dateTo) : '请选择' }}</b>
              </button>
            </div>
            <div class="finance-calendar-week">
              <span v-for="weekday in weekDays" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="finance-calendar-days">
              <button
                v-for="day in calendarDays"
                :key="day.value"
                type="button"
                :class="{
                  muted: !day.currentMonth,
                  today: day.today,
                  selected: day.rangeStart || day.rangeEnd,
                  'range-start': day.rangeStart,
                  'range-end': day.rangeEnd,
                  'in-range': day.inRange,
                }"
                :disabled="day.disabled"
                :aria-label="day.value"
                @click="selectCalendarDate(day)"
              >
                {{ day.label }}
              </button>
            </div>
            <footer>
              <button type="button" @click="selectToday">今天</button>
            </footer>
          </section>
        </div>
      </div>
      <div v-if="false" ref="datePickerArea" class="finance-date-range">
        <div class="finance-date-field">
          <span class="finance-filter-label">开始日期</span>
          <button
            type="button"
            class="finance-date-trigger"
            :class="{ active: openDatePicker === 'from' }"
            aria-haspopup="dialog"
            :aria-expanded="openDatePicker === 'from'"
            @click.stop="openCalendar('from')"
          >
            <i class="ri-calendar-event-line" aria-hidden="true"></i>
            <span>{{ displayDate(dateFrom) }}</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <section
            v-if="openDatePicker === 'from'"
            class="finance-calendar"
            role="dialog"
            aria-label="选择开始日期"
            @pointerdown.stop
          >
            <header>
              <button
                type="button"
                title="上个月"
                aria-label="上个月"
                @click="moveCalendarMonth(-1)"
              >
                <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
              </button>
              <strong>{{ calendarTitle }}</strong>
              <button
                type="button"
                title="下个月"
                aria-label="下个月"
                @click="moveCalendarMonth(1)"
              >
                <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
              </button>
            </header>
            <div class="finance-calendar-week">
              <span v-for="weekday in weekDays" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="finance-calendar-days">
              <button
                v-for="day in calendarDays"
                :key="day.value"
                type="button"
                :class="{
                  muted: !day.currentMonth,
                  today: day.today,
                  selected: day.selected,
                }"
                :disabled="day.disabled"
                :aria-label="day.value"
                @click="selectCalendarDate(day)"
              >
                {{ day.label }}
              </button>
            </div>
            <footer>
              <button type="button" :disabled="calendarTodayDisabled" @click="selectToday">
                今天
              </button>
            </footer>
          </section>
        </div>

        <div class="finance-date-field finance-date-field--end">
          <span class="finance-filter-label">结束日期</span>
          <button
            type="button"
            class="finance-date-trigger"
            :class="{ active: openDatePicker === 'to' }"
            aria-haspopup="dialog"
            :aria-expanded="openDatePicker === 'to'"
            @click.stop="openCalendar('to')"
          >
            <i class="ri-calendar-event-line" aria-hidden="true"></i>
            <span>{{ displayDate(dateTo) }}</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <section
            v-if="openDatePicker === 'to'"
            class="finance-calendar"
            role="dialog"
            aria-label="选择结束日期"
            @pointerdown.stop
          >
            <header>
              <button
                type="button"
                title="上个月"
                aria-label="上个月"
                @click="moveCalendarMonth(-1)"
              >
                <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
              </button>
              <strong>{{ calendarTitle }}</strong>
              <button
                type="button"
                title="下个月"
                aria-label="下个月"
                @click="moveCalendarMonth(1)"
              >
                <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
              </button>
            </header>
            <div class="finance-calendar-week">
              <span v-for="weekday in weekDays" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="finance-calendar-days">
              <button
                v-for="day in calendarDays"
                :key="day.value"
                type="button"
                :class="{
                  muted: !day.currentMonth,
                  today: day.today,
                  selected: day.selected,
                }"
                :disabled="day.disabled"
                :aria-label="day.value"
                @click="selectCalendarDate(day)"
              >
                {{ day.label }}
              </button>
            </div>
            <footer>
              <button type="button" :disabled="calendarTodayDisabled" @click="selectToday">
                今天
              </button>
            </footer>
          </section>
        </div>
      </div>
      <label>
        <span>平台</span>
        <div class="finance-custom-select" :class="{ open: openFilterSelect === 'platform' }">
          <button
            type="button"
            class="finance-custom-select-trigger"
            :aria-expanded="openFilterSelect === 'platform'"
            @click.stop="toggleFilterSelect('platform')"
          >
            <span>{{ selectedPlatformLabel }}</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <div
            v-if="openFilterSelect === 'platform'"
            class="finance-custom-select-menu"
            role="listbox"
          >
            <button
              type="button"
              class="finance-custom-select-option"
              :class="{ active: !platformId }"
              role="option"
              :aria-selected="!platformId"
              @click.stop="selectPlatform('')"
            >
              <span>全部平台</span>
              <i v-if="!platformId" class="ri-check-line" aria-hidden="true"></i>
            </button>
            <button
              v-for="platform in platforms"
              :key="platform.id"
              type="button"
              class="finance-custom-select-option"
              :class="{ active: String(platformId) === String(platform.id) }"
              role="option"
              :aria-selected="String(platformId) === String(platform.id)"
              @click.stop="selectPlatform(String(platform.id))"
            >
              <span>{{ platform.name }}</span>
              <i
                v-if="String(platformId) === String(platform.id)"
                class="ri-check-line"
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </div>
      </label>
      <label>
        <span>店铺</span>
        <div class="finance-custom-select" :class="{ open: openFilterSelect === 'shop' }">
          <button
            type="button"
            class="finance-custom-select-trigger"
            :aria-expanded="openFilterSelect === 'shop'"
            @click.stop="toggleFilterSelect('shop')"
          >
            <span>{{ selectedShopLabel }}</span>
            <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
          </button>
          <div
            v-if="openFilterSelect === 'shop'"
            class="finance-custom-select-menu finance-custom-select-menu--shop"
            role="listbox"
          >
            <button
              type="button"
              class="finance-custom-select-option"
              :class="{ active: !shopId }"
              role="option"
              :aria-selected="!shopId"
              @click.stop="selectShop('')"
            >
              <span>全部店铺</span>
              <i v-if="!shopId" class="ri-check-line" aria-hidden="true"></i>
            </button>
            <button
              v-for="shop in availableShops"
              :key="shop.id"
              type="button"
              class="finance-custom-select-option"
              :class="{ active: String(shopId) === String(shop.id) }"
              role="option"
              :aria-selected="String(shopId) === String(shop.id)"
              @click.stop="selectShop(String(shop.id))"
            >
              <span>{{ shop.name }}（{{ shop.platformName || shop.platform }}）</span>
              <i
                v-if="String(shopId) === String(shop.id)"
                class="ri-check-line"
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </div>
      </label>
      <button type="button" class="finance-query" :disabled="loading" @click="loadReport">
        <i
          :class="loading ? 'ri-loader-4-line finance-spin' : 'ri-search-line'"
          aria-hidden="true"
        ></i>
        {{ loading ? '统计中...' : '开始统计' }}
      </button>
    </section>

    <section class="finance-summary" aria-label="财务汇总">
      <article class="finance-summary-card finance-summary-total">
        <i class="ri-money-cny-circle-line" aria-hidden="true"></i>
        <span>消耗金额</span>
        <strong>{{ yuan(summary.totalYuan) }}</strong>
        <small>{{ integer(summary.totalMi) }} 米值</small>
      </article>
      <article class="finance-summary-card">
        <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
        <span>成功消费</span>
        <strong>{{ integer(summary.transactionCount) }}</strong>
        <small>已排除失败、回滚和调账</small>
      </article>
      <article class="finance-summary-card">
        <i class="ri-image-line" aria-hidden="true"></i>
        <span>生图消耗</span>
        <strong>{{ integer(summary.imageMi) }}</strong>
        <small>{{ yuan(Number(summary.imageMi || 0) / 100) }}</small>
      </article>
      <article class="finance-summary-card">
        <i class="ri-video-line" aria-hidden="true"></i>
        <span>视频消耗</span>
        <strong>{{ integer(summary.videoMi) }}</strong>
        <small>{{ yuan(Number(summary.videoMi || 0) / 100) }}</small>
      </article>
      <article class="finance-summary-card">
        <i class="ri-store-2-line" aria-hidden="true"></i>
        <span>消费店铺</span>
        <strong>{{ integer(summary.shopCount) }}</strong>
        <small>{{ integer(summary.userCount) }} 个账号</small>
      </article>
    </section>

    <div v-if="loading && !report" class="finance-loading">正在核算米值流水...</div>
    <template v-else>
      <section class="finance-table-section">
        <div class="finance-section-head">
          <div>
            <h3>每日消耗</h3>
            <p>{{ report?.period?.dateFrom }} 至 {{ report?.period?.dateTo }}</p>
          </div>
        </div>
        <div class="finance-table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>消费笔数</th>
                <th>用户数</th>
                <th>生图米值</th>
                <th>视频米值</th>
                <th>总米值</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report?.daily || []" :key="row.day">
                <td>{{ row.day }}</td>
                <td>{{ integer(row.transactionCount) }}</td>
                <td>{{ integer(row.userCount) }}</td>
                <td>{{ integer(row.imageMi) }}</td>
                <td>{{ integer(row.videoMi) }}</td>
                <td>
                  <strong>{{ integer(row.totalMi) }}</strong>
                </td>
                <td class="money">{{ yuan(row.totalYuan) }}</td>
              </tr>
              <tr v-if="!report?.daily?.length">
                <td colspan="7" class="finance-empty">该范围内没有成功消费流水</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="finance-dimension-grid">
        <section class="finance-table-section">
          <div class="finance-section-head">
            <div>
              <h3>平台汇总</h3>
              <p>按平台核算消耗</p>
            </div>
          </div>
          <div class="finance-table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>平台</th>
                  <th>店铺</th>
                  <th>消费笔数</th>
                  <th>总米值</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report?.platforms || []" :key="row.platformId ?? 'unbound'">
                  <td>
                    <strong>{{ row.platformName }}</strong>
                  </td>
                  <td>{{ integer(row.shopCount) }}</td>
                  <td>{{ integer(row.transactionCount) }}</td>
                  <td>{{ integer(row.totalMi) }}</td>
                  <td class="money">{{ yuan(row.totalYuan) }}</td>
                </tr>
                <tr v-if="!report?.platforms?.length">
                  <td colspan="5" class="finance-empty">暂无平台数据</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="finance-table-section">
          <div class="finance-section-head">
            <div>
              <h3>店铺汇总</h3>
              <p>店铺名称附带所属平台</p>
            </div>
            <div class="finance-shop-search">
              <i class="ri-search-line" aria-hidden="true"></i>
              <input v-model.trim="shopSearch" placeholder="搜索店铺或平台" />
            </div>
          </div>
          <div class="finance-table-wrap compact">
            <table>
              <thead>
                <tr>
                  <th>店铺</th>
                  <th>平台</th>
                  <th>用户</th>
                  <th>总米值</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in filteredShopRows" :key="row.shopId ?? 'unbound'">
                  <td>
                    <strong>{{ row.shopName }}</strong>
                    <small>{{ row.shopCode }}</small>
                  </td>
                  <td>{{ row.platformName }}</td>
                  <td>{{ integer(row.userCount) }}</td>
                  <td>{{ integer(row.totalMi) }}</td>
                  <td class="money">{{ yuan(row.totalYuan) }}</td>
                </tr>
                <tr v-if="!filteredShopRows.length">
                  <td colspan="5" class="finance-empty">暂无匹配店铺</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.finance-panel {
  display: grid;
  gap: 18px;
}

.finance-toolbar,
.finance-filters,
.finance-summary,
.finance-section-head {
  display: flex;
  align-items: center;
}

.finance-toolbar {
  justify-content: space-between;
  gap: 16px;
}

.finance-toolbar h2,
.finance-section-head h3 {
  margin: 0;
  color: #f1f5f9;
}

.finance-toolbar h2 {
  font-size: 22px;
}

.finance-toolbar p,
.finance-section-head p {
  margin: 5px 0 0;
  color: #94a3b8;
  font-size: 13px;
}

.finance-toolbar-actions,
.finance-range-shortcuts {
  display: flex;
  gap: 8px;
}

.finance-btn,
.finance-query,
.finance-range-shortcuts button {
  height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  padding: 0 13px;
  color: #e2e8f0;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
}

.finance-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.finance-btn.primary,
.finance-query {
  border-color: var(--yq-primary);
  background: var(--yq-primary);
  color: #fff;
}

.finance-btn:disabled,
.finance-query:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.finance-filters {
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.72);
  flex-wrap: wrap;
}

.finance-filters label {
  display: grid;
  gap: 6px;
  min-width: 148px;
}

.finance-filters label span {
  color: #94a3b8;
  font-size: 12px;
}

.finance-date-range {
  display: flex;
  align-self: end;
  gap: 12px;
}

.finance-date-range--single .finance-date-field {
  min-width: 304px;
}

.finance-date-field {
  position: relative;
  display: grid;
  gap: 6px;
  min-width: 190px;
}

.finance-filter-label {
  color: #94a3b8;
  font-size: 12px;
}

.finance-date-trigger {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 18px;
  align-items: center;
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  padding: 0 9px;
  color: #e2e8f0;
  background: #111827;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.finance-date-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finance-date-trigger > i {
  color: #64748b;
  font-size: 16px;
}

.finance-date-trigger > i:last-child {
  justify-self: end;
  transition: transform 0.18s ease;
}

.finance-date-trigger:hover,
.finance-date-trigger.active {
  border-color: var(--yq-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--yq-primary) 18%, transparent);
}

.finance-date-trigger.active > i:last-child {
  transform: rotate(180deg);
}

.finance-calendar {
  position: absolute;
  z-index: 30;
  top: calc(100% + 8px);
  left: 0;
  width: 304px;
  box-sizing: border-box;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  padding: 10px;
  color: #e2e8f0;
  background: #111827;
  box-shadow: 0 18px 45px rgba(2, 6, 23, 0.46);
}

.finance-date-field--end .finance-calendar {
  right: 0;
  left: auto;
}

.finance-calendar header {
  display: grid;
  grid-template-columns: 32px 1fr 32px;
  align-items: center;
  margin-bottom: 8px;
}

.finance-calendar header strong {
  color: #f8fafc;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
}

.finance-calendar header button,
.finance-calendar-days button {
  display: grid;
  place-items: center;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.finance-calendar header button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  font-size: 20px;
}

.finance-calendar header button:hover {
  background: rgba(148, 163, 184, 0.14);
}

.finance-calendar-week,
.finance-calendar-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.finance-calendar-week {
  margin-bottom: 4px;
}

.finance-calendar-week span {
  color: #64748b;
  font-size: 11px;
  line-height: 26px;
  text-align: center;
}

.finance-calendar-days {
  gap: 2px;
}

.finance-calendar-days button {
  width: 36px;
  height: 34px;
  border-radius: 6px;
  font-size: 12px;
}

.finance-calendar-days button:hover:not(:disabled):not(.selected) {
  color: #fff;
  background: rgba(148, 163, 184, 0.14);
}

.finance-calendar-days button.muted {
  color: #475569;
}

.finance-calendar-days button.today {
  outline: 1px solid color-mix(in srgb, var(--yq-primary) 70%, transparent);
  outline-offset: -2px;
}

.finance-calendar-days button.selected {
  color: #fff;
  background: var(--yq-primary);
  font-weight: 700;
}

.finance-calendar-days button.in-range {
  color: #dbeafe;
  background: color-mix(in srgb, var(--yq-primary) 18%, transparent);
  border-radius: 0;
}

.finance-calendar-days button.range-start,
.finance-calendar-days button.range-end {
  position: relative;
  z-index: 1;
  border-radius: 6px;
}

.finance-calendar-range-status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.finance-calendar-range-status > span {
  color: #64748b;
  font-size: 12px;
  text-align: center;
}

.finance-calendar-range-status button {
  display: grid;
  gap: 2px;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  padding: 6px 8px;
  color: #94a3b8;
  background: rgba(30, 41, 59, 0.72);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.finance-calendar-range-status button.active {
  border-color: var(--yq-primary);
  color: #e2e8f0;
  background: color-mix(in srgb, var(--yq-primary) 12%, transparent);
}

.finance-calendar-range-status button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.finance-calendar-range-status button span {
  font-size: 10px;
}

.finance-calendar-range-status button b {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finance-calendar-days button:disabled {
  color: #334155;
  cursor: not-allowed;
  text-decoration: line-through;
}

.finance-calendar footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.15);
}

.finance-calendar footer button {
  height: 30px;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--yq-primary);
  background: color-mix(in srgb, var(--yq-primary) 12%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.finance-calendar footer button:disabled {
  color: #475569;
  background: transparent;
  cursor: not-allowed;
}

.finance-filters input,
.finance-filters select,
.finance-shop-search input {
  height: 36px;
  box-sizing: border-box;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  padding: 0 10px;
  color: #e2e8f0;
  background: #111827;
}

.finance-custom-select {
  position: relative;
  min-width: 148px;
}

.finance-custom-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 9px 0 11px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 9px;
  background: #111827;
  color: #e2e8f0;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}

.finance-custom-select-trigger > span,
.finance-custom-select-option > span {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.finance-custom-select-trigger > i {
  flex: 0 0 auto;
  color: #94a3b8;
  font-size: 17px;
  transition: transform 140ms ease;
}

.finance-custom-select-trigger:hover {
  border-color: rgba(34, 211, 238, 0.58);
  background: #172033;
}

.finance-custom-select.open .finance-custom-select-trigger {
  border-color: #22d3ee;
  box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.14);
}

.finance-custom-select.open .finance-custom-select-trigger > i:last-child {
  transform: rotate(180deg);
}

.finance-custom-select-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 60;
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 10px;
  background: #111827;
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.48);
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.4) transparent;
}

.finance-custom-select-menu--shop {
  min-width: min(280px, calc(100vw - 32px));
}

.finance-month-filter {
  align-self: end;
  min-width: 168px !important;
}

.finance-month-filter .finance-custom-select {
  min-width: 168px;
}

.finance-month-filter .finance-custom-select-trigger {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 18px;
}

.finance-month-filter .finance-custom-select-trigger > i:first-child {
  color: var(--console-accent);
  font-size: 16px;
}

.finance-month-picker {
  right: auto;
  left: 0;
  width: 260px;
  max-height: none;
  overflow: visible;
  padding: 8px;
}

.finance-month-picker header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  margin-bottom: 8px;
}

.finance-month-picker header strong {
  color: var(--console-text);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.finance-month-picker header button,
.finance-month-grid button {
  display: grid;
  place-items: center;
  border: 0;
  color: var(--console-text);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.finance-month-picker header button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  font-size: 18px;
}

.finance-month-picker header button:hover:not(:disabled),
.finance-month-grid button:hover:not(:disabled) {
  background: var(--console-surface-hover);
}

.finance-month-picker header button:disabled,
.finance-month-grid button:disabled {
  color: var(--console-subtle);
  opacity: 0.38;
  cursor: not-allowed;
}

.finance-month-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.finance-month-grid button {
  min-height: 34px;
  border-radius: 6px;
  font-size: 12px;
}

.finance-month-grid button.active {
  color: var(--console-accent);
  background: var(--console-accent-soft);
  font-weight: 600;
}

.finance-custom-select-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 7px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #cbd5e1;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.finance-custom-select-option:hover {
  background: rgba(51, 65, 85, 0.72);
  color: #f8fafc;
}

.finance-custom-select-option.active {
  background: rgba(34, 211, 238, 0.14);
  color: #67e8f9;
  font-weight: 700;
}

.finance-custom-select-option > i {
  flex: 0 0 auto;
  color: currentColor;
  font-size: 16px;
}

.finance-range-shortcuts {
  align-self: end;
}

.finance-query {
  align-self: end;
  min-width: 104px;
}

.finance-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.finance-summary article,
.finance-table-section {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(30, 41, 59, 0.72);
}

.finance-summary article {
  display: grid;
  gap: 7px;
  padding: 16px;
}

.finance-summary span,
.finance-summary small {
  color: #94a3b8;
  font-size: 12px;
}

.finance-summary strong {
  color: #f8fafc;
  font-size: 24px;
}

.finance-summary article:first-child strong,
.money {
  color: #34d399;
}

.finance-table-section {
  min-width: 0;
  overflow: hidden;
}

.finance-section-head {
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}

.finance-section-head h3 {
  font-size: 16px;
}

.finance-table-wrap {
  overflow: auto;
  max-height: 360px;
}

.finance-table-wrap.compact {
  max-height: 320px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  text-align: right;
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #94a3b8;
  background: #1e293b;
  font-weight: 500;
}

th:first-child,
td:first-child,
.finance-dimension-grid th:nth-child(2),
.finance-dimension-grid td:nth-child(2) {
  text-align: left;
}

td {
  color: #cbd5e1;
}

td strong {
  display: block;
  color: #f1f5f9;
}

td small {
  display: block;
  margin-top: 3px;
  color: #64748b;
}

.finance-dimension-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.82fr) minmax(0, 1.18fr);
  gap: 18px;
}

.finance-shop-search {
  position: relative;
}

.finance-shop-search i {
  position: absolute;
  left: 10px;
  top: 50%;
  color: #64748b;
  transform: translateY(-50%);
}

.finance-shop-search input {
  width: 190px;
  padding-left: 31px;
}

.finance-loading,
.finance-empty {
  padding: 32px;
  color: #94a3b8;
  text-align: center !important;
}

.finance-spin {
  display: inline-block;
  animation: finance-spin 0.8s linear infinite;
}

@keyframes finance-spin {
  to {
    transform: rotate(360deg);
  }
}

[data-theme='light'] .finance-toolbar h2,
[data-theme='light'] .finance-section-head h3,
[data-theme='light'] .finance-summary strong,
[data-theme='light'] td strong {
  color: #0f172a;
}

[data-theme='light'] .finance-filters,
[data-theme='light'] .finance-summary article,
[data-theme='light'] .finance-table-section {
  border-color: #dbe3ef;
  background: #fff;
}

[data-theme='light'] .finance-filters input,
[data-theme='light'] .finance-filters select,
[data-theme='light'] .finance-date-trigger,
[data-theme='light'] .finance-shop-search input {
  border-color: #dbe3ef;
  color: #1e293b;
  background: #f8fafc;
}

[data-theme='light'] .finance-custom-select-trigger {
  border-color: #dbe3ef;
  color: #1e293b;
  background: #f8fafc;
}

[data-theme='light'] .finance-custom-select-trigger > i {
  color: #64748b;
}

[data-theme='light'] .finance-custom-select-trigger:hover {
  border-color: #0891b2;
  background: #f1f5f9;
}

[data-theme='light'] .finance-custom-select.open .finance-custom-select-trigger {
  border-color: #0891b2;
  box-shadow: 0 0 0 2px rgba(8, 145, 178, 0.13);
}

[data-theme='light'] .finance-custom-select-menu {
  border-color: #dbe3ef;
  background: #fff;
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  scrollbar-color: rgba(100, 116, 139, 0.36) transparent;
}

[data-theme='light'] .finance-custom-select-option {
  color: #475569;
}

[data-theme='light'] .finance-custom-select-option:hover {
  color: #0f172a;
  background: #f1f5f9;
}

[data-theme='light'] .finance-custom-select-option.active {
  color: #0e7490;
  background: #cffafe;
}

[data-theme='light'] .finance-calendar {
  border-color: #dbe3ef;
  color: #334155;
  background: #fff;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

[data-theme='light'] .finance-calendar header strong {
  color: #0f172a;
}

[data-theme='light'] .finance-calendar-days button.muted {
  color: #94a3b8;
}

[data-theme='light'] .finance-calendar-days button:disabled {
  color: #cbd5e1;
}

[data-theme='light'] .finance-calendar footer button:disabled {
  color: #94a3b8;
}

[data-theme='light'] th {
  color: #64748b;
  background: #f8fafc;
}

[data-theme='light'] td {
  color: #334155;
}

@media (max-width: 980px) {
  .finance-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .finance-dimension-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .finance-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .finance-summary {
    grid-template-columns: 1fr;
  }

  .finance-filters label,
  .finance-date-range,
  .finance-date-field,
  .finance-query {
    width: 100%;
  }

  .finance-date-range {
    flex-direction: column;
  }

  .finance-date-range--single .finance-date-field {
    min-width: 0;
  }

  .finance-calendar {
    right: auto;
    left: 0;
    width: min(304px, calc(100vw - 56px));
  }
}

/* ── Finance workspace refinement ── */
.finance-panel {
  gap: 14px;
  margin-top: 14px;
  color: var(--console-text);
}

.finance-toolbar {
  min-height: 48px;
  gap: 14px;
}

.finance-toolbar h2,
.finance-section-head h3,
[data-theme='light'] .finance-toolbar h2,
[data-theme='light'] .finance-section-head h3 {
  color: var(--console-text);
}

.finance-toolbar h2 {
  font-size: 19px;
}

.finance-toolbar p,
.finance-section-head p,
[data-theme='light'] .finance-toolbar p,
[data-theme='light'] .finance-section-head p {
  color: var(--console-muted);
}

.finance-btn,
.finance-query,
.finance-range-shortcuts button {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-color: var(--console-border);
  border-radius: 7px;
  color: var(--console-text);
  background: var(--console-surface-raised);
  font-weight: 500;
}

.finance-btn:hover:not(:disabled),
.finance-range-shortcuts button:hover {
  border-color: var(--console-border-strong);
  background: var(--console-surface-hover);
}

.finance-range-shortcuts button.active,
.finance-range-shortcuts button.active:hover,
[data-theme='light'] .finance-range-shortcuts button.active,
[data-theme='light'] .finance-range-shortcuts button.active:hover {
  border-color: var(--console-accent);
  color: var(--console-accent);
  background: var(--console-accent-soft);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--console-accent) 14%, transparent);
}

.finance-btn.primary,
.finance-query {
  border-color: var(--console-accent);
  color: #fff;
  background: var(--console-accent);
}

.finance-btn.primary:hover:not(:disabled),
.finance-query:hover:not(:disabled) {
  border-color: var(--console-accent-strong);
  background: var(--console-accent-strong);
}

.finance-filters,
[data-theme='light'] .finance-filters {
  gap: 10px;
  padding: 13px;
  border-color: var(--console-border);
  border-radius: 8px;
  background: var(--console-surface);
}

.finance-filter-label,
.finance-filters label span,
[data-theme='light'] .finance-filter-label,
[data-theme='light'] .finance-filters label span {
  color: var(--console-muted);
}

.finance-date-trigger,
.finance-filters input,
.finance-filters select,
.finance-shop-search input,
.finance-custom-select-trigger,
[data-theme='light'] .finance-date-trigger,
[data-theme='light'] .finance-filters input,
[data-theme='light'] .finance-filters select,
[data-theme='light'] .finance-shop-search input,
[data-theme='light'] .finance-custom-select-trigger {
  border-color: var(--console-border);
  border-radius: 7px;
  color: var(--console-text);
  background: var(--console-input);
}

.finance-date-trigger:hover,
.finance-date-trigger.active,
.finance-custom-select-trigger:hover,
.finance-custom-select.open .finance-custom-select-trigger,
[data-theme='light'] .finance-custom-select-trigger:hover,
[data-theme='light'] .finance-custom-select.open .finance-custom-select-trigger {
  border-color: var(--console-accent);
  background: var(--console-input);
  box-shadow: 0 0 0 2px var(--console-accent-soft);
}

.finance-date-trigger > i,
.finance-custom-select-trigger > i,
[data-theme='light'] .finance-custom-select-trigger > i {
  color: var(--console-muted);
}

.finance-custom-select-menu,
.finance-calendar,
[data-theme='light'] .finance-custom-select-menu,
[data-theme='light'] .finance-calendar {
  border-color: var(--console-border);
  border-radius: 8px;
  color: var(--console-text);
  background: var(--console-surface-raised);
  box-shadow: var(--console-shadow);
}

.finance-custom-select-option,
[data-theme='light'] .finance-custom-select-option {
  color: var(--console-text);
}

.finance-custom-select-option:hover,
[data-theme='light'] .finance-custom-select-option:hover {
  color: var(--console-text);
  background: var(--console-surface-hover);
}

.finance-custom-select-option.active,
[data-theme='light'] .finance-custom-select-option.active {
  color: var(--console-accent);
  background: var(--console-accent-soft);
}

.finance-calendar header strong,
[data-theme='light'] .finance-calendar header strong {
  color: var(--console-text);
}

.finance-calendar header button:hover,
.finance-calendar-days button:hover:not(:disabled):not(.selected) {
  color: var(--console-text);
  background: var(--console-surface-hover);
}

.finance-calendar-days button.today {
  outline-color: var(--console-accent);
}

.finance-calendar-days button.selected,
.finance-calendar-days button.range-start,
.finance-calendar-days button.range-end {
  color: #fff;
  background: var(--console-accent);
}

.finance-calendar-days button.in-range {
  color: var(--console-accent);
  background: var(--console-accent-soft);
}

.finance-calendar-range-status button {
  border-color: var(--console-border);
  color: var(--console-muted);
  background: var(--console-input);
}

.finance-calendar-range-status button.active {
  border-color: var(--console-accent);
  color: var(--console-text);
  background: var(--console-accent-soft);
}

.finance-summary {
  gap: 12px;
}

.finance-summary article,
.finance-table-section,
[data-theme='light'] .finance-summary article,
[data-theme='light'] .finance-table-section {
  border-color: var(--console-border);
  border-radius: 8px;
  background: var(--console-surface);
  box-shadow: var(--console-shadow);
}

.finance-summary-card {
  position: relative;
  min-height: 88px;
  overflow: hidden;
}

.finance-summary-card > i {
  position: absolute;
  top: 13px;
  right: 13px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  color: var(--console-accent);
  background: var(--console-accent-soft);
  font-size: 16px;
}

.finance-summary-total > i {
  color: var(--console-success);
  background: var(--console-success-soft);
}

.finance-summary span,
.finance-summary small,
[data-theme='light'] .finance-summary span,
[data-theme='light'] .finance-summary small {
  padding-right: 30px;
  color: var(--console-muted);
}

.finance-summary strong,
[data-theme='light'] .finance-summary strong {
  color: var(--console-text);
  font-size: 23px;
  font-variant-numeric: tabular-nums;
}

.finance-summary article:first-child strong,
.money,
[data-theme='light'] .finance-summary article:first-child strong {
  color: var(--console-success);
}

.finance-section-head {
  min-height: 58px;
  border-color: var(--console-border);
}

.finance-table-wrap {
  scrollbar-color: var(--console-border-strong) transparent;
}

th,
[data-theme='light'] th {
  color: var(--console-muted);
  background: var(--console-surface-raised);
  font-size: 12px;
  font-weight: 500;
}

td,
[data-theme='light'] td {
  border-color: var(--console-border);
  color: var(--console-text);
}

tbody tr:hover td {
  background: var(--console-surface-hover);
}

td strong,
[data-theme='light'] td strong {
  color: var(--console-text);
}

td small {
  color: var(--console-muted);
}

.finance-loading,
.finance-empty {
  color: var(--console-muted);
}

@media (max-width: 1180px) {
  .finance-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .finance-toolbar-actions,
  .finance-range-shortcuts {
    flex-wrap: wrap;
  }

  .finance-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .finance-summary {
    grid-template-columns: 1fr;
  }
}
</style>

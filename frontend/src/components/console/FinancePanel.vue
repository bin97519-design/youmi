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

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const now = new Date()
const dateFrom = ref(formatDate(new Date(now.getFullYear(), now.getMonth(), 1)))
const dateTo = ref(formatDate(now))
const datePickerArea = ref(null)
const openDatePicker = ref('')
const calendarCursor = ref(new Date(now.getFullYear(), now.getMonth(), 1))
const weekDays = ['日', '一', '二', '三', '四', '五', '六']

const calendarTitle = computed(
  () => `${calendarCursor.value.getFullYear()}年${calendarCursor.value.getMonth() + 1}月`,
)
const calendarTodayDisabled = computed(() => isCalendarDateDisabled(formatDate(new Date())))

const calendarDays = computed(() => {
  const year = calendarCursor.value.getFullYear()
  const month = calendarCursor.value.getMonth()
  const firstDay = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - firstDay.getDay())
  const today = formatDate(new Date())
  const selected = openDatePicker.value === 'from' ? dateFrom.value : dateTo.value

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
      selected: value === selected,
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

function openCalendar(target) {
  if (openDatePicker.value === target) {
    openDatePicker.value = ''
    return
  }
  const current = parseDate(target === 'from' ? dateFrom.value : dateTo.value) || new Date()
  calendarCursor.value = new Date(current.getFullYear(), current.getMonth(), 1)
  openDatePicker.value = target
}

function moveCalendarMonth(offset) {
  calendarCursor.value = new Date(
    calendarCursor.value.getFullYear(),
    calendarCursor.value.getMonth() + offset,
    1,
  )
}

function isCalendarDateDisabled(value) {
  if (openDatePicker.value === 'from' && dateTo.value && value > dateTo.value) return true
  if (openDatePicker.value === 'to' && dateFrom.value && value < dateFrom.value) return true
  return false
}

function selectCalendarDate(day) {
  if (day.disabled) return
  if (openDatePicker.value === 'from') dateFrom.value = day.value
  if (openDatePicker.value === 'to') dateTo.value = day.value
  openDatePicker.value = ''
}

function selectToday() {
  const value = formatDate(new Date())
  if (isCalendarDateDisabled(value)) return
  selectCalendarDate({ value, disabled: false })
}

function closeDatePicker(event) {
  if (openDatePicker.value && !datePickerArea.value?.contains(event.target)) {
    openDatePicker.value = ''
  }
}

function closeDatePickerOnEscape(event) {
  if (event.key === 'Escape') openDatePicker.value = ''
}

const availableShops = computed(() =>
  props.shops.filter(
    (shop) => !platformId.value || String(shop.platformId) === String(platformId.value),
  ),
)

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
  const end = new Date()
  const start = new Date()
  if (days === 'month') {
    start.setDate(1)
  } else {
    start.setDate(start.getDate() - Number(days) + 1)
  }
  dateFrom.value = formatDate(start)
  dateTo.value = formatDate(end)
  loadReport()
}

function resetFilters() {
  openDatePicker.value = ''
  const current = new Date()
  dateFrom.value = formatDate(new Date(current.getFullYear(), current.getMonth(), 1))
  dateTo.value = formatDate(current)
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
        <button type="button" @click="applyRange(7)">近7天</button>
        <button type="button" @click="applyRange(30)">近30天</button>
        <button type="button" @click="applyRange('month')">本月</button>
      </div>
      <div ref="datePickerArea" class="finance-date-range">
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
        <select v-model="platformId">
          <option value="">全部平台</option>
          <option v-for="platform in platforms" :key="platform.id" :value="String(platform.id)">
            {{ platform.name }}
          </option>
        </select>
      </label>
      <label>
        <span>店铺</span>
        <select v-model="shopId">
          <option value="">全部店铺</option>
          <option v-for="shop in availableShops" :key="shop.id" :value="String(shop.id)">
            {{ shop.name }}（{{ shop.platformName || shop.platform }}）
          </option>
        </select>
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
      <article>
        <span>消耗金额</span>
        <strong>{{ yuan(summary.totalYuan) }}</strong>
        <small>{{ integer(summary.totalMi) }} 米值</small>
      </article>
      <article>
        <span>成功消费</span>
        <strong>{{ integer(summary.transactionCount) }}</strong>
        <small>已排除失败、回滚和调账</small>
      </article>
      <article>
        <span>生图消耗</span>
        <strong>{{ integer(summary.imageMi) }}</strong>
        <small>{{ yuan(Number(summary.imageMi || 0) / 100) }}</small>
      </article>
      <article>
        <span>视频消耗</span>
        <strong>{{ integer(summary.videoMi) }}</strong>
        <small>{{ yuan(Number(summary.videoMi || 0) / 100) }}</small>
      </article>
      <article>
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

:global([data-theme='light']) .finance-toolbar h2,
:global([data-theme='light']) .finance-section-head h3,
:global([data-theme='light']) .finance-summary strong,
:global([data-theme='light']) td strong {
  color: #0f172a;
}

:global([data-theme='light']) .finance-filters,
:global([data-theme='light']) .finance-summary article,
:global([data-theme='light']) .finance-table-section {
  border-color: #dbe3ef;
  background: #fff;
}

:global([data-theme='light']) .finance-filters input,
:global([data-theme='light']) .finance-filters select,
:global([data-theme='light']) .finance-date-trigger,
:global([data-theme='light']) .finance-shop-search input {
  border-color: #dbe3ef;
  color: #1e293b;
  background: #f8fafc;
}

:global([data-theme='light']) .finance-calendar {
  border-color: #dbe3ef;
  color: #334155;
  background: #fff;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
}

:global([data-theme='light']) .finance-calendar header strong {
  color: #0f172a;
}

:global([data-theme='light']) .finance-calendar-days button.muted {
  color: #94a3b8;
}

:global([data-theme='light']) .finance-calendar-days button:disabled {
  color: #cbd5e1;
}

:global([data-theme='light']) .finance-calendar footer button:disabled {
  color: #94a3b8;
}

:global([data-theme='light']) th {
  color: #64748b;
  background: #f8fafc;
}

:global([data-theme='light']) td {
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

  .finance-calendar {
    right: auto;
    left: 0;
    width: min(304px, calc(100vw - 56px));
  }
}
</style>

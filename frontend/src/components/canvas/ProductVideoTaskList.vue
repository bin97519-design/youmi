<script setup>
import { computed, ref, watch } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import {
  productVideoTaskState,
  queryProductVideoTasks,
  selectedImage,
} from '../../utils/productVideo'

const props = defineProps({
  tasks: { type: Array, default: () => [] },
  activity: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['open', 'create'])
const keyword = ref(''),
  status = ref(''),
  page = ref(1),
  pageSize = ref(10)
const labels = {
  draft: '待策划',
  planning: '策划中',
  editing: '制作中',
  generating: '生成中',
  unknown: '待核对',
  failed: '有失败项',
  completed: '已完成',
}
const statusOptions = [
  { value: '', label: '全部状态' },
  ...Object.entries(labels).map(([value, label]) => ({ value, label })),
]
const sizeOptions = [10, 20, 50].map((value) => ({ value, label: `${value} 条/页` }))
const result = computed(() =>
  queryProductVideoTasks(props.tasks, {
    keyword: keyword.value,
    status: status.value,
    page: page.value,
    pageSize: pageSize.value,
    activity: props.activity,
  }),
)
watch([keyword, status, pageSize], () => {
  page.value = 1
})
watch(
  () => result.value.page,
  (value) => {
    page.value = value
  },
)
const state = (task) => productVideoTaskState(task, props.activity[task.id])
const cover = (task) => task.shots.map(selectedImage).find(Boolean)?.url || task.references[0]?.url
const videos = (task) => task.shots.filter((shot) => shot.videos.some((item) => item.url)).length
function clearFilters() {
  keyword.value = ''
  status.value = ''
}
function date(value) {
  if (!value) return '历史任务'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}
</script>

<template>
  <main class="pv-task-list" aria-label="主图视频任务列表">
    <div class="task-list-heading">
      <h3>
        任务列表
        <small>{{ tasks.length }}</small>
      </h3>
      <button class="task-create" @click="emit('create')">
        <i class="ri-add-line" aria-hidden="true"></i>
        新建任务
      </button>
    </div>
    <div class="task-filters">
      <div class="task-search">
        <i class="ri-search-line" aria-hidden="true"></i>
        <input v-model="keyword" aria-label="搜索视频任务" placeholder="搜索任务名称或商品信息" />
        <button
          v-if="keyword"
          class="task-icon"
          title="清空搜索"
          aria-label="清空搜索"
          @click="keyword = ''"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <ThemedSelect v-model="status" :options="statusOptions" aria-label="任务状态" />
    </div>
    <div class="task-table">
      <div class="task-columns task-table-head" aria-hidden="true">
        <span>任务</span>
        <span>状态</span>
        <span>分镜 / 视频</span>
        <span>比例</span>
        <span>更新时间</span>
        <span></span>
      </div>
      <div class="task-rows" role="list" aria-label="历史视频任务">
        <div v-for="task in result.items" :key="task.id" role="listitem">
          <button
            class="task-columns task-row"
            :aria-label="`打开任务 ${task.title}`"
            @click="emit('open', task.id)"
          >
            <span class="task-product">
              <span class="task-cover">
                <img v-if="cover(task)" :src="cover(task)" alt="" loading="lazy" />
                <i v-else class="ri-movie-2-line" aria-hidden="true"></i>
              </span>
              <span class="task-description">
                <strong :title="task.title">{{ task.title }}</strong>
                <small :title="task.brief">{{ task.brief || '未填写商品信息' }}</small>
              </span>
            </span>
            <span class="task-status" :class="state(task)">{{ labels[state(task)] }}</span>
            <span class="task-count">{{ task.shots.length }} 分镜 / {{ videos(task) }} 视频</span>
            <span class="task-ratio">{{ task.ratio }}</span>
            <time class="task-date">{{ date(task.updatedAt) }}</time>
            <i class="ri-arrow-right-s-line task-arrow" aria-hidden="true"></i>
          </button>
        </div>
        <div v-if="!result.total" class="task-empty">
          <i :class="tasks.length ? 'ri-search-line' : 'ri-movie-2-line'" aria-hidden="true"></i>
          <strong>{{ tasks.length ? '没有匹配的任务' : '暂无视频任务' }}</strong>
          <button v-if="tasks.length" @click="clearFilters">清除筛选</button>
          <button v-else class="task-create" @click="emit('create')">
            <i class="ri-add-line" aria-hidden="true"></i>
            新建任务
          </button>
        </div>
      </div>
    </div>
    <footer class="task-pagination">
      <span>共 {{ result.total }} 条</span>
      <ThemedSelect v-model="pageSize" :options="sizeOptions" aria-label="每页任务数量" />
      <nav aria-label="任务分页">
        <button
          class="task-icon"
          :disabled="result.page <= 1"
          title="上一页"
          aria-label="上一页任务"
          @click="page = result.page - 1"
        >
          <i class="ri-arrow-left-s-line" aria-hidden="true"></i>
        </button>
        <span class="task-page-number">{{ result.page }} / {{ result.pages }}</span>
        <button
          class="task-icon"
          :disabled="result.page >= result.pages"
          title="下一页"
          aria-label="下一页任务"
          @click="page = result.page + 1"
        >
          <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
        </button>
      </nav>
    </footer>
  </main>
</template>

<style scoped>
.pv-task-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 22px 24px 0;
  color: var(--canvas-text);
  font-size: 12px;
}
.pv-task-list * {
  box-sizing: border-box;
  letter-spacing: 0;
}
.task-list-heading,
.task-filters,
.task-pagination,
.task-pagination nav {
  display: flex;
  align-items: center;
  gap: 12px;
}
.task-list-heading {
  justify-content: space-between;
  margin-bottom: 18px;
}
h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
h3 small {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--canvas-text-muted);
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 6px 12px;
  font: inherit;
  color: var(--canvas-text);
  background: var(--canvas-surface);
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--canvas-surface-hover);
  border-color: var(--canvas-accent-border);
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
button.task-create {
  background: var(--canvas-accent);
  color: var(--canvas-input);
  border-color: var(--canvas-accent);
  font-weight: 600;
}
button.task-create:hover {
  background: var(--canvas-accent);
  filter: brightness(1.08);
}
.task-filters {
  margin-bottom: 18px;
}
.task-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  flex: 1;
  max-width: 440px;
  min-width: 0;
  height: 36px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 6px;
  background: var(--canvas-input);
  color: var(--canvas-text-muted);
}
.task-search:focus-within {
  border-color: var(--canvas-accent);
}
.task-search input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--canvas-text);
  font: inherit;
  outline: none;
}
.task-search input::placeholder {
  color: var(--canvas-text-subtle);
}
.task-search button {
  flex: 0 0 24px;
  min-height: 24px;
  height: 24px;
  width: 24px;
  border: 0;
  background: transparent;
}
.task-filters > :last-child {
  width: 140px;
  flex-shrink: 0;
}
.task-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-top: 1px solid var(--canvas-border);
}
.task-columns {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 96px 110px 64px 145px 20px;
  align-items: center;
  gap: 18px;
}
.task-table-head {
  min-height: 38px;
  padding: 0 14px;
  font-size: 11px;
  color: var(--canvas-text-muted);
  border-bottom: 1px solid var(--canvas-border);
}
.task-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--canvas-border-strong) transparent;
}
button.task-row {
  width: 100%;
  min-height: 88px;
  padding: 14px;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--canvas-border);
  border-radius: 0;
  background: transparent;
}
button.task-row:hover {
  background: var(--canvas-surface-hover);
}
button.task-row:focus-visible {
  outline-offset: -2px;
}
.task-product {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}
.task-cover {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 52px;
  width: 52px;
  height: 52px;
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
  background: var(--canvas-input);
  overflow: hidden;
}
.task-cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.task-cover > i {
  color: var(--canvas-text-subtle);
  font-size: 22px;
}
.task-description {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.task-description strong {
  font-weight: 600;
  font-size: 13px;
}
.task-description strong,
.task-description small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-description small {
  color: var(--canvas-text-muted);
  font-size: 11px;
}
.task-status {
  justify-self: start;
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 18px;
  background: var(--canvas-surface);
  color: var(--canvas-text-muted);
  white-space: nowrap;
}
.task-status.planning,
.task-status.generating {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.task-status.completed {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
}
.task-status.failed,
.task-status.unknown {
  color: var(--color-error);
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
}
.task-date,
.task-count,
.task-ratio,
.task-arrow {
  color: var(--canvas-text-muted);
  font-size: 11px;
}
.task-date {
  white-space: nowrap;
}
.task-arrow {
  font-size: 18px;
}
.task-empty {
  display: flex;
  min-height: 260px;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--canvas-text-muted);
}
.task-empty > i {
  font-size: 32px;
  color: var(--canvas-text-subtle);
}
.task-empty strong {
  font-size: 13px;
  font-weight: 400;
}
.task-pagination {
  min-height: 64px;
  border-top: 1px solid var(--canvas-border);
  color: var(--canvas-text-muted);
}
.task-pagination > :first-child {
  margin-right: auto;
}
.task-pagination > .themed-select {
  width: 114px;
}
.task-pagination :deep(.themed-select-options) {
  top: auto;
  bottom: calc(100% + 6px);
}
.task-page-number {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
button.task-icon {
  width: 32px;
  height: 32px;
  min-height: 32px;
  padding: 0;
}
.task-icon i {
  font-size: 18px;
}
@media (max-width: 1000px) {
  .task-columns {
    grid-template-columns: minmax(180px, 1fr) 84px 100px 130px 16px;
    gap: 12px;
  }
  .task-ratio,
  .task-table-head > :nth-child(4) {
    display: none;
  }
}
@media (max-width: 650px) {
  .pv-task-list {
    padding: 16px 12px 0;
  }
  .task-filters {
    flex-wrap: wrap;
    gap: 8px;
  }
  .task-search {
    flex-basis: 100%;
    max-width: none;
  }
  .task-table-head {
    display: none;
  }
  button.task-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    padding: 12px 4px;
  }
  .task-product {
    grid-column: 1 / -1;
  }
  .task-count {
    grid-column: 2;
    grid-row: 2;
  }
  .task-date {
    grid-column: 1 / -1;
  }
  .task-arrow {
    display: none;
  }
  .task-pagination {
    gap: 6px;
    font-size: 11px;
  }
  .task-pagination nav {
    gap: 4px;
  }
  .task-pagination > .themed-select {
    width: 104px;
  }
}
</style>

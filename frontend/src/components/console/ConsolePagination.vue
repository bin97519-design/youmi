<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentPage: { type: Number, default: 1 },
  pageSize: { type: Number, default: 10 },
  total: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  pageSizes: { type: Array, default: () => [10, 20, 50] },
})

const emit = defineEmits(['change', 'update:pageSize'])

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const pageWindow = computed(() => {
  const span = 2
  let start = Math.max(1, props.currentPage - span)
  let end = Math.min(totalPages.value, props.currentPage + span)
  if (end - start < span * 2) {
    if (start === 1) end = Math.min(totalPages.value, start + span * 2)
    else if (end === totalPages.value) start = Math.max(1, end - span * 2)
  }
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
})

function changePage(page) {
  if (props.loading) return
  emit('change', Math.min(Math.max(1, page), totalPages.value))
}

function changePageSize(event) {
  emit('update:pageSize', Number(event.target.value))
}
</script>

<template>
  <nav v-if="total > 0" class="console-pagination" aria-label="分页导航">
    <select
      class="page-size"
      :value="pageSize"
      :disabled="loading"
      aria-label="每页显示数量"
      @change="changePageSize"
    >
      <option v-for="size in pageSizes" :key="size" :value="size">{{ size }}条/页</option>
    </select>
    <span class="page-total">共 {{ total }} 条</span>
    <div class="page-controls">
      <button
        type="button"
        class="page-btn page-btn-edge"
        :disabled="currentPage <= 1 || loading"
        @click="changePage(1)"
      >
        首页
      </button>
      <button
        type="button"
        class="page-btn"
        :disabled="currentPage <= 1 || loading"
        @click="changePage(currentPage - 1)"
      >
        上一页
      </button>
      <button
        v-for="page in pageWindow"
        :key="page"
        type="button"
        class="page-btn page-btn-number"
        :class="{ active: page === currentPage }"
        :aria-current="page === currentPage ? 'page' : undefined"
        :disabled="loading"
        @click="changePage(page)"
      >
        {{ page }}
      </button>
      <button
        type="button"
        class="page-btn"
        :disabled="currentPage >= totalPages || loading"
        @click="changePage(currentPage + 1)"
      >
        下一页
      </button>
      <button
        type="button"
        class="page-btn page-btn-edge"
        :disabled="currentPage >= totalPages || loading"
        @click="changePage(totalPages)"
      >
        尾页
      </button>
    </div>
    <span v-if="loading" class="page-loading">加载中…</span>
  </nav>
</template>

<style scoped>
.console-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
  color: #94a3b8;
  font-size: 13px;
}

.page-total {
  margin-right: 4px;
  white-space: nowrap;
}

.page-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.page-btn {
  min-width: 34px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.page-btn-number {
  padding: 0 8px;
}

.page-btn:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
}

.page-btn.active {
  border-color: color-mix(in srgb, var(--yq-primary) 65%, transparent);
  background: var(--yq-primary);
  color: #ffffff;
}

.page-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.page-size {
  width: auto;
  height: 30px;
  box-sizing: border-box;
  padding: 0 26px 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  color: #e2e8f0;
  font: inherit;
}

.page-size option {
  background: #1e293b;
  color: #e2e8f0;
}

.page-loading {
  color: #94a3b8;
  white-space: nowrap;
}

:global([data-theme='light']) .console-pagination {
  color: #64748b;
}

:global([data-theme='light']) .page-btn,
:global([data-theme='light']) .page-size {
  border-color: #e2e8f0;
  background: #f8fafc;
  color: #1e293b;
}

:global([data-theme='light']) .page-btn:hover:not(:disabled) {
  background: #f1f5f9;
}

:global([data-theme='light']) .page-btn.active {
  border-color: var(--yq-primary);
  background: var(--yq-primary);
  color: #ffffff;
}

:global([data-theme='light']) .page-size option {
  background: #ffffff;
  color: #1e293b;
}

@media (max-width: 700px) {
  .console-pagination,
  .page-controls {
    gap: 5px;
  }

  .page-btn {
    height: 32px;
    padding: 0 8px;
  }
}
</style>

<script setup>
import { computed, ref } from 'vue'
import ImageViewer from '../ImageViewer.vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const store = useEcommerceSetStore()
const viewerOpen = ref(false)
const viewerIndex = ref(0)
const retryingId = ref(null)
const batchRetrying = ref(false)
const statusFilter = ref('all')
const sortMode = ref('default')
const selectedIds = ref([])

const rawSections = computed(() =>
  [
    { key: 'main', title: '主图', items: store.results.mainImages || [] },
    { key: 'detail', title: '详情页', items: store.results.detailPages || [] },
  ].filter((section) => section.items.length),
)
const allImages = computed(() => rawSections.value.flatMap((section) => section.items))
const failedImages = computed(() => allImages.value.filter(isFailed))
const completedImages = computed(() => allImages.value.filter((img) => !isFailed(img)))
const sections = computed(() =>
  rawSections.value
    .map((section) => {
      let items = section.items.filter((img) => {
        if (statusFilter.value === 'completed') return !isFailed(img)
        if (statusFilter.value === 'failed') return isFailed(img)
        return true
      })
      if (sortMode.value === 'completed-first') {
        items = [...items].sort((a, b) => Number(isFailed(a)) - Number(isFailed(b)))
      } else if (sortMode.value === 'failed-first') {
        items = [...items].sort((a, b) => Number(isFailed(b)) - Number(isFailed(a)))
      }
      return { ...section, items }
    })
    .filter((section) => section.items.length),
)
const successfulImages = computed(() =>
  rawSections.value
    .flatMap((section) => section.items)
    .filter((img) => img.status === 'COMPLETED' && imageUrl(img))
    .map((img) => ({ url: imageUrl(img), name: img.sellingPointTitle || '电商套图' })),
)
const hasAnyResult = computed(() => rawSections.value.length > 0)
const selectedImages = computed(() =>
  completedImages.value.filter((img) => selectedIds.value.includes(imageKey(img))),
)

const ACTIONS = [
  { key: 'preview', label: '查看大图', icon: 'ri-zoom-in-line' },
  { key: 'download', label: '下载', icon: 'ri-download-line' },
]

function imageUrl(img) {
  return img.imageUrl || img.url || ''
}

function isFailed(img) {
  return img.status === 'FAILED' || !imageUrl(img)
}

function imageKey(img) {
  return String(img.id || imageUrl(img))
}

function isSelected(img) {
  return selectedIds.value.includes(imageKey(img))
}

function toggleSelected(img) {
  const key = imageKey(img)
  selectedIds.value = isSelected(img)
    ? selectedIds.value.filter((id) => id !== key)
    : [...selectedIds.value, key]
}

function toggleAllCompleted() {
  selectedIds.value =
    selectedImages.value.length === completedImages.value.length
      ? []
      : completedImages.value.map(imageKey)
}

function openPreview(img) {
  const index = successfulImages.value.findIndex((item) => item.url === imageUrl(img))
  viewerIndex.value = Math.max(0, index)
  viewerOpen.value = true
}

function onAction(key, img) {
  if (key === 'preview') openPreview(img)
  if (key === 'download') store.downloadImage(imageUrl(img))
}

async function retryImage(img) {
  retryingId.value = img.id
  try {
    await store.retryImage(img.id)
  } finally {
    retryingId.value = null
  }
}

async function retryAllFailed() {
  batchRetrying.value = true
  try {
    await store.retryFailedImages(failedImages.value.map((img) => img.id))
  } finally {
    batchRetrying.value = false
  }
}

function downloadSelected() {
  const images = selectedImages.value.length ? selectedImages.value : completedImages.value
  return store.downloadImages(images.map(imageUrl))
}
</script>

<template>
  <div class="es-result-step">
    <div class="es-result-summary">
      <div>
        <strong>套图生成结果</strong>
        <span v-if="store.progress.failed">{{ store.progress.failed }} 张失败，可单独重试</span>
        <span v-else>全部生成完成</span>
      </div>
      <div v-if="store.billing.consumedMi" class="es-billing">
        已消耗 {{ store.billing.consumedMi }} 米值
        <span v-if="store.billing.balance !== null">· 余额 {{ store.billing.balance }}</span>
      </div>
    </div>

    <div v-if="hasAnyResult" class="es-result-toolbar">
      <div class="es-filter-group" aria-label="结果状态筛选">
        <button :class="{ active: statusFilter === 'all' }" @click="statusFilter = 'all'">
          全部 {{ allImages.length }}
        </button>
        <button
          :class="{ active: statusFilter === 'completed' }"
          @click="statusFilter = 'completed'"
        >
          成功 {{ completedImages.length }}
        </button>
        <button
          v-if="failedImages.length"
          :class="{ active: statusFilter === 'failed' }"
          @click="statusFilter = 'failed'"
        >
          失败 {{ failedImages.length }}
        </button>
      </div>
      <div class="es-batch-actions">
        <select v-model="sortMode" title="排序方式" aria-label="排序方式">
          <option value="default">默认排序</option>
          <option value="completed-first">成功优先</option>
          <option value="failed-first">失败优先</option>
        </select>
        <button v-if="completedImages.length" type="button" @click="toggleAllCompleted">
          <i class="ri-checkbox-multiple-line" aria-hidden="true"></i>
          {{ selectedImages.length === completedImages.length ? '取消全选' : '全选成功图' }}
        </button>
        <button v-if="completedImages.length" type="button" @click="downloadSelected">
          <i class="ri-download-2-line" aria-hidden="true"></i>
          {{ selectedImages.length ? `下载已选 ${selectedImages.length} 张` : '下载全部' }}
        </button>
        <button
          v-if="failedImages.length"
          class="danger"
          type="button"
          :disabled="batchRetrying"
          @click="retryAllFailed"
        >
          <i
            :class="batchRetrying ? 'ri-loader-4-line es-spin' : 'ri-refresh-line'"
            aria-hidden="true"
          ></i>
          {{ batchRetrying ? '正在提交...' : '重试全部失败图' }}
        </button>
      </div>
    </div>

    <div v-for="section in sections" :key="section.key" class="es-result-section">
      <div class="es-section-title">{{ section.title }}</div>
      <div class="es-image-grid">
        <div
          v-for="(img, idx) in section.items"
          :key="img.id || `${section.key}-${idx}`"
          :class="['es-image-card', { failed: isFailed(img) }]"
        >
          <div v-if="isFailed(img)" class="es-failed-card">
            <i class="ri-error-warning-line" aria-hidden="true"></i>
            <strong>{{ img.sellingPointTitle || `${section.title} ${idx + 1}` }}</strong>
            <span>{{ img.errorMessage || '生成失败，对应米值已退回' }}</span>
            <button type="button" :disabled="retryingId === img.id" @click="retryImage(img)">
              <i class="ri-refresh-line" aria-hidden="true"></i>
              {{ retryingId === img.id ? '正在重试...' : '单张重试' }}
            </button>
          </div>
          <div v-else class="es-image-wrap" @dblclick="openPreview(img)">
            <img :src="imageUrl(img)" :alt="`${section.title} ${idx + 1}`" class="es-image" />
            <span v-if="img.sellingPointType" class="es-image-tag">{{ img.sellingPointType }}</span>
            <button
              :class="['es-select-image', { active: isSelected(img) }]"
              type="button"
              :title="isSelected(img) ? '取消选择' : '选择图片'"
              @click.stop="toggleSelected(img)"
            >
              <i
                :class="
                  isSelected(img) ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'
                "
                aria-hidden="true"
              ></i>
            </button>
            <div class="es-image-overlay">
              <button
                v-for="action in ACTIONS"
                :key="action.key"
                class="es-overlay-btn"
                :title="action.label"
                @click.stop="onAction(action.key, img)"
              >
                <i :class="action.icon" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!hasAnyResult" class="es-empty-tip">暂无生成结果</div>
    <div v-else-if="!sections.length" class="es-empty-tip">当前筛选下没有图片</div>
    <button v-if="hasAnyResult" class="es-replan-btn" @click="store.reset()">
      <i class="ri-refresh-line" aria-hidden="true"></i>
      <span>创建新套图</span>
    </button>

    <ImageViewer
      :open="viewerOpen"
      :images="successfulImages"
      :start-index="viewerIndex"
      @close="viewerOpen = false"
      @download="store.downloadImage($event.url)"
    />
  </div>
</template>

<style scoped>
.es-result-step {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-height: 100%;
}
.es-result-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.es-result-summary > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.es-result-summary strong {
  font-size: 18px;
  color: #0f172a;
}
.es-result-summary span,
.es-billing {
  font-size: 12px;
  color: #64748b;
}

.es-result-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.es-result-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: -12px;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}
.es-filter-group,
.es-batch-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.es-filter-group {
  padding: 3px;
  border-radius: 7px;
  background: #f1f5f9;
}
.es-filter-group button,
.es-batch-actions button,
.es-batch-actions select {
  min-height: 32px;
  border: 1px solid #dbe2ea;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  font-size: 12px;
}
.es-filter-group button,
.es-batch-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  cursor: pointer;
}
.es-filter-group button {
  border-color: transparent;
  background: transparent;
}
.es-filter-group button.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.es-batch-actions select {
  padding: 5px 28px 5px 9px;
}
.es-batch-actions button:hover {
  border-color: #94a3b8;
  color: #0f172a;
}
.es-batch-actions button.danger {
  border-color: #fecaca;
  color: #b91c1c;
}
.es-batch-actions button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.es-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* Image grid */
.es-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.es-image-card {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}
.es-image-card.failed {
  border-color: #fecaca;
}
.es-failed-card {
  min-height: 240px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  background: #fff7f7;
  color: #991b1b;
}
.es-failed-card > i {
  font-size: 28px;
}
.es-failed-card strong {
  font-size: 13px;
  color: #7f1d1d;
}
.es-failed-card span {
  max-width: 260px;
  font-size: 12px;
  color: #b91c1c;
  line-height: 1.5;
}
.es-failed-card button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  border: 1px solid #fca5a5;
  border-radius: 6px;
  background: #fff;
  color: #991b1b;
  cursor: pointer;
}
.es-failed-card button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.es-image-card:hover {
  border-color: rgba(15, 23, 42, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}
.es-image-wrap {
  position: relative;
}
.es-image {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
  background: #f1f5f9;
}
.es-image-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  backdrop-filter: blur(4px);
}
.es-select-image {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  color: #64748b;
  cursor: pointer;
  font-size: 18px;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.18);
}
.es-select-image.active {
  color: #0f766e;
}

/* Hover 操作浮层 */
.es-image-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.55);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.es-image-card:hover .es-image-overlay {
  opacity: 1;
}
.es-overlay-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  border: none;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  transition:
    background 0.15s,
    transform 0.15s;
}
.es-overlay-btn:hover {
  background: #1e293b;
  color: #fff;
  transform: scale(1.05);
}

/* Empty */
.es-empty-tip {
  font-size: 13px;
  color: #94a3b8;
  text-align: center;
  padding: 40px 0;
}

/* Replan button */
.es-replan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: center;
  padding: 9px 22px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.es-replan-btn:hover {
  border-color: rgba(15, 23, 42, 0.3);
  color: #1e293b;
  background: rgba(0, 0, 0, 0.03);
}

/* Toast */
.es-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  background: rgba(15, 23, 42, 0.92);
  color: #fff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}
.es-toast-enter-active,
.es-toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.es-toast-enter-from,
.es-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
.es-spin {
  animation: es-spin 0.8s linear infinite;
}
@keyframes es-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .es-result-step {
    padding: 16px;
    gap: 20px;
  }
  .es-result-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .es-result-toolbar,
  .es-batch-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .es-result-toolbar > *,
  .es-batch-actions > * {
    width: 100%;
  }
  .es-filter-group button {
    flex: 1;
  }
  .es-image-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .es-image-overlay {
    align-items: flex-end;
    justify-content: flex-end;
    background: transparent;
    opacity: 1;
  }
}
</style>

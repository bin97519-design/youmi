<script setup>
import { computed } from 'vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const store = useEcommerceSetStore()

const progressPercent = computed(() => {
  if (store.progress.total === 0) return 0
  return Math.round((store.progress.completed / store.progress.total) * 100)
})

const isFailed = computed(() => store.progress.status === 'FAILED')

// 加载卡片数量：优先用后端返回的总数，否则按配置估算
const cardCount = computed(() => {
  if (store.progress.total > 0) return store.progress.total
  const estimate = (store.config.mainImage?.count || 0) + (store.config.detailPage?.count || 0)
  return estimate > 0 ? estimate : 6
})

const loadingTexts = [
  '正在校准粒子精度与材质细节…',
  '正在生成主图构图与光影…',
  '正在渲染场景与卖点表达…',
  '正在优化画面文字排布…',
  '正在合成品牌视觉调性…',
  '正在打磨细节与边缘质感…',
]

function cardText(idx) {
  return loadingTexts[idx % loadingTexts.length]
}

// 单卡进度（基于总进度 + 轻微错位，纯展示用）
function cardPercent(idx) {
  const base = progressPercent.value
  const offset = ((idx * 7) % 18) - 9
  return Math.max(0, Math.min(99, base + offset))
}

function retryGeneration() {
  store.reset()
}
</script>

<template>
  <div class="es-generating-step">
    <!-- 总进度 -->
    <div class="es-progress-section">
      <div class="es-progress-header">
        <span class="es-progress-title">{{ isFailed ? '生成失败' : '生成中…' }}</span>
        <span class="es-progress-count">
          {{ store.progress.completed }} / {{ store.progress.total || cardCount }}
        </span>
      </div>
      <div class="es-progress-bar">
        <div class="es-progress-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <div class="es-progress-percent">{{ progressPercent }}%</div>
    </div>

    <!-- 加载卡片网格 -->
    <div v-if="!isFailed" class="es-loading-grid">
      <div v-for="idx in cardCount" :key="idx" class="es-loading-card">
        <div class="es-loading-logo">
          <svg class="es-breath-logo" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle cx="24" cy="24" r="9" fill="currentColor" opacity="0.9" />
            <path
              d="M24 4l2.6 6.4L33 13l-6.4 2.6L24 22l-2.6-6.4L15 13l6.4-2.6L24 4Z"
              fill="currentColor"
              opacity="0.55"
            />
            <path
              d="M40 30l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6L40 30Z"
              fill="currentColor"
              opacity="0.4"
            />
          </svg>
        </div>
        <div class="es-loading-bar">
          <div class="es-loading-fill" :style="{ width: cardPercent(idx - 1) + '%' }"></div>
        </div>
        <div class="es-loading-text">{{ cardText(idx - 1) }}</div>
      </div>
    </div>

    <!-- 失败提示 -->
    <div v-else class="es-failed-tip">
      <i class="ri-error-warning-line" aria-hidden="true"></i>
      <span>生成失败，请重试</span>
      <button class="es-retry-btn" type="button" @click="retryGeneration">重新生成</button>
    </div>
  </div>
</template>

<style scoped>
.es-generating-step {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 100%;
}

/* 总进度 */
.es-progress-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.es-progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.es-progress-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.es-progress-count {
  font-size: 12px;
  color: #64748b;
}
.es-progress-bar {
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}
.es-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #1e293b, #475569);
  border-radius: 4px;
  transition: width 0.5s ease;
}
.es-progress-percent {
  font-size: 12px;
  color: #94a3b8;
  text-align: right;
}

/* 加载卡片网格 */
.es-loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.es-loading-card {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.es-loading-logo {
  color: #1e293b;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84px;
}
.es-breath-logo {
  width: 48px;
  height: 48px;
  animation: es-breath 1.8s ease-in-out infinite;
  transform-origin: center;
}
@keyframes es-breath {
  0%,
  100% {
    transform: scale(0.82);
    opacity: 0.55;
  }
  50% {
    transform: scale(1.08);
    opacity: 1;
  }
}
.es-loading-bar {
  width: 100%;
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
}
.es-loading-fill {
  height: 100%;
  background: linear-gradient(90deg, #1e293b, #64748b);
  border-radius: 2px;
  transition: width 0.5s ease;
}
.es-loading-text {
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  line-height: 1.4;
}

/* 失败 */
.es-failed-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
  color: #dc2626;
  font-size: 14px;
  padding: 40px 0;
}
.es-retry-btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.3);
  background: #fff;
  color: #dc2626;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.es-retry-btn:hover {
  background: rgba(220, 38, 38, 0.06);
}
</style>

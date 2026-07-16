<script setup>
import { computed, ref, watch } from 'vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const store = useEcommerceSetStore()
const activeView = ref('main')
const saving = ref(false)
const saved = ref(false)

const planning = computed(() => store.planningData || {})
const sellingPoints = computed(() => planning.value.sellingPoints || [])
const mainPlans = computed(() =>
  sellingPoints.value.slice(0, Math.max(1, store.config.mainImage.count || 1)),
)
const detailStructure = computed(() =>
  sellingPoints.value.map((point, index) => ({
    index: index + 1,
    title: point.title || point.type || `卖点 ${index + 1}`,
    description: point.description || '',
  })),
)

watch(
  [() => store.planningData, () => store.config.mainImage.count],
  ([data, count]) => {
    const points = data?.sellingPoints
    if (!Array.isArray(points)) return
    while (points.length < count) {
      const index = points.length + 1
      points.push({
        type: '核心卖点',
        title: `主图方案 ${index}`,
        description: '突出产品主体与核心购买理由',
        visualDirection: '主体清晰，信息层级简洁，保持商业质感',
      })
    }
  },
  { immediate: true },
)

function pointType(point, index) {
  return point.type || `方案 ${index + 1}`
}

function copyDirection(point) {
  const title = point.title?.trim()
  const description = point.description?.trim()
  return [title, description].filter(Boolean).join('：') || '突出产品核心价值'
}

async function savePlanning() {
  saving.value = true
  saved.value = false
  try {
    await store.updatePlanning(store.planningData)
    store.persistDraft()
    saved.value = true
    window.setTimeout(() => {
      saved.value = false
    }, 1800)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="es-planning-workspace">
    <header class="es-workspace-header">
      <div>
        <span class="es-workspace-eyebrow">套图策划</span>
        <h1>{{ planning.productName || '电商商品套图' }}</h1>
        <p>
          {{ planning.category || '电商商品' }}
          <span v-if="planning.audienceProfile">· {{ planning.audienceProfile }}</span>
        </p>
      </div>
      <div class="es-workspace-actions">
        <span v-if="saved" class="es-saved-state">
          <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
          已保存
        </span>
        <button type="button" :disabled="saving" @click="savePlanning">
          <i :class="saving ? 'ri-loader-4-line es-spin' : 'ri-save-3-line'" aria-hidden="true"></i>
          {{ saving ? '保存中...' : '保存策划' }}
        </button>
      </div>
    </header>

    <div class="es-workspace-switch" aria-label="策划类型">
      <button :class="{ active: activeView === 'main' }" type="button" @click="activeView = 'main'">
        <i class="ri-layout-grid-line" aria-hidden="true"></i>
        主图设计
        <span>{{ mainPlans.length }} 张</span>
      </button>
      <button
        :class="{ active: activeView === 'detail' }"
        type="button"
        @click="activeView = 'detail'"
      >
        <i class="ri-pages-line" aria-hidden="true"></i>
        详情页设计
        <span>{{ store.config.detailPage.count }} 张</span>
      </button>
    </div>

    <div v-if="activeView === 'main'" class="es-plan-content">
      <div class="es-plan-heading">
        <div>
          <strong>主图创意</strong>
          <span>{{ store.config.mainImage.ratio }} · {{ store.config.platform }}</span>
        </div>
        <span>共 {{ mainPlans.length }} 张</span>
      </div>

      <div class="es-plan-list">
        <article
          v-for="(point, index) in mainPlans"
          :key="`${point.type}-${index}`"
          class="es-plan-card"
        >
          <header>
            <span class="es-plan-index">{{ index + 1 }}</span>
            <strong>{{ point.title || `主图方案 ${index + 1}` }}</strong>
            <span class="es-plan-type">{{ pointType(point, index) }}</span>
          </header>

          <div class="es-plan-fields">
            <label>
              <span>主题</span>
              <input v-model="point.title" type="text" />
            </label>
            <label class="wide">
              <span>设计思路</span>
              <textarea v-model="point.description" rows="2"></textarea>
            </label>
            <label class="wide">
              <span>视觉画面</span>
              <textarea v-model="point.visualDirection" rows="2"></textarea>
            </label>
            <div class="es-plan-readonly">
              <span>文案内容</span>
              <p>{{ copyDirection(point) }}</p>
            </div>
            <div class="es-plan-readonly">
              <span>排版设计</span>
              <p>主体优先，卖点分层，适配 {{ store.config.mainImage.ratio }} 画布</p>
            </div>
          </div>
        </article>
      </div>
    </div>

    <div v-else class="es-plan-content">
      <div class="es-plan-heading">
        <div>
          <strong>详情页策划</strong>
          <span>{{ store.config.detailPage.ratio }} · {{ store.config.detailPage.style }}</span>
        </div>
        <span>共 {{ store.config.detailPage.count }} 张</span>
      </div>

      <article class="es-plan-card es-detail-plan">
        <header>
          <span class="es-plan-index"><i class="ri-pages-line" aria-hidden="true"></i></span>
          <strong>
            {{ store.config.detailPage.mode === 'split' ? '分屏详情页' : '整版详情页' }}
          </strong>
          <span class="es-plan-type">{{ store.config.detailPage.style }}</span>
        </header>
        <div class="es-detail-layout">
          <div class="es-detail-sections">
            <div v-for="section in detailStructure" :key="section.index">
              <span>{{ String(section.index).padStart(2, '0') }}</span>
              <div>
                <strong>{{ section.title }}</strong>
                <p>{{ section.description }}</p>
              </div>
            </div>
          </div>
          <label class="es-detail-notes">
            <span>分屏构思</span>
            <textarea
              v-model="store.config.detailPage.notes"
              rows="7"
              placeholder="首屏主题、场景展示、材质特写、规格信息…"
            ></textarea>
          </label>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.es-planning-workspace {
  width: min(1080px, 100%);
  margin: 0 auto;
  padding: 28px clamp(18px, 3vw, 40px) 48px;
  color: #1e293b;
}
.es-workspace-header,
.es-plan-heading,
.es-plan-card > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.es-workspace-header {
  padding-bottom: 20px;
  border-bottom: 1px solid #e2e8f0;
}
.es-workspace-eyebrow {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}
.es-workspace-header h1 {
  margin: 5px 0 3px;
  color: #0f172a;
  font-size: 22px;
  letter-spacing: 0;
}
.es-workspace-header p {
  max-width: 720px;
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.es-workspace-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.es-workspace-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 7px 12px;
  border: 0;
  border-radius: 7px;
  background: #1e293b;
  color: #fff;
  cursor: pointer;
}
.es-workspace-actions button:disabled {
  cursor: wait;
  opacity: 0.65;
}
.es-saved-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #047857;
  font-size: 12px;
}
.es-workspace-switch {
  display: inline-flex;
  gap: 4px;
  margin: 20px 0;
  padding: 4px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f1f5f9;
}
.es-workspace-switch button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
}
.es-workspace-switch button.active {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
}
.es-workspace-switch button span {
  color: #94a3b8;
  font-size: 11px;
}
.es-plan-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.es-plan-heading > div {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.es-plan-heading strong {
  font-size: 16px;
}
.es-plan-heading span {
  color: #94a3b8;
  font-size: 12px;
}
.es-plan-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.es-plan-card {
  overflow: hidden;
  border: 1px solid #dbe2ea;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 7px rgba(15, 23, 42, 0.04);
}
.es-plan-card > header {
  justify-content: flex-start;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
.es-plan-card > header > strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.es-plan-index {
  width: 27px;
  height: 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 6px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
  font-weight: 700;
}
.es-plan-type {
  margin-left: auto;
  padding: 3px 7px;
  border: 1px solid #bae6fd;
  border-radius: 5px;
  background: #f0f9ff;
  color: #0369a1;
  font-size: 10px;
  white-space: nowrap;
}
.es-plan-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}
.es-plan-fields label,
.es-detail-notes {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.es-plan-fields label.wide {
  grid-column: 1 / -1;
}
.es-plan-fields label > span,
.es-plan-readonly > span,
.es-detail-notes > span {
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}
.es-plan-fields input,
.es-plan-fields textarea,
.es-detail-notes textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dbe2ea;
  border-radius: 6px;
  outline: none;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
}
.es-plan-fields input {
  min-height: 34px;
  padding: 7px 9px;
}
.es-plan-fields textarea,
.es-detail-notes textarea {
  padding: 8px 9px;
  resize: vertical;
}
.es-plan-fields input:focus,
.es-plan-fields textarea:focus,
.es-detail-notes textarea:focus {
  border-color: #64748b;
  box-shadow: 0 0 0 3px rgba(100, 116, 139, 0.1);
}
.es-plan-readonly {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 6px;
  background: #f8fafc;
}
.es-plan-readonly p {
  margin: 4px 0 0;
  color: #475569;
  font-size: 11px;
  line-height: 1.5;
}
.es-detail-plan {
  width: 100%;
}
.es-detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
  gap: 18px;
  padding: 18px;
}
.es-detail-sections {
  display: flex;
  flex-direction: column;
}
.es-detail-sections > div {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid #e2e8f0;
}
.es-detail-sections > div:first-child {
  padding-top: 0;
}
.es-detail-sections > div > span {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
}
.es-detail-sections strong {
  font-size: 12px;
}
.es-detail-sections p {
  margin: 3px 0 0;
  color: #64748b;
  font-size: 11px;
  line-height: 1.5;
}
.es-spin {
  animation: es-spin 0.8s linear infinite;
}
@keyframes es-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 900px) {
  .es-plan-list,
  .es-detail-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 620px) {
  .es-planning-workspace {
    padding: 18px 14px 32px;
  }
  .es-workspace-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .es-workspace-actions,
  .es-workspace-actions button,
  .es-workspace-switch {
    width: 100%;
  }
  .es-workspace-actions button,
  .es-workspace-switch button {
    justify-content: center;
    flex: 1;
  }
  .es-plan-fields {
    grid-template-columns: 1fr;
  }
  .es-plan-fields label.wide {
    grid-column: auto;
  }
}
</style>

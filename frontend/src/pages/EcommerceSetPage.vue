<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import EcommerceSetPanel from '../components/ecommerce/EcommerceSetPanel.vue'
import GeneratingStep from '../components/ecommerce/GeneratingStep.vue'
import PlanningWorkspace from '../components/ecommerce/PlanningWorkspace.vue'
import ResultStep from '../components/ecommerce/ResultStep.vue'
import { useEcommerceSetStore } from '../stores/ecommerceSet'

const router = useRouter()
const store = useEcommerceSetStore()

const hasResults = computed(
  () => (store.results.mainImages?.length || 0) + (store.results.detailPages?.length || 0) > 0,
)
const isGenerating = computed(() => store.currentStep === 'generating')
let unsubscribe = null

function goBack() {
  router.push('/')
}

onMounted(async () => {
  await store.resumeDraft()
  unsubscribe = store.$subscribe(() => store.persistDraft(), { detached: true })
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

// 页面离开时清理轮询
watch(
  () => router.currentRoute.value.path,
  (path) => {
    if (path !== '/ecommerce-set') {
      store.stopPolling()
    }
  },
)
</script>

<template>
  <div class="ecommerce-set-page">
    <!-- 左侧配置面板（单页配置抽屉） -->
    <aside class="workbench-config">
      <header class="config-header">
        <button class="es-back-btn" type="button" title="返回首页" @click="goBack">
          <i class="ri-arrow-left-line" aria-hidden="true"></i>
          <span>返回首页</span>
        </button>
      </header>

      <main class="config-main">
        <EcommerceSetPanel />
      </main>

      <footer v-if="store.currentStep === 'result'" class="config-footer">
        <button class="es-footer-btn" type="button" @click="store.reset()">
          <i class="ri-refresh-line" aria-hidden="true"></i>
          <span>重新策划</span>
        </button>
      </footer>
    </aside>

    <!-- 右侧结果区 -->
    <main class="workbench-main">
      <!-- 生成中 -->
      <GeneratingStep v-if="isGenerating" />

      <!-- 生成结果 -->
      <ResultStep v-else-if="hasResults" />

      <!-- 套图策划 -->
      <PlanningWorkspace v-else-if="store.planningData" />

      <!-- 空状态 -->
      <div v-else class="canvas-empty">
        <div class="empty-icon">
          <i class="ri-image-line" aria-hidden="true"></i>
        </div>
        <h3>电商套图工作台</h3>
        <p>在左侧上传产品图片并填写描述，AI 将为你策划并生成完整的电商套图</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.ecommerce-set-page {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f1f5f9;
  color: #1e293b;
}

/* ── 左侧配置面板 ── */
.workbench-config {
  width: 360px;
  min-width: 360px;
  max-width: 360px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.config-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  background: #ffffff;
}

.es-back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  padding: 5px 12px;
  transition: all 0.2s;
}

.es-back-btn:hover {
  color: #1e293b;
  border-color: rgba(0, 0, 0, 0.22);
  background: rgba(0, 0, 0, 0.04);
}

.es-back-btn i {
  font-size: 15px;
}

.config-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.config-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  background: #ffffff;
}

.es-footer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.es-footer-btn:hover {
  border-color: rgba(0, 0, 0, 0.22);
  color: #1e293b;
  background: rgba(0, 0, 0, 0.04);
}

/* ── 右侧结果区 ── */
.workbench-main {
  flex: 1;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: #fafafa;
}

.workbench-main::-webkit-scrollbar {
  width: 8px;
}
.workbench-main::-webkit-scrollbar-track {
  background: transparent;
}
.workbench-main::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.14);
  border-radius: 4px;
}

/* 空状态 */
.canvas-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
}

.empty-icon i {
  font-size: 36px;
  color: #cbd5e1;
}

.canvas-empty h3 {
  font-size: 18px;
  font-weight: 600;
  color: #475569;
  margin: 0;
}

.canvas-empty p {
  font-size: 14px;
  color: #94a3b8;
  max-width: 360px;
  text-align: center;
  line-height: 1.6;
  margin: 0;
}

@media (max-width: 900px) {
  .ecommerce-set-page {
    flex-direction: column;
  }

  .workbench-config {
    width: 100%;
    min-width: 0;
    max-width: none;
    height: 52vh;
    min-height: 360px;
    border-right: 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  .workbench-main {
    min-height: 0;
    height: auto;
  }
}

@media (max-width: 560px) {
  .workbench-config {
    height: 58vh;
    min-height: 340px;
  }

  .config-header {
    padding: 8px 12px;
  }

  .canvas-empty {
    padding: 28px 20px;
  }
}
</style>

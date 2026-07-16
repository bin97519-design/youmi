<script setup>
import { ref } from 'vue'
import PlanningStep from './PlanningStep.vue'
import ConfigStep from './ConfigStep.vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const showHelp = ref(false)
const store = useEcommerceSetStore()
</script>

<template>
  <div class="ecommerce-set-panel">
    <!-- 头部 -->
    <header class="es-panel-header">
      <div class="es-panel-title">
        <i class="ri-store-2-line" aria-hidden="true"></i>
        <span>电商套图</span>
        <span class="es-new-badge">NEW</span>
      </div>
      <button class="es-help-btn" title="使用帮助" @click="showHelp = !showHelp">
        <i class="ri-question-line" aria-hidden="true"></i>
      </button>
    </header>

    <div v-if="store.errorMessage" class="es-error-banner" role="alert">
      <i class="ri-error-warning-line" aria-hidden="true"></i>
      <span>{{ store.errorMessage }}</span>
      <button type="button" title="关闭" @click="store.errorMessage = ''">
        <i class="ri-close-line" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="showHelp" class="es-help-panel">
      <strong>生成流程</strong>
      <span>上传产品图并填写描述，确认 AI 卖点后配置主图和详情页。</span>
      <span>“张数”是最终生成总数；失败图片会自动退回对应米值，并可单张重试。</span>
    </div>

    <div v-if="store.currentStep === 'config'" class="es-step-content">
      <PlanningStep />
      <ConfigStep />
    </div>

    <div v-else class="es-task-summary">
      <div class="es-task-preview">
        <img v-if="store.productImageUrl" :src="store.productImageUrl" alt="产品图" />
        <i v-else class="ri-image-line" aria-hidden="true"></i>
      </div>
      <div class="es-task-state">
        <i
          :class="
            store.currentStep === 'generating'
              ? 'ri-loader-4-line es-spin'
              : 'ri-checkbox-circle-line'
          "
          aria-hidden="true"
        ></i>
        <div>
          <strong>
            {{ store.currentStep === 'generating' ? '正在生成套图' : '套图生成完成' }}
          </strong>
          <span>任务进行期间已锁定配置，避免重复提交</span>
        </div>
      </div>
      <dl class="es-task-config">
        <div>
          <dt>平台</dt>
          <dd>{{ store.config.platform }}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{{ store.config.model }}</dd>
        </div>
        <div>
          <dt>主图</dt>
          <dd>{{ store.config.mainImage.count }} 张 · {{ store.config.mainImage.ratio }}</dd>
        </div>
        <div>
          <dt>详情页</dt>
          <dd>{{ store.config.detailPage.count }} 张 · {{ store.config.detailPage.ratio }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.ecommerce-set-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  color: #1e293b;
  overflow: hidden;
}

.es-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  background: #ffffff;
}

.es-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}

.es-panel-title i {
  font-size: 18px;
  color: #475569;
}

.es-new-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: #ecfdf5;
  color: #059669;
  letter-spacing: 0.5px;
  border: 1px solid rgba(5, 150, 105, 0.2);
}

.es-help-btn {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  border-radius: 6px;
  transition:
    color 0.2s,
    background 0.2s;
}

.es-help-btn:hover {
  color: #475569;
  background: rgba(0, 0, 0, 0.05);
}
.es-error-banner,
.es-help-panel {
  margin: 10px 12px 0;
  padding: 9px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.es-error-banner {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.es-error-banner span {
  flex: 1;
}
.es-error-banner button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
.es-help-panel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: #475569;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

/* 内容区域 */
.es-step-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.es-step-content::-webkit-scrollbar {
  width: 6px;
}

.es-step-content::-webkit-scrollbar-track {
  background: transparent;
}

.es-step-content::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

.es-step-content::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.es-task-summary {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.es-task-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #94a3b8;
}

.es-task-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.es-task-preview i {
  font-size: 32px;
}

.es-task-state {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  color: #1d4ed8;
}

.es-task-state > i {
  margin-top: 1px;
  font-size: 18px;
}

.es-task-state > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.es-task-state strong {
  color: #1e293b;
  font-size: 13px;
}

.es-task-state span {
  color: #64748b;
  font-size: 11px;
  line-height: 1.5;
}

.es-task-config {
  margin: 0;
  display: grid;
  gap: 1px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #e2e8f0;
}

.es-task-config > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  background: #fff;
}

.es-task-config dt,
.es-task-config dd {
  margin: 0;
  font-size: 12px;
}

.es-task-config dt {
  color: #94a3b8;
}

.es-task-config dd {
  max-width: 210px;
  overflow: hidden;
  color: #334155;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.es-spin {
  animation: es-spin 0.8s linear infinite;
}

@keyframes es-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<script setup>
import { ref } from 'vue'
import PlanningStep from './PlanningStep.vue'
import ConfigStep from './ConfigStep.vue'

const showHelp = ref(false)
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

    <!-- 单页合并配置表单（上传策划 + 参数配置） -->
    <div class="es-step-content">
      <PlanningStep />
      <ConfigStep />
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
</style>

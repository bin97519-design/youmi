<script setup>
import { computed, reactive, useId, watch } from 'vue'
import {
  DIRECTOR_IMAGE_COUNTS,
  DIRECTOR_IMAGE_RATIOS,
  DIRECTOR_IMAGE_RESOLUTIONS,
  validateDirectorImageExecution,
} from '../config/directorImageExecution.js'
import { imageMiCost } from '../../../utils/imageMiPricing.js'

const props = defineProps({
  models: { type: Array, default: () => [] },
  configuration: { type: Object, default: () => ({}) },
  nodeId: { type: String, default: '' },
  phase: { type: String, default: '' },
  error: { type: String, default: '' },
  modelError: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  output: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['confirm', 'locate', 'refresh-models'])
const formId = useId()
const settings = reactive({ model: '', ratio: '16:9', resolution: '2K', count: 1 })
watch(
  () => props.configuration,
  (configuration, previous) => {
    // Parent task polling may project a fresh run object. Do not erase the user's
    // unconfirmed selection when the authoritative configuration did not change.
    if (
      previous &&
      ['model', 'ratio', 'resolution', 'count'].every((key) => configuration[key] === previous[key])
    )
      return
    settings.model = typeof configuration.model === 'string' ? configuration.model : ''
    settings.ratio = configuration.ratio ?? '16:9'
    settings.resolution = configuration.resolution ?? '2K'
    settings.count = configuration.count ?? 1
  },
  { immediate: true, deep: true },
)
const availableModels = computed(() => [
  ...new Map(
    props.models
      .filter((model) => typeof model?.value === 'string' && model.value)
      .map((model) => [model.value, model]),
  ).values(),
])
const complete = computed(() => props.phase === 'succeeded')
const inProgress = computed(() =>
  ['preparing', 'submitting', 'submitted', 'queued', 'running', 'paused', 'uncertain'].includes(
    props.phase,
  ),
)
const locked = computed(() => props.disabled || inProgress.value || complete.value)
const validationError = computed(() =>
  validateDirectorImageExecution(settings, availableModels.value),
)
const estimatedCost = computed(() =>
  validationError.value ? 0 : imageMiCost(settings.model, settings.resolution, settings.count),
)
const canConfirm = computed(
  () => !locked.value && Boolean(props.nodeId) && !props.modelError && !validationError.value,
)
const status = computed(() => {
  if (complete.value) return '图片已生成'
  if (props.phase === 'failed') return '图片生成失败，请查看原任务错误'
  if (props.phase === 'uncertain') return '提交结果待确认，请继续查询原任务'
  if (props.phase === 'submitting' || props.phase === 'preparing') return '正在提交图片生成任务…'
  if (inProgress.value) return '图片生成任务已提交'
  return props.nodeId ? '图片节点已创建，确认后开始生成' : '准备图片节点…'
})

function updateSetting(field, event) {
  if (locked.value) return
  settings[field] = field === 'count' ? Number(event.target.value) : event.target.value
}
function confirm() {
  if (!canConfirm.value) return
  emit('confirm', { ...settings })
}
function locate() {
  if (props.nodeId) emit('locate')
}
function refreshModels() {
  if (!locked.value) emit('refresh-models')
}
</script>

<template>
  <section class="cv3-director-image-execution" aria-label="图片生成确认">
    <header>
      <strong role="status" aria-live="polite">{{ status }}</strong>
      <button v-if="nodeId" type="button" class="is-link" @click="locate">定位节点</button>
    </header>
    <form @submit.prevent="confirm">
      <div class="cv3-director-execution-fields">
        <label class="cv3-director-execution-model" :for="`${formId}-model`">
          <span>生图模型</span>
          <select
            :id="`${formId}-model`"
            :value="settings.model"
            :disabled="locked || !availableModels.length"
            @change="updateSetting('model', $event)"
          >
            <option value="" disabled>请选择生图模型</option>
            <option v-for="model in availableModels" :key="model.value" :value="model.value">
              {{ model.label || model.value }}
            </option>
          </select>
        </label>
        <label :for="`${formId}-ratio`">
          <span>画面比例</span>
          <select
            :id="`${formId}-ratio`"
            :value="settings.ratio"
            :disabled="locked"
            @change="updateSetting('ratio', $event)"
          >
            <option v-for="ratio in DIRECTOR_IMAGE_RATIOS" :key="ratio" :value="ratio">
              {{ ratio }}
            </option>
          </select>
        </label>
        <label :for="`${formId}-resolution`">
          <span>分辨率</span>
          <select
            :id="`${formId}-resolution`"
            :value="settings.resolution"
            :disabled="locked"
            @change="updateSetting('resolution', $event)"
          >
            <option
              v-for="resolution in DIRECTOR_IMAGE_RESOLUTIONS"
              :key="resolution"
              :value="resolution"
            >
              {{ resolution }}
            </option>
          </select>
        </label>
        <label :for="`${formId}-count`">
          <span>生成数量</span>
          <select
            :id="`${formId}-count`"
            :value="settings.count"
            :disabled="locked"
            @change="updateSetting('count', $event)"
          >
            <option v-for="count in DIRECTOR_IMAGE_COUNTS" :key="count" :value="count">
              {{ count }} 张
            </option>
          </select>
        </label>
      </div>
      <div v-if="modelError || !availableModels.length" class="cv3-director-execution-warning">
        <span role="alert">{{ modelError || '当前项目尚未配置可用的生图模型' }}</span>
        <button type="button" class="is-link" :disabled="locked" @click="refreshModels">
          重新加载模型
        </button>
      </div>
      <p v-if="error" class="cv3-director-execution-warning" role="alert">{{ error }}</p>
      <p
        v-if="validationError && availableModels.length && !locked"
        class="cv3-director-execution-hint"
        role="status"
      >
        {{ validationError }}
      </p>
      <footer>
        <div>
          <span class="cv3-director-execution-cost" aria-label="预计生成费用">
            {{ estimatedCost > 0 ? `预计 ${estimatedCost} 米` : '费用以实际任务结算为准' }}
          </span>
          <small v-if="!complete && !inProgress">确认将以以上参数执行生成</small>
        </div>
        <button
          v-if="!complete && !inProgress"
          class="cv3-director-execution-confirm"
          type="submit"
          :disabled="!canConfirm"
        >
          {{ phase === 'failed' ? '重试生图' : '确认生图' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.cv3-director-image-execution {
  padding: 12px;
  border: 1px solid #444;
  border-radius: 14px;
  background: #252525;
  color: #ededed;
  font-size: 12px;
  line-height: 1.5;
}
.cv3-director-image-execution header,
.cv3-director-image-execution footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.cv3-director-image-execution header {
  margin-bottom: 12px;
}
.cv3-director-image-execution header strong {
  font-weight: 500;
}
.cv3-director-execution-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.cv3-director-execution-fields label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  color: #aaa;
}
.cv3-director-execution-fields .cv3-director-execution-model {
  grid-column: 1 / -1;
}
.cv3-director-image-execution select {
  width: 100%;
  min-width: 0;
  min-height: 32px;
  padding: 5px 6px;
  border: 1px solid #505050;
  border-radius: 7px;
  background: #303030;
  color: #ededed;
  font: inherit;
}
.cv3-director-image-execution button {
  cursor: pointer;
  font: inherit;
}
.cv3-director-image-execution .is-link {
  flex-shrink: 0;
  padding: 2px;
  border: 0;
  background: transparent;
  color: #b4d9ef;
}
.cv3-director-execution-warning,
.cv3-director-execution-hint {
  margin: 10px 0 0;
  overflow-wrap: anywhere;
  color: #aaa;
}
.cv3-director-execution-warning {
  color: #e9b56c;
}
.cv3-director-execution-warning .is-link {
  margin-left: 6px;
}
.cv3-director-image-execution footer {
  margin-top: 13px;
  align-items: flex-end;
}
.cv3-director-image-execution footer > div {
  display: grid;
  gap: 3px;
}
.cv3-director-image-execution footer small {
  color: #aaa;
  font-size: 10px;
}
.cv3-director-execution-confirm {
  flex-shrink: 0;
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid #ededed;
  border-radius: 8px;
  background: #ededed;
  color: #222;
}
.cv3-director-image-execution button:not(:disabled):active {
  filter: brightness(0.8);
}
.cv3-director-image-execution button:focus-visible,
.cv3-director-image-execution select:focus-visible {
  outline: 2px solid #77ceff;
  outline-offset: 2px;
}
.cv3-director-image-execution :disabled {
  cursor: default;
  opacity: 0.5;
}
@media (prefers-reduced-motion: reduce) {
  .cv3-director-image-execution button,
  .cv3-director-image-execution select {
    transition: none;
  }
}
@media (prefers-contrast: more) {
  .cv3-director-image-execution {
    border-color: #ccc;
    background: #181818;
  }
}
</style>

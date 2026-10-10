<script setup>
import { computed } from 'vue'
import { formatMiValue } from '../../utils/miValue'
import {
  MINIMAX_VIDEO_MODEL,
  VIDEO_MODELS,
  VIDEO_RATIOS,
  isPerSecondVideoModel,
} from '../../utils/productVideo'
import {
  estimatedVideoMiCost,
  videoDurationOptions,
  videoRatioForRequest,
  videoResolutionForModel,
  videoResolutionOptions,
  isProviderReportedCostVideoModel,
} from '../../utils/chatVideoSettings'

const props = defineProps({
  modelValue: { type: Object, required: true },
  models: { type: Array, default: () => VIDEO_MODELS },
  references: { type: Array, default: () => [] },
  capabilities: { type: Object, default: null },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue', 'remove-reference'])
const durations = computed(() => videoDurationOptions(props.modelValue.model))
const resolutions = computed(() => videoResolutionOptions(props.modelValue.model))
const ratio = computed(() =>
  videoRatioForRequest(props.modelValue.model, props.references.length, props.modelValue.ratio),
)
const price = computed(() =>
  estimatedVideoMiCost(
    props.modelValue.model,
    props.modelValue.resolution,
    Number(props.modelValue.duration),
    props.capabilities,
    isProviderReportedCostVideoModel(props.modelValue.model, props.models),
  ),
)
function change(key, value) {
  if (props.disabled) return
  const config = { ...props.modelValue, [key]: value }
  if (key === 'model') config.resolution = videoResolutionForModel(value)
  emit('update:modelValue', config)
}
</script>

<template>
  <fieldset class="agent-video-settings" :disabled="disabled" aria-label="视频方案参数">
    <label class="agent-video-model">
      <span>视频模型</span>
      <select
        aria-label="视频模型"
        :value="modelValue.model"
        @change="change('model', $event.target.value)"
      >
        <option v-for="option in models" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>
    <label>
      <span>比例</span>
      <select
        aria-label="比例"
        :value="ratio"
        :disabled="disabled || ratio !== modelValue.ratio"
        @change="change('ratio', $event.target.value)"
      >
        <option value="adaptive">自适应</option>
        <option v-for="value in VIDEO_RATIOS" :key="value" :value="value">{{ value }}</option>
      </select>
    </label>
    <label>
      <span>清晰度</span>
      <select
        aria-label="清晰度"
        :value="modelValue.resolution"
        @change="change('resolution', $event.target.value)"
      >
        <option v-for="value in resolutions" :key="value" :value="value">
          {{ value.toUpperCase() }}
        </option>
      </select>
    </label>
    <label>
      <span>时长</span>
      <select
        aria-label="时长"
        :value="modelValue.duration"
        @change="change('duration', Number($event.target.value))"
      >
        <option
          v-if="!durations.includes(Number(modelValue.duration))"
          :value="modelValue.duration"
          disabled
        >
          {{ modelValue.duration }} 秒 · 不支持
        </option>
        <option v-for="value in durations" :key="value" :value="value">{{ value }} 秒</option>
      </select>
    </label>
    <label v-if="modelValue.model === MINIMAX_VIDEO_MODEL">
      <span>模式</span>
      <select
        aria-label="模式"
        :value="modelValue.referenceMode"
        @change="change('referenceMode', $event.target.value)"
      >
        <option value="shouweizhen">首尾帧</option>
        <option value="cankaosheng">参考生</option>
      </select>
    </label>
    <label v-if="!isPerSecondVideoModel(modelValue.model)" class="agent-video-audio">
      <input
        type="checkbox"
        :checked="modelValue.generateAudio"
        @change="change('generateAudio', $event.target.checked)"
      />
      <span>生成声音</span>
    </label>
    <span v-else class="agent-video-audio">原生有声</span>
    <div v-if="references.length" class="agent-video-references" aria-label="视频参考图">
      <div
        v-for="(reference, index) in references"
        :key="reference.url"
        class="agent-video-reference"
      >
        <img :src="reference.url" :alt="`参考图 ${index + 1}`" />
        <button
          type="button"
          :disabled="disabled"
          :title="`移除参考图 ${index + 1}`"
          :aria-label="`移除参考图 ${index + 1}`"
          @click="emit('remove-reference', index)"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <output class="agent-video-price">
      {{ price == null ? '费用待配置' : `预计 ${formatMiValue(price)} 米值 / 条` }}
    </output>
  </fieldset>
</template>

<style scoped>
.agent-video-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-top: 1px solid var(--canvas-border, #3c3e43);
}
.agent-video-settings label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
}
.agent-video-model,
.agent-video-price,
.agent-video-references {
  grid-column: 1 / -1;
}
.agent-video-settings select {
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 6px;
  border: 1px solid var(--canvas-border, #484a50);
  border-radius: 4px;
  color: inherit;
  background: var(--canvas-surface, #202126);
  font: inherit;
}
.agent-video-settings .agent-video-audio {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.agent-video-audio input {
  accent-color: #16bad0;
}
.agent-video-price {
  font-size: 12px;
}
.agent-video-references {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.agent-video-reference {
  position: relative;
  width: 44px;
  height: 52px;
}
.agent-video-reference img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.agent-video-reference button {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #34363c;
  cursor: pointer;
}
.agent-video-settings :disabled {
  opacity: 0.65;
  cursor: default;
}
</style>

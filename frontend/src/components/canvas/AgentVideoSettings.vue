<script setup>
import { computed } from 'vue'
import { formatMiValue } from '../../utils/miValue'
import ThemedSelect from '../common/ThemedSelect.vue'
import {
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  VIDEO_MODELS,
  VIDEO_RATIOS,
} from '../../utils/productVideo'
import {
  estimatedVideoMiCost,
  videoDurationOptions,
  videoRatioForRequest,
  videoResolutionForModel,
  videoResolutionOptions,
  isProviderReportedCostVideoModel,
  isVideoFrameMode,
  supportsVideoFrameMode,
  videoFrameModeValue,
  supportsVideoAudioToggle,
} from '../../utils/chatVideoSettings'

const props = defineProps({
  modelValue: { type: Object, required: true },
  modelOptions: { type: Array, default: () => VIDEO_MODELS },
  references: { type: Array, default: () => [] },
  capabilities: { type: Object, default: null },
  disabled: Boolean,
  allowSeedanceFrames: Boolean,
})
const emit = defineEmits(['update:modelValue', 'remove-reference'])
const durations = computed(() => videoDurationOptions(props.modelValue.model))
const resolutions = computed(() => videoResolutionOptions(props.modelValue.model))
const ratioOptions = [
  { value: 'adaptive', label: '自适应' },
  ...VIDEO_RATIOS.map((value) => ({ value, label: value })),
]
const resolutionOptions = computed(() =>
  resolutions.value.map((value) => ({ value, label: value.toUpperCase() })),
)
const durationOptions = computed(() => {
  const options = durations.value.map((value) => ({ value, label: `${value} 秒` }))
  if (!durations.value.includes(Number(props.modelValue.duration))) {
    options.unshift({
      value: props.modelValue.duration,
      label: `${props.modelValue.duration} 秒 · 不支持`,
      disabled: true,
    })
  }
  return options
})
const modeOptions = computed(() => props.modelValue.model === HAILUO_H3_VIDEO_MODEL
  ? [{ value: 'shouweizhen', label: '首尾帧' }]
  : [
  { value: videoFrameModeValue(props.modelValue.model), label: '首尾帧' },
  { value: 'cankaosheng', label: '参考生' },
])
const ratio = computed(() =>
  videoRatioForRequest(
    props.modelValue.model,
    props.references.length,
    props.modelValue.ratio,
    props.modelValue.referenceMode,
  ),
)
const ratioLocked = computed(
  () =>
    videoRatioForRequest(
      props.modelValue.model,
      props.references.length,
      '16:9',
      props.modelValue.referenceMode,
    ) === 'adaptive',
)
const providerReportedCost = computed(() => isProviderReportedCostVideoModel(props.modelValue.model, props.modelOptions))
const price = computed(() =>
  estimatedVideoMiCost(
    props.modelValue.model,
    props.modelValue.resolution,
    Number(props.modelValue.duration),
    props.capabilities,
    providerReportedCost.value,
  ),
)
function change(key, value) {
  if (props.disabled) return
  const config = { ...props.modelValue, [key]: value }
  if (key === 'model') {
    config.resolution = videoResolutionForModel(value)
    if (value === HAILUO_H3_VIDEO_MODEL) config.referenceMode = 'shouweizhen'
    if (props.allowSeedanceFrames && supportsVideoFrameMode(value)) {
      config.referenceMode =
        !props.references.length ||
        isVideoFrameMode(props.modelValue.model, props.modelValue.referenceMode)
          ? videoFrameModeValue(value)
          : 'cankaosheng'
    }
  }
  emit('update:modelValue', config)
}
</script>

<template>
  <fieldset class="agent-video-settings" :disabled="disabled" aria-label="视频方案参数">
    <div class="agent-video-model agent-video-field">
      <span>视频模型</span>
      <ThemedSelect
        floating
        aria-label="视频模型"
        :model-value="modelValue.model"
        :options="modelOptions"
        :disabled="disabled"
        @update:model-value="change('model', $event)"
      />
    </div>
    <div class="agent-video-field">
      <span>比例</span>
      <ThemedSelect
        floating
        aria-label="比例"
        :model-value="ratio"
        :options="ratioOptions"
        :disabled="disabled || ratioLocked"
        @update:model-value="change('ratio', $event)"
      />
    </div>
    <div class="agent-video-field">
      <span>清晰度</span>
      <ThemedSelect
        floating
        aria-label="清晰度"
        :model-value="modelValue.resolution"
        :options="resolutionOptions"
        :disabled="disabled"
        @update:model-value="change('resolution', $event)"
      />
    </div>
    <div class="agent-video-field">
      <span>时长</span>
      <ThemedSelect
        floating
        aria-label="时长"
        :model-value="modelValue.duration"
        :options="durationOptions"
        :disabled="disabled"
        @update:model-value="change('duration', Number($event))"
      />
    </div>
    <div
      v-if="
        [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(modelValue.model) ||
        (allowSeedanceFrames && supportsVideoFrameMode(modelValue.model))
      "
      class="agent-video-field"
    >
      <span>模式</span>
      <ThemedSelect
        floating
        aria-label="模式"
        :model-value="modelValue.referenceMode"
        :options="modeOptions"
        :disabled="disabled"
        @update:model-value="change('referenceMode', $event)"
      />
    </div>
    <label v-if="supportsVideoAudioToggle(modelValue.model)" class="agent-video-audio">
      <input
        type="checkbox"
        :checked="modelValue.generateAudio"
        @change="change('generateAudio', $event.target.checked)"
      />
      <span>生成声音</span>
    </label>
    <span v-else class="agent-video-audio" title="当前接口不支持关闭声音">原生有声</span>
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
      {{ price == null ? '费用待配置' : providerReportedCost ? '生成成功后按实际用量结算' : `预计 ${formatMiValue(price)} 米值 / 条` }}
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
.agent-video-settings label,
.agent-video-field {
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
.agent-video-settings :deep(.themed-select-trigger) {
  width: 100%;
  min-width: 0;
  height: 32px;
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

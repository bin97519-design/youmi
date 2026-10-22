<script setup>
import { computed } from 'vue'
import { formatMiValue } from '../../utils/miValue'
import ThemedSelect from '../common/ThemedSelect.vue'
import CanvasRatioPicker from './CanvasRatioPicker.vue'
import { isSeedanceAnciModel, SEEDANCE_ANCI_RATIOS, SEEDANCE_ANCI_VERSIONS, seedanceAnciNotice } from '../../utils/seedanceAnci.js'
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
  referenceVideoCount: { type: Number, default: 0 },
  capabilities: { type: Object, default: null },
  disabled: Boolean,
  allowSeedanceFrames: Boolean,
  compact: Boolean,
})
const emit = defineEmits(['update:modelValue', 'remove-reference'])
const durations = computed(() => videoDurationOptions(props.modelValue.model))
const resolutions = computed(() => videoResolutionOptions(props.modelValue.model))
const ratioOptions = computed(() => isSeedanceAnciModel(props.modelValue.model)
  ? SEEDANCE_ANCI_RATIOS.map((value) => ({ value, label: value })) : [
  { value: 'adaptive', label: '自适应' },
  ...VIDEO_RATIOS.map((value) => ({ value, label: value })),
])
const anci = computed(() => isSeedanceAnciModel(props.modelValue.model))
const anciNotice = computed(() => seedanceAnciNotice(props.modelValue.model, props.modelValue.version, props.modelValue.duration))
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
const modeOptions = computed(() =>
  props.modelValue.model === HAILUO_H3_VIDEO_MODEL
    ? [{ value: 'shouweizhen', label: '首尾帧' }]
    : [
        {
          value: videoFrameModeValue(props.modelValue.model),
          label: '首尾帧',
          disabled: props.referenceVideoCount > 0,
        },
        { value: 'cankaosheng', label: '参考生' },
      ],
)
const modeVisible = computed(
  () =>
    [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(props.modelValue.model) ||
    (props.allowSeedanceFrames && supportsVideoFrameMode(props.modelValue.model)),
)
const ratio = computed(() =>
  videoRatioForRequest(
    props.modelValue.model,
    props.references.length,
    props.modelValue.ratio,
    props.modelValue.referenceMode,
    props.referenceVideoCount,
  ),
)
const ratioLocked = computed(
  () =>
    videoRatioForRequest(
      props.modelValue.model,
      props.references.length,
      '16:9',
      props.modelValue.referenceMode,
      props.referenceVideoCount,
    ) === 'adaptive',
)
const providerReportedCost = computed(() =>
  isProviderReportedCostVideoModel(props.modelValue.model, props.modelOptions),
)
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
    if (isSeedanceAnciModel(value)) {
      config.version ||= '快速'
      config.referenceMode = 'cankaosheng'
      config.ratio = videoRatioForRequest(value, props.references.length, config.ratio)
      config.generateAudio = true
    }
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
  <fieldset
    class="agent-video-settings"
    :class="{ 'is-compact': compact }"
    :disabled="disabled"
    aria-label="视频方案参数"
  >
    <template v-if="compact">
      <section v-if="anci" class="node-video-setting">
        <h4>速度版本</h4>
        <ThemedSelect floating aria-label="速度版本" :model-value="modelValue.version || '快速'"
          :options="SEEDANCE_ANCI_VERSIONS" :disabled="disabled" @update:model-value="change('version', $event)" />
      </section>
      <section class="node-video-setting node-video-ratios">
        <h4>比例</h4>
        <CanvasRatioPicker
          :model-value="ratio"
          :options="ratioOptions"
          label="视频比例"
          :disabled="disabled || ratioLocked"
          disabled-title="比例由参考素材决定"
          @update:model-value="change('ratio', $event)"
        />
      </section>
      <section class="node-video-setting">
        <h4>清晰度</h4>
        <div class="node-video-segments" role="group" aria-label="视频清晰度">
          <button
            v-for="option in resolutionOptions"
            :key="option.value"
            type="button"
            :class="{ active: modelValue.resolution === option.value }"
            :aria-label="`视频清晰度 ${option.label}`"
            :aria-pressed="modelValue.resolution === option.value"
            :disabled="disabled"
            @click="change('resolution', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </section>
      <section class="node-video-setting node-video-duration">
        <h4>时长</h4>
        <ThemedSelect
          floating
          aria-label="时长"
          :model-value="modelValue.duration"
          :options="durationOptions"
          :disabled="disabled"
          @update:model-value="change('duration', Number($event))"
        />
      </section>
      <section v-if="modeVisible" class="node-video-setting node-video-mode">
        <h4>模式</h4>
        <div class="node-video-segments" role="group" aria-label="视频生成模式">
          <button
            v-for="option in modeOptions"
            :key="option.value"
            type="button"
            :class="{ active: modelValue.referenceMode === option.value }"
            :aria-label="`视频模式 ${option.label}`"
            :aria-pressed="modelValue.referenceMode === option.value"
            :disabled="disabled || option.disabled"
            :title="option.disabled ? '已连接参考视频，请使用参考生模式' : option.label"
            @click="change('referenceMode', option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </section>
      <div class="node-video-audio-row">
        <span>
          <i class="ri-volume-up-line" aria-hidden="true"></i>
          {{ supportsVideoAudioToggle(modelValue.model) ? '生成声音' : '原生有声' }}
        </span>
        <button
          type="button"
          class="node-video-switch"
          role="switch"
          aria-label="生成声音"
          :aria-checked="
            !supportsVideoAudioToggle(modelValue.model) || modelValue.generateAudio !== false
          "
          :disabled="disabled || !supportsVideoAudioToggle(modelValue.model)"
          :title="
            supportsVideoAudioToggle(modelValue.model) ? '生成声音' : '当前接口不支持关闭声音'
          "
          @click="change('generateAudio', modelValue.generateAudio === false)"
        >
          <b></b>
        </button>
      </div>
      <output class="agent-video-price node-video-price">
        <i class="ri-copper-coin-line" aria-hidden="true"></i>
        {{
          price == null
            ? '费用待配置'
            : providerReportedCost
              ? '按实际用量结算'
              : `预计 ${formatMiValue(price)} 米值 / 条`
        }}
      </output>
    </template>
    <template v-else>
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
      <div v-if="anci" class="agent-video-field">
        <span>速度版本</span>
        <ThemedSelect floating aria-label="速度版本" :model-value="modelValue.version || '快速'"
          :options="SEEDANCE_ANCI_VERSIONS" :disabled="disabled" @update:model-value="change('version', $event)" />
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
      <div v-if="modeVisible" class="agent-video-field agent-video-mode">
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
      <div class="agent-video-field agent-video-audio-field">
        <span>声音</span>
        <button type="button" class="agent-video-audio-button"
          :class="{ active: !supportsVideoAudioToggle(modelValue.model) || modelValue.generateAudio !== false }"
          :disabled="disabled || !supportsVideoAudioToggle(modelValue.model)"
          :aria-pressed="!supportsVideoAudioToggle(modelValue.model) || modelValue.generateAudio !== false"
          aria-label="生成声音"
          @click="change('generateAudio', modelValue.generateAudio === false)">
          <i :class="modelValue.generateAudio === false && supportsVideoAudioToggle(modelValue.model) ? 'ri-volume-mute-line' : 'ri-volume-up-line'" aria-hidden="true"></i>
          {{ !supportsVideoAudioToggle(modelValue.model) ? '原生有声' : modelValue.generateAudio === false ? '关闭' : '开启' }}
        </button>
      </div>
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
        {{
          price == null
            ? '费用待配置'
            : providerReportedCost
              ? '生成成功后按实际用量结算'
              : `预计 ${formatMiValue(price)} 米值 / 条`
        }}
      </output>
    </template>
    <p v-if="anciNotice" class="agent-video-price" role="note">{{ anciNotice }}</p>
  </fieldset>
</template>

<style scoped>
.agent-video-settings {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) repeat(3, minmax(0, 1fr));
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
.agent-video-price,
.agent-video-references {
  grid-column: 1 / -1;
}
.agent-video-mode,
.agent-video-audio-field {
  grid-column: span 2;
}
.agent-video-settings:not(.is-compact) .agent-video-field > span {
  color: var(--canvas-text-muted, #9b9da3);
  font-size: 11px;
}
.agent-video-settings:not(.is-compact) :deep(.themed-select-trigger) {
  height: 38px;
  padding: 0 7px;
  border-radius: 9px;
}
.agent-video-audio-button {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 5px;
  height: 38px;
  border: 1px solid var(--canvas-border, #41434a);
  border-radius: 9px;
  background: transparent;
  color: var(--canvas-text-muted, #9b9da3);
  cursor: pointer;
}
.agent-video-audio-button.active {
  color: var(--canvas-accent, #19bfd3);
  border-color: var(--canvas-accent, #19bfd3);
  background: var(--canvas-accent-soft, rgba(25, 191, 211, 0.1));
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
.agent-video-settings.is-compact {
  grid-template-columns: minmax(0, 1fr) 104px;
  gap: 16px 12px;
  padding: 14px 16px;
  border: 0;
  color: var(--canvas-text);
}
.node-video-setting {
  min-width: 0;
}
.node-video-setting h4 {
  margin: 0 0 8px;
  color: var(--canvas-text-muted);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
.node-video-ratios,
.node-video-mode,
.node-video-audio-row {
  grid-column: 1 / -1;
}
.node-video-segments {
  display: flex;
  gap: 4px;
  min-width: 0;
}
.node-video-segments button {
  flex: 1 1 0;
  min-width: 0;
  height: 34px;
  padding: 0 5px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: transparent;
  color: var(--canvas-text-muted);
  font-size: 12px;
  cursor: pointer;
}
.node-video-segments button.active {
  border-color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  color: var(--canvas-accent);
}
.node-video-segments button:hover:not(:disabled) {
  border-color: var(--canvas-accent-border);
  color: var(--canvas-accent);
}
.node-video-duration :deep(.themed-select-trigger) {
  height: 34px;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
}
.node-video-audio-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.node-video-audio-row > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.node-video-audio-row > span i {
  color: var(--canvas-text-muted);
  font-size: 16px;
}
.node-video-switch {
  display: inline-flex;
  align-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 20px;
  padding: 3px;
  border: 0;
  border-radius: 12px;
  background: var(--canvas-border-strong);
  cursor: pointer;
}
.node-video-switch b {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--canvas-panel);
  transition: transform 0.15s ease;
}
.node-video-switch[aria-checked='true'] {
  background: var(--canvas-accent);
}
.node-video-switch[aria-checked='true'] b {
  transform: translateX(14px);
  background: #fff;
}
.node-video-price {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: -4px;
  color: var(--canvas-text-subtle);
  font-size: 11px;
  line-height: 16px;
}
.node-video-price i {
  font-size: 13px;
}
.is-compact button:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
@media (max-width: 360px) {
  .agent-video-settings.is-compact {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

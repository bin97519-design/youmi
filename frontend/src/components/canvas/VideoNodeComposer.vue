<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AgentVideoSettings from './AgentVideoSettings.vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { VIDEO_MODELS } from '../../utils/productVideo.js'
import { formatMiValue } from '../../utils/miValue.js'
import {
  estimatedVideoMiCost,
  videoRatioForRequest,
  videoReferenceLimit,
  videoResolutionForModel,
  isVideoFrameMode,
  supportsVideoFrameMode,
  videoFrameModeValue,
  supportsVideoAudioToggle,
  isProviderReportedCostVideoModel,
} from '../../utils/chatVideoSettings.js'
import { normalizeVideoNodeDraft, videoNodeReferenceError } from '../../utils/videoNodeDraft.js'
import { isSeedanceAnciModel, seedanceAnciVersion } from '../../utils/seedanceAnci.js'

const props = defineProps({
  draft: { type: Object, required: true },
  modelOptions: { type: Array, default: () => VIDEO_MODELS },
  capabilities: { type: Object, default: null },
  canvasImages: { type: Array, default: () => [] },
  editorWidth: { type: Number, default: 560 },
  disabled: Boolean,
  generating: Boolean,
  uploading: Boolean,
  uploadProgress: { type: Number, default: 0 },
  error: { type: String, default: '' },
})
const emit = defineEmits(['update:draft', 'generate', 'upload-reference', 'prompt-library', 'save-prompt'])
const settingsOpen = ref(false)
const root = ref(null)
let settingsTrigger
const expanded = ref(false)
const referencesOpen = ref(false)
const referenceInput = ref(null)
const promptInput = ref(null)
const referenceTargetIndex = ref(null)
const providerReportedCost = computed(() =>
  isProviderReportedCostVideoModel(props.draft.config.model, props.modelOptions),
)
const price = computed(() =>
  estimatedVideoMiCost(
    props.draft.config.model,
    props.draft.config.resolution,
    props.draft.config.duration,
    props.capabilities,
    providerReportedCost.value,
  ),
)
const audioToggleAvailable = computed(() => supportsVideoAudioToggle(props.draft.config.model))
const firstLast = computed(() =>
  isVideoFrameMode(props.draft.config.model, props.draft.config.referenceMode),
)
const referenceLimit = computed(() =>
  videoReferenceLimit(props.draft.config.model, props.draft.config.referenceMode),
)
const referenceError = computed(() => videoNodeReferenceError(props.draft))
const canAddReference = computed(
  () => !props.disabled && props.draft.references.length < referenceLimit.value,
)
const canChooseReference = computed(
  () =>
    !props.disabled &&
    (referenceTargetIndex.value == null
      ? canAddReference.value
      : referenceTargetIndex.value < props.draft.references.length ||
        (canAddReference.value && referenceTargetIndex.value === props.draft.references.length)),
)
const additionalReferences = computed(() =>
  props.draft.references
    .map((reference, index) => ({ reference, index }))
    .filter(({ index }) => !firstLast.value || index > 1),
)
const ratio = computed(() =>
  videoRatioForRequest(
    props.draft.config.model,
    props.draft.references.length,
    props.draft.config.ratio,
    props.draft.config.referenceMode,
    props.draft.referenceVideos?.length || 0,
  ),
)
const summary = computed(
  () =>
    `${firstLast.value ? '首尾帧' : props.draft.references.length || props.draft.referenceVideos?.length ? '参考生' : '文生'} · ${ratio.value === 'adaptive' ? '自适应' : ratio.value} · ${props.draft.config.resolution.toUpperCase()} · ${props.draft.config.duration}s`,
)
const modelLabel = computed(
  () =>
    (props.modelOptions.find((model) => model.value === props.draft.config.model)?.label ||
    props.draft.config.model) + (isSeedanceAnciModel(props.draft.config.model) ? ` · ${seedanceAnciVersion(props.draft.config.version)}版` : ''),
)
const priceLabel = computed(() =>
  price.value == null
    ? '费用待配置'
    : isSeedanceAnciModel(props.draft.config.model) ? '按条计费，完成后按实际费用结算' : providerReportedCost.value
      ? '生成成功后按实际用量结算'
      : `预计 ${formatMiValue(price.value)} 米值`,
)

function update(patch) {
  if (!props.disabled)
    emit(
      'update:draft',
      normalizeVideoNodeDraft({ ...props.draft, ...patch }, {}, props.modelOptions),
    )
}
function changeModel(model) {
  const referenceMode =
    supportsVideoFrameMode(model) && (!props.draft.references.length || firstLast.value)
      ? videoFrameModeValue(model)
      : 'cankaosheng'
  update({
    config: {
      ...props.draft.config,
      model,
      referenceMode,
      resolution: videoResolutionForModel(model),
    },
  })
}
function updateReferenceVideoDuration(reference, event) {
  const duration = event.target.duration
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    Math.abs(duration - reference.duration) < 0.001
  )
    return
  update({
    referenceVideos: props.draft.referenceVideos.map((video) =>
      video.url === reference.url ? { ...video, duration } : video,
    ),
  })
}
function addReference(image) {
  if (
    !canChooseReference.value ||
    props.draft.references.some((reference) => reference.url === image.url)
  )
    return
  const references = [...props.draft.references]
  if (referenceTargetIndex.value == null) references.push(image)
  else references.splice(referenceTargetIndex.value, 1, image)
  update({ references })
  referencesOpen.value = false
}
function uploadReference(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  referencesOpen.value = false
  if (file && canChooseReference.value)
    emit('upload-reference', { file, index: referenceTargetIndex.value })
}
function toggleReferences(index = null) {
  referencesOpen.value = !referencesOpen.value || referenceTargetIndex.value !== index
  referenceTargetIndex.value = index
  settingsOpen.value = false
}
function toggleSettings(event) {
  settingsTrigger = event?.currentTarget || settingsTrigger
  settingsOpen.value = !settingsOpen.value
  referencesOpen.value = false
}
function closeSettings() {
  settingsOpen.value = false
  settingsTrigger?.focus({ preventScroll: true })
}
function closeSettingsOutside(event) {
  if (!root.value?.contains(event.target) && !event.target.closest('.themed-select-options'))
    settingsOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeSettingsOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeSettingsOutside, true))
</script>

<template>
  <section
    ref="root"
    class="video-node-composer canvas-node-composer"
    :class="{ 'is-compact': editorWidth < 480, 'is-expanded': expanded }"
    :style="{ width: `${editorWidth}px` }"
    aria-label="视频节点编辑器"
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @keydown.stop
    @keydown.esc.prevent="settingsOpen ? closeSettings() : (referencesOpen = false)"
    @wheel.stop
  >
    <div class="video-node-reference-row">
      <button
        class="video-node-icon video-node-focus"
        type="button"
        :disabled="disabled"
        title="焦点编辑"
        aria-label="焦点编辑"
        @click="promptInput?.focus({ preventScroll: true })"
      >
        <i class="ri-cursor-line" aria-hidden="true"></i>
      </button>
      <span class="video-node-top-divider" aria-hidden="true"></span>
      <template v-if="firstLast">
        <template v-for="index in [0, 1]" :key="index">
          <div
            class="video-node-frame-slot"
            :class="{ 'video-node-reference': Boolean(draft.references[index]) }"
          >
            <button
              class="video-node-icon video-node-frame"
              type="button"
              :disabled="disabled || (index === 1 && !draft.references[0])"
              :title="index === 0 ? '首帧' : '尾帧'"
              :aria-label="index === 0 ? '选择首帧' : '选择尾帧'"
              @click="toggleReferences(index)"
            >
              <img
                v-if="draft.references[index]"
                :src="draft.references[index].url"
                :alt="index === 0 ? '首帧' : '尾帧'"
              />
              <i v-else class="ri-add-line" aria-hidden="true"></i>
            </button>
            <span v-if="draft.references[index]" class="video-node-frame-label">
              {{ index === 0 ? '首帧' : '尾帧' }}
            </span>
            <button
              v-if="draft.references[index]"
              class="video-node-remove-frame"
              type="button"
              :disabled="disabled"
              :title="`移除参考图 ${index + 1}`"
              :aria-label="`移除参考图 ${index + 1}`"
              @click="update({ references: draft.references.filter((_, at) => at !== index) })"
            >
              <i class="ri-close-line" aria-hidden="true"></i>
            </button>
          </div>
          <button
            v-if="index === 0"
            class="video-node-icon video-node-swap"
            type="button"
            :disabled="disabled || draft.references.length < 2"
            title="交换首尾帧"
            aria-label="交换首尾帧"
            @click="
              update({
                references: [
                  draft.references[1],
                  draft.references[0],
                  ...draft.references.slice(2),
                ],
              })
            "
          >
            <i class="ri-arrow-left-right-line" aria-hidden="true"></i>
          </button>
        </template>
      </template>
      <div
        v-for="{ reference, index } in additionalReferences"
        :key="reference.url"
        class="video-node-reference"
      >
        <img :src="reference.url" :alt="`参考图 ${index + 1}`" />
        <button
          type="button"
          :disabled="disabled"
          :title="`移除参考图 ${index + 1}`"
          :aria-label="`移除参考图 ${index + 1}`"
          @click="update({ references: draft.references.filter((_, at) => at !== index) })"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <div
        v-for="(reference, index) in draft.referenceVideos || []"
        :key="`video-${reference.url}`"
        class="video-node-reference video-node-reference-video"
        :title="`参考视频 ${index + 1}：${reference.name}`"
        :aria-label="`参考视频 ${index + 1}：${reference.name}`"
      >
        <video
          :src="reference.url"
          :poster="reference.thumbnailUrl || undefined"
          preload="metadata"
          muted
          playsinline
          @loadedmetadata="updateReferenceVideoDuration(reference, $event)"
        ></video>
        <span>
          <i class="ri-video-line" aria-hidden="true"></i>
          {{ reference.duration ? `${Number(reference.duration.toFixed(1))}s` : index + 1 }}
        </span>
        <button
          type="button"
          :disabled="disabled"
          :title="`移除参考视频 ${index + 1}`"
          :aria-label="`移除参考视频 ${index + 1}`"
          @click="
            update({ referenceVideos: draft.referenceVideos.filter((_, at) => at !== index) })
          "
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <button
        v-if="!firstLast"
        class="video-node-icon video-node-add-reference"
        type="button"
        :disabled="!canAddReference"
        :title="firstLast ? (draft.references.length ? '添加尾帧' : '添加首帧') : '添加参考图'"
        aria-label="添加视频参考图"
        :aria-expanded="referencesOpen"
        @click="toggleReferences()"
      >
        <i class="ri-add-line" aria-hidden="true"></i>
      </button>
      <div
        v-for="(reference, index) in draft.referenceTexts || []"
        :key="`text-${reference.layerId || index}`"
        class="video-node-reference video-node-reference-text"
        :title="`${reference.name}\n${reference.text}`"
        :aria-label="`参考文本 ${index + 1}`"
      >
        <i class="ri-text" aria-hidden="true"></i>
        <button
          type="button"
          :disabled="disabled"
          :title="`移除参考文本 ${index + 1}`"
          :aria-label="`移除视频参考文本 ${index + 1}`"
          @click="update({ referenceTexts: draft.referenceTexts.filter((_, at) => at !== index) })"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <span v-if="uploading" class="video-node-upload-progress">{{ uploadProgress }}%</span>
      <input ref="referenceInput" type="file" accept="image/*" hidden @change="uploadReference" />
    </div>
    <div v-if="referencesOpen" class="video-node-reference-picker">
      <header>
        <button type="button" @click="referenceInput?.click()">
          <i class="ri-upload-2-line" aria-hidden="true"></i>
          本地上传
        </button>
        <span>画布图片</span>
        <button
          class="video-node-icon"
          type="button"
          title="关闭参考图选择"
          aria-label="关闭参考图选择"
          @click="referencesOpen = false"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </header>
      <div class="video-node-canvas-images">
        <button
          v-for="image in canvasImages"
          :key="image.layerId"
          type="button"
          :disabled="draft.references.some((reference) => reference.url === image.url)"
          :title="image.name"
          :aria-label="`选择画布图片 ${image.name}`"
          @click="addReference(image)"
        >
          <img :src="image.thumbnailUrl || image.url" :alt="image.name" />
          <span>{{ image.name }}</span>
        </button>
        <span v-if="!canvasImages.length" class="video-node-empty">暂无画布图片</span>
      </div>
    </div>
    <button
      class="video-node-icon canvas-node-expand video-node-expand"
      type="button"
      :title="expanded ? '收起输入框' : '展开输入框'"
      :aria-label="expanded ? '收起视频输入框' : '展开视频输入框'"
      :aria-pressed="expanded"
      @click="expanded = !expanded"
    >
      <i
        :class="expanded ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"
        aria-hidden="true"
      ></i>
    </button>
    <textarea
      ref="promptInput"
      :value="draft.prompt"
      :disabled="disabled"
      rows="3"
      aria-label="视频节点脚本"
      placeholder="描述视频画面、动作和镜头运动"
      @input="update({ prompt: $event.target.value })"
    ></textarea>
    <div v-if="settingsOpen" class="video-node-settings" role="region" aria-label="视频设置面板">
      <header class="video-node-settings-head">
        <span>视频设置</span>
        <button
          type="button"
          class="video-node-icon"
          title="关闭视频设置"
          aria-label="关闭视频设置"
          @click="closeSettings"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </header>
      <div class="video-node-settings-body">
        <AgentVideoSettings
          compact
          allow-seedance-frames
          :model-value="draft.config"
          :model-options="modelOptions"
          :references="draft.references"
          :reference-video-count="draft.referenceVideos?.length || 0"
          :capabilities="capabilities"
          :disabled="disabled"
          @update:model-value="update({ config: $event })"
          @remove-reference="
            update({ references: draft.references.filter((_, index) => index !== $event) })
          "
        />
      </div>
    </div>
    <footer class="video-node-toolbar">
      <div class="video-node-toolbar-options">
        <div class="video-node-model" :title="modelLabel">
          <i class="ri-movie-line" aria-hidden="true"></i>
          <ThemedSelect
            floating
            :menu-min-width="220"
            :model-value="draft.config.model"
            :options="modelOptions"
            :disabled="disabled"
            aria-label="视频节点模型"
            @update:model-value="changeModel"
          />
        </div>
        <span class="video-node-toolbar-divider" aria-hidden="true"></span>
        <button
          class="video-node-summary"
          type="button"
          :disabled="disabled"
          :title="summary"
          aria-label="视频节点参数"
          :aria-expanded="settingsOpen"
          @click="toggleSettings"
        >
          <span>{{ summary }}</span>
        </button>
        <button
          class="video-node-icon"
          type="button"
          :disabled="disabled || !audioToggleAvailable"
          :title="
            !audioToggleAvailable
              ? '原生有声，当前接口不支持关闭'
              : draft.config.generateAudio
                ? '关闭生成声音'
                : '开启生成声音'
          "
          :aria-label="audioToggleAvailable ? '生成声音' : '原生有声'"
          :aria-pressed="draft.config.generateAudio"
          @click="
            update({ config: { ...draft.config, generateAudio: !draft.config.generateAudio } })
          "
        >
          <i
            :class="draft.config.generateAudio ? 'ri-volume-up-line' : 'ri-volume-mute-line'"
            aria-hidden="true"
          ></i>
        </button>
        <button
          class="video-node-icon"
          type="button"
          :disabled="disabled"
          title="视频设置"
          aria-label="视频设置"
          :aria-expanded="settingsOpen"
          @click="toggleSettings"
        >
          <i class="ri-equalizer-line" aria-hidden="true"></i>
        </button>
      </div>
      <button
        class="video-node-icon"
        type="button"
        :disabled="disabled"
        title="视频提示词库"
        aria-label="打开视频提示词库"
        @click="emit('prompt-library')"
      >
        <i class="ri-book-shelf-line" aria-hidden="true"></i>
      </button>
      <button
        class="video-node-icon"
        type="button"
        :disabled="!draft.prompt.trim()"
        title="收藏视频提示词"
        aria-label="收藏视频提示词"
        @click="emit('save-prompt')"
      >
        <i class="ri-bookmark-line" aria-hidden="true"></i>
      </button>
      <div class="video-node-toolbar-actions">
        <output class="video-node-cost" :title="priceLabel" :aria-label="priceLabel">
          <i class="ri-copper-coin-line" aria-hidden="true"></i>
          <span>
            {{ price == null ? '待配置' : providerReportedCost ? '用量' : formatMiValue(price) }}
          </span>
        </output>
        <button
          class="video-node-generate video-node-icon"
          type="button"
          :disabled="
            disabled ||
            (!draft.prompt.trim() && !draft.referenceTexts?.length) ||
            !!referenceError ||
            price == null
          "
          :title="generating ? '视频生成中' : disabled ? '正在处理' : '生成视频'"
          aria-label="生成视频"
          @click="emit('generate')"
        >
          <i
            :class="disabled ? 'ri-loader-4-line uc-spin' : 'ri-arrow-up-line'"
            aria-hidden="true"
          ></i>
        </button>
      </div>
    </footer>
    <p v-if="referenceError || error" class="video-node-error" role="status">
      {{ referenceError || error }}
    </p>
  </section>
</template>

<style scoped>
.video-node-composer {
  position: absolute;
  /* The transformed composer must stack above the node ports (99999). */
  z-index: 100000;
  top: calc(100% + 12px * var(--canvas-inverse-scale, 1));
  left: 50%;
  transform: translateX(-50%) scale(var(--canvas-inverse-scale, 1));
  transform-origin: top center;
  min-width: 0;
  box-sizing: border-box;
  padding: 12px;
  font-size: 14px;
  color: var(--canvas-text, #e3e4e7);
  background: var(--canvas-panel, #232428);
  border: 1px solid var(--canvas-border, #404248);
  border-radius: 8px;
  cursor: default;
  text-align: left;
}
.video-node-composer button,
.video-node-composer select,
.video-node-composer textarea {
  font: inherit;
  color: inherit;
}
.video-node-composer button {
  cursor: pointer;
}
.video-node-composer button:disabled,
.video-node-composer select:disabled {
  opacity: 0.5;
  cursor: default;
}
.video-node-composer button:focus-visible,
.video-node-composer select:focus-visible,
.video-node-composer textarea:focus-visible {
  outline: 2px solid #18bed0;
  outline-offset: 2px;
}
.video-node-reference-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 36px;
}
.video-node-top-divider,
.video-node-toolbar-divider {
  width: 1px;
  height: 16px;
  flex: 0 0 1px;
  background: var(--canvas-border);
}
.video-node-top-divider {
  margin: 0 2px;
}
.video-node-icon {
  display: inline-flex;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 17px !important;
}
.video-node-icon:hover:not(:disabled) {
  background: #ffffff12;
}
.video-node-add-reference,
.video-node-focus,
.video-node-frame {
  width: 36px;
  height: 36px;
  flex-basis: 36px;
  background: #ffffff0c;
  border: 1px solid var(--canvas-border, #404248);
}
.video-node-reference {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
}
.video-node-reference img,
.video-node-reference video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.video-node-reference-video {
  width: 52px;
  flex-basis: 52px;
  background: var(--canvas-panel, #232428);
  border-radius: 4px;
}
.video-node-reference-text {
  display: grid;
  place-items: center;
  color: var(--canvas-accent, #18bed0);
  background: var(--canvas-accent-soft, #18bed012);
  border: 1px solid var(--canvas-border, #404248);
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 20px;
}
.video-node-reference span {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  font-size: 9px;
  text-align: center;
  color: #fff;
  background: #000a;
}
.video-node-reference > button:not(.video-node-frame) {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #44464d;
  font-size: 12px;
}
.video-node-frame-slot {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
}
.video-node-frame-slot .video-node-frame {
  width: 36px;
  height: 36px;
  overflow: hidden;
}
.video-node-frame-slot .video-node-frame-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  text-align: center;
  font-size: 9px;
  line-height: 12px;
  border-radius: 0 0 4px 4px;
  background: #000a;
  color: #fff;
  pointer-events: none;
}
.video-node-swap {
  width: 18px;
  flex-basis: 18px;
  font-size: 12px !important;
  color: var(--canvas-text-muted, #999ba3) !important;
}
.video-node-composer textarea {
  display: block;
  width: 100%;
  min-height: 84px;
  max-height: 280px;
  box-sizing: border-box;
  resize: vertical;
  margin: 8px 0 12px;
  padding: 2px;
  border: 0;
  background: transparent;
  line-height: 1.6;
  font-size: 14px;
}
.video-node-composer textarea::placeholder {
  color: var(--canvas-text-muted, #999ba3);
}
.video-node-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 32px;
}
.video-node-toolbar-options {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 0;
  min-width: 0;
}
.video-node-model {
  position: relative;
  flex: 0 1 132px;
  min-width: 104px;
  max-width: 144px;
}
.video-node-model > i {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  pointer-events: none;
  font-size: 13px;
  color: var(--canvas-text-muted);
}
.video-node-model :deep(.themed-select-trigger) {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 3px 0 18px;
  gap: 3px;
  border-color: transparent;
  background: transparent;
  font-size: 12px;
}
.video-node-model :deep(.themed-select-trigger i) {
  font-size: 12px;
}
.video-node-model :deep(.themed-select-trigger:hover),
.video-node-model :deep(.themed-select.open .themed-select-trigger),
.video-node-model :deep(.themed-select-trigger:focus-visible) {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  box-shadow: none;
}
.video-node-summary {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 3px;
  text-align: left;
  background: transparent;
  border: 0;
  font-size: 12px !important;
  white-space: nowrap;
}
.video-node-summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.video-node-summary:hover:not(:disabled) {
  color: var(--canvas-accent);
}
.video-node-toolbar-options > .video-node-icon {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
  font-size: 15px !important;
}
.video-node-toolbar-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  margin-left: auto;
  padding: 3px 3px 3px 8px;
  border: 1px solid var(--canvas-border);
  border-radius: 20px;
  background: var(--canvas-surface-hover);
}
.video-node-cost {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  white-space: nowrap;
  font-size: 12px;
}
.video-node-cost i {
  font-size: 15px;
}
.video-node-generate {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
  background: var(--canvas-accent);
  color: #102126 !important;
  border-radius: 50%;
}
.is-compact .video-node-toolbar-options {
  flex-basis: 100%;
}
.is-compact .video-node-model {
  flex-basis: 108px;
}
.video-node-error {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #fa8585;
  overflow-wrap: anywhere;
}
.video-node-upload-progress {
  font-size: 11px;
}
.video-node-settings {
  position: absolute;
  bottom: 54px;
  right: 12px;
  width: min(400px, calc(100% - 24px));
  z-index: 2;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  box-shadow: var(--canvas-panel-shadow);
  overflow: hidden;
}
.video-node-settings-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 40px;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--canvas-border);
  color: var(--canvas-text);
  font-size: 13px;
  font-weight: 600;
}
.video-node-settings-head > .video-node-icon {
  width: 24px;
  height: 24px;
  flex-basis: 24px;
  font-size: 16px !important;
  color: var(--canvas-text-muted);
}
.video-node-settings-body {
  max-height: min(344px, calc(100vh - 176px));
  overflow: auto;
  overscroll-behavior: contain;
}
.is-compact .video-node-settings {
  bottom: 88px;
}
.is-compact .video-node-settings-body {
  max-height: min(280px, calc(100vh - 176px));
}
.video-node-reference-picker {
  margin: 8px 0;
  border-top: 1px solid var(--canvas-border, #404248);
  padding-top: 6px;
}
.video-node-reference-picker header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.video-node-reference-picker header > button:first-child {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border: 1px solid var(--canvas-border, #404248);
  border-radius: 4px;
  background: transparent;
}
.video-node-reference-picker header > button:last-child {
  margin-left: auto;
}
.video-node-canvas-images {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  max-height: 180px;
  overflow: auto;
  margin-top: 6px;
}
.video-node-canvas-images button {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.video-node-canvas-images img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 4px;
}
.video-node-canvas-images span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  line-height: 20px;
}
.video-node-empty {
  grid-column: 1 / -1;
  color: var(--canvas-text-muted, #999ba3);
  padding: 8px 0;
}
</style>

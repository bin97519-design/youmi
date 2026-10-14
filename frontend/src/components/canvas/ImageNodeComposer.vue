<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { canvasReferenceTextError } from '../../utils/canvasReferenceTexts.js'

const props = defineProps({
  draft: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  ratioOptions: { type: Array, default: () => [] },
  canvasImages: { type: Array, default: () => [] },
  editorWidth: { type: Number, default: 560 },
  disabled: Boolean,
  uploading: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits([
  'update:draft',
  'generate',
  'upload-reference',
  'open-materials',
  'resize',
])
const root = ref(null)
let resizeObserver
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) =>
    emit('resize', entry.borderBoxSize?.[0]?.blockSize || entry.target.offsetHeight),
  )
  resizeObserver.observe(root.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())
const promptInput = ref(null)
const open = ref('')
const expanded = ref(false)
const totalCount = computed(() => props.draft.config.models.length * props.draft.config.count)
const referenceError = computed(() => canvasReferenceTextError(props.draft.prompt, props.draft.referenceTexts, 10000))
const modelLabel = computed(() => {
  const first =
    props.modelOptions.find((option) => option.value === props.draft.config.model)?.label ||
    props.draft.config.model
  return props.draft.config.models.length > 1
    ? `${first} +${props.draft.config.models.length - 1}`
    : first
})
const summary = computed(
  () =>
    `${props.draft.references.length ? '图生' : '文生'} · ${props.draft.config.ratio === 'auto' ? '自适应' : props.draft.config.ratio} · ${props.draft.config.resolution} · ${totalCount.value}张`,
)
const ratios = computed(() =>
  props.ratioOptions.map((value) => ({ value, label: value === 'auto' ? '自适应' : value })),
)
function update(patch) {
  if (!props.disabled) emit('update:draft', { ...props.draft, ...patch })
}
function config(patch) {
  update({ config: { ...props.draft.config, ...patch } })
}
function toggle(name) {
  open.value = open.value === name ? '' : name
}
function openReferenceSource(event) {
  open.value = ''
  emit(event)
}
function toggleModel(model) {
  const current = props.draft.config.models
  const models = current.includes(model)
    ? current.length > 1
      ? current.filter((value) => value !== model)
      : current
    : [...current, model]
  config({ models, model: models[0] })
}
function addReference(image) {
  if (props.disabled || props.draft.references.some((reference) => reference.url === image.url))
    return
  update({ references: [...props.draft.references, { ...image, id: image.layerId || image.url }] })
  open.value = ''
}
</script>

<template>
  <section
    ref="root"
    class="image-node-composer canvas-node-composer"
    :class="{ 'is-compact': editorWidth < 480, 'is-expanded': expanded }"
    :style="{ width: `${editorWidth}px` }"
    aria-label="图片节点编辑器"
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @keydown.stop
    @keydown.esc="open = ''"
  >
    <div class="image-node-reference-row">
      <button
        class="image-node-icon image-node-focus"
        type="button"
        title="焦点编辑"
        aria-label="焦点编辑"
        :disabled="disabled"
        @click="promptInput?.focus({ preventScroll: true })"
      >
        <i class="ri-cursor-line" aria-hidden="true"></i>
      </button>
      <span class="image-node-divider" aria-hidden="true"></span>
      <div
        v-for="(reference, index) in draft.references"
        :key="reference.id"
        class="image-node-reference"
      >
        <img :src="reference.url" :alt="`参考图 ${index + 1}`" />
        <button
          type="button"
          :disabled="disabled"
          :title="`移除参考图 ${index + 1}`"
          :aria-label="`移除图片参考图 ${index + 1}`"
          @click="
            update({ references: draft.references.filter((item) => item.id !== reference.id) })
          "
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <div v-for="(reference, index) in draft.referenceTexts || []" :key="`text-${reference.layerId || index}`"
        class="image-node-reference image-node-reference-text" :title="`${reference.name}\n${reference.text}`" :aria-label="`参考文本 ${index + 1}`">
        <i class="ri-text" aria-hidden="true"></i>
        <button type="button" :disabled="disabled" :title="`移除参考文本 ${index + 1}`" :aria-label="`移除图片参考文本 ${index + 1}`"
          @click="update({ referenceTexts: draft.referenceTexts.filter((_, at) => at !== index) })">
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <button
        class="image-node-icon image-node-add"
        type="button"
        title="添加参考图"
        aria-label="添加图片参考图"
        :disabled="disabled"
        :aria-expanded="open === 'references'"
        @click="toggle('references')"
      >
        <i class="ri-add-line" aria-hidden="true"></i>
      </button>
      <span v-if="uploading" class="image-node-muted" role="status">上传中</span>
      <button class="image-node-icon canvas-node-expand" type="button" :title="expanded ? '收起输入框' : '展开输入框'"
        :aria-label="expanded ? '收起图片输入框' : '展开图片输入框'" :aria-pressed="expanded" @click="expanded = !expanded">
        <i :class="expanded ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'" aria-hidden="true"></i>
      </button>
    </div>
    <div v-if="open === 'references'" class="image-node-popover image-node-reference-picker">
      <header>
        <button type="button" :disabled="disabled" @click="openReferenceSource('upload-reference')">
          <i class="ri-upload-2-line" aria-hidden="true"></i>
          本地上传
        </button>
        <button type="button" :disabled="disabled" @click="openReferenceSource('open-materials')">
          <i class="ri-folder-image-line" aria-hidden="true"></i>
          素材库
        </button>
      </header>
      <div class="image-node-canvas-images">
        <button
          v-for="image in canvasImages"
          :key="image.layerId"
          type="button"
          :title="image.name"
          :aria-label="`选择图片参考图 ${image.name}`"
          :disabled="disabled || draft.references.some((reference) => reference.url === image.url)"
          @click="addReference(image)"
        >
          <img :src="image.thumbnailUrl || image.url" :alt="image.name" />
        </button>
        <span v-if="!canvasImages.length" class="image-node-muted">暂无画布图片</span>
      </div>
    </div>
    <textarea
      ref="promptInput"
      :value="draft.prompt"
      :disabled="disabled"
      maxlength="10000"
      rows="3"
      aria-label="图片节点提示词"
      placeholder="描述图片内容或需要修改的地方"
      @focus="open = ''"
      @input="update({ prompt: $event.target.value })"
    ></textarea>
    <div
      v-if="open === 'models'"
      class="image-node-popover image-node-model-picker"
      role="menu"
      aria-label="图片节点模型选择"
    >
      <button
        v-for="option in modelOptions"
        :key="option.value"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="draft.config.models.includes(option.value)"
        :disabled="disabled"
        @click="toggleModel(option.value)"
      >
        <i
          :class="
            draft.config.models.includes(option.value)
              ? 'ri-checkbox-line'
              : 'ri-checkbox-blank-line'
          "
          aria-hidden="true"
        ></i>
        <span>{{ option.label }}</span>
      </button>
    </div>
    <div v-if="open === 'settings'" class="image-node-popover image-node-settings">
      <label>
        比例
        <ThemedSelect
          floating
          :menu-min-width="120"
          :model-value="draft.config.ratio"
          :options="ratios"
          :disabled="disabled"
          aria-label="图片节点比例"
          @update:model-value="config({ ratio: $event })"
        />
      </label>
      <label>
        分辨率
        <ThemedSelect
          floating
          :model-value="draft.config.resolution"
          :options="['1K', '2K', '4K'].map((value) => ({ value, label: value }))"
          :disabled="disabled"
          aria-label="图片节点分辨率"
          @update:model-value="config({ resolution: $event })"
        />
      </label>
      <label>
        数量
        <ThemedSelect
          floating
          :model-value="draft.config.count"
          :options="[1, 2, 3, 4].map((value) => ({ value, label: `${value}张` }))"
          :disabled="disabled"
          aria-label="图片节点数量"
          @update:model-value="config({ count: $event })"
        />
      </label>
    </div>
    <footer class="image-node-toolbar">
      <div class="image-node-toolbar-options">
        <button
          class="image-node-model"
          type="button"
          :disabled="disabled"
          :title="modelLabel"
          aria-label="图片节点模型"
          :aria-expanded="open === 'models'"
          @click="toggle('models')"
        >
          <i class="ri-image-line" aria-hidden="true"></i>
          <span>{{ modelLabel }}</span>
          <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
        </button>
        <span class="image-node-divider" aria-hidden="true"></span>
        <button
          class="image-node-summary"
          type="button"
          :disabled="disabled"
          :title="summary"
          aria-label="图片节点参数"
          @click="toggle('settings')"
        >
          <span class="image-node-summary-parts">
            <span
              v-for="(part, index) in summary.split(' · ')"
              :key="index"
              class="image-node-summary-part"
            >
              {{ index ? ` · ${part}` : part }}
            </span>
          </span>
        </button>
        <button
          class="image-node-icon"
          type="button"
          :disabled="disabled"
          title="图片设置"
          aria-label="图片设置"
          :aria-expanded="open === 'settings'"
          @click="toggle('settings')"
        >
          <i class="ri-equalizer-line" aria-hidden="true"></i>
        </button>
      </div>
      <div class="image-node-toolbar-actions">
        <output title="生成成功后按模型实际费用结算" aria-label="生成用量">
          <i class="ri-copper-coin-line" aria-hidden="true"></i>
          用量
        </output>
        <button
          class="image-node-icon image-node-generate"
          type="button"
          :disabled="disabled || (!draft.prompt.trim() && !draft.referenceTexts?.length) || !!referenceError || !draft.config.models.length"
          :title="disabled ? '正在处理' : '生成图片'"
          aria-label="生成图片"
          @click="emit('generate')"
        >
          <i
            :class="disabled ? 'ri-loader-4-line uc-spin' : 'ri-arrow-up-line'"
            aria-hidden="true"
          ></i>
        </button>
      </div>
    </footer>
    <p v-if="referenceError || error" class="image-node-error" role="alert">{{ referenceError || error }}</p>
  </section>
</template>

<style scoped>
.image-node-composer {
  position: absolute;
  z-index: 100000;
  top: calc(100% + 12px * var(--canvas-inverse-scale, 1));
  left: 50%;
  transform: translateX(-50%) scale(var(--canvas-inverse-scale, 1));
  transform-origin: top center;
  min-width: 0;
  box-sizing: border-box;
  padding: 12px;
  color: var(--canvas-text, #e3e4e7);
  background: var(--canvas-panel, #232428);
  border: 1px solid var(--canvas-border, #404248);
  border-radius: 8px;
  font-size: 14px;
  cursor: default;
  text-align: left;
}
.image-node-composer button,
.image-node-composer textarea {
  font: inherit;
  color: inherit;
}
.image-node-composer button {
  cursor: pointer;
}
.image-node-composer button:disabled {
  opacity: 0.5;
  cursor: default;
}
.image-node-composer button:focus-visible,
.image-node-composer textarea:focus-visible {
  outline: 2px solid var(--canvas-accent, #18bed0);
  outline-offset: 2px;
}
.image-node-reference-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 36px;
}
.image-node-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 17px !important;
}
.image-node-focus,
.image-node-add {
  background: #ffffff0c;
  border: 1px solid var(--canvas-border);
}
.image-node-icon:hover:not(:disabled) {
  background: #ffffff12;
}
.image-node-divider {
  width: 1px;
  height: 16px;
  flex: 0 0 1px;
  background: var(--canvas-border);
  margin: 0 2px;
}
.image-node-reference {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
}
.image-node-reference img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.image-node-reference-text {
  display: grid;
  place-items: center;
  color: var(--canvas-accent, #18bed0);
  background: var(--canvas-accent-soft, #18bed012);
  border: 1px solid var(--canvas-border, #404248);
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 20px;
}
.image-node-reference > button {
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
.image-node-composer textarea {
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
.image-node-composer textarea::placeholder,
.image-node-muted {
  color: var(--canvas-text-muted, #999ba3);
}
.image-node-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 32px;
}
.image-node-toolbar-options {
  display: flex;
  align-items: center;
  flex: 1 1 0;
  gap: 4px;
  min-width: 0;
}
.image-node-model {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 144px;
  min-width: 100px;
  max-width: 160px;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px !important;
}
.image-node-model span,
.image-node-summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-node-model > i {
  flex-shrink: 0;
}
.image-node-summary {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  height: 30px;
  padding: 0 3px;
  border: 0;
  background: transparent;
  font-size: 12px !important;
  text-align: left;
}
.image-node-toolbar-options > .image-node-icon {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
  font-size: 15px !important;
}
.image-node-toolbar-actions {
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
.image-node-toolbar-actions output {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 12px;
}
.image-node-generate {
  width: 28px;
  height: 28px;
  flex-basis: 28px;
  border-radius: 50%;
  background: var(--canvas-accent);
  color: #102126 !important;
}
.image-node-popover {
  position: absolute;
  bottom: 54px;
  left: 8px;
  right: 8px;
  z-index: 2;
  max-height: 260px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface, #232428);
  box-shadow: 0 8px 24px #0003;
}
.image-node-popover header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.image-node-popover header button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface-hover);
  font-size: 12px;
}
.image-node-canvas-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 6px;
}
.image-node-canvas-images button {
  aspect-ratio: 1;
  min-width: 0;
  padding: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 4px;
  overflow: hidden;
  background: transparent;
}
.image-node-canvas-images img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.image-node-model-picker button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 6px;
  border: 0;
  background: transparent;
  text-align: left;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.image-node-model-picker button[aria-checked='true'] {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.image-node-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.image-node-settings label {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--canvas-text-muted);
}
.image-node-settings :deep(.themed-select-trigger) {
  min-width: 0;
}
.image-node-error {
  margin: 8px 0 0;
  color: #fa8585;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.is-compact .image-node-toolbar-options {
  display: contents;
}
.is-compact .image-node-model {
  flex: 1 1 calc(100% - 36px);
  min-width: 0;
  max-width: none;
}
.is-compact .image-node-divider {
  display: none;
}
.is-compact .image-node-toolbar-options > .image-node-icon {
  order: 1;
}
.is-compact .image-node-summary {
  order: 2;
  flex: 1 1 0;
  height: 36px;
}
.is-compact .image-node-summary span {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  line-height: 1.4;
}
.is-compact .image-node-summary-parts {
  display: flex;
  flex-wrap: wrap;
}
.is-compact .image-node-summary span.image-node-summary-part {
  white-space: nowrap;
}
.is-compact .image-node-toolbar-actions {
  order: 3;
}
.is-compact .image-node-popover {
  bottom: 88px;
}
</style>

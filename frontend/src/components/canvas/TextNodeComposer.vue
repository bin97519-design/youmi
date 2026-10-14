<script setup>
import { computed, ref } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { textNodeRequestError } from '../../utils/textNodeDraft.js'

const props = defineProps({
  draft: { type: Object, required: true },
  text: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  canvasReferences: { type: Array, default: () => [] },
  editorWidth: { type: Number, default: 560 },
  busy: Boolean,
  error: { type: String, default: '' },
  referenceError: { type: String, default: '' },
})
const emit = defineEmits([
  'update:draft',
  'generate',
  'cancel',
  'apply-result',
  'discard-result',
  'video',
])
const promptInput = ref(null)
const referencesOpen = ref(false)
const expanded = ref(false)
const validation = computed(
  () =>
    props.referenceError ||
    (props.draft.prompt.trim() ? textNodeRequestError(props.draft, props.text) : ''),
)
const options = computed(() => {
  const records = props.modelOptions.map((item) => ({
    ...item,
    disabled: item.configured === false,
  }))
  return records.some((item) => item.value === props.draft.model)
    ? records
    : [
        {
          value: props.draft.model,
          label: `${props.draft.model || '模型'} · 当前不可用`,
          disabled: true,
        },
        ...records,
      ]
})
const unavailable = computed(
  () =>
    !props.modelOptions.some(
      (item) => item.value === props.draft.model && item.configured !== false,
    ),
)
function update(patch) {
  if (!props.busy) emit('update:draft', { ...props.draft, ...patch })
}
function addReference(item) {
  if (props.busy) return
  update({ references: [...props.draft.references, item] })
  referencesOpen.value = false
}
</script>

<template>
  <section
    class="text-node-composer canvas-node-composer"
    :style="{ width: `${editorWidth}px` }"
    :class="{ 'is-expanded': expanded }"
    aria-label="文本节点编辑器"
    :aria-busy="busy"
    @pointerdown.stop
    @click.stop
    @dblclick.stop
    @wheel.stop
    @keydown.stop
    @keydown.esc="referencesOpen = false"
  >
    <div v-if="draft.references.length" class="text-node-reference-row">
      <div
        v-for="(reference, index) in draft.references"
        :key="`${reference.kind}-${reference.layerId || index}`"
        class="text-node-reference"
        :title="reference.kind === 'text' ? `${reference.name}\n${reference.text}` : reference.name"
        :aria-label="`文本节点参考 ${reference.name}`"
      >
        <img
          v-if="reference.kind === 'image'"
          :src="reference.thumbnailUrl || reference.url"
          :alt="reference.name"
        />
        <i v-else class="ri-text" aria-hidden="true"></i>
        <button
          type="button"
          :disabled="busy"
          :title="`移除参考 ${reference.name}`"
          :aria-label="`移除文本节点参考 ${reference.name}`"
          @click="update({ references: draft.references.filter((_, at) => at !== index) })"
        >
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <button
      class="text-node-icon text-node-expand canvas-node-expand"
      type="button"
      :title="expanded ? '收起输入框' : '展开输入框'"
      :aria-label="expanded ? '收起文本输入框' : '展开文本输入框'"
      :aria-pressed="expanded"
      @click="expanded = !expanded"
    >
      <i
        :class="expanded ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"
        aria-hidden="true"
      ></i>
    </button>
    <div v-if="referencesOpen" class="text-node-reference-picker" aria-label="文本参考素材">
      <button
        v-for="item in canvasReferences"
        :key="`${item.kind}-${item.layerId}`"
        type="button"
        :title="item.name"
        :aria-label="`选择文本参考 ${item.name}`"
        :disabled="
          busy ||
          draft.references.some(
            (reference) => reference.kind === item.kind && reference.layerId === item.layerId,
          )
        "
        @click="addReference(item)"
      >
        <img v-if="item.kind === 'image'" :src="item.thumbnailUrl || item.url" :alt="item.name" />
        <i v-else class="ri-text" aria-hidden="true"></i>
        <span>{{ item.name }}</span>
      </button>
      <span v-if="!canvasReferences.length">暂无参考素材</span>
    </div>
    <textarea
      ref="promptInput"
      :value="draft.prompt"
      :disabled="busy"
      maxlength="4000"
      rows="3"
      aria-label="文本节点要求"
      placeholder="输入文本内容或需要修改的地方"
      @focus="referencesOpen = false"
      @input="update({ prompt: $event.target.value })"
      @keydown.ctrl.enter.prevent="
        !busy && !unavailable && draft.prompt.trim() && !validation && emit('generate')
      "
      @keydown.meta.enter.prevent="
        !busy && !unavailable && draft.prompt.trim() && !validation && emit('generate')
      "
    ></textarea>
    <div v-if="draft.pendingResult" class="text-node-pending-result">
      <strong>新结果待确认</strong>
      <pre>{{ draft.pendingResult }}</pre>
      <div>
        <button type="button" :disabled="busy" @click="emit('discard-result')">
          <i class="ri-close-line" aria-hidden="true"></i>
          保留原文
        </button>
        <button type="button" :disabled="busy" @click="emit('apply-result')">
          <i class="ri-check-line" aria-hidden="true"></i>
          采用新结果
        </button>
      </div>
    </div>
    <footer class="text-node-toolbar">
      <ThemedSelect
        floating
        :menu-min-width="180"
        :model-value="draft.model"
        :options="options"
        :disabled="busy"
        aria-label="文本节点模型"
        @update:model-value="update({ model: $event })"
      />
      <button
        class="text-node-icon text-node-add"
        type="button"
        title="添加参考素材"
        aria-label="添加文本参考素材"
        :aria-expanded="referencesOpen"
        :disabled="busy"
        @click="referencesOpen = !referencesOpen"
      >
        <i class="ri-add-line" aria-hidden="true"></i>
      </button>
      <span v-if="busy" class="text-node-status" role="status">生成中</span>
      <button
        v-if="text.trim()"
        class="text-node-icon"
        type="button"
        title="文生视频"
        aria-label="文生视频"
        :disabled="busy || !!draft.pendingResult"
        @click="emit('video')"
      >
        <i class="ri-video-ai-line" aria-hidden="true"></i>
      </button>
      <button
        v-if="busy"
        class="text-node-icon text-node-submit"
        type="button"
        title="停止等待"
        aria-label="停止文本生成等待"
        @click="emit('cancel')"
      >
        <i class="ri-stop-fill" aria-hidden="true"></i>
      </button>
      <button
        v-else
        class="text-node-icon text-node-submit"
        type="button"
        :disabled="!draft.prompt.trim() || !!validation || unavailable || !!draft.pendingResult"
        :title="text ? '修改文本' : '生成文本'"
        aria-label="生成文本"
        @click="emit('generate')"
      >
        <i class="ri-arrow-up-line" aria-hidden="true"></i>
      </button>
    </footer>
    <p v-if="validation || error || unavailable" class="text-node-error" role="alert">
      {{ validation || error || '所选模型当前不可用，请重新选择' }}
    </p>
  </section>
</template>

<style scoped>
.text-node-composer {
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
.text-node-composer button,
.text-node-composer textarea {
  font: inherit;
  color: inherit;
}
.text-node-composer button {
  cursor: pointer;
}
.text-node-composer button:disabled {
  opacity: 0.5;
  cursor: default;
}
.text-node-composer button:focus-visible,
.text-node-composer textarea:focus-visible {
  outline: 2px solid var(--canvas-accent, #18bed0);
  outline-offset: 2px;
}
.text-node-reference-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 36px;
  margin-bottom: 12px;
  padding-right: 32px;
}
.text-node-icon {
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
  font-size: 18px !important;
}
.text-node-focus,
.text-node-add {
  background: #ffffff0c;
  border: 1px solid var(--canvas-border);
}
.text-node-icon:hover:not(:disabled) {
  background: var(--canvas-accent-soft, #18bed012);
}
.text-node-expand {
  position: absolute;
  top: 6px;
  right: 6px;
  color: var(--canvas-text-muted, #999ba3) !important;
}
.text-node-reference {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  color: var(--canvas-accent, #18bed0);
  background: var(--canvas-accent-soft, #18bed012);
  border-radius: 4px;
  font-size: 20px;
}
.text-node-reference img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  max-width: 36px;
  max-height: 36px;
  object-fit: cover;
  border-radius: 4px;
}
.text-node-reference > button {
  position: absolute;
  top: -3px;
  right: -3px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #fff;
  background: #44464d;
  font-size: 12px;
}
.text-node-composer textarea {
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
  overflow-wrap: anywhere;
}
.text-node-composer.is-expanded textarea {
  min-height: 220px;
}
.text-node-composer textarea::placeholder,
.text-node-status {
  color: var(--canvas-text-muted, #999ba3);
}
.text-node-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
}
.text-node-toolbar > :deep(.themed-select) {
  width: auto;
  min-width: 0;
  max-width: calc(100% - 96px);
}
.text-node-toolbar :deep(.themed-select-trigger) {
  border: 0;
  background: transparent;
  min-height: 32px;
  padding: 4px 0;
  font-size: 12px;
}
.text-node-status {
  margin-left: auto;
  font-size: 12px;
}
.text-node-submit {
  margin-left: auto;
  color: #fff !important;
  background: var(--canvas-accent, #18bed0);
  border-radius: 50%;
}
.text-node-submit:hover:not(:disabled) {
  filter: brightness(1.1);
  background: var(--canvas-accent, #18bed0);
}
.text-node-reference-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  margin: 10px 0;
  padding: 8px;
  background: var(--canvas-bg);
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
}
.text-node-reference-picker > button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  font-size: 12px;
}
.text-node-reference-picker img,
.text-node-reference-picker i {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
}
.text-node-reference-picker i {
  display: grid;
  place-items: center;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-size: 20px;
}
.text-node-reference-picker span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.text-node-pending-result {
  display: grid;
  gap: 8px;
  margin: 10px 0;
  padding-top: 10px;
  border-top: 1px solid var(--canvas-border);
}
.text-node-pending-result strong {
  font-size: 12px;
}
.text-node-pending-result pre {
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  font: inherit;
  font-size: 13px;
}
.text-node-pending-result > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.text-node-pending-result button {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  padding: 6px 10px;
  color: var(--canvas-text);
  background: var(--canvas-accent-soft);
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  font-size: 12px;
}
.text-node-error {
  margin: 8px 0 0;
  color: #edb46f;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
:global([data-theme='light']) .text-node-error {
  color: #a04812;
}
</style>

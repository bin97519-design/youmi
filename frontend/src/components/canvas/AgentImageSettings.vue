<script setup>
import { computed } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { totalAgentGenerationCount } from '../../utils/agentDraft.js'

const props = defineProps({
  modelValue: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  ratioOptions: { type: Array, default: () => [] },
  resolutionOptions: { type: Array, default: () => ['1K', '2K', '4K'] },
  references: { type: Array, default: () => [] },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue', 'remove-reference'])
const ratios = computed(() => props.ratioOptions.map((value) => ({
  value, label: value === 'auto' ? '自适应' : value,
})))
const resolutions = computed(() => props.resolutionOptions.map((value) => ({ value, label: value })))
const quantities = [1, 2, 3, 4].map((value) => ({ value, label: `${value} 张` }))
const totalCount = computed(() => totalAgentGenerationCount(props.modelValue.models, props.modelValue.count))

function change(key, value) {
  if (props.disabled) return
  const next = { ...props.modelValue, [key]: value }
  if (key === 'models') next.model = value[0]
  emit('update:modelValue', next)
}
</script>

<template>
  <fieldset class="agent-image-settings" :disabled="disabled" aria-label="图片方案参数">
    <div class="agent-image-model agent-image-field">
      <span>图片模型（可多选）</span>
      <ThemedSelect
        floating multiple :menu-min-width="220"
        aria-label="图片模型"
        :model-value="modelValue.models"
        :options="modelOptions"
        :disabled="disabled"
        @update:model-value="change('models', $event)"
      />
    </div>
    <div class="agent-image-field">
      <span>比例</span>
      <ThemedSelect
        floating aria-label="图片比例"
        :model-value="modelValue.ratio" :options="ratios" :disabled="disabled"
        @update:model-value="change('ratio', $event)"
      />
    </div>
    <div class="agent-image-field">
      <span>清晰度</span>
      <ThemedSelect
        floating aria-label="图片清晰度"
        :model-value="modelValue.resolution" :options="resolutions" :disabled="disabled"
        @update:model-value="change('resolution', $event)"
      />
    </div>
    <div class="agent-image-field">
      <span>{{ modelValue.models.length > 1 ? '每模型数量' : '数量' }}</span>
      <ThemedSelect
        floating aria-label="图片数量"
        :model-value="modelValue.count" :options="quantities" :disabled="disabled"
        @update:model-value="change('count', Number($event))"
      />
    </div>
    <div class="agent-image-references" aria-label="生图参考图">
      <span>参考图 {{ references.length }} 张</span>
      <div v-if="references.length" class="agent-image-reference-list">
        <figure v-for="(reference, index) in references" :key="reference.url">
          <img :src="reference.url" :alt="`生图参考图 ${index + 1}`" />
          <figcaption>图{{ index + 1 }}</figcaption>
          <button
            type="button" :disabled="disabled"
            :aria-label="`移除生图参考图 ${index + 1}`" :title="`移除图${index + 1}`"
            @click="emit('remove-reference', index)"
          >
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </figure>
      </div>
      <small v-else>未选择参考图，将按文字生成</small>
    </div>
    <output class="agent-image-total" aria-label="图片生成总数">
      共 {{ totalCount }} 张 · 按实际用量结算
    </output>
  </fieldset>
</template>

<style scoped>
.agent-image-settings {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  border-top: 1px solid var(--canvas-border, #3c3e43);
}
.agent-image-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.agent-image-model,
.agent-image-references,
.agent-image-total {
  grid-column: 1 / -1;
}
.agent-image-field > span,
.agent-image-references > span,
.agent-image-references > small,
.agent-image-total {
  color: var(--canvas-text-muted, #9b9da3);
  font-size: 11px;
  line-height: 1.5;
}
.agent-image-settings :deep(.themed-select-trigger) {
  height: 38px;
  padding: 0 7px;
  border-radius: 9px;
  font: inherit;
  font-size: 12px;
}
.agent-image-references {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-image-reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.agent-image-reference-list figure {
  position: relative;
  width: 60px;
  margin: 0;
  border: 1px solid var(--canvas-border, #3c3e43);
  border-radius: 6px;
  background: var(--canvas-input, #191b20);
}
.agent-image-reference-list img {
  display: block;
  width: 100%;
  height: 60px;
  border-radius: 5px 5px 0 0;
  object-fit: contain;
}
.agent-image-reference-list figcaption {
  padding: 2px 4px;
  color: var(--canvas-text-muted, #9b9da3);
  font-size: 10px;
  text-align: center;
}
.agent-image-reference-list button {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--canvas-border, #3c3e43);
  border-radius: 50%;
  background: var(--canvas-panel, #232428);
  color: var(--canvas-text-muted, #9b9da3);
  cursor: pointer;
}
.agent-image-reference-list button:disabled {
  opacity: 0.5;
  cursor: default;
}
.agent-image-reference-list button:focus-visible {
  outline: 2px solid var(--canvas-accent, #19bfd3);
  outline-offset: 2px;
}
</style>

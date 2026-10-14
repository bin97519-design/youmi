<script setup>
defineProps({
  modelValue: { type: String, required: true },
  options: { type: Array, required: true },
  label: { type: String, default: '比例' },
  columns: { type: Number, default: 7 },
  disabled: Boolean,
  disabledTitle: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
function ratioShape(value) {
  const [width, height] = value.split(':').map(Number)
  return width && height
    ? {
        width: `${Math.round(25 * Math.min(1, width / height))}px`,
        height: `${Math.round(25 * Math.min(1, height / width))}px`,
      }
    : {}
}
</script>

<template>
  <div
    class="canvas-ratio-picker"
    :style="{ '--ratio-columns': columns }"
    role="group"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="{ active: modelValue === option.value }"
      :aria-label="`${label} ${option.label}`"
      :aria-pressed="modelValue === option.value"
      :disabled="disabled"
      :title="disabled && disabledTitle ? disabledTitle : option.label"
      @click="emit('update:modelValue', option.value)"
    >
      <span class="canvas-ratio-preview" aria-hidden="true">
        <i v-if="['auto', 'adaptive'].includes(option.value)" class="ri-focus-3-line"></i>
        <b v-else :style="ratioShape(option.value)"></b>
      </span>
      <span>{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.canvas-ratio-picker {
  display: grid;
  grid-template-columns: repeat(var(--ratio-columns, 7), minmax(0, 1fr));
  gap: 4px;
}
.canvas-ratio-picker button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  height: 62px;
  padding: 4px 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--canvas-surface-hover);
  color: var(--canvas-text-muted);
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  cursor: pointer;
}
.canvas-ratio-preview {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
}
.canvas-ratio-preview b {
  display: block;
  box-sizing: border-box;
  border: 1px solid currentColor;
  border-radius: 2px;
}
.canvas-ratio-preview i {
  font-size: 23px;
  line-height: 1;
}
.canvas-ratio-picker button.active {
  border-color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  color: var(--canvas-accent);
}
.canvas-ratio-picker button:hover:not(:disabled) {
  border-color: var(--canvas-accent-border);
  color: var(--canvas-accent);
}
.canvas-ratio-picker button:disabled {
  opacity: 0.65;
  cursor: default;
}
.canvas-ratio-picker button:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
@media (max-width: 480px) {
  .canvas-ratio-picker {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>

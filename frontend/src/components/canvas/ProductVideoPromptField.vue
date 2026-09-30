<script setup>
import { computed } from 'vue'
import { normalizePromptLineBreaks } from '../../utils/productVideo'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, required: true },
  kind: { type: String, required: true },
  maxLength: { type: Number, required: true },
})
defineEmits(['update:modelValue', 'copy', 'expand'])
const displayValue = computed(() => normalizePromptLineBreaks(props.modelValue))
</script>

<template>
  <div class="pv-prompt-field">
    <div class="pv-prompt-heading">
      <strong>{{ label }}</strong>
      <small>{{ kind }}</small>
      <div class="pv-prompt-tools">
        <button
          class="pv-icon"
          :title="`复制${label}`"
          :aria-label="`复制${label}`"
          :disabled="!modelValue.trim()"
          @click="$emit('copy')"
        >
          <i aria-hidden="true" class="ri-file-copy-line"></i>
        </button>
        <button
          class="pv-icon"
          :title="`放大编辑${label}`"
          :aria-label="`放大编辑${label}`"
          @click="$emit('expand', $event.currentTarget)"
        >
          <i aria-hidden="true" class="ri-fullscreen-line"></i>
        </button>
      </div>
    </div>
    <textarea
      :value="displayValue"
      :aria-label="label"
      :maxlength="maxLength"
      spellcheck="false"
      @input="$emit('update:modelValue', $event.target.value)"
    ></textarea>
    <div class="pv-prompt-count">{{ displayValue.length }} / {{ maxLength }}</div>
  </div>
</template>

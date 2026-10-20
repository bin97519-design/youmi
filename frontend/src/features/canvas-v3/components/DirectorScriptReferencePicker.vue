<script setup>
import { computed } from 'vue'
import { DIRECTOR_REFERENCE_IMAGE_LIMIT } from '../config/directorClarifications.js'

const props = defineProps({
  images: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:selectedIds'])
const images = computed(() => {
  const seen = new Set()
  return props.images.filter((image) => {
    const id = referenceId(image)
    if (!id || seen.has(id) || !image?.url || (image.status && image.status !== 'ready'))
      return false
    seen.add(id)
    return true
  })
})
const selectedIds = computed(() => {
  const availableIds = new Set(images.value.map(referenceId))
  return [...new Set(props.selectedIds)].filter((id) => availableIds.has(id))
})
const limitReached = computed(() => selectedIds.value.length >= DIRECTOR_REFERENCE_IMAGE_LIMIT)

function referenceId(image) {
  return String(image?.layerId || image?.id || '').trim()
}

function roleLabel(image) {
  if (image.referenceRole === 'product') return '商品参考'
  if (image.referenceRole === 'style') return '风格参考'
  return '用途待核对'
}

function toggle(image, checked) {
  if (props.disabled) return
  const id = referenceId(image)
  if (!images.value.some((item) => referenceId(item) === id)) return
  const selected = selectedIds.value.includes(id)
  if (checked === selected || (checked && limitReached.value)) return
  emit(
    'update:selectedIds',
    checked ? [...selectedIds.value, id] : selectedIds.value.filter((value) => value !== id),
  )
}
</script>

<template>
  <fieldset class="cv3-director-script-references" :disabled="disabled">
    <legend>历史商品图（仅供选择，尚未用于本次任务）</legend>
    <p v-if="!images.length" class="cv3-director-script-reference-hint" role="status">
      没有可沿用的历史图片，请选择上传商品图或仅根据文字策划。
    </p>
    <div v-else class="cv3-director-script-reference-list">
      <label
        v-for="image in images"
        :key="referenceId(image)"
        class="cv3-director-script-reference"
        :class="{ 'is-selected': selectedIds.includes(referenceId(image)) }"
      >
        <input
          type="checkbox"
          :value="referenceId(image)"
          :checked="selectedIds.includes(referenceId(image))"
          :disabled="disabled || (limitReached && !selectedIds.includes(referenceId(image)))"
          :aria-label="`沿用 ${image.name || '未命名图片'}`"
          @change="toggle(image, $event.target.checked)"
        />
        <img :src="image.url" alt="" width="40" height="40" loading="lazy" />
        <span class="cv3-director-script-reference-description">
          <span class="cv3-director-script-reference-name">{{ image.name || '未命名图片' }}</span>
          <span class="cv3-director-script-reference-role">{{ roleLabel(image) }}</span>
        </span>
      </label>
    </div>
    <p v-if="images.length" class="cv3-director-script-reference-hint" role="status">
      <span>已选择 {{ selectedIds.length }}/{{ DIRECTOR_REFERENCE_IMAGE_LIMIT }} 张。</span>
      请确认商品与本次任务一致，图片用途及卖点仍需核对。
    </p>
  </fieldset>
</template>

<style scoped>
.cv3-director-script-references {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  color: #d8d8d8;
  font-size: 12px;
  line-height: 18px;
}
.cv3-director-script-references legend {
  margin-bottom: 8px;
  padding: 0;
}
.cv3-director-script-reference-list {
  display: grid;
  gap: 6px;
}
.cv3-director-script-reference {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 6px 8px;
  border: 1px solid #383838;
  border-radius: 8px;
  background: #1d1d1d;
  cursor: pointer;
}
.cv3-director-script-reference:hover {
  background: #262626;
}
.cv3-director-script-reference.is-selected {
  border-color: #777;
  background: #292929;
}
.cv3-director-script-reference:focus-within {
  outline: 1px solid #b4b4b4;
  outline-offset: 2px;
}
.cv3-director-script-reference input {
  flex: 0 0 auto;
  margin: 0;
  accent-color: #e2e2e2;
}
.cv3-director-script-reference img {
  flex: 0 0 40px;
  border-radius: 5px;
  object-fit: cover;
  background: #303030;
}
.cv3-director-script-reference-description {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.cv3-director-script-reference-name {
  overflow-wrap: anywhere;
}
.cv3-director-script-reference-role,
.cv3-director-script-reference-hint {
  color: #999;
}
.cv3-director-script-reference-hint {
  margin: 8px 0 0;
}
.cv3-director-script-references:disabled {
  opacity: 0.55;
}
.cv3-director-script-references:disabled label,
.cv3-director-script-reference:has(input:disabled) {
  cursor: default;
}
</style>

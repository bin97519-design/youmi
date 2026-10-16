<script setup>
import CanvasIcon from './CanvasIcon.vue'
import { IMAGE_SHORTCUT_COLUMNS } from '../config/imageShortcuts'

defineProps({ selected: { type: String, default: '' } })
const emit = defineEmits(['select'])
</script>

<template>
  <div class="cv3-shortcut-columns">
    <div v-for="(column, i) in IMAGE_SHORTCUT_COLUMNS" :key="i" class="cv3-shortcut-column">
      <section v-for="group in column" :key="group.label" :aria-label="group.label">
        <h3>{{ group.label }}</h3>
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="cv3-shortcut-option"
          :class="{ selected: selected === item.id }"
          :aria-pressed="selected === item.id"
          :aria-label="item.label"
          @click="emit('select', item.id)"
        >
          <span class="cv3-shortcut-icon">
            <CanvasIcon :name="item.icon" :size="16" />
            <i v-if="item.isNew" class="cv3-shortcut-new" aria-hidden="true" />
          </span>
          <span class="cv3-shortcut-copy">
            <strong>{{ item.label }}</strong>
            <small v-if="item.description">{{ item.description }}</small>
          </span>
        </button>
      </section>
    </div>
  </div>
</template>

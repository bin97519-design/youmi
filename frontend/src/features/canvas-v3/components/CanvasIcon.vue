<script setup>
import { computed } from 'vue'
import { CANVAS_ICONS } from '../config/icons'
import { REFERENCE_ICONS } from '../config/referenceIcons'
import { REFERENCE_SHORTCUT_ICONS } from '../config/referenceShortcutIcons'
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
})
const icon = computed(
  () =>
    REFERENCE_SHORTCUT_ICONS[props.name] ||
    REFERENCE_ICONS[props.name] ||
    CANVAS_ICONS[props.name] ||
    CANVAS_ICONS.image,
)
// The markup below comes only from our static local SVG registry, never node data or user input.
</script>

<template>
  <!-- eslint-disable vue/no-v-html -->
  <svg
    class="cv3-icon"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    :viewBox="icon.viewBox"
    aria-hidden="true"
    focusable="false"
    v-html="icon.body"
  />
</template>

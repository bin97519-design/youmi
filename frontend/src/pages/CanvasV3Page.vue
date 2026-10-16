<script setup>
import CanvasV3Shell from '../features/canvas-v3/components/CanvasV3Shell.vue'

defineProps({
  id: { type: String, required: true },
})
</script>

<template>
  <CanvasV3Shell :key="id" :project-id="id" />
</template>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/controls/dist/style.css';
@import '@vue-flow/minimap/dist/style.css';
@import '../features/canvas-v3/canvas-v3.css';
</style>

<script setup>
import CanvasIcon from './CanvasIcon.vue'
defineProps({
  panelOpen: Boolean,
  tool: { type: String, default: 'select' },
  activePanel: { type: String, default: '' },
})
defineEmits(['open-library', 'tool', 'panel'])
</script>

<template>
  <div class="cv3-bottom-tools" role="toolbar" aria-label="画布工具栏">
    <button
      type="button"
      class="cv3-tool-button cv3-tool-button--primary"
      :class="{ active: panelOpen }"
      title="添加节点"
      aria-label="添加节点"
      :aria-expanded="panelOpen"
      @click="$emit('open-library')"
    >
      <CanvasIcon name="plus" />
    </button>
    <button
      type="button"
      class="cv3-tool-button"
      :class="{ active: tool === 'hand' }"
      title="移动"
      aria-label="移动"
      :aria-pressed="tool === 'hand'"
      @click="$emit('tool', tool === 'hand' ? 'select' : 'hand')"
    >
      <CanvasIcon name="move" />
    </button>
    <button
      type="button"
      class="cv3-tool-button"
      :class="{ active: activePanel === 'assets' }"
      title="素材库"
      aria-label="素材库"
      @click="$emit('panel', 'assets')"
    >
      <CanvasIcon name="materials" />
    </button>
    <button
      type="button"
      class="cv3-tool-button"
      :class="{ active: activePanel === 'characters' }"
      title="模特造型室"
      aria-label="模特造型室"
      @click="$emit('panel', 'characters')"
    >
      <CanvasIcon name="character" />
      <span class="cv3-tool-notice" />
    </button>
    <button
      type="button"
      class="cv3-tool-button"
      :class="{ active: activePanel === 'history' }"
      title="生成历史"
      aria-label="生成历史"
      @click="$emit('panel', 'history')"
    >
      <CanvasIcon name="history" />
    </button>
    <span class="cv3-tool-divider" />
    <button
      type="button"
      class="cv3-tool-button"
      title="快捷键"
      aria-label="快捷键"
      @click="$emit('panel', 'shortcuts')"
    >
      <CanvasIcon name="keyboard" />
    </button>
    <button
      type="button"
      class="cv3-tool-button"
      title="教程"
      aria-label="教程"
      @click="$emit('panel', 'help')"
    >
      <CanvasIcon name="help" />
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({ kind: { type: String, required: true }, disabled: Boolean })
const emit = defineEmits(['action'])
const definitions = {
  text: {
    icon: 'ri-text',
    actions: [
      ['write', 'ri-edit-line', '自己编写内容'],
      ['generate', 'ri-sparkling-line', 'AI 编写文本'],
      ['video', 'ri-video-ai-line', '文生视频'],
      ['reference', 'ri-image-ai-line', '参考图写文本'],
    ],
  },
  image: {
    icon: 'ri-image-line',
    actions: [
      ['generate', 'ri-image-ai-line', '文生图片'],
      ['reference', 'ri-image-add-line', '参考图生图'],
      ['upload', 'ri-upload-2-line', '上传图片'],
    ],
  },
  video: {
    icon: 'ri-video-line',
    actions: [
      ['generate', 'ri-video-ai-line', '文生视频'],
      ['reference', 'ri-image-add-line', '参考素材生视频'],
      ['upload', 'ri-upload-2-line', '上传视频'],
    ],
  },
}
const state = computed(() => definitions[props.kind] || definitions.text)
</script>
<template>
  <div
    class="canvas-node-empty-state"
    :aria-label="`空${{ text: '文本', image: '图片', video: '视频' }[kind]}节点`"
  >
    <i :class="state.icon" class="canvas-node-empty-icon" aria-hidden="true"></i>
    <div class="canvas-node-empty-actions">
      <button
        v-for="[action, icon, label] in state.actions"
        :key="action"
        type="button"
        :disabled="disabled"
        @pointerdown.stop
        @dblclick.stop
        @click.stop="emit('action', action)"
      >
        <i :class="icon" aria-hidden="true"></i>
        <span>{{ label }}</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.canvas-node-empty-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 32px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  color: var(--canvas-text);
}
.canvas-node-empty-icon {
  color: var(--canvas-text-subtle);
  font-size: 56px;
  line-height: 1;
  opacity: 0.55;
}
.canvas-node-empty-actions {
  display: grid;
  gap: 8px;
  width: min(100%, 240px);
}
.canvas-node-empty-actions button {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 7px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}
.canvas-node-empty-actions button i {
  flex: 0 0 20px;
  font-size: 20px;
}
.canvas-node-empty-actions button span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.canvas-node-empty-actions button:hover:not(:disabled),
.canvas-node-empty-actions button:focus-visible {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  outline: none;
}
.canvas-node-empty-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>

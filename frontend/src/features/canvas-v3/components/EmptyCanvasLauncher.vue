<script setup>
import { NODE_SPECS } from '../config/nodeSpecs'
import CanvasIcon from './CanvasIcon.vue'

defineEmits(['add', 'open-library'])

const quickKinds = ['image', 'video', 'audio', 'script', 'smartEdit']
const quickNodes = quickKinds.map((kind) => ({
  ...NODE_SPECS[kind],
  label: kind === 'script' ? '剧本生成' : NODE_SPECS[kind].title,
}))
</script>

<template>
  <div class="cv3-empty-launcher" @dblclick.stop="$emit('open-library')">
    <button class="cv3-empty-hint" type="button" @click="$emit('open-library')">
      <span class="cv3-hint-cursor" aria-hidden="true">
        <span />
        <svg width="22" height="26" viewBox="0 0 22 26">
          <path fill="#eee" stroke="#161616" stroke-width="1.2" d="m3 2 16 10-7 2-3 8z" />
        </svg>
      </span>
      <span>双击画布&nbsp; 自由生成节点</span>
    </button>
    <div class="cv3-quick-launchers">
      <button
        v-for="spec in quickNodes"
        :key="spec.kind"
        type="button"
        @click="$emit('add', spec.kind)"
      >
        <span><CanvasIcon :name="spec.kind" /></span>
        <strong>{{ spec.label }}</strong>
      </button>
    </div>
  </div>
</template>

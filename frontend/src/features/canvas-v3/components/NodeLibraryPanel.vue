<script setup>
import { computed, ref } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
const props = defineProps({
  position: { type: Object, default: null },
  referenceMode: Boolean,
})
const emit = defineEmits(['add', 'panel'])
const search = ref('')
const items = [
  { kind: 'text', label: '文本' },
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'smartEdit', label: '智能剪辑', badge: 'Beta' },
  { kind: 'audio', label: '音频' },
  { kind: 'script', label: '脚本', badge: 'New' },
  { kind: 'reference', label: '备忘文本' },
]
const referenceItems = [
  { kind: 'text', label: '文本' },
  { kind: 'image', label: '图片' },
  { kind: 'video', label: '视频' },
  { kind: 'smartEdit', label: '智能剪辑', badge: 'Beta' },
  { kind: 'director', label: '导演台', badge: 'New', disabled: true },
  { kind: 'frameAnalysis', label: '逐帧拉片', badge: 'SD 2.5', disabled: true },
  { kind: 'audio', label: '音频' },
  { kind: 'script', label: '脚本', suffix: true },
  { kind: 'reference', label: '参考节点', disabled: true },
]
const filtered = computed(() =>
  (props.referenceMode ? referenceItems : items).filter((item) =>
    item.label.includes(search.value.trim()),
  ),
)
</script>

<template>
  <aside
    class="cv3-library-panel"
    :style="
      position
        ? { left: position.x + 'px', top: position.y + 'px', bottom: 'auto', transform: 'none' }
        : {}
    "
    :aria-label="referenceMode ? '引用该节点生成' : '添加节点菜单'"
  >
    <header v-if="referenceMode" class="cv3-library-title">引用该节点生成</header>
    <label v-else class="cv3-library-search">
      <input v-model="search" placeholder="添加节点" aria-label="搜索节点" />
      <CanvasIcon name="search" :size="16" />
    </label>
    <button
      v-for="item in filtered"
      :key="item.kind"
      type="button"
      class="cv3-library-row"
      :disabled="item.disabled"
      @click="emit('add', item.kind)"
    >
      <i v-if="item.icon" :class="item.icon" />
      <CanvasIcon v-else :name="item.kind === 'reference' ? 'text' : item.kind" :size="20" />
      <span>{{ item.label }}</span>
      <small v-if="item.badge" :class="{ 'is-new': item.badge === 'New' }">{{ item.badge }}</small>
      <i v-if="item.suffix" class="ri-arrow-right-s-line" />
    </button>
    <button
      v-if="!referenceMode"
      type="button"
      class="cv3-library-row"
      @click="emit('panel', 'assets')"
    >
      <CanvasIcon name="materials" :size="20" />
      <span>素材库</span>
      <i class="ri-arrow-right-s-line" />
    </button>
    <div v-if="!referenceMode" class="cv3-library-separator">添加资源</div>
    <button
      v-if="!referenceMode"
      type="button"
      class="cv3-library-row"
      @click="emit('panel', 'assets')"
    >
      <CanvasIcon name="upload" :size="20" />
      <span>上传</span>
    </button>
    <button
      v-if="!referenceMode"
      type="button"
      class="cv3-library-row"
      @click="emit('panel', 'history')"
    >
      <CanvasIcon name="history" :size="20" />
      <span>从生成历史选择</span>
    </button>
  </aside>
</template>

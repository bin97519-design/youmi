<script setup>
import { ref } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
defineProps({
  title: { type: String, default: '未命名工作区' },
  saveStatus: { type: String, default: 'saved' },
  mode: { type: String, default: 'workflow' },
})
defineEmits(['back', 'update:title', 'new', 'demo', 'export', 'mode', 'panel'])
const menu = ref('')
</script>

<template>
  <div class="cv3-top-chrome">
    <div class="cv3-top-chrome__left">
      <div class="cv3-project-controls">
        <button
          class="cv3-logo-button"
          type="button"
          title="工作区菜单"
          aria-label="工作区菜单"
          @click="menu = menu === 'project' ? '' : 'project'"
        >
          <span class="cv3-logo-glyph" />
          <CanvasIcon name="chevron" :size="10" />
        </button>
        <div
          class="cv3-project-pill"
          :title="saveStatus === 'saving' ? '正在保存' : '已保存到本地'"
        >
          <input
            :value="title"
            aria-label="项目名称"
            @input="$emit('update:title', $event.target.value)"
            @keydown.enter="$event.target.blur()"
          />
        </div>
        <button
          class="cv3-canvas-pill"
          type="button"
          @click="menu = menu === 'canvas' ? '' : 'canvas'"
        >
          画布 1
          <CanvasIcon name="chevron" :size="12" />
        </button>
      </div>
      <div class="cv3-view-switch">
        <button
          class="cv3-floating-icon"
          :class="{ active: mode === 'workflow' }"
          type="button"
          title="工作流"
          aria-label="工作流"
          @click="$emit('mode', 'workflow')"
        >
          <CanvasIcon name="workflow" :size="16" />
        </button>
        <button
          class="cv3-floating-icon"
          :class="{ active: mode === 'storyboard' }"
          type="button"
          title="故事板"
          aria-label="故事板"
          @click="$emit('mode', 'storyboard')"
        >
          <CanvasIcon name="storyboard" :size="16" />
        </button>
      </div>
      <div v-if="menu" class="cv3-chrome-menu" role="menu" @click="menu = ''">
        <button v-if="menu === 'project'" type="button" @click="$emit('back')">
          <CanvasIcon name="assets" :size="16" />
          返回画布列表
        </button>
        <button type="button" @click="$emit('new')">
          <CanvasIcon name="plus" :size="16" />
          新建空白画布
        </button>
        <button type="button" @click="$emit('demo')">
          <CanvasIcon name="workflow" :size="16" />
          打开演示工作流
        </button>
        <button type="button" @click="$emit('export')">
          <i class="ri-download-line" />
          导出画布 JSON
        </button>
      </div>
    </div>
    <div class="cv3-top-chrome__right">
      <button
        class="cv3-floating-icon"
        type="button"
        title="发布与分享"
        aria-label="发布与分享"
        @click="$emit('panel', 'share')"
      >
        <CanvasIcon name="share" :size="14" />
      </button>
      <button
        class="cv3-floating-icon cv3-blue-icon"
        type="button"
        title="积分超市"
        aria-label="积分超市"
        @click="$emit('panel', 'points')"
      >
        <CanvasIcon name="credits" :size="16" />
      </button>
      <button class="cv3-member-pill" type="button" @click="$emit('panel', 'points')">
        <CanvasIcon name="diamond" :size="15" />
        <strong>开通会员</strong>
        <span>限时 45 折</span>
      </button>
      <button
        class="cv3-power-pill"
        type="button"
        title="算力余额"
        @click="$emit('panel', 'points')"
      >
        <CanvasIcon name="power" :size="16" />
        <strong>20</strong>
      </button>
      <button
        class="cv3-avatar-button"
        type="button"
        title="个人中心"
        @click="$emit('panel', 'account')"
      >
        <span>Y</span>
        <b />
      </button>
    </div>
  </div>
</template>

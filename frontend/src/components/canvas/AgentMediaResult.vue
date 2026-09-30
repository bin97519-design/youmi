<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  message: { type: Object, required: true },
  selected: Boolean,
})
defineEmits(['adjust'])
const failed = ref(false)
const ready = ref(false)
const isVideo = computed(() => Boolean(props.message.videoUrl))
const label = computed(() => (isVideo.value ? '视频' : '图片'))
const adjustLabel = computed(() => (isVideo.value ? '调整这条视频' : '调整这张图片'))
const icon = computed(() => (isVideo.value ? 'ri-film-line' : 'ri-image-line'))
const duration = computed(
  () => Number(props.message.videoRequest?.duration || props.message.duration) || 0,
)
watch(
  () => props.message.videoUrl || props.message.imageUrl,
  () => {
    failed.value = false
    ready.value = false
  },
)
function loadFrame(event) {
  const video = event.target
  video.pause()
  if (Number.isFinite(video.duration) && video.duration > 0)
    video.currentTime = Math.min(0.1, video.duration / 2)
}
</script>

<template>
  <figure
    class="agent-media-result"
    :class="[isVideo ? 'agent-video-result' : 'agent-image-result', { selected }]"
    :data-message-id="message.id"
  >
    <div class="agent-media-result-frame" role="img" :aria-label="`${label}静态预览`">
      <video
        v-if="isVideo && !failed"
        :key="message.videoUrl"
        :src="message.videoUrl"
        preload="metadata"
        muted
        playsinline
        disablepictureinpicture
        disableremoteplayback
        tabindex="-1"
        aria-hidden="true"
        @loadedmetadata="loadFrame"
        @loadeddata="ready = true"
        @seeked="ready = true"
        @play="$event.target.pause()"
        @error="failed = true"
      />
      <img
        v-else-if="!isVideo && !failed"
        :key="message.imageUrl"
        class="chat-gen-preview-img"
        :src="message.imageUrl"
        alt="生成结果"
        loading="lazy"
        @load="ready = true"
        @error="failed = true"
      />
      <span v-if="failed || !ready" class="agent-media-result-placeholder">
        <i :class="icon" aria-hidden="true"></i>
        {{ failed ? '预览暂不可用' : '正在读取预览' }}
      </span>
    </div>
    <figcaption>
      <span>
        <i :class="icon" aria-hidden="true"></i>
        {{ label }}
        <template v-if="isVideo && duration">· {{ duration }} 秒</template>
      </span>
      <button
        type="button"
        :aria-pressed="selected"
        :title="adjustLabel"
        @click.stop="$emit('adjust')"
      >
        <i class="ri-edit-line" aria-hidden="true"></i>
        {{ selected ? '已关联' : adjustLabel }}
      </button>
    </figcaption>
  </figure>
</template>

<style scoped>
.agent-media-result {
  width: min(100%, 280px);
  margin: 8px 0 0;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface);
}
.agent-media-result.selected {
  border-color: var(--canvas-accent);
}
.agent-media-result-frame {
  position: relative;
  width: 100%;
  height: 208px;
  background: var(--canvas-input);
  overflow: hidden;
}
.agent-media-result video,
.agent-media-result img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.agent-media-result video {
  pointer-events: none;
}
.agent-media-result img {
  cursor: zoom-in;
}
.agent-media-result-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--canvas-text-muted);
  font-size: 12px;
}
.agent-media-result figcaption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px;
  font-size: 12px;
}
.agent-media-result figcaption > span {
  white-space: nowrap;
}
.agent-media-result button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 7px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 4px;
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font: inherit;
  cursor: pointer;
}
</style>

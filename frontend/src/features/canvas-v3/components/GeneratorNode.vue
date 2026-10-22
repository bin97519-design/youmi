<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasV3GraphStore } from '../stores/graph'
import { nodeSpec } from '../config/nodeSpecs'
import { nodeSize } from '../config/nodeControls'
import CanvasIcon from './CanvasIcon.vue'
import GenerationPixelField from './GenerationPixelField.vue'
import VideoNodePlayer from './VideoNodePlayer.vue'
import { useCanvasV3TaskStore } from '../stores/tasks'
import { IMAGE_TASK_ACTIVE_STATES, imageTaskFeedback } from '../config/imageTaskState'
import { magneticHandleHome, magneticHandleOffset } from '../config/magneticHandle'
const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
  zoom: { type: Number, default: 1 },
  selected: Boolean,
})
const emit = defineEmits(['video-snapshot', 'video-expand', 'video-time'])
const graph = useCanvasV3GraphStore()
const tasks = useCanvasV3TaskStore()
const generating = computed(() => IMAGE_TASK_ACTIVE_STATES.includes(props.data.runState))
const pixelFeedback = computed(() => ['image', 'video'].includes(props.data.kind))
const interrupted = computed(() => ['paused', 'uncertain'].includes(props.data.runState))
const showImage = computed(
  () =>
    props.data.kind === 'image' &&
    props.data.assetUrl &&
    ((!generating.value && !interrupted.value) ||
      props.data.generation?.results?.includes(props.data.assetUrl)),
)
function recordMediaSize(event) {
  const { naturalWidth, naturalHeight } = event.target
  if (
    naturalWidth &&
    (props.data.mediaWidth !== naturalWidth || props.data.mediaHeight !== naturalHeight)
  )
    graph.updateNodeData(props.id, { mediaWidth: naturalWidth, mediaHeight: naturalHeight })
}
function recordMediaDuration(event) {
  const duration = event.target.duration
  if (Number.isFinite(duration) && duration > 0 && props.data.mediaDuration !== duration)
    graph.updateNodeData(props.id, { mediaDuration: duration })
}
function recordVideoMetadata({ width, height, duration }) {
  const patch = {}
  if (
    width > 0 &&
    height > 0 &&
    (props.data.mediaWidth !== width || props.data.mediaHeight !== height)
  ) {
    patch.mediaWidth = width
    patch.mediaHeight = height
  }
  if (Number.isFinite(duration) && duration > 0 && props.data.mediaDuration !== duration)
    patch.mediaDuration = duration
  if (Object.keys(patch).length) graph.updateNodeData(props.id, patch)
}
const spec = computed(() => nodeSpec(props.data.kind))
const size = computed(() => nodeSize(props.data.kind, props.data))
const isText = computed(() => ['text', 'reference'].includes(props.data.kind))
const incoming = computed(() => graph.edges.filter((edge) => edge.target === props.id).length)

function setHandleIndicatorPosition(hitArea, offset) {
  const indicator = hitArea.querySelector('.cv3-handle-indicator')
  if (!indicator) return
  indicator.style.setProperty('--cv3-handle-shift-x', `${offset.x}px`)
  indicator.style.setProperty('--cv3-handle-shift-y', `${offset.y}px`)
}

function followHandlePointer(event) {
  const hitArea = event.currentTarget
  const rect = hitArea.getBoundingClientRect()
  setHandleIndicatorPosition(
    hitArea,
    magneticHandleOffset(
      { x: event.clientX, y: event.clientY },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      hitArea.dataset.side,
    ),
  )
}

function resetHandlePointer(event) {
  setHandleIndicatorPosition(
    event.currentTarget,
    magneticHandleHome(event.currentTarget.dataset.side),
  )
}
</script>

<template>
  <article
    class="cv3-media-node"
    :class="[
      {
        selected,
        'is-text': isText,
        'is-generating': generating,
        'is-grouped': Boolean(data.groupId),
      },
      'is-' + data.kind,
    ]"
    :aria-busy="generating"
    :style="{
      width: size.width + 'px',
      height: size.height + 'px',
      '--cv3-node-zoom': zoom,
      '--cv3-node-inverse-zoom': 1 / zoom,
    }"
  >
    <header class="cv3-media-node-label">
      <CanvasIcon v-if="isText" name="text" :size="16" />
      <CanvasIcon v-else :name="data.kind" :size="16" />
      <span class="cv3-node-title" :title="data.title">{{ data.title }}</span>
      <span v-if="data.assetUrl && data.mediaWidth" class="cv3-media-dimensions">
        {{ data.mediaWidth }} × {{ data.mediaHeight }}
      </span>
      <span v-if="incoming && !data.assetUrl" class="cv3-ref-count">{{ incoming }} 引用</span>
    </header>
    <Handle
      id="input"
      type="target"
      :position="Position.Left"
      class="cv3-handle cv3-handle-target"
      aria-label="连接到此节点"
    >
      <span
        class="cv3-handle-hit"
        data-side="target"
        @pointermove="followHandlePointer"
        @pointerleave="resetHandlePointer"
      >
        <span class="cv3-handle-indicator" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9.35" class="cv3-handle-fill" />
            <circle cx="10" cy="10" r="9.35" class="cv3-handle-ring" />
            <path d="M10 6.5v7M6.5 10h7" class="cv3-handle-plus" />
          </svg>
        </span>
      </span>
    </Handle>
    <textarea
      v-if="isText"
      class="cv3-text-node-editor nodrag nowheel"
      :value="data.prompt"
      :placeholder="spec.promptPlaceholder"
      aria-label="文本内容"
      @focus="graph.remember()"
      @input="graph.updateNodeData(id, { prompt: $event.target.value })"
    />
    <template v-else>
      <img
        v-if="showImage"
        class="cv3-node-media"
        :src="data.assetUrl"
        :alt="data.title"
        :style="{ transform: `rotate(${data.rotation || 0}deg)` }"
        @load="recordMediaSize"
      />
      <GenerationPixelField
        v-if="generating && pixelFeedback"
        :seed="data.generation?.clientTaskId || id"
      />
      <div
        v-if="generating"
        class="cv3-generation-center nodrag"
        :class="{ 'is-pixel-feedback': pixelFeedback }"
        role="status"
        aria-live="polite"
      >
        <span>
          {{ imageTaskFeedback(data) }}
        </span>
        <button
          type="button"
          aria-label="取消等待"
          :title="
            data.runState === 'preparing'
              ? '取消准备，不提交生成任务'
              : '停止页面等待，后台任务可能继续执行，费用按原任务结算'
          "
          @click.stop="tasks.stopWaiting(id)"
        >
          取消
        </button>
      </div>
      <div v-else-if="interrupted" class="cv3-generation-center nodrag">
        <span>{{ data.runState === 'uncertain' ? '任务待确认' : '已停止等待' }}</span>
        <button type="button" @click.stop="tasks.resume(id)">继续查询</button>
      </div>
      <VideoNodePlayer
        v-else-if="data.assetUrl && data.kind === 'video'"
        :source="data.assetUrl"
        :title="data.title"
        :poster="data.posterUrl || data.thumbnail || ''"
        :selected="selected"
        @metadata="recordVideoMetadata"
        @snapshot="emit('video-snapshot', { nodeId: id, ...$event })"
        @expand="emit('video-expand', id)"
        @time="emit('video-time', { nodeId: id, time: $event })"
      />
      <audio
        v-else-if="data.assetUrl && data.kind === 'audio'"
        class="cv3-node-audio nodrag"
        :src="data.assetUrl"
        controls
        preload="metadata"
        @loadedmetadata="recordMediaDuration"
      />
      <div
        v-else-if="!showImage"
        class="cv3-media-placeholder"
        :class="{ 'has-error': data.runState === 'failed' }"
      >
        <CanvasIcon :name="data.kind" :size="42" />
        <span v-if="data.kind === 'smartEdit'">空空如也，请连接视频节点后操作</span>
        <template v-if="data.runState === 'failed'">
          <span>{{ data.error || (data.kind === 'video' ? '视频生成失败' : '图片生成失败') }}</span>
          <button
            type="button"
            class="cv3-generation-retry nodrag"
            @click.stop="data.kind === 'video' ? tasks.runVideo(id) : tasks.runImage(id)"
          >
            重新生成
          </button>
        </template>
      </div>
      <div
        v-if="
          !data.assetUrl &&
          !generating &&
          !interrupted &&
          data.runState !== 'failed' &&
          spec.quickStarts?.length
        "
        class="cv3-media-quick-starts nodrag"
      >
        <span>尝试:</span>
        <button
          v-for="item in spec.quickStarts"
          :key="item"
          type="button"
          @click.stop="graph.applyQuickStart(id, item)"
        >
          <CanvasIcon name="plus" :size="12" />
          {{ item }}
        </button>
      </div>
    </template>
    <Handle
      id="output"
      type="source"
      :position="Position.Right"
      class="cv3-handle cv3-handle-source"
      aria-label="从此节点创建连接"
    >
      <span
        class="cv3-handle-hit"
        data-side="source"
        @pointermove="followHandlePointer"
        @pointerleave="resetHandlePointer"
      >
        <span class="cv3-handle-indicator" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9.35" class="cv3-handle-fill" />
            <circle cx="10" cy="10" r="9.35" class="cv3-handle-ring" />
            <path d="M10 6.5v7M6.5 10h7" class="cv3-handle-plus" />
          </svg>
        </span>
      </span>
    </Handle>
  </article>
</template>

<style scoped>
/* A persistent container owns the screen-fixed title/toolbar. Its child labels
   stay in canvas space, so narrow cards cannot spill across adjacent members. */
.cv3-media-node.is-grouped > .cv3-media-node-label {
  bottom: calc(100% + 8px);
  width: 100%;
  font-size: 16px;
  transform: none;
}
.cv3-media-node.is-grouped:not(:hover) .cv3-handle {
  opacity: 0;
}
</style>

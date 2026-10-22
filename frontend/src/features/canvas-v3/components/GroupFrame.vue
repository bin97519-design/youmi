<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  group: { type: Object, default: null },
  mutable: { type: Boolean, default: true },
  hand: Boolean,
  pointerInside: Boolean,
  connectionResetKey: { type: Number, default: 0 },
})
const emit = defineEmits([
  'select',
  'rename',
  'move-start',
  'move',
  'move-end',
  'move-cancel',
  'resize-start',
  'resize',
  'resize-end',
  'resize-cancel',
  'connect-start',
  'connect-move',
  'connect-end',
  'connect-cancel',
  'add',
])
const root = ref(null)
const titleInput = ref(null)
const editing = ref(false)
const draftName = ref('')
const renameError = ref('')
const hovered = ref(false)
const activeGesture = ref('')
let pointer = null
let suppressAddClick = false
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const canMutate = computed(() => props.mutable && props.group?.mutable !== false && !props.hand)
const bounds = computed(() => {
  const value = props.group?.bounds
  if (!value || !finite(value.left) || !finite(value.top)) return null
  const width = finite(value.width) ? value.width : value.right - value.left
  const height = finite(value.height) ? value.height : value.bottom - value.top
  return finite(width) && finite(height) && width > 0 && height > 0
    ? { left: value.left, top: value.top, width, height }
    : null
})
const frameStyle = computed(
  () =>
    bounds.value && {
      left: `${bounds.value.left}px`,
      top: `${bounds.value.top}px`,
      width: `${bounds.value.width}px`,
      height: `${bounds.value.height}px`,
    },
)
const blankPath = computed(() => {
  if (!bounds.value) return ''
  const { width, height } = bounds.value
  const paths = [`M0 0H${width}V${height}H0Z`]
  const rectangles = []
  for (const member of props.group?.members || []) {
    const rect = member?.rect
    if (!rect) continue
    const left = finite(rect.left) ? rect.left : rect.x
    const top = finite(rect.top) ? rect.top : rect.y
    const right = finite(rect.right) ? rect.right : left + rect.width
    const bottom = finite(rect.bottom) ? rect.bottom : top + rect.height
    if (![left, top, right, bottom].every(finite)) continue
    const x1 = Math.max(0, Math.min(width, left))
    const y1 = Math.max(0, Math.min(height, top))
    const x2 = Math.max(0, Math.min(width, right))
    const y2 = Math.max(0, Math.min(height, bottom))
    if (x2 > x1 && y2 > y1) rectangles.push({ x1, y1, x2, y2 })
  }
  // Disjoint strips subtract the union. Independent evenodd holes would refill
  // overlapping node rectangles and accidentally intercept their UI events.
  const cuts = [...new Set(rectangles.flatMap((rect) => [rect.x1, rect.x2]))].sort((a, b) => a - b)
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const x1 = cuts[index]
    const x2 = cuts[index + 1]
    const intervals = rectangles
      .filter((rect) => rect.x1 < x2 && rect.x2 > x1)
      .map((rect) => [rect.y1, rect.y2])
      .sort((a, b) => a[0] - b[0])
    const merged = []
    for (const interval of intervals) {
      const prior = merged.at(-1)
      if (prior && interval[0] <= prior[1]) prior[1] = Math.max(prior[1], interval[1])
      else merged.push([...interval])
    }
    for (const [y1, y2] of merged) paths.push(`M${x1} ${y1}H${x2}V${y2}H${x1}Z`)
  }
  return paths.join('')
})
const corners = [
  { key: 'nw', label: '左上角' },
  { key: 'ne', label: '右上角' },
  { key: 'se', label: '右下角' },
  { key: 'sw', label: '左下角' },
]
function select() {
  if (props.group?.id) emit('select', props.group)
}
function begin(event, kind, corner) {
  if (event.button !== 0 || !props.group?.id || activeGesture.value) return
  select()
  if (!canMutate.value) return
  event.preventDefault()
  event.stopPropagation()
  activeGesture.value = kind
  pointer = { id: event.pointerId, target: event.currentTarget, event }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  if (kind === 'resize') emit('resize-start', { event, corner })
  else emit('move-start', event)
}
function matches(event) {
  return pointer && event.pointerId === pointer.id
}
function beginConnection(event) {
  event.stopPropagation()
  if (event.button !== 0 || !props.group?.id || !canMutate.value || activeGesture.value) return
  event.preventDefault()
  select()
  suppressAddClick = false
  activeGesture.value = 'connect'
  pointer = {
    id: event.pointerId,
    target: event.currentTarget,
    event,
    origin: { x: event.clientX, y: event.clientY },
    moved: false,
  }
  event.currentTarget?.setPointerCapture?.(event.pointerId)
  event.currentTarget?.focus?.({ preventScroll: true })
  emit('connect-start', event)
}
function trackConnectionMovement(event) {
  if (
    !pointer?.origin ||
    ![pointer.origin.x, pointer.origin.y, event.clientX, event.clientY].every(finite)
  )
    return
  if (Math.hypot(event.clientX - pointer.origin.x, event.clientY - pointer.origin.y) > 3 + 1e-9)
    pointer.moved = true
}
function move(event) {
  if (!matches(event)) return
  if (
    activeGesture.value === 'connect' &&
    typeof event.buttons === 'number' &&
    !(event.buttons & 1)
  ) {
    finish(event, true)
    return
  }
  event.preventDefault()
  event.stopPropagation()
  pointer.event = event
  if (activeGesture.value === 'connect') trackConnectionMovement(event)
  emit(
    activeGesture.value === 'connect'
      ? 'connect-move'
      : activeGesture.value === 'resize'
        ? 'resize'
        : 'move',
    event,
  )
}
function finish(event, cancel = false) {
  if (!matches(event)) return
  event.preventDefault?.()
  event.stopPropagation?.()
  const type = activeGesture.value
  const captured = pointer
  // Only a primary-button release may finish a connector. A real drag (or any
  // cancellation) must swallow the following click; a plain press/release must
  // retain the original single-click create menu.
  if (type === 'connect') {
    trackConnectionMovement(event)
    if (event.button !== 0) cancel = true
    suppressAddClick = cancel || captured.moved
  }
  activeGesture.value = ''
  pointer = null
  emit(`${type}-${cancel ? 'cancel' : 'end'}`, event)
  try {
    captured.target?.releasePointerCapture?.(captured.id)
  } catch {
    // A browser pointercancel or lost capture may already have released it.
  }
}
function cancelGesture() {
  if (pointer) finish(pointer.event, true)
}
async function startRename() {
  select()
  if (!canMutate.value || activeGesture.value) return
  draftName.value = props.group?.name || ''
  renameError.value = ''
  editing.value = true
  await nextTick()
  titleInput.value?.focus({ preventScroll: true })
  titleInput.value?.select?.()
}
function commitRename() {
  if (!editing.value) return
  if (!canMutate.value) return cancelRename()
  const name = draftName.value.trim()
  if (!name || name.length > 100) {
    renameError.value = name ? '分组名称最多100个字符' : '分组名称不能为空'
    return
  }
  editing.value = false
  renameError.value = ''
  if (name !== props.group?.name) emit('rename', name)
}
function cancelRename() {
  editing.value = false
  renameError.value = ''
  draftName.value = props.group?.name || ''
}
function renameKey(event) {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
function add(event) {
  if (
    !canMutate.value ||
    activeGesture.value ||
    suppressAddClick ||
    (event.button != null && event.button !== 0)
  )
    return
  select()
  emit('add', event)
}
function allowKeyboardAdd(event) {
  if (!activeGesture.value && ['Enter', ' ', 'Spacebar'].includes(event.key))
    suppressAddClick = false
}
function connectionKey(event) {
  allowKeyboardAdd(event)
  if (event.key === 'Escape' && activeGesture.value === 'connect') {
    event.preventDefault()
    event.stopPropagation()
    cancelGesture()
  }
}
watch(
  () => props.connectionResetKey,
  () => {
    if (activeGesture.value === 'connect') cancelGesture()
  },
)
watch([() => props.group?.id, () => canMutate.value], () => {
  cancelGesture()
  cancelRename()
})
onBeforeUnmount(cancelGesture)
</script>

<template>
  <section
    v-if="group?.id && bounds"
    ref="root"
    class="cv3-group-frame"
    :class="{
      'is-selected': group.selected,
      'is-storyboard': group.type === 'storyboard',
      'is-hand': hand,
      'is-readonly': !canMutate,
      'is-dragging': activeGesture,
    }"
    :style="frameStyle"
    role="group"
    tabindex="0"
    :aria-label="`${group.type === 'storyboard' ? '分镜组' : '分组'} ${group.name}`"
    :aria-selected="Boolean(group.selected)"
    data-cv3-selection-ui
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @keydown="connectionKey"
  >
    <svg
      class="cv3-group-blank-area"
      :width="bounds.width"
      :height="bounds.height"
      aria-hidden="true"
    >
      <path
        :d="blankPath"
        fill="transparent"
        fill-rule="evenodd"
        @pointerdown="begin($event, 'move')"
        @pointermove="move"
        @pointerup="finish($event)"
        @pointercancel="finish($event, true)"
        @lostpointercapture="finish($event, true)"
        @click.stop="select"
      />
    </svg>
    <div class="cv3-group-title" @pointerdown.stop @click.stop @dblclick.stop>
      <input
        v-if="editing"
        ref="titleInput"
        v-model="draftName"
        type="text"
        maxlength="100"
        aria-label="分组名称"
        :aria-invalid="Boolean(renameError)"
        @keydown="renameKey"
        @keyup.stop
        @blur="commitRename"
      />
      <button
        v-else
        type="button"
        :aria-label="`选择分组 ${group.name}`"
        :title="canMutate ? '双击修改分组名称' : group.name"
        @click="select"
        @dblclick.prevent="startRename"
      >
        {{ group.name }}
      </button>
      <span v-if="renameError" class="cv3-group-rename-error" role="alert">{{ renameError }}</span>
    </div>
    <span
      v-for="edge in ['top', 'right', 'bottom', 'left']"
      :key="edge"
      :class="['cv3-group-frame-edge', `is-${edge}`]"
      aria-hidden="true"
      @pointerdown="begin($event, 'move')"
      @pointermove="move"
      @pointerup="finish($event)"
      @pointercancel="finish($event, true)"
      @lostpointercapture="finish($event, true)"
    />
    <template v-if="group.selected">
      <button
        v-for="corner in corners"
        :key="corner.key"
        type="button"
        :class="['cv3-group-frame-corner', `is-${corner.key}`]"
        :aria-label="`调整分组${corner.label}`"
        :disabled="!canMutate"
        @pointerdown="begin($event, 'resize', corner.key)"
        @pointermove="move"
        @pointerup="finish($event)"
        @pointercancel="finish($event, true)"
        @lostpointercapture="finish($event, true)"
        @click.stop
      />
    </template>
    <button
      v-if="group.selected || hovered || pointerInside || activeGesture === 'connect'"
      class="cv3-group-frame-add"
      type="button"
      aria-label="从分组创建连接"
      title="左键拖动连线，单击创建节点"
      :disabled="!canMutate"
      @pointerdown="beginConnection"
      @pointermove="move"
      @pointerup="finish($event)"
      @pointercancel="finish($event, true)"
      @lostpointercapture="finish($event, true)"
      @contextmenu.prevent.stop
      @auxclick.prevent.stop
      @keydown="connectionKey"
      @click.stop="add"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" /></svg>
    </button>
  </section>
</template>

<style scoped>
.cv3-group-frame {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  border: 1px solid #777;
  border-radius: 24px;
  background: none;
  color: #999;
  pointer-events: none;
}
.cv3-group-frame.is-selected {
  border: 2px solid #3288ff;
}
.cv3-group-blank-area {
  position: absolute;
  top: -1px;
  left: -1px;
  overflow: visible;
  clip-path: inset(0 round 24px);
  pointer-events: none;
}
.is-selected .cv3-group-blank-area {
  top: -2px;
  left: -2px;
}
.cv3-group-blank-area path {
  pointer-events: fill;
  cursor: move;
  touch-action: none;
}
.is-hand .cv3-group-blank-area path {
  pointer-events: none;
}
.is-readonly .cv3-group-blank-area path {
  cursor: default;
}
.cv3-group-title {
  position: absolute;
  top: -24px;
  left: -2px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: max(100%, 180px);
  height: 20px;
  pointer-events: auto;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
}
.cv3-group-title button,
.cv3-group-title input {
  box-sizing: border-box;
  min-width: 40px;
  max-width: 100%;
  height: 20px;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: #999;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-group-title button {
  cursor: pointer;
}
.cv3-group-title input {
  min-width: 120px;
  padding: 0 3px;
  background: #262626;
  color: #ddd;
  outline: 1px solid #3288ff;
}
.cv3-group-title button:focus-visible {
  outline: 1px solid #8dd4e5;
}
.cv3-group-rename-error {
  flex-shrink: 0;
  font-family: inherit;
  font-size: 12px;
  color: #f29b92;
}
.cv3-group-frame-edge {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  touch-action: none;
}
.cv3-group-frame-edge.is-top {
  top: -5px;
  left: 4px;
  right: 4px;
  height: 8px;
}
.cv3-group-frame-edge.is-bottom {
  bottom: -5px;
  left: 4px;
  right: 4px;
  height: 8px;
}
.cv3-group-frame-edge.is-left {
  left: -5px;
  top: 4px;
  bottom: 4px;
  width: 8px;
}
.cv3-group-frame-edge.is-right {
  right: -5px;
  top: 4px;
  bottom: 4px;
  width: 8px;
}
.is-readonly .cv3-group-frame-edge {
  pointer-events: none;
}
.cv3-group-frame-corner {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: #b8b8b8;
  pointer-events: auto;
  touch-action: none;
}
.cv3-group-frame-corner.is-nw {
  top: -5px;
  left: -5px;
  cursor: nwse-resize;
}
.cv3-group-frame-corner.is-ne {
  top: -5px;
  right: -5px;
  cursor: nesw-resize;
}
.cv3-group-frame-corner.is-se {
  bottom: -5px;
  right: -5px;
  cursor: nwse-resize;
}
.cv3-group-frame-corner.is-sw {
  bottom: -5px;
  left: -5px;
  cursor: nesw-resize;
}
.cv3-group-frame-corner:disabled {
  cursor: default;
}
.cv3-group-frame-add {
  position: absolute;
  top: calc(50% - 10px);
  right: -30px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid #aaa;
  border-radius: 50%;
  background: #262626;
  color: #ddd;
  pointer-events: auto;
  cursor: pointer;
  touch-action: none;
}
.cv3-group-frame-add:disabled {
  opacity: 0.4;
  cursor: default;
}
.cv3-group-frame-add svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.cv3-group-frame-add:hover:not(:disabled) {
  background: #383838;
}
.cv3-group-frame-corner:focus-visible,
.cv3-group-frame-add:focus-visible {
  outline: 2px solid #8dd4e5;
  outline-offset: 2px;
}
@media (prefers-contrast: more) {
  .cv3-group-frame {
    border-color: #bbb;
  }
  .cv3-group-frame.is-selected {
    border-color: #60a5ff;
  }
  .cv3-group-title button {
    color: #ddd;
  }
}
</style>

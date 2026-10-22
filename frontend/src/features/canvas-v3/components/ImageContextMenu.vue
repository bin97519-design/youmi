<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, useId } from 'vue'

const props = defineProps({
  position: { type: Object, default: () => ({ x: 8, y: 8 }) },
  rating: { type: Number, default: 0 },
  canPaste: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
})
const emit = defineEmits(['action', 'rate', 'close'])

const MENU_WIDTH = 196
const MENU_HEIGHT = 455
const MARGIN = 8
const items = [
  {
    key: 'compliance',
    label: 'Seedance合规校验',
    help: '检查图片是否符合 Seedance 参考素材的使用要求。',
  },
  { key: 'save-asset', label: '保存到我的资产' },
  { key: 'panorama', label: '进入全景预览', help: '以全景方式预览当前图片。' },
  { key: 'create-subject', label: '创建主体' },
  { key: 'layout', label: '优化工作流布局' },
  { key: 'divider-edit', divider: true },
  {
    key: 'copy-node',
    label: '复制节点',
    shortcut: 'Ctrl+C',
    help: '复制节点及其配置，粘贴后可继续编辑。',
  },
  { key: 'copy-image', label: '复制图片' },
  {
    key: 'duplicate',
    label: '创建副本',
    shortcut: 'Ctrl+D',
    help: '在当前画布中创建这个节点的副本。',
  },
  { key: 'paste', label: '粘贴', shortcut: 'Ctrl+V' },
  { key: 'delete', label: '删除', shortcut: 'Delete' },
  { key: 'divider-clipboard', divider: true },
  { key: 'copy-to-clipboard', label: '复制到剪贴板' },
]
const actions = items.filter((item) => !item.divider)
const protectedActions = new Set(['copy-node', 'duplicate', 'delete'])
const menu = ref(null)
const activeRow = ref(0)
const focusedRating = ref(Math.max(1, Math.min(5, props.rating || 1)))
const openHelp = ref('')
const helpAnchor = ref({ left: 0, top: 0 })
const buttonRefs = new Map()
const ratingRefs = new Map()
const helpRefs = new Map()
const helpId = `cv3-image-context-help-${useId()}`
const viewport = ref({
  width: typeof window === 'undefined' ? 1135 : window.innerWidth,
  height: typeof window === 'undefined' ? 892 : window.innerHeight,
})
let mounted = false
let previousFocus = null

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

const placement = computed(() => {
  const width = Math.min(MENU_WIDTH, Math.max(0, viewport.value.width - MARGIN * 2))
  const height = Math.min(MENU_HEIGHT, Math.max(0, viewport.value.height - MARGIN * 2))
  const x = Number.isFinite(props.position?.x) ? props.position.x : MARGIN
  const y = Number.isFinite(props.position?.y) ? props.position.y : MARGIN
  return {
    left: clamp(x, MARGIN, viewport.value.width - width - MARGIN),
    top: clamp(y, MARGIN, viewport.value.height - height - MARGIN),
    width,
    height,
  }
})
const menuStyle = computed(() =>
  Object.fromEntries(Object.entries(placement.value).map(([key, value]) => [key, `${value}px`])),
)
const helpItem = computed(() => actions.find((item) => item.key === openHelp.value))
const helpStyle = computed(() => {
  const width = Math.min(220, Math.max(0, viewport.value.width - MARGIN * 2))
  const right = placement.value.left + placement.value.width + MARGIN
  const left =
    right + width <= viewport.value.width - MARGIN ? right : placement.value.left - width - MARGIN
  return {
    left: `${clamp(left, MARGIN, viewport.value.width - width - MARGIN)}px`,
    top: `${clamp(helpAnchor.value.top, MARGIN, viewport.value.height - 80 - MARGIN)}px`,
    width: `${width}px`,
  }
})

function isDisabled(item) {
  return (
    (item.key === 'paste' && !props.canPaste) || (props.locked && protectedActions.has(item.key))
  )
}

function disabledReason(item) {
  if (item.key === 'paste' && !props.canPaste) return '剪贴板中没有可粘贴的节点'
  return props.locked && protectedActions.has(item.key) ? '当前节点受保护，暂不能操作' : undefined
}

function rememberRef(collection, key, element) {
  if (element) collection.set(key, element)
  else collection.delete(key)
}

function rowIndex(key) {
  return actions.findIndex((item) => item.key === key) + 1
}

function enabledRows() {
  return [0, ...actions.flatMap((item, index) => (isDisabled(item) ? [] : [index + 1]))]
}

function focusRow(index) {
  activeRow.value = index
  openHelp.value = ''
  const target =
    index === 0 ? ratingRefs.get(focusedRating.value) : buttonRefs.get(actions[index - 1]?.key)
  target?.focus({ preventScroll: true })
}

function chooseRating(value) {
  focusedRating.value = value
  emit('rate', props.rating === value ? 0 : value)
}

function focusRating(value) {
  activeRow.value = 0
  focusedRating.value = value
}

function focusHelp(item) {
  activeRow.value = rowIndex(item.key)
  showHelp(item)
}

function chooseAction(item) {
  if (!item || isDisabled(item)) return
  emit('action', item.key)
  emit('close')
}

function showHelp(item) {
  if (!item.help) return
  const bounds = helpRefs.get(item.key)?.getBoundingClientRect?.()
  helpAnchor.value = { left: bounds?.left || 0, top: bounds?.top || placement.value.top + 8 }
  openHelp.value = item.key
}

function hideHelp(key, preserveFocusedHelp = false) {
  if (preserveFocusedHelp && globalThis.document?.activeElement === helpRefs.get(key)) return
  if (openHelp.value === key) openHelp.value = ''
}

function onKeydown(event) {
  const key = event.key
  const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey
  let actionKey = ''
  if (shortcut) {
    actionKey = { c: 'copy-node', d: 'duplicate', v: 'paste', Backspace: 'delete' }[
      key.length === 1 ? key.toLowerCase() : key
    ]
  } else if (key === 'Delete') actionKey = 'delete'
  if (actionKey) {
    event.preventDefault()
    chooseAction(actions.find((item) => item.key === actionKey))
    return
  }
  if (key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (key === 'Tab') {
    emit('close')
    return
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
    event.preventDefault()
    const rows = enabledRows()
    const index = rows.indexOf(activeRow.value)
    const next =
      key === 'Home'
        ? rows[0]
        : key === 'End'
          ? rows.at(-1)
          : rows[(index + (key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]
    focusRow(next)
    return
  }
  const focusedHelp = [...helpRefs].find(([, element]) => element === event.target)?.[0]
  if (activeRow.value === 0 && ['ArrowLeft', 'ArrowRight'].includes(key)) {
    event.preventDefault()
    focusedRating.value = clamp(focusedRating.value + (key === 'ArrowRight' ? 1 : -1), 1, 5)
    focusRow(0)
  } else if (key === 'ArrowRight' && actions[activeRow.value - 1]?.help) {
    event.preventDefault()
    const item = actions[activeRow.value - 1]
    showHelp(item)
    helpRefs.get(item.key)?.focus({ preventScroll: true })
  } else if (key === 'ArrowLeft' && focusedHelp) {
    event.preventDefault()
    focusRow(rowIndex(focusedHelp))
  } else if (['Enter', ' ', 'Spacebar'].includes(key)) {
    event.preventDefault()
    if (focusedHelp) showHelp(actions.find((item) => item.key === focusedHelp))
    else if (activeRow.value === 0) chooseRating(focusedRating.value)
    else chooseAction(actions[activeRow.value - 1])
  }
}

function onOutsidePointerdown(event) {
  if (event.composedPath?.().includes(menu.value) || menu.value?.contains(event.target)) return
  emit('close')
}

function updateViewport() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  openHelp.value = ''
}

onMounted(() => {
  mounted = true
  previousFocus = globalThis.document?.activeElement
  globalThis.document?.addEventListener('pointerdown', onOutsidePointerdown, true)
  globalThis.window?.addEventListener('resize', updateViewport)
  nextTick(() => {
    if (mounted) focusRow(0)
  })
})
onBeforeUnmount(() => {
  if (
    menu.value?.contains(globalThis.document?.activeElement) &&
    previousFocus?.isConnected !== false
  )
    previousFocus?.focus?.({ preventScroll: true })
})
onUnmounted(() => {
  mounted = false
  globalThis.document?.removeEventListener('pointerdown', onOutsidePointerdown, true)
  globalThis.window?.removeEventListener('resize', updateViewport)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="cv3-image-context-menu"
      :style="menuStyle"
      role="menu"
      aria-label="图片节点菜单"
      data-image-context-menu
      @keydown.stop="onKeydown"
      @contextmenu.prevent.stop
      @pointerdown.stop
    >
      <div class="cv3-image-context-rating cv3-image-context-row" role="group" aria-label="评级">
        <span class="cv3-image-context-label">评级</span>
        <span class="cv3-image-context-stars">
          <button
            v-for="value in 5"
            :key="value"
            :ref="(element) => rememberRef(ratingRefs, value, element)"
            type="button"
            role="menuitemradio"
            class="cv3-image-context-star"
            :class="{ filled: value <= rating }"
            :aria-label="`${value}星`"
            :aria-checked="rating === value"
            :tabindex="activeRow === 0 && focusedRating === value ? 0 : -1"
            @focus="focusRating(value)"
            @click="chooseRating(value)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="m8 1.4 2.04 4.14 4.57.66-3.3 3.22.78 4.55L8 11.82l-4.09 2.15.78-4.55-3.3-3.22 4.57-.66Z"
              />
            </svg>
          </button>
        </span>
      </div>
      <template v-for="item in items" :key="item.key">
        <div v-if="item.divider" class="cv3-image-context-divider" role="separator" />
        <div v-else class="cv3-image-context-row">
          <button
            :ref="(element) => rememberRef(buttonRefs, item.key, element)"
            type="button"
            role="menuitem"
            class="cv3-image-context-option"
            :data-context-action="item.key"
            :tabindex="activeRow === rowIndex(item.key) ? 0 : -1"
            :disabled="isDisabled(item)"
            :aria-disabled="isDisabled(item)"
            :aria-keyshortcuts="
              item.key === 'delete'
                ? 'Delete Control+Backspace Meta+Backspace'
                : item.shortcut?.replace('Ctrl+', 'Control+')
            "
            :title="disabledReason(item)"
            @focus="activeRow = rowIndex(item.key)"
            @click="chooseAction(item)"
          >
            <span class="cv3-image-context-label">{{ item.label }}</span>
            <span v-if="item.shortcut" class="cv3-image-context-shortcut" aria-hidden="true">
              {{ item.shortcut }}
            </span>
          </button>
          <span v-if="item.help" class="cv3-image-context-help-anchor">
            <span class="cv3-image-context-help-measure" aria-hidden="true">{{ item.label }}</span>
            <button
              :ref="(element) => rememberRef(helpRefs, item.key, element)"
              type="button"
              class="cv3-image-context-help"
              :data-context-help="item.key"
              :aria-label="`关于${item.label}`"
              :aria-expanded="openHelp === item.key"
              :aria-describedby="openHelp === item.key ? helpId : undefined"
              tabindex="-1"
              @mouseenter="showHelp(item)"
              @mouseleave="hideHelp(item.key, true)"
              @focus="focusHelp(item)"
              @blur="hideHelp(item.key)"
              @click.stop="showHelp(item)"
            >
              ?
            </button>
          </span>
        </div>
      </template>
      <div
        v-if="helpItem"
        :id="helpId"
        class="cv3-image-context-tooltip"
        :style="helpStyle"
        role="tooltip"
      >
        {{ helpItem.help }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-image-context-menu {
  position: fixed;
  z-index: 1800;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  width: 196px;
  height: 455px;
  padding: 8px;
  overflow: auto;
  color: #dedede;
  border: 1px solid #363636;
  border-radius: 16px;
  background: #262626;
  box-shadow:
    0 8px 32px rgb(0 0 0 / 15%),
    0 2px 8px rgb(0 0 0 / 10%);
  font-family: inherit;
  font-size: 13px;
  font-weight: 400;
  line-height: 20.15px;
  text-align: left;
  user-select: none;
}
.cv3-image-context-row {
  position: relative;
  display: flex;
  flex: 0 0 32px;
  align-items: center;
  box-sizing: border-box;
  min-height: 32px;
  border-radius: 8px;
}
.cv3-image-context-option,
.cv3-image-context-rating {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
}
.cv3-image-context-option,
.cv3-image-context-star,
.cv3-image-context-help {
  box-sizing: border-box;
  margin: 0;
  color: inherit;
  border: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.cv3-image-context-option {
  border-radius: 8px;
  text-align: left;
}
.cv3-image-context-row:hover .cv3-image-context-option:not(:disabled),
.cv3-image-context-option:focus-visible {
  outline: 0;
  background: #383838;
}
.cv3-image-context-option:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cv3-image-context-label {
  white-space: nowrap;
}
.cv3-image-context-shortcut {
  flex-shrink: 0;
  color: #848484;
  font-size: 11px;
  line-height: inherit;
  white-space: nowrap;
}
.cv3-image-context-stars {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cv3-image-context-star {
  display: grid;
  width: 12px;
  height: 16px;
  padding: 0;
  place-items: center;
}
.cv3-image-context-star svg {
  display: block;
  width: 12px;
  height: 12px;
  fill: currentColor;
  opacity: 0.2;
}
.cv3-image-context-star.filled svg,
.cv3-image-context-star:hover svg,
.cv3-image-context-star:focus-visible svg {
  opacity: 1;
}
.cv3-image-context-star:focus-visible,
.cv3-image-context-help:focus-visible {
  outline: 1px solid #a5a5a5;
  outline-offset: 2px;
}
.cv3-image-context-divider {
  flex: 0 0 0.5px;
  height: 0.5px;
  margin: 0 8px;
  background: #414141;
}
.cv3-image-context-help-anchor {
  position: absolute;
  top: 0;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  pointer-events: none;
}
.cv3-image-context-help-measure {
  visibility: hidden;
  white-space: nowrap;
}
.cv3-image-context-help {
  display: grid;
  width: 12px;
  height: 12px;
  padding: 0;
  color: #858585;
  border: 1px solid #858585;
  border-radius: 50%;
  font-size: 9px;
  line-height: 10px;
  pointer-events: auto;
  place-items: center;
}
.cv3-image-context-help:hover,
.cv3-image-context-help:focus-visible {
  color: #dedede;
  border-color: currentColor;
}
.cv3-image-context-tooltip {
  position: fixed;
  z-index: 1;
  box-sizing: border-box;
  padding: 9px 12px;
  color: #dedede;
  border: 1px solid #454545;
  border-radius: 8px;
  background: #303030;
  box-shadow: 0 4px 16px rgb(0 0 0 / 18%);
  font-size: 12px;
  line-height: 18px;
  pointer-events: none;
}
</style>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  modelValue: { type: Boolean, default: true },
})

const emit = defineEmits(['update:open', 'update:modelValue', 'change'])

const MENU_WIDTH = 240
const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 8

const MODES = Object.freeze([
  Object.freeze({
    id: 'manual',
    label: '手动生成',
    description: 'TV Director 每次生成前询问',
    dryRun: true,
  }),
  Object.freeze({
    id: 'auto',
    label: '自动生成',
    description: 'TV Director 可直接消耗积分',
    dryRun: false,
  }),
])

const trigger = ref(null)
const menu = ref(null)
const menuStyle = ref({})
let focusOnOpen = 'selected'
let restoreFocusAfterClose = false

const activeMode = computed(
  () => MODES.find((mode) => mode.dryRun === props.modelValue) || MODES[0],
)

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function updatePosition() {
  if (!props.open || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = Math.min(MENU_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2))
  const left = Math.round(
    clamp(anchor.right - width, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  )

  menuStyle.value = {
    left: `${left}px`,
    bottom: `${Math.round(window.innerHeight - anchor.top + TRIGGER_GAP)}px`,
    width: `${Math.round(width)}px`,
    '--cv3-generation-origin-x': `${Math.round(
      clamp(anchor.left + anchor.width / 2 - left, 18, width - 18),
    )}px`,
  }
}

function menuItems() {
  return [...(menu.value?.querySelectorAll?.('[role="menuitemradio"]') || [])]
}

function focusMode(position = 'selected') {
  const items = menuItems()
  if (!items.length) {
    menu.value?.focus({ preventScroll: true })
    return
  }
  const target =
    position === 'first'
      ? items[0]
      : position === 'last'
        ? items.at(-1)
        : items.find((item) => item.getAttribute('aria-checked') === 'true') || items[0]
  target?.focus({ preventScroll: true })
}

function requestOpen(nextOpen, focusTarget = 'selected') {
  if (nextOpen) {
    focusOnOpen = focusTarget
    restoreFocusAfterClose = false
  }
  emit('update:open', nextOpen)
}

function closeMenu({ restoreFocus = true } = {}) {
  if (!props.open) return
  restoreFocusAfterClose = restoreFocus
  emit('update:open', false)
}

function toggleMenu() {
  if (props.open) closeMenu({ restoreFocus: false })
  else requestOpen(true)
}

function selectMode(mode) {
  emit('update:modelValue', mode.dryRun)
  emit('change', mode.dryRun)
  closeMenu({ restoreFocus: true })
}

function handleTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    requestOpen(true, event.key === 'ArrowUp' ? 'last' : 'first')
  } else if (event.key === 'Escape' && props.open) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu({ restoreFocus: true })
  }
}

function handleMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu({ restoreFocus: true })
    return
  }

  const items = menuItems()
  if (!items.length) return
  const current = items.indexOf(document.activeElement)
  let next = current
  if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
  else if (event.key === 'ArrowUp')
    next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = items.length - 1
  else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
    event.preventDefault()
    items[current].click()
    return
  } else return

  event.preventDefault()
  items[next]?.focus({ preventScroll: true })
}

function handleDocumentPointerDown(event) {
  if (!props.open) return
  const path = event.composedPath?.() || []
  const inside = [trigger.value, menu.value].some(
    (element) => element && (path.includes(element) || element.contains(event.target)),
  )
  if (!inside) closeMenu({ restoreFocus: false })
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      updatePosition()
      focusMode(focusOnOpen)
      return
    }
    if (restoreFocusAfterClose) {
      restoreFocusAfterClose = false
      await nextTick()
      trigger.value?.focus({ preventScroll: true })
    }
  },
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
  window.visualViewport?.addEventListener('resize', updatePosition)
  window.visualViewport?.addEventListener('scroll', updatePosition)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
  window.visualViewport?.removeEventListener('resize', updatePosition)
  window.visualViewport?.removeEventListener('scroll', updatePosition)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="cv3-director-generation-trigger"
    :class="{ 'is-open': open }"
    :title="activeMode.label"
    :aria-label="activeMode.label"
    aria-haspopup="menu"
    :aria-expanded="open"
    aria-controls="cv3-director-generation-mode-menu"
    @click.stop="toggleMenu"
    @keydown="handleTriggerKeydown"
  >
    <svg
      v-if="modelValue"
      class="cv3-director-generation-trigger-icon"
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.72 9.17V4.58a1.04 1.04 0 1 1 2.08 0v3.34-4.38a1.04 1.04 0 1 1 2.08 0v4.38-3.34a1.04 1.04 0 1 1 2.08 0v3.75-2.5a1.04 1.04 0 1 1 2.08 0v5.42a6.04 6.04 0 0 1-12.08 0v-1.04c0-1.38.45-2.72 1.3-3.81l.38-.5a1.04 1.04 0 0 1 1.66 1.26z"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <svg
      v-else
      class="cv3-director-generation-trigger-icon"
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m10.92 2.5.6 1.58c.14.36.42.64.78.78l1.58.6-1.58.61c-.36.14-.64.42-.78.78l-.6 1.58-.61-1.58a1.35 1.35 0 0 0-.78-.78l-1.58-.6 1.58-.61c.36-.14.64-.42.78-.78zm-4.8 5.63.9 2.34c.2.53.62.95 1.15 1.15l2.34.9-2.34.9c-.53.2-.95.62-1.15 1.15l-.9 2.34-.9-2.34a1.98 1.98 0 0 0-1.15-1.15l-2.34-.9 2.34-.9c.53-.2.95-.62 1.15-1.15zm8.84 3.54.55 1.43c.12.32.37.57.69.69l1.43.55-1.43.55c-.32.12-.57.37-.69.69l-.55 1.43-.55-1.43a1.2 1.2 0 0 0-.69-.69l-1.43-.55 1.43-.55c.32-.12.57-.37.69-.69z"
        fill="currentColor"
      />
    </svg>
  </button>

  <Teleport to="body">
    <Transition name="cv3-director-generation-popover">
      <div
        v-if="open"
        id="cv3-director-generation-mode-menu"
        ref="menu"
        class="cv3-director-generation-menu"
        :style="menuStyle"
        role="menu"
        aria-label="选择生成方式"
        tabindex="-1"
        data-canvas-shortcuts-ignore
        data-director-popup-open="true"
        @keydown.stop="handleMenuKeydown"
      >
        <button
          v-for="mode in MODES"
          :key="mode.id"
          type="button"
          class="cv3-director-generation-option"
          :class="{ 'is-active': modelValue === mode.dryRun }"
          role="menuitemradio"
          :aria-checked="modelValue === mode.dryRun"
          :aria-pressed="modelValue === mode.dryRun"
          :data-generation-mode="mode.id"
          @click="selectMode(mode)"
        >
          <span class="cv3-director-generation-icon" aria-hidden="true">
            <svg v-if="mode.dryRun" width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path
                d="M7.72 9.17V4.58a1.04 1.04 0 1 1 2.08 0v3.34-4.38a1.04 1.04 0 1 1 2.08 0v4.38-3.34a1.04 1.04 0 1 1 2.08 0v3.75-2.5a1.04 1.04 0 1 1 2.08 0v5.42a6.04 6.04 0 0 1-12.08 0v-1.04c0-1.38.45-2.72 1.3-3.81l.38-.5a1.04 1.04 0 0 1 1.66 1.26z"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path
                d="m10.92 2.5.6 1.58c.14.36.42.64.78.78l1.58.6-1.58.61c-.36.14-.64.42-.78.78l-.6 1.58-.61-1.58a1.35 1.35 0 0 0-.78-.78l-1.58-.6 1.58-.61c.36-.14.64-.42.78-.78zm-4.8 5.63.9 2.34c.2.53.62.95 1.15 1.15l2.34.9-2.34.9c-.53.2-.95.62-1.15 1.15l-.9 2.34-.9-2.34a1.98 1.98 0 0 0-1.15-1.15l-2.34-.9 2.34-.9c.53-.2.95-.62 1.15-1.15zm8.84 3.54.55 1.43c.12.32.37.57.69.69l1.43.55-1.43.55c-.32.12-.57.37-.69.69l-.55 1.43-.55-1.43a1.2 1.2 0 0 0-.69-.69l-1.43-.55 1.43-.55c.32-.12.57-.37.69-.69z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span class="cv3-director-generation-copy">
            <strong>{{ mode.label }}</strong>
            <small>{{ mode.description }}</small>
          </span>
          <svg
            v-if="modelValue === mode.dryRun"
            class="cv3-director-generation-check"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m3.33 8.08 3.02 3.02 6.32-6.32"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cv3-director-generation-trigger {
  position: relative;
  display: inline-grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  outline: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  transition:
    color 150ms ease,
    background-color 150ms ease,
    transform 100ms ease-out;
}

.cv3-director-generation-trigger:hover,
.cv3-director-generation-trigger:focus-visible,
.cv3-director-generation-trigger.is-open {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.cv3-director-generation-trigger:active {
  transform: scale(0.96);
}

.cv3-director-generation-trigger-icon {
  display: block;
}

.cv3-director-generation-menu {
  position: fixed;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  outline: none;
  background: #292929;
  box-shadow:
    0 16px 32px rgba(0, 0, 0, 0.36),
    0 3px 8px rgba(0, 0, 0, 0.22);
  color: #f5f5f5;
  transform-origin: var(--cv3-generation-origin-x, calc(100% - 16px)) bottom;
}

.cv3-director-generation-option {
  display: grid;
  width: 100%;
  min-height: 58px;
  grid-template-columns: 30px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 0;
  border-radius: 9px;
  outline: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  text-align: left;
  transition:
    color 140ms ease,
    background-color 140ms ease,
    transform 100ms ease-out;
}

.cv3-director-generation-option:hover,
.cv3-director-generation-option:focus-visible {
  background: rgba(255, 255, 255, 0.075);
  color: #fff;
}

.cv3-director-generation-option:active {
  transform: scale(0.985);
}

.cv3-director-generation-option.is-active {
  background: rgba(255, 255, 255, 0.055);
  color: #fff;
}

.cv3-director-generation-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.68);
}

.cv3-director-generation-option.is-active .cv3-director-generation-icon {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.cv3-director-generation-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.cv3-director-generation-copy strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-generation-copy small {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.42);
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-generation-check {
  color: #fff;
}

.cv3-director-generation-popover-enter-active,
.cv3-director-generation-popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-director-generation-popover-enter-from,
.cv3-director-generation-popover-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .cv3-director-generation-trigger,
  .cv3-director-generation-option {
    transition: none;
  }

  .cv3-director-generation-popover-enter-active,
  .cv3-director-generation-popover-leave-active {
    transition: opacity 120ms ease;
  }

  .cv3-director-generation-popover-enter-from,
  .cv3-director-generation-popover-leave-to {
    transform: none;
  }
}

@media (prefers-contrast: more) {
  .cv3-director-generation-menu {
    border-color: rgba(255, 255, 255, 0.42);
    background: #202020;
  }
}
</style>

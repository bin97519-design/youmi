<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_DIRECTOR_MODEL_TAB,
  DIRECTOR_MODEL_CATALOG,
  DIRECTOR_MODEL_SECTIONS,
  DIRECTOR_MODEL_TABS,
} from '../config/directorModelCatalog.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  selectedCount: { type: Number, default: 0 },
})

const emit = defineEmits(['update:open', 'select'])

const MENU_WIDTH = 370
const MENU_MAX_HEIGHT = 384
const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 6

const trigger = ref(null)
const dialog = ref(null)
const modelList = ref(null)
const activeTab = ref(DEFAULT_DIRECTOR_MODEL_TAB)
const sectionElements = new Map()
const menuStyle = ref({})
let focusOnOpen = 'first'
let restoreFocusAfterClose = false

const tabs = computed(() =>
  DIRECTOR_MODEL_TABS.filter((tab) => ['image', 'video'].includes(tab.id)),
)

const sections = computed(() =>
  tabs.value.map((tab) => ({
    ...tab,
    models:
      DIRECTOR_MODEL_SECTIONS?.[tab.id] ||
      DIRECTOR_MODEL_CATALOG.filter((model) => model.modality === tab.id),
  })),
)

const triggerLabel = '选择模型'

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function setSectionElement(tabId, element) {
  if (element) sectionElements.set(tabId, element)
  else sectionElements.delete(tabId)
}

function updatePosition() {
  if (!props.open || !trigger.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = Math.min(MENU_WIDTH, Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2))
  const availableAbove = Math.max(0, anchor.top - TRIGGER_GAP - VIEWPORT_MARGIN)
  const left = Math.round(
    clamp(anchor.left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  )
  menuStyle.value = {
    left: `${left}px`,
    bottom: `${Math.round(window.innerHeight - anchor.top + TRIGGER_GAP)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(Math.min(MENU_MAX_HEIGHT, availableAbove))}px`,
    '--cv3-model-origin-x': `${Math.round(
      clamp(anchor.left + anchor.width / 2 - left, 16, width - 16),
    )}px`,
  }
}

function focusModel(position = 'first') {
  const rows = [...(dialog.value?.querySelectorAll?.('[role="option"]') || [])]
  if (!rows.length) {
    dialog.value?.focus({ preventScroll: true })
    return
  }
  const target = position === 'last' ? rows.at(-1) : rows[0]
  target?.focus({ preventScroll: true })
}

function requestOpen(nextOpen, focusTarget = 'first') {
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

function selectModel(model) {
  emit('select', model)
  closeMenu({ restoreFocus: false })
}

function scrollToSection(tabId) {
  const list = modelList.value
  const section = sectionElements.get(tabId)
  if (!list || !section) return
  activeTab.value = tabId
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  list.scrollTo({
    top: Math.max(0, section.offsetTop),
    behavior: reduceMotion ? 'auto' : 'smooth',
  })
}

function handleDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu({ restoreFocus: true })
    return
  }

  const rows = [...(dialog.value?.querySelectorAll?.('[role="option"]') || [])]
  if (!rows.length) return
  const current = rows.indexOf(document.activeElement)
  let next = current
  if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % rows.length
  else if (event.key === 'ArrowUp')
    next = current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = rows.length - 1
  else if (event.key === 'Enter' && current >= 0) {
    event.preventDefault()
    rows[current].click()
    return
  } else return

  event.preventDefault()
  rows[next]?.focus({ preventScroll: true })
  rows[next]?.scrollIntoView({ block: 'nearest' })
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

function handleDocumentPointerDown(event) {
  if (!props.open) return
  const path = event.composedPath?.() || []
  const inside = [trigger.value, dialog.value].some(
    (element) => element && (path.includes(element) || element.contains(event.target)),
  )
  if (!inside) closeMenu({ restoreFocus: false })
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      activeTab.value = DEFAULT_DIRECTOR_MODEL_TAB
      await nextTick()
      updatePosition()
      focusModel(focusOnOpen)
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
    class="cv3-director-model-trigger"
    :class="{ 'is-open': open }"
    :title="triggerLabel"
    :aria-label="triggerLabel"
    aria-haspopup="dialog"
    :aria-expanded="open"
    aria-controls="cv3-director-model-dialog"
    :data-selected-count="Math.max(0, selectedCount)"
    @click.stop="toggleMenu"
    @keydown="handleTriggerKeydown"
  >
    <svg
      class="cv3-director-model-cube"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7.2.87c.5-.3 1.1-.3 1.6 0l5.11 3.07c.47.28.76.79.76 1.33v5.58c0 .54-.29 1.05-.76 1.33L8.8 15.25l-.1.05c-.47.24-1.04.22-1.5-.05l-5.1-3.07a1.6 1.6 0 0 1-.76-1.33V5.27c0-.51.26-.99.67-1.28l.09-.05zm-4.67 9.98q0 .19.18.3l4.7 2.82v-5.2L2.53 5.95zm6.08-2.1v5.2l4.69-2.8q.16-.11.17-.3v-4.9zM8.18 1.9a.4.4 0 0 0-.36 0L2.96 4.81 8 7.72l5.04-2.9z"
        fill="currentColor"
      />
    </svg>
  </button>

  <Teleport to=".cv3-app-shell">
    <Transition name="cv3-director-model-popover">
      <section
        v-if="open"
        id="cv3-director-model-dialog"
        ref="dialog"
        class="cv3-director-model-dialog"
        :style="menuStyle"
        role="dialog"
        aria-modal="false"
        aria-label="选择模型"
        tabindex="-1"
        data-canvas-shortcuts-ignore
        data-director-popup-open="true"
        @keydown.stop="handleDialogKeydown"
      >
        <h2>选择模型</h2>
        <header class="cv3-director-model-tabs" role="radiogroup" aria-label="模型类型">
          <button
            v-for="tab in tabs"
            :id="`cv3-director-model-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="radio"
            :aria-checked="activeTab === tab.id"
            :aria-controls="`cv3-director-model-section-${tab.id}`"
            :class="{ 'is-active': activeTab === tab.id }"
            @click="scrollToSection(tab.id)"
          >
            {{ tab.label }}
          </button>
        </header>

        <div ref="modelList" class="cv3-director-model-list" role="listbox" aria-label="可选模型">
          <section
            v-for="section in sections"
            :id="`cv3-director-model-section-${section.id}`"
            :key="section.id"
            :ref="(element) => setSectionElement(section.id, element)"
            class="cv3-director-model-section"
            role="group"
            :aria-labelledby="`cv3-director-model-heading-${section.id}`"
          >
            <h3 :id="`cv3-director-model-heading-${section.id}`">{{ section.label }}</h3>
            <button
              v-for="model in section.models"
              :key="model.id"
              type="button"
              class="cv3-director-model-row"
              role="option"
              aria-selected="false"
              :aria-label="`添加模型 ${model.label}`"
              :data-model-id="model.id"
              @click="selectModel(model)"
            >
              <span class="cv3-director-model-logo" aria-hidden="true">
                <img v-if="model.logoUrl" :src="model.logoUrl" alt="" />
                <svg v-else width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M7.2.87c.5-.3 1.1-.3 1.6 0l5.11 3.07c.47.28.76.79.76 1.33v5.58c0 .54-.29 1.05-.76 1.33L8.8 15.25l-.1.05c-.47.24-1.04.22-1.5-.05l-5.1-3.07a1.6 1.6 0 0 1-.76-1.33V5.27c0-.51.26-.99.67-1.28l.09-.05zm-4.67 9.98q0 .19.18.3l4.7 2.82v-5.2L2.53 5.95zm6.08-2.1v5.2l4.69-2.8q.16-.11.17-.3v-4.9zM8.18 1.9a.4.4 0 0 0-.36 0L2.96 4.81 8 7.72l5.04-2.9z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span class="cv3-director-model-copy">
                <span class="cv3-director-model-name">
                  {{ model.label }}
                  <i v-if="model.vip">VIP</i>
                </span>
                <small>{{ model.description }}</small>
              </span>
              <span class="cv3-director-model-add" aria-hidden="true">+</span>
            </button>
          </section>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cv3-director-model-trigger {
  position: relative;
  display: inline-grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: #969696;
  background: transparent;
  cursor: pointer;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.cv3-director-model-trigger:hover,
.cv3-director-model-trigger:focus-visible,
.cv3-director-model-trigger.is-open {
  color: #f4f4f4;
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-model-cube {
  display: block;
}

.cv3-director-model-dialog {
  position: fixed;
  z-index: 1100;
  display: flex;
  max-height: 384px;
  flex-direction: column;
  overflow: hidden;
  border: 0.5px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(31, 31, 31, 0.98);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.3),
    inset 0 1px rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(24px);
  transform-origin: var(--cv3-model-origin-x, 92%) bottom;
}

.cv3-director-model-dialog:focus {
  outline: none;
}

.cv3-director-model-dialog > h2 {
  flex: 0 0 auto;
  margin: 0;
  padding: 16px 16px 0;
  color: #f3f3f3;
  font-size: 16px;
  font-weight: 550;
  line-height: 22px;
  letter-spacing: -0.01em;
}

.cv3-director-model-tabs {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  flex: 0 0 auto;
  gap: 0;
  margin: 16px 16px 8px;
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
}

.cv3-director-model-tabs button {
  position: relative;
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  color: #8f8f8f;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.cv3-director-model-tabs button:hover,
.cv3-director-model-tabs button:focus-visible {
  color: #e9e9e9;
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}

.cv3-director-model-tabs button.is-active {
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
}

.cv3-director-model-list {
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 10px 12px;
  scroll-behavior: smooth;
  scrollbar-color: #515151 transparent;
  scrollbar-width: thin;
}

.cv3-director-model-section {
  display: flex;
  flex-direction: column;
  gap: 0;
  scroll-margin-top: 32px;
}

.cv3-director-model-section h3 {
  position: sticky;
  z-index: 1;
  top: 0;
  height: 29px;
  margin: 0;
  padding: 7px 6px 5px;
  color: #818181;
  background: linear-gradient(#1f1f1f 75%, rgba(31, 31, 31, 0));
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
}

.cv3-director-model-row {
  display: flex;
  width: 100%;
  min-height: 57px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 0;
  border-radius: 12px;
  color: #ededed;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;
}

.cv3-director-model-row:hover,
.cv3-director-model-row:focus-visible {
  background: rgba(255, 255, 255, 0.08);
  outline: none;
}

.cv3-director-model-logo {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 9px;
  color: #cfcfcf;
  background: rgba(255, 255, 255, 0.055);
}

.cv3-director-model-logo img {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.cv3-director-model-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.cv3-director-model-name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-director-model-name i {
  flex: 0 0 auto;
  padding: 1px 4px;
  border-radius: 4px;
  color: #e9c96e;
  background: rgba(203, 155, 50, 0.15);
  font-size: 8px;
  font-style: normal;
  font-weight: 600;
  line-height: 12px;
}

.cv3-director-model-copy small {
  display: -webkit-box;
  overflow: hidden;
  color: #858585;
  font-size: 11px;
  line-height: 16px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.cv3-director-model-add {
  display: grid;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 350;
  line-height: 12px;
}

.cv3-director-model-popover-enter-active,
.cv3-director-model-popover-leave-active {
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-director-model-popover-enter-from,
.cv3-director-model-popover-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .cv3-director-model-trigger,
  .cv3-director-model-tabs button,
  .cv3-director-model-row,
  .cv3-director-model-popover-enter-active,
  .cv3-director-model-popover-leave-active {
    transition: none;
  }

  .cv3-director-model-list {
    scroll-behavior: auto;
  }
}
</style>

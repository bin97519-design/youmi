<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number, Array],
    default: '',
  },
  options: {
    type: Array,
    default: () => [],
  },
  ariaLabel: {
    type: String,
    default: '选择选项',
  },
  disabled: Boolean,
  multiple: Boolean,
  floating: Boolean,
  menuMinWidth: { type: Number, default: 0 },
})

const emit = defineEmits(['update:modelValue', 'change'])

const root = ref(null)
const menu = ref(null)
const optionButtons = ref([])
const open = ref(false)
const activeIndex = ref(-1)
const menuStyle = ref({})

function isSelected(value) {
  return props.multiple
    ? Array.isArray(props.modelValue) && props.modelValue.some((item) => String(item) === String(value))
    : String(value) === String(props.modelValue)
}

const selectedIndex = computed(() =>
  props.options.findIndex((option) => isSelected(option.value)),
)
const selectedLabel = computed(() => {
  if (!props.multiple) return props.options[selectedIndex.value]?.label || props.options[0]?.label || '请选择'
  const selected = props.options.filter((option) => isSelected(option.value))
  return selected.length > 1
    ? `${selected[0].label} +${selected.length - 1}`
    : selected[0]?.label || '请选择'
})
const selectedTitle = computed(() => props.multiple
  ? props.options.filter((option) => isSelected(option.value)).map((option) => option.label).join('、')
  : selectedLabel.value)

function focusOption(index, direction = 1) {
  if (!props.options.length) return
  for (let offset = 0; offset < props.options.length; offset++) {
    const nextIndex =
      (((index + offset * direction) % props.options.length) + props.options.length) %
      props.options.length
    if (props.options[nextIndex].disabled) continue
    activeIndex.value = nextIndex
    nextTick(() => optionButtons.value[nextIndex]?.focus())
    return
  }
}

function positionMenu() {
  if (!props.floating || !root.value) return
  const rect = root.value.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const desiredHeight = Math.min(280, props.options.length * 34 + 10)
  const below = window.innerHeight - rect.bottom - gap - margin
  const above = rect.top - gap - margin
  const opensBelow = below >= desiredHeight || below >= above
  const height = Math.max(34, Math.min(desiredHeight, opensBelow ? below : above))
  const width = Math.min(Math.max(rect.width, props.menuMinWidth), window.innerWidth - margin * 2)
  menuStyle.value = {
    position: 'fixed',
    zIndex: 12000,
    top: `${opensBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - height)}px`,
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width))}px`,
    right: 'auto',
    width: `${width}px`,
    maxHeight: `${height}px`,
  }
}

function showMenu() {
  if (props.disabled) return
  positionMenu()
  open.value = true
  focusOption(selectedIndex.value >= 0 ? selectedIndex.value : 0)
}

function closeMenu({ restoreFocus = false } = {}) {
  open.value = false
  activeIndex.value = -1
  if (restoreFocus) nextTick(() => root.value?.querySelector('.themed-select-trigger')?.focus())
}

function toggleMenu() {
  if (open.value) closeMenu()
  else showMenu()
}

function selectOption(option) {
  if (props.disabled || option.disabled) return
  if (props.multiple) {
    const current = Array.isArray(props.modelValue) ? props.modelValue : []
    if (isSelected(option.value) && current.length <= 1) return
    const next = isSelected(option.value)
      ? current.filter((value) => String(value) !== String(option.value))
      : [...current, option.value]
    emit('update:modelValue', next)
    emit('change', next)
    return
  }
  emit('update:modelValue', option.value)
  emit('change', option.value)
  closeMenu({ restoreFocus: true })
}

function onTriggerKeydown(event) {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    showMenu()
  }
}

function onOptionKeydown(event, index) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusOption(index + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusOption(index - 1, -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    focusOption(event.key === 'Home' ? 0 : props.options.length - 1, event.key === 'Home' ? 1 : -1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu({ restoreFocus: true })
  } else if (event.key === 'Tab') {
    closeMenu()
    root.value?.querySelector('.themed-select-trigger')?.focus()
  }
}

function onDocumentPointerDown(event) {
  if (root.value && !root.value.contains(event.target) && !menu.value?.contains(event.target))
    closeMenu()
}

function onViewportChange() {
  if (open.value) positionMenu()
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMenu()
  },
)

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<template>
  <div ref="root" class="themed-select" :class="{ open }">
    <button
      type="button"
      class="themed-select-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :title="selectedTitle"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span>{{ selectedLabel }}</span>
      <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
    </button>

    <Teleport to="body" :disabled="!floating">
      <Transition name="themed-select-menu">
        <div
          v-if="open"
          ref="menu"
          class="themed-select-options"
          :style="floating ? menuStyle : null"
          role="listbox"
          :aria-label="ariaLabel"
          :aria-multiselectable="multiple || undefined"
          @pointerdown.stop
          @click.stop
          @dblclick.stop
          @keydown.stop
          @wheel.stop
        >
          <button
            v-for="(option, index) in options"
            :key="option.value"
            :ref="(element) => (optionButtons[index] = element)"
            type="button"
            :disabled="disabled || option.disabled"
            tabindex="-1"
            class="themed-select-option"
            :class="{ active: isSelected(option.value) }"
            role="option"
            :aria-selected="isSelected(option.value)"
            @click="selectOption(option)"
            @keydown="onOptionKeydown($event, index)"
          >
            <span v-if="multiple" class="themed-select-check" aria-hidden="true">
              <i :class="isSelected(option.value) ? 'ri-checkbox-line' : 'ri-checkbox-blank-line'"></i>
            </span>
            <span>{{ option.label }}</span>
            <i
              v-if="!multiple && isSelected(option.value)"
              class="ri-check-line"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.themed-select {
  position: relative;
  min-width: 0;
}

.themed-select-trigger {
  display: flex;
  width: 100%;
  height: 34px;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 9px 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  outline: none;
  color: var(--canvas-text-muted);
  background: var(--canvas-input);
  font-size: 13px;
  text-align: left;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;
}

.themed-select-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.themed-select-trigger i {
  flex: 0 0 auto;
  color: var(--canvas-text-subtle);
  font-size: 16px;
  transition: transform 140ms ease;
}

.themed-select-trigger:hover {
  color: var(--canvas-text);
  border-color: var(--canvas-border-strong);
  background: var(--canvas-surface-hover);
}

.themed-select-trigger:disabled,
.themed-select-option:disabled {
  opacity: 0.65;
  cursor: default;
}

.themed-select.open .themed-select-trigger,
.themed-select-trigger:focus-visible {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
  box-shadow: 0 0 0 3px var(--canvas-accent-soft);
}

.themed-select.open .themed-select-trigger i {
  color: var(--canvas-accent);
  transform: rotate(180deg);
}

.themed-select-options {
  box-sizing: border-box;
  position: absolute;
  z-index: 80;
  top: calc(100% + 6px);
  right: 0;
  left: 0;
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
}

.themed-select-option {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border: 0;
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: transparent;
  font-size: 13px;
  text-align: left;
}

.themed-select-option:hover,
.themed-select-option:focus-visible {
  outline: none;
  color: var(--canvas-text);
  background: var(--canvas-surface-hover);
}

.themed-select-option.active {
  color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
  font-weight: 600;
}

.themed-select-option i {
  color: var(--canvas-accent);
  font-size: 15px;
}
.themed-select-check {
  display: grid;
  place-items: center;
  flex: 0 0 16px;
}
.themed-select-check + span {
  flex: 1;
}
.themed-select-option:not(.active) .themed-select-check i {
  color: var(--canvas-text-subtle);
}

.themed-select-menu-enter-active,
.themed-select-menu-leave-active {
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.themed-select-menu-enter-from,
.themed-select-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

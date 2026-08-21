<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
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
})

const emit = defineEmits(['update:modelValue', 'change'])

const root = ref(null)
const optionButtons = ref([])
const open = ref(false)
const activeIndex = ref(-1)

const selectedIndex = computed(() =>
  props.options.findIndex((option) => String(option.value) === String(props.modelValue)),
)
const selectedLabel = computed(
  () => props.options[selectedIndex.value]?.label || props.options[0]?.label || '请选择',
)

function focusOption(index) {
  if (!props.options.length) return
  const nextIndex = (index + props.options.length) % props.options.length
  activeIndex.value = nextIndex
  nextTick(() => optionButtons.value[nextIndex]?.focus())
}

function showMenu() {
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
    focusOption(index - 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu({ restoreFocus: true })
  } else if (event.key === 'Tab') {
    closeMenu()
  }
}

function onDocumentPointerDown(event) {
  if (root.value && !root.value.contains(event.target)) closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="themed-select" :class="{ open }">
    <button
      type="button"
      class="themed-select-trigger"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span>{{ selectedLabel }}</span>
      <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
    </button>

    <Transition name="themed-select-menu">
      <div v-if="open" class="themed-select-options" role="listbox" :aria-label="ariaLabel">
        <button
          v-for="(option, index) in options"
          :key="option.value"
          :ref="(element) => (optionButtons[index] = element)"
          type="button"
          class="themed-select-option"
          :class="{ active: String(option.value) === String(modelValue) }"
          role="option"
          :aria-selected="String(option.value) === String(modelValue)"
          @click="selectOption(option)"
          @keydown="onOptionKeydown($event, index)"
        >
          <span>{{ option.label }}</span>
          <i
            v-if="String(option.value) === String(modelValue)"
            class="ri-check-line"
            aria-hidden="true"
          ></i>
        </button>
      </div>
    </Transition>
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

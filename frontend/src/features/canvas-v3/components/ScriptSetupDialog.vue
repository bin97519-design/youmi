<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DIRECTOR_GENRES,
  DIRECTOR_HOT_PRESETS,
  DIRECTOR_SCRIPT_EPISODES,
  DIRECTOR_SCRIPT_FIELDS,
} from '../config/directorModes'

const props = defineProps({
  open: { type: Boolean, default: false },
})

const emit = defineEmits(['cancel', 'confirm'])

const dialog = ref(null)
const closeButton = ref(null)
const visualReferenceInput = ref(null)
const fieldTriggers = new Map()
const showHotPresets = ref(true)
const selectedPresetId = ref('')
const mainGenre = ref(DIRECTOR_GENRES[0]?.id || '')
const fusionGenre = ref('')
const activeField = ref('')
const episodes = ref(DIRECTOR_SCRIPT_EPISODES.default)
const notes = ref('')
const visualReference = ref(null)
const selections = reactive(
  Object.fromEntries(DIRECTOR_SCRIPT_FIELDS.map((field) => [field.id, []])),
)

let previousBodyOverflow = ''
let opener = null
let bodyLocked = false

const selectedPreset = computed(
  () => DIRECTOR_HOT_PRESETS.find((preset) => preset.id === selectedPresetId.value) || null,
)

function resetForm() {
  clearVisualReference()
  showHotPresets.value = true
  selectedPresetId.value = ''
  mainGenre.value = DIRECTOR_GENRES[0]?.id || ''
  fusionGenre.value = ''
  activeField.value = ''
  episodes.value = DIRECTOR_SCRIPT_EPISODES.default
  notes.value = ''
  for (const field of DIRECTOR_SCRIPT_FIELDS) selections[field.id] = []
}

function clearVisualReference() {
  if (
    visualReference.value?.previewUrl &&
    typeof URL !== 'undefined' &&
    typeof URL.revokeObjectURL === 'function'
  ) {
    URL.revokeObjectURL(visualReference.value.previewUrl)
  }
  visualReference.value = null
  if (visualReferenceInput.value) visualReferenceInput.value.value = ''
}

function chooseVisualReference(event) {
  const file = event.target.files?.[0]
  if (!file || !file.type.startsWith('image/')) {
    event.target.value = ''
    return
  }
  clearVisualReference()
  visualReference.value = {
    name: file.name,
    size: file.size,
    previewUrl:
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : '',
  }
}

function openVisualReferencePicker() {
  visualReferenceInput.value?.click()
}

function formattedFileSize(size) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function rememberFieldTrigger(id, element) {
  if (element) fieldTriggers.set(id, element)
  else fieldTriggers.delete(id)
}

function fieldValues(field) {
  return selections[field.id] || []
}

function fieldSummary(field) {
  const labels = fieldValues(field)
    .map((id) => field.options.find((option) => option.id === id)?.label)
    .filter(Boolean)
  return labels.length ? labels.join('、') : '请选择'
}

function isSelected(field, optionId) {
  return fieldValues(field).includes(optionId)
}

function isAtSelectionLimit(field) {
  return fieldValues(field).length >= field.maxSelect
}

function toggleField(field) {
  activeField.value = activeField.value === field.id ? '' : field.id
  if (!activeField.value) return
  void nextTick(() => {
    dialog.value
      ?.querySelector(`[data-field-popover="${field.id}"] [role="option"]`)
      ?.focus({ preventScroll: true })
  })
}

function openFieldFromKeyboard(field) {
  activeField.value = field.id
  void nextTick(() => {
    dialog.value
      ?.querySelector(`[data-field-popover="${field.id}"] [role="option"]`)
      ?.focus({ preventScroll: true })
  })
}

function selectFieldOption(field, optionId) {
  const values = fieldValues(field)
  const index = values.indexOf(optionId)
  if (index >= 0) {
    values.splice(index, 1)
    return
  }
  if (values.length >= field.maxSelect) return
  values.push(optionId)
  if (field.maxSelect === 1) closeField(field.id)
}

function closeField(id, restoreFocus = false) {
  if (activeField.value !== id) return
  activeField.value = ''
  if (restoreFocus) {
    void nextTick(() => fieldTriggers.get(id)?.focus({ preventScroll: true }))
  }
}

function moveFieldFocus(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const options = [...event.currentTarget.querySelectorAll('[role="option"]:not(:disabled)')]
  if (!options.length) return
  event.preventDefault()
  const index = options.indexOf(document.activeElement)
  const nextIndex =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
  options[nextIndex]?.focus()
}

function choosePreset(preset) {
  selectedPresetId.value = preset.id
  const matchingGenre = DIRECTOR_GENRES.find((genre) => genre.label === preset.genre)
  if (matchingGenre) {
    mainGenre.value = matchingGenre.id
    if (fusionGenre.value === matchingGenre.id) fusionGenre.value = ''
  }
}

function chooseMainGenre(id) {
  mainGenre.value = id
  if (fusionGenre.value === id) fusionGenre.value = ''
}

function chooseFusionGenre(id) {
  fusionGenre.value = fusionGenre.value === id ? '' : id
}

function normalizeEpisodes(value = episodes.value) {
  const parsed = Number.parseInt(value, 10)
  episodes.value = Math.min(
    DIRECTOR_SCRIPT_EPISODES.max,
    Math.max(
      DIRECTOR_SCRIPT_EPISODES.min,
      Number.isFinite(parsed) ? parsed : DIRECTOR_SCRIPT_EPISODES.default,
    ),
  )
}

function changeEpisodes(delta) {
  normalizeEpisodes(episodes.value + delta)
}

function payload() {
  const single = (id) => selections[id]?.[0] || null
  return {
    presetId: selectedPresetId.value || null,
    mainGenre: mainGenre.value || null,
    fusionGenre: fusionGenre.value || null,
    audience: [...selections.audience],
    characters: [...selections.characters],
    era: single('era'),
    highlights: [...selections.highlights],
    visualStyle: single('visualStyle'),
    structure: single('structure'),
    episodes: episodes.value,
    notes: notes.value.trim(),
    visualReferenceName: visualReference.value?.name || null,
  }
}

function cancel() {
  activeField.value = ''
  emit('cancel')
}

function confirm() {
  normalizeEpisodes()
  activeField.value = ''
  emit('confirm', payload())
}

function handleDialogPointerDown(event) {
  if (!event.target.closest('[data-script-field]')) activeField.value = ''
}

function focusableElements() {
  if (!dialog.value) return []
  return [
    ...dialog.value.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
    ),
  ].filter((element) => element.getClientRects().length)
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (activeField.value) closeField(activeField.value, true)
    else cancel()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableElements()
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog.value)
  ) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      opener = document.activeElement
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      bodyLocked = true
      resetForm()
      await nextTick()
      closeButton.value?.focus({ preventScroll: true })
      return
    }
    activeField.value = ''
    if (bodyLocked) document.body.style.overflow = previousBodyOverflow
    bodyLocked = false
    opener?.focus?.({ preventScroll: true })
    opener = null
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  clearVisualReference()
  if (typeof document !== 'undefined' && bodyLocked) {
    document.body.style.overflow = previousBodyOverflow
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cv3-script-dialog-fade">
      <div
        v-if="open"
        class="cv3-script-dialog-backdrop"
        data-canvas-shortcuts-ignore
        data-director-popup-open="true"
        @pointerdown.self="cancel"
        @keydown.stop="handleKeydown"
      >
        <section
          ref="dialog"
          class="cv3-script-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cv3-script-dialog-title"
          tabindex="-1"
          @pointerdown="handleDialogPointerDown"
        >
          <header class="cv3-script-dialog-header">
            <div>
              <h2 id="cv3-script-dialog-title">剧本设定器</h2>
              <p>完善故事方向，快速生成可继续创作的剧本框架</p>
            </div>
            <button
              ref="closeButton"
              type="button"
              class="cv3-script-dialog-close"
              aria-label="关闭剧本设定器"
              title="关闭"
              @click="cancel"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div class="cv3-script-dialog-content">
            <aside class="cv3-script-presets" aria-label="爆款预设 Top 8">
              <div class="cv3-script-presets-heading">
                <div>
                  <strong>爆款预设</strong>
                  <span>Top {{ DIRECTOR_HOT_PRESETS.length }}</span>
                </div>
                <button
                  type="button"
                  class="cv3-script-switch"
                  role="switch"
                  :aria-checked="showHotPresets"
                  aria-label="展示爆款预设"
                  title="展示爆款预设"
                  @click="showHotPresets = !showHotPresets"
                >
                  <i aria-hidden="true" />
                </button>
              </div>
              <Transition name="cv3-script-presets-slide">
                <div v-if="showHotPresets" class="cv3-script-preset-list">
                  <button
                    v-for="preset in DIRECTOR_HOT_PRESETS"
                    :key="preset.id"
                    type="button"
                    class="cv3-script-preset"
                    :class="{ selected: selectedPresetId === preset.id }"
                    :aria-pressed="selectedPresetId === preset.id"
                    @click="choosePreset(preset)"
                  >
                    <span class="cv3-script-preset-rank">{{ preset.rank }}</span>
                    <span class="cv3-script-preset-copy">
                      <strong>{{ preset.label }}</strong>
                      <small>{{ preset.genre }}</small>
                    </span>
                    <span class="cv3-script-preset-check" aria-hidden="true">✓</span>
                  </button>
                </div>
              </Transition>
              <p v-if="!showHotPresets" class="cv3-script-presets-hidden">
                已隐藏预设，可随时重新开启
              </p>
              <p v-if="selectedPreset" class="cv3-script-preset-tip">
                {{ selectedPreset.prompt }}
              </p>
            </aside>

            <main class="cv3-script-settings">
              <section class="cv3-script-section">
                <div class="cv3-script-section-title">
                  <h3>选择故事题材</h3>
                  <span>主题材必选，融合题材可选</span>
                </div>
                <div class="cv3-script-genre-row">
                  <strong>主题材</strong>
                  <div class="cv3-script-chip-list" role="radiogroup" aria-label="选择主题材">
                    <button
                      v-for="genre in DIRECTOR_GENRES"
                      :key="'main-' + genre.id"
                      type="button"
                      role="radio"
                      :aria-checked="mainGenre === genre.id"
                      :class="{ selected: mainGenre === genre.id }"
                      @click="chooseMainGenre(genre.id)"
                    >
                      {{ genre.label }}
                    </button>
                  </div>
                </div>
                <div class="cv3-script-genre-row">
                  <strong>融合题材</strong>
                  <div class="cv3-script-chip-list" aria-label="选择融合题材">
                    <button
                      type="button"
                      aria-label="移除融合题材"
                      title="移除融合题材"
                      :class="{ selected: !fusionGenre }"
                      :aria-pressed="!fusionGenre"
                      @click="fusionGenre = ''"
                    >
                      不融合
                    </button>
                    <button
                      v-for="genre in DIRECTOR_GENRES"
                      :key="'fusion-' + genre.id"
                      type="button"
                      :disabled="mainGenre === genre.id"
                      :class="{ selected: fusionGenre === genre.id }"
                      :aria-pressed="fusionGenre === genre.id"
                      @click="chooseFusionGenre(genre.id)"
                    >
                      {{ genre.label }}
                    </button>
                  </div>
                </div>
              </section>

              <section class="cv3-script-section cv3-script-details">
                <div class="cv3-script-section-title">
                  <h3>完善剧本设定</h3>
                  <span>可按需补充，让生成结果更贴近你的构想</span>
                </div>
                <div class="cv3-script-field-grid">
                  <div
                    v-for="field in DIRECTOR_SCRIPT_FIELDS"
                    :key="field.id"
                    class="cv3-script-field"
                    :class="{ open: activeField === field.id }"
                    data-script-field
                  >
                    <label :id="`cv3-script-field-label-${field.id}`">{{ field.label }}</label>
                    <button
                      :ref="(element) => rememberFieldTrigger(field.id, element)"
                      type="button"
                      class="cv3-script-field-trigger"
                      :class="{ selected: fieldValues(field).length }"
                      :aria-labelledby="`cv3-script-field-label-${field.id}`"
                      aria-haspopup="listbox"
                      :aria-expanded="activeField === field.id"
                      :aria-controls="`cv3-script-field-options-${field.id}`"
                      @click.stop="toggleField(field)"
                      @keydown.down.prevent="openFieldFromKeyboard(field)"
                    >
                      <span>{{ fieldSummary(field) }}</span>
                      <i aria-hidden="true">⌄</i>
                    </button>
                    <Transition name="cv3-script-popover">
                      <div
                        v-if="activeField === field.id"
                        :id="`cv3-script-field-options-${field.id}`"
                        class="cv3-script-field-popover"
                        role="listbox"
                        :aria-label="field.label"
                        :aria-multiselectable="field.maxSelect > 1"
                        :data-field-popover="field.id"
                        data-canvas-shortcuts-ignore
                        data-director-popup-open="true"
                        @pointerdown.stop
                        @keydown="moveFieldFocus"
                        @keydown.esc.prevent.stop="closeField(field.id, true)"
                      >
                        <div class="cv3-script-field-popover-head">
                          <span>{{ field.label }}</span>
                          <small>最多选择 {{ field.maxSelect }} 项</small>
                        </div>
                        <button
                          v-for="option in field.options"
                          :key="option.id"
                          type="button"
                          role="option"
                          :aria-selected="isSelected(field, option.id)"
                          :disabled="isAtSelectionLimit(field) && !isSelected(field, option.id)"
                          :class="{ selected: isSelected(field, option.id) }"
                          @click="selectFieldOption(field, option.id)"
                        >
                          <span>{{ option.label }}</span>
                          <i aria-hidden="true">✓</i>
                        </button>
                      </div>
                    </Transition>
                  </div>
                </div>
              </section>

              <section class="cv3-script-section cv3-script-episode-section">
                <div>
                  <h3>剧集数量</h3>
                  <p>设置需要生成的短剧集数</p>
                </div>
                <div class="cv3-script-stepper">
                  <button
                    type="button"
                    aria-label="减少剧集数量"
                    :disabled="episodes <= DIRECTOR_SCRIPT_EPISODES.min"
                    @click="changeEpisodes(-DIRECTOR_SCRIPT_EPISODES.step)"
                  >
                    −
                  </button>
                  <input
                    v-model="episodes"
                    type="number"
                    inputmode="numeric"
                    :min="DIRECTOR_SCRIPT_EPISODES.min"
                    :max="DIRECTOR_SCRIPT_EPISODES.max"
                    :step="DIRECTOR_SCRIPT_EPISODES.step"
                    aria-label="剧集数量"
                    @change="normalizeEpisodes($event.target.value)"
                    @blur="normalizeEpisodes($event.target.value)"
                  />
                  <span>集</span>
                  <button
                    type="button"
                    aria-label="增加剧集数量"
                    :disabled="episodes >= DIRECTOR_SCRIPT_EPISODES.max"
                    @click="changeEpisodes(DIRECTOR_SCRIPT_EPISODES.step)"
                  >
                    ＋
                  </button>
                </div>
              </section>

              <section class="cv3-script-section cv3-script-extras">
                <label class="cv3-script-notes">
                  <span>
                    补充想法
                    <small>（可选）</small>
                  </span>
                  <textarea
                    v-model="notes"
                    rows="3"
                    maxlength="500"
                    placeholder="补充人物关系、剧情走向或必须保留的创意…"
                    aria-label="补充想法（可选）"
                  />
                </label>
                <div class="cv3-script-reference">
                  <div class="cv3-script-reference-title">
                    <span>
                      画风参考图
                      <small>（可选）</small>
                    </span>
                    <em>仅保留本地文件信息</em>
                  </div>
                  <input
                    ref="visualReferenceInput"
                    class="cv3-script-reference-input"
                    type="file"
                    accept="image/*"
                    aria-label="选择画风参考图"
                    @change="chooseVisualReference"
                  />
                  <div v-if="visualReference" class="cv3-script-reference-file">
                    <img
                      v-if="visualReference.previewUrl"
                      :src="visualReference.previewUrl"
                      alt=""
                    />
                    <span v-else class="cv3-script-reference-placeholder" aria-hidden="true">
                      图
                    </span>
                    <span class="cv3-script-reference-copy">
                      <strong :title="visualReference.name">{{ visualReference.name }}</strong>
                      <small>{{ formattedFileSize(visualReference.size) }}</small>
                    </span>
                    <button
                      type="button"
                      aria-label="移除画风参考图"
                      title="移除"
                      @click="clearVisualReference"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    v-else
                    type="button"
                    class="cv3-script-reference-add"
                    @click="openVisualReferencePicker"
                  >
                    <span aria-hidden="true">＋</span>
                    上传画风参考图
                  </button>
                </div>
              </section>
            </main>
          </div>

          <footer class="cv3-script-dialog-footer">
            <span>主题材、剧本设定与集数将在确认后写入创作上下文</span>
            <div>
              <button type="button" class="cv3-script-cancel" @click="cancel">取消</button>
              <button type="button" class="cv3-script-confirm" @click="confirm">确认</button>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cv3-script-dialog-backdrop {
  position: fixed;
  z-index: 1099;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 62%);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #f2f2f2;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.cv3-script-dialog,
.cv3-script-dialog * {
  box-sizing: border-box;
}

.cv3-script-dialog {
  position: relative;
  z-index: 1100;
  display: grid;
  width: min(960px, calc(100vw - 48px));
  height: min(640px, 85vh);
  min-height: 0;
  grid-template-rows: 64px minmax(0, 1fr) 68px;
  overflow: hidden;
  border: 0.5px solid #363636;
  border-radius: 24px;
  outline: none;
  background: #202020;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 24%),
    0 14px 34px rgb(0 0 0 / 34%),
    0 32px 80px rgb(0 0 0 / 42%);
}

.cv3-script-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 19px 10px 24px;
  border-bottom: 1px solid #363636;
}

.cv3-script-dialog-header h2,
.cv3-script-dialog-header p,
.cv3-script-section h3,
.cv3-script-episode-section p {
  margin: 0;
}

.cv3-script-dialog-header h2 {
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
}

.cv3-script-dialog-header p {
  margin-top: 2px;
  color: #858585;
  font-size: 12px;
}

.cv3-script-dialog button,
.cv3-script-dialog input {
  font: inherit;
}

.cv3-script-dialog button {
  border: 0;
  color: inherit;
  cursor: pointer;
}

.cv3-script-dialog button:focus-visible,
.cv3-script-dialog input:focus-visible {
  outline: 2px solid #36cfe4;
  outline-offset: 2px;
}

.cv3-script-dialog button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.cv3-script-dialog-close {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  background: transparent;
  color: #9b9b9b !important;
  transition:
    color 140ms ease,
    background-color 140ms ease;
}

.cv3-script-dialog-close:hover {
  background: rgb(255 255 255 / 8%);
  color: #fff !important;
}

.cv3-script-dialog-close span {
  font-size: 23px;
  font-weight: 300;
  line-height: 1;
}

.cv3-script-dialog-content {
  display: grid;
  min-height: 0;
  grid-template-columns: 264px minmax(0, 1fr);
}

.cv3-script-presets {
  min-height: 0;
  padding: 18px 14px;
  overflow: auto;
  border-right: 1px solid #353535;
  background: #1b1b1b;
  scrollbar-color: #484848 transparent;
  scrollbar-width: thin;
}

.cv3-script-presets-heading {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  margin: 0 4px 13px;
}

.cv3-script-presets-heading > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.cv3-script-presets-heading strong {
  font-size: 14px;
  font-weight: 600;
}

.cv3-script-presets-heading span {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgb(48 199 225 / 14%);
  color: #5ed8ea;
  font-size: 10px;
  font-weight: 600;
}

.cv3-script-switch {
  position: relative;
  width: 30px;
  height: 18px;
  padding: 0;
  border-radius: 999px;
  background: #444;
  transition: background-color 160ms ease;
}

.cv3-script-switch[aria-checked='true'] {
  background: #34bfd5;
}

.cv3-script-switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #f6f6f6;
  box-shadow: 0 1px 3px rgb(0 0 0 / 30%);
  transition: transform 180ms cubic-bezier(0.2, 0.75, 0.2, 1);
}

.cv3-script-switch[aria-checked='true'] i {
  transform: translateX(12px);
}

.cv3-script-preset-list {
  display: grid;
  gap: 6px;
}

.cv3-script-preset {
  display: grid;
  width: 100%;
  min-height: 48px;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid transparent !important;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  transition:
    border-color 140ms ease,
    background-color 140ms ease;
}

.cv3-script-preset:hover {
  background: #292929;
}

.cv3-script-preset.selected {
  border-color: rgb(60 207 227 / 45%) !important;
  background: rgb(48 199 225 / 10%);
}

.cv3-script-preset-rank {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  background: #303030;
  color: #a9a9a9;
  font-size: 11px;
  font-weight: 600;
}

.cv3-script-preset:nth-child(-n + 3) .cv3-script-preset-rank {
  background: linear-gradient(145deg, #3acade, #4687e4);
  color: #fff;
}

.cv3-script-preset-copy {
  display: grid;
  min-width: 0;
}

.cv3-script-preset-copy strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-script-preset-copy small {
  margin-top: 2px;
  color: #777;
  font-size: 10px;
}

.cv3-script-preset-check {
  color: transparent;
  font-size: 12px;
}

.cv3-script-preset.selected .cv3-script-preset-check {
  color: #5ed8ea;
}

.cv3-script-presets-hidden {
  margin: 36px 10px 0;
  color: #696969;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.cv3-script-preset-tip {
  margin: 12px 3px 0;
  padding: 10px;
  border-radius: 9px;
  background: #242424;
  color: #858585;
  font-size: 11px;
  line-height: 17px;
}

.cv3-script-settings {
  min-height: 0;
  padding: 18px 22px 24px;
  overflow: auto;
  scrollbar-color: #505050 transparent;
  scrollbar-width: thin;
}

.cv3-script-section + .cv3-script-section {
  margin-top: 22px;
}

.cv3-script-section-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.cv3-script-section h3 {
  font-size: 14px;
  font-weight: 600;
}

.cv3-script-section-title span,
.cv3-script-episode-section p {
  color: #747474;
  font-size: 11px;
}

.cv3-script-genre-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}

.cv3-script-genre-row + .cv3-script-genre-row {
  margin-top: 9px;
}

.cv3-script-genre-row > strong {
  padding-top: 6px;
  color: #969696;
  font-size: 12px;
  font-weight: 500;
}

.cv3-script-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cv3-script-chip-list button {
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid #414141;
  border-radius: 8px;
  background: #292929;
  color: #ababab;
  font-size: 11px;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease;
}

.cv3-script-chip-list button:hover:not(:disabled) {
  border-color: #5d5d5d;
  color: #e7e7e7;
}

.cv3-script-chip-list button.selected {
  border-color: rgb(58 203 224 / 58%);
  background: rgb(47 190 213 / 13%);
  color: #72deed;
}

.cv3-script-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.cv3-script-field {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.cv3-script-field.open {
  z-index: 20;
}

.cv3-script-field > label {
  display: block;
  margin: 0 0 6px 2px;
  color: #8d8d8d;
  font-size: 11px;
}

.cv3-script-field-trigger {
  display: flex;
  width: 100%;
  height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid #404040 !important;
  border-radius: 9px;
  background: #292929;
  color: #767676 !important;
  text-align: left;
}

.cv3-script-field-trigger:hover,
.cv3-script-field-trigger[aria-expanded='true'] {
  border-color: #5a5a5a !important;
}

.cv3-script-field-trigger.selected {
  color: #d7d7d7 !important;
}

.cv3-script-field-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-script-field-trigger i {
  flex: 0 0 auto;
  color: #777;
  font-size: 13px;
  font-style: normal;
  transition: transform 140ms ease;
}

.cv3-script-field-trigger[aria-expanded='true'] i {
  transform: rotate(180deg);
}

.cv3-script-field-popover {
  position: absolute;
  z-index: 1150;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  max-height: 246px;
  padding: 6px;
  overflow: auto;
  border: 1px solid #494949;
  border-radius: 16px;
  background: #292929;
  box-shadow: 0 14px 38px rgb(0 0 0 / 42%);
  scrollbar-color: #505050 transparent;
  scrollbar-width: thin;
}

.cv3-script-field:nth-child(even) .cv3-script-field-popover {
  right: 0;
  left: auto;
}

.cv3-script-field-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 6px;
  color: #bcbcbc;
  font-size: 11px;
}

.cv3-script-field-popover-head small {
  color: #717171;
  font-size: 10px;
}

.cv3-script-field-popover > button {
  display: flex;
  width: 100%;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 7px;
  background: transparent;
  color: #aaa;
  font-size: 12px;
  text-align: left;
}

.cv3-script-field-popover > button:hover:not(:disabled),
.cv3-script-field-popover > button:focus-visible {
  background: rgb(255 255 255 / 7%);
  color: #f2f2f2;
}

.cv3-script-field-popover > button.selected {
  background: rgb(49 194 216 / 11%);
  color: #6cdbea;
}

.cv3-script-field-popover > button i {
  color: transparent;
  font-style: normal;
}

.cv3-script-field-popover > button.selected i {
  color: #5ed8ea;
}

.cv3-script-episode-section {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid #383838;
  border-radius: 11px;
  background: #252525;
}

.cv3-script-episode-section p {
  margin-top: 3px;
}

.cv3-script-stepper {
  display: flex;
  height: 34px;
  align-items: center;
  overflow: hidden;
  border: 1px solid #444;
  border-radius: 9px;
  background: #1f1f1f;
}

.cv3-script-stepper button {
  width: 34px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: #aaa;
  font-size: 17px;
}

.cv3-script-stepper button:hover:not(:disabled) {
  background: rgb(255 255 255 / 7%);
  color: #fff;
}

.cv3-script-stepper input {
  width: 42px;
  height: 32px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #eee;
  font-size: 13px;
  text-align: right;
  appearance: textfield;
}

.cv3-script-stepper input::-webkit-inner-spin-button,
.cv3-script-stepper input::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
}

.cv3-script-stepper span {
  padding: 0 4px 0 2px;
  color: #777;
  font-size: 11px;
}

.cv3-script-extras {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  gap: 12px;
}

.cv3-script-notes,
.cv3-script-reference {
  min-width: 0;
}

.cv3-script-notes > span,
.cv3-script-reference-title > span {
  display: block;
  margin: 0 0 6px 2px;
  color: #a3a3a3;
  font-size: 11px;
  font-weight: 500;
}

.cv3-script-notes small,
.cv3-script-reference-title small {
  color: #6f6f6f;
  font-size: 10px;
  font-weight: 400;
}

.cv3-script-notes textarea {
  display: block;
  width: 100%;
  height: 78px;
  min-height: 78px;
  padding: 9px 11px;
  resize: vertical;
  border: 1px solid #404040;
  border-radius: 10px;
  outline: none;
  background: #292929;
  color: #e7e7e7;
  font: inherit;
  font-size: 12px;
  line-height: 19px;
  transition: border-color 140ms ease;
}

.cv3-script-notes textarea::placeholder {
  color: #676767;
}

.cv3-script-notes textarea:hover,
.cv3-script-notes textarea:focus {
  border-color: #5a5a5a;
}

.cv3-script-reference-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.cv3-script-reference-title em {
  overflow: hidden;
  color: #626262;
  font-size: 9px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-script-reference-input {
  display: none;
}

.cv3-script-reference-add,
.cv3-script-reference-file {
  width: 100%;
  height: 78px;
  border: 1px dashed #484848 !important;
  border-radius: 10px;
  background: #292929;
}

.cv3-script-reference-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #858585 !important;
  font-size: 11px;
  transition:
    color 140ms ease,
    border-color 140ms ease,
    background-color 140ms ease;
}

.cv3-script-reference-add:hover {
  border-color: #5b5b5b !important;
  background: #2d2d2d;
  color: #d1d1d1 !important;
}

.cv3-script-reference-add span {
  font-size: 16px;
}

.cv3-script-reference-file {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-style: solid !important;
}

.cv3-script-reference-file img,
.cv3-script-reference-placeholder {
  display: grid;
  width: 52px;
  height: 60px;
  place-items: center;
  border-radius: 7px;
  background: #1e1e1e;
  color: #777;
  object-fit: cover;
}

.cv3-script-reference-copy {
  display: grid;
  min-width: 0;
}

.cv3-script-reference-copy strong {
  overflow: hidden;
  color: #cfcfcf;
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv3-script-reference-copy small {
  margin-top: 4px;
  color: #717171;
  font-size: 10px;
}

.cv3-script-reference-file > button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border-radius: 7px;
  background: transparent;
  color: #858585;
  font-size: 17px;
}

.cv3-script-reference-file > button:hover {
  background: rgb(255 255 255 / 8%);
  color: #fff;
}

.cv3-script-dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px 12px 22px;
  border-top: 1px solid #363636;
  background: #202020;
}

.cv3-script-dialog-footer > span {
  color: #6f6f6f;
  font-size: 11px;
}

.cv3-script-dialog-footer > div {
  display: flex;
  gap: 8px;
}

.cv3-script-dialog-footer button {
  min-width: 76px;
  height: 36px;
  padding: 0 18px;
  border-radius: 10px;
  font-size: 13px;
  transition:
    transform 100ms ease,
    background-color 140ms ease;
}

.cv3-script-dialog-footer button:active {
  transform: scale(0.97);
}

.cv3-script-cancel {
  background: #303030;
  color: #c2c2c2 !important;
}

.cv3-script-cancel:hover {
  background: #3a3a3a;
}

.cv3-script-confirm {
  background: #ececec;
  color: #191919 !important;
  font-weight: 500;
}

.cv3-script-confirm:hover {
  background: #fff;
}

.cv3-script-dialog-fade-enter-active,
.cv3-script-dialog-fade-leave-active {
  transition: opacity 160ms ease;
}

.cv3-script-dialog-fade-enter-active .cv3-script-dialog,
.cv3-script-dialog-fade-leave-active .cv3-script-dialog {
  transition:
    opacity 220ms cubic-bezier(0.2, 0, 0, 1),
    transform 220ms cubic-bezier(0.2, 0, 0, 1);
}

.cv3-script-dialog-fade-enter-from,
.cv3-script-dialog-fade-leave-to,
.cv3-script-dialog-fade-enter-from .cv3-script-dialog,
.cv3-script-dialog-fade-leave-to .cv3-script-dialog {
  opacity: 0;
}

.cv3-script-dialog-fade-enter-from .cv3-script-dialog,
.cv3-script-dialog-fade-leave-to .cv3-script-dialog {
  transform: translateY(12px) scale(0.97);
}

.cv3-script-popover-enter-active,
.cv3-script-popover-leave-active {
  transform-origin: top center;
  transition:
    opacity 120ms ease,
    transform 150ms cubic-bezier(0.2, 0.75, 0.2, 1);
}

.cv3-script-popover-enter-from,
.cv3-script-popover-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.98);
}

.cv3-script-presets-slide-enter-active,
.cv3-script-presets-slide-leave-active {
  transition:
    opacity 140ms ease,
    transform 160ms ease;
}

.cv3-script-presets-slide-enter-from,
.cv3-script-presets-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 760px) {
  .cv3-script-dialog {
    height: min(720px, calc(100vh - 24px));
    min-height: 0;
    grid-template-rows: 60px minmax(0, 1fr) 64px;
  }

  .cv3-script-dialog-content {
    display: block;
    overflow: auto;
  }

  .cv3-script-presets {
    width: 100%;
    max-height: 228px;
    border-right: 0;
    border-bottom: 1px solid #353535;
  }

  .cv3-script-settings {
    overflow: visible;
  }

  .cv3-script-field-grid {
    grid-template-columns: 1fr;
  }

  .cv3-script-extras {
    grid-template-columns: 1fr;
  }

  .cv3-script-dialog-footer > span {
    display: none;
  }

  .cv3-script-dialog-footer {
    justify-content: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cv3-script-dialog-backdrop *,
  .cv3-script-dialog-fade-enter-active,
  .cv3-script-dialog-fade-leave-active,
  .cv3-script-dialog-fade-enter-active .cv3-script-dialog,
  .cv3-script-dialog-fade-leave-active .cv3-script-dialog,
  .cv3-script-popover-enter-active,
  .cv3-script-popover-leave-active,
  .cv3-script-presets-slide-enter-active,
  .cv3-script-presets-slide-leave-active {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
}
</style>

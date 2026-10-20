<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  characterStudioAssets,
  characterStudioIsOfficial,
} from '../config/characterStudioAssets.js'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  character: { type: Object, required: true },
  previewUrl: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  generationCost: { type: Number, default: null },
  status: { type: String, default: '' },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'insert', 'edit', 'create', 'remove', 'generate', 'voice'])
const closeButton = ref(null)
const failedUrls = ref(new Set())
const displayLabel = (value) => value.replaceAll('角色', '模特')
const assets = computed(() => characterStudioAssets(props.character, props.previewUrl))
const displaySlots = computed(() => {
  const [full, half, ...rest] = assets.value.slots
  // The recorded incomplete-asset view places the half-body placeholder before
  // the original. Once a half-body asset exists, the completed row is full-body first.
  return full.asset && !half.asset ? [half, full, ...rest] : assets.value.slots
})
const personal = computed(() => !characterStudioIsOfficial(props.character))
const canInsert = computed(() => {
  const original = assets.value.slots[0].asset
  return Boolean(original && !imageFailed(original))
})
const cost = computed(() =>
  Number.isFinite(props.generationCost) && props.generationCost >= 0 ? props.generationCost : null,
)
let previousFocus
let disposed = false

function action(name, value) {
  if (name === 'insert' && !canInsert.value) return
  if (!props.busy) emit(name, value)
}
function close() {
  emit('close')
}
function keydown(event) {
  if (event.key !== 'Escape') return
  event.preventDefault?.()
  event.stopPropagation?.()
  close()
}
function imageSource(asset) {
  return failedUrls.value.has(asset.previewUrl) ? asset.url : asset.previewUrl
}
function imageFailed(asset, source) {
  return failedUrls.value.has(source || imageSource(asset))
}
function markImageFailed(event) {
  const source = event.target?.getAttribute?.('src') || event.target?.src
  if (source) failedUrls.value = new Set([...failedUrls.value, source])
}
watch(
  () => [props.character, props.previewUrl],
  () => {
    failedUrls.value = new Set()
  },
)
onMounted(async () => {
  previousFocus = globalThis.document?.activeElement
  await nextTick()
  if (!disposed) closeButton.value?.focus?.({ preventScroll: true })
})
onBeforeUnmount(() => {
  disposed = true
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
})
</script>

<template>
  <section
    class="cv3-character-inner-scrim cv3-character-asset-viewer cv3-character-assets-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="模特资产"
    @keydown="keydown"
    @pointerdown.stop
  >
    <button
      ref="closeButton"
      type="button"
      class="cv3-character-assets-close"
      aria-label="关闭模特资产"
      @click="close"
    >
      <CanvasIcon name="close" :size="18" />
    </button>
    <div class="cv3-character-assets-body">
      <div class="cv3-character-assets-content">
        <div class="cv3-character-assets-grid" aria-label="模特图片资产">
          <div
            v-for="slot in displaySlots"
            :key="slot.type"
            class="cv3-character-asset-slot"
            :class="{
              'is-sheet': slot.type === 'character-sheet',
              'is-missing': !slot.asset,
              'is-half-body': slot.type === 'half-body',
            }"
            :data-asset-type="slot.type"
          >
            <template v-if="slot.asset">
              <img
                v-if="!imageFailed(slot.asset)"
                :src="imageSource(slot.asset)"
                :alt="displayLabel(slot.label)"
                draggable="false"
                @error="markImageFailed"
              />
              <p v-else class="cv3-character-asset-load-error" role="status">
                {{ displayLabel(slot.label) }}图片加载失败
              </p>
            </template>
            <template v-else>
              <span>{{ displayLabel(slot.label) }}</span>
              <button
                type="button"
                class="cv3-character-asset-generate"
                :aria-label="`生成${displayLabel(slot.label)}`"
                :disabled="busy"
                @click="action('generate', slot.type)"
              >
                生成
                <span v-if="cost !== null" class="cv3-character-asset-cost">{{ cost }} 米值</span>
              </button>
            </template>
          </div>
        </div>
        <div class="cv3-character-assets-voice">
          <button type="button" :disabled="busy" @click="action('voice')">
            选择模特音色
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <div v-if="status || error" class="cv3-character-assets-feedback">
          <p v-if="status" role="status">{{ status }}</p>
          <p v-if="error" role="alert">{{ error }}</p>
        </div>
      </div>
    </div>
    <div class="cv3-character-assets-name">
      <span>{{ character.name || '未命名模特' }}</span>
      <button
        v-if="personal"
        type="button"
        :disabled="busy"
        aria-label="删除模特"
        @click="action('remove', character)"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
        >
          <path
            d="M3.75 5.25h12.5M7.5 5.25v-2h5v2M5 5.25l.6 11h8.8l.6-11M8 8v5.5M12 8v5.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
    <footer class="cv3-character-assets-footer">
      <button
        type="button"
        class="cv3-character-assets-create"
        :disabled="busy"
        @click="action('create')"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
        >
          <circle cx="8" cy="5.5" r="2.7" />
          <path
            d="M11.5 11.1a5.5 5.5 0 0 0-9 4.2h6.3M14.7 10.8v6.4M11.5 14h6.4"
            stroke-linecap="round"
          />
        </svg>
        创建新模特
      </button>
      <div class="cv3-character-assets-actions">
        <button
          type="button"
          class="cv3-character-assets-insert"
          :disabled="busy || !canInsert"
          @click="action('insert', character)"
        >
          <CanvasIcon name="canvasInsert" :size="17" />
          添加到画布
        </button>
        <button
          type="button"
          class="cv3-character-assets-edit"
          :disabled="busy"
          @click="action('edit', character)"
        >
          <CanvasIcon name="character" :size="17" />
          编辑模特
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cv3-character-inner-scrim.cv3-character-asset-viewer {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
  background: rgb(36 36 36 / 94%);
  color: #eee;
  font:
    13px/1.5 Inter,
    system-ui,
    sans-serif;
}
.cv3-character-assets-overlay button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font: inherit;
  color: inherit;
  border: 0;
  cursor: pointer;
}
.cv3-character-assets-overlay button:disabled {
  cursor: default;
  opacity: 0.45;
}
.cv3-character-assets-overlay button:focus-visible {
  outline: 2px solid #aaa;
  outline-offset: 3px;
}
.cv3-character-assets-close {
  position: absolute;
  z-index: 2;
  top: 20px;
  right: 18px;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: #bcbcbc;
}
.cv3-character-assets-close:hover {
  background: #ffffff0b;
}
.cv3-character-assets-body {
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: auto;
  padding: 0 24px;
}
.cv3-character-assets-content {
  position: relative;
  width: min(920px, 100%);
  transform: translateY(47px);
}
.cv3-character-assets-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 164fr)) minmax(0, 392fr);
  gap: 12px;
}
.cv3-character-asset-slot {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
  height: 220px;
  min-width: 0;
  overflow: hidden;
  border-radius: 16px;
}
.cv3-character-asset-slot.is-missing {
  border: 1px solid #ffffff12;
  background: #ffffff0a;
  box-shadow: inset 0 0 0 1px #ffffff02;
}
.cv3-character-asset-slot > span {
  font-weight: 600;
}
.cv3-character-asset-slot > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
}
.cv3-character-asset-slot.is-half-body > img {
  object-fit: cover;
}
.cv3-character-assets-overlay .cv3-character-asset-generate {
  min-height: 36px;
  padding: 6px 13px;
  border: 1px solid #ffffff17;
  border-radius: 11px;
  background: #242424;
}
.cv3-character-asset-cost {
  color: #888;
  font-size: 12px;
}
.cv3-character-assets-voice {
  box-sizing: border-box;
  height: 62px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 20px;
  border: 1px solid #ffffff10;
  border-radius: 12px;
  background: #ffffff05;
}
.cv3-character-assets-voice button {
  min-height: 36px;
  padding: 6px 15px;
  border: 1px solid #ffffff17;
  border-radius: 11px;
  background: #222;
}
.cv3-character-assets-voice button > span {
  font-size: 19px;
  line-height: 1;
}
.cv3-character-assets-feedback {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
}
.cv3-character-assets-feedback p {
  margin: 0;
  color: #aaa;
}
.cv3-character-assets-feedback [role='alert'] {
  color: #edba84;
}
.cv3-character-assets-name {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 114px;
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  margin: 0;
  font-weight: 600;
}
.cv3-character-assets-name > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-character-assets-name button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: #aaa;
}
.cv3-character-assets-footer {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 88px;
  border-top: 1px solid #ffffff0d;
}
.cv3-character-assets-create {
  position: absolute;
  left: 32px;
  padding: 8px;
  background: transparent;
}
.cv3-character-assets-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cv3-character-assets-actions button {
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 12px;
}
.cv3-character-assets-insert {
  background: #303030;
}
.cv3-character-assets-overlay .cv3-character-assets-edit {
  color: #181818;
  background: #fff;
}
.cv3-character-assets-overlay button:hover:enabled:not(.cv3-character-assets-edit) {
  filter: brightness(1.15);
}
.cv3-character-asset-load-error {
  margin: 0;
  padding: 12px;
  color: #999;
  text-align: center;
}
@media (max-width: 800px) {
  .cv3-character-assets-body {
    padding-inline: 20px;
  }
  .cv3-character-assets-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .cv3-character-asset-slot {
    height: 200px;
  }
  .cv3-character-asset-slot.is-sheet {
    grid-column: 1 / -1;
  }
  .cv3-character-assets-content {
    transform: none;
  }
  .cv3-character-assets-create {
    position: static;
  }
  .cv3-character-assets-footer {
    justify-content: space-between;
    gap: 12px;
    padding-inline: 12px;
  }
  .cv3-character-assets-name {
    position: static;
    margin: 16px 24px;
  }
}
@media (max-height: 650px) {
  .cv3-character-assets-body {
    align-items: start;
  }
  .cv3-character-assets-content {
    transform: none;
  }
  .cv3-character-assets-name {
    position: static;
    margin: 12px 24px;
  }
  .cv3-character-assets-footer {
    height: 72px;
  }
}
@media (max-width: 500px) {
  .cv3-character-assets-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cv3-character-asset-slot {
    height: 190px;
  }
  .cv3-character-asset-slot.is-sheet {
    grid-column: auto;
  }
  .cv3-character-assets-footer {
    flex-wrap: wrap;
    height: auto;
    min-height: 88px;
    justify-content: center;
    padding-block: 10px;
  }
}
</style>

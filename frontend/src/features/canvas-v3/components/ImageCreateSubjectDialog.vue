<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiPath } from '../../../utils/apiBase'
import { useUserStore } from '../../../stores/user'
import { uploadBase64ImageDirect, uploadFileDirect } from '../../../utils/ossUpload'
import {
  imageAssetSourceUrl,
  loadImageAssetCollections,
  saveImageAssetCollections,
} from '../config/imageAssetCollections'
import {
  imageSubjectPayload,
  imageSubjectUploadFile,
  normalizeSubjectVoices,
} from '../config/imageSubject'
import { createCharacterAssetClient } from '../sync/characterAssetClient'
import { generateSubjectDescription } from '../sync/imageSubjectClient'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  sourceNode: { type: Object, required: true },
  voices: { type: Array, default: () => [] },
  generateDescription: { type: Function, default: null },
  completeViews: { type: Function, default: null },
})
const emit = defineEmits(['close', 'saved', 'error', 'add-voice'])
const user = useUserStore()
const client = createCharacterAssetClient({ path: apiPath, headers: () => user.authHeaders() })
const dialog = ref(null)
const closeButton = ref(null)
const uploadInput = ref(null)
const name = ref('')
const description = ref('')
const views = ref([])
const voiceId = ref('')
const selectedTags = ref([])
const picker = ref('')
const tagName = ref('')
const newTag = ref(false)
const notice = ref('')
const error = ref('')
const saving = ref(false)
const uploading = ref(false)
const assisting = ref(false)
const confirmCompletion = ref(false)
const exitConfirmation = ref(false)
const exitCancelButton = ref(null)
const exitDialog = ref(null)
const collections = ref(loadImageAssetCollections(globalThis.localStorage, user.profile?.id))
const sourceUrl = computed(() => imageAssetSourceUrl(props.sourceNode?.data?.assetUrl))
const voiceOptions = computed(() => normalizeSubjectVoices(props.voices))
const selectedVoice = computed(() => voiceOptions.value.find((voice) => voice.id === voiceId.value))
const busy = computed(() => saving.value || uploading.value || assisting.value)
const canSave = computed(() =>
  Boolean(
    !busy.value &&
    sourceUrl.value &&
    views.value.length > 0 &&
    name.value.trim() &&
    description.value.trim(),
  ),
)
const canGenerateDescription = computed(() =>
  Boolean(sourceUrl.value && (props.generateDescription || user.token)),
)
let disposed = false
let controller = null
let previousFocus
let audio = null

function close() {
  if (busy.value) return
  picker.value = ''
  exitConfirmation.value = true
}
function confirmExit() {
  if (busy.value) return
  controller?.abort()
  emit('close')
}
function togglePicker(value) {
  picker.value = picker.value === value ? '' : value
  newTag.value = false
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (exitConfirmation.value) exitConfirmation.value = false
    else if (picker.value) picker.value = ''
    else close()
  } else if (event.key === 'Tab') {
    const controls = [
      ...((exitConfirmation.value ? exitDialog.value : dialog.value)?.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      ) || []),
    ].filter((item) => item.getClientRects().length)
    const first = controls[0]
    const last = controls.at(-1)
    if (first && event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (last && !event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
function chooseVoice(voice) {
  voiceId.value = voice?.id || ''
  picker.value = ''
  audio?.pause()
}
function addVoice() {
  notice.value = '专属音色创建服务尚未接入，不会提交或扣费'
  picker.value = ''
  emit('add-voice')
}
function previewVoice(voice) {
  audio?.pause()
  if (!voice.previewUrl) {
    notice.value = '此音色暂无可用试听文件'
    return
  }
  audio = new Audio(voice.previewUrl)
  audio.play().catch(() => {
    if (!disposed) notice.value = '音色试听失败，请重试'
  })
}
function toggleTag(tag) {
  selectedTags.value = selectedTags.value.includes(tag)
    ? selectedTags.value.filter((value) => value !== tag)
    : [...selectedTags.value, tag]
}
function addTag() {
  const value = tagName.value.trim()
  if (
    !value ||
    value.length > 30 ||
    [...value].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    return
  try {
    collections.value = saveImageAssetCollections(globalThis.localStorage, user.profile?.id, {
      ...collections.value,
      tags: [...collections.value.tags, value],
    })
    if (!selectedTags.value.includes(value)) selectedTags.value.push(value)
    newTag.value = false
    tagName.value = ''
  } catch (failure) {
    error.value = failure.message
  }
}
async function uploadViews(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (!files.length || busy.value) return
  error.value = ''
  try {
    if (files.length + views.value.length > 5) throw new Error('最多添加 5 张其他视角图')
    files.forEach(imageSubjectUploadFile)
  } catch (failure) {
    error.value = failure.message
    return
  }
  if (!user.requireLogin()) return
  const token = user.token
  controller = new AbortController()
  uploading.value = true
  try {
    for (const file of files) {
      const result = await uploadFileDirect(file, {
        dir: 'character-studio',
        signal: controller.signal,
      })
      if (disposed || user.token !== token || controller.signal.aborted) return
      const url = imageAssetSourceUrl(typeof result === 'string' ? result : result.url)
      if (!url || url.startsWith('data:')) throw new Error('上传未返回可用图片地址，请重试')
      if (!views.value.some((view) => view.url === url)) views.value.push({ url, name: file.name })
    }
  } catch (failure) {
    if (!disposed && failure.name !== 'AbortError')
      error.value = failure.message || '视角图上传失败'
  } finally {
    if (!disposed) uploading.value = false
    controller = null
  }
}
async function assist(kind) {
  const action =
    kind === 'description'
      ? props.generateDescription ||
        ((request) =>
          generateSubjectDescription(request, { path: apiPath, headers: () => user.authHeaders() }))
      : props.completeViews
  if (!action || busy.value) return
  if (kind === 'description' && !user.requireLogin()) return
  if (kind === 'views') confirmCompletion.value = false
  error.value = ''
  controller = new AbortController()
  const token = user.token
  assisting.value = true
  if (kind === 'description')
    notice.value = '正在调用已配置的图像理解服务提取主体特征，不会自动保存或提交生图。'
  try {
    const result = await action({
      sourceNode: props.sourceNode,
      imageUrl: sourceUrl.value,
      viewUrls: views.value.map((view) => view.url),
      signal: controller.signal,
    })
    if (disposed || user.token !== token || controller.signal.aborted) return
    if (kind === 'description') {
      if (typeof result !== 'string' || !result.trim()) throw new Error('服务未返回有效主体描述')
      description.value = result.trim().slice(0, 100)
    } else {
      const urls = [
        ...new Set(
          (Array.isArray(result) ? result : [])
            .map(imageAssetSourceUrl)
            .filter((url) => url && !url.startsWith('data:')),
        ),
      ]
      if (!urls.length) throw new Error('服务未返回有效视角图')
      views.value = urls
        .slice(0, 5)
        .map((url, index) => ({ url, name: `智能补全视角 ${index + 1}` }))
    }
  } catch (failure) {
    if (!disposed && failure.name !== 'AbortError') error.value = failure.message || '智能处理失败'
  } finally {
    if (!disposed) assisting.value = false
    controller = null
  }
}
async function save() {
  if (!canSave.value || !user.requireLogin()) return
  error.value = ''
  // Whitelist and validate before uploading the source or writing any asset.
  const value = {
    name: name.value,
    description: description.value,
    imageUrl: sourceUrl.value,
    viewUrls: views.value.map((view) => view.url),
    tags: selectedTags.value,
    voiceId: selectedVoice.value?.id || '',
    sourceNodeId: props.sourceNode.id,
  }
  try {
    imageSubjectPayload({
      ...value,
      imageUrl: value.imageUrl.startsWith('data:')
        ? 'https://validation.invalid/image.png'
        : value.imageUrl,
    })
  } catch (failure) {
    error.value = failure.message
    return
  }
  controller = new AbortController()
  const signal = controller.signal
  const token = user.token
  saving.value = true
  try {
    if (value.imageUrl.startsWith('data:')) {
      value.imageUrl = await uploadBase64ImageDirect(value.imageUrl, {
        fileName: value.name,
        dir: 'character-studio',
        signal,
      })
      if (typeof value.imageUrl !== 'string') value.imageUrl = value.imageUrl?.url
    }
    if (disposed || user.token !== token || signal.aborted) return
    const saved = await client.save(imageSubjectPayload(value), { signal })
    if (disposed || user.token !== token || signal.aborted) return
    emit('saved', saved)
  } catch (failure) {
    if (!disposed && failure.name !== 'AbortError') {
      error.value = failure.message || '主体保存失败，请重试'
      emit('error', error.value)
    }
  } finally {
    if (!disposed) saving.value = false
    controller = null
  }
}
watch(
  () => user.token,
  () => {
    controller?.abort()
    emit('close')
  },
)
onMounted(async () => {
  previousFocus = document.activeElement
  await nextTick()
  closeButton.value?.focus()
})
watch(exitConfirmation, async (value) => {
  await nextTick()
  if (disposed) return
  if (value) exitCancelButton.value?.focus()
  else closeButton.value?.focus()
})
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
  audio?.pause()
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div class="cv3-subject-backdrop" @pointerdown.self="close" @contextmenu.prevent>
      <section
        ref="dialog"
        class="cv3-subject-dialog"
        :inert="exitConfirmation || undefined"
        data-cv3-image-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv3-subject-title"
        @keydown="keydown"
        @pointerdown.stop
        @click="picker = ''"
      >
        <header>
          <h2 id="cv3-subject-title">创建主体</h2>
          <button
            ref="closeButton"
            type="button"
            class="cv3-subject-close"
            aria-label="关闭创建主体"
            :disabled="busy"
            @click="close"
          >
            <CanvasIcon name="close" :size="16" />
          </button>
        </header>
        <form @submit.prevent="save">
          <div class="cv3-subject-views">
            <div v-if="sourceUrl" class="cv3-subject-view">
              <img
                :src="sourceUrl"
                :alt="sourceNode.data?.title || '主体参考图'"
                draggable="false"
              />
            </div>
            <div v-for="(view, index) in views" :key="view.url" class="cv3-subject-view">
              <img :src="view.url" :alt="view.name" draggable="false" />
              <button
                type="button"
                :aria-label="`移除视角 ${index + 1}`"
                :disabled="busy"
                @click="views.splice(index, 1)"
              >
                <CanvasIcon name="close" :size="12" />
              </button>
            </div>
            <div v-if="views.length < 5" class="cv3-subject-add">
              <button
                type="button"
                class="cv3-subject-add-view"
                :disabled="busy"
                aria-label="添加其他视角图"
                @click="uploadInput?.click()"
              >
                <CanvasIcon name="plus" :size="28" />
                <span>
                  {{ uploading ? '正在上传…' : '添加其他视角图' }}
                  <i>*</i>
                </span>
              </button>
              <button
                type="button"
                class="cv3-subject-complete"
                :disabled="busy || !completeViews"
                :title="
                  completeViews
                    ? '需确认后才会提交智能补全任务'
                    : '多视角智能补全服务尚未接入，可手动添加视角图'
                "
                @click="confirmCompletion = true"
              >
                ϟ 6&nbsp; 智能补全
              </button>
            </div>
          </div>
          <input
            ref="uploadInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            @change="uploadViews"
          />
          <label class="cv3-subject-field cv3-subject-name">
            <span>
              主体名称
              <i>*</i>
            </span>
            <div class="cv3-subject-input">
              <input
                v-model="name"
                maxlength="20"
                placeholder="请输入主体名称"
                :disabled="busy"
                required
                aria-label="主体名称"
              />
              <small>{{ name.length }}/20</small>
            </div>
          </label>
          <div class="cv3-subject-two-col">
            <div class="cv3-subject-field">
              <span>
                音色
                <button
                  type="button"
                  class="cv3-subject-help"
                  aria-label="音色使用说明"
                  title="音色与主体一起保存，生成配音需另外接入对应音色服务。无配音不会调用语音服务。"
                  @click.stop="
                    notice =
                      '音色与主体一起保存。无配音不会调用语音服务；专有音色需要实际语音服务支持。'
                  "
                >
                  ?
                </button>
              </span>
              <div class="cv3-subject-picker" @click.stop>
                <button
                  type="button"
                  class="cv3-subject-trigger"
                  :disabled="busy"
                  :aria-expanded="picker === 'voice'"
                  @click="togglePicker('voice')"
                >
                  <span>{{ selectedVoice?.name || '无配音' }}</span>
                  <CanvasIcon name="chevron" :size="12" />
                </button>
                <div
                  v-if="picker === 'voice'"
                  class="cv3-subject-dropdown cv3-subject-voices"
                  role="listbox"
                  aria-label="选择音色"
                >
                  <button
                    type="button"
                    role="option"
                    :aria-selected="!voiceId"
                    @click="chooseVoice(null)"
                  >
                    <span class="cv3-subject-voice-mark">⊘</span>
                    无配音
                    <span v-if="!voiceId" class="cv3-subject-check">✓</span>
                  </button>
                  <div
                    v-for="voice in voiceOptions"
                    :key="voice.id"
                    class="cv3-subject-voice-option"
                  >
                    <button
                      type="button"
                      :aria-label="`试听${voice.name}`"
                      @click="previewVoice(voice)"
                    >
                      ▷
                    </button>
                    <button
                      type="button"
                      role="option"
                      :aria-selected="voiceId === voice.id"
                      @click="chooseVoice(voice)"
                    >
                      {{ voice.name }}
                      <small v-if="voice.official">官方</small>
                      <span v-if="voiceId === voice.id" class="cv3-subject-check">✓</span>
                    </button>
                  </div>
                  <p v-if="!voiceOptions.length">专有音色服务尚未接入</p>
                  <button type="button" class="cv3-subject-add-voice" @click="addVoice">
                    ＋&nbsp; 添加音色
                  </button>
                </div>
              </div>
            </div>
            <div class="cv3-subject-field">
              <span>标签</span>
              <div class="cv3-subject-picker" @click.stop>
                <button
                  type="button"
                  class="cv3-subject-trigger"
                  :disabled="busy"
                  :aria-expanded="picker === 'tags'"
                  @click="togglePicker('tags')"
                >
                  <span>{{ selectedTags.join('、') || '请选择标签' }}</span>
                  <CanvasIcon name="chevron" :size="12" />
                </button>
                <div v-if="picker === 'tags'" class="cv3-subject-dropdown cv3-subject-tags">
                  <div class="cv3-subject-dropdown-title">
                    标签
                    <button type="button" aria-label="新建标签" @click="newTag = !newTag">
                      ＋
                    </button>
                  </div>
                  <div v-if="newTag" class="cv3-subject-new-tag">
                    <input
                      v-model="tagName"
                      maxlength="30"
                      placeholder="输入标签名称"
                      aria-label="新标签名称"
                      @keydown.enter.prevent="addTag"
                    />
                    <button type="button" @click="addTag">添加</button>
                  </div>
                  <button
                    v-for="tag in collections.tags"
                    :key="tag"
                    type="button"
                    :aria-pressed="selectedTags.includes(tag)"
                    @click="toggleTag(tag)"
                  >
                    {{ tag }}
                    <span v-if="selectedTags.includes(tag)">✓</span>
                  </button>
                  <p>自建标签保存在本机当前账号</p>
                </div>
              </div>
            </div>
          </div>
          <label class="cv3-subject-field">
            <span>
              主体描述
              <i>*</i>
            </span>
            <div class="cv3-subject-description">
              <textarea
                v-model="description"
                required
                maxlength="100"
                :disabled="busy"
                aria-label="主体描述"
                placeholder="描述主体的核心特征或者描述希望保留的细节，不超过100字"
              />
              <button
                type="button"
                :disabled="busy || !canGenerateDescription"
                :title="
                  canGenerateDescription
                    ? '调用已配置的图像理解模型，服务用量按实际配置计算'
                    : '登录后可调用图像理解服务，也可手动填写主体描述'
                "
                @click="assist('description')"
              >
                {{ assisting ? '识别中…' : '✧ 智能生成' }}
              </button>
            </div>
          </label>
          <p v-if="error" class="cv3-subject-error" role="alert">{{ error }}</p>
          <p v-if="notice" class="cv3-subject-notice" role="status">{{ notice }}</p>
          <div
            v-if="confirmCompletion"
            class="cv3-subject-confirm"
            role="alertdialog"
            aria-label="确认智能补全"
          >
            <p>
              将调用已接入的多视角生成服务，可能产生费用。界面示意点数不代表当前服务实际价格，请先确认服务计费后再继续。
            </p>
            <div>
              <button type="button" @click="confirmCompletion = false">取消</button>
              <button type="button" @click="assist('views')">确认提交</button>
            </div>
          </div>
          <footer>
            <button type="button" :disabled="busy" @click="close">取消</button>
            <button type="submit" class="cv3-subject-save" :disabled="!canSave">
              {{ saving ? '创建中…' : '创建' }}
            </button>
          </footer>
        </form>
      </section>
      <div
        v-if="exitConfirmation"
        class="cv3-subject-exit-backdrop"
        @pointerdown.stop
        @keydown="keydown"
      >
        <section
          ref="exitDialog"
          class="cv3-subject-exit"
          data-cv3-image-dialog
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cv3-subject-exit-title"
          aria-describedby="cv3-subject-exit-message"
        >
          <h3 id="cv3-subject-exit-title">
            <span aria-hidden="true">!</span>
            确定要退出?
          </h3>
          <p id="cv3-subject-exit-message">关闭将不会保存任何更改。</p>
          <div>
            <button ref="exitCancelButton" type="button" @click="exitConfirmation = false">
              取消
            </button>
            <button type="button" class="cv3-subject-exit-confirm" @click="confirmExit">
              确定
            </button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-subject-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #0009;
  backdrop-filter: blur(5px);
  color: #fff;
  font-family: inherit;
}
.cv3-subject-dialog {
  width: 680px;
  max-width: 100%;
  max-height: calc(100dvh - 48px);
  overflow: auto;
  border: 1px solid #363636;
  border-radius: 12px;
  background: #262626;
  box-shadow: 0 8px 32px #0004;
  font-size: 13px;
  line-height: 20px;
}
.cv3-subject-dialog * {
  box-sizing: border-box;
}
.cv3-subject-dialog button,
.cv3-subject-dialog input,
.cv3-subject-dialog textarea {
  font: inherit;
  color: inherit;
}
.cv3-subject-dialog button {
  cursor: pointer;
  border: 0;
  background: none;
}
.cv3-subject-dialog button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.cv3-subject-dialog button:focus-visible,
.cv3-subject-dialog input:focus-visible,
.cv3-subject-dialog textarea:focus-visible {
  outline: 1px solid #aaa;
  outline-offset: 2px;
}
.cv3-subject-dialog header {
  height: 49px;
  padding: 12px 16px;
  border-bottom: 1px solid #363636;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cv3-subject-dialog h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.cv3-subject-close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: #888 !important;
}
.cv3-subject-dialog form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.cv3-subject-views {
  display: flex;
  align-items: stretch;
  gap: 12px;
  overflow-x: auto;
  min-height: 203px;
  padding-bottom: 1px;
}
.cv3-subject-view {
  position: relative;
  flex: 0 0 152px;
  height: 203px;
  border-radius: 8px;
  overflow: hidden;
  background: #1f1f1f;
}
.cv3-subject-view img {
  height: 100%;
  width: 100%;
  object-fit: cover;
}
.cv3-subject-view > button {
  position: absolute;
  right: 6px;
  top: 6px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #0009;
}
.cv3-subject-add {
  display: flex;
  flex: 0 0 152px;
  height: 203px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid #444;
  border-radius: 8px;
}
.cv3-subject-add-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #b0b0b0 !important;
}
.cv3-subject-add-view span {
  font-size: 12px;
  white-space: nowrap;
}
.cv3-subject-dialog i {
  font-style: normal;
  color: #929292;
  margin-left: 2px;
}
.cv3-subject-complete {
  padding: 4px 8px !important;
  font-size: 12px !important;
  border-radius: 6px !important;
  background: #333 !important;
  color: #ddd !important;
  line-height: 20px;
}
.cv3-subject-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cv3-subject-field > span {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: #d1d1d1;
}
.cv3-subject-name {
  width: 276px;
  max-width: 100%;
}
.cv3-subject-input {
  display: flex;
  align-items: center;
  height: 32px;
  border: 1px solid #404040;
  border-radius: 8px;
  background: #2e2e2e;
  padding-right: 8px;
}
.cv3-subject-input input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  padding: 0 8px;
  outline: none;
}
.cv3-subject-input small {
  white-space: nowrap;
  color: #777;
  font-size: 12px;
}
.cv3-subject-dialog input::placeholder,
.cv3-subject-dialog textarea::placeholder {
  color: #777;
}
.cv3-subject-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.cv3-subject-help {
  border: 1px solid #888 !important;
  border-radius: 50%;
  width: 12px;
  height: 12px;
  line-height: 10px !important;
  padding: 0;
  font-size: 9px !important;
  color: #888 !important;
  margin-left: 2px;
}
.cv3-subject-picker {
  position: relative;
  min-width: 0;
}
.cv3-subject-trigger {
  height: 32px;
  width: 100%;
  padding: 0 8px !important;
  background: #2e2e2e !important;
  border: 1px solid #404040 !important;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.cv3-subject-trigger > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-subject-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 3;
  background: #262626;
  border: 1px solid #414141;
  border-radius: 12px;
  box-shadow: 0 8px 24px #0006;
  padding: 4px;
  max-height: 280px;
  overflow: auto;
}
.cv3-subject-dropdown > button,
.cv3-subject-voice-option {
  height: 36px;
  width: 100%;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border-radius: 8px;
}
.cv3-subject-dropdown > button:hover,
.cv3-subject-voice-option:hover {
  background: #353535;
}
.cv3-subject-voice-option > button:first-child {
  padding: 0;
  width: 16px;
}
.cv3-subject-voice-option > button:last-child {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  padding: 0;
  height: 100%;
  text-align: left;
}
.cv3-subject-voice-option small {
  font-size: 10px;
  background: #3b3b3b;
  border-radius: 3px;
  padding: 0 3px;
  color: #bbb;
  line-height: 16px;
}
.cv3-subject-check {
  margin-left: auto;
}
.cv3-subject-voice-mark {
  width: 16px;
  font-size: 18px;
}
.cv3-subject-dropdown p {
  font-size: 11px;
  color: #888;
  margin: 8px;
  line-height: 16px;
}
.cv3-subject-add-voice {
  border-top: 1px solid #363636 !important;
  border-radius: 0 !important;
  margin-top: 4px;
  height: 40px !important;
}
.cv3-subject-dropdown-title {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  color: #999;
  font-size: 12px;
}
.cv3-subject-dropdown-title button {
  font-size: 20px;
}
.cv3-subject-tags > button {
  justify-content: space-between;
  height: 32px;
}
.cv3-subject-new-tag {
  display: flex;
  gap: 6px;
  padding: 4px;
}
.cv3-subject-new-tag input {
  min-width: 0;
  width: 100%;
  border: 1px solid #555;
  border-radius: 4px;
  background: #222;
  padding: 4px;
}
.cv3-subject-new-tag button {
  white-space: nowrap;
}
.cv3-subject-description {
  position: relative;
  height: 100px;
  border: 1px solid #414141;
  border-radius: 8px;
  background: #2e2e2e;
}
.cv3-subject-description textarea {
  width: 100%;
  height: 100%;
  padding: 8px 10px 32px;
  resize: none;
  border: 0;
  background: none;
  outline: none;
}
.cv3-subject-description button {
  position: absolute;
  right: 6px;
  bottom: 5px;
  line-height: 20px;
  padding: 0 6px;
  background: #3c3c3c;
  border-radius: 6px;
  font-size: 12px;
}
.cv3-subject-error,
.cv3-subject-notice {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: #ffb1aa;
}
.cv3-subject-notice {
  color: #aaa;
}
.cv3-subject-exit-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0006;
  backdrop-filter: blur(1px);
  z-index: 1;
}
.cv3-subject-exit {
  width: 300px;
  max-width: calc(100vw - 32px);
  padding: 16px;
  border: 1px solid #444;
  border-radius: 12px;
  background: #262626;
  box-shadow: 0 8px 32px #0004;
  font-size: 13px;
  line-height: 20px;
}
.cv3-subject-exit h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px;
}
.cv3-subject-exit h3 > span {
  width: 14px;
  height: 14px;
  line-height: 12px;
  text-align: center;
  border: 1px solid #f26464;
  border-radius: 50%;
  color: #f26464;
  font-size: 10px;
}
.cv3-subject-exit p {
  margin: 0 0 16px;
  padding-left: 22px;
  color: #b0b0b0;
}
.cv3-subject-exit > div {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.cv3-subject-exit button {
  height: 28px;
  padding: 0 12px;
  font: inherit;
  line-height: 20px;
  background: #3a3a3a;
  color: #fff;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.cv3-subject-exit button:focus-visible {
  outline: 1px solid #ddd;
  outline-offset: 2px;
}
.cv3-subject-exit .cv3-subject-exit-confirm {
  background: #e04f4f;
}
.cv3-subject-confirm {
  padding: 12px;
  border: 1px solid #555;
  border-radius: 8px;
  background: #202020;
  font-size: 12px;
}
.cv3-subject-confirm p {
  margin: 0 0 12px;
}
.cv3-subject-confirm > div {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.cv3-subject-confirm button {
  background: #3b3b3b;
  padding: 4px 10px;
  border-radius: 6px;
}
.cv3-subject-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 0;
}
.cv3-subject-dialog footer button {
  height: 32px;
  padding: 0 12px;
  background: #333;
  border-radius: 8px;
}
.cv3-subject-dialog footer .cv3-subject-save {
  background: #f5f5f5;
  color: #171717;
}
@media (max-width: 560px) {
  .cv3-subject-backdrop {
    padding: 12px;
  }
  .cv3-subject-two-col {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cv3-subject-dialog {
    max-height: calc(100dvh - 24px);
  }
}
</style>

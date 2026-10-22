<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  type: {
    type: String,
    default: 'execute-confirm',
    validator: (value) => ['execute-confirm', 'toolbox'].includes(value),
  },
  groupName: { type: String, default: 'Group 1' },
  generationCount: { type: Number, default: 0 },
  templates: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  progress: { type: [Object, String], default: null },
  hasSavedSnapshot: { type: Boolean, default: true },
})
const emit = defineEmits(['confirm', 'cancel', 'load', 'remove'])
const dialog = ref(null)
const nameInput = ref(null)
const confirmButton = ref(null)
const name = ref('')
const attempted = ref(false)
const removing = ref('')
const id = `cv3-group-workflow-${useId()}`
const isExecution = computed(() => props.type === 'execute-confirm')
const heading = computed(() => (isExecution.value ? '整组执行' : '添加到工具箱'))
const count = computed(() => Math.max(0, Math.floor(Number(props.generationCount) || 0)))
const validName = computed(
  () =>
    name.value.trim().length > 0 &&
    name.value.trim().length <= 100 &&
    ![...name.value].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    ),
)
const canConfirm = computed(
  () =>
    props.hasSavedSnapshot &&
    !props.busy &&
    (isExecution.value ? count.value > 0 : validName.value),
)
const records = computed(() => {
  const ids = new Set()
  return props.templates
    .filter((record) => {
      if (typeof record?.id !== 'string' || !record.id || ids.has(record.id)) return false
      ids.add(record.id)
      return true
    })
    .slice(0, 20)
})
const progressText = computed(() => {
  if (typeof props.progress === 'string') return props.progress
  if (!props.progress) return ''
  const total = Math.max(0, Math.floor(Number(props.progress.total) || 0))
  const completed = Math.max(0, Math.min(total, Math.floor(Number(props.progress.completed) || 0)))
  return total ? `已完成 ${completed} / ${total} 个生成节点` : ''
})
let previousFocus = null
let openRevision = 0

function restoreFocus() {
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
  previousFocus = null
}
function cancel() {
  if (props.open) emit('cancel')
}
function confirm() {
  if (!props.open || props.busy) return
  attempted.value = true
  if (!canConfirm.value) return
  if (isExecution.value) emit('confirm')
  else emit('confirm', name.value.trim())
}
function load(record) {
  if (props.open && !props.busy && records.value.some((item) => item.id === record.id))
    emit('load', record.id)
}
function remove(record) {
  if (!props.open || props.busy || !records.value.some((item) => item.id === record.id)) return
  if (removing.value !== record.id) {
    removing.value = record.id
    return
  }
  removing.value = ''
  emit('remove', record.id)
}
function keydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (removing.value) removing.value = ''
    else cancel()
  } else if (event.key === 'Tab') {
    const focusable = [
      ...(dialog.value?.querySelectorAll?.(
        'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
      ) || []),
    ]
    const first = focusable[0]
    const last = focusable.at(-1)
    const active = document.activeElement
    if (!first) {
      event.preventDefault()
      dialog.value?.focus?.({ preventScroll: true })
    } else if (event.shiftKey && (active === first || active === dialog.value)) {
      event.preventDefault()
      last?.focus?.({ preventScroll: true })
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus?.({ preventScroll: true })
    }
  }
}
watch(
  () => [props.open, props.type],
  async ([open], previous) => {
    const revision = ++openRevision
    if (!open) {
      if (previous?.[0]) restoreFocus()
      return
    }
    if (!previous?.[0]) previousFocus = document.activeElement
    name.value = props.groupName.slice(0, 100)
    attempted.value = false
    removing.value = ''
    await nextTick()
    if (!props.open || revision !== openRevision) return
    if (!isExecution.value && !props.busy) nameInput.value?.focus?.({ preventScroll: true })
    else if (canConfirm.value) confirmButton.value?.focus?.({ preventScroll: true })
    else dialog.value?.focus?.({ preventScroll: true })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  openRevision += 1
  restoreFocus()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cv3-group-dialog-backdrop"
      data-cv3-selection-ui
      @pointerdown.self="cancel"
      @keydown="keydown"
    >
      <section
        ref="dialog"
        class="cv3-group-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        :aria-describedby="`${id}-description`"
        :aria-busy="busy"
        tabindex="-1"
        @pointerdown.stop
      >
        <header>
          <h2 :id="`${id}-title`">{{ heading }}</h2>
          <button type="button" :aria-label="`关闭${heading}`" @click="cancel">×</button>
        </header>
        <div class="cv3-group-dialog-content">
          <template v-if="isExecution">
            <p :id="`${id}-description`">将执行「{{ groupName }}」中 {{ count }} 个待生成节点。</p>
            <p class="cv3-group-dialog-warning">
              每个节点会按其当前模型、生成数量与参数提交，可能产生费用。
              已有图片或视频仅作为参考，不会重新生成；有依赖的节点会等待上游成功后继续。
            </p>
            <p v-if="!count" class="cv3-group-dialog-note">
              组内没有待生成节点。请先填写提示词或添加待生成的图片、视频节点。
            </p>
            <p v-if="busy" class="cv3-group-dialog-note">
              停止只会取消后续提交，不会撤销已提交的任务；已提交的任务仍可能完成并产生费用。
            </p>
            <p
              v-if="progressText"
              class="cv3-group-dialog-progress"
              role="status"
              aria-live="polite"
            >
              {{ progressText }}
            </p>
          </template>
          <template v-else>
            <p :id="`${id}-description`" class="cv3-group-dialog-note">
              将分组保存为可重复添加到画布的模板。工具箱仅保存在当前浏览器，并按登录账号隔离，不会上传到云端。
            </p>
            <label class="cv3-group-template-name">
              <span>
                模板名称
                <em>*</em>
              </span>
              <input
                ref="nameInput"
                v-model="name"
                type="text"
                maxlength="100"
                autocomplete="off"
                aria-label="模板名称"
                :aria-invalid="attempted && !validName"
                :aria-describedby="attempted && !validName ? `${id}-name-error` : undefined"
                :disabled="busy"
                @keydown.enter.prevent="confirm"
              />
            </label>
            <p
              v-if="attempted && !validName"
              :id="`${id}-name-error`"
              class="cv3-group-dialog-error"
              role="alert"
            >
              请输入 1～100 个字符的模板名称，不支持控制字符。
            </p>
            <section class="cv3-group-toolbox-list" aria-label="本机工具箱模板">
              <h3>
                本机工具箱
                <small>{{ records.length }} / 20</small>
              </h3>
              <p v-if="!records.length" class="cv3-group-dialog-note">还没有保存的分组模板</p>
              <ul v-else>
                <li v-for="record in records" :key="record.id">
                  <div class="cv3-group-template-info">
                    <strong :title="record.name">{{ record.name || '未命名分组' }}</strong>
                    <small>{{ Math.max(0, Number(record.nodeCount) || 0) }} 个节点</small>
                  </div>
                  <template v-if="removing === record.id">
                    <span class="cv3-group-remove-question">确认移除？</span>
                    <button type="button" :disabled="busy" @click="removing = ''">取消</button>
                    <button
                      type="button"
                      class="is-danger"
                      :aria-label="`确认移除模板 ${record.name}`"
                      :disabled="busy"
                      @click="remove(record)"
                    >
                      移除
                    </button>
                  </template>
                  <template v-else>
                    <button
                      type="button"
                      :aria-label="`添加模板 ${record.name} 到画布`"
                      :disabled="busy"
                      @click="load(record)"
                    >
                      添加到画布
                    </button>
                    <button
                      type="button"
                      :aria-label="`移除模板 ${record.name}`"
                      :disabled="busy"
                      @click="remove(record)"
                    >
                      移除
                    </button>
                  </template>
                </li>
              </ul>
            </section>
          </template>
          <p v-if="!hasSavedSnapshot" class="cv3-group-dialog-error" role="alert">
            原分组已改变或不可用，请关闭后重新选择分组。
          </p>
          <p v-if="error" class="cv3-group-dialog-error" role="alert">{{ error }}</p>
        </div>
        <footer>
          <button type="button" @click="cancel">
            {{ busy && isExecution ? '停止后续执行' : '取消' }}
          </button>
          <button
            ref="confirmButton"
            type="button"
            class="is-primary"
            :disabled="!canConfirm"
            @click="confirm"
          >
            {{
              busy
                ? isExecution
                  ? '执行中…'
                  : '保存中…'
                : isExecution
                  ? '确认执行'
                  : '保存到工具箱'
            }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-group-dialog-backdrop {
  position: fixed;
  z-index: 260;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: #0009;
  backdrop-filter: blur(3px);
}
.cv3-group-dialog {
  width: 480px;
  max-width: 100%;
  max-height: min(520px, calc(100dvh - 40px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid #464646;
  border-radius: 16px;
  background: #262626;
  color: #ededed;
  box-shadow: 0 16px 60px #0006;
  font:
    13px/1.6 Arial,
    'Microsoft YaHei',
    sans-serif;
  outline: none;
}
.cv3-group-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 0 20px;
  border-bottom: 1px solid #3b3b3b;
}
.cv3-group-dialog h2,
.cv3-group-dialog h3 {
  margin: 0;
  font: inherit;
  font-weight: 600;
}
.cv3-group-dialog header button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  color: #aaa;
  font-size: 23px;
}
.cv3-group-dialog-content {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px;
}
.cv3-group-dialog p {
  margin: 0 0 12px;
}
.cv3-group-dialog p:last-child {
  margin-bottom: 0;
}
.cv3-group-dialog-note,
.cv3-group-template-info small,
.cv3-group-toolbox-list h3 small {
  color: #969696;
}
.cv3-group-dialog-warning {
  padding: 12px;
  border: 1px solid #66563b;
  border-radius: 8px;
  background: #453a272e;
  color: #d8bc89;
}
.cv3-group-dialog-error {
  margin-top: 10px !important;
  color: #f09b91;
}
.cv3-group-dialog-progress {
  color: #70c6ee;
}
.cv3-group-template-name {
  display: grid;
  gap: 7px;
  margin: 16px 0;
}
.cv3-group-template-name em {
  color: #e28d86;
  font-style: normal;
}
.cv3-group-template-name input {
  width: 100%;
  height: 36px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #4c4c4c;
  border-radius: 7px;
  background: #303030;
  color: #eee;
  font: inherit;
}
.cv3-group-template-name input[aria-invalid='true'] {
  border-color: #b96961;
}
.cv3-group-toolbox-list {
  border-top: 1px solid #3d3d3d;
  padding-top: 14px;
}
.cv3-group-toolbox-list h3 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.cv3-group-toolbox-list h3 small {
  font-weight: 400;
}
.cv3-group-toolbox-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.cv3-group-toolbox-list li {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 0;
  border-bottom: 1px solid #373737;
}
.cv3-group-toolbox-list li:last-child {
  border-bottom: 0;
}
.cv3-group-template-info {
  flex: 1;
  min-width: 70px;
  display: grid;
}
.cv3-group-template-info strong {
  overflow: hidden;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-group-remove-question {
  color: #c7a17d;
  font-size: 12px;
}
.cv3-group-dialog button {
  font: inherit;
  cursor: pointer;
}
.cv3-group-toolbox-list button {
  flex-shrink: 0;
  min-height: 28px;
  padding: 3px 7px;
  border: 1px solid #4a4a4a;
  border-radius: 5px;
  background: #303030;
  color: #ccc;
  font-size: 12px;
}
.cv3-group-toolbox-list button.is-danger {
  border-color: #78504b;
  color: #f09b91;
}
.cv3-group-dialog footer {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 20px 16px;
  border-top: 1px solid #3b3b3b;
}
.cv3-group-dialog footer button {
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid #4a4a4a;
  border-radius: 7px;
  background: #333;
  color: #eee;
}
.cv3-group-dialog footer button.is-primary {
  border-color: #eee;
  background: #eee;
  color: #222;
}
.cv3-group-dialog button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.cv3-group-dialog button:not(:disabled):hover {
  filter: brightness(1.17);
}
.cv3-group-dialog button:focus-visible,
.cv3-group-template-name input:focus-visible {
  outline: 2px solid #68aaf6;
  outline-offset: 2px;
}
@media (max-width: 480px) {
  .cv3-group-dialog-backdrop {
    padding: 12px;
  }
  .cv3-group-dialog-content {
    padding: 16px;
  }
  .cv3-group-toolbox-list li {
    flex-wrap: wrap;
  }
  .cv3-group-template-info {
    flex-basis: 45%;
  }
}
</style>

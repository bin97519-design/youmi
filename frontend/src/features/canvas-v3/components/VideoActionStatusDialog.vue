<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

const props = defineProps({
  node: { type: Object, default: null },
  action: { type: String, default: 'compliance' },
})
const emit = defineEmits(['close'])
const titles = {
  compliance: 'Seedance合规校验',
  reshoot: '片段重拍',
  frames: '逐帧拉片',
  'remove-subtitles': '智能去字幕',
  separate: '音视频分离',
  replace: '元素替换',
  intro: '创意片头',
  enhance: '视频高清',
}
const title = computed(() => titles[props.action] || '视频处理')
const isCompliance = computed(() => props.action === 'compliance')
const sourceTitle = computed(() => props.node?.data?.title || '未命名视频')
const source = computed(() => props.node?.data?.assetUrl || '')
const dialog = ref(null)
const closeButton = ref(null)
const status = ref('pending')
const details = ref(null)
const error = ref('')
const headingId = `cv3-video-action-title-${useId()}`
let previousFocus
let mounted = false
let disposed = false
let requestId = 0
let controller

function safeVideoSource(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const url = new URL(value)
    if (!['https:', 'http:', 'blob:'].includes(url.protocol) || url.username || url.password)
      return ''
    return url.href
  } catch {
    return ''
  }
}
function ratioLabel(width, height) {
  let a = Math.round(width)
  let b = Math.round(height)
  while (b) [a, b] = [b, a % b]
  return `${Math.round(width) / a}:${Math.round(height) / a}`
}
function readVideoMetadata(url, signal) {
  return new Promise((resolve, reject) => {
    const document = globalThis.document
    if (!document?.createElement) {
      reject(new Error('当前环境无法读取视频元数据'))
      return
    }
    if (signal.aborted) {
      reject(signal.reason || new DOMException('已取消读取', 'AbortError'))
      return
    }
    const video = document.createElement('video')
    let settled = false
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('loadedmetadata', loaded)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      try {
        video.pause()
        video.removeAttribute('src')
        video.load()
      } catch {
        // Releasing an unattached decoder must not mask the actual load result.
      }
    }
    function finish(callback, value) {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    function loaded() {
      const width = Number(video.videoWidth)
      const height = Number(video.videoHeight)
      const duration = Number(video.duration)
      if (
        !Number.isFinite(width) ||
        width <= 0 ||
        !Number.isFinite(height) ||
        height <= 0 ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        finish(reject, new Error('视频没有可读取的有效尺寸或有限时长'))
        return
      }
      finish(resolve, { width, height, duration, ratio: ratioLabel(width, height) })
    }
    function failed() {
      finish(reject, new Error('浏览器无法读取该视频，请检查地址、访问权限或视频编码格式'))
    }
    function aborted() {
      finish(reject, signal.reason || new DOMException('已取消读取', 'AbortError'))
    }
    video.addEventListener('loadedmetadata', loaded)
    video.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    const timer = setTimeout(() => finish(reject, new Error('读取视频元数据超时，请重试')), 15000)
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    try {
      video.src = url
      video.load()
    } catch (failure) {
      finish(reject, failure instanceof Error ? failure : new Error('视频元数据读取失败'))
    }
  })
}
async function check() {
  const id = ++requestId
  controller?.abort()
  controller = null
  details.value = null
  error.value = ''
  if (!isCompliance.value) {
    status.value = 'unavailable'
    return
  }
  status.value = 'loading'
  const url = safeVideoSource(source.value)
  if (!url) {
    status.value = 'error'
    error.value = '视频地址无效，无法读取基础参数'
    return
  }
  const current = new AbortController()
  controller = current
  try {
    const value = await readVideoMetadata(url, current.signal)
    if (disposed || id !== requestId || current.signal.aborted) return
    details.value = value
    status.value = 'ready'
  } catch (failure) {
    if (disposed || id !== requestId || current.signal.aborted) return
    status.value = 'error'
    error.value = failure.message || '读取视频失败'
  } finally {
    if (id === requestId) controller = null
  }
}
function close() {
  ++requestId
  controller?.abort()
  controller = null
  emit('close')
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [...(dialog.value?.querySelectorAll('button:not(:disabled)') || [])]
  const first = controls[0]
  const last = controls.at(-1)
  const active = globalThis.document?.activeElement
  if (!first) {
    event.preventDefault()
    dialog.value?.focus()
  } else if (event.shiftKey && (active === first || !dialog.value?.contains(active))) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && (active === last || !dialog.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}
watch([source, () => props.action], () => {
  if (mounted && !disposed) void check()
})
onMounted(async () => {
  mounted = true
  previousFocus = globalThis.document?.activeElement
  await nextTick()
  if (disposed) return
  closeButton.value?.focus({ preventScroll: true })
  void check()
})
onBeforeUnmount(() => {
  disposed = true
  ++requestId
  controller?.abort()
  controller = null
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
})
</script>

<template>
  <div
    class="cv3-video-status-backdrop"
    data-cv3-video-dialog
    @pointerdown.self="close"
    @contextmenu.prevent
  >
    <section
      ref="dialog"
      class="cv3-video-status-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="headingId"
      tabindex="-1"
      @pointerdown.stop
      @keydown="keydown"
    >
      <header>
        <h2 :id="headingId">{{ title }}</h2>
        <button ref="closeButton" type="button" :aria-label="`关闭${title}`" @click="close">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10m0-10L5 15" /></svg>
        </button>
      </header>
      <div class="cv3-video-status-body">
        <p class="cv3-video-status-source" :title="sourceTitle">{{ sourceTitle }}</p>
        <template v-if="isCompliance">
          <p class="cv3-video-status-disclaimer">
            仅检查视频能否读取及基础参数，尚未接入 Seedance
            官方合规审核；本地检查不代表官方审核通过。
          </p>
          <dl aria-label="本地视频参数">
            <div>
              <dt>浏览器读取</dt>
              <dd role="status" aria-live="polite">
                {{
                  status === 'ready'
                    ? '已读取元数据'
                    : status === 'error'
                      ? '读取失败'
                      : '正在读取…'
                }}
              </dd>
            </div>
            <div>
              <dt>实际像素尺寸</dt>
              <dd>{{ details ? `${details.width} × ${details.height} px` : '尚未读取' }}</dd>
            </div>
            <div>
              <dt>实际时长</dt>
              <dd>{{ details ? `${details.duration.toFixed(2)} 秒` : '尚未读取' }}</dd>
            </div>
            <div>
              <dt>实际比例</dt>
              <dd>{{ details?.ratio || '尚未读取' }}</dd>
            </div>
          </dl>
          <p v-if="error" class="cv3-video-status-error" role="alert">{{ error }}</p>
          <section class="cv3-video-status-official" aria-label="官方审核状态">
            <strong>官方审核：未执行 · 服务未接入</strong>
            <p>人物、版权、内容安全及平台政策等审核，请以平台实际结果为准。</p>
          </section>
          <p class="cv3-video-status-note">
            本次仅由浏览器读取视频元数据，不上传素材、不调用生成或付费审核服务。
          </p>
        </template>
        <template v-else>
          <p class="cv3-video-status-unavailable" role="status">
            该视频处理服务尚未接入，原视频未改动，未创建或提交任务。
          </p>
          <p class="cv3-video-status-note">
            当前入口仅展示服务状态，不会自动替换、重拍或上传原视频。
          </p>
        </template>
      </div>
      <footer>
        <button v-if="isCompliance" type="button" :disabled="status === 'loading'" @click="check">
          {{ status === 'loading' ? '读取中…' : '重新检查' }}
        </button>
        <button type="button" class="cv3-video-status-close" @click="close">关闭</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.cv3-video-status-backdrop {
  position: fixed;
  z-index: 1600;
  inset: 0;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 24px;
  background: #000a;
  backdrop-filter: blur(5px);
  color: #e3e3e3;
  font-family: inherit;
}
.cv3-video-status-dialog {
  width: 560px;
  max-width: 100%;
  max-height: calc(100dvh - 48px);
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid #414141;
  border-radius: 16px;
  background: #252525;
  box-shadow: 0 12px 48px #0005;
  outline: none;
  font-size: 13px;
  line-height: 1.6;
}
.cv3-video-status-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: 0 20px 0 24px;
  border-bottom: 1px solid #3b3b3b;
}
.cv3-video-status-dialog h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.cv3-video-status-dialog button {
  min-height: 32px;
  padding: 5px 13px;
  border: 1px solid #4a4a4a;
  border-radius: 7px;
  color: #ddd;
  background: #353535;
  cursor: pointer;
  font: inherit;
}
.cv3-video-status-dialog button:hover,
.cv3-video-status-dialog button:active {
  background: #404040;
}
.cv3-video-status-dialog button:focus-visible {
  outline: 2px solid #88d3e1;
  outline-offset: 2px;
}
.cv3-video-status-dialog button:disabled {
  opacity: 0.45;
  cursor: default;
}
.cv3-video-status-dialog header button {
  display: grid;
  place-items: center;
  width: 28px;
  min-height: 28px;
  padding: 0;
  border: 0;
  color: #aaa;
  background: transparent;
}
.cv3-video-status-dialog header svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}
.cv3-video-status-body {
  padding: 20px 24px;
}
.cv3-video-status-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0 0 16px;
  color: #eee;
}
.cv3-video-status-disclaimer {
  padding: 12px 14px;
  border: 1px solid #625337;
  border-radius: 9px;
  color: #d9c497;
  background: #4037235c;
}
.cv3-video-status-body dl {
  margin: 20px 0;
}
.cv3-video-status-body dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
}
.cv3-video-status-body dt {
  color: #999;
}
.cv3-video-status-body dd {
  margin: 0;
  text-align: right;
  color: #ddd;
}
.cv3-video-status-error {
  color: #efaa9f;
}
.cv3-video-status-official {
  padding: 12px 14px;
  border-radius: 9px;
  background: #1d1d1d;
}
.cv3-video-status-official strong {
  font-weight: 500;
  color: #c9c9c9;
}
.cv3-video-status-official p,
.cv3-video-status-note {
  color: #999;
  font-size: 12px;
}
.cv3-video-status-official p {
  margin: 6px 0 0;
}
.cv3-video-status-note {
  margin: 14px 0 0;
}
.cv3-video-status-unavailable {
  margin: 0;
  padding: 16px;
  border: 1px solid #494239;
  border-radius: 9px;
  color: #d1c3ac;
  background: #3d34285c;
}
.cv3-video-status-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 24px 20px;
}
.cv3-video-status-dialog button.cv3-video-status-close {
  border-color: #ddd;
  color: #222;
  background: #eee;
}
@media (prefers-reduced-transparency: reduce) {
  .cv3-video-status-backdrop {
    background: #090909f5;
    backdrop-filter: none;
  }
}
@media (prefers-contrast: more) {
  .cv3-video-status-dialog {
    border-color: #ccc;
    color: #fff;
  }
  .cv3-video-status-body dt,
  .cv3-video-status-note {
    color: #c5c5c5;
  }
}
</style>

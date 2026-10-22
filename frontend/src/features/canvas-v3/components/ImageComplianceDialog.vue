<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { imageAssetSourceUrl } from '../config/imageAssetCollections'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  sourceNode: { type: Object, default: null },
  node: { type: Object, default: null },
})
const emit = defineEmits(['close'])
const dialog = ref(null)
const closeButton = ref(null)
const status = ref('pending')
const error = ref('')
const dimensions = ref(null)
const format = ref('尚未检查')
const source = computed(() => props.sourceNode || props.node)
const sourceUrl = computed(() => imageAssetSourceUrl(source.value?.data?.assetUrl))
let disposed = false
let requestId = 0
let controller = null
let previousFocus

function imageAddressFormat(url) {
  if (url.startsWith('data:')) {
    const mime = url.match(/^data:([^;,]+)/i)?.[1] || ''
    return mime ? `${mime}（内联 MIME）` : '未知（内联图片未标明 MIME）'
  }
  const extension = new URL(url).pathname.match(/\.([a-z0-9]{2,8})$/i)?.[1]
  return extension
    ? `${extension.toUpperCase()}（地址扩展名，未校验 Content-Type）`
    : '未知（图片地址无扩展名，未校验 Content-Type）'
}
function loadImageMetadata(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason || new DOMException('已取消', 'AbortError'))
      return
    }
    if (typeof Image !== 'function') {
      reject(new Error('当前环境不支持浏览器图片解码'))
      return
    }
    const image = new Image()
    let settled = false
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', abort)
    }
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const abort = () => {
      settle(reject, signal.reason || new DOMException('已取消', 'AbortError'))
      image.src = ''
    }
    signal.addEventListener('abort', abort, { once: true })
    image.onload = () => {
      const width = Number(image.naturalWidth)
      const height = Number(image.naturalHeight)
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
        settle(resolve, { width, height })
      else settle(reject, new Error('浏览器未能读取有效的图片尺寸'))
    }
    image.onerror = () =>
      settle(reject, new Error('浏览器无法加载或解码该图片，请检查图片地址及访问权限'))
    image.src = url
  })
}
async function check() {
  controller?.abort()
  const id = ++requestId
  dimensions.value = null
  error.value = ''
  format.value = '未知'
  status.value = 'loading'
  const url = sourceUrl.value
  if (!url) {
    status.value = 'error'
    error.value = '图片地址无效，无法进行本地文件检查'
    return
  }
  format.value = imageAddressFormat(url)
  controller = new AbortController()
  const signal = controller.signal
  try {
    const result = await loadImageMetadata(url, signal)
    if (disposed || id !== requestId || signal.aborted) return
    dimensions.value = result
    status.value = 'ready'
  } catch (failure) {
    if (disposed || id !== requestId || signal.aborted) return
    status.value = 'error'
    error.value = failure.message || '图片读取失败'
  } finally {
    if (id === requestId) controller = null
  }
}
function close() {
  controller?.abort()
  emit('close')
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'Tab') {
    const controls = [
      ...(dialog.value?.querySelectorAll('button:not(:disabled),[tabindex="0"]') || []),
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
watch(sourceUrl, () => {
  if (!disposed) void check()
})
onMounted(async () => {
  previousFocus = document.activeElement
  await nextTick()
  closeButton.value?.focus()
  void check()
})
onBeforeUnmount(() => {
  disposed = true
  ++requestId
  controller?.abort()
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to="body">
    <div class="cv3-compliance-backdrop" @pointerdown.self="close" @contextmenu.prevent>
      <section
        ref="dialog"
        class="cv3-compliance-dialog"
        data-cv3-image-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv3-compliance-title"
        @pointerdown.stop
        @keydown="keydown"
      >
        <header>
          <h2 id="cv3-compliance-title">Seedance合规校验</h2>
          <button ref="closeButton" type="button" aria-label="关闭合规校验" @click="close">
            <CanvasIcon name="close" :size="16" />
          </button>
        </header>
        <div class="cv3-compliance-body">
          <p class="cv3-compliance-disclaimer">
            未接入 Seedance 官方合规校验接口，以下仅为本地文件检查，不代表平台审核结果。
          </p>
          <div class="cv3-compliance-details">
            <div class="cv3-compliance-preview">
              <img
                v-if="sourceUrl"
                :src="sourceUrl"
                :alt="source?.data?.title || '待检查图片'"
                draggable="false"
              />
              <span v-else>暂无可用图片</span>
            </div>
            <dl>
              <div>
                <dt>本地图片读取</dt>
                <dd :class="{ 'cv3-compliance-error': status === 'error' }">
                  {{
                    status === 'ready'
                      ? '浏览器已加载并解码'
                      : status === 'error'
                        ? '读取失败'
                        : '正在读取…'
                  }}
                </dd>
              </div>
              <div>
                <dt>实际像素尺寸</dt>
                <dd>
                  {{ dimensions ? `${dimensions.width} × ${dimensions.height} px` : '尚未读取' }}
                </dd>
              </div>
              <div>
                <dt>地址格式信息</dt>
                <dd>{{ format }}</dd>
              </div>
            </dl>
          </div>
          <p v-if="error" class="cv3-compliance-error" role="alert">{{ error }}</p>
          <section class="cv3-compliance-official" aria-label="官方校验状态">
            <span>Seedance 官方合规校验</span>
            <strong>未执行 · 服务未接入</strong>
            <p>
              本地解码或尺寸信息不代表人物、版权、内容安全或平台政策审核通过。提交到生成平台后，请以平台实际审核结果为准。
            </p>
          </section>
          <p class="cv3-compliance-note">本次检查不上传图片、不调用生成或付费审核服务。</p>
        </div>
        <footer>
          <button type="button" :disabled="status === 'loading'" @click="check">
            {{ status === 'loading' ? '检查中…' : '重新检查' }}
          </button>
          <button type="button" class="cv3-compliance-close" @click="close">关闭</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-compliance-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #0009;
  backdrop-filter: blur(5px);
  color: #eee;
  font-family: inherit;
}
.cv3-compliance-dialog {
  width: 560px;
  max-width: 100%;
  max-height: calc(100dvh - 48px);
  overflow: auto;
  background: #262626;
  border: 1px solid #3a3a3a;
  border-radius: 16px;
  box-shadow: 0 8px 32px #0005;
  font-size: 13px;
  line-height: 20px;
}
.cv3-compliance-dialog * {
  box-sizing: border-box;
}
.cv3-compliance-dialog header {
  height: 49px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #383838;
}
.cv3-compliance-dialog h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}
.cv3-compliance-dialog button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 8px;
}
.cv3-compliance-dialog header button {
  width: 24px;
  height: 24px;
  padding: 4px;
  color: #999;
  display: grid;
  place-items: center;
}
.cv3-compliance-dialog button:focus-visible {
  outline: 1px solid #ddd;
  outline-offset: 2px;
}
.cv3-compliance-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cv3-compliance-disclaimer {
  margin: 0;
  padding: 12px;
  background: #342f24;
  border: 1px solid #655235;
  border-radius: 8px;
  color: #ddc58d;
}
.cv3-compliance-details {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.cv3-compliance-preview {
  width: 140px;
  height: 140px;
  flex: 0 0 140px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #1c1c1c;
  border: 1px solid #3d3d3d;
  border-radius: 8px;
  color: #888;
  font-size: 12px;
}
.cv3-compliance-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.cv3-compliance-details dl {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.cv3-compliance-details dl > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cv3-compliance-details dt {
  color: #999;
  font-size: 12px;
}
.cv3-compliance-details dd {
  margin: 0;
  color: #ddd;
  font-size: 12px;
}
.cv3-compliance-official {
  padding: 12px;
  border: 1px solid #444;
  border-radius: 8px;
  background: #232323;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cv3-compliance-official > span {
  font-size: 12px;
  color: #999;
}
.cv3-compliance-official strong {
  font-weight: 500;
  color: #d4c4a5;
}
.cv3-compliance-official p {
  margin: 0;
  color: #aaa;
  font-size: 12px;
  line-height: 18px;
}
.cv3-compliance-error {
  color: #ffada3 !important;
  margin: 0;
  font-size: 12px;
}
.cv3-compliance-note {
  margin: 0;
  font-size: 12px;
  color: #888;
}
.cv3-compliance-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 0 20px 20px;
}
.cv3-compliance-dialog footer button {
  height: 32px;
  padding: 0 12px;
  background: #373737;
}
.cv3-compliance-dialog footer button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cv3-compliance-dialog footer .cv3-compliance-close {
  color: #151515;
  background: #f5f5f5;
}
@media (max-width: 440px) {
  .cv3-compliance-details {
    flex-direction: column;
  }
  .cv3-compliance-backdrop {
    padding: 12px;
  }
}
</style>

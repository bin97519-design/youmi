<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { useUserStore } from '../../stores/user'
import { apiPath } from '../../utils/apiBase'

const props = defineProps({
  sourceUrl: { type: String, required: true },
  name: { type: String, default: '视频' },
  saveLabel: { type: String, default: '添加到画布' },
  saveResult: { type: Function, required: true },
  savedResultIds: { type: Array, default: () => [] },
  savedActionLabel: { type: String, default: '' },
})
const emit = defineEmits(['close'])
const user = useUserStore()
const dialog = ref(null),
  available = ref(false),
  loading = ref(true),
  busy = ref(false),
  refreshing = ref(false),
  saving = ref(false)
const error = ref(''),
  quote = ref(null),
  task = ref(null),
  history = ref([]),
  saved = ref(new Set())
const settings = reactive({
  resolution: '1080p',
  fps: 'keep',
  toolVersion: 'standard',
  scene: 'aigc',
  enhanceStyle: 'natural',
})
const options = (values) => values.map(([value, label]) => ({ value, label }))
const resolutions = options([
  ['720p', '720P'],
  ['1080p', '1080P'],
  ['2k', '2K'],
  ['4k', '4K'],
  ['8k', '8K'],
])
const frameRates = options([
  ['keep', '保持原帧率'],
  ['60', '60 fps'],
  ['120', '120 fps'],
])
const versions = options([
  ['standard', '标准版'],
  ['professional', '专业版'],
])
const scenes = options([
  ['aigc', 'AI 生成视频'],
  ['short_series', '短剧'],
  ['ugc', '实拍短视频'],
  ['old_film', '老片'],
])
const styles = options([
  ['natural', '自然'],
  ['hd', '高清'],
])
const terminal = (value) => ['completed', 'failed', 'unknown'].includes(value?.status)
const running = computed(
  () => task.value && !terminal(task.value) && task.value.status !== 'quoted',
)
const locked = computed(() => busy.value || running.value || task.value?.status === 'unknown')
const result = computed(() => (task.value?.status === 'completed' ? task.value : null))
const resultSaved = computed(
  () =>
    result.value &&
    (saved.value.has(result.value.id) || props.savedResultIds.includes(result.value.id)),
)
const preview = computed(() => result.value?.resultUrl || props.sourceUrl)
const metadata = computed(() => task.value?.metadata || quote.value?.metadata)
let timer,
  disposed = false
const requests = new Set()

async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const controller = new AbortController()
  requests.add(controller)
  const timeout = setTimeout(() => controller.abort(), method === 'GET' ? 20000 : 180000)
  try {
    const response = await fetch(apiPath(`/api/video-enhancements${path}`), {
      method,
      signal: controller.signal,
      ...(method === 'GET' ? { cache: 'no-store' } : {}),
      headers: { 'Content-Type': 'application/json', ...user.authHeaders() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok || json.code)
      throw new Error(
        json.message ||
          (response.status === 404 ? '视频超分服务尚未启用' : `请求失败（${response.status}）`),
      )
    return json.data
  } finally {
    clearTimeout(timeout)
    requests.delete(controller)
  }
}
function remember(value) {
  task.value = value
  history.value = [value, ...history.value.filter((item) => item.id !== value.id)]
}
async function loadHistory() {
  const items = await request(`/tasks?sourceUrl=${encodeURIComponent(props.sourceUrl)}`)
  if (disposed) return
  history.value = items || []
  task.value = history.value.find((item) => !terminal(item)) || history.value[0] || null
  if (task.value) Object.assign(settings, task.value.settings)
  pollLater()
}
function pollLater() {
  clearTimeout(timer)
  if (!disposed && running.value) timer = setTimeout(poll, 4000)
}
async function poll() {
  if (!task.value?.id || disposed || refreshing.value || busy.value) return
  const id = task.value.id
  refreshing.value = true
  clearTimeout(timer)
  try {
    const value = await request(`/tasks/${id}`)
    if (disposed || task.value?.id !== id) return
    if (value.status === 'quoted') {
      quote.value = value
      task.value = null
      if (value.expiresAt < Date.now()) {
        await discardQuote()
        error.value = '报价已过期，请重新核算费用'
      } else error.value = '尚未提交，可用本次报价继续确认'
    } else {
      remember(value)
      error.value = ''
    }
  } catch (e) {
    if (!disposed && task.value?.id === id) {
      const message = e.name === 'AbortError' ? '状态查询超时' : e.message
      error.value = `${message}；将继续查询原任务，不会重复提交`
    }
  } finally {
    refreshing.value = false
    pollLater()
  }
}
function refreshOnReturn() {
  if (document.visibilityState === 'visible' && running.value && !loading.value) void poll()
}
async function discardQuote() {
  const previous = quote.value
  quote.value = null
  if (previous) await request(`/quotes/${previous.id}`, undefined, 'DELETE').catch(() => {})
}
watch(settings, () => {
  if (quote.value && !busy.value) void discardQuote()
})
async function calculate() {
  busy.value = true
  error.value = ''
  try {
    await discardQuote()
    const value = await request('/quotes', {
      sourceUrl: props.sourceUrl,
      settings: { ...settings },
    })
    if (!disposed) {
      quote.value = value
      task.value = null
    }
  } catch (e) {
    if (!disposed) error.value = e.message
  } finally {
    busy.value = false
  }
}
async function submit() {
  if (!quote.value || busy.value || running.value) return
  if (quote.value.expiresAt < Date.now()) {
    await discardQuote()
    error.value = '报价已过期，请重新核算费用'
    return
  }
  const selected = quote.value
  busy.value = true
  error.value = ''
  // Keep the quote id as the task id even if the POST response is lost.
  task.value = { ...selected, status: 'submitting', stage: '正在确认提交结果' }
  quote.value = null
  try {
    const value = await request('/tasks', { quoteId: selected.id })
    if (!disposed) remember(value)
  } catch (e) {
    if (!disposed) error.value = `${e.message}；正在确认原任务状态`
  } finally {
    busy.value = false
    pollLater()
  }
}
function selectHistory(event) {
  if (locked.value) return
  void discardQuote()
  task.value = history.value.find((item) => item.id === event.target.value) || null
  if (task.value) Object.assign(settings, task.value.settings)
  error.value = ''
  pollLater()
}
async function save() {
  if (!result.value || saving.value || (resultSaved.value && !props.savedActionLabel)) return
  const selected = result.value
  saving.value = true
  error.value = ''
  try {
    await props.saveResult(selected)
    if (!disposed) saved.value = new Set([...saved.value, selected.id])
  } catch (e) {
    if (!disposed) error.value = e.message || '添加失败，请重试'
  } finally {
    saving.value = false
  }
}
onMounted(async () => {
  window.addEventListener('focus', refreshOnReturn)
  document.addEventListener('visibilitychange', refreshOnReturn)
  await nextTick()
  dialog.value?.showModal()
  try {
    const capability = await request('/capabilities')
    available.value = capability.available === true
    await loadHistory()
  } catch (e) {
    if (!disposed) error.value = e.message
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('focus', refreshOnReturn)
  document.removeEventListener('visibilitychange', refreshOnReturn)
  clearTimeout(timer)
  for (const controller of requests) controller.abort()
  if (quote.value) {
    void fetch(apiPath(`/api/video-enhancements/quotes/${quote.value.id}`), {
      method: 'DELETE',
      headers: user.authHeaders(),
      keepalive: true,
    }).catch(() => {})
  }
  // Unsubmitted quotes expire on the server; accepted jobs continue independently.
  dialog.value?.close()
})
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="ve-dialog"
      aria-labelledby="ve-title"
      @cancel.prevent="emit('close')"
      @keydown.esc.stop
    >
      <header class="ve-header">
        <h2 id="ve-title">
          <i class="ri-magic-line" aria-hidden="true"></i>
          视频超分
        </h2>
        <button class="ve-icon" title="关闭" aria-label="关闭视频超分" @click="emit('close')">
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </header>
      <div class="ve-body">
        <section class="ve-preview">
          <video :key="preview" :src="preview" controls preload="metadata" />
          <div class="ve-caption">
            <span>{{ result ? '超分结果' : name }}</span>
            <span v-if="metadata">
              原片 {{ metadata.width }} × {{ metadata.height }} ·
              {{ metadata.duration.toFixed(1) }} 秒
            </span>
          </div>
          <label v-if="history.length" class="ve-history">
            历史任务
            <select :value="task?.id || ''" :disabled="locked" @change="selectHistory">
              <option value="">新建超分</option>
              <option v-for="item in history" :key="item.id" :value="item.id">
                {{ item.settings.resolution.toUpperCase() }} · {{ item.stage }} ·
                {{ new Date(item.createdAt).toLocaleString() }}
              </option>
            </select>
          </label>
        </section>
        <section class="ve-settings">
          <fieldset class="ve-grid" :disabled="locked">
            <label>
              目标清晰度
              <ThemedSelect
                v-model="settings.resolution"
                :options="resolutions"
                :disabled="locked"
                aria-label="目标清晰度"
              />
            </label>
            <label>
              输出帧率
              <ThemedSelect
                v-model="settings.fps"
                :options="frameRates"
                :disabled="locked"
                aria-label="输出帧率"
              />
            </label>
            <label>
              处理版本
              <ThemedSelect
                v-model="settings.toolVersion"
                :options="versions"
                :disabled="locked"
                aria-label="处理版本"
              />
            </label>
            <label>
              增强风格
              <ThemedSelect
                v-model="settings.enhanceStyle"
                :options="styles"
                :disabled="locked"
                aria-label="增强风格"
              />
            </label>
            <label v-if="settings.toolVersion === 'standard'" class="ve-wide">
              视频类型
              <ThemedSelect
                v-model="settings.scene"
                :options="scenes"
                :disabled="locked"
                aria-label="视频类型"
              />
            </label>
          </fieldset>
          <p v-if="loading" role="status">正在读取超分服务状态</p>
          <p v-else-if="!available" class="ve-warning">
            视频超分尚未启用，请配置密钥和视频检查服务
          </p>
          <div v-if="quote" class="ve-quote" role="status">
            <strong>本次 {{ quote.price }} 米值</strong>
            <span>
              {{ Math.ceil(quote.metadata.duration) }} 计费秒 ·
              {{ settings.resolution.toUpperCase() }} ·
              {{ settings.toolVersion === 'professional' ? '专业版' : '标准版' }}
            </span>
            <small>暂定价格，成功后计入消费</small>
          </div>
          <div v-if="task" class="ve-status" role="status">
            <strong>
              {{ task.stage }}
              <span v-if="task.status !== 'persisting' && task.progress != null">
                {{ task.progress }}%
              </span>
            </strong>
            <progress
              v-if="running"
              :value="task.status === 'persisting' ? undefined : (task.progress ?? undefined)"
              max="100"
            />
            <small v-if="task.status === 'persisting'">中转站处理完成，正在转存成品</small>
            <small v-if="task.providerTaskId">中转站任务：{{ task.providerTaskId }}</small>
            <p v-if="task.error" class="ve-warning">{{ task.error }}</p>
          </div>
          <p v-if="error" role="alert" class="ve-warning">{{ error }}</p>
          <div class="ve-actions">
            <button v-if="quote" class="ve-primary" :disabled="busy || !available" @click="submit">
              <i class="ri-magic-line" aria-hidden="true"></i>
              确认超分 · {{ quote.price }} 米值
            </button>
            <button
              v-else-if="running || task?.status === 'unknown'"
              :disabled="refreshing || busy"
              class="ve-primary"
              @click="poll"
            >
              <i
                :class="refreshing ? 'ri-loader-4-line' : 'ri-refresh-line'"
                aria-hidden="true"
              ></i>
              {{ refreshing ? '正在同步' : '同步状态' }}
            </button>
            <button
              v-else
              :disabled="locked || loading || !available"
              class="ve-primary"
              @click="calculate"
            >
              <i :class="busy ? 'ri-loader-4-line' : 'ri-calculator-line'" aria-hidden="true"></i>
              {{ busy ? '正在检查视频' : '核算费用' }}
            </button>
            <button
              v-if="result"
              :disabled="saving || (resultSaved && !savedActionLabel)"
              @click="save"
            >
              <i
                :class="
                  saving
                    ? 'ri-loader-4-line'
                    : resultSaved && savedActionLabel
                      ? 'ri-focus-3-line'
                      : 'ri-add-line'
                "
                aria-hidden="true"
              ></i>
              {{ saving ? '正在保存' : resultSaved ? savedActionLabel || '已添加' : saveLabel }}
            </button>
            <a
              v-if="result"
              :href="result.resultUrl"
              target="_blank"
              rel="noopener noreferrer"
              download
            >
              <i class="ri-download-line" aria-hidden="true"></i>
              下载
            </a>
          </div>
        </section>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ve-dialog {
  width: min(940px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: 0;
  border: 1px solid #42454b;
  border-radius: 8px;
  background: #222328;
  color: #e9e9ec;
  overflow: auto;
}
.ve-dialog::backdrop {
  background: #0009;
}
.ve-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #393b40;
}
.ve-header h2 {
  margin: 0;
  font-size: 16px;
}
.ve-header h2 i {
  color: #20c0d7;
  margin-right: 6px;
}
.ve-body {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 24px;
  padding: 18px;
}
.ve-body section {
  min-width: 0;
}
.ve-preview video {
  display: block;
  width: 100%;
  height: 280px;
  object-fit: contain;
  background: #15161a;
}
.ve-caption {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  margin: 10px 0 20px;
  font-size: 12px;
  color: #a6a9b0;
  overflow-wrap: anywhere;
}
.ve-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.ve-wide {
  grid-column: 1 / -1;
}
.ve-dialog label {
  display: grid;
  gap: 7px;
  font-size: 12px;
  color: #b2b5bd;
  min-width: 0;
}
.ve-dialog select {
  width: 100%;
  min-width: 0;
  padding: 8px;
  background: #191a1e;
  color: #e9e9ec;
  border: 1px solid #45474c;
  border-radius: 4px;
}
.ve-dialog button,
.ve-actions a {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 7px 11px;
  border: 1px solid #45474c;
  border-radius: 5px;
  font: inherit;
  font-size: 12px;
  color: #e9e9ec;
  background: #2b2c32;
  text-decoration: none;
  cursor: pointer;
}
.ve-dialog button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ve-dialog .ve-icon {
  padding: 0;
  width: 32px;
  height: 32px;
}
.ve-dialog .ve-primary {
  background: #1bbcd2;
  color: #05252d;
  border-color: #1bbcd2;
}
.ve-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.ve-status,
.ve-quote {
  display: grid;
  gap: 8px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #393b40;
  font-size: 13px;
}
.ve-status small,
.ve-quote small {
  color: #a6a9b0;
  overflow-wrap: anywhere;
}
.ve-warning {
  color: #f0a482;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.ve-status progress {
  width: 100%;
  height: 7px;
  accent-color: #1bbcd2;
}
@media (max-width: 680px) {
  .ve-body {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }
  .ve-preview video {
    height: 200px;
  }
  .ve-dialog {
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
  }
}
</style>

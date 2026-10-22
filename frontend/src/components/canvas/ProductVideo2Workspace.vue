<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import { isSeedanceAnciModel, SEEDANCE_ANCI_RATIOS, SEEDANCE_ANCI_VERSIONS, seedanceAnciNotice } from '../../utils/seedanceAnci.js'
import ProductVideoTaskList from './ProductVideoTaskList.vue'
import { useProductVideo } from '../../composables/useProductVideo'
import { MAIN_VIDEO_2_STORAGE, configureMainVideo2Task } from '../../utils/productVideo2.js'
import { uploadFileDirect } from '../../utils/ossUpload'
import { writeTextToClipboard } from '../../utils/clipboard'
import {
  VIDEO_RATIOS,
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  MINIMAX_VIDEO_RESOLUTIONS,
  ANMIAO_VIDEO_RESOLUTIONS,
  ANMIAO25_VIDEO_RESOLUTIONS,
  ANMIAO20_FAST_VIDEO_RESOLUTIONS,
  isAnmiao25VideoModel,
  isAnmiao20FastVideoModel,
  supportsVideoAudioToggle,
  selectedVideo,
  canGenerateVideo,
  wholeReferenceGenerationIssue,
  videoGenerationStatus,
  videoGenerationPending,
  uid,
} from '../../utils/productVideo.js'

const props = defineProps({
  open: Boolean,
  canvasId: { type: String, required: true },
  layers: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])
const activeTaskId = ref(''),
  showingTasks = ref(true),
  activeShotId = ref('')
const {
  workflow,
  tasks,
  taskActivity,
  createTask,
  captureTask,
  getTask,
  isCurrent,
  change,
  shotChange,
  error,
  notice,
  planning,
  capabilities,
  capabilitiesError,
  capabilitiesLoading,
  loadCapabilities,
  planningModelOptions,
  wholeVideo15ModelOptions,
  wholeVideo30ModelOptions,
  effectiveWholeVideo15Model,
  effectiveWholeVideo30Model,
  selectPlanningModel,
  plan,
  retryPlan,
  generate,
  retryVideoSubmission,
} = useProductVideo(
  computed(() => props.canvasId),
  activeTaskId,
  { storageKey: MAIN_VIDEO_2_STORAGE, configureTask: configureMainVideo2Task },
)
const dialog = ref(null),
  imageInput = ref(null),
  firstInput = ref(null),
  referenceInput = ref(null)
const uploading = ref(false),
  picker = ref(null)
const active = computed(
  () =>
    workflow.value.shots.find((shot) => shot.id === activeShotId.value) ||
    workflow.value.shots.at(-1),
)
const video = computed(() => active.value && selectedVideo(active.value))
const settings = computed(() => workflow.value.video2 || {})
const nativeModels = computed(
  () => new Set((capabilities.value?.mainVideo2VideoModels || []).map((option) => option.value)),
)
const planningModels = computed(() =>
  workflow.value.referenceVideo
    ? planningModelOptions.value.filter((option) => nativeModels.value.has(option.value))
    : planningModelOptions.value,
)
const types = ['', '情景种草', '素人口播', '产品展示', '达人测评', '剧情演绎', '厂家促销'].map(
  (value) => ({ value, label: value || '根据商品自动判断' }),
)
const whole30 = computed(() => active.value?.productionMode === 'single_video_30')
const model = computed(() =>
  whole30.value ? effectiveWholeVideo30Model.value : effectiveWholeVideo15Model.value,
)
const audioSwitchSupported = computed(() => supportsVideoAudioToggle(model.value))
const audioEnabled = computed(
  () => !audioSwitchSupported.value || workflow.value.generateAudio !== false,
)
const videoModels = computed(() =>
  (whole30.value ? wholeVideo30ModelOptions.value : wholeVideo15ModelOptions.value).filter(
    (option) => option.value !== HAILUO_H3_VIDEO_MODEL,
  ),
)
const generationWorkflow = computed(() => ({
  ...workflow.value,
  videoModel: effectiveWholeVideo15Model.value,
  wholeVideo30Model: effectiveWholeVideo30Model.value,
}))
const generationIssue = computed(() =>
  !active.value
    ? ''
    : wholeReferenceGenerationIssue(generationWorkflow.value, active.value, model.value),
)
const busyVideo = computed(() =>
  active.value?.videos.some(videoGenerationPending),
)
const latestVideo = computed(() => active.value?.videos.at(-1))
const resolutions = computed(() =>
  isSeedanceAnciModel(model.value) ? [{ value: '720p', label: '720p' }] :
  [MINIMAX_VIDEO_MODEL, HAILUO_H3_VIDEO_MODEL].includes(model.value)
    ? MINIMAX_VIDEO_RESOLUTIONS
    : isAnmiao25VideoModel(model.value)
      ? ANMIAO25_VIDEO_RESOLUTIONS
      : isAnmiao20FastVideoModel(model.value)
        ? ANMIAO20_FAST_VIDEO_RESOLUTIONS
        : ANMIAO_VIDEO_RESOLUTIONS,
)
const resolutionKey = computed(() =>
  model.value === MINIMAX_VIDEO_MODEL
    ? 'minimaxResolution'
    : whole30.value
      ? 'wholeVideo30Resolution'
      : 'videoResolution',
)
const imageLayers = computed(() =>
  props.layers.filter((layer) => layer.url && (!layer.type || layer.type === 'image')),
)
const videoLayers = computed(() =>
  props.layers.filter((layer) => layer.url && layer.type === 'video'),
)
const waitingPlan = computed(() => planning.value || workflow.value.planJob?.status === 'unknown')
let restoreFocus

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      picker.value = null
      restoreFocus?.focus()
      return
    }
    restoreFocus = document.activeElement
    showingTasks.value = true
    await loadCapabilities()
    await nextTick()
    dialog.value?.focus()
  },
)
watch(activeTaskId, () => {
  activeShotId.value = ''
  picker.value = null
})
watch(
  () => workflow.value.planJob?.appliedCount,
  (count, previous) => {
    if (count > (previous || 0)) activeShotId.value = workflow.value.shots.at(-1)?.id || ''
  },
)
function openTask(id) {
  activeTaskId.value = id
  showingTasks.value = false
  error.value = notice.value = ''
}
function startTask() {
  openTask(createTask())
}
function set(key, value) {
  change((task) => {
    task[key] = value
  })
}
function setSetting(key, value) {
  change((task) => {
    task.video2[key] = value
  })
}
function addImage(url, name, layerId = '', context = captureTask()) {
  const task = getTask(context)
  if (!task || task.references.some((item) => item.url === url)) return
  if (task.references.length + (task.video2.firstFrame ? 1 : 0) >= 8)
    throw new Error('产品图与可选首帧合计最多8张')
  change((data) => {
    data.references.push({ id: uid(), url, name, layerId })
  }, context)
}
function metadata(source) {
  return new Promise((resolve, reject) => {
    const element = document.createElement('video'),
      local = source instanceof File ? URL.createObjectURL(source) : null
    const clean = () => {
      clearTimeout(timer)
      element.onloadedmetadata = element.onerror = null
      element.removeAttribute('src')
      element.load()
      if (local) URL.revokeObjectURL(local)
    }
    const timer = setTimeout(() => {
      clean()
      reject(new Error('视频读取超时，请换用可播放的MP4文件'))
    }, 30000)
    element.preload = 'metadata'
    element.onloadedmetadata = () => {
      const duration = element.duration
      clean()
      if (!Number.isFinite(duration) || duration <= 0 || duration > 120.5)
        reject(new Error('参考视频需为2分钟以内的可播放视频'))
      else resolve(duration)
    }
    element.onerror = () => {
      clean()
      reject(new Error('无法读取视频，请使用可正常播放的MP4文件'))
    }
    element.src = local || source
  })
}
function attachVideo(reference, context) {
  change((task) => {
    task.referenceVideo = reference
    if (!nativeModels.value.has(task.planningModel))
      task.planningModel =
        planningModels.value.find((option) => nativeModels.value.has(option.value))?.value ||
        'gem-3-pro'
  }, context)
  if (isCurrent(context))
    notice.value = '参考视频将先单独分析镜头与声音，再结合商品资料策划；每段脚本为30秒。'
}
async function upload(event, role) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!files.length) return
  const context = captureTask()
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      if (!getTask(context)) break
      if (role === 'video') {
        if (!file.type.startsWith('video/') || file.size > 150 * 1024 * 1024)
          throw new Error('请上传150MB以内的视频')
        const duration = await metadata(file)
        const url = await uploadFileDirect(file, { dir: 'product-video2/references' })
        attachVideo({ url, duration, name: file.name, frames: [] }, context)
      } else {
        if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
        const task = getTask(context)
        if (
          task.references.length + (role === 'first' ? 1 : task.video2.firstFrame ? 1 : 0) >=
          (role === 'first' ? 9 : 8)
        )
          throw new Error('产品图与可选首帧合计最多8张')
        const url = await uploadFileDirect(file, { dir: 'product-video2/images' })
        if (role === 'first')
          change((data) => {
            data.video2.firstFrame = { url, name: file.name }
          }, context)
        else addImage(url, file.name, '', context)
      }
    }
  } catch (e) {
    if (isCurrent(context)) error.value = e.message
  } finally {
    uploading.value = false
  }
}
function openPicker(role) {
  picker.value = { role, context: captureTask() }
}
async function chooseAsset(layer) {
  const target = picker.value
  if (!target) return
  error.value = ''
  try {
    if (target.role === 'video') {
      uploading.value = true
      attachVideo(
        { url: layer.url, name: layer.name, duration: await metadata(layer.url), frames: [] },
        target.context,
      )
      picker.value = null
    } else if (target.role === 'first') {
      if (getTask(target.context)?.references.length >= 8)
        throw new Error('产品图与可选首帧合计最多8张')
      change((task) => {
        task.video2.firstFrame = { url: layer.url, name: layer.name }
      }, target.context)
      picker.value = null
    } else addImage(layer.url, layer.name, layer.id, target.context)
  } catch (e) {
    error.value = e.message
  } finally {
    uploading.value = false
  }
}
async function createScript(intent = 'plan') {
  if (waitingPlan.value || uploading.value) return
  if (workflow.value.referenceVideo && !nativeModels.value.has(workflow.value.planningModel)) {
    error.value = '完整视频反推请选择GEM 3 Pro等支持原生视频输入的策划模型'
    return
  }
  change((task) => {
    task.video2.planningIntent = intent
    if (intent === 'variant') task.video2.variant++
  })
  await plan(1)
}
async function copyScript() {
  try {
    await writeTextToClipboard(active.value.motion)
    notice.value = '完整脚本已复制'
  } catch (e) {
    error.value = e.message
  }
}
function setVideoModel(value) {
  set(whole30.value ? 'wholeVideo30Model' : 'videoModel', value)
  if (isSeedanceAnciModel(value)) {
    set('videoResolution', '720p')
    if (!SEEDANCE_ANCI_RATIOS.includes(workflow.value.ratio)) set('ratio', '3:4')
  }
}
function escape(event) {
  if (event.key !== 'Escape') return
  if (picker.value) picker.value = null
  else emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pv2-overlay" @pointerdown.stop @wheel.stop @keydown.stop="escape">
      <section
        ref="dialog"
        class="pv2-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="主图视频2"
        tabindex="-1"
      >
        <header class="pv2-header">
          <h2>
            <i class="ri-movie-2-line" aria-hidden="true"></i>
            主图视频2
          </h2>
          <button v-if="!showingTasks" @click="showingTasks = true">← 任务列表</button>
          <input
            v-if="!showingTasks"
            :value="workflow.title"
            aria-label="主图视频2任务名称"
            maxlength="80"
            @change="set('title', $event.target.value || '未命名任务')"
          />
          <button class="pv2-close" aria-label="关闭主图视频2" @click="emit('close')">×</button>
        </header>
        <p v-if="error || notice" :class="['pv2-message', { error }]" role="status">
          {{ error || notice }}
          <button aria-label="关闭提示" @click="error = notice = ''">×</button>
        </p>
        <ProductVideoTaskList
          v-if="showingTasks"
          :tasks="tasks"
          :activity="taskActivity"
          @open="openTask"
          @create="startTask"
        />
        <main v-else class="pv2-body">
          <section class="pv2-materials">
            <h3>商品与创作要求</h3>
            <label>
              产品名称
              <input
                :value="settings.productName"
                placeholder="例如：日式棉麻遮光窗帘"
                @input="setSetting('productName', $event.target.value)"
              />
            </label>
            <label>
              核心卖点（选填）
              <textarea
                :value="settings.sellingPoints"
                rows="3"
                placeholder="填写已确认的卖点；留空时由策划模型结合商品资料判断"
                @input="setSetting('sellingPoints', $event.target.value)"
              ></textarea>
            </label>
            <label>
              视频类型
              <ThemedSelect
                :model-value="settings.videoType || ''"
                :options="types"
                aria-label="主图视频2视频类型"
                @update:model-value="setSetting('videoType', $event)"
              />
            </label>
            <div class="pv2-row">
              <h3>
                产品图
                <small>{{ workflow.references.length }} 张</small>
              </h3>
              <div>
                <button :disabled="uploading" @click="imageInput.click()">本地上传</button>
                <button @click="openPicker('product')">画布图片</button>
              </div>
            </div>
            <p class="pv2-hint">原图直接送入策划模型，不压缩图片。生成视频时继续使用这组参考图。</p>
            <div class="pv2-images">
              <figure v-for="(image, index) in workflow.references" :key="image.id">
                <img :src="image.url" :alt="image.name || '产品图'" />
                <figcaption>
                  图{{ index + 1 }}
                  <button
                    :aria-label="`移除产品图${index + 1}`"
                    @click="
                      change((task) => {
                        task.references = task.references.filter((item) => item.id !== image.id)
                      })
                    "
                  >
                    ×
                  </button>
                </figcaption>
              </figure>
            </div>
            <details class="pv2-extra">
              <summary>参考视频与可选首帧</summary>
              <h4>参考视频（选填）</h4>
              <div class="pv2-actions">
                <button :disabled="uploading" @click="referenceInput.click()">上传参考视频</button>
                <button @click="openPicker('video')">画布视频</button>
              </div>
              <div v-if="workflow.referenceVideo" class="pv2-reference-video">
                <video
                  :src="workflow.referenceVideo.url"
                  controls
                  playsinline
                  preload="metadata"
                ></video>
                <span>
                  {{ workflow.referenceVideo.name }} ·
                  {{ Number(workflow.referenceVideo.duration).toFixed(1) }}秒
                </span>
                <button @click="set('referenceVideo', null)">移除参考视频</button>
              </div>
              <p class="pv2-hint">
                有参考视频时先锁定原片镜头、动态与声音，再替换商品；每30秒来源区间输出一段30秒脚本，尾段保留原镜头数自然延展。
              </p>
              <template v-if="workflow.referenceVideo">
                <label class="pv2-check">
                  <input
                    type="checkbox"
                    :checked="settings.allowReferenceStructureChanges === true"
                    @change="setSetting('allowReferenceStructureChanges', $event.target.checked)"
                  />
                  允许按修改意见调整原片镜头结构
                </label>
                <label class="pv2-check">
                  <input
                    type="checkbox"
                    :checked="settings.allowAudioChanges === true"
                    @change="setSetting('allowAudioChanges', $event.target.checked)"
                  />
                  允许按修改意见重写口播与声音
                </label>
              </template>
              <h4>首帧画面（选填）</h4>
              <div class="pv2-actions">
                <button :disabled="uploading" @click="firstInput.click()">上传首帧参考</button>
                <button @click="openPicker('first')">画布图片</button>
              </div>
              <figure v-if="settings.firstFrame" class="pv2-first">
                <img :src="settings.firstFrame.url" alt="可选首帧参考" />
                <button @click="setSetting('firstFrame', null)">移除首帧参考</button>
              </figure>
            </details>
            <label>
              其他创作要求（选填）
              <textarea
                :value="workflow.brief"
                rows="3"
                placeholder="使用场景、人物、口播要求或已有脚本规格"
                @input="set('brief', $event.target.value)"
              ></textarea>
            </label>
            <label>
              策划模型
              <ThemedSelect
                :model-value="workflow.planningModel || 'default'"
                :options="planningModels"
                aria-label="主图视频2策划模型"
                :disabled="planning"
                @update:model-value="selectPlanningModel"
              />
            </label>
            <p class="pv2-hint">
              {{
                workflow.referenceVideo
                  ? '完整视频分析需要支持原生视频输入的策划模型。'
                  : '自由策划按约15秒组织4至10个详细分镜；每镜标注起止秒数，按动作、口播和留白分配时间。'
              }}
            </p>
            <button
              class="pv2-primary"
              :disabled="waitingPlan || uploading || !capabilities?.mainVideo2"
              @click="createScript()"
            >
              {{
                planning
                  ? '正在策划…'
                  : workflow.shots.length
                    ? '按当前要求重新策划'
                    : '生成分镜脚本'
              }}
            </button>
            <p v-if="!capabilities?.mainVideo2" class="pv2-hint">
              {{
                capabilitiesError ||
                (capabilitiesLoading
                  ? '正在连接服务…'
                  : '主图视频2服务尚未连接，请重启后端后重新打开')
              }}
            </p>
          </section>
          <section class="pv2-results">
            <div v-if="workflow.planJob" class="pv2-progress" role="status">
              <strong>{{ workflow.planJob.stage }}</strong>
              <p v-if="workflow.planJob.error || workflow.planJob.pollError">
                {{ workflow.planJob.error || workflow.planJob.pollError }}
              </p>
              <button
                v-if="['failed', 'unknown'].includes(workflow.planJob.status)"
                :disabled="planning"
                @click="retryPlan"
              >
                {{ workflow.planJob.status === 'unknown' ? '确认原提交状态' : '继续未完成策划' }}
              </button>
            </div>
            <template v-if="active">
              <div class="pv2-row">
                <h3>分镜与口播脚本</h3>
                <button @click="copyScript">复制完整脚本</button>
              </div>
              <ThemedSelect
                :model-value="active.id"
                :options="
                  workflow.shots.map((shot, index) => ({
                    value: shot.id,
                    label: `${index + 1}. ${shot.title}`,
                  }))
                "
                aria-label="选择主图视频2脚本"
                @update:model-value="activeShotId = $event"
              />
              <textarea
                class="pv2-script"
                :value="active.motion"
                aria-label="主图视频2完整脚本"
                spellcheck="false"
                @input="
                  shotChange(active.id, (shot) => {
                    shot.motion = $event.target.value
                  })
                "
              ></textarea>
              <label>
                修改意见
                <textarea
                  :value="settings.revision"
                  rows="2"
                  placeholder="例如：口播再自然一点、开头换个生活事件、背景布料动态再详细一点"
                  @input="setSetting('revision', $event.target.value)"
                ></textarea>
              </label>
              <div class="pv2-actions">
                <button :disabled="waitingPlan || uploading" @click="createScript('variant')">
                  换一版
                </button>
                <button
                  :disabled="waitingPlan || uploading || !settings.revision?.trim()"
                  @click="createScript('revise')"
                >
                  按意见调整
                </button>
              </div>
              <div class="pv2-generation">
                <h3>参考图直接生成整片</h3>
                <p v-if="isSeedanceAnciModel(model)" role="note">{{ seedanceAnciNotice(model, workflow.videoVersion, active.duration) }}</p>
                <div class="pv2-settings">
                  <label>
                    视频模型
                    <ThemedSelect
                      :model-value="model"
                      :options="videoModels"
                      aria-label="主图视频2视频模型"
                      @update:model-value="setVideoModel"
                    />
                  </label>
                  <label>
                    比例
                    <ThemedSelect
                      :model-value="workflow.ratio"
                      :options="(isSeedanceAnciModel(model) ? SEEDANCE_ANCI_RATIOS : VIDEO_RATIOS).map((value) => ({ value, label: value }))"
                      aria-label="主图视频2视频比例"
                      @update:model-value="set('ratio', $event)"
                    />
                  </label>
                  <label>
                    清晰度
                    <ThemedSelect
                      :model-value="workflow[resolutionKey]"
                      :options="resolutions"
                      aria-label="主图视频2视频清晰度"
                      @update:model-value="set(resolutionKey, $event)"
                    />
                  </label>
                  <label v-if="isSeedanceAnciModel(model)">
                    速度版本
                    <ThemedSelect :model-value="workflow.videoVersion || '快速'" :options="SEEDANCE_ANCI_VERSIONS"
                      aria-label="主图视频2速度版本" @update:model-value="set('videoVersion', $event)" />
                  </label>
                  <label>
                    声音
                    <button
                      type="button"
                      role="switch"
                      aria-label="主图视频2生成声音"
                      :aria-checked="audioEnabled"
                      :class="['pv2-sound-toggle', { 'is-on': audioEnabled }]"
                      :disabled="
                        busyVideo || !audioSwitchSupported || !capabilities?.synchronizedAudio
                      "
                      @click="
                        change((task) => {
                          task.generateAudio = !audioEnabled
                          task.keepOriginalAudio = task.generateAudio
                        })
                      "
                    >
                      <i
                        :class="audioEnabled ? 'ri-volume-up-line' : 'ri-volume-mute-line'"
                        aria-hidden="true"
                      ></i>
                      {{ !audioSwitchSupported ? '不可切换' : audioEnabled ? '开启' : '关闭' }}
                      <span class="pv2-sound-track" aria-hidden="true"><span></span></span>
                    </button>
                  </label>
                </div>
                <p v-if="!audioSwitchSupported" class="pv2-hint">
                  当前模型不支持声音开关，需要切换声音时可选择 Seedance 模型。
                </p>
                <p class="pv2-hint">
                  本段为{{
                    whole30 ? 30 : 15
                  }}秒整片，直接带入产品参考图和完整脚本；生成成功后按接口实际用量结算，并同步到画布。
                </p>
                <p v-if="generationIssue" class="pv2-hint">{{ generationIssue }}</p>
                <button
                  class="pv2-primary"
                  :disabled="
                    busyVideo ||
                    !videoModels.length ||
                    !canGenerateVideo(active, generationWorkflow)
                  "
                  @click="generate(active.id, 'video')"
                >
                  {{ busyVideo ? '视频生成中…' : video ? '生成新视频版本' : '生成视频' }}
                </button>
                <p v-if="latestVideo" class="pv2-hint" role="status">
                  {{ videoGenerationStatus(latestVideo) }}
                </p>
                <button
                  v-if="latestVideo?.status === 'unknown' && latestVideo.submissionTracked"
                  @click="retryVideoSubmission(active.id, latestVideo.id)"
                >
                  核对原提交
                </button>
                <template v-if="video">
                  <video
                    class="pv2-result-video"
                    :src="video.url"
                    controls
                    playsinline
                    preload="metadata"
                  ></video>
                  <div class="pv2-actions">
                    <ThemedSelect
                      :model-value="active.videoId"
                      :options="
                        active.videos
                          .filter((item) => item.url)
                          .map((item, index) => ({
                            value: item.id,
                            label: `视频版本 ${index + 1}`,
                          }))
                      "
                      aria-label="主图视频2视频版本"
                      @update:model-value="
                        shotChange(active.id, (shot) => {
                          shot.videoId = $event
                        })
                      "
                    />
                    <a :href="video.url" download target="_blank" rel="noopener">下载视频</a>
                  </div>
                </template>
              </div>
            </template>
            <div v-else class="pv2-empty">
              <i class="ri-file-edit-line" aria-hidden="true"></i>
              <p>添加商品资料后开始策划</p>
              <span>详细分镜、具体动态、自然口播，一份完整脚本直接生成视频。</span>
            </div>
          </section>
        </main>
        <div v-if="picker" class="pv2-picker-overlay">
          <section class="pv2-picker" role="dialog" aria-label="选择画布素材">
            <div class="pv2-row">
              <h3>{{ picker.role === 'video' ? '选择参考视频' : '选择画布图片' }}</h3>
              <button aria-label="关闭素材选择" @click="picker = null">×</button>
            </div>
            <div class="pv2-picker-grid">
              <button
                v-for="layer in picker.role === 'video' ? videoLayers : imageLayers"
                :key="layer.id"
                :disabled="uploading"
                @click="chooseAsset(layer)"
              >
                <video
                  v-if="layer.type === 'video'"
                  :src="layer.url"
                  preload="metadata"
                  muted
                ></video>
                <img v-else :src="layer.url" :alt="layer.name || '画布图片'" />
                <span>{{ layer.name || '画布素材' }}</span>
              </button>
            </div>
            <p
              v-if="!(picker.role === 'video' ? videoLayers : imageLayers).length"
              class="pv2-hint"
            >
              画布中暂无可用素材
            </p>
          </section>
        </div>
        <input
          ref="imageInput"
          type="file"
          accept="image/*"
          multiple
          hidden
          @change="upload($event, 'product')"
        />
        <input
          ref="firstInput"
          type="file"
          accept="image/*"
          hidden
          @change="upload($event, 'first')"
        />
        <input
          ref="referenceInput"
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          hidden
          @change="upload($event, 'video')"
        />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.pv2-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  background: #0009;
  display: grid;
  place-items: center;
  padding: 16px;
  color: var(--canvas-text);
}
.pv2-dialog {
  width: min(1480px, 100%);
  height: min(940px, 95dvh);
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 10px;
  overflow: hidden;
}
.pv2-header {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px 20px;
  border-bottom: 1px solid var(--canvas-border);
}
h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
}
h2 i {
  color: var(--canvas-accent);
}
h3 {
  font-size: 14px;
  margin: 0 0 12px;
}
h4 {
  font-size: 12px;
  margin: 18px 0 8px;
}
small {
  color: var(--canvas-text-muted);
  font-weight: 400;
}
button,
input,
textarea {
  font: inherit;
  color: inherit;
}
button,
a {
  border: 1px solid var(--canvas-border);
  background: var(--canvas-input);
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  color: inherit;
  text-decoration: none;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.pv2-primary {
  background: var(--canvas-accent);
  border-color: transparent;
  color: #fff;
}
.pv2-header > input {
  flex: 1;
  min-width: 180px;
}
.pv2-close {
  margin-left: auto;
  font-size: 20px;
  padding: 3px 10px;
}
.pv2-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(310px, 0.8fr) minmax(0, 1.6fr);
  overflow: hidden;
}
.pv2-materials,
.pv2-results {
  padding: 22px;
  min-width: 0;
  overflow: auto;
}
.pv2-materials {
  border-right: 1px solid var(--canvas-border);
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 16px;
  color: var(--canvas-text-muted);
}
input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--canvas-border);
  background: var(--canvas-input);
  border-radius: 6px;
  padding: 9px 10px;
  color: var(--canvas-text);
  outline: none;
}
input:focus,
textarea:focus {
  border-color: var(--canvas-accent);
}
textarea {
  line-height: 1.7;
  resize: vertical;
}
.pv2-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.pv2-row h3 {
  margin: 0;
}
.pv2-row > div,
.pv2-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.pv2-actions {
  margin: 12px 0;
}
.pv2-hint {
  color: var(--canvas-text-muted);
  line-height: 1.7;
  font-size: 12px;
}
.pv2-check {
  flex-direction: row;
  align-items: center;
}
.pv2-check input {
  width: 14px;
  accent-color: var(--canvas-accent);
}
.pv2-images {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}
figure {
  margin: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  overflow: hidden;
}
figure img {
  width: 100%;
  height: 112px;
  object-fit: contain;
  background: var(--canvas-input);
}
figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  font-size: 12px;
}
figcaption button {
  padding: 0 5px;
}
.pv2-extra {
  border-block: 1px solid var(--canvas-border);
  padding: 12px 0;
  margin: 16px 0;
  font-size: 12px;
}
summary {
  cursor: pointer;
}
.pv2-first {
  width: 140px;
  margin: 12px 0;
}
.pv2-first button {
  width: 100%;
}
.pv2-reference-video {
  display: grid;
  gap: 8px;
}
.pv2-reference-video video {
  width: 100%;
  max-height: 200px;
}
.pv2-script {
  width: 100%;
  min-height: 340px;
  height: 46dvh;
  margin: 14px 0;
  line-height: 1.9;
  font-size: 13px;
}
.pv2-settings {
  display: grid;
  grid-template-columns: minmax(140px, 2fr) repeat(2, minmax(80px, 1fr)) minmax(120px, 1fr);
  gap: 12px;
}
.pv2-settings label {
  min-width: 0;
  margin-bottom: 0;
}
.pv2-sound-toggle {
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  white-space: nowrap;
}
.pv2-sound-toggle.is-on {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent);
  background: var(--canvas-accent-soft);
}
.pv2-sound-track {
  flex-shrink: 0;
  width: 24px;
  height: 14px;
  border-radius: 8px;
  background: var(--canvas-text-muted);
  margin-left: auto;
  padding: 2px;
}
.pv2-sound-track > span {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #fff;
}
.pv2-sound-toggle.is-on .pv2-sound-track {
  background: var(--canvas-accent);
}
.pv2-sound-toggle.is-on .pv2-sound-track > span {
  transform: translateX(10px);
}
.pv2-generation {
  border-top: 1px solid var(--canvas-border);
  padding-top: 18px;
  margin-top: 22px;
}
.pv2-result-video {
  display: block;
  width: 100%;
  max-height: 440px;
  background: #111;
  margin-top: 16px;
  border-radius: 6px;
}
.pv2-empty {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  color: var(--canvas-text-muted);
  text-align: center;
}
.pv2-empty i {
  font-size: 38px;
  color: var(--canvas-accent);
}
.pv2-empty span {
  font-size: 12px;
}
.pv2-message,
.pv2-progress {
  padding: 12px 20px;
  margin: 0;
  line-height: 1.7;
  font-size: 12px;
  background: var(--canvas-accent-soft);
}
.pv2-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pv2-message.error {
  color: #ef7777;
}
.pv2-message button {
  border: 0;
  padding: 0 6px;
  background: transparent;
}
.pv2-progress {
  border-radius: 6px;
  margin-bottom: 16px;
  border: 1px solid var(--canvas-border);
}
.pv2-progress p {
  margin: 6px 0;
}
.pv2-picker-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: #0008;
  z-index: 2;
  padding: 24px;
}
.pv2-picker {
  width: min(840px, 100%);
  max-height: 80%;
  overflow: auto;
  padding: 20px;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
}
.pv2-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.pv2-picker-grid button {
  min-width: 0;
  display: grid;
  gap: 8px;
}
.pv2-picker-grid img,
.pv2-picker-grid video {
  width: 100%;
  height: 130px;
  object-fit: contain;
}
.pv2-picker-grid span {
  font-size: 12px;
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .pv2-body {
    display: block;
    overflow: auto;
  }
  .pv2-materials,
  .pv2-results {
    overflow: visible;
    padding: 16px;
  }
  .pv2-materials {
    border: 0;
    border-bottom: 1px solid var(--canvas-border);
  }
  .pv2-script {
    height: 420px;
  }
  .pv2-settings {
    grid-template-columns: 1fr 1fr;
  }
  .pv2-settings label:first-child {
    grid-column: 1 / -1;
  }
  .pv2-picker-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

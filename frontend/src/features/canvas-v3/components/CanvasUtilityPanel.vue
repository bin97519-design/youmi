<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import {
  createVideoSavedAssetClient,
  savedAssetMediaKind,
  videoSavedAssetInfo,
} from '../sync/videoSavedAssetClient.js'
import { imageAssetSourceUrl } from '../config/imageAssetCollections.js'
import { personalAssetImageUrl } from '../config/personalAssetLibrary.js'
import CanvasIcon from './CanvasIcon.vue'
const props = defineProps({
  panel: { type: String, required: true },
  assetRevision: { type: Number, default: 0 },
})
const emit = defineEmits([
  'close',
  'demo',
  'export',
  'import-images',
  'import-saved-asset',
  'preview-image',
  'preview-video',
  'import-saved-video',
])
const graph = useCanvasV3GraphStore()
const user = useUserStore()
const savedAssetClient = createVideoSavedAssetClient({
  path: apiPath,
  headers: () => user.authHeaders(),
})
const savedAssets = ref([])
const assetsLoading = ref(false)
const assetsError = ref('')
const assetAccount = computed(() =>
  user.isAuthenticated ? String(user.profile?.id || user.profile?.userId || '') : '',
)
let assetsController
let assetsRequest = 0
let lastAccount = ''

function abortAssetRead() {
  assetsRequest += 1
  assetsController?.abort()
  assetsController = null
  assetsLoading.value = false
}
async function refreshSavedAssets() {
  abortAssetRead()
  if (props.panel !== 'assets') return
  if (lastAccount !== assetAccount.value) savedAssets.value = []
  lastAccount = assetAccount.value
  assetsError.value = ''
  if (!assetAccount.value) return
  const current = ++assetsRequest
  const account = assetAccount.value
  const controller = new AbortController()
  assetsController = controller
  assetsLoading.value = true
  try {
    const records = await savedAssetClient.list({ signal: controller.signal, includeImages: true })
    if (
      controller.signal.aborted ||
      current !== assetsRequest ||
      account !== assetAccount.value ||
      props.panel !== 'assets'
    )
      return
    savedAssets.value = records.filter((record) => savedAssetMediaKind(record))
  } catch (error) {
    if (!controller.signal.aborted && current === assetsRequest && account === assetAccount.value)
      assetsError.value = error.message?.replace(/模特/g, '资产') || '个人资产加载失败，请重试'
  } finally {
    if (current === assetsRequest) {
      assetsLoading.value = false
      assetsController = null
    }
  }
}
function loginForAssets() {
  if (user.requireLogin()) refreshSavedAssets()
}
watch(() => [props.panel, props.assetRevision, assetAccount.value], refreshSavedAssets, {
  immediate: true,
})
onBeforeUnmount(abortAssetRead)
function selectAsset(node) {
  graph.nodes.forEach((item) => {
    item.selected = item.id === node.id
  })
  emit('close')
}
const filter = ref('all')
const upload = ref(null)
const titles = {
  assets: '资产管理',
  history: '生成历史',
  characters: '模特造型室',
  shortcuts: '快捷键',
  help: '画布教程',
  assistant: '创作助手',
  share: '发布与分享',
  points: '算力与会员',
  account: '个人中心',
}
const media = computed(() =>
  graph.nodes.filter(
    (node) =>
      node.data?.assetUrl &&
      (node.data.kind !== 'image' || imageAssetSourceUrl(node.data.assetUrl)) &&
      (filter.value === 'all' || node.data.kind === filter.value),
  ),
)
const assetCards = computed(() => {
  const cards = new Map()
  for (const node of media.value) {
    const key = `${node.data.kind}:${node.data.assetUrl}`
    if (!cards.has(key))
      cards.set(key, {
        key,
        node,
        kind: node.data.kind,
        url: node.data.assetUrl,
        posterUrl: personalAssetImageUrl(node.data.posterUrl || node.data.thumbnail) || '',
        name: node.data.title || '未命名素材',
        saved: null,
      })
  }
  for (const saved of savedAssets.value) {
    const kind = savedAssetMediaKind(saved)
    if (!kind || (filter.value !== 'all' && filter.value !== kind)) continue
    const video = videoSavedAssetInfo(saved)
    const url = video?.url || saved.imageUrl
    const key = `${kind}:${url}`
    if (cards.has(key)) {
      cards.get(key).saved = saved
      if (video?.posterUrl) cards.get(key).posterUrl = video.posterUrl
    } else
      cards.set(key, {
        key,
        node: null,
        kind,
        url,
        posterUrl: video?.posterUrl || '',
        name: saved.name || (kind === 'video' ? '未命名视频' : '未命名图片'),
        saved,
      })
  }
  return [...cards.values()]
})
function savedFolder(record) {
  const path = record?.config?.canvasAsset?.folderPath
  return Array.isArray(path) ? path.filter((item) => typeof item === 'string').join(' / ') : ''
}
function savedTags(record) {
  const tags = record?.config?.canvasAsset?.tags
  return Array.isArray(tags) ? tags.filter((item) => typeof item === 'string').join(' · ') : ''
}
function openAssetCard(card) {
  if (card.saved) emit(card.kind === 'video' ? 'preview-video' : 'preview-image', card.saved)
  else if (card.node) selectAsset(card.node)
}
function importSavedAsset(record) {
  if (videoSavedAssetInfo(record)) emit('import-saved-video', record)
  else if (savedAssetMediaKind(record) === 'image') emit('import-saved-asset', record)
}
const history = computed(() =>
  graph.nodes
    .flatMap((node) =>
      (node.data.candidates || []).map((candidate) => ({
        ...candidate,
        nodeId: node.id,
        title: node.data.title,
      })),
    )
    .sort((left, right) => right.createdAt - left.createdAt),
)
function selectVersion(candidate) {
  graph.remember()
  graph.updateNodeData(candidate.nodeId, { assetUrl: candidate.url, artifactStatus: 'ready' })
  graph.nodes.forEach((node) => {
    node.selected = node.id === candidate.nodeId
  })
  emit('close')
}
const keys = [
  ['添加节点', 'Tab / 双击画布'],
  ['移动画布', '按住空格拖动'],
  ['切换移动工具', 'H'],
  ['多选节点', 'Shift + 单击'],
  ['复制节点', 'Ctrl + D'],
  ['粘贴图片到画布', 'Ctrl + V'],
  ['删除选中', 'Delete'],
  ['撤销', 'Ctrl + Z'],
  ['重做', 'Ctrl + Shift + Z'],
  ['适应画布', 'Ctrl + 0'],
  ['整理画布', 'Alt + Shift + F'],
  ['关闭面板', 'Esc'],
]
function importFile(event) {
  const files = Array.from(event.target.files || [])
  if (files.length) emit('import-images', files)
  event.target.value = ''
}
</script>

<template>
  <aside
    class="cv3-utility-panel"
    :class="{ 'is-dialog': ['shortcuts', 'help', 'share', 'points', 'account'].includes(panel) }"
    :aria-label="titles[panel]"
  >
    <header>
      <h2>{{ titles[panel] }}</h2>
      <button type="button" aria-label="关闭面板" @click="emit('close')">
        <i class="ri-close-line" />
      </button>
    </header>
    <template v-if="panel === 'assets'">
      <div class="cv3-asset-filters">
        <button
          v-for="(label, key) in { all: '全部', image: '图片', video: '视频', audio: '音频' }"
          :key="key"
          type="button"
          :class="{ active: filter === key }"
          @click="filter = key"
        >
          {{ label }}
        </button>
        <button type="button" class="cv3-upload-action" @click="upload.click()">
          <i class="ri-upload-2-line" />
          上传
        </button>
      </div>
      <input ref="upload" type="file" accept="image/*" multiple hidden @change="importFile" />
      <div class="cv3-cloud-asset-status" aria-live="polite">
        <p v-if="assetsLoading" role="status">正在加载个人资产…</p>
        <p v-else-if="!assetAccount">
          登录后可查看保存到个人资产库的图片与视频。
          <button type="button" @click="loginForAssets">登录</button>
        </p>
        <p v-else-if="assetsError" role="alert">
          {{ assetsError }}
          <button type="button" @click="refreshSavedAssets">重试</button>
        </p>
        <p v-else>
          个人资产与当前画布素材
          <button type="button" aria-label="刷新个人资产" @click="refreshSavedAssets">刷新</button>
        </p>
      </div>
      <div v-if="assetCards.length" class="cv3-managed-asset-grid">
        <article v-for="card in assetCards" :key="card.key" class="cv3-managed-asset-card">
          <button
            type="button"
            class="cv3-managed-asset-main"
            :aria-label="`${card.saved ? '预览资产' : '定位素材'}${card.name}`"
            @click="openAssetCard(card)"
          >
            <img
              v-if="card.kind === 'image' || card.posterUrl"
              :src="card.kind === 'image' ? card.url : card.posterUrl"
              :alt="card.name"
              referrerpolicy="no-referrer"
            />
            <CanvasIcon v-else :name="card.kind" :size="32" />
            <span :title="card.name">{{ card.name }}</span>
          </button>
          <template v-if="card.saved">
            <p
              v-if="savedFolder(card.saved)"
              class="cv3-managed-asset-meta"
              :title="savedFolder(card.saved)"
            >
              {{ savedFolder(card.saved) }}
            </p>
            <p
              v-if="savedTags(card.saved)"
              class="cv3-managed-asset-meta"
              :title="savedTags(card.saved)"
            >
              {{ savedTags(card.saved) }}
            </p>
            <div class="cv3-managed-asset-actions">
              <button
                v-if="card.node"
                type="button"
                :aria-label="`定位素材${card.name}`"
                @click="selectAsset(card.node)"
              >
                定位
              </button>
              <button
                type="button"
                :aria-label="`添加资产${card.saved.name}到画布`"
                @click="importSavedAsset(card.saved)"
              >
                添加到画布
              </button>
            </div>
          </template>
        </article>
      </div>
      <div v-else-if="!assetsLoading" class="cv3-utility-empty">
        <CanvasIcon name="assets" :size="40" />
        <strong>{{ assetAccount && !assetsError ? '还没有素材' : '当前画布暂无素材' }}</strong>
        <p>
          {{
            filter === 'all'
              ? '上传图片、生成内容或保存个人资产后，素材会显示在这里'
              : '没有符合当前类型的素材，可切换“全部”查看'
          }}
        </p>
        <button type="button" @click="upload.click()">上传图片</button>
      </div>
    </template>
    <template v-else-if="panel === 'history' && history.length">
      <div class="cv3-asset-grid">
        <button
          v-for="(candidate, index) in history"
          :key="candidate.url + index"
          type="button"
          @click="selectVersion(candidate)"
        >
          <img :src="candidate.url" :alt="candidate.title" />
          <span>{{ candidate.title }}</span>
        </button>
      </div>
    </template>
    <template v-else-if="panel === 'shortcuts'">
      <div class="cv3-shortcuts">
        <div v-for="[label, key] in keys" :key="label">
          <span>{{ label }}</span>
          <kbd>{{ key }}</kbd>
        </div>
      </div>
    </template>
    <template v-else-if="panel === 'assistant'">
      <div class="cv3-assistant-welcome">
        <span class="cv3-assistant-star">✦</span>
        <h3>把灵感，变成画面</h3>
        <p>从一句创意开始，搭建你的创作工作流</p>
        <button type="button" @click="emit('demo')">
          <CanvasIcon name="workflow" :size="18" />
          <span>
            打开演示工作流
            <small>创意 → 剧本 → 图片 → 视频 → 剪辑</small>
          </span>
          <i class="ri-arrow-right-up-line" />
        </button>
      </div>
      <p class="cv3-connection-note">当前支持画布交互与参数编辑，AI 对话和生成服务待接入。</p>
    </template>
    <template v-else-if="panel === 'help'">
      <div class="cv3-help-content">
        <h3>从一个节点开始</h3>
        <p>
          双击空白画布，或使用底部 +
          创建节点。选中媒体节点后，在下方浮动面板输入提示词、选择模型与参数。
        </p>
        <h3>连接你的创意</h3>
        <p>拖动节点两侧圆点建立连线。脚本模板会自动创建文本节点和引用关系。</p>
        <h3>导入图片</h3>
        <p>复制图片后按 Ctrl + V 粘贴到画布，或将图片文件直接拖入画布，支持一次导入多张。</p>
        <button type="button" @click="emit('demo')">
          打开演示工作流
          <i class="ri-arrow-right-line" />
        </button>
      </div>
    </template>
    <template v-else-if="panel === 'share'">
      <div class="cv3-help-content">
        <h3>保存创作，分享灵感</h3>
        <p>画布会自动保存在当前浏览器。你可以先导出完整节点与参数文件。</p>
        <button type="button" @click="emit('export')">导出画布 JSON</button>
        <p class="cv3-connection-note">公开链接与协作权限尚未接入。</p>
      </div>
    </template>
    <template v-else>
      <div class="cv3-utility-empty">
        <CanvasIcon
          :name="panel === 'history' ? 'history' : panel === 'characters' ? 'character' : 'credits'"
          :size="40"
        />
        <strong>
          {{
            panel === 'history'
              ? '暂无生成记录'
              : panel === 'characters'
                ? '还没有角色资产'
                : '服务尚未接入'
          }}
        </strong>
        <p>
          {{
            panel === 'history'
              ? '真实生成任务接入后，这里将展示历史结果。'
              : panel === 'characters'
                ? '角色资产服务接入后，可在这里管理和引用角色。'
                : '当前是画布交互演示，未产生扣费。'
          }}
        </p>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.cv3-cloud-asset-status {
  color: #8a8a8a;
  font-size: 12px;
}
.cv3-cloud-asset-status p {
  margin: 12px 0 0;
  line-height: 1.6;
}
.cv3-cloud-asset-status button {
  margin-left: 8px;
  padding: 2px 5px;
  border: 0;
  border-radius: 4px;
  background: #353535;
  color: #ddd;
  font: inherit;
  cursor: pointer;
}
.cv3-managed-asset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding-top: 16px;
}
.cv3-managed-asset-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #3e3e3e;
  border-radius: 8px;
  background: #292929;
}
.cv3-managed-asset-main {
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: none;
  color: #ccc;
  text-align: left;
  cursor: pointer;
}
.cv3-managed-asset-main img {
  display: block;
  width: 100%;
  aspect-ratio: 1.3;
  object-fit: cover;
}
.cv3-managed-asset-main > svg {
  display: block;
  height: 100px;
  margin: auto;
}
.cv3-managed-asset-main > span {
  display: block;
  padding: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.cv3-managed-asset-meta {
  margin: -2px 9px 6px;
  color: #888;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cv3-managed-asset-actions {
  display: flex;
  gap: 4px;
  padding: 2px 8px 8px;
}
.cv3-managed-asset-actions button {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 3px;
  border: 1px solid #484848;
  border-radius: 5px;
  background: #353535;
  color: #ddd;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.cv3-managed-asset-card button:focus-visible,
.cv3-cloud-asset-status button:focus-visible {
  outline: 1px solid #aaa;
  outline-offset: -2px;
}
</style>

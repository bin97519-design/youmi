<script setup>
import { computed, ref } from 'vue'
import { useCanvasV3GraphStore } from '../stores/graph'
import CanvasIcon from './CanvasIcon.vue'
defineProps({ panel: { type: String, required: true } })
const emit = defineEmits(['close', 'demo', 'export'])
const graph = useCanvasV3GraphStore()
function selectAsset(node) {
  graph.nodes.forEach((item) => {
    item.selected = item.id === node.id
  })
  emit('close')
}
const filter = ref('all')
const upload = ref(null)
const message = ref('')
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
    (node) => node.data.assetUrl && (filter.value === 'all' || node.data.kind === filter.value),
  ),
)
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
  ['删除选中', 'Delete'],
  ['撤销', 'Ctrl + Z'],
  ['重做', 'Ctrl + Shift + Z'],
  ['适应画布', 'Ctrl + 0'],
  ['整理画布', 'Alt + Shift + F'],
  ['关闭面板', 'Esc'],
]
async function importFile(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.size > 1024 * 1024) {
    message.value = '本地演示支持 1MB 以内的图片；大文件上传将在素材服务接入后开放。'
    return
  }
  if (!file.type.startsWith('image/')) {
    message.value = '请选择图片文件'
    return
  }
  const totalBytes = graph.nodes.reduce(
    (sum, node) => sum + (node.data.assetUrl?.startsWith('data:') ? node.data.assetUrl.length : 0),
    0,
  )
  if (totalBytes + file.size * 1.4 > 2500000) {
    message.value = '当前画布的本地图片存储已满，请使用较小的图片。'
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const node = graph.addNode('image')
    graph.updateNodeData(node.id, {
      title: file.name,
      assetUrl: reader.result,
      artifactStatus: 'ready',
      mediaOrigin: 'upload',
    })
    message.value = '图片已加入画布，可以连线引用。'
  }
  reader.readAsDataURL(file)
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
      <input ref="upload" type="file" accept="image/*" hidden @change="importFile" />
      <div v-if="media.length" class="cv3-asset-grid">
        <button v-for="node in media" :key="node.id" type="button" @click="selectAsset(node)">
          <img v-if="node.data.kind === 'image'" :src="node.data.assetUrl" :alt="node.data.title" />
          <CanvasIcon v-else :name="node.data.kind" :size="32" />
          <span>{{ node.data.title }}</span>
        </button>
      </div>
      <div v-else class="cv3-utility-empty">
        <CanvasIcon name="assets" :size="40" />
        <strong>还没有素材</strong>
        <p>上传图片或生成内容后，素材会显示在这里</p>
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
    <p v-if="message" class="cv3-utility-message" role="status">{{ message }}</p>
  </aside>
</template>

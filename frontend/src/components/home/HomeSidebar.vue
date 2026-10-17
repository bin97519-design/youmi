<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VersionHistoryDialog from '../common/VersionHistoryDialog.vue'
import { useVersionHistory } from '../../composables/useVersionHistory'
import { downloadLatestCliInstaller } from '../../utils/cliDownload'
const navigationIcons = {
  home: 'ri-home-5-line',
  canvas: 'ri-artboard-2-line',
  'canvas-v2': 'ri-node-tree',
  'selection-pool': 'ri-shopping-bag-3-line',
  designer: 'ri-magic-line',
  product: 'ri-image-line',
  model: 'ri-user-3-line',
  retouch: 'ri-edit-2-line',
  video: 'ri-film-line',
  ops: 'ri-compass-3-line',
}

const {
  currentAppVersion,
  versionHistoryOpen,
  hasUnreadVersion,
  openVersionHistory,
  closeVersionHistory,
} = useVersionHistory()

const props = defineProps({
  expanded: {
    type: Boolean,
    default: false,
  },
  loggedIn: {
    type: Boolean,
    default: false,
  },
  user: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['toggle', 'login'])
const router = useRouter()
const route = useRoute()
const openGroup = ref('designer')
const cliDownloadLoading = ref(false)
const displayUser = computed(
  () =>
    props.user || {
      id: '85296258',
      name: '用户8529...',
      plan: '普通用户',
    },
)

const menuItems = [
  { key: 'home', label: '首页', icon: 'home', route: '/' },
  { key: 'canvas', label: '万能画布', icon: 'canvas', route: '/canvas', dot: true },
  { key: 'canvas-v2', label: '新版画布', icon: 'canvas-v2', route: '/canvas-v3' },
  { key: 'selection-pool', label: '选品库', icon: 'selection-pool', route: '/selection-pool' },
  {
    key: 'designer',
    label: 'AI 设计师',
    icon: 'designer',
    children: [
      { label: '电商套图', route: '/ecommerce-set', badge: 'NEW' },
      { label: '详情页设计', active: true },
      { label: '主图设计', locked: true },
      { label: '竞品复刻', locked: true },
      { label: '服装套图', badge: 'NEW' },
      { label: 'SKU替换', locked: true },
      { label: '风格统一', locked: true },
      { label: '主图/详情页翻译', locked: true },
    ],
  },
  {
    key: 'product',
    label: 'AI 产品图',
    icon: 'product',
    children: [
      { label: '产品替换', locked: true },
      { label: '产品图案替换', locked: true },
      { label: '精修白底图', locked: true },
      { label: '精修产品图', locked: true },
      { label: '产品场景图', locked: true },
      { label: '产品换色', locked: true },
      { label: '使用产品', locked: true },
      { label: '手持产品', locked: true },
    ],
  },
  {
    key: 'model',
    label: 'AI 模特',
    icon: 'model',
    children: [
      { label: '服装上身', locked: true },
      { label: '模特换装', locked: true },
      { label: '模特换背景', locked: true },
      { label: '模特换姿势', locked: true },
      { label: '模特换角色', locked: true },
    ],
  },
  {
    key: 'retouch',
    label: 'AI 修图',
    icon: 'retouch',
    children: [
      { label: '高清修复', locked: true },
      { label: '修改尺寸', locked: true },
      { label: '智能扩图', locked: true },
      { label: '局部消除', locked: true },
      { label: '局部重绘', locked: true },
      { label: '去水印', locked: true },
      { label: '编辑文字', locked: true },
    ],
  },
  {
    key: 'video',
    label: 'AI 视频',
    icon: 'video',
    children: [
      { label: '产品展示', locked: true, status: '升级中' },
      { label: '模特使用', locked: true, status: '升级中' },
      { label: '生成视频', locked: true },
    ],
  },
  {
    key: 'ops',
    label: 'AI 运营',
    icon: 'ops',
    children: [
      { label: 'AI市场洞察', locked: true },
      { label: 'SEO标题引流', locked: true },
    ],
  },
]

function isActiveItem(item) {
  if (item.key === 'home') return route.path === '/'
  if (item.route) return route.path === item.route || route.path.startsWith(`${item.route}/`)
  if (item.children) {
    // 父分组在「有子项路由命中当前路由」或「手动展开」时高亮
    return (
      openGroup.value === item.key ||
      item.children.some(
        (c) => c.route && (route.path === c.route || route.path.startsWith(`${c.route}/`)),
      )
    )
  }
  return false
}

function isActiveChild(child) {
  if (!child.route) return false
  return route.path === child.route || route.path.startsWith(`${child.route}/`)
}

function openItem(item) {
  if (item.children) {
    openGroup.value = openGroup.value === item.key ? '' : item.key
    return
  }

  if (item.route) {
    if (item.route !== '/' && !props.loggedIn) {
      requestLogin(item.route)
      return
    }
    router.push(item.route)
  }
}

function requestLogin(redirectPath = '') {
  if (redirectPath) {
    router.replace({ path: '/', query: { redirect: redirectPath } })
  }
  emit('login')
}

function openChild(child) {
  // 若存在路由（如「电商套图」），未登录先拦截登录，否则跳转
  if (child.route) {
    if (!props.loggedIn) {
      requestLogin(child.route)
      return
    }
    router.push(child.route)
    return
  }
  // 锁定占位项：提示登录
  if (!props.loggedIn) {
    emit('login')
  }
}

function openHistory() {
  if (!props.loggedIn) {
    requestLogin('/history')
    return
  }
  router.push('/history')
}

function openConsole() {
  if (!props.loggedIn) {
    requestLogin('/console')
    return
  }
  router.push('/console')
}

async function openCliDownload() {
  if (cliDownloadLoading.value) return

  cliDownloadLoading.value = true
  try {
    const releaseInfo = await downloadLatestCliInstaller()
    const versionLabel = releaseInfo.version ? `v${releaseInfo.version}` : '最新版本'
    console.info('[CLI Download] 下载已触发:', versionLabel, releaseInfo.downloadUrl)
  } catch (error) {
    window.alert(error instanceof Error ? error.message : 'CLI 下载失败，请稍后重试。')
  } finally {
    cliDownloadLoading.value = false
  }
}
</script>

<template>
  <aside :class="['yh-rail', { 'is-expanded': expanded }]">
    <div class="yh-rail-brand">
      <svg class="yh-logo-mark" viewBox="0 0 122 34" aria-label="YOUMI">
        <path class="logo-stroke" d="M8 9.5c4.2 8 8 12 12.6 12.2 5.1.2 8.2-4.8 8.2-10.8" />
        <path class="logo-stroke" d="M20.3 21.6c-1.7 4.5-4.6 7.2-9.4 7.2" />
        <path
          class="logo-fill"
          d="M36.2 8.1c8.4 0 14.1 4.9 14.1 11.3 0 5.8-4.9 10.1-11.4 10.1-7.6 0-13.1-4.9-13.1-11.2 0-5.9 4.5-10.2 10.4-10.2Zm.8 6.3c-2.5 0-4.3 1.8-4.3 4.2 0 2.8 2.6 4.9 5.8 4.9 2.9 0 5-1.8 5-4.1 0-2.8-2.8-5-6.5-5Z"
        />
        <path
          class="logo-stroke"
          d="M51.7 10.2v9.4c0 6 3.3 9.6 9.1 9.6 5.8 0 9.5-3.8 9.5-9.8V10.2"
        />
        <path class="logo-stroke" d="M74.6 28.1V10.4l9.2 11.1 9.1-11.1v17.7" />
        <path class="logo-stroke" d="M101.3 10.4v17.7" />
        <path class="logo-stroke" d="M99.1 10.4h7.8" />
        <path class="logo-stroke" d="M99.1 28.1h8.1" />
      </svg>
      <div class="yh-logo-sub">有米AI</div>
      <button
        class="yh-logo-version"
        type="button"
        title="查看更新历程"
        @click.stop="openVersionHistory"
      >
        v{{ currentAppVersion }}
        <span v-if="hasUnreadVersion" class="version-unread-dot" aria-label="有新版本说明"></span>
      </button>
    </div>

    <nav class="yh-rail-nav" aria-label="主菜单">
      <div v-for="item in menuItems" :key="item.key" class="yh-nav-group">
        <button
          :class="[
            'yh-nav-item',
            {
              active: isActiveItem(item),
              'is-open': openGroup === item.key,
              'has-dot': item.dot,
            },
          ]"
          type="button"
          @click="openItem(item)"
        >
          <span class="yh-nav-icon" aria-hidden="true">
            <i :class="[navigationIcons[item.icon], 'yh-navigation-icon']"></i>
          </span>
          <span v-if="expanded" class="yh-nav-label">{{ item.label }}</span>
          <span
            v-if="expanded && item.children"
            :class="['yh-nav-arrow', { open: openGroup === item.key }]"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6.2 8 10l4-3.8" />
            </svg>
          </span>
        </button>

        <div v-if="expanded && item.children && openGroup === item.key" class="yh-submenu">
          <button
            v-for="child in item.children"
            :key="child.label"
            :class="[
              'yh-sub-item',
              { active: child.active || isActiveChild(child), locked: child.locked },
            ]"
            type="button"
            @click="openChild(child)"
          >
            <span>{{ child.label }}</span>
            <small v-if="child.badge" class="yh-sub-badge">{{ child.badge }}</small>
            <small v-if="child.status" class="yh-sub-status">{{ child.status }}</small>
            <span v-if="child.locked" class="yh-lock">▣</span>
          </button>
        </div>
      </div>
    </nav>

    <div class="yh-rail-history">
      <button
        :class="['yh-nav-item', { active: route.path === '/history' }]"
        type="button"
        @click="openHistory"
      >
        <span class="yh-nav-icon" aria-hidden="true">
          <i class="ri-history-line yh-navigation-icon"></i>
        </span>
        <span v-if="expanded" class="yh-nav-label">历史生成</span>
      </button>

      <button
        :class="['yh-nav-item', { active: route.path === '/console' }]"
        type="button"
        @click="openConsole"
      >
        <span class="yh-nav-icon" aria-hidden="true">
          <i class="ri-terminal-window-line yh-navigation-icon"></i>
        </span>
        <span v-if="expanded" class="yh-nav-label">控制台</span>
      </button>
    </div>

    <button
      class="yh-rail-toggle"
      type="button"
      :aria-label="expanded ? '收起菜单' : '展开菜单'"
      @click="emit('toggle')"
    >
      {{ expanded ? '‹' : '›' }}
    </button>

    <div class="yh-rail-bottom">
      <template v-if="!loggedIn">
        <button v-if="expanded" class="yh-login-wide" type="button" @click="emit('login')">
          登录
        </button>
        <button
          class="yh-bottom-icon yh-cli-download"
          type="button"
          :disabled="cliDownloadLoading"
          title="CLI download (checks latest.yml first)"
          aria-label="CLI download"
          @click="openCliDownload"
        >
          <i
            :class="['ri-download-cloud-2-line', { 'is-loading': cliDownloadLoading }]"
            aria-hidden="true"
          ></i>
        </button>
        <button v-if="!expanded" class="yh-login-mini" type="button" @click="emit('login')">
          登录
        </button>
      </template>

      <template v-else-if="expanded">
        <section class="yh-user-card">
          <div class="yh-user-top">
            <span class="yh-avatar"><i class="ri-user-3-line" aria-hidden="true"></i></span>
            <span>
              <strong>{{ displayUser.name }}</strong>
              <small>ID: {{ displayUser.id }}</small>
            </span>
            <span class="yh-user-caret">⌄</span>
          </div>
          <div class="yh-user-row">
            <span>{{ displayUser.plan }}</span>
            <button type="button">升级会员</button>
          </div>
        </section>
        <button class="yh-bottom-row" type="button">
          <span>♧</span>
          <span>系统通知</span>
          <span>›</span>
        </button>
        <div class="yh-appearance">
          <span>外观</span>
          <span>▱</span>
          <span>☼</span>
          <span class="active">◐</span>
        </div>
      </template>

      <template v-else>
        <button
          class="yh-bottom-icon yh-cli-download"
          type="button"
          :disabled="cliDownloadLoading"
          title="CLI download (checks latest.yml first)"
          aria-label="CLI download"
          @click="openCliDownload"
        >
          <i
            :class="['ri-download-cloud-2-line', { 'is-loading': cliDownloadLoading }]"
            aria-hidden="true"
          ></i>
        </button>
        <button class="yh-bottom-icon yh-avatar-mini" type="button" aria-label="用户"><i class="ri-user-3-line" aria-hidden="true"></i></button>
      </template>
    </div>
  </aside>
  <VersionHistoryDialog
    :open="versionHistoryOpen"
    :current-version="currentAppVersion"
    @close="closeVersionHistory"
  />
</template>

<style scoped>
.yh-navigation-icon,
.yh-bottom-icon > i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  font-size: 22px;
  line-height: 1;
  color: inherit;
  filter: none;
}
</style>

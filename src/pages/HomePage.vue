<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import CaseGallery from '../components/home/CaseGallery.vue';
import HomeComposer from '../components/home/HomeComposer.vue';
import HomeShortcuts from '../components/home/HomeShortcuts.vue';
import HomeSidebar from '../components/home/HomeSidebar.vue';
import ReversePromptPanel from '../components/prompt/ReversePromptPanel.vue';
import { useUserStore } from '../stores/user';
import { useCanvasStore } from '../stores/canvas';

const railExpanded = ref(false);
const prompt = ref('');
const generation = ref(null);
const composerRef = ref(null);
const userStore = useUserStore();
const router = useRouter();
const loggedIn = computed(() => userStore.isAuthenticated);
const userMenuOpen = ref(false);
const isDarkTheme = ref(document.documentElement.classList.contains('dark'));
const themeLabel = computed(() => isDarkTheme.value ? '亮色主题' : '暗色主题');

function onUserMenuBlur(event) {
  // 延迟关闭，让 click 事件先触发
  setTimeout(() => { userMenuOpen.value = false; }, 150);
}
function handleLogout() {
  userMenuOpen.value = false;
  userStore.logout();
  router.push('/');
}
function toggleTheme() {
  isDarkTheme.value = !isDarkTheme.value;
  if (isDarkTheme.value) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  userMenuOpen.value = false;
}
const reversePromptOpen = ref(false);
const reversePromptPending = ref(false);
const reversePromptError = ref('');
const reversePromptResult = ref(null);
const reversePromptCategories = ref([
  { value: 'general', label: '通用', groups: [], fieldLabels: {} },
  { value: 'mattress', label: '床垫', groups: [], fieldLabels: {} },
  { value: 'curtain', label: '窗帘', groups: [], fieldLabels: {} },
  { value: 'solid_wood_bed', label: '实木床', groups: [], fieldLabels: {} },
]);
let generationTimer = null;
const TASK_POLL_INTERVAL = 2500;
const TASK_MAX_POLLS = 120;
const DEFAULT_IMAGE_MODEL = 'gpt image 2';

const nowLabel = computed(() => {
  const now = new Date();
  return `今天 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
});
const activeDetailPlan = computed(() => {
  const plan = generation.value?.splitPlan;
  if (Array.isArray(plan) && plan.length) return plan;

  return [
    {
      index: 1,
      title: '首屏引导',
      goal: '快速说明产品价值。',
      visual: '产品居中展示，背景干净，突出第一眼质感。',
      copy: '一句话利益点 + 产品主视觉 + 关键卖点标签',
      prompts: {
        modelInput: '根据产品信息生成电商详情页首屏，产品主体清晰，标题简洁，背景干净，高清商业摄影质感。负向提示词：不要乱码文字，不要产品变形，不要杂乱背景。',
      },
    },
  ];
});
const detailCost = computed(() => activeDetailPlan.value.length * 15);
const referenceImageUrl = computed(
  () =>
    generation.value?.images?.[0]?.url ||
    'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=160&q=80',
);
const detailActionLabel = computed(() => {
  if (generation.value?.stage === 'planning') return '开始生成图片';
  if (generation.value?.stage === 'done' || generation.value?.done) return '重新生成';
  return '立即生成';
});
const isDetailFlow = computed(() => ['detail-page', 'detail-clone'].includes(generation.value?.flow));
const detailActionDisabled = computed(
  () => isDetailFlow.value && generation.value?.stage === 'generating',
);
const detailFlowTitle = computed(() => (generation.value?.flow === 'detail-clone' ? '竞品复刻' : '详情页生成'));
const detailDesignTitle = computed(() => (generation.value?.flow === 'detail-clone' ? '竞品复刻设计' : '详情页设计'));
const isCloneFlow = computed(() => generation.value?.flow === 'detail-clone');
const competitorReferenceImages = computed(() => {
  const images = generation.value?.competitorImages;
  if (Array.isArray(images)) return normalizeImageUrls(images);
  return activeDetailPlan.value.map((item) => item.imageUrls?.[1]).filter(Boolean);
});
const productReferenceImages = computed(() => {
  const competitorUrls = new Set(competitorReferenceImages.value);
  return normalizeImageUrls(generation.value?.images || []).filter((url) => !competitorUrls.has(url));
});
const generatedPreviewUrls = computed(() => {
  const generated = (generation.value?.detailResults || []).filter(Boolean);
  if (generated.length) return generated.slice(0, 3);
  return competitorReferenceImages.value.slice(0, 3);
});
const activeTaskPlan = computed(() => {
  const index = Math.max(0, (generation.value?.detailResults || []).findIndex((url) => !url));
  return activeDetailPlan.value[index >= 0 ? index : 0] || activeDetailPlan.value[0] || {};
});
const activeTaskPrompt = computed(() => {
  const promptText = activeTaskPlan.value?.prompts?.modelInput || activeTaskPlan.value?.prompts?.positive || generation.value?.prompt || '';
  return String(promptText).replace(/\s+/g, ' ').trim();
});
const completedDetailCount = computed(() => (generation.value?.detailResults || []).filter(Boolean).length);

function handleDetailConfigAction() {
  if (!generation.value || detailActionDisabled.value) return;
  if (!userStore.requireLogin()) return;

  if (generation.value.stage === 'planning' || generation.value.stage === 'done' || generation.value.done) {
    startDetailImages();
  }
}

function truncateText(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function clearGenerationTimer() {
  if (generationTimer) {
    window.clearInterval(generationTimer);
    generationTimer = null;
  }
}

function parseGenerationCount(value, fallback = 1) {
  const match = String(value || '').match(/\d+/);
  const count = match ? Number.parseInt(match[0], 10) : fallback;
  return Math.max(1, Math.min(4, Number.isFinite(count) ? count : fallback));
}

function normalizeGenerationSize(value) {
  const text = String(value || '').trim();
  return text.includes(':') ? text : '9:16';
}

function normalizeImageUrls(images = []) {
  return images.map((image) => (typeof image === 'string' ? image : image?.url)).filter(Boolean);
}

function isTaskDone(status) {
  return ['completed', 'succeeded', 'success', 'done'].includes(String(status || '').toLowerCase());
}

function isTaskFailed(status) {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(String(status || '').toLowerCase());
}

function taskProgress(status, current, providerProgress) {
  if (isTaskDone(status)) return 100;
  if (Number.isFinite(providerProgress)) return Math.max(current || 0, Math.min(99, providerProgress));
  const next = (current || 6) + ((current || 0) < 50 ? 9 : 5);
  return Math.min(95, next);
}

async function readApiResponse(response) {
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `接口请求失败：${response.status}`);
  }
  return result.data;
}

async function submitImageTask(payload, promptOverride, countOverride = null, imageUrlsOverride = null) {
  const body = {
    prompt: promptOverride || payload.prompt,
    model: payload.model || DEFAULT_IMAGE_MODEL,
    size: normalizeGenerationSize(payload.ratio),
    resolution: payload.quality || '2K',
    n: countOverride ?? parseGenerationCount(payload.count),
    image_urls: imageUrlsOverride ? normalizeImageUrls(imageUrlsOverride) : normalizeImageUrls(payload.images),
  };

  const data = await readApiResponse(
    await fetch('/api/image-tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify(body),
    }),
  );
  const taskId = data?.tasks?.[0]?.taskId || data?.tasks?.[0]?.task_id;
  if (!taskId) {
    throw new Error('生图任务提交成功，但没有返回 task_id');
  }
  return { ...data, taskId };
}

async function fetchImageTask(taskId) {
  return readApiResponse(await fetch(`/api/image-tasks/${encodeURIComponent(taskId)}`));
}

function failGeneration(error) {
  if (!generation.value) return;
  generation.value.stage = 'failed';
  generation.value.done = false;
  generation.value.statusText = error instanceof Error ? error.message : String(error || '生图失败');
  generation.value.errorMessage = generation.value.statusText;
  clearGenerationTimer();
}

function startGeneration(payload) {
  if (!userStore.requireLogin()) return;
  clearGenerationTimer();
  const basePrompt = payload.prompt?.trim() || '把图中床垫放到温馨的卧室场景下';
  generation.value = {
    ...payload,
    prompt: basePrompt,
    stage: ['detail-page', 'detail-clone'].includes(payload.flow) ? 'planning' : 'generating',
    progress: 6,
    statusText: '正在加载超导级创作资源池...',
    done: false,
    resultUrl: '',
    errorMessage: '',
  };

  if (payload.flow === 'detail-clone') {
    startDetailImages();
    return;
  }

  if (payload.flow === 'detail-page') {
    return;
  }

  runMainImageTask(payload);
}

async function runMainImageTask(payload) {
  try {
    const task = await submitImageTask({ ...payload, prompt: generation.value.prompt });
    if (!generation.value) return;
    generation.value.taskId = task.taskId;
    generation.value.statusText = '任务已提交，正在等待生图结果...';

    let polls = 0;
    let polling = false;
    generationTimer = window.setInterval(async () => {
      if (!generation.value || polling) return;
      polling = true;
      try {
        const status = await fetchImageTask(task.taskId);
        if (!generation.value) return;
        generation.value.progress = taskProgress(status.status, generation.value.progress, status.progress);
        if (status.status && !isTaskDone(status.status)) {
          generation.value.statusText = `任务状态：${status.status}`;
        }

        if (isTaskFailed(status.status)) {
          failGeneration(status.error || 'APIMart 生图任务失败');
          return;
        }

        if (isTaskDone(status.status)) {
          const url = status.imageUrls?.[0];
          if (!url) {
            failGeneration('任务完成，但没有返回图片地址');
            return;
          }
          generation.value.done = true;
          generation.value.stage = 'done';
          generation.value.progress = 100;
          generation.value.resultUrl = url;
          generation.value.statusText = '生成完成';
          clearGenerationTimer();
          return;
        }

        polls += 1;
        if (polls >= TASK_MAX_POLLS) {
          failGeneration('轮询超时，任务仍未完成');
        }
      } catch (error) {
        failGeneration(error);
      } finally {
        polling = false;
      }
    }, TASK_POLL_INTERVAL);
  } catch (error) {
    failGeneration(error);
  }
}

async function startDetailImages() {
  if (!generation.value) return;
  if (!userStore.requireLogin()) return;
  clearGenerationTimer();
  generation.value.stage = 'generating';
  generation.value.progress = 11;
  generation.value.statusText = '正在加载超导级创作资源池...';
  generation.value.errorMessage = '';
  generation.value.detailResults = Array.from({ length: activeDetailPlan.value.length }, () => '');

  try {
    const plans = activeDetailPlan.value;
    const submissions = await Promise.all(
      plans.map((plan) =>
        submitImageTask(
          generation.value,
          plan.prompts?.modelInput || plan.prompts?.positive || `${generation.value.prompt}，生成第${plan.index}屏电商详情页`,
          1,
          plan.imageUrls,
        ),
      ),
    );
    generation.value.detailTaskIds = submissions.map((item) => item.taskId);
    generation.value.statusText = '分屏任务已提交，正在等待生图结果...';

    let polls = 0;
    let polling = false;
    generationTimer = window.setInterval(async () => {
      if (!generation.value || polling) return;
      polling = true;
      try {
        const statuses = await Promise.all(generation.value.detailTaskIds.map((taskId) => fetchImageTask(taskId)));
        if (!generation.value) return;

        const completed = statuses.filter((status) => isTaskDone(status.status)).length;
        const failed = statuses.find((status) => isTaskFailed(status.status));
        generation.value.progress = Math.max(
          generation.value.progress,
          Math.min(99, Math.round((completed / statuses.length) * 100) || generation.value.progress + 4),
        );

        statuses.forEach((status, index) => {
          const url = status.imageUrls?.[0];
          if (url) generation.value.detailResults[index] = url;
        });

        if (failed) {
          failGeneration(failed.error || 'APIMart 分屏生图任务失败');
          return;
        }

        if (completed === statuses.length && statuses.length > 0) {
          generation.value.done = true;
          generation.value.stage = 'done';
          generation.value.progress = 100;
          generation.value.resultUrl = generation.value.detailResults.find(Boolean) || '';
          generation.value.statusText = '生成完成';
          clearGenerationTimer();
          return;
        }

        polls += 1;
        if (polls >= TASK_MAX_POLLS) {
          failGeneration('轮询超时，分屏任务仍未完成');
        }
      } catch (error) {
        failGeneration(error);
      } finally {
        polling = false;
      }
    }, TASK_POLL_INTERVAL);
  } catch (error) {
    failGeneration(error);
  }
}

function handleShortcut(item) {
  if (item?.icon === 'reverse-prompt') {
    reversePromptOpen.value = true;
    return;
  }
  if (item?.icon === 'copy') {
    composerRef.value?.openCloneModalFromShortcut?.();
  }
}

async function loadReversePromptCategories() {
  try {
    const data = await readApiResponse(await fetch('/api/prompt/categories'));
    if (Array.isArray(data) && data.length) reversePromptCategories.value = data;
  } catch (error) {
    reversePromptError.value = error instanceof Error ? error.message : String(error || '反推品类加载失败');
  }
}

async function analyzeReversePrompt(payload) {
  reversePromptPending.value = true;
  reversePromptError.value = '';
  try {
    const data = await readApiResponse(
      await fetch('/api/prompt/analyze-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...userStore.authHeaders(),
        },
        body: JSON.stringify(payload),
      }),
    );
    reversePromptResult.value = {
      ...data,
      imageUrl: payload.imageUrl || payload.imageBase64 || '',
      source: 'system',
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    reversePromptError.value = error instanceof Error ? error.message : String(error || '图片反推失败');
  } finally {
    reversePromptPending.value = false;
  }
}

function handleReversePromptBridgeMessage(event) {
  const message = event?.data;
  if (!message || message.type !== 'youmi:reverse-prompt-result') return;
  const payload = message.payload || {};
  reversePromptResult.value = {
    ...payload,
    source: payload.source || 'bridge',
    category: payload.category || 'general',
    categoryLabel: payload.categoryLabel || '通用',
    promptJson: payload.promptJson || {},
    promptText: payload.promptText || '',
    createdAt: payload.createdAt || new Date().toISOString(),
  };
  sessionStorage.setItem('youmi:reverse-prompt-result', JSON.stringify(reversePromptResult.value));
  router.push('/reverse-prompt');
  reversePromptError.value = '';
}

async function copyReversePrompt(payload) {
  await navigator.clipboard?.writeText(payload.promptText || JSON.stringify(payload.promptJson || {}, null, 2));
}

function applyReversePrompt(payload) {
  const text = payload.promptText || JSON.stringify(payload.promptJson || {}, null, 2);
  prompt.value = text;
  if (generation.value) {
    generation.value.prompt = text;
  }
}

onMounted(() => {
  loadReversePromptCategories();
  window.addEventListener('message', handleReversePromptBridgeMessage);

  // 登录后从服务器同步画布数据
  const canvasStore = useCanvasStore();
  if (userStore.isAuthenticated && !canvasStore.serverSynced) {
    canvasStore.syncFromServer();
  }

  // 监听登录状态：登录成功后立即从服务器拉取数据
  watch(() => userStore.isAuthenticated, (authed) => {
    if (authed && !canvasStore.serverSynced) {
      canvasStore.syncFromServer();
    }
  });

  // 点击外部关闭用户菜单
  const onClickOutside = (e) => {
    if (userMenuOpen.value && !e.target.closest('.yh-user-dropdown')) {
      userMenuOpen.value = false;
    }
  };
  document.addEventListener('click', onClickOutside);
  onBeforeUnmount(() => document.removeEventListener('click', onClickOutside));
});

onBeforeUnmount(() => {
  clearGenerationTimer();
  window.removeEventListener('message', handleReversePromptBridgeMessage);
});
</script>

<template>
  <main :class="['youmi-home', { 'is-expanded': railExpanded, 'is-workspace': generation }]">
    <HomeSidebar
      :expanded="railExpanded"
      :logged-in="loggedIn"
      :user="userStore.profile"
      @toggle="railExpanded = !railExpanded"
      @login="userStore.openLogin()"
    />

    <div class="yh-auth-actions">
      <template v-if="loggedIn">
        <div class="yh-user-dropdown" :class="{ open: userMenuOpen }">
          <button type="button" class="yh-user-avatar" @click="userMenuOpen = !userMenuOpen" @blur="onUserMenuBlur">
            {{ userStore.profile?.account?.charAt(0)?.toUpperCase() || userStore.profile?.nickname?.charAt(0)?.toUpperCase() || 'U' }}
          </button>
          <div class="yh-user-menu" v-show="userMenuOpen">
            <div class="yh-user-menu-header">
              <div class="yh-user-menu-avatar">{{ userStore.profile?.account?.charAt(0)?.toUpperCase() || 'U' }}</div>
              <div>
                <div class="yh-user-menu-name">{{ userStore.profile?.account || userStore.profile?.nickname || '用户' }}</div>
                <div class="yh-user-menu-uid">ID: {{ userStore.profile?.id || '--' }}</div>
              </div>
              <span class="yh-user-menu-vip">免费</span>
            </div>
            <div class="yh-user-menu-balance">
              <span class="yh-balance-label">算力余额</span>
              <span class="yh-balance-value">0</span>
            </div>
            <div class="yh-user-menu-divider"></div>
            <button type="button" class="yh-user-menu-item" @click="userMenuOpen = false">
              <i class="ri-user-line"></i>个人资料
            </button>
            <button type="button" class="yh-user-menu-item" @click="userMenuOpen = false">
              <i class="ri-lock-line"></i>修改密码
            </button>
            <button type="button" class="yh-user-menu-item" @click="userMenuOpen = false">
              <i class="ri-message-3-line"></i>问题反馈
            </button>
            <button type="button" class="yh-user-menu-item" @click="userMenuOpen = false">
              <i class="ri-customer-service-line"></i>联系客服
            </button>
            <button type="button" class="yh-user-menu-item" @click="userMenuOpen = false">
              <i class="ri-share-forward-line"></i>代理推广
            </button>
            <div class="yh-user-menu-divider"></div>
            <button type="button" class="yh-user-menu-item" @click="toggleTheme">
              <i class="ri-sun-line"></i>{{ themeLabel }}
            </button>
            <div class="yh-user-menu-divider"></div>
            <button type="button" class="yh-user-menu-item yh-user-menu-logout" @click="handleLogout">
              <i class="ri-logout-box-r-line"></i>退出登录
            </button>
          </div>
        </div>
      </template>
      <template v-else>
        <button type="button" @click="userStore.openLogin()">注册</button>
        <button type="button" @click="userStore.openLogin()">登录</button>
      </template>
    </div>

    <section v-if="!generation" class="yh-main">
      <section class="yh-hero-area">
        <header class="yh-hero-title">
          <h1>有米AI</h1>
          <div class="yh-slogan">
            <span></span>
            <p>电商AI， <strong>就用有米</strong></p>
            <span></span>
          </div>
        </header>

        <HomeComposer ref="composerRef" v-model="prompt" @generate="startGeneration" />
        <HomeShortcuts @select="handleShortcut" />
      </section>

      <CaseGallery />
    </section>

    <section v-else :class="['yh-generation-page', { 'has-detail-config': isDetailFlow }]">
      <aside v-if="isDetailFlow" class="yh-detail-config">
        <header class="yh-detail-config-head">
          <div>
            <h2>{{ detailFlowTitle }}</h2>
            <button type="button">▶ 教程视频⌄</button>
          </div>
          <button class="yh-config-close" type="button" @click="generation = null">×</button>
        </header>

        <div v-if="!isCloneFlow" class="yh-config-mode">
          <button type="button" class="active">分屏生成</button>
          <button type="button">整版长图 <span>0.8折</span></button>
        </div>

        <label v-if="!isCloneFlow" class="yh-config-switch">
          <strong>简约高端</strong>
          <span>已关闭</span>
          <i></i>
          <button type="button">?</button>
        </label>

        <div class="yh-config-scroll">
          <section v-if="isCloneFlow" class="yh-config-block">
            <h3>竞品图片 <button type="button">?</button></h3>
            <p class="yh-config-help">请上传其他产品/爆款参考/竞品的参考图，勿与「产品图片」重复上传同一件货。</p>
            <div class="yh-config-thumb-row">
              <figure v-for="(url, index) in competitorReferenceImages.slice(0, 2)" :key="`competitor-${url}`">
                <img :src="url" :alt="`竞品参考图 ${index + 1}`" />
              </figure>
              <button type="button" class="yh-config-add-thumb">☁<span>点击/拖拽上传图片</span></button>
            </div>
          </section>

          <section class="yh-config-block yh-config-resolution">
            <h3>产品图片 <button type="button">?</button></h3>
            <div v-if="isCloneFlow" class="yh-config-thumb-row">
              <figure v-for="(url, index) in productReferenceImages.slice(0, 2)" :key="`product-${url}`">
                <img :src="url" :alt="`产品图 ${index + 1}`" />
              </figure>
              <button type="button" class="yh-config-add-thumb">☁<span>点击/拖拽上传图片</span></button>
            </div>
            <div v-else class="yh-config-upload">
              <img v-if="generation.images?.[0]?.url" :src="generation.images[0].url" alt="产品参考图" />
              <i v-else class="yh-config-upload-icon" aria-hidden="true">☁</i>
              <span class="yh-config-upload-copy">点击上传<small>或拖拽上传</small></span>
              <em>从生成历史导入</em>
            </div>
          </section>

          <section class="yh-config-block">
            <h3>产品信息</h3>
            <div class="yh-config-info-field">
              <textarea :value="generation.prompt" readonly></textarea>
              <button class="yh-config-optimize" type="button" @click="reversePromptOpen = true">反推提示词</button>
            </div>
          </section>

          <section v-if="!isCloneFlow" class="yh-config-block">
            <h3>模型选择</h3>
            <div class="yh-config-segment">
              <button type="button">由前 3.0</button>
              <button type="button" class="active">由前 img2</button>
            </div>
          </section>

          <section class="yh-config-block">
            <h3>分辨率</h3>
            <div class="yh-config-segment">
              <button type="button" :class="{ active: generation.quality === '1K' }">1K</button>
              <button type="button" :class="{ active: (generation.quality || '2K') === '2K' }">2K</button>
              <button type="button" :class="{ active: generation.quality === '4K' }">4K</button>
            </div>
          </section>

          <section v-if="!isCloneFlow" class="yh-config-block yh-config-grid">
            <label>
              <span>平台</span>
              <button type="button">{{ generation.platform || '淘宝' }}⌄</button>
            </label>
            <label>
              <span>语言</span>
              <button type="button">中文（简体）⌄</button>
            </label>
            <label>
              <span>比例</span>
              <button type="button">{{ generation.ratio || '9:16' }}⌄</button>
            </label>
            <label>
              <span>数量</span>
              <button type="button">{{ activeDetailPlan.length }} 张⌄</button>
            </label>
          </section>

          <section v-if="isCloneFlow" class="yh-config-block">
            <label class="yh-config-switch compact">
              <strong>模特保持一致 <em>(可选)</em></strong>
              <span>{{ generation.keepModel ? '开启' : '关闭' }}</span>
              <i></i>
            </label>
            <p class="yh-config-help">仅当竞品图中含有模特时本设置才会生效；竞品图中无模特则忽略本设置。</p>
          </section>

          <button v-if="!isCloneFlow" class="yh-config-advanced" type="button">高级设定 已跳过策略 · 模特图 · 风格参考 · 分屏构思 <span>点击展开</span></button>
        </div>

        <div class="yh-config-submit">
          <button type="button" :disabled="detailActionDisabled" @click="handleDetailConfigAction">
            {{ detailActionLabel }}
          </button>
          <p><span>限时优惠</span> 预计消耗 {{ detailCost }} 米值 <s>{{ detailCost * 4 }}</s></p>
        </div>
      </aside>

      <header class="yh-workspace-top">
        <button class="yh-workspace-switch" type="button">首页生成 <span>⌄</span></button>
        <div class="yh-workspace-filters">
          <button type="button">⌕</button>
          <button type="button">最近一周⌄</button>
          <button type="button">全部类型⌄</button>
        </div>
      </header>

      <section class="yh-generation-thread">
        <div v-if="isDetailFlow && generation.stage === 'planning'" class="yh-detail-stepper">
          <span><i></i>策略<small>已跳过</small></span>
          <span class="done"><i>✓</i>策划<small>已完成</small></span>
          <span :class="{ active: generation.stage === 'generating', done: generation.done }">
            <i>{{ activeDetailPlan.length }}</i>生图<small>{{ generation.done ? '已完成' : generation.stage === 'generating' ? '生成中' : '待生成' }}</small>
          </span>
        </div>

        <div class="yh-thread-head">
          <span class="yh-thread-pill">◔ 对话生图</span>
          <span v-if="!generation.done" :class="['yh-progress-pill', { failed: generation.stage === 'failed' }]">
            {{ generation.stage === 'failed' ? '生成失败' : `生成中 ${generation.progress}%` }}
          </span>
          <span v-else class="yh-count-pill">{{ isDetailFlow ? activeDetailPlan.length : 1 }} 张</span>
        </div>

        <div class="yh-thread-meta">
          <img
            :src="referenceImageUrl"
            alt="参考图"
          />
          <span>{{ generation.ratio }} | img2 | {{ generation.quality }} | "{{ generation.prompt }}"</span>
        </div>

        <section v-if="isDetailFlow && generation.stage === 'planning'" class="yh-detail-plan">
          <header>
            <h2>{{ detailFlowTitle }}策划 <small>共 {{ activeDetailPlan.length }} 屏</small></h2>
            <div>
              <button type="button">⟳ 重新策划整套</button>
              <button type="button">▣ 多选屏重策</button>
              <button type="button" disabled>重新生成选中屏</button>
              <button type="button" class="primary" @click="startDetailImages">开始生成图片</button>
            </div>
          </header>
          <p class="yh-plan-tip">ⓘ 点击卡片内容即可直接编辑。重新策划整套会保留历史版本，可用版本序号切换；也可多选若干屏仅重策该部分。</p>
          <div class="yh-plan-topic">
            <span>整套策略</span>
            <strong>{{ generation.style || '围绕产品信息、参考图和目标平台，保持统一视觉语言与转化节奏' }}</strong>
          </div>
          <article v-for="item in activeDetailPlan" :key="item.id || item.index" class="yh-plan-card">
            <header>
              <strong>{{ item.index }}</strong>
              <h3>{{ item.title }}</h3>
              <button type="button">⟳ 重新生成</button>
            </header>
            <div class="yh-plan-row"><span>主题</span><p>{{ item.title }}</p></div>
            <div class="yh-plan-row"><span>设计思路</span><p>{{ item.goal }}</p></div>
            <div class="yh-plan-row"><span>视觉画面</span><p>{{ item.visual }}</p></div>
            <div class="yh-plan-row"><span>文案内容</span><p>{{ item.copy }}</p></div>
            <div class="yh-plan-row"><span>生图提示词</span><p>{{ item.prompts?.modelInput || item.prompts?.positive || '根据本屏规划生成完整 9:16 电商详情页单屏。' }}</p></div>
          </article>
          <button class="yh-add-screen" type="button">＋ 添加一屏</button>
          <div class="yh-plan-bottom">
            <button type="button">⟳ 重新策划整套</button>
            <button type="button" class="primary" @click="startDetailImages">开始生成图片</button>
          </div>
        </section>

        <section v-else-if="isDetailFlow" class="yh-detail-workbench">
          <div v-if="generatedPreviewUrls.length" class="yh-detail-preview-strip">
            <figure
              v-for="(url, index) in generatedPreviewUrls"
              :key="`preview-${url}`"
              :class="{ active: index === Math.min(completedDetailCount, generatedPreviewUrls.length - 1) }"
            >
              <img :src="url" :alt="`详情页预览 ${index + 1}`" />
              <span v-if="index === 0">详情页设计{{ activeTaskPlan.index || 1 }}⌄</span>
              <i v-if="index === Math.min(completedDetailCount, generatedPreviewUrls.length - 1)">⌃</i>
            </figure>
          </div>

          <div class="yh-detail-toolbar">
            <button type="button">▣ 万能画布</button>
            <button type="button">▤ 长图预览</button>
            <button type="button">✎ 重新编辑</button>
            <button type="button" @click="startDetailImages">⟳ 重新生成</button>
            <button type="button">↓ 下载全部⌄</button>
          </div>

          <article class="yh-detail-task-message">
            <header>
              <div>
                <span class="yh-thread-pill">▣ {{ detailFlowTitle }}</span>
                <span v-if="!generation.done" :class="['yh-progress-pill', { failed: generation.stage === 'failed' }]">
                  {{ generation.stage === 'failed' ? '生成失败' : `生成中 ${generation.progress}%` }}
                </span>
                <span v-else class="yh-count-pill">{{ activeDetailPlan.length }} 张</span>
              </div>
              <time>{{ nowLabel }}</time>
            </header>
            <div class="yh-detail-task-meta">
              <img :src="referenceImageUrl" alt="产品参考图" />
              <p>"{{ truncateText(activeTaskPrompt, 220) }}"</p>
              <button type="button">⌄</button>
            </div>
          </article>

          <div class="yh-detail-stage">
            <article
              v-for="(item, index) in activeDetailPlan"
              :key="item.id || item.index"
              class="yh-detail-stage-card"
              :class="{ hidden: index !== Math.max(0, (generation.detailResults || []).findIndex((url) => !url)) && !generation.done }"
            >
              <img
                v-if="generation.detailResults?.[index]"
                :src="generation.detailResults[index]"
                :alt="`详情页图片 ${index + 1}`"
              />
              <div v-else class="yh-detail-rendering-card" :style="{ '--progress': `${generation.progress}%` }">
                <strong>YOUMI</strong>
                <span>{{ generation.stage === 'failed' ? '生成失败' : `${generation.progress}%` }}</span>
                <p>{{ generation.stage === 'failed' ? generation.statusText : '正在渲染细分纹理与光追效果...' }}</p>
              </div>
            </article>
            <div v-if="!generation.done" class="yh-detail-screen-count">⌄ <span>{{ completedDetailCount }}/{{ activeDetailPlan.length }}</span></div>
          </div>
        </section>

        <article v-else-if="!generation.done" class="yh-generation-card">
          <div class="yh-card-progress" :style="{ width: `${generation.progress}%` }"></div>
          <div class="yh-generating-center">
            <div class="yh-generating-logo">YOUMI</div>
            <strong>{{ generation.progress }}%</strong>
            <p>{{ generation.statusText }}</p>
          </div>
        </article>

        <template v-else>
          <img class="yh-result-image" :src="generation.resultUrl" alt="生成图片" />
          <div class="yh-result-actions">
            <button type="button">↓ 下载全部</button>
            <button type="button">压缩全部</button>
            <button type="button">✎ 重新编辑</button>
            <button type="button">⟳ 重新生成</button>
            <button type="button">▱ 删除列表</button>
          </div>
        </template>
      </section>

      <aside class="yh-generation-time">
        <span>{{ nowLabel }}</span>
        <button type="button">▢</button>
      </aside>

      <div class="yh-floating-composer">
        <HomeComposer v-model="prompt" @generate="startGeneration" />
      </div>
    </section>

    <button class="yh-help-float" type="button">?</button>
    <ReversePromptPanel
      :visible="reversePromptOpen"
      :categories="reversePromptCategories"
      :result="reversePromptResult"
      :pending="reversePromptPending"
      :error="reversePromptError"
      @close="reversePromptOpen = false"
      @analyze="analyzeReversePrompt"
      @copy="copyReversePrompt"
      @apply="applyReversePrompt"
    />
  </main>
</template>

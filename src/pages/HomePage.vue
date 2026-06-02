<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import CaseGallery from '../components/home/CaseGallery.vue';
import HomeComposer from '../components/home/HomeComposer.vue';
import HomeShortcuts from '../components/home/HomeShortcuts.vue';
import HomeSidebar from '../components/home/HomeSidebar.vue';
import { useUserStore } from '../stores/user';

const railExpanded = ref(false);
const prompt = ref('');
const generation = ref(null);
const composerRef = ref(null);
const userStore = useUserStore();
const loggedIn = computed(() => userStore.isAuthenticated);
let generationTimer = null;
const TASK_POLL_INTERVAL = 2500;
const TASK_MAX_POLLS = 120;

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

function handleDetailConfigAction() {
  if (!generation.value || detailActionDisabled.value) return;
  if (!userStore.requireLogin()) return;

  if (generation.value.stage === 'planning' || generation.value.stage === 'done' || generation.value.done) {
    startDetailImages();
  }
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
    model: payload.model || 'banana2',
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

  if (['detail-page', 'detail-clone'].includes(payload.flow)) {
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
  if (item?.icon === 'copy') {
    composerRef.value?.openCloneModalFromShortcut?.();
  }
}

onBeforeUnmount(clearGenerationTimer);
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

    <div v-if="!generation && !loggedIn" class="yh-auth-actions">
      <button type="button" @click="userStore.openLogin()">注册</button>
      <button type="button" @click="userStore.openLogin()">登录</button>
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

        <div class="yh-config-mode">
          <button type="button" class="active">分屏生成</button>
          <button type="button">整版长图 <span>0.8折</span></button>
        </div>

        <label class="yh-config-switch">
          <strong>简约高端</strong>
          <span>已关闭</span>
          <i></i>
          <button type="button">?</button>
        </label>

        <div class="yh-config-scroll">
          <section class="yh-config-block">
            <h3>产品图片 <button type="button">?</button></h3>
            <div class="yh-config-upload">
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
              <button class="yh-config-optimize" type="button">优化产品信息</button>
            </div>
          </section>

          <section class="yh-config-block">
            <h3>模型选择</h3>
            <div class="yh-config-segment">
              <button type="button">由前 3.0</button>
              <button type="button" class="active">由前 img2</button>
            </div>
          </section>

          <section class="yh-config-block">
            <h3>分辨率</h3>
            <div class="yh-config-segment">
              <button type="button" :class="{ active: (generation.quality || '2K') === '2K' }">2K</button>
              <button type="button" :class="{ active: generation.quality === '4K' }">4K</button>
            </div>
          </section>

          <section class="yh-config-block yh-config-grid">
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

          <button class="yh-config-advanced" type="button">高级设定 已跳过策略 · 模特图 · 风格参考 · 分屏构思 <span>点击展开</span></button>
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
        <div v-if="isDetailFlow" class="yh-detail-stepper">
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

        <section v-else-if="isDetailFlow && !generation.done" class="yh-detail-generating">
          <h2>{{ detailDesignTitle }} <span>生成中 {{ generation.progress }}%</span></h2>
          <p><img :src="referenceImageUrl" alt="" /> {{ generation.platform || '淘宝' }} | 9:16 | {{ generation.model || 'banana2' }} | {{ activeDetailPlan.length }}张 | "{{ generation.prompt }}"</p>
          <div class="yh-detail-progress-grid">
            <article v-for="item in activeDetailPlan" :key="item.id || item.index" class="yh-generation-card">
              <div class="yh-card-progress" :style="{ width: `${generation.progress}%` }"></div>
              <div class="yh-generating-center">
                <div class="yh-generating-logo">YOUMI</div>
                <strong>{{ generation.progress }}%</strong>
                <p>{{ item.title }}｜{{ generation.statusText }}</p>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="isDetailFlow" class="yh-detail-results">
          <h2>{{ detailDesignTitle }}</h2>
          <p><img :src="referenceImageUrl" alt="" /> {{ generation.platform || '淘宝' }} | 9:16 | {{ generation.model || 'banana2' }} | {{ activeDetailPlan.length }}张 | "{{ generation.prompt }}"</p>
          <div class="yh-detail-result-grid">
            <img
              v-for="(url, index) in generation.detailResults"
              :key="url"
              :src="url"
              :alt="`详情页图片 ${index + 1}`"
            />
          </div>
          <div class="yh-result-actions">
            <button type="button">▣ 万能画布</button>
            <button type="button">▤ 长图预览</button>
            <button type="button">✎ 重新编辑</button>
            <button type="button">⟳ 重新生成</button>
            <button type="button">↓ 下载全部⌄</button>
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
  </main>
</template>

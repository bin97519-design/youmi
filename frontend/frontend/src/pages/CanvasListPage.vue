<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useCanvasStore } from '../stores/canvas';
import { useUserStore } from '../stores/user';

const router = useRouter();
const canvas = useCanvasStore();
const userStore = useUserStore();
const sortOpen = ref(false);
const sortBy = ref('按修改时间');
const query = ref('');

const sortOptions = ['按修改时间', '按创建时间', '按最近打开', '按标题'];

const documents = computed(() => {
  const list = canvas.documents.filter((doc) => doc.title.includes(query.value));
  if (sortBy.value === '按标题') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  if (sortBy.value === '按创建时间') return [...list].sort((a, b) => b.createdAt - a.createdAt);
  if (sortBy.value === '按最近打开') return [...list].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
});

function createDocument() {
  if (!userStore.requireLogin()) return;
  const doc = canvas.createDocument();
  router.push(`/canvas/${doc.id}`);
}

function openDocument(id) {
  if (!userStore.requireLogin()) return;
  canvas.markOpened(id);
  router.push(`/canvas/${id}`);
}

function removeDocument(id) {
  if (!userStore.requireLogin()) return;
  canvas.removeDocumentAsync(id);
}
</script>

<template>
  <main class="canvas-list">
    <header class="list-head">
      <button class="ghost" @click="router.push('/')">← 返回首页</button>
      <div>
        <h1>我的画布</h1>
        <p><span>▣ {{ canvas.documents.length }} 个画布</span><span>☁ 云端自动保存</span></p>
      </div>
      <section>
        <button class="ghost" @click="userStore.requireLogin()">⇧ 导入文件</button>
        <button class="primary" @click="createDocument">＋ 新建空白画布</button>
      </section>
    </header>

    <div class="list-toolbar">
      <label class="search-box">⌕ <input v-model="query" placeholder="搜索画布标题..." /></label>
      <div class="select-box">
        <button @click="sortOpen = !sortOpen">◷ {{ sortBy }}⌄</button>
        <div v-if="sortOpen" class="select-menu">
          <button v-for="option in sortOptions" :key="option" :class="{ active: option === sortBy }" @click="sortBy = option; sortOpen = false">
            {{ option }} <span v-if="option === sortBy">✓</span>
          </button>
        </div>
      </div>
      <div class="segmented"><button class="active">活跃</button><button>回收站</button></div>
    </div>

    <section class="canvas-cards">
      <article v-for="doc in documents" :key="doc.id" class="canvas-card" @dblclick="openDocument(doc.id)">
        <button class="thumb" @click="openDocument(doc.id)">
          <img v-if="doc.thumbnailUrl" :src="doc.thumbnailUrl" alt="" />
          <span v-else>▧</span>
          <b v-if="doc.meta?.editing">✎ 编辑中</b>
        </button>
        <footer>
          <strong>{{ doc.title }}</strong>
          <p>
            <span>{{ doc.meta?.layerCount || doc.payload.layers.length }} 图层 · {{ doc.meta?.age || '刚刚' }}</span>
            <button type="button" @click.stop>⋮</button>
            <button type="button" @click.stop="removeDocument(doc.id)">⌫</button>
          </p>
        </footer>
      </article>
    </section>
  </main>
</template>

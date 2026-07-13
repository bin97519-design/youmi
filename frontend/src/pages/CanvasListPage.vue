<script setup>
import { ref, computed, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useCanvasStore } from '../stores/canvas';
import { useUserStore } from '../stores/user';

const router = useRouter();
const canvas = useCanvasStore();
const userStore = useUserStore();
const sortOpen = ref(false);
const sortBy = ref('按修改时间');
const query = ref('');
const editingTitleId = ref(null);
const editingTitleText = ref('');

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

function startEditTitle(doc, event) {
  if (event) event.stopPropagation();
  editingTitleId.value = doc.id;
  editingTitleText.value = doc.title;
  nextTick(() => {
    const card = document.querySelector(`.canvas-card:has(.card-title-input)`);
    const input = card?.querySelector('.card-title-input');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function saveTitle(doc) {
  const trimmed = editingTitleText.value.trim();
  if (trimmed && trimmed !== doc.title) {
    doc.title = trimmed;
    doc.updatedAt = Date.now();
    // 即时落库：跳过 500ms 防抖，编辑完立即把 title 写进后端 ym_canvas_document.title
    canvas.syncTitleNow(doc);
  }
  editingTitleId.value = null;
}

function cancelEditTitle() {
  editingTitleId.value = null;
}

function onTitleKeydown(event, doc) {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveTitle(doc);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    cancelEditTitle();
  }
}

// 列表加载时从服务端回填（刷新后从 DB 读回最新 title）
onMounted(() => {
  canvas.syncFromServer();
});
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
          <template v-if="editingTitleId === doc.id">
            <input
              ref="titleInput"
              v-model="editingTitleText"
              class="card-title-input"
              @blur="saveTitle(doc)"
              @keydown="onTitleKeydown($event, doc)"
              @click.stop
            />
          </template>
          <strong v-else @click="startEditTitle(doc, $event)" class="card-title-editable">{{ doc.title }}</strong>
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

<style scoped>
.card-title-editable {
  display: block;
  cursor: text;
  font-size: 15px;
  font-weight: 700;
  color: var(--canvas-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 4px;
  transition: background-color 0.15s;
}
.card-title-editable:hover {
  background-color: var(--canvas-surface-hover);
}

.card-title-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  margin: -2px -4px;
  border: 1px solid var(--canvas-accent);
  border-radius: 4px;
  background: var(--canvas-input);
  color: var(--canvas-text);
  font-size: 15px;
  font-weight: 700;
  outline: none;
}
</style>

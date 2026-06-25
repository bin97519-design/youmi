<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useUserStore } from '../stores/user';
import { apiPath } from '../utils/apiBase';

const userStore = useUserStore();
const activeTab = ref('accounts');
const loading = ref(false);
const saving = ref(false);
const errorText = ref('');
const users = ref([]);
const roles = ref([]);
const stats = ref(null);

const tabs = [
  { key: 'accounts', label: '账号管理' },
  { key: 'roles', label: '角色管理' },
  { key: 'stats', label: '生图统计' },
];

const userForm = reactive({
  account: '',
  phone: '',
  nickname: '',
  password: '123456',
  status: 'ACTIVE',
  miValue: 100,
  planName: '普通用户',
  roles: ['USER'],
});

const roleForm = reactive({
  code: '',
  name: '',
  permissionsText: 'image:generate',
});

const roleOptions = computed(() => roles.value.map((role) => role.code));
const summary = computed(() => stats.value?.summary || {});

async function api(path, options = {}) {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...userStore.authHeaders(),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0) {
    const message = payload?.message || `请求失败：${response.status}`;
    if (response.status === 401) userStore.openLogin();
    throw new Error(message);
  }
  return payload.data;
}

async function loadConsole() {
  if (!userStore.requireLogin()) return;
  loading.value = true;
  errorText.value = '';
  try {
    const [userRows, roleRows, imageStats] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/roles'),
      api('/api/admin/image-stats'),
    ]);
    roles.value = roleRows.map(normalizeRole);
    users.value = userRows.map(normalizeUser);
    stats.value = imageStats;
  } catch (error) {
    errorText.value = error.message || '控制台数据加载失败';
  } finally {
    loading.value = false;
  }
}

async function createUser() {
  saving.value = true;
  errorText.value = '';
  try {
    const created = await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(userForm),
    });
    users.value = [normalizeUser(created), ...users.value];
    resetUserForm();
  } catch (error) {
    errorText.value = error.message || '用户创建失败';
  } finally {
    saving.value = false;
  }
}

async function saveUser(user) {
  saving.value = true;
  errorText.value = '';
  try {
    const updated = await api(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        phone: user.phone,
        nickname: user.nickname,
        password: user.passwordDraft || '',
        status: user.status,
        miValue: Number(user.miValue || 0),
        planName: user.planName,
        roles: [user.roleDraft || 'USER'],
      }),
    });
    users.value = users.value.map((item) => (item.id === updated.id ? normalizeUser(updated) : item));
  } catch (error) {
    errorText.value = error.message || '用户保存失败';
  } finally {
    saving.value = false;
  }
}

async function createRole() {
  saving.value = true;
  errorText.value = '';
  try {
    const created = await api('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify({
        code: roleForm.code,
        name: roleForm.name,
        permissions: splitPermissions(roleForm.permissionsText),
      }),
    });
    roles.value = [...roles.value, normalizeRole(created)];
    resetRoleForm();
  } catch (error) {
    errorText.value = error.message || '角色创建失败';
  } finally {
    saving.value = false;
  }
}

async function saveRole(role) {
  saving.value = true;
  errorText.value = '';
  try {
    const updated = await api(`/api/admin/roles/${role.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: role.name,
        permissions: splitPermissions(role.permissionsDraft),
      }),
    });
    roles.value = roles.value.map((item) => (item.id === updated.id ? normalizeRole(updated) : item));
  } catch (error) {
    errorText.value = error.message || '角色保存失败';
  } finally {
    saving.value = false;
  }
}

function normalizeUser(user) {
  return {
    ...user,
    phone: user.phone || '',
    nickname: user.nickname || '',
    planName: user.planName || '普通用户',
    roleDraft: user.roles?.[0] || 'USER',
    passwordDraft: '',
  };
}

function normalizeRole(role) {
  return {
    ...role,
    permissionsDraft: (role.permissions || []).join(', '),
  };
}

function splitPermissions(value) {
  return String(value || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resetUserForm() {
  Object.assign(userForm, {
    account: '',
    phone: '',
    nickname: '',
    password: '123456',
    status: 'ACTIVE',
    miValue: 100,
    planName: '普通用户',
    roles: ['USER'],
  });
}

function resetRoleForm() {
  Object.assign(roleForm, {
    code: '',
    name: '',
    permissionsText: 'image:generate',
  });
}

function formatTime(value) {
  if (!value) return '-';
  return String(value).replace('T', ' ').slice(0, 16);
}

function shortPrompt(value) {
  const text = String(value || '');
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

onMounted(loadConsole);
</script>

<template>
  <main class="console-page">
    <header class="console-head">
      <RouterLink to="/" class="console-back">← 返回首页</RouterLink>
      <div>
        <h1>控制台</h1>
        <p>账号、角色、生图用量和费用统一管理。</p>
      </div>
      <button class="console-refresh" type="button" :disabled="loading" @click="loadConsole">
        {{ loading ? '刷新中...' : '刷新数据' }}
      </button>
    </header>

    <section class="console-tabs" aria-label="控制台菜单">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </section>

    <p v-if="errorText" class="console-error">{{ errorText }}</p>

    <section class="console-metrics">
      <article>
        <span>账号数</span>
        <strong>{{ users.length }}</strong>
        <small>当前系统用户</small>
      </article>
      <article>
        <span>角色数</span>
        <strong>{{ roles.length }}</strong>
        <small>含管理员与业务角色</small>
      </article>
      <article>
        <span>生图任务</span>
        <strong>{{ summary.totalTasks || 0 }}</strong>
        <small>完成 {{ summary.completedTasks || 0 }} 个</small>
      </article>
      <article>
        <span>米值消耗</span>
        <strong>{{ summary.totalMiCost || 0 }}</strong>
        <small>生成 {{ summary.totalImages || 0 }} 张图</small>
      </article>
    </section>

    <section v-if="activeTab === 'accounts'" class="console-grid">
      <form class="console-card console-form" @submit.prevent="createUser">
        <h2>新增账号</h2>
        <label><span>账号</span><input v-model.trim="userForm.account" placeholder="例如 operator01" required /></label>
        <label><span>手机号</span><input v-model.trim="userForm.phone" placeholder="可选" /></label>
        <label><span>昵称</span><input v-model.trim="userForm.nickname" placeholder="显示名称" /></label>
        <label><span>初始密码</span><input v-model="userForm.password" placeholder="默认 123456" required /></label>
        <div class="console-form-row">
          <label><span>状态</span><select v-model="userForm.status"><option>ACTIVE</option><option>DISABLED</option></select></label>
          <label><span>米值</span><input v-model.number="userForm.miValue" type="number" min="0" /></label>
        </div>
        <div class="console-form-row">
          <label><span>会员</span><input v-model.trim="userForm.planName" /></label>
          <label><span>角色</span><select v-model="userForm.roles[0]"><option v-for="role in roleOptions" :key="role">{{ role }}</option></select></label>
        </div>
        <button class="console-primary" type="submit" :disabled="saving">创建账号</button>
      </form>

      <section class="console-card console-table-card">
        <h2>账号列表</h2>
        <div class="console-table users-table">
          <div class="console-row console-row-head">
            <span>账号</span><span>昵称</span><span>角色</span><span>米值</span><span>状态</span><span>操作</span>
          </div>
          <div v-for="user in users" :key="user.id" class="console-row">
            <span><strong>{{ user.account }}</strong><small>ID {{ user.id }}</small></span>
            <input v-model.trim="user.nickname" />
            <select v-model="user.roleDraft"><option v-for="role in roleOptions" :key="role">{{ role }}</option></select>
            <input v-model.number="user.miValue" type="number" min="0" />
            <select v-model="user.status"><option>ACTIVE</option><option>DISABLED</option></select>
            <button type="button" @click="saveUser(user)">保存</button>
          </div>
        </div>
      </section>
    </section>

    <section v-else-if="activeTab === 'roles'" class="console-grid">
      <form class="console-card console-form" @submit.prevent="createRole">
        <h2>新增角色</h2>
        <label><span>角色编码</span><input v-model.trim="roleForm.code" placeholder="如 OPERATOR" required /></label>
        <label><span>角色名称</span><input v-model.trim="roleForm.name" placeholder="如 运营" required /></label>
        <label><span>权限码</span><textarea v-model="roleForm.permissionsText" rows="5" placeholder="多个权限用逗号或换行分隔"></textarea></label>
        <button class="console-primary" type="submit" :disabled="saving">创建角色</button>
      </form>

      <section class="console-card console-table-card">
        <h2>角色列表</h2>
        <div class="console-table roles-table">
          <div class="console-row console-row-head">
            <span>编码</span><span>名称</span><span>权限</span><span>用户</span><span>操作</span>
          </div>
          <div v-for="role in roles" :key="role.id" class="console-row">
            <span><strong>{{ role.code }}</strong><small>{{ formatTime(role.createdAt) }}</small></span>
            <input v-model.trim="role.name" />
            <textarea v-model="role.permissionsDraft" rows="2"></textarea>
            <span>{{ role.userCount || 0 }}</span>
            <button type="button" @click="saveRole(role)">保存</button>
          </div>
        </div>
      </section>
    </section>

    <section v-else class="console-stats">
      <section class="console-card">
        <h2>模型用量</h2>
        <div class="console-models">
          <article v-for="model in stats?.models || []" :key="model.model">
            <span>{{ model.model }}</span>
            <strong>{{ model.tasks }} 任务</strong>
            <small>{{ model.images }} 张｜{{ model.miCost }} 米值</small>
          </article>
          <p v-if="!stats?.models?.length" class="console-empty">暂无模型统计。</p>
        </div>
      </section>

      <section class="console-card">
        <h2>近 14 天趋势</h2>
        <div class="console-days">
          <article v-for="day in stats?.daily || []" :key="day.day">
            <span>{{ day.day?.slice(5) }}</span>
            <strong :style="{ height: `${Math.max(8, Math.min(96, day.tasks * 12))}px` }"></strong>
            <small>{{ day.tasks }}</small>
          </article>
          <p v-if="!stats?.daily?.length" class="console-empty">暂无趋势数据。</p>
        </div>
      </section>

      <section class="console-card console-table-card">
        <h2>最近生图任务</h2>
        <div class="console-table tasks-table">
          <div class="console-row console-row-head">
            <span>任务</span><span>用户</span><span>模型</span><span>状态</span><span>图片</span><span>时间</span>
          </div>
          <div v-for="task in stats?.tasks || []" :key="task.taskId" class="console-row">
            <span><strong>{{ task.taskId }}</strong><small>{{ shortPrompt(task.prompt) }}</small></span>
            <span>{{ task.userName || task.userId || '匿名' }}</span>
            <span>{{ task.requestedModel || task.model }}</span>
            <span :class="['status-pill', task.status]">{{ task.status }}</span>
            <span>{{ task.imageCount }} 张 / {{ task.miCost }} 米值</span>
            <span>{{ formatTime(task.createdAt) }}</span>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>

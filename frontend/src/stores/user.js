import { defineStore } from 'pinia';
import { apiPath } from '../utils/apiBase';

const TOKEN_KEY = 'youmi_token';
const PROFILE_KEY = 'youmi_profile';

async function requestApi(path, options = {}) {
  const response = await fetch(apiPath(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.code) {
    throw new Error(payload.message || '请求失败');
  }

  return payload.data || {};
}

export const useUserStore = defineStore('user', {
  state: () => ({
    isAuthenticated: false,
    token: '',
    profile: null,
    loginModalOpen: false,
  }),

  actions: {
    openLogin() {
      this.loginModalOpen = true;
    },

    closeLogin() {
      this.loginModalOpen = false;
    },

    requireLogin() {
      if (!this.isAuthenticated) this.restoreSession();
      if (this.isAuthenticated) return true;
      this.openLogin();
      return false;
    },

    authHeaders() {
      if (!this.isAuthenticated) this.restoreSession();
      return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    },

    restoreSession() {
      const token = window.localStorage.getItem(TOKEN_KEY);
      const rawProfile = window.localStorage.getItem(PROFILE_KEY);

      if (!token || !rawProfile) return;

      try {
        this.token = token;
        this.profile = JSON.parse(rawProfile);
        this.isAuthenticated = true;
      } catch {
        this.clearSession();
      }
    },

    saveSession(token, profile) {
      this.token = token;
      this.profile = profile;
      this.isAuthenticated = true;
      this.loginModalOpen = false;
      window.localStorage.setItem(TOKEN_KEY, token);
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    },

    clearSession() {
      this.token = '';
      this.profile = null;
      this.isAuthenticated = false;
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(PROFILE_KEY);
    },

    async login({ account, password }) {
      const data = await requestApi('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      this.saveSession(data.token, data.user);
      return data.user;
    },

    async fetchCurrentUser() {
      if (!this.token) return null;
      try {
        const res = await fetch(apiPath('/api/auth/me'), {
          headers: { Authorization: `Bearer ${this.token}` },
        });
        // 仅明确鉴权失败（token 真的失效）才清除会话；
        // 否则网络抖动 / 后端 5xx / 后端重启瞬间等瞬时错误会误把用户踢出登录，
        // 连带画布 storage key 带 userId 后缀切换导致画布"消失"。
        if (res.status === 401 || res.status === 403) {
          this.clearSession();
          return null;
        }
        // 其余情况（网络/5xx/其他 4xx）一律保留 token，避免被瞬时错误强制登出
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        if (data.code && data.code !== 0) return null; // 业务错误不踢，静默
        this.saveSession(this.token, data.user || data);
        return data.user || data;
      } catch {
        // 网络异常（fetch 抛错）：保留 token，下次再验证
        return null;
      }
    },

    /** 公开接口：拉取 ACTIVE 店铺列表（id/name/code），供注册页下拉 */
    async fetchShops() {
      return requestApi('/api/shops');
    },

    /** 注册并自动登录：shopId 由后台管理员后续分配，注册时无需关联 */
    async register({ account, password }) {
      const data = await requestApi('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      this.saveSession(data.token, data.user);
      return data.user;
    },

    async logout() {
      if (this.token) {
        await requestApi('/api/auth/logout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        }).catch(() => {});
      }
      this.clearSession();
    },
  },
});

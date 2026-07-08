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
        const data = await requestApi('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${this.token}`,
          },
        });
        this.saveSession(this.token, data.user);
        return data.user;
      } catch {
        this.clearSession();
        return null;
      }
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

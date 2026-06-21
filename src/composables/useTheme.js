// ============================================================
// useTheme · 主题切换 composable
// 三态：dark / light / system（跟随操作系统）
// ============================================================

import { ref, watch, onMounted } from 'vue';

const STORAGE_KEY = 'youmi-theme';
const ORDER = ['dark', 'light', 'system'];

const theme = ref('dark');
const systemTheme = ref('dark');

function applyTheme(value) {
  const effective = value === 'system' ? systemTheme.value : value;
  // 兼容 HomePage 旧的 .dark class 切换
  if (effective === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // 新的 data-theme 切换（token 系统）
  document.documentElement.setAttribute('data-theme', effective);
  theme.value = value;
  try { localStorage.setItem(STORAGE_KEY, value); } catch {}
}

function detectSystemTheme() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 初始化内联脚本（在 main.js 顶部直接调用，避免首屏闪烁）
export function initTheme() {
  if (typeof window === 'undefined') return;
  const saved = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
  const initial = saved || 'dark';
  systemTheme.value = detectSystemTheme();
  applyTheme(initial);
}

export function useTheme() {
  // 在 setup 阶段立即读取并应用，避免 onMounted 之前主题不一致
  initTheme();

  onMounted(() => {
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        systemTheme.value = mq.matches ? 'dark' : 'light';
        if (theme.value === 'system') applyTheme('system');
      };
      mq.addEventListener('change', handler);
    }
  });

  function cycle() {
    const idx = ORDER.indexOf(theme.value);
    const next = ORDER[(idx + 1) % ORDER.length];
    applyTheme(next);
  }

  function set(value) {
    if (ORDER.includes(value)) applyTheme(value);
  }

  const isDark = () => {
    const effective = theme.value === 'system' ? systemTheme.value : theme.value;
    return effective === 'dark';
  };

  const isLight = () => !isDark();
  const isSystem = () => theme.value === 'system';

  return { theme, cycle, set, isDark, isLight, isSystem, order: ORDER };
}

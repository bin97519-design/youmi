// ============================================================
// useTheme · 主题切换 composable
// 双态：dark / light
// ============================================================

import { ref } from 'vue';

const STORAGE_KEY = 'youmi-theme';
const ORDER = ['dark', 'light'];

const theme = ref('dark');

function applyTheme(value) {
  const effective = ORDER.includes(value) ? value : 'dark';
  // 兼容 HomePage 旧的 .dark class 切换
  if (effective === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // 新的 data-theme 切换（token 系统）
  document.documentElement.setAttribute('data-theme', effective);
  theme.value = effective;
  try { localStorage.setItem(STORAGE_KEY, effective); } catch { /* Storage can be unavailable in privacy mode. */ }
}

// 初始化内联脚本（在 main.js 顶部直接调用，避免首屏闪烁）
export function initTheme() {
  if (typeof window === 'undefined') return;
  const saved = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
  const initial = ORDER.includes(saved) ? saved : 'dark';
  applyTheme(initial);
}

export function useTheme() {
  // 在 setup 阶段立即读取并应用，避免挂载之前主题不一致
  initTheme();

  function cycle() {
    const idx = ORDER.indexOf(theme.value);
    const next = ORDER[(idx + 1) % ORDER.length];
    applyTheme(next);
  }

  function set(value) {
    if (ORDER.includes(value)) applyTheme(value);
  }

  const isDark = () => theme.value === 'dark';

  return { theme, cycle, set, isDark, order: ORDER };
}

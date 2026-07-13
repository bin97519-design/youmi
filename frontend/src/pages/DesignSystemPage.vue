<template>
  <main class="ds-page">
    <header class="ds-header glass-header">
      <div class="ds-header__brand">
        <span class="ds-header__logo">YOUMI</span>
        <span class="ds-header__sep">·</span>
        <strong>设计系统 Demo</strong>
      </div>
      <button class="theme-toggle" :title="`当前：${themeLabel()}（点击切换）`" @click="cycleTheme">
        <span class="theme-toggle__icon">{{ themeIcon() }}</span>
        <span>{{ themeLabel() }}</span>
      </button>
    </header>

    <!-- 主题证明条：左/中/右对比，一眼看出主题切换是否生效 -->
    <section class="ds-proof" :data-theme-name="themeName()">
      <div class="ds-proof__left">
        <strong>硬编码深色</strong>
        <code>#080f20 / 文字 #edf4ff</code>
      </div>
      <div class="ds-proof__current">
        <strong>当前主题色（应该跟着变）</strong>
        <div class="ds-proof__pills">
          <span class="ds-proof__pill">BG: <code>{{ theme.value }}</code></span>
          <span class="ds-proof__pill">.dark class: <code>{{ hasDarkClass() ? '是' : '否' }}</code></span>
          <span class="ds-proof__pill">data-theme: <code>{{ getDataTheme() }}</code></span>
        </div>
        <small>如果你点了右上角主题按钮，看到 BG / class / data-theme 三个值在变 → 主题切换生效</small>
      </div>
      <div class="ds-proof__right">
        <strong>硬编码浅色</strong>
        <code>#f6f8fc / 文字 #0a0f1f</code>
      </div>
    </section>

    <section class="ds-section">
      <h2>🎨 颜色 Token</h2>
      <div class="ds-grid ds-grid--colors">
        <div v-for="(c, name) in colorTokens" :key="name" class="ds-swatch">
          <div class="ds-swatch__chip" :style="{ background: c.value }"></div>
          <code>{{ name }}</code>
          <small>{{ c.value }}</small>
        </div>
      </div>
    </section>

    <section class="ds-section">
      <h2>🟡 按钮组件（5 变体 × 3 尺寸）</h2>
      <div class="ds-row">
        <div class="ds-col">
          <h4>Primary</h4>
          <button class="btn btn--primary btn--sm">小尺寸</button>
          <button class="btn btn--primary btn--md">中尺寸</button>
          <button class="btn btn--primary btn--lg">大尺寸</button>
        </div>
        <div class="ds-col">
          <h4>Brand（金）</h4>
          <button class="btn btn--brand btn--sm">小尺寸</button>
          <button class="btn btn--brand btn--md">中尺寸</button>
          <button class="btn btn--brand btn--lg">大尺寸</button>
        </div>
        <div class="ds-col">
          <h4>Secondary</h4>
          <button class="btn btn--secondary btn--sm">小</button>
          <button class="btn btn--secondary btn--md">中</button>
          <button class="btn btn--secondary btn--lg">大</button>
        </div>
        <div class="ds-col">
          <h4>Ghost</h4>
          <button class="btn btn--ghost btn--sm">小</button>
          <button class="btn btn--ghost btn--md">中</button>
          <button class="btn btn--ghost btn--lg">大</button>
        </div>
        <div class="ds-col">
          <h4>Danger</h4>
          <button class="btn btn--danger btn--sm">小</button>
          <button class="btn btn--danger btn--md">中</button>
          <button class="btn btn--danger btn--lg">大</button>
        </div>
      </div>
      <div class="ds-row">
        <button class="btn btn--primary btn--md" disabled>禁用态</button>
        <button class="btn btn--primary btn--md">正常态</button>
      </div>
    </section>

    <section class="ds-section">
      <h2>📥 输入框</h2>
      <div class="ds-stack">
        <div class="ds-input-wrap">
          <label>基础输入框</label>
          <input type="text" class="form-input" placeholder="请输入..." value="已选中的元素" />
        </div>
        <div class="ds-input-wrap">
          <label>聚焦态（点击）</label>
          <input type="text" class="form-input" placeholder="点击看聚焦效果" />
        </div>
        <div class="ds-input-wrap">
          <label>多行文本</label>
          <textarea class="form-input form-input--textarea" rows="3" placeholder="多行文本..."></textarea>
        </div>
      </div>
    </section>

    <section class="ds-section">
      <h2>🏷 Badge / 状态标签</h2>
      <div class="ds-row">
        <span class="badge badge--success">成功 ✓</span>
        <span class="badge badge--warning">警告 !</span>
        <span class="badge badge--error">错误 ✕</span>
        <span class="badge badge--info">信息</span>
        <span class="badge badge--accent">强调</span>
      </div>
    </section>

    <section class="ds-section">
      <h2>📦 卡片</h2>
      <div class="ds-grid ds-grid--cards">
        <article class="card card--case">
          <div class="card--case__thumb" style="background: linear-gradient(135deg, #8a5cff, #f2c900)"></div>
          <div class="card--case__body">
            <strong>案例标题 1</strong>
            <small>Hover 时图片轻微缩放</small>
          </div>
        </article>
        <article class="card card--case">
          <div class="card--case__thumb" style="background: linear-gradient(135deg, #f2c900, #8a5cff)"></div>
          <div class="card--case__body">
            <strong>案例标题 2</strong>
            <small>卡片整体浮起 + 阴影加深</small>
          </div>
        </article>
        <article class="card card--case">
          <div class="card--case__thumb" style="background: linear-gradient(135deg, #6a36ec, #b794ff)"></div>
          <div class="card--case__body">
            <strong>案例标题 3</strong>
            <small>效果流畅过渡</small>
          </div>
        </article>
      </div>
    </section>

    <section class="ds-section">
      <h2>📊 进度条</h2>
      <div class="progress">
        <div class="progress__fill" style="width: 75%"></div>
        <span class="progress__label">75%</span>
      </div>
    </section>

    <section class="ds-section">
      <h2>⚡ 元素检测三态（修过的撞色）</h2>
      <div class="ds-row">
        <div class="detected-element-box detected-element-box--demo">默认态</div>
        <div class="detected-element-box detected-element-box--demo detected-element-box--hover">Hover</div>
        <div class="detected-element-box detected-element-box--demo detected-element-box--selected">选中态（金）</div>
      </div>
    </section>

    <section class="ds-section">
      <h2>🏷 Annotation Banner（标注模式提示）</h2>
      <aside class="annotate-banner">
        <div class="annotate-banner-text">
          <i class="ri-mark-pen-line"></i>
          <span>拖拽画框 → 手动添加元素到输入框</span>
        </div>
        <button type="button" class="annotate-banner-close">退出标记</button>
      </aside>
    </section>

    <footer class="ds-footer">
      <a href="/" class="btn btn--ghost btn--md">← 返回首页</a>
    </footer>
  </main>
</template>

<script setup>
import { useTheme } from '../composables/useTheme';
const { theme, cycle: cycleTheme, isDark } = useTheme();

function themeIcon() {
  return theme.value === 'dark' ? '🌙' : '☀️';
}
function themeLabel() {
  return theme.value === 'dark' ? '深色' : '浅色';
}
function themeName() { return themeLabel(); }
function hasDarkClass() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}
function getDataTheme() {
  if (typeof document === 'undefined') return '(no document)';
  return document.documentElement.getAttribute('data-theme') || '(未设置)';
}

// 抽样展示 token
const colorTokens = {
  '--color-bg-0': { value: 'var(--color-bg-0)' },
  '--color-bg-1': { value: 'var(--color-bg-1)' },
  '--color-bg-2': { value: 'var(--color-bg-2)' },
  '--color-bg-3': { value: 'var(--color-bg-3)' },
  '--color-brand-500': { value: 'var(--color-brand-500)' },
  '--color-accent-500': { value: 'var(--color-accent-500)' },
  '--color-text-1': { value: 'var(--color-text-1)' },
  '--color-text-2': { value: 'var(--color-text-2)' },
};
</script>

<style scoped>
.ds-page {
  min-height: 100vh;
  padding: var(--space-8);
  background: var(--color-bg-0);
  color: var(--color-text-1);
  transition: background var(--duration-base) var(--ease-out-expo);
}

.ds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-6);
  margin: calc(-1 * var(--space-8)) calc(-1 * var(--space-8)) var(--space-8);
}

.ds-header__brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-lg);
}
.ds-header__logo {
  font-weight: var(--weight-heavy);
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-size-xl);
}
.ds-header__sep { color: var(--color-text-3); }

.ds-section {
  margin-bottom: var(--space-12);
  padding: var(--space-6);
  background: var(--color-bg-1);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
}
.ds-section h2 {
  margin: 0 0 var(--space-6);
  font-size: var(--font-size-xl);
  color: var(--color-brand-500);
}
.ds-section h4 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ds-grid { display: grid; gap: var(--space-4); }
.ds-grid--colors { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.ds-grid--cards { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }

.ds-swatch {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--color-bg-2);
  border-radius: var(--radius-md);
}
.ds-swatch__chip {
  width: 100%;
  height: 56px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}
.ds-swatch code { font-size: var(--font-size-xs); color: var(--color-accent-300); }
.ds-swatch small { color: var(--color-text-3); font-family: var(--font-family-mono); }

.ds-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.ds-row:last-child { margin-bottom: 0; }
.ds-col { display: flex; flex-direction: column; gap: var(--space-2); }

.ds-stack { display: flex; flex-direction: column; gap: var(--space-4); }
.ds-input-wrap { display: flex; flex-direction: column; gap: var(--space-2); }
.ds-input-wrap label {
  font-size: var(--font-size-sm);
  color: var(--color-text-2);
  font-weight: var(--weight-medium);
}

.form-input--textarea {
  resize: vertical;
  min-height: 80px;
  font-family: inherit;
}

.detected-element-box--demo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 180px;
  height: 100px;
  color: #fff;
  font-weight: var(--weight-semibold);
  border-radius: var(--radius-md);
  pointer-events: auto;
}
.detected-element-box--demo.detected-element-box--hover {
  background: var(--color-accent-300);
  border-color: var(--color-accent-300);
}
.detected-element-box--demo.detected-element-box--selected {
  background: var(--color-brand-500);
  color: #0a0f1f;
  border-color: var(--color-brand-500);
}

.ds-footer {
  display: flex;
  justify-content: center;
  padding-top: var(--space-8);
}

/* 主题证明条：左硬编码深色 / 中跟随 token / 右硬编码浅色 */
.ds-proof {
  display: grid;
  grid-template-columns: 1fr 2fr 1fr;
  gap: var(--space-3);
  margin-bottom: var(--space-8);
  border-radius: var(--radius-xl);
  overflow: hidden;
  border: 2px solid var(--color-accent-500);
}
.ds-proof__left,
.ds-proof__right {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-6);
  text-align: center;
  font-size: var(--font-size-sm);
}
.ds-proof__left {
  /* 永远深色，不管主题怎么切 */
  background: #080f20 !important;
  color: #edf4ff !important;
  border: 0 !important;
}
.ds-proof__right {
  /* 永远浅色，不管主题怎么切 */
  background: #f6f8fc !important;
  color: #0a0f1f !important;
  border: 0 !important;
}
.ds-proof__left code,
.ds-proof__right code {
  font-size: var(--font-size-xs);
  opacity: 0.8;
}
.ds-proof__current {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-6);
  background: var(--color-bg-1);
  color: var(--color-text-1);
  transition: background var(--duration-base) var(--ease-out-expo);
}
.ds-proof__current small {
  color: var(--color-text-2);
  font-size: var(--font-size-xs);
  line-height: 1.6;
}
.ds-proof__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.ds-proof__pill {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-bg-2);
  color: var(--color-text-1);
  font-size: var(--font-size-sm);
  border: 1px solid var(--color-border);
}
.ds-proof__pill code {
  font-family: var(--font-family-mono);
  color: var(--color-accent-500);
  font-weight: var(--weight-bold);
  margin-left: var(--space-1);
}
</style>

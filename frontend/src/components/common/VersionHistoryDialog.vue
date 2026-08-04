<script setup>
import { nextTick, onBeforeUnmount, watch } from 'vue'
import { versionHistory } from '../../data/versionHistory'
import { resolveVersionHistoryImageUrl } from '../../utils/versionHistoryImages'

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  currentVersion: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['close'])
let previousBodyOverflow = ''

function closeDialog() {
  emit('close')
}

function versionImageUrl(filename) {
  return resolveVersionHistoryImageUrl(filename)
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.open) closeDialog()
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      await nextTick()
      document.querySelector('.version-history-close')?.focus()
    } else {
      document.body.style.overflow = previousBodyOverflow
    }
  },
  { immediate: true },
)

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
  if (typeof document !== 'undefined') {
    document.body.style.overflow = previousBodyOverflow
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="version-history-fade">
      <div
        v-if="open"
        class="version-history-backdrop"
        role="presentation"
        @mousedown.self="closeDialog"
      >
        <section
          class="version-history-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-history-title"
        >
          <header class="version-history-head">
            <div>
              <span class="version-history-kicker">YOUMI RELEASES</span>
              <h2 id="version-history-title">更新历程</h2>
              <p>每一次更新，都在让创作更快、更稳、更顺手。</p>
            </div>
            <div class="version-history-head-actions">
              <span class="version-history-current">当前 v{{ currentVersion }}</span>
              <button
                class="version-history-close"
                type="button"
                title="关闭"
                aria-label="关闭更新历程"
                @click="closeDialog"
              >
                <i class="ri-close-line" aria-hidden="true"></i>
              </button>
            </div>
          </header>

          <div class="version-history-scroll">
            <div class="version-history-timeline">
              <template v-for="(release, index) in versionHistory" :key="release.version">
                <div class="version-history-date">
                  <span>{{ release.date }}</span>
                  <i aria-hidden="true"></i>
                </div>

                <article v-if="index === 0" class="version-history-release is-latest">
                  <div class="version-history-release-head">
                    <span class="version-history-tag">v{{ release.version }}</span>
                    <span class="version-history-latest-label">最新版本</span>
                  </div>
                  <h3>{{ release.title }}</h3>
                  <p class="version-history-summary">{{ release.summary }}</p>
                  <div v-if="release.visuals?.length" class="version-history-visuals">
                    <figure
                      v-for="visual in release.visuals"
                      :key="visual.src"
                      :class="{ 'is-wide': visual.wide }"
                    >
                      <div class="version-history-visual-media">
                        <img :src="versionImageUrl(visual.src)" :alt="visual.alt" loading="lazy" />
                      </div>
                      <figcaption>
                        <strong>{{ visual.title }}</strong>
                        <span>{{ visual.description }}</span>
                      </figcaption>
                    </figure>
                  </div>
                  <div class="version-history-sections">
                    <section v-for="section in release.sections" :key="section.title">
                      <h4>{{ section.title }}</h4>
                      <ul>
                        <li v-for="item in section.items" :key="item">{{ item }}</li>
                      </ul>
                    </section>
                  </div>
                </article>

                <details v-else class="version-history-release">
                  <summary>
                    <span class="version-history-tag">v{{ release.version }}</span>
                    <span class="version-history-release-title">
                      <strong>{{ release.title }}</strong>
                      <small>{{ release.summary }}</small>
                    </span>
                    <span class="version-history-more">
                      查看详情
                      <i class="ri-arrow-down-s-line" aria-hidden="true"></i>
                    </span>
                  </summary>
                  <div v-if="release.visuals?.length" class="version-history-visuals">
                    <figure
                      v-for="visual in release.visuals"
                      :key="visual.src"
                      :class="{ 'is-wide': visual.wide }"
                    >
                      <div class="version-history-visual-media">
                        <img :src="versionImageUrl(visual.src)" :alt="visual.alt" loading="lazy" />
                      </div>
                      <figcaption>
                        <strong>{{ visual.title }}</strong>
                        <span>{{ visual.description }}</span>
                      </figcaption>
                    </figure>
                  </div>
                  <div class="version-history-sections">
                    <section v-for="section in release.sections" :key="section.title">
                      <h4>{{ section.title }}</h4>
                      <ul>
                        <li v-for="item in section.items" :key="item">{{ item }}</li>
                      </ul>
                    </section>
                  </div>
                </details>
              </template>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
.version-history-backdrop {
  --vh-panel: #202126;
  --vh-panel-strong: #18191d;
  --vh-text: #f2f4f7;
  --vh-muted: #a2a8b3;
  --vh-line: rgba(255, 255, 255, 0.12);
  --vh-soft: rgba(255, 255, 255, 0.055);
  --vh-accent: #35d6dd;
  --vh-accent-soft: rgba(53, 214, 221, 0.13);
  position: fixed;
  inset: 0;
  z-index: 12050;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(5, 6, 8, 0.7);
  backdrop-filter: blur(8px);
}

[data-theme='light'] .version-history-backdrop {
  --vh-panel: #ffffff;
  --vh-panel-strong: #f5f7fa;
  --vh-text: #18202a;
  --vh-muted: #657080;
  --vh-line: rgba(24, 32, 42, 0.13);
  --vh-soft: rgba(24, 32, 42, 0.045);
  --vh-accent: #087f88;
  --vh-accent-soft: rgba(8, 127, 136, 0.1);
  background: rgba(24, 32, 42, 0.32);
}

.version-history-dialog {
  width: min(960px, calc(100vw - 32px));
  max-height: min(84vh, 860px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  color: var(--vh-text);
  background: var(--vh-panel);
  border: 1px solid var(--vh-line);
  border-radius: 8px;
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.34);
}

.version-history-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 28px 20px;
  background: var(--vh-panel);
  border-bottom: 1px solid var(--vh-line);
}

.version-history-kicker {
  color: var(--vh-accent);
  font-size: 11px;
  font-weight: 800;
}

.version-history-head h2 {
  margin: 5px 0 4px;
  font-size: 26px;
  line-height: 1.2;
  letter-spacing: 0;
}

.version-history-head p {
  margin: 0;
  color: var(--vh-muted);
  font-size: 13px;
}

.version-history-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.version-history-current {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--vh-muted);
  background: var(--vh-soft);
  border: 1px solid var(--vh-line);
  border-radius: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.version-history-close {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--vh-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}

.version-history-close:hover {
  color: var(--vh-text);
  background: var(--vh-soft);
  border-color: var(--vh-line);
}

.version-history-close i {
  font-size: 20px;
}

.version-history-scroll {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.version-history-timeline {
  display: grid;
  grid-template-columns: 142px minmax(0, 1fr);
  padding: 8px 28px 30px;
}

.version-history-date {
  position: relative;
  min-height: 100%;
  padding: 30px 30px 0 0;
  color: var(--vh-muted);
  border-right: 1px solid var(--vh-line);
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.version-history-date i {
  position: absolute;
  top: 34px;
  right: -5px;
  width: 9px;
  height: 9px;
  background: var(--vh-panel);
  border: 2px solid var(--vh-accent);
  border-radius: 50%;
}

.version-history-release {
  min-width: 0;
  margin-left: 32px;
  padding: 28px 0;
  border-bottom: 1px solid var(--vh-line);
}

.version-history-release:last-child {
  border-bottom: 0;
}

.version-history-release-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.version-history-tag {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  color: var(--vh-accent);
  background: var(--vh-accent-soft);
  border: 1px solid color-mix(in srgb, var(--vh-accent) 46%, transparent);
  border-radius: 5px;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.version-history-latest-label {
  color: var(--vh-muted);
  font-size: 11px;
}

.version-history-release h3 {
  margin: 12px 0 6px;
  color: var(--vh-text);
  font-size: 20px;
  line-height: 1.35;
  letter-spacing: 0;
}

.version-history-summary {
  margin: 0;
  color: var(--vh-muted);
  font-size: 13px;
  line-height: 1.7;
}

.version-history-visuals {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}

.version-history-visuals figure {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  background: var(--vh-soft);
  border: 1px solid var(--vh-line);
  border-radius: 6px;
}

.version-history-visuals figure.is-wide {
  grid-column: 1 / -1;
}

.version-history-visual-media {
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--vh-panel-strong);
  border-bottom: 1px solid var(--vh-line);
}

.version-history-visual-media img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center top;
}

.version-history-visuals figcaption {
  display: grid;
  gap: 4px;
  padding: 10px 11px 11px;
}

.version-history-visuals figcaption strong {
  color: var(--vh-text);
  font-size: 13px;
  line-height: 1.45;
}

.version-history-visuals figcaption span {
  color: var(--vh-muted);
  font-size: 11px;
  line-height: 1.55;
}

.version-history-sections {
  display: grid;
  gap: 18px;
  margin-top: 22px;
}

.version-history-sections section {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 18px;
}

.version-history-sections h4 {
  margin: 1px 0 0;
  color: var(--vh-text);
  font-size: 13px;
  line-height: 1.7;
  letter-spacing: 0;
}

.version-history-sections ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.version-history-sections li {
  position: relative;
  padding-left: 14px;
  color: var(--vh-muted);
  font-size: 13px;
  line-height: 1.7;
}

.version-history-sections li::before {
  position: absolute;
  top: 0.72em;
  left: 0;
  width: 4px;
  height: 4px;
  content: '';
  background: var(--vh-accent);
  border-radius: 50%;
}

.version-history-release summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  list-style: none;
}

.version-history-release summary::-webkit-details-marker {
  display: none;
}

.version-history-release-title {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.version-history-release-title strong {
  color: var(--vh-text);
  font-size: 15px;
}

.version-history-release-title small {
  overflow: hidden;
  color: var(--vh-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-history-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--vh-muted);
  font-size: 12px;
}

.version-history-release[open] .version-history-more i {
  transform: rotate(180deg);
}

.version-history-fade-enter-active,
.version-history-fade-leave-active {
  transition: opacity 160ms ease;
}

.version-history-fade-enter-active .version-history-dialog,
.version-history-fade-leave-active .version-history-dialog {
  transition:
    transform 160ms ease,
    opacity 160ms ease;
}

.version-history-fade-enter-from,
.version-history-fade-leave-to {
  opacity: 0;
}

.version-history-fade-enter-from .version-history-dialog,
.version-history-fade-leave-to .version-history-dialog {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 720px) {
  .version-history-backdrop {
    padding: 0;
  }

  .version-history-dialog {
    width: 100vw;
    max-height: none;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }

  .version-history-head {
    padding: 18px 16px 15px;
  }

  .version-history-head h2 {
    font-size: 22px;
  }

  .version-history-current {
    display: none;
  }

  .version-history-timeline {
    grid-template-columns: 1fr;
    padding: 4px 16px 28px;
  }

  .version-history-date {
    min-height: 0;
    padding: 22px 0 0 18px;
    border-right: 0;
    text-align: left;
  }

  .version-history-date i {
    top: 26px;
    right: auto;
    left: 0;
  }

  .version-history-release {
    margin-left: 0;
    padding: 14px 0 24px;
  }

  .version-history-visuals {
    grid-template-columns: 1fr;
  }

  .version-history-visuals figure.is-wide {
    grid-column: auto;
  }

  .version-history-sections section {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .version-history-release summary {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .version-history-more {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

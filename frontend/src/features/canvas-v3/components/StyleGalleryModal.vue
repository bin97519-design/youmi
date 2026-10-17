<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CanvasIcon from './CanvasIcon.vue'
import {
  filterStyleGallery,
  STYLE_CATEGORIES,
  STYLE_GALLERY_ITEMS,
  STYLE_GALLERY_TABS,
  STYLE_MODELS,
} from '../config/styleGallery'

const props = defineProps({
  open: { type: Boolean, default: false },
  currentStyle: { type: Object, default: null },
})
const emit = defineEmits(['close', 'select'])
const dialog = ref(null)
const categoryRail = ref(null)
const activeTab = ref('风格广场')
const activeCategory = ref('推荐')
const query = ref('')
const commercialOnly = ref(false)
const activeModel = ref('全部')
const compact = ref(false)
const detail = ref(null)

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}
const favoriteIds = ref(new Set(readList('cv3-style-favorites')))
const recentIds = ref(readList('cv3-style-recent'))
const visibleStyles = computed(() => {
  const items = filterStyleGallery(STYLE_GALLERY_ITEMS, {
    tab: activeTab.value,
    favorites: favoriteIds.value,
    recent: recentIds.value,
    query: query.value,
    category: activeCategory.value,
    commercial: commercialOnly.value,
    model: activeModel.value,
  })
  if (activeTab.value !== '最近使用') return items
  return [...items].sort((a, b) => recentIds.value.indexOf(a.id) - recentIds.value.indexOf(b.id))
})

function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Local persistence is optional; the picker remains fully usable without it.
  }
}
function toggleFavorite(id) {
  const next = new Set(favoriteIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  favoriteIds.value = next
  persist('cv3-style-favorites', [...next])
}
function selectStyle(style) {
  recentIds.value = [style.id, ...recentIds.value.filter((id) => id !== style.id)].slice(0, 20)
  persist('cv3-style-recent', recentIds.value)
  emit('select', {
    id: style.id,
    title: style.title,
    model: style.model,
    prompt: style.prompt,
    image: style.image,
    author: style.author,
    commercial: style.commercial,
  })
}
function close() {
  detail.value = null
  emit('close')
}
function handleKeydown(event) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (detail.value) detail.value = null
    else close()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [
    ...(dialog.value?.querySelectorAll('button:not(:disabled), input, select') || []),
  ].filter((element) => element.getClientRects().length)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
function scrollCategories() {
  categoryRail.value?.scrollBy({ left: 220, behavior: 'smooth' })
}
function resetFilters() {
  query.value = ''
  activeCategory.value = '推荐'
  commercialOnly.value = false
}
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    dialog.value?.focus({ preventScroll: true })
  },
)
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to=".cv3-app-shell">
    <Transition name="cv3-style-modal">
      <div v-if="open" class="cv3-style-gallery-backdrop" @mousedown.self="close">
        <section
          ref="dialog"
          class="cv3-style-gallery"
          :class="{ 'is-compact': compact }"
          role="dialog"
          aria-modal="true"
          aria-label="风格广场"
          tabindex="-1"
          @keydown.stop="handleKeydown"
        >
          <header class="cv3-style-gallery-header">
            <div class="cv3-style-gallery-tabs" role="tablist" aria-label="风格内容">
              <button
                v-for="tab in STYLE_GALLERY_TABS"
                :key="tab"
                type="button"
                role="tab"
                :aria-selected="activeTab === tab"
                :class="{ selected: activeTab === tab }"
                @click="activeTab = tab"
              >
                {{ tab }}
              </button>
            </div>
            <label class="cv3-style-search">
              <input v-model="query" type="search" placeholder="搜索风格名称、作者" />
              <CanvasIcon name="search" :size="14" />
            </label>
            <span class="cv3-style-gallery-spacer" />
            <button
              type="button"
              class="cv3-style-header-action"
              :aria-label="compact ? '恢复大小' : '最小化'"
              :title="compact ? '恢复大小' : '最小化'"
              @click="compact = !compact"
            >
              <CanvasIcon :name="compact ? 'expand' : 'collapse'" :size="15" />
            </button>
            <button
              type="button"
              class="cv3-style-header-action"
              aria-label="关闭风格广场"
              title="关闭"
              @click="close"
            >
              <CanvasIcon name="close" :size="15" />
            </button>
          </header>

          <div class="cv3-style-filterbar">
            <div class="cv3-style-categories">
              <div ref="categoryRail" class="cv3-style-category-rail">
                <button
                  v-for="category in STYLE_CATEGORIES"
                  :key="category"
                  type="button"
                  :class="{ selected: activeCategory === category }"
                  @click="activeCategory = category"
                >
                  {{ category }}
                </button>
              </div>
              <button
                type="button"
                class="cv3-style-category-next"
                aria-label="显示后续分类"
                @click="scrollCategories"
              >
                ›
              </button>
            </div>
            <label class="cv3-style-commercial">
              <input v-model="commercialOnly" type="checkbox" />
              <span>仅看可商用</span>
            </label>
            <select v-model="activeModel" class="cv3-style-model-filter" aria-label="筛选模型">
              <option v-for="model in STYLE_MODELS" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </div>

          <div class="cv3-style-grid-scroll">
            <div v-if="visibleStyles.length" class="cv3-style-grid" role="list">
              <article
                v-for="style in visibleStyles"
                :key="style.id"
                class="cv3-style-card"
                :class="{ selected: currentStyle?.id === style.id }"
                role="listitem"
              >
                <div class="cv3-style-card-media">
                  <button
                    type="button"
                    class="cv3-style-card-apply"
                    :aria-label="'应用风格：' + style.title"
                    @click="selectStyle(style)"
                  >
                    <img :src="style.image" :alt="style.title" loading="lazy" draggable="false" />
                  </button>
                  <span class="cv3-style-model-badge">{{ style.model }}</span>
                  <button
                    type="button"
                    class="cv3-style-favorite"
                    :class="{ selected: favoriteIds.has(style.id) }"
                    :aria-label="favoriteIds.has(style.id) ? '取消收藏' : '收藏'"
                    @click="toggleFavorite(style.id)"
                  >
                    {{ favoriteIds.has(style.id) ? '★' : '☆' }}
                  </button>
                  <button
                    type="button"
                    class="cv3-style-detail-trigger"
                    :aria-label="'查看详情：' + style.title"
                    @click="detail = style"
                  >
                    <CanvasIcon name="expand" :size="13" />
                  </button>
                </div>
                <div class="cv3-style-card-title">
                  <strong>{{ style.title }}</strong>
                  <span v-if="style.commercial" title="可商用">✓ 商用</span>
                </div>
                <div class="cv3-style-card-meta">
                  <span>{{ style.author }}</span>
                  <span>▷ {{ style.uses }}</span>
                </div>
              </article>
            </div>
            <div v-else class="cv3-style-empty" role="status">
              <span>没有符合条件的风格</span>
              <button type="button" @click="resetFilters">清除筛选</button>
            </div>
          </div>

          <Transition name="cv3-style-detail">
            <aside v-if="detail" class="cv3-style-detail" aria-label="风格详情">
              <button
                type="button"
                class="cv3-style-detail-close"
                aria-label="关闭详情"
                @click="detail = null"
              >
                <CanvasIcon name="close" :size="14" />
              </button>
              <img :src="detail.image" :alt="detail.title" />
              <div>
                <small>
                  {{ detail.model }} · {{ detail.commercial ? '可商用' : '授权以详情为准' }}
                </small>
                <h3>{{ detail.title }}</h3>
                <p>{{ detail.description }}</p>
                <p class="cv3-style-detail-author">
                  作者 {{ detail.author }} · 使用 {{ detail.uses }}
                </p>
                <button type="button" class="cv3-style-detail-apply" @click="selectStyle(detail)">
                  使用此风格
                </button>
              </div>
            </aside>
          </Transition>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cv3-style-gallery-backdrop {
  position: fixed;
  z-index: 700;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 44px 60px;
  background: #000b;
}
.cv3-style-gallery {
  position: relative;
  display: flex;
  width: min(1028px, calc(100vw - 120px));
  height: min(734px, calc(100dvh - 158px));
  min-height: 460px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #363636;
  border-radius: 12px;
  color: #f7f7f7;
  background: #262626f5;
  box-shadow: 0 18px 60px #0008;
  outline: none;
  backdrop-filter: blur(12px);
  transition:
    width 220ms ease,
    height 220ms ease,
    opacity 200ms ease,
    transform 200ms ease;
}
.cv3-style-gallery.is-compact {
  width: min(760px, calc(100vw - 48px));
  height: min(560px, calc(100dvh - 80px));
}
.cv3-style-gallery-header {
  display: flex;
  height: 65px;
  flex: 0 0 65px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #363636;
}
.cv3-style-gallery-tabs {
  display: flex;
  height: 40px;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid #3d3d3d;
  border-radius: 12px;
  background: #333;
}
.cv3-style-gallery-tabs button {
  min-width: 82px;
  height: 32px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  color: #919191;
  background: transparent;
  font-size: 15px;
  white-space: nowrap;
}
.cv3-style-gallery-tabs button:is(:hover, .selected) {
  color: #f7f7f7;
  background: #444;
}
.cv3-style-search {
  display: flex;
  width: 336px;
  height: 40px;
  flex: 0 0 336px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #919191;
  background: #333;
}
.cv3-style-search:focus-within {
  border-color: #07b8dd;
}
.cv3-style-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  color: #f7f7f7;
  background: transparent;
  font: inherit;
  font-size: 13px;
}
.cv3-style-search input::-webkit-search-cancel-button {
  display: none;
}
.cv3-style-gallery-spacer {
  flex: 1;
}
.cv3-style-header-action {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #e5e5e5;
  background: transparent;
}
.cv3-style-header-action:hover {
  background: #3a3a3a;
}
.cv3-style-filterbar {
  display: flex;
  height: 44px;
  flex: 0 0 44px;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
}
.cv3-style-categories {
  position: relative;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.cv3-style-category-rail {
  display: flex;
  gap: 8px;
  overflow: auto hidden;
  padding-right: 34px;
  scrollbar-width: none;
}
.cv3-style-category-rail::-webkit-scrollbar {
  display: none;
}
.cv3-style-category-rail button {
  height: 28px;
  min-width: 48px;
  flex: 0 0 auto;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  color: #919191;
  background: transparent;
  font-size: 13px;
}
.cv3-style-category-rail button:is(:hover, .selected) {
  color: #f7f7f7;
  background: #ffffff1a;
}
.cv3-style-category-next {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  width: 36px;
  height: 28px;
  border: 0;
  color: #aaa;
  background: linear-gradient(90deg, transparent, #262626 45%);
  font-size: 20px;
}
.cv3-style-commercial {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  color: #919191;
  font-size: 12px;
  white-space: nowrap;
}
.cv3-style-commercial input {
  width: 16px;
  height: 16px;
  accent-color: #22bad7;
}
.cv3-style-model-filter {
  height: 28px;
  max-width: 126px;
  padding: 0 24px 0 9px;
  border: 0;
  border-radius: 8px;
  color: #a9a9a9;
  background: #333;
  font: inherit;
  font-size: 13px;
}
.cv3-style-grid-scroll {
  min-height: 0;
  flex: 1;
  overflow: hidden auto;
  padding: 0 16px 16px;
  scrollbar-width: thin;
  scrollbar-color: #696969 transparent;
}
.cv3-style-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px 12px;
}
.is-compact .cv3-style-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.cv3-style-card {
  min-width: 0;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 12px;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    transform 120ms ease;
}
.cv3-style-card:hover {
  background: #333;
}
.cv3-style-card.selected {
  border-color: #18bfdc;
  background: #2f383a;
}
.cv3-style-card:active {
  transform: scale(0.985);
}
.cv3-style-card-media {
  position: relative;
  overflow: hidden;
  aspect-ratio: 0.748 / 1;
  border-radius: 8px;
  background: #333;
}
.cv3-style-card-apply {
  position: absolute;
  z-index: 0;
  inset: 0;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
}
.cv3-style-card-apply img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 200ms ease;
}
.cv3-style-card:hover .cv3-style-card-apply img {
  transform: scale(1.025);
}
.cv3-style-model-badge {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  max-width: 24px;
  overflow: hidden;
  padding: 4px 6px;
  border-radius: 8px;
  color: #fff;
  background: #1f1f1f66;
  backdrop-filter: blur(2px);
  font-size: 10px;
  white-space: nowrap;
  transition:
    max-width 150ms ease,
    background 150ms ease;
}
.cv3-style-card:hover .cv3-style-model-badge {
  max-width: 130px;
  background: #000a;
}
.cv3-style-favorite,
.cv3-style-detail-trigger {
  position: absolute;
  z-index: 3;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #1f1f1f80;
  opacity: 0;
  backdrop-filter: blur(4px);
  transition: opacity 140ms ease;
}
.cv3-style-favorite {
  top: 8px;
  right: 8px;
  font-size: 17px;
}
.cv3-style-favorite.selected {
  color: #ffd05c;
  opacity: 1;
}
.cv3-style-detail-trigger {
  right: 8px;
  bottom: 8px;
}
.cv3-style-card:hover :is(.cv3-style-favorite, .cv3-style-detail-trigger),
.cv3-style-card:focus-within :is(.cv3-style-favorite, .cv3-style-detail-trigger) {
  opacity: 1;
}
.cv3-style-card-title,
.cv3-style-card-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  padding: 0 3px;
}
.cv3-style-card-title {
  margin-top: 7px;
  font-size: 13px;
}
.cv3-style-card-title strong {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-style-card-title span,
.cv3-style-card-meta {
  color: #8f8f8f;
  font-size: 11px;
  white-space: nowrap;
}
.cv3-style-card-meta {
  margin-top: 5px;
}
.cv3-style-card-meta span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv3-style-empty {
  display: grid;
  height: 100%;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: #888;
  font-size: 14px;
}
.cv3-style-empty button,
.cv3-style-detail-apply {
  min-height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  color: #111;
  background: #e9e9e9;
}
.cv3-style-detail {
  position: absolute;
  z-index: 10;
  inset: 65px 0 0 auto;
  display: grid;
  width: min(420px, 90%);
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: auto;
  padding: 16px;
  border-left: 1px solid #414141;
  background: #202020f7;
  box-shadow: -16px 0 42px #0007;
  backdrop-filter: blur(16px);
}
.cv3-style-detail > img {
  width: 100%;
  min-height: 0;
  object-fit: contain;
  border-radius: 10px;
  background: #171717;
}
.cv3-style-detail h3 {
  margin: 10px 0 6px;
  font-size: 20px;
}
.cv3-style-detail p {
  color: #b2b2b2;
  line-height: 1.7;
}
.cv3-style-detail small,
.cv3-style-detail-author {
  color: #858585;
}
.cv3-style-detail-close {
  position: absolute;
  z-index: 2;
  top: 24px;
  right: 24px;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #0009;
}
.cv3-style-detail-apply {
  margin-top: 8px;
}
.cv3-style-modal-enter-active,
.cv3-style-modal-leave-active {
  transition: opacity 180ms ease;
}
.cv3-style-modal-enter-active .cv3-style-gallery,
.cv3-style-modal-leave-active .cv3-style-gallery {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.cv3-style-modal-enter-from,
.cv3-style-modal-leave-to,
.cv3-style-modal-enter-from .cv3-style-gallery,
.cv3-style-modal-leave-to .cv3-style-gallery {
  opacity: 0;
}
.cv3-style-modal-enter-from .cv3-style-gallery,
.cv3-style-modal-leave-to .cv3-style-gallery {
  transform: translateY(10px) scale(0.99);
}
.cv3-style-detail-enter-active,
.cv3-style-detail-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.cv3-style-detail-enter-from,
.cv3-style-detail-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
@media (max-width: 920px) {
  .cv3-style-gallery-backdrop {
    padding: 24px;
  }
  .cv3-style-gallery {
    width: calc(100vw - 48px);
    height: calc(100dvh - 48px);
  }
  .cv3-style-search {
    width: min(260px, 32vw);
    flex-basis: min(260px, 32vw);
  }
  .cv3-style-grid,
  .is-compact .cv3-style-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .cv3-style-gallery,
  .cv3-style-card,
  .cv3-style-card *,
  .cv3-style-modal-enter-active,
  .cv3-style-modal-leave-active,
  .cv3-style-detail-enter-active,
  .cv3-style-detail-leave-active {
    scroll-behavior: auto;
    transition: none !important;
  }
}
</style>

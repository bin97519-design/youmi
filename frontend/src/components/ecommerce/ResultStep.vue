<script setup>
import { ref, computed } from 'vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const store = useEcommerceSetStore()

const mainImages = computed(() => store.results.mainImages || [])
const detailPages = computed(() => store.results.detailPages || [])

const ACTION_LABELS = {
  download: '下载',
  chat: '对话修改',
  text: '编辑文字',
  video: '生成视频',
  resize: '修改尺寸',
  replace: '产品替换',
  edit: '编辑图片',
  canvas: '去画布',
}

const ACTIONS = [
  { key: 'chat', icon: 'ri-chat-3-line' },
  { key: 'text', icon: 'ri-text' },
  { key: 'video', icon: 'ri-video-line' },
  { key: 'resize', icon: 'ri-crop-line' },
  { key: 'replace', icon: 'ri-repeat-2-line' },
  { key: 'download', icon: 'ri-download-line' },
  { key: 'canvas', icon: 'ri-layout-4-line' },
  { key: 'edit', icon: 'ri-pencil-line' },
]

const toast = ref('')
let toastTimer = null
function showToast(msg) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 1800)
}

function imageUrl(img) {
  return img.url || img.imageUrl
}

function onAction(key, url) {
  if (key === 'download') {
    store.downloadImage(url)
    return
  }
  if (key === 'canvas') {
    store.importToCanvas(url)
    return
  }
  // 其余为占位能力，给出轻提示
  showToast(ACTION_LABELS[key] + '：能力即将上线')
}

function handleReplan() {
  store.reset()
}
</script>

<template>
  <div class="es-result-step">
    <transition name="es-toast">
      <div v-if="toast" class="es-toast">{{ toast }}</div>
    </transition>

    <!-- 主图区域 -->
    <div v-if="mainImages.length" class="es-result-section">
      <div class="es-section-title">主图</div>
      <div class="es-image-grid">
        <div v-for="(img, idx) in mainImages" :key="`main-${idx}`" class="es-image-card">
          <div class="es-image-wrap">
            <img :src="imageUrl(img)" :alt="`主图 ${idx + 1}`" class="es-image" />
            <span v-if="img.sellingPointType || img.type" class="es-image-tag">
              {{ img.sellingPointType || img.type }}
            </span>
            <div class="es-image-overlay">
              <button
                v-for="a in ACTIONS"
                :key="a.key"
                class="es-overlay-btn"
                :title="ACTION_LABELS[a.key]"
                @click="onAction(a.key, imageUrl(img))"
              >
                <i :class="a.icon" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情页区域 -->
    <div v-if="detailPages.length" class="es-result-section">
      <div class="es-section-title">详情页</div>
      <div class="es-image-grid">
        <div v-for="(img, idx) in detailPages" :key="`detail-${idx}`" class="es-image-card">
          <div class="es-image-wrap">
            <img :src="imageUrl(img)" :alt="`详情页 ${idx + 1}`" class="es-image" />
            <span v-if="img.sellingPointType || img.type" class="es-image-tag">
              {{ img.sellingPointType || img.type }}
            </span>
            <div class="es-image-overlay">
              <button
                v-for="a in ACTIONS"
                :key="a.key"
                class="es-overlay-btn"
                :title="ACTION_LABELS[a.key]"
                @click="onAction(a.key, imageUrl(img))"
              >
                <i :class="a.icon" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!mainImages.length && !detailPages.length" class="es-empty-tip">暂无生成结果</div>

    <!-- 重新策划 -->
    <button
      v-if="mainImages.length || detailPages.length"
      class="es-replan-btn"
      @click="handleReplan"
    >
      <i class="ri-refresh-line" aria-hidden="true"></i>
      <span>重新策划</span>
    </button>
  </div>
</template>

<style scoped>
.es-result-step {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  min-height: 100%;
}

.es-result-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.es-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* Image grid */
.es-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}
.es-image-card {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition:
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}
.es-image-card:hover {
  border-color: rgba(15, 23, 42, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}
.es-image-wrap {
  position: relative;
}
.es-image {
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  display: block;
  background: #f1f5f9;
}
.es-image-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
  background: rgba(15, 23, 42, 0.6);
  color: #fff;
  backdrop-filter: blur(4px);
}

/* Hover 操作浮层 */
.es-image-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.55);
  opacity: 0;
  transition: opacity 0.2s ease;
}
.es-image-card:hover .es-image-overlay {
  opacity: 1;
}
.es-overlay-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  border: none;
  color: #1e293b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  transition:
    background 0.15s,
    transform 0.15s;
}
.es-overlay-btn:hover {
  background: #1e293b;
  color: #fff;
  transform: scale(1.05);
}

/* Empty */
.es-empty-tip {
  font-size: 13px;
  color: #94a3b8;
  text-align: center;
  padding: 40px 0;
}

/* Replan button */
.es-replan-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  align-self: center;
  padding: 9px 22px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.es-replan-btn:hover {
  border-color: rgba(15, 23, 42, 0.3);
  color: #1e293b;
  background: rgba(0, 0, 0, 0.03);
}

/* Toast */
.es-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  background: rgba(15, 23, 42, 0.92);
  color: #fff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}
.es-toast-enter-active,
.es-toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.es-toast-enter-from,
.es-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>

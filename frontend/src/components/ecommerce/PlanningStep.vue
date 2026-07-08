<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'
import { uploadFileDirect } from '../../utils/ossUpload'

const store = useEcommerceSetStore()
const router = useRouter()
const fileInput = ref(null)
const uploading = ref(false)

// 卖点类型配色（去紫去粉，使用中性/低饱和色板）
const POINT_TYPE_COLORS = {
  品牌首图: '#0ea5e9',
  核心卖点: '#ef4444',
  使用场景: '#f59e0b',
  材质工艺: '#0891b2',
  尺寸规格: '#10b981',
  搭配推荐: '#0f766e',
  情感价值: '#84cc16',
  促销信息: '#f97316',
  用户评价: '#64748b',
  品质保障: '#14b8a6',
  功能演示: '#eab308',
  包装展示: '#0d9488',
}
function getTypeColor(type) {
  return POINT_TYPE_COLORS[type] || '#64748b'
}

function triggerFileInput() {
  fileInput.value?.click()
}

async function handleFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const url = await uploadFileDirect(file, { dir: 'youmi/ecommerce' })
    store.productImageUrl = url
  } catch (err) {
    console.error('[PlanningStep] upload failed:', err)
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function handleDragOver(e) {
  e.preventDefault()
  e.currentTarget.classList.add('es-drag-over')
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('es-drag-over')
}

async function handleDrop(e) {
  e.preventDefault()
  e.currentTarget.classList.remove('es-drag-over')
  const file = e.dataTransfer.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    const url = await uploadFileDirect(file, { dir: 'youmi/ecommerce' })
    store.productImageUrl = url
  } catch (err) {
    console.error('[PlanningStep] drop upload failed:', err)
  } finally {
    uploading.value = false
  }
}

function clearProductImage() {
  store.productImageUrl = ''
}

function importFromHistory() {
  router.push('/history')
}

/* 产品信息重新优化（复用原有 AI 策划能力） */
async function handleOptimize() {
  if (!store.productImageUrl && !store.productDescription) return
  try {
    await store.createPlanning()
  } catch (err) {
    console.error('[PlanningStep] optimize failed:', err)
  }
}

const hasPlanning = computed(() => !!store.planningData)
const productInfo = computed(() => store.planningData?.productInfo || store.planningData || {})
const sellingPoints = computed(() => store.planningData?.sellingPoints || [])
</script>

<template>
  <div class="es-planning-step">
    <!-- 产品图片上传 -->
    <div class="es-section">
      <label class="es-label">产品图片</label>
      <div
        v-if="!store.productImageUrl"
        class="es-upload-zone"
        @click="triggerFileInput"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="es-file-hidden"
          @change="handleFileChange"
        />
        <i class="ri-image-add-line es-upload-icon" aria-hidden="true"></i>
        <span class="es-upload-text">{{ uploading ? '上传中...' : '拖拽或点击上传产品图' }}</span>
        <span class="es-upload-hint">支持 JPG / PNG / WEBP</span>
      </div>
      <div v-else class="es-upload-preview">
        <img :src="store.productImageUrl" alt="产品图" class="es-preview-img" />
        <button class="es-preview-remove" title="移除图片" @click="clearProductImage">
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
      </div>
      <button class="es-secondary-btn es-import-history" type="button" @click="importFromHistory">
        <i class="ri-history-line" aria-hidden="true"></i>
        <span>从生成历史导入</span>
      </button>
    </div>

    <!-- 产品描述 -->
    <div class="es-section">
      <label class="es-label">产品描述</label>
      <textarea
        v-model="store.productDescription"
        class="es-textarea"
        rows="4"
        placeholder="描述你的产品，如：成品窗帘，遮光隔音隔热..."
      ></textarea>
    </div>

    <!-- 产品信息重新优化 -->
    <button
      class="es-primary-btn"
      :disabled="(!store.productImageUrl && !store.productDescription) || store.planningLoading"
      @click="handleOptimize"
    >
      <i v-if="store.planningLoading" class="ri-loader-4-line es-spin" aria-hidden="true"></i>
      <i v-else class="ri-magic-line" aria-hidden="true"></i>
      <span>{{ store.planningLoading ? '优化中...' : '产品信息重新优化' }}</span>
    </button>

    <!-- 优化结果（可选预览） -->
    <div v-if="hasPlanning" class="es-planning-result">
      <div class="es-result-card">
        <div class="es-result-title">AI 优化结果</div>

        <div class="es-product-info">
          <div v-if="productInfo.name" class="es-info-row">
            <span class="es-info-label">产品名称</span>
            <span class="es-info-value">{{ productInfo.name }}</span>
          </div>
          <div v-if="productInfo.category" class="es-info-row">
            <span class="es-info-label">品类</span>
            <span class="es-info-value">{{ productInfo.category }}</span>
          </div>
          <div v-if="productInfo.material" class="es-info-row">
            <span class="es-info-label">材质</span>
            <span class="es-info-value">{{ productInfo.material }}</span>
          </div>
          <div v-if="productInfo.craft" class="es-info-row">
            <span class="es-info-label">工艺</span>
            <span class="es-info-value">{{ productInfo.craft }}</span>
          </div>
        </div>

        <div v-if="sellingPoints.length" class="es-selling-points">
          <div class="es-sub-title">建议卖点</div>
          <div v-for="(point, idx) in sellingPoints" :key="idx" class="es-selling-point">
            <div class="es-point-header">
              <span
                class="es-point-type-tag"
                :style="{
                  background: getTypeColor(point.type) + '18',
                  color: getTypeColor(point.type),
                  borderColor: getTypeColor(point.type) + '40',
                }"
              >
                {{ point.type || '卖点' + (idx + 1) }}
              </span>
              <span class="es-point-title">{{ point.title }}</span>
            </div>
            <div v-if="point.description" class="es-point-desc">{{ point.description }}</div>
          </div>
        </div>
      </div>
      <p class="es-optimize-tip">已生成卖点建议，可在下方「主图卖点」中多选套用。</p>
    </div>
  </div>
</template>

<style scoped>
.es-planning-step {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.es-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.es-label {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

/* 上传区域 */
.es-upload-zone {
  border: 1.5px dashed rgba(0, 0, 0, 0.18);
  border-radius: 12px;
  padding: 24px 12px;
  text-align: center;
  cursor: pointer;
  background: #f8fafc;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.es-upload-zone:hover,
.es-upload-zone.es-drag-over {
  border-color: rgba(15, 23, 42, 0.45);
  background: rgba(15, 23, 42, 0.03);
}
.es-file-hidden {
  display: none;
}
.es-upload-icon {
  font-size: 28px;
  color: #94a3b8;
  display: block;
  margin-bottom: 8px;
}
.es-upload-text {
  font-size: 13px;
  color: #475569;
  display: block;
}
.es-upload-hint {
  font-size: 11px;
  color: #94a3b8;
  display: block;
  margin-top: 4px;
}

/* 上传预览 */
.es-upload-preview {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: #f1f5f9;
}
.es-preview-img {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  display: block;
  background: #f1f5f9;
}
.es-preview-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.6);
  border: none;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: background 0.2s;
}
.es-preview-remove:hover {
  background: rgba(239, 68, 68, 0.85);
}

/* 次级按钮（从生成历史导入） */
.es-secondary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    color 0.2s;
}
.es-secondary-btn:hover {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.2);
  color: #1e293b;
}
.es-import-history {
  margin-top: 2px;
}

/* Textarea */
.es-textarea {
  width: 100%;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  padding: 9px 11px;
  color: #1e293b;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.5;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.es-textarea::placeholder {
  color: #94a3b8;
}
.es-textarea:focus {
  outline: none;
  border-color: rgba(15, 23, 42, 0.45);
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
}

/* Primary Button（中性深色） */
.es-primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: #1e293b;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.2s,
    opacity 0.2s;
}
.es-primary-btn:hover:not(:disabled) {
  background: #334155;
}
.es-primary-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Spin animation */
.es-spin {
  animation: es-spin-anim 1s linear infinite;
}
@keyframes es-spin-anim {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Planning result */
.es-planning-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.es-result-card {
  background: #f8fafc;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 12px;
}
.es-result-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.es-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 8px;
  margin-top: 10px;
}

/* Product info */
.es-product-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.es-info-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.es-info-label {
  color: #94a3b8;
  min-width: 56px;
  flex-shrink: 0;
}
.es-info-value {
  color: #334155;
}

/* Selling points */
.es-selling-points {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.es-selling-point {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  padding: 10px;
}
.es-point-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.es-point-type-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid;
  white-space: nowrap;
}
.es-point-title {
  font-size: 13px;
  color: #1e293b;
  font-weight: 500;
}
.es-point-desc {
  font-size: 12px;
  color: #64748b;
  margin-top: 4px;
  line-height: 1.4;
}

.es-optimize-tip {
  font-size: 11px;
  color: #94a3b8;
  margin: 0;
}
</style>

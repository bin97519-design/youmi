<script setup>
import { computed, ref } from 'vue'
import { useEcommerceSetStore } from '../../stores/ecommerceSet'

const store = useEcommerceSetStore()

const platforms = ['天猫', '淘宝', '京东', '拼多多', '抖音']
const languages = ['中文(简体)', '中文(繁体)', 'English', '日本語', '한국어']

// 主图类型（单值）
const mainImageTypes = ['智能选择', '品牌首图']
const mainImageCounts = [1, 2, 3, 4, 5, 6]
const mainImageRatios = ['1:1', '3:4', '4:3', '9:16']

// 主图卖点（多选 chips）
const sellingPointOptions = [
  '核心卖点',
  '场景使用',
  'SKU',
  '白底图',
  '产品尺寸',
  '产品细节',
  '场景渲染',
  '功能演示',
  '材质工艺',
  '规格参数',
  '产品对比',
  '礼盒赠品',
  '节日大促',
]

const detailModes = [
  { label: '分屏生成', value: 'split' },
  { label: '整版长图', value: 'whole' },
]
const detailStyles = ['简约', '高端']
const detailRatios = ['9:16']
const detailCounts = [1, 2, 3]

const models = ['agnes-image-2.1-flash', 'banana2', 'bananapro', 'gpt-image-2']

const showNotes = ref(false)
const notesDraft = ref(store.config.detailPage.notes || '')
const confirming = ref(false)
const totalImages = computed(
  () => (store.config.mainImage.count || 0) + (store.config.detailPage.count || 0),
)
const canGenerate = computed(
  () => !!store.productImageUrl && !!store.productDescription.trim() && totalImages.value > 0,
)

function isSelected(pt) {
  return (store.config.mainImage.sellingPoints || []).includes(pt)
}

function toggleSellingPoint(pt) {
  const arr = store.config.mainImage.sellingPoints
  const idx = arr.indexOf(pt)
  if (idx === -1) arr.push(pt)
  else arr.splice(idx, 1)
}

function toggleNotes() {
  showNotes.value = !showNotes.value
  if (!showNotes.value) {
    store.config.detailPage.notes = notesDraft.value
  }
}

function syncNotes() {
  store.config.detailPage.notes = notesDraft.value
}

async function handleStartGeneration() {
  try {
    // 策划/优化是可选动作：若尚未创建 setId，则先创建再生成
    if (!store.setId) {
      if (!store.productImageUrl || !store.productDescription) {
        window.alert('请同时上传产品图并填写产品描述（两者均为必填）')
        return
      }
      await store.createPlanning()
    }
    await store.startGeneration()
  } catch (err) {
    console.error('[ConfigStep] startGeneration failed:', err)
  }
}

function showConfirmDialog() {
  if (!canGenerate.value) return
  confirming.value = true
}

async function confirmGeneration() {
  confirming.value = false
  await handleStartGeneration()
}
</script>

<template>
  <div class="es-config-step">
    <!-- 销售平台 -->
    <div class="es-section">
      <label class="es-label">销售平台</label>
      <select v-model="store.config.platform" class="es-select">
        <option v-for="p in platforms" :key="p" :value="p">{{ p }}</option>
      </select>
    </div>

    <!-- 画面文字语言 -->
    <div class="es-section">
      <label class="es-label">画面文字语言</label>
      <select v-model="store.config.language" class="es-select">
        <option v-for="l in languages" :key="l" :value="l">{{ l }}</option>
      </select>
    </div>

    <div class="es-divider"><span class="es-divider-text">主图设计</span></div>

    <!-- 主图类型 -->
    <div class="es-row">
      <div class="es-section es-flex-1">
        <label class="es-label">主图类型</label>
        <select v-model="store.config.mainImage.type" class="es-select">
          <option v-for="t in mainImageTypes" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>
      <div class="es-section es-flex-1">
        <label class="es-label">张数</label>
        <select v-model.number="store.config.mainImage.count" class="es-select">
          <option v-for="c in mainImageCounts" :key="c" :value="c">{{ c }} 张</option>
        </select>
      </div>
    </div>

    <div class="es-section">
      <label class="es-label">画面比例</label>
      <select v-model="store.config.mainImage.ratio" class="es-select">
        <option v-for="r in mainImageRatios" :key="r" :value="r">{{ r }}</option>
      </select>
    </div>

    <!-- 主图卖点（多选 chips） -->
    <div class="es-section">
      <label class="es-label">
        主图卖点
        <small class="es-label-hint">（可多选）</small>
      </label>
      <div class="es-chips">
        <button
          v-for="pt in sellingPointOptions"
          :key="pt"
          type="button"
          :class="['es-chip', { active: isSelected(pt) }]"
          @click="toggleSellingPoint(pt)"
        >
          {{ pt }}
        </button>
      </div>
    </div>

    <div class="es-divider"><span class="es-divider-text">详情页设计</span></div>

    <!-- 生成方式（分屏/整版） -->
    <div class="es-section">
      <label class="es-label">生成方式</label>
      <div class="es-segment">
        <button
          v-for="m in detailModes"
          :key="m.value"
          type="button"
          :class="['es-seg-btn', { active: store.config.detailPage.mode === m.value }]"
          @click="store.config.detailPage.mode = m.value"
        >
          {{ m.label }}
        </button>
      </div>
    </div>

    <div class="es-row">
      <div class="es-section es-flex-1">
        <label class="es-label">风格</label>
        <select v-model="store.config.detailPage.style" class="es-select">
          <option v-for="s in detailStyles" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
      <div class="es-section es-flex-1">
        <label class="es-label">比例</label>
        <select v-model="store.config.detailPage.ratio" class="es-select">
          <option v-for="r in detailRatios" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
    </div>

    <div class="es-section">
      <label class="es-label">数量</label>
      <select v-model.number="store.config.detailPage.count" class="es-select">
        <option v-for="c in detailCounts" :key="c" :value="c">{{ c }} 张</option>
      </select>
    </div>

    <!-- 添加分屏构思 -->
    <div class="es-section">
      <button type="button" class="es-add-note" @click="toggleNotes">
        <i class="ri-add-line" aria-hidden="true"></i>
        <span>{{ showNotes ? '收起分屏构思' : '添加分屏构思' }}</span>
      </button>
      <textarea
        v-if="showNotes"
        v-model="notesDraft"
        class="es-textarea es-note-input"
        rows="3"
        placeholder="描述每张分屏的构思，如：首屏卖点、场景图、细节特写…"
        @input="syncNotes"
      ></textarea>
    </div>

    <div class="es-divider"><span class="es-divider-text">生图模型</span></div>

    <div class="es-section">
      <label class="es-label">模型选择</label>
      <select v-model="store.config.model" class="es-select">
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>

    <div class="es-actions">
      <div class="es-generation-summary">
        <span>{{ canGenerate ? '预计生成' : '请先完成产品图和描述' }}</span>
        <strong>{{ totalImages }} 张</strong>
        <span v-if="canGenerate">失败自动退米值</span>
      </div>
      <div v-if="confirming" class="es-inline-confirm" role="dialog" aria-label="确认生成">
        <div>
          <strong>确认生成 {{ totalImages }} 张套图？</strong>
          <span>
            {{ store.config.mainImage.count }} 张主图 + {{ store.config.detailPage.count }} 张详情页
          </span>
        </div>
        <button type="button" title="取消" @click="confirming = false">
          <i class="ri-close-line" aria-hidden="true"></i>
        </button>
        <button class="confirm" type="button" title="确认生成" @click="confirmGeneration">
          <i class="ri-check-line" aria-hidden="true"></i>
        </button>
      </div>
      <button
        v-else
        class="es-primary-btn"
        :disabled="store.generationLoading || !canGenerate"
        @click="showConfirmDialog"
      >
        <i
          :class="store.generationLoading ? 'ri-loader-4-line es-spin' : 'ri-play-circle-line'"
          aria-hidden="true"
        ></i>
        <span>{{ store.generationLoading ? '正在提交...' : '开始生成' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.es-config-step {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.es-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.es-label {
  font-size: 12px;
  font-weight: 500;
  color: #475569;
}
.es-label-hint {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 400;
  margin-left: 4px;
}

.es-select {
  width: 100%;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 10px;
  color: #1e293b;
  font-size: 13px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.es-select:focus {
  outline: none;
  border-color: rgba(15, 23, 42, 0.45);
  box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
}
.es-select option {
  background: #fff;
  color: #1e293b;
}

.es-row {
  display: flex;
  gap: 10px;
}
.es-flex-1 {
  flex: 1;
}

.es-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.es-divider::before,
.es-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
}
.es-divider-text {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* 多选 chips */
.es-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.es-chip {
  font-size: 12px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1.2;
}
.es-chip:hover {
  border-color: rgba(15, 23, 42, 0.35);
  color: #1e293b;
}
.es-chip.active {
  background: #1e293b;
  color: #fff;
  border-color: #1e293b;
}

/* 分段控件 */
.es-segment {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: #f1f5f9;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
}
.es-seg-btn {
  flex: 1;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.es-seg-btn.active {
  background: #fff;
  color: #1e293b;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* 添加分屏构思 */
.es-add-note {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.18);
  background: #fff;
  color: #475569;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.es-add-note:hover {
  border-color: rgba(15, 23, 42, 0.4);
  color: #1e293b;
}
.es-add-note i {
  font-size: 15px;
}
.es-note-input {
  margin-top: 6px;
}

.es-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  position: sticky;
  bottom: 0;
  z-index: 4;
  margin-inline: -16px;
  padding: 12px 16px 16px;
  background: rgba(255, 255, 255, 0.96);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(8px);
}
.es-generation-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 11px;
}
.es-generation-summary strong {
  color: #0f172a;
  font-size: 13px;
}
.es-generation-summary span:last-child {
  margin-left: auto;
}
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
  transition: background 0.2s;
}
.es-primary-btn:hover {
  background: #334155;
}
.es-primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.es-inline-confirm {
  min-height: 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px 36px;
  align-items: center;
  gap: 7px;
  padding: 7px 8px 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
}
.es-inline-confirm > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.es-inline-confirm strong,
.es-inline-confirm span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.es-inline-confirm strong {
  color: #0f172a;
  font-size: 12px;
}
.es-inline-confirm span {
  color: #64748b;
  font-size: 10px;
}
.es-inline-confirm button {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #dbe2ea;
  border-radius: 7px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  font-size: 17px;
}
.es-inline-confirm button.confirm {
  border-color: #1e293b;
  background: #1e293b;
  color: #fff;
}
.es-spin {
  animation: es-spin 0.8s linear infinite;
}
@keyframes es-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<script setup>
import { computed, ref, watch } from 'vue'
import { useUserStore } from '../../stores/user'
import { apiPath } from '../../utils/apiBase'

const props = defineProps({
  open: { type: Boolean, default: false },
  selectedLayers: { type: Array, default: () => [] },
  model: { type: String, default: '' },
  resolution: { type: String, default: '2K' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'run'])
const userStore = useUserStore()
const tab = ref('main')
const mode = ref('layout')
const extra = ref('')
const demandProductInfo = ref('')
const demandCount = ref(6)
const demandStyle = ref('真实、清晰、有品质感')
const demandCards = ref([])
const demandPlanning = ref(false)
const demandError = ref('')

const product = computed(() => props.selectedLayers[0] || null)
const references = computed(() => props.selectedLayers.slice(1))
const canRunMain = computed(() => Boolean(product.value && references.value.length && !props.busy))
const selectedDemandCards = computed(() => demandCards.value.filter((card) => card.selected))
const canPlanDemands = computed(() =>
  Boolean(product.value && demandProductInfo.value.trim() && !demandPlanning.value && !props.busy),
)
const canRunDemands = computed(() =>
  Boolean(
    product.value && selectedDemandCards.value.length && !demandPlanning.value && !props.busy,
  ),
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      extra.value = ''
      demandError.value = ''
    }
  },
)

function ratioOf(layer) {
  const width = Number(layer?.naturalWidth || layer?.width || 0)
  const height = Number(layer?.naturalHeight || layer?.height || 0)
  if (!width || !height) return 'auto'
  const divisor = gcd(Math.round(width), Math.round(height))
  const rw = Math.round(width) / divisor
  const rh = Math.round(height) / divisor
  if (rw <= 20 && rh <= 20) return `${rw}:${rh}`
  return `${(width / height).toFixed(2)}:1`
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : Math.max(1, a)
}

function runMainImages() {
  if (!canRunMain.value) return
  const prefix = mode.value === 'layout' ? '@主图复刻' : '@风格迁移'
  const prompt = extra.value.trim() ? `${prefix} ${extra.value.trim()}` : prefix
  emit('run', {
    type: 'main-image',
    sourceIds: [product.value.id],
    jobs: references.value.map((reference, index) => ({
      name: `${mode.value === 'layout' ? '主图复刻' : '风格迁移'} ${index + 1}`,
      prompt,
      imageUrls: [product.value.url, reference.url],
      sourceIds: [product.value.id, reference.id],
      previewUrl: product.value.url,
      aspectWidth: product.value.naturalWidth || product.value.width,
      aspectHeight: product.value.naturalHeight || product.value.height,
      ratio: ratioOf(product.value),
      model: props.model,
      resolution: props.resolution,
    })),
  })
}

async function planDemands() {
  if (!canPlanDemands.value) return
  demandPlanning.value = true
  demandError.value = ''
  try {
    const response = await fetch(apiPath('/api/canvas-creative/demands'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
      },
      body: JSON.stringify({
        productInfo: demandProductInfo.value.trim(),
        productImages: [product.value.url],
        count: Number(demandCount.value) || 6,
        platform: '淘宝/天猫',
        style: demandStyle.value.trim(),
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.code) {
      throw new Error(payload.message || '需求生成失败')
    }
    const cards = Array.isArray(payload.data?.cards) ? payload.data.cards : []
    if (!cards.length) throw new Error('没有生成可用的需求方向')
    demandCards.value = cards.map((card) => ({ ...card, selected: true }))
  } catch (error) {
    demandError.value = String(error?.message || error || '需求生成失败')
  } finally {
    demandPlanning.value = false
  }
}

function runDemands() {
  if (!canRunDemands.value) return
  emit('run', {
    type: 'demand',
    sourceIds: [product.value.id],
    jobs: selectedDemandCards.value.map((card) => ({
      name: `${card.dimension || '需求'} · ${card.title || card.index}`,
      prompt: [
        card.imagePrompt,
        `最终创意标题：${card.title || ''}`,
        `最终画面文案：${card.copy || ''}`,
        `最终视觉方向：${card.visualDirection || ''}`,
      ]
        .filter(Boolean)
        .join('\n'),
      imageUrls: [product.value.url],
      sourceIds: [product.value.id],
      previewUrl: product.value.url,
      aspectWidth: product.value.naturalWidth || product.value.width,
      aspectHeight: product.value.naturalHeight || product.value.height,
      ratio: ratioOf(product.value),
      model: props.model,
      resolution: props.resolution,
    })),
  })
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ccp-backdrop" @click.self="emit('close')">
      <section class="ccp-panel" role="dialog" aria-modal="true" aria-label="画布创作">
        <header>
          <div>
            <h2>画布创作</h2>
            <p>从当前画布素材生成可继续编辑和组合的创意结果。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <nav class="ccp-tabs" aria-label="创作类型">
          <button type="button" :class="{ active: tab === 'main' }" @click="tab = 'main'">
            主图生成
          </button>
          <button type="button" :class="{ active: tab === 'demand' }" @click="tab = 'demand'">
            需求生成
          </button>
        </nav>

        <template v-if="tab === 'main'">
          <div class="ccp-mode-grid">
            <label :class="{ active: mode === 'layout' }">
              <input v-model="mode" type="radio" value="layout" />
              <b>同类目复刻</b>
              <span>借鉴参考图的版式、构图与视觉节奏，产品保持为你的商品。</span>
            </label>
            <label :class="{ active: mode === 'style' }">
              <input v-model="mode" type="radio" value="style" />
              <b>跨类目借风格</b>
              <span>保留产品真实外观，只迁移参考图的配色、光线和氛围。</span>
            </label>
          </div>

          <div class="ccp-selection">
            <div>
              <span>产品图</span>
              <figure v-if="product">
                <img :src="product.url" alt="" />
                <figcaption>{{ product.name || '产品图' }}</figcaption>
              </figure>
              <p v-else>请先在画布选中产品图。</p>
            </div>
            <div>
              <span>参考图 · {{ references.length }}</span>
              <div v-if="references.length" class="ccp-reference-list">
                <figure v-for="reference in references" :key="reference.id">
                  <img :src="reference.url" alt="" />
                  <figcaption>{{ reference.name || '参考图' }}</figcaption>
                </figure>
              </div>
              <p v-else>按住 Command/Control 再选一张或多张参考图。</p>
            </div>
          </div>

          <label class="ccp-extra">
            <span>
              补充要求
              <small>可选</small>
            </span>
            <textarea
              v-model="extra"
              rows="3"
              placeholder="例如：主标题保留“清凉一夏”，整体更轻盈，减少促销元素"
            />
          </label>
        </template>

        <template v-else>
          <div class="ccp-demand-input">
            <div class="ccp-product-thumb">
              <span>产品图</span>
              <figure v-if="product">
                <img :src="product.url" alt="" />
                <figcaption>{{ product.name || '产品图' }}</figcaption>
              </figure>
              <p v-else>请先在画布选中一张产品图。</p>
            </div>
            <div class="ccp-demand-fields">
              <label>
                <span>产品信息</span>
                <textarea
                  v-model="demandProductInfo"
                  rows="4"
                  placeholder="填写品类、材质、功能、卖点、适用人群和使用场景。只写已经确认的信息。"
                />
              </label>
              <div>
                <label>
                  <span>方向数量</span>
                  <select v-model="demandCount">
                    <option :value="3">3 个</option>
                    <option :value="6">6 个</option>
                    <option :value="9">9 个</option>
                    <option :value="12">12 个</option>
                  </select>
                </label>
                <label>
                  <span>整体风格</span>
                  <input v-model="demandStyle" type="text" />
                </label>
                <button type="button" :disabled="!canPlanDemands" @click="planDemands">
                  {{
                    demandPlanning
                      ? '正在生成方向…'
                      : demandCards.length
                        ? '重新生成方向'
                        : '生成需求方向'
                  }}
                </button>
              </div>
              <p v-if="demandError" class="ccp-error">{{ demandError }}</p>
            </div>
          </div>

          <div v-if="demandCards.length" class="ccp-demand-cards">
            <label
              v-for="card in demandCards"
              :key="card.id"
              class="ccp-demand-card"
              :class="{ selected: card.selected }"
            >
              <input v-model="card.selected" type="checkbox" />
              <span class="ccp-dimension">{{ card.dimension }}</span>
              <input v-model="card.title" class="ccp-card-title" type="text" />
              <textarea v-model="card.copy" rows="2" aria-label="画面文案" />
              <textarea v-model="card.visualDirection" rows="3" aria-label="视觉方向" />
              <small>{{ card.audience }} · {{ card.scene }}</small>
            </label>
          </div>
          <div v-else class="ccp-demand-empty">
            <i class="ri-lightbulb-flash-line"></i>
            <b>从人群、场景、需求三个维度拆分创意</b>
            <span>生成后可以逐张选择并修改标题、画面文案和视觉方向。</span>
          </div>
        </template>

        <footer>
          <span v-if="tab === 'main'">
            {{ model }} · {{ resolution }} · {{ references.length || 0 }} 张结果
          </span>
          <span v-else>
            {{ model }} · {{ resolution }} · 已选择 {{ selectedDemandCards.length }} 个方向
          </span>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
          <button
            v-if="tab === 'main'"
            type="button"
            class="primary"
            :disabled="!canRunMain"
            @click="runMainImages"
          >
            {{ busy ? '正在提交…' : '开始生成' }}
          </button>
          <button
            v-else
            type="button"
            class="primary"
            :disabled="!canRunDemands"
            @click="runDemands"
          >
            {{ busy ? '正在提交…' : `生成 ${selectedDemandCards.length} 张创意` }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ccp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10030;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.52);
  backdrop-filter: blur(5px);
}
.ccp-panel {
  width: min(900px, 96vw);
  max-height: 90vh;
  overflow: auto;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 18px;
  background: #fff;
  color: #172033;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.24);
}
.ccp-panel > header,
.ccp-panel > footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
}
.ccp-panel > header {
  justify-content: space-between;
  border-bottom: 1px solid #edf0f5;
}
.ccp-panel h2 {
  margin: 0;
  font-size: 18px;
}
.ccp-panel header p {
  margin: 4px 0 0;
  color: #737b8c;
  font-size: 12px;
}
.ccp-panel header button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: #f3f5f8;
  color: #5d6575;
  font-size: 22px;
  cursor: pointer;
}
.ccp-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 20px 0;
}
.ccp-tabs button {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #737b8c;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.ccp-tabs button.active {
  background: #f0efff;
  color: #5b50d6;
}
.ccp-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 18px 20px 8px;
}
.ccp-mode-grid label {
  position: relative;
  display: flex;
  min-height: 84px;
  flex-direction: column;
  gap: 5px;
  padding: 13px 14px 13px 40px;
  border: 1px solid #dfe3ea;
  border-radius: 13px;
  cursor: pointer;
}
.ccp-mode-grid label.active {
  border-color: #6458e8;
  background: #f7f6ff;
  box-shadow: 0 0 0 2px rgba(100, 88, 232, 0.1);
}
.ccp-mode-grid input {
  position: absolute;
  top: 15px;
  left: 14px;
}
.ccp-mode-grid b {
  font-size: 14px;
}
.ccp-mode-grid span,
.ccp-selection p {
  margin: 0;
  color: #7b8290;
  font-size: 12px;
  line-height: 1.5;
}
.ccp-selection {
  display: grid;
  grid-template-columns: 1fr 1.5fr;
  gap: 14px;
  padding: 12px 20px;
}
.ccp-selection > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid #e5e8ee;
  border-radius: 12px;
  background: #fafbfc;
}
.ccp-selection > div > span,
.ccp-extra > span {
  display: block;
  margin-bottom: 9px;
  color: #4f5665;
  font-size: 12px;
  font-weight: 700;
}
.ccp-reference-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.ccp-selection figure {
  width: 96px;
  flex: 0 0 96px;
  margin: 0;
}
.ccp-selection img {
  width: 96px;
  height: 96px;
  border-radius: 9px;
  background: #eef1f5;
  object-fit: cover;
}
.ccp-selection figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: #727a89;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-extra {
  display: block;
  padding: 8px 20px 18px;
}
.ccp-extra small {
  color: #9aa1ae;
  font-weight: 400;
}
.ccp-extra textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid #dfe3ea;
  border-radius: 11px;
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.ccp-demand-input {
  display: grid;
  grid-template-columns: 142px 1fr;
  gap: 16px;
  padding: 18px 20px 12px;
}
.ccp-product-thumb,
.ccp-demand-fields {
  min-width: 0;
}
.ccp-product-thumb > span,
.ccp-demand-fields label > span {
  display: block;
  margin-bottom: 7px;
  color: #4f5665;
  font-size: 12px;
  font-weight: 700;
}
.ccp-product-thumb figure {
  width: 126px;
  margin: 0;
}
.ccp-product-thumb img {
  width: 126px;
  height: 126px;
  border-radius: 12px;
  background: #eef1f5;
  object-fit: cover;
}
.ccp-product-thumb figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: #727a89;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-product-thumb p,
.ccp-error {
  margin: 0;
  color: #d14343;
  font-size: 12px;
  line-height: 1.5;
}
.ccp-demand-fields textarea,
.ccp-demand-fields input,
.ccp-demand-fields select,
.ccp-demand-card textarea,
.ccp-card-title {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #dfe3ea;
  border-radius: 9px;
  background: #fff;
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.ccp-demand-fields textarea,
.ccp-demand-card textarea {
  resize: vertical;
  padding: 9px 10px;
  line-height: 1.45;
}
.ccp-demand-fields > div {
  display: grid;
  grid-template-columns: 110px minmax(180px, 1fr) auto;
  gap: 9px;
  align-items: end;
  margin-top: 9px;
}
.ccp-demand-fields input,
.ccp-demand-fields select {
  height: 36px;
  padding: 0 9px;
}
.ccp-demand-fields button {
  height: 36px;
  padding: 0 14px;
  border: 1px solid #6458e8;
  border-radius: 9px;
  background: #fff;
  color: #5b50d6;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ccp-demand-fields button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.ccp-error {
  margin-top: 8px;
}
.ccp-demand-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-height: 390px;
  overflow-y: auto;
  padding: 8px 20px 18px;
}
.ccp-demand-card {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  padding: 12px;
  border: 1px solid #dfe3ea;
  border-radius: 12px;
  background: #fafbfc;
}
.ccp-demand-card.selected {
  border-color: rgba(100, 88, 232, 0.65);
  background: #f8f7ff;
}
.ccp-demand-card > input[type='checkbox'] {
  position: absolute;
  top: 12px;
  right: 12px;
}
.ccp-dimension {
  align-self: flex-start;
  padding: 3px 7px;
  border-radius: 999px;
  background: #eceaff;
  color: #5b50d6;
  font-size: 10px;
  font-weight: 700;
}
.ccp-card-title {
  height: 34px;
  padding: 0 9px;
  font-weight: 700;
}
.ccp-demand-card small {
  overflow: hidden;
  color: #8a92a2;
  font-size: 10px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ccp-demand-empty {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  padding: 12px 20px 22px;
  color: #858d9c;
  text-align: center;
}
.ccp-demand-empty i {
  color: #6458e8;
  font-size: 34px;
}
.ccp-demand-empty b {
  color: #535b6c;
  font-size: 13px;
}
.ccp-demand-empty span {
  font-size: 11px;
}
.ccp-panel > footer {
  justify-content: flex-end;
  border-top: 1px solid #edf0f5;
  background: #fafbfc;
}
.ccp-panel footer > span {
  margin-right: auto;
  color: #7b8290;
  font-size: 11px;
}
.ccp-panel footer button {
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  cursor: pointer;
}
.ccp-panel footer .secondary {
  border: 1px solid #dfe3ea;
  background: #fff;
  color: #4d5564;
}
.ccp-panel footer .primary {
  border: 1px solid #6458e8;
  background: #6458e8;
  color: #fff;
  font-weight: 700;
}
.ccp-panel footer button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (max-width: 680px) {
  .ccp-mode-grid,
  .ccp-selection,
  .ccp-demand-input,
  .ccp-demand-cards,
  .ccp-demand-fields > div {
    grid-template-columns: 1fr;
  }
}
</style>

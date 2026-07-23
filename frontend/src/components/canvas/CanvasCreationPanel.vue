<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  selectedLayers: { type: Array, default: () => [] },
  model: { type: String, default: '' },
  resolution: { type: String, default: '2K' },
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'run'])
const mode = ref('layout')
const extra = ref('')

const product = computed(() => props.selectedLayers[0] || null)
const references = computed(() => props.selectedLayers.slice(1))
const canRun = computed(() => Boolean(product.value && references.value.length && !props.busy))

watch(
  () => props.open,
  (open) => {
    if (!open) extra.value = ''
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

function run() {
  if (!canRun.value) return
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
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="ccp-backdrop" @click.self="emit('close')">
      <section class="ccp-panel" role="dialog" aria-modal="true" aria-label="主图生成">
        <header>
          <div>
            <h2>主图生成</h2>
            <p>第一张为产品图，其余图片作为参考图批量生成。</p>
          </div>
          <button type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>

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

        <footer>
          <span>{{ model }} · {{ resolution }} · {{ references.length || 0 }} 张结果</span>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
          <button type="button" class="primary" :disabled="!canRun" @click="run">
            {{ busy ? '正在提交…' : '开始生成' }}
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
  width: min(760px, 96vw);
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
  .ccp-selection {
    grid-template-columns: 1fr;
  }
}
</style>

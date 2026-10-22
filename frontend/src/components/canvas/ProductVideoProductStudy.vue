<script setup>
import { computed } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import {
  productStudyConfirmationIssue,
  productStudySource,
  selectedSellingPoints,
} from '../../utils/productVideoProductAnalysis.js'
const props = defineProps({
  study: { type: Object, required: true },
  model: { type: String, default: 'default' },
  models: { type: Array, default: () => [] },
  running: Boolean,
  uploading: Boolean,
  unavailable: Boolean,
  supported: Boolean,
  planning: Boolean,
})
const emit = defineEmits([
  'edit',
  'model',
  'upload',
  'canvas',
  'products',
  'analyze',
  'retry',
  'confirm',
  'reference',
])
const selected = computed(() => selectedSellingPoints(props.study).length)
const issue = computed(() => productStudyConfirmationIssue(props.study))
const waiting = computed(() => props.running || props.study?.job?.status === 'unknown')
const stale = computed(
  () =>
    props.study?.result && props.study.result.sourceFingerprint !== productStudySource(props.study),
)
function editPoint(id, key, value) {
  emit('edit', (study) => {
    const point = study.result.sellingPoints.find((item) => item.id === id)
    if (point) point[key] = value
  })
}
function evidenceNames(point) {
  return (point.imageIndices || [])
    .map((index) => props.study.result.materials?.[index - 1]?.name || `资料图 ${index}`)
    .join('、')
}
function addPoint() {
  emit('edit', (study) => {
    study.result.sellingPoints.push({
      id: `manual-${Date.now()}-${Math.random()}`,
      title: '',
      description: '',
      evidence: '用户补充',
      imageIndices: [],
      selected: true,
    })
  })
}
</script>

<template>
  <main class="study-layout">
    <section class="study-materials">
      <h3>
        商品资料图
        <small>{{ study.materials.length }}/12</small>
      </h3>
      <p class="study-hint">
        添加五张商品主图或详情页图片，让策划模型读取文案、参数与卖点。这组图片仅用于分析；视频画面参考图在下一步单独添加。
      </p>
      <div class="study-actions">
        <button class="study-primary" :disabled="uploading" @click="emit('upload')">
          {{ uploading ? '上传中…' : '本地上传' }}
        </button>
        <button @click="emit('canvas')">画布图片</button>
        <button @click="emit('products')">选品库</button>
      </div>
      <div class="study-grid">
        <figure v-for="(item, index) in study.materials" :key="item.id">
          <img :src="item.url" :alt="item.name || `资料图 ${index + 1}`" />
          <figcaption>
            <span :title="item.name">{{ index + 1 }}. {{ item.name || '商品资料图' }}</span>
            <button
              :aria-label="`移除资料图 ${index + 1}`"
              @click="
                emit('edit', (value) => {
                  value.materials = value.materials.filter((image) => image.id !== item.id)
                })
              "
            >
              ×
            </button>
          </figcaption>
        </figure>
        <button
          v-if="!study.materials.length"
          class="study-empty"
          :disabled="uploading"
          @click="emit('upload')"
        >
          <i class="ri-image-add-line" aria-hidden="true"></i>
          添加主图或详情页资料图
        </button>
      </div>
      <button class="study-text" @click="emit('reference')">改用参考视频复刻 →</button>
    </section>
    <section class="study-result">
      <h3>分析商品卖点</h3>
      <label>
        策划模型
        <ThemedSelect
          :model-value="model"
          :options="models"
          aria-label="商品分析策划模型"
          :disabled="running || planning"
          @update:model-value="emit('model', $event)"
        />
      </label>
      <label>
        商品补充说明（选填）
        <textarea
          :value="study.notes"
          maxlength="5000"
          rows="3"
          placeholder="可补充商品名称、资料中不易辨认的参数或需要重点分析的内容"
          @input="
            emit('edit', (value) => {
              value.notes = $event.target.value
            })
          "
        ></textarea>
      </label>
      <div class="study-actions">
        <button
          class="study-primary"
          :disabled="
            waiting || planning || uploading || unavailable || !supported || !study.materials.length
          "
          @click="emit('analyze')"
        >
          {{ running ? '正在分析商品资料…' : study.result ? '更新卖点分析' : '分析商品卖点' }}
        </button>
        <small v-if="!supported">服务连接后可分析</small>
      </div>
      <div v-if="study.job" class="study-progress" role="status">
        <strong>{{ study.job.status === 'failed' ? '商品分析未完成' : study.job.stage }}</strong>
        <p v-if="study.job.error || study.job.pollError">
          {{ study.job.error || study.job.pollError }}
        </p>
        <button
          v-if="['failed', 'unknown'].includes(study.job.status)"
          :disabled="running || planning"
          @click="emit('retry')"
        >
          {{ study.job.status === 'unknown' ? '确认提交状态' : '继续商品分析' }}
        </button>
      </div>
      <template v-if="study.result">
        <p v-if="stale" class="study-warning">
          商品资料已修改，下面保留的是上一次结果。请更新分析后确认。
        </p>
        <label>
          商品名称
          <input
            :value="study.result.productName"
            @input="
              emit('edit', (value) => {
                value.result.productName = $event.target.value
              })
            "
          />
        </label>
        <p v-if="study.result.summary" class="study-hint">{{ study.result.summary }}</p>
        <h3>
          选择本次视频卖点
          <small>已选 {{ selected }} 项</small>
        </h3>
        <article
          v-for="point in study.result.sellingPoints"
          :key="point.id"
          :class="['study-point', { selected: point.selected !== false }]"
        >
          <label class="study-point-head">
            <input
              type="checkbox"
              :checked="point.selected !== false"
              :aria-label="`选择卖点：${point.title || '未命名'}`"
              @change="editPoint(point.id, 'selected', $event.target.checked)"
            />
            <input
              :value="point.title"
              aria-label="卖点标题"
              placeholder="卖点标题"
              @input="editPoint(point.id, 'title', $event.target.value)"
            />
          </label>
          <textarea
            :value="point.description"
            rows="2"
            aria-label="卖点说明"
            placeholder="具体的商品事实和体验"
            @input="editPoint(point.id, 'description', $event.target.value)"
          ></textarea>
          <p class="study-evidence">
            {{ evidenceNames(point) }}{{ evidenceNames(point) && point.evidence ? ' · ' : ''
            }}{{ point.evidence }}
          </p>
        </article>
        <button class="study-text" @click="addPoint">＋ 补充一个卖点</button>
        <div v-if="study.result.questions?.length" class="study-questions">
          <strong>待核对的信息</strong>
          <p v-for="question in study.result.questions" :key="question">{{ question }}</p>
        </div>
        <p v-if="issue" class="study-hint">{{ issue }}</p>
        <div class="study-actions">
          <button
            class="study-primary"
            :disabled="!!issue || waiting || planning || uploading"
            @click="emit('confirm')"
          >
            确认卖点，添加视频参考图 →
          </button>
        </div>
        <p class="study-hint">
          资料、分析结果与确认的卖点会随任务保存，可用于后续换场景或重新策划。
        </p>
      </template>
      <p v-else class="study-hint">分析完成后可编辑卖点，并勾选本次视频需要展示的内容。</p>
    </section>
  </main>
</template>

<style scoped>
.study-layout {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: 1fr 1fr;
  color: var(--canvas-text);
}
.study-layout > section {
  padding: 24px;
  min-width: 0;
}
.study-materials {
  border-right: 1px solid var(--canvas-border);
}
h3 {
  font-size: 14px;
  margin: 0 0 14px;
}
small {
  font-weight: 400;
  color: var(--canvas-text-muted);
}
.study-hint,
.study-evidence,
.study-questions p {
  color: var(--canvas-text-muted);
  font-size: 12px;
  line-height: 1.7;
  margin: 8px 0 16px;
}
button,
input,
textarea {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--canvas-border);
  background: var(--canvas-panel);
  border-radius: 6px;
  padding: 8px 12px;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.study-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 14px 0;
  flex-wrap: wrap;
}
.study-primary {
  background: var(--canvas-accent);
  color: #fff;
  border-color: transparent;
}
.study-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
figure {
  margin: 0;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  overflow: hidden;
}
figure img {
  width: 100%;
  height: 180px;
  object-fit: contain;
  background: var(--canvas-bg);
}
figcaption {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  gap: 6px;
  font-size: 12px;
}
figcaption span {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
figcaption button {
  padding: 1px 5px;
}
.study-empty {
  grid-column: 1 / -1;
  min-height: 280px;
  border-style: dashed;
  display: grid;
  place-content: center;
  gap: 12px;
  color: var(--canvas-text-muted);
}
.study-empty i {
  font-size: 30px;
  text-align: center;
}
.study-result > label {
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: var(--canvas-text-muted);
  margin-bottom: 16px;
}
input:not([type='checkbox']),
textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-bg);
  outline: none;
  color: var(--canvas-text);
}
input:focus,
textarea:focus {
  border-color: var(--canvas-accent);
}
textarea {
  resize: vertical;
  line-height: 1.6;
}
.study-point {
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  padding: 12px;
  margin: 10px 0;
}
.study-point.selected {
  border-color: color-mix(in srgb, var(--canvas-accent) 55%, var(--canvas-border));
}
.study-point-head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
input[type='checkbox'] {
  accent-color: var(--canvas-accent);
}
.study-evidence {
  margin: 8px 0 0;
}
.study-text {
  border: none;
  color: var(--canvas-accent);
  background: transparent;
  padding-left: 0;
  margin-top: 10px;
}
.study-progress,
.study-questions {
  border: 1px solid var(--canvas-border);
  border-radius: 8px;
  padding: 12px;
  margin: 14px 0;
  font-size: 12px;
}
.study-progress p {
  line-height: 1.6;
}
.study-warning {
  font-size: 12px;
  color: #d18b39;
}
@media (max-width: 900px) {
  .study-layout {
    grid-template-columns: 1fr;
  }
  .study-materials {
    border-right: 0;
    border-bottom: 1px solid var(--canvas-border);
  }
}
</style>

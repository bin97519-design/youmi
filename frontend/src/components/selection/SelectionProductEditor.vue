<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  buildSelectionSkuMatrix,
  normalizeSelectionProduct,
  serializeSelectionProduct,
  uniqueUrls,
  videoUrls,
} from '../../utils/selectionProductFormat'

const props = defineProps({
  product: { type: Object, required: true },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'save'])

const form = reactive(normalizeSelectionProduct(props.product))
const assetInputs = reactive({ main: '', portrait: '', detail: '' })
const editorNotice = ref('')

const assetSections = [
  {
    key: 'main',
    listKey: 'mainImages',
    title: '主图（1:1 目标组）',
    help: '保存来源原图，不会在入库时强制裁切。',
    placeholder: '粘贴主图链接，可一次粘贴多条',
    addLabel: '添加主图',
    limit: 20,
  },
  {
    key: 'portrait',
    listKey: 'portraitImages',
    title: '3:4 主图',
    help: '用于移动端商品展示，并保留原始比例。',
    placeholder: '粘贴 3:4 图片链接，可一次粘贴多条',
    addLabel: '添加 3:4 图',
    limit: 20,
  },
  {
    key: 'detail',
    listKey: 'detailImages',
    title: '详情图片',
    help: '按当前顺序用于商品详情页。',
    placeholder: '粘贴详情图片链接，可一次粘贴多条',
    addLabel: '添加详情图',
    limit: 500,
  },
]

const platformLabels = {
  TAOBAO: '淘宝',
  TMALL: '天猫',
  1688: '1688',
  DOUYIN: '抖音',
  JD: '京东',
  LOCAL: '自定义',
}

const skuImages = computed(() =>
  uniqueUrls(form.skuGroups.flatMap((group) => group.values?.map((value) => value.imageUrl) || [])),
)
const mainVideoCount = computed(
  () => videoUrls(String(form.mainVideoUrls || '').split(/\r?\n/)).length,
)
const detailVideoCount = computed(
  () => videoUrls(String(form.detailVideoUrls || '').split(/\r?\n/)).length,
)
const readiness = computed(() => {
  const errors = []
  const warnings = []
  if (!form.title.trim()) errors.push('缺少商品标题')
  if (!form.mainImages.length) errors.push('至少需要 1 张主图')
  if (!form.price && !form.skus.some((sku) => Number(sku.price) > 0)) errors.push('缺少销售价')
  if (form.skuGroups.length && !form.skus.length) errors.push('规格已建立，但尚未生成 SKU 组合')
  if (!form.category.id && !form.category.name && !form.category.path) {
    warnings.push('未填写类目，发布时需要人工选择')
  }
  return { ready: !errors.length, errors, warnings }
})

watch(
  () => props.product,
  (product) => {
    Object.assign(form, normalizeSelectionProduct(product))
    Object.assign(assetInputs, { main: '', portrait: '', detail: '' })
    editorNotice.value = ''
  },
  { deep: false },
)

function platformName(value) {
  return platformLabels[String(value || '').toUpperCase()] || value || '--'
}

function addImages(section) {
  const candidates = String(assetInputs[section.key] || '')
    .split(/[\s,，]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const invalidCount = candidates.filter((value) => !/^https?:\/\//i.test(value)).length
  const valid = candidates.filter((value) => /^https?:\/\//i.test(value))
  form[section.listKey] = uniqueUrls([...form[section.listKey], ...valid]).slice(0, section.limit)
  assetInputs[section.key] = ''
  editorNotice.value = invalidCount ? `已忽略 ${invalidCount} 个无效图片地址` : ''
}

function removeImage(listKey, index) {
  form[listKey].splice(index, 1)
}

function addAttribute() {
  form.attributes.push({ name: '', value: '' })
}

function addSkuGroup() {
  form.skuGroups.push({
    propertyId: `custom_${Date.now()}_${form.skuGroups.length + 1}`,
    name: '',
    values: [],
  })
}

function addSkuValue(group, groupIndex) {
  group.values ||= []
  group.values.push({
    valueId: `${group.propertyId || `custom_${groupIndex + 1}`}_${Date.now()}`,
    name: '',
    imageUrl: '',
  })
}

function rebuildSkuMatrix() {
  const incomplete = form.skuGroups.some(
    (group) =>
      !String(group.name || '').trim() ||
      !group.values?.length ||
      group.values.some((value) => !String(value.name || '').trim()),
  )
  if (incomplete) {
    editorNotice.value = '请先填写完整的规格组名称和规格值'
    return
  }
  try {
    form.skus = buildSelectionSkuMatrix(form.skuGroups, form.skus, {
      price: form.price,
      originalPrice: form.originalPrice,
      defaultStock: form.defaultStock,
    })
    editorNotice.value = `已生成 ${form.skus.length} 个 SKU 组合`
  } catch (error) {
    editorNotice.value = error?.message || 'SKU 组合生成失败'
  }
}

function submit(afterSave = 'close') {
  if (!form.title.trim()) {
    editorNotice.value = '请填写商品标题'
    return
  }
  emit('save', { payload: serializeSelectionProduct(form), afterSave })
}
</script>

<template>
  <div class="editor-backdrop" @mousedown.self="emit('close')">
    <section
      class="product-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-editor-title"
    >
      <header class="editor-header">
        <div>
          <span>PRODUCT EDITOR</span>
          <h2 id="product-editor-title">编辑商品资料</h2>
          <p>{{ product.title }}</p>
        </div>
        <button type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          <i class="ri-close-line"></i>
        </button>
      </header>

      <div v-if="loading" class="editor-loading">
        <i class="ri-loader-4-line spinning"></i>
        正在读取完整商品资料
      </div>

      <form v-else class="editor-form" @submit.prevent="submit('close')">
        <div class="editor-scroll">
          <section class="basic-fields">
            <label>
              <span>来源平台</span>
              <input :value="platformName(form.sourcePlatform)" readonly />
            </label>
            <label>
              <span>来源商品 ID</span>
              <input :value="form.sourceProductId" readonly />
            </label>
            <label class="wide-field">
              <span>商品标题 *</span>
              <input v-model="form.title" required />
            </label>
            <label class="wide-field">
              <span>原商品链接</span>
              <input v-model="form.sourceUrl" type="url" />
            </label>
            <label>
              <span>类目名称</span>
              <input v-model="form.category.name" placeholder="例如：成品窗帘" />
            </label>
            <label>
              <span>类目 ID（可选）</span>
              <input v-model="form.category.id" />
            </label>
            <label class="wide-field">
              <span>类目路径</span>
              <input
                v-model="form.category.path"
                placeholder="例如：家居布艺 > 窗帘门帘及配件 > 成品窗帘"
              />
              <small>保存来源类目路径，搬家时优先按该类目进入发布页。</small>
            </label>
            <label>
              <span>销售价</span>
              <input v-model="form.price" inputmode="decimal" />
            </label>
            <label>
              <span>原价</span>
              <input v-model="form.originalPrice" inputmode="decimal" />
            </label>
            <label>
              <span>默认库存</span>
              <input v-model.number="form.defaultStock" type="number" min="0" step="1" />
            </label>
          </section>

          <div class="readiness" :class="{ ready: readiness.ready }">
            <i :class="readiness.ready ? 'ri-checkbox-circle-line' : 'ri-information-line'"></i>
            <span v-if="readiness.ready">
              资料可以继续加工：{{ form.mainImages.length }} 张主图 ·
              {{ form.skuGroups.length }} 组规格 · {{ form.skus.length }} 个 SKU
              <small v-if="readiness.warnings.length">{{ readiness.warnings.join('；') }}</small>
            </span>
            <span v-else>{{ readiness.errors.join('；') }}</span>
          </div>

          <div class="asset-summary" aria-label="商品素材统计">
            <span>
              <strong>{{ form.mainImages.length }}</strong>
              主图
            </span>
            <span>
              <strong>{{ form.portraitImages.length }}</strong>
              3:4 图
            </span>
            <span>
              <strong>{{ skuImages.length }}</strong>
              SKU 图
            </span>
            <span>
              <strong>{{ form.detailImages.length }}</strong>
              详情图
            </span>
            <span>
              <strong>{{ mainVideoCount + detailVideoCount }}</strong>
              视频
            </span>
            <span>{{ form.skuGroups.length }} 个规格组 · {{ form.skus.length }} 个 SKU 组合</span>
          </div>

          <section class="editor-section">
            <div class="section-heading">
              <div>
                <h3>商品属性</h3>
                <p>来自采集商品的基础属性，可在搬家前修正。</p>
              </div>
              <button type="button" @click="addAttribute">
                <i class="ri-add-line"></i>
                添加属性
              </button>
            </div>
            <div class="attribute-grid">
              <div v-for="(attribute, index) in form.attributes" :key="index" class="attribute-row">
                <input v-model="attribute.name" aria-label="属性名" placeholder="属性名" />
                <input v-model="attribute.value" aria-label="属性值" placeholder="属性值" />
                <button type="button" title="删除属性" @click="form.attributes.splice(index, 1)">
                  <i class="ri-close-line"></i>
                </button>
              </div>
              <span v-if="!form.attributes.length" class="empty-state">暂无商品属性</span>
            </div>
          </section>

          <section
            v-for="section in assetSections"
            :key="section.key"
            class="editor-section asset-section"
          >
            <div class="section-heading">
              <div>
                <h3>{{ section.title }}</h3>
                <p>{{ section.help }}</p>
              </div>
              <strong>{{ form[section.listKey].length }} 张</strong>
            </div>
            <div class="asset-add-row">
              <textarea
                v-model="assetInputs[section.key]"
                rows="2"
                :placeholder="section.placeholder"
              ></textarea>
              <button type="button" @click="addImages(section)">
                <i class="ri-add-line"></i>
                {{ section.addLabel }}
              </button>
            </div>
            <div class="asset-grid" :class="{ detail: section.key === 'detail' }">
              <figure v-for="(url, index) in form[section.listKey]" :key="`${url}-${index}`">
                <a
                  :href="url"
                  target="_blank"
                  rel="noreferrer"
                  :title="`打开第 ${index + 1} 张图片`"
                >
                  <img
                    :src="url"
                    :alt="`${section.title} ${index + 1}`"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                </a>
                <span>{{ index + 1 }}</span>
                <button
                  type="button"
                  :title="`删除第 ${index + 1} 张图片`"
                  @click="removeImage(section.listKey, index)"
                >
                  <i class="ri-close-line"></i>
                </button>
              </figure>
              <span v-if="!form[section.listKey].length" class="empty-state">暂无图片</span>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-heading">
              <div>
                <h3>商品视频</h3>
                <p>每行填写一个视频地址。</p>
              </div>
              <strong>{{ mainVideoCount + detailVideoCount }} 个</strong>
            </div>
            <div class="video-fields">
              <label>
                <span>主图视频</span>
                <textarea
                  v-model="form.mainVideoUrls"
                  rows="3"
                  placeholder="每行一个主图视频地址"
                ></textarea>
              </label>
              <label>
                <span>详情视频</span>
                <textarea
                  v-model="form.detailVideoUrls"
                  rows="3"
                  placeholder="每行一个详情视频地址"
                ></textarea>
              </label>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-heading">
              <div>
                <h3>SKU 图片</h3>
                <p>图片与规格值保持绑定，可在下方规格值中修改。</p>
              </div>
              <strong>{{ skuImages.length }} 张</strong>
            </div>
            <div class="asset-grid">
              <figure v-for="(url, index) in skuImages" :key="url">
                <a :href="url" target="_blank" rel="noreferrer">
                  <img
                    :src="url"
                    :alt="`SKU 图片 ${index + 1}`"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                  />
                </a>
                <span>{{ index + 1 }}</span>
              </figure>
              <span v-if="!skuImages.length" class="empty-state">暂无 SKU 图片</span>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-heading">
              <div>
                <h3>SKU 规格</h3>
                <p>修改规格后点击“重新生成组合”，已有价格和库存会尽量保留。</p>
              </div>
              <div class="section-actions">
                <button type="button" @click="rebuildSkuMatrix">
                  <i class="ri-refresh-line"></i>
                  重新生成组合
                </button>
                <button type="button" @click="addSkuGroup">
                  <i class="ri-add-line"></i>
                  添加规格组
                </button>
              </div>
            </div>
            <div class="sku-groups">
              <div
                v-for="(group, groupIndex) in form.skuGroups"
                :key="group.propertyId"
                class="sku-group"
              >
                <div class="sku-group-head">
                  <input v-model="group.name" aria-label="规格组名称" placeholder="规格组名称" />
                  <small>属性 ID：{{ group.propertyId || '--' }}</small>
                  <button type="button" @click="addSkuValue(group, groupIndex)">
                    <i class="ri-add-line"></i>
                    规格值
                  </button>
                  <button
                    type="button"
                    title="删除规格组"
                    @click="form.skuGroups.splice(groupIndex, 1)"
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
                <div class="sku-values">
                  <div
                    v-for="(value, valueIndex) in group.values"
                    :key="value.valueId"
                    class="sku-value"
                  >
                    <img
                      v-if="value.imageUrl"
                      :src="value.imageUrl"
                      alt=""
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />
                    <span v-else>无图</span>
                    <input v-model="value.name" aria-label="规格值" placeholder="规格值" />
                    <input
                      v-model="value.imageUrl"
                      aria-label="SKU 图片地址"
                      placeholder="SKU 图片链接（可选）"
                    />
                    <button
                      type="button"
                      title="删除规格值"
                      @click="group.values.splice(valueIndex, 1)"
                    >
                      <i class="ri-close-line"></i>
                    </button>
                  </div>
                </div>
              </div>
              <span v-if="!form.skuGroups.length" class="empty-state">暂无 SKU 规格组</span>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-heading">
              <div>
                <h3>SKU 组合</h3>
                <p>{{ form.skus.length }} 个组合，可编辑编码、价格和库存。</p>
              </div>
            </div>
            <div class="sku-table-wrap">
              <table v-if="form.skus.length">
                <thead>
                  <tr>
                    <th>规格组合</th>
                    <th>SKU 编码</th>
                    <th>销售价</th>
                    <th>原价</th>
                    <th>库存</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(sku, index) in form.skus" :key="sku.propPath || sku.skuId || index">
                    <td :title="sku.name">{{ sku.name || sku.propPath || `SKU ${index + 1}` }}</td>
                    <td><input v-model="sku.skuId" aria-label="SKU 编码" /></td>
                    <td><input v-model="sku.price" aria-label="销售价" inputmode="decimal" /></td>
                    <td>
                      <input v-model="sku.originalPrice" aria-label="原价" inputmode="decimal" />
                    </td>
                    <td>
                      <input
                        v-model.number="sku.quantity"
                        aria-label="库存"
                        type="number"
                        min="0"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <span v-else class="empty-state">暂无 SKU 组合数据</span>
            </div>
          </section>

          <label class="description-field">
            <span>商品描述</span>
            <textarea v-model="form.description" rows="5"></textarea>
          </label>
        </div>

        <footer class="editor-footer">
          <span :class="{ error: editorNotice && !editorNotice.startsWith('已') }">
            {{ editorNotice }}
          </span>
          <button type="button" @click="emit('close')">取消</button>
          <button class="primary" type="submit" :disabled="saving">
            {{ saving ? '保存中' : '保存商品' }}
          </button>
          <button class="primary" type="button" :disabled="saving" @click="submit('canvas')">
            保存并去画布加工
            <i class="ri-arrow-right-line"></i>
          </button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.editor-backdrop {
  position: fixed;
  z-index: 250;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 8, 14, 0.58);
  backdrop-filter: blur(8px);
}

.product-editor {
  display: flex;
  width: min(1380px, calc(100vw - 32px));
  height: calc(100vh - 32px);
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--canvas-border-strong);
  border-radius: 8px;
  color: var(--canvas-text);
  background: var(--canvas-panel);
  box-shadow: var(--canvas-panel-shadow);
  font-size: 13px;
}

button,
input,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.editor-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--canvas-border);
  background: var(--canvas-panel);
}

.editor-header span {
  color: var(--canvas-accent);
  font-size: 11px;
  font-weight: 600;
}

.editor-header h2 {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
}

.editor-header p {
  max-width: 900px;
  overflow: hidden;
  margin: 5px 0 0;
  color: var(--canvas-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-header button,
.attribute-row button,
.asset-grid figure > button,
.sku-group-head button,
.sku-value button {
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  flex: 0 0 auto;
  padding: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}

.editor-header button:hover,
.attribute-row button:hover,
.asset-grid figure > button:hover,
.sku-group-head button:last-child:hover,
.sku-value button:hover {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.36);
  background: rgba(239, 68, 68, 0.1);
}

.editor-loading {
  display: grid;
  min-height: 320px;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--canvas-text-muted);
}

.editor-form {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.editor-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 20px 22px 28px;
}

.basic-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

label {
  display: grid;
  gap: 6px;
  color: var(--canvas-text-muted);
}

label > span,
.video-fields label > span {
  font-size: 12px;
}

.wide-field {
  grid-column: 1 / -1;
}

input,
textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  outline: none;
  color: var(--canvas-text);
  background: var(--canvas-input);
  transition: 140ms ease;
}

input {
  height: 36px;
  padding: 0 10px;
}

textarea {
  min-height: 70px;
  padding: 9px 10px;
  line-height: 1.55;
  resize: vertical;
}

input:focus,
textarea:focus {
  border-color: var(--canvas-accent-border);
  box-shadow: 0 0 0 3px var(--canvas-accent-soft);
}

input[readonly] {
  color: var(--canvas-text-subtle);
  background: var(--canvas-surface);
}

label small {
  color: var(--canvas-text-subtle);
  line-height: 1.45;
}

.readiness {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 16px;
  padding: 11px 12px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 7px;
  color: #d97706;
  background: rgba(245, 158, 11, 0.08);
}

.readiness.ready {
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.28);
  background: rgba(16, 185, 129, 0.08);
}

.readiness span {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.readiness small {
  color: var(--canvas-text-subtle);
}

.asset-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0 4px;
}

.asset-summary span {
  padding: 5px 9px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 999px;
  color: var(--canvas-text-muted);
  background: var(--canvas-accent-soft);
  font-size: 12px;
}

.asset-summary strong {
  color: var(--canvas-accent);
}

.editor-section,
.description-field {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--canvas-border);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-heading h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.section-heading p {
  margin: 4px 0 0;
  color: var(--canvas-text-subtle);
  font-size: 12px;
}

.section-heading > strong {
  color: var(--canvas-accent);
  font-size: 12px;
}

.section-heading button,
.asset-add-row button,
.editor-footer button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 11px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  color: var(--canvas-text-muted);
  background: var(--canvas-surface);
}

.section-heading button:hover,
.asset-add-row button:hover,
.editor-footer button:hover {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}

.section-actions {
  display: flex;
  gap: 8px;
}

.attribute-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.attribute-row {
  display: grid;
  grid-template-columns: minmax(110px, 0.7fr) minmax(160px, 1.3fr) 30px;
  gap: 7px;
}

.asset-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: stretch;
  gap: 8px;
}

.asset-add-row button {
  min-width: 112px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
  gap: 9px;
  margin-top: 10px;
}

.asset-grid.detail {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}

.asset-grid figure {
  position: relative;
  min-width: 0;
  aspect-ratio: 1;
  overflow: hidden;
  margin: 0;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-surface);
}

.asset-grid.detail figure {
  aspect-ratio: 3 / 4;
}

.asset-grid a,
.asset-grid img {
  display: block;
  width: 100%;
  height: 100%;
}

.asset-grid img {
  object-fit: contain;
}

.asset-grid figure > span {
  position: absolute;
  right: 5px;
  bottom: 5px;
  display: grid;
  min-width: 20px;
  height: 20px;
  place-items: center;
  padding: 0 5px;
  border-radius: 999px;
  color: #fff;
  background: rgba(15, 23, 42, 0.72);
  font-size: 10px;
}

.asset-grid figure > button {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 24px;
  height: 24px;
  color: #fff;
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(15, 23, 42, 0.72);
}

.video-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.sku-groups {
  display: grid;
  gap: 10px;
}

.sku-group {
  padding: 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 7px;
  background: var(--canvas-surface);
}

.sku-group-head {
  display: grid;
  grid-template-columns: minmax(160px, 320px) minmax(130px, 1fr) auto auto;
  align-items: center;
  gap: 8px;
}

.sku-group-head small {
  color: var(--canvas-text-subtle);
}

.sku-group-head button:nth-last-child(2) {
  display: inline-flex;
  width: auto;
  padding: 0 9px;
  color: var(--canvas-accent);
}

.sku-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 9px;
}

.sku-value {
  display: grid;
  grid-template-columns: 36px minmax(130px, 0.7fr) minmax(180px, 1.3fr) 30px;
  align-items: center;
  gap: 7px;
}

.sku-value > img,
.sku-value > span {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--canvas-border);
  border-radius: 5px;
  color: var(--canvas-text-subtle);
  object-fit: cover;
  font-size: 10px;
}

.sku-table-wrap {
  max-height: 390px;
  overflow: auto;
  border: 1px solid var(--canvas-border);
  border-radius: 7px;
}

.sku-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.sku-table-wrap th,
.sku-table-wrap td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--canvas-border);
  text-align: left;
}

.sku-table-wrap th {
  position: sticky;
  z-index: 1;
  top: 0;
  color: var(--canvas-text-subtle);
  background: var(--canvas-panel);
  font-size: 11px;
  font-weight: 600;
}

.sku-table-wrap th:first-child {
  width: 42%;
}

.sku-table-wrap td:first-child {
  overflow: hidden;
  color: var(--canvas-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  display: grid;
  min-height: 58px;
  place-items: center;
  color: var(--canvas-text-subtle);
}

.editor-footer {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--canvas-border);
  background: var(--canvas-panel);
}

.editor-footer > span {
  margin-right: auto;
  color: var(--canvas-accent);
}

.editor-footer > span.error {
  color: #ef4444;
}

.editor-footer button.primary {
  color: var(--canvas-button-text, #fff);
  border-color: var(--canvas-accent);
  background: var(--canvas-accent);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .editor-backdrop {
    padding: 0;
  }

  .product-editor {
    width: 100vw;
    height: 100vh;
    border: 0;
    border-radius: 0;
  }

  .basic-fields,
  .attribute-grid,
  .video-fields,
  .sku-values {
    grid-template-columns: 1fr;
  }

  .sku-group-head {
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .sku-group-head small {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .section-heading {
    align-items: flex-start;
  }

  .section-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .editor-footer > span {
    display: none;
  }
}
</style>

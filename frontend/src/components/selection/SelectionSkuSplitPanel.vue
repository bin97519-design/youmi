<script setup>
import { computed, ref, watch } from 'vue'
import { buildSelectionSkuSplit, previewSelectionSkuSplit } from '../../utils/selectionSkuSplit'

const props = defineProps({
  form: { type: Object, required: true },
  product: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' },
  syncError: { type: String, default: '' },
})
const emit = defineEmits(['split'])
const opened = ref(false),
  groupIndex = ref(0),
  firstCount = ref(1),
  notice = ref('')
const pending = ref(null)
const group = computed(() => props.form.skuGroups[groupIndex.value])
watch(
  () => [groupIndex.value, group.value?.values?.length],
  () => {
    firstCount.value = Math.max(1, Math.floor((group.value?.values?.length || 0) / 2))
  },
  { immediate: true },
)
const preview = computed(() => {
  if (pending.value) {
    return {
      parts: pending.value.map(({ productData }) => ({
        skuCount: productData.skus.length,
        groupName: productData.skuSplit.groupName,
        values: productData.skuSplit.valueNames.map((name) => ({ name })),
      })),
      error: '',
    }
  }
  try {
    if (props.syncError) throw new Error(props.syncError)
    return {
      parts: previewSelectionSkuSplit(props.form, groupIndex.value, firstCount.value),
      error: '',
    }
  } catch (error) {
    return { parts: [], error: error.message }
  }
})
function confirmSplit() {
  if (props.saving) return
  try {
    if (!pending.value && props.syncError) throw new Error(props.syncError)
    notice.value = ''
    pending.value ||= buildSelectionSkuSplit(
      props.form,
      props.product,
      groupIndex.value,
      firstCount.value,
      crypto.randomUUID(),
    )
    emit('split', { products: pending.value })
  } catch (error) {
    notice.value = error.message
  }
}
</script>

<template>
  <section class="split-panel">
    <div class="split-heading">
      <div>
        <h3>SKU 裂变 · 拆成两个商品</h3>
        <p>保留原商品，只拆规格和对应 SKU，其余资料相同。</p>
      </div>
      <button type="button" :disabled="saving" :aria-expanded="opened" @click="opened = !opened">
        {{ opened ? '收起设置' : '设置拆分' }}
      </button>
    </div>
    <div v-if="opened" class="split-content">
      <fieldset :disabled="saving || !!pending">
        <legend>选择一个拆分维度</legend>
        <div class="split-dimensions">
          <label v-for="(item, index) in form.skuGroups" :key="item.propertyId">
            <input
              v-model="groupIndex"
              type="radio"
              :value="index"
              :disabled="item.values.length < 2"
            />
            {{ item.name }} · {{ item.values.length }} 个值
          </label>
        </div>
        <label class="split-boundary">
          第一份保留前
          <input
            v-model.number="firstCount"
            type="text"
            inputmode="numeric"
            aria-label="第一份规格值数量"
            @keydown.enter.prevent="confirmSplit"
          />
          个{{ group?.name || '规格值' }}，其余放入第二份
        </label>
      </fieldset>
      <div class="split-previews">
        <article v-for="(part, index) in preview.parts" :key="index">
          <strong>
            第 {{ index + 1 }} 份
            <b>{{ part.skuCount }} SKU</b>
          </strong>
          <p>{{ part.groupName }} {{ part.values.length }} 个值 · 其他规格组不变</p>
          <div class="split-values">{{ part.values.map((value) => value.name).join('、') }}</div>
        </article>
      </div>
      <p class="split-help">
        按当前顺序分段，不丢弃或重新生成
        SKU。标题、属性、主图、详情、视频不变，价格库存及规格图随对应 SKU
        保留。使用当前编辑内容生成两份新商品，不覆盖原商品，也不自动创建搬家任务或发布。
      </p>
      <p class="split-help">
        拆分不代表一定符合拼多多类目限制，请确认每份 SKU 数量；需要时可对新商品继续拆分。
      </p>
      <p v-if="error || notice || preview.error" class="split-error" role="alert">
        {{ error || notice || preview.error }}
      </p>
      <p v-if="pending && error" class="split-help">
        为避免重复创建，重试会使用刚才同一批资料，请不要关闭弹框或刷新。
      </p>
      <button
        class="split-confirm"
        type="button"
        :disabled="saving || (!pending && !!preview.error)"
        @click="confirmSplit"
      >
        {{
          saving
            ? '正在生成两份商品…'
            : pending
              ? '重试生成同一批商品'
              : '确认生成两个新商品（保留原商品）'
        }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.split-panel {
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid var(--canvas-accent-border);
  border-radius: 8px;
  background: var(--canvas-accent-soft);
}
.split-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
h3 {
  margin: 0;
  font-size: 14px;
}
p {
  margin: 8px 0;
  line-height: 1.6;
  color: var(--canvas-text-muted);
}
button,
input {
  font: inherit;
  color: var(--canvas-text);
}
button {
  padding: 9px 14px;
  border: 1px solid var(--canvas-border-strong);
  background: var(--canvas-panel);
  border-radius: 6px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 16px 0;
}
legend {
  margin-bottom: 10px;
}
.split-dimensions {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.split-dimensions label {
  display: flex;
  gap: 6px;
  align-items: center;
}
input {
  accent-color: var(--canvas-accent);
}
.split-boundary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}
input[type='text'] {
  width: 76px;
  padding: 8px;
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
  background: var(--canvas-input);
}
.split-previews {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
article {
  padding: 14px;
  background: var(--canvas-panel);
  border: 1px solid var(--canvas-border);
  border-radius: 6px;
}
strong {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
b {
  color: var(--canvas-accent);
}
.split-values {
  max-height: 100px;
  overflow: auto;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.split-help {
  font-size: 12px;
}
.split-error {
  color: #ef4444;
}
.split-confirm {
  color: var(--canvas-accent);
  border-color: var(--canvas-accent-border);
}
@media (max-width: 680px) {
  .split-previews {
    grid-template-columns: 1fr;
  }
}
</style>

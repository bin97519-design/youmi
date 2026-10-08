<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
defineProps({ report: { type: Object, required: true } })
const emit = defineEmits(['confirm', 'cancel'])
const cancelButton = ref(null)
const continueButton = ref(null)
let previousFocus
onMounted(() => {
  previousFocus = document.activeElement
  cancelButton.value?.focus()
})
onBeforeUnmount(() => previousFocus?.focus?.())
function trapFocus(event) {
  if (event.key !== 'Tab') return
  event.preventDefault()
  if (document.activeElement === cancelButton.value) continueButton.value?.focus()
  else cancelButton.value?.focus()
}
</script>

<template>
  <div class="jd-sku-backdrop" @mousedown.self="emit('cancel')">
    <section
      class="jd-sku-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="jd-sku-warning-title"
      aria-describedby="jd-sku-warning-summary"
      @keydown.esc.stop.prevent="emit('cancel')"
      @keydown="trapFocus"
    >
      <header><h2 id="jd-sku-warning-title">京东 SKU 名称超长提醒</h2></header>
      <p id="jd-sku-warning-summary">
        {{ report.affectedProducts }} 个商品、{{ report.issueCount }} 条 SKU 名称超过
        <strong>50 个字符</strong>
        。
      </p>
      <p class="explanation">
        各规格值以空格连接计算总长度，包含中文、英文、数字、标点和空格。继续不会截断或改名，京东仍可能拒收，请先修改
        SKU 名称或确认继续。
      </p>
      <div class="jd-sku-issues">
        <article
          v-for="(product, productIndex) in report.products"
          :key="`${product.productRowId}-${productIndex}`"
        >
          <h3>{{ product.title }}</h3>
          <ul>
            <li v-for="(sku, index) in product.issues" :key="index">
              <span>
                {{ sku.groupOnly ? '规格组合' : `SKU ${sku.skuIndex}` }} · {{ sku.length }}/50 字符
              </span>
              <div>{{ sku.name }}</div>
            </li>
          </ul>
        </article>
      </div>
      <p class="explanation">
        取消后不会打开京东发布页，云端任务保留。本次确认仅继续填写流程，不代表确认最终发布。
      </p>
      <footer>
        <button ref="cancelButton" type="button" @click="emit('cancel')">取消，先修改</button>
        <button ref="continueButton" type="button" class="continue" @click="emit('confirm')">
          已知晓，继续上架
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.jd-sku-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: grid;
  place-items: center;
  padding: 20px;
  background: #0009;
}
.jd-sku-dialog {
  width: min(760px, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--canvas-border, #555);
  border-radius: 12px;
  color: var(--canvas-text, #eee);
  background: var(--canvas-panel, #24252b);
  box-shadow: 0 20px 80px #0006;
}
h2 {
  margin: 0;
  font-size: 20px;
}
h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
p {
  margin: 0;
  line-height: 1.6;
}
.explanation {
  color: var(--canvas-text-subtle, #aaa);
  font-size: 13px;
}
.jd-sku-issues {
  overflow: auto;
  min-height: 80px;
  border: 1px solid var(--canvas-border, #555);
  border-radius: 8px;
  padding: 14px;
}
article + article {
  margin-top: 20px;
}
ul {
  margin: 0;
  padding-left: 20px;
}
li + li {
  margin-top: 10px;
}
li span {
  color: var(--color-error, #f97676);
  font-size: 12px;
}
li div {
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}
footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
button {
  padding: 10px 16px;
  border-radius: 6px;
  border: 1px solid var(--canvas-border, #666);
  color: inherit;
  background: transparent;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--canvas-accent, #20bcd2);
  outline-offset: 3px;
}
.continue {
  background: var(--canvas-accent, #20bcd2);
  color: #061b21;
  border-color: transparent;
}
</style>

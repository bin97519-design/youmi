<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  categories: { type: Array, default: () => [] },
  result: { type: Object, default: null },
  pending: { type: Boolean, default: false },
  error: { type: String, default: '' },
});

const emit = defineEmits(['close', 'analyze', 'copy', 'apply']);

const imageUrl = ref('');
const category = ref('mattress');
const editableJson = ref({});

const activeCategory = computed(
  () => props.categories.find((item) => item.value === (props.result?.category || category.value)) || props.categories[0] || null,
);

const groups = computed(() => props.result?.groups || activeCategory.value?.groups || []);
const fieldLabels = computed(() => props.result?.fieldLabels || activeCategory.value?.fieldLabels || {});
const previewUrl = computed(() => props.result?.thumbnailUrl || props.result?.imageUrl || imageUrl.value);
const pageUrl = computed(() => props.result?.pageUrl || '');
const sourceLabel = computed(() => {
  const source = props.result?.source;
  if (source === 'context-menu') return '右键识别';
  if (source === 'selection') return '框选识别';
  if (source === 'hover-image') return '悬停识别';
  return source ? String(source) : '系统识别';
});
const jsonText = computed(() => JSON.stringify(editableJson.value || {}, null, 2));

watch(
  () => props.result,
  (next) => {
    editableJson.value = next?.promptJson ? JSON.parse(JSON.stringify(next.promptJson)) : {};
    if (next?.imageUrl) imageUrl.value = next.imageUrl;
    if (next?.category) category.value = next.category;
  },
  { immediate: true },
);

function valueFor(key) {
  const value = editableJson.value?.[key];
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function updateValue(key, value) {
  editableJson.value = {
    ...editableJson.value,
    [key]: value,
  };
}

function submitAnalyze() {
  emit('analyze', {
    category: category.value,
    imageUrl: imageUrl.value.trim(),
  });
}

function copyResult() {
  emit('copy', {
    promptJson: editableJson.value,
    promptText: jsonText.value,
  });
}

function applyResult() {
  emit('apply', {
    promptJson: editableJson.value,
    promptText: jsonText.value,
  });
}
</script>

<template>
  <aside v-if="visible" class="yh-reverse-panel" aria-label="反推提示词">
    <header class="yh-reverse-head">
      <div>
        <span>参考图解析</span>
        <strong>反推提示词</strong>
      </div>
      <button type="button" @click="emit('close')" aria-label="关闭">x</button>
    </header>

    <form class="yh-reverse-form" @submit.prevent="submitAnalyze">
      <label>
        <span>图片 URL</span>
        <input v-model="imageUrl" type="url" placeholder="https://..." />
      </label>
      <label>
        <span>品类</span>
        <select v-model="category">
          <option v-for="item in categories" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>
      <button type="submit" :disabled="pending || !imageUrl.trim()">
        {{ pending ? '解析中...' : '开始反推' }}
      </button>
    </form>

    <p v-if="error" class="yh-reverse-error">{{ error }}</p>

    <section v-if="result" class="yh-reverse-result">
      <div class="yh-reverse-meta">
        <img v-if="previewUrl" :src="previewUrl" alt="反推参考图" />
        <div>
          <strong>{{ result.categoryLabel || activeCategory?.label || '通用' }}</strong>
          <span>{{ sourceLabel }}</span>
          <a v-if="pageUrl" :href="pageUrl" target="_blank" rel="noreferrer">来源页面</a>
        </div>
      </div>

      <div class="yh-reverse-fields">
        <section v-for="group in groups" :key="group.label" class="yh-reverse-group">
          <h3>{{ group.label }}</h3>
          <label v-for="field in group.categories" :key="field">
            <span>{{ fieldLabels[field] || field }}</span>
            <textarea :value="valueFor(field)" @input="updateValue(field, $event.target.value)"></textarea>
          </label>
        </section>
      </div>

      <details class="yh-reverse-json">
        <summary>原始 JSON</summary>
        <pre>{{ jsonText }}</pre>
      </details>

      <footer class="yh-reverse-actions">
        <button type="button" @click="copyResult">复制提示词</button>
        <button type="button" class="primary" @click="applyResult">应用到当前提示词</button>
      </footer>
    </section>

    <section v-else class="yh-reverse-empty">
      <strong>等待图片解析结果</strong>
      <span>系统上传、右键图片或框选识别都会回填到这里。</span>
    </section>
  </aside>
</template>

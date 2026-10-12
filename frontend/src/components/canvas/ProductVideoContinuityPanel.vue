<script setup>
import { computed } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import {
  currentContinuityReview,
  currentManualContinuityApproval,
  reviewRunning,
} from '../../utils/productVideoContinuityReview'

const props = defineProps({
  workflow: { type: Object, required: true },
  modelOptions: { type: Array, default: () => [] },
  jobOverride: { type: Object, default: null },
  currentOverride: { type: Boolean, default: null },
  manualApproved: { type: Boolean, default: false },
  heading: { type: String, default: '整片衔接检查' },
  labels: { type: Object, default: () => ({}) },
})
const emit = defineEmits([
  'start',
  'cancel',
  'model',
  'manual',
  'acknowledge',
  'acknowledge-whole',
  'apply-cut',
  'preview',
  'edit',
])
const job = computed(() => props.currentOverride == null ? props.workflow.continuityReview : props.jobOverride)
const current = computed(() => props.currentOverride == null ? currentContinuityReview(props.workflow) : props.currentOverride)
const busy = computed(() => reviewRunning(job.value))
const title = (id) => props.labels[id] || job.value?.snapshot?.clips.find((clip) => clip.shotId === id)?.title || id
const accepted = (result) => current.value && job.value?.acknowledged?.includes(result.index)
const status = computed(() =>
  props.manualApproved || (props.currentOverride == null && currentManualContinuityApproval(props.workflow))
    ? '已人工审片'
    : !job.value?.id
      ? '待检查'
      : !current.value
        ? '结果待更新'
        : busy.value
          ? `检查中 ${job.value.progress || 0}%`
          : job.value.status === 'completed'
            ? '检查完成'
            : job.value.stage || '检查未完成',
)
</script>

<template>
  <details class="pv-continuity-review" :open="Boolean(job?.id)" :aria-label="heading === '整片衔接检查' ? '整片衔接检查结果' : heading">
    <summary>
      <strong>{{ heading }}</strong>
      <span>{{ status }}</span>
    </summary>
    <label class="pv-review-model">
      检查模型
      <ThemedSelect
        :model-value="workflow.planningModel || 'default'"
        :options="modelOptions"
        aria-label="衔接检查模型"
        :disabled="busy"
        @update:model-value="emit('model', $event)"
      />
    </label>
    <div class="pv-review-actions">
      <button :disabled="busy || !modelOptions.length" @click="emit('start')">
        <i class="ri-scan-2-line" aria-hidden="true"></i>
        {{ job?.status === 'unknown' ? '核对原检查' : job ? '重新检查' : '检查整片' }}
      </button>
      <button
        v-if="busy"
        class="pv-review-icon"
        title="停止后续检查"
        aria-label="停止后续检查"
        :disabled="job.status === 'stopping'"
        @click="emit('cancel')"
      >
        <i class="ri-stop-line" aria-hidden="true"></i>
      </button>
      <button :disabled="busy || job?.status === 'unknown'" @click="emit('manual')">
        <i class="ri-eye-line" aria-hidden="true"></i>
        人工审片确认
      </button>
    </div>
    <progress v-if="busy" :value="job.progress || 0" max="100" aria-label="衔接检查进度" />
    <p v-if="job?.error || job?.pollError" class="pv-review-warning" role="status">
      {{ job.error || job.pollError }}
    </p>
    <p v-if="job?.summary" class="pv-review-summary">{{ job.summary }}</p>
    <div v-if="job?.issues?.length" class="pv-review-whole">
      <strong>整片结构待确认</strong>
      <ul>
        <li v-for="(issue, index) in job.issues" :key="index">{{ issue }}</li>
      </ul>
      <label>
        <input
          type="checkbox"
          :checked="Boolean(job.wholeAcknowledged)"
          :disabled="!current || job.status !== 'completed'"
          @change="emit('acknowledge-whole', $event.target.checked)"
        />
        已人工确认整片结构
      </label>
    </div>
    <article
      v-for="result in job?.results || []"
      :key="result.index"
      class="pv-review-boundary"
      :class="result.status"
    >
      <div class="pv-review-boundary-heading">
        <strong>{{ result.previousId ? `${title(result.previousId)} → ` : '' }}{{ title(result.currentId) }}</strong>
        <span>
          {{
            accepted(result)
              ? '已人工确认'
              : result.status === 'pass'
                ? '未发现明显问题'
                : result.status === 'uncertain'
                  ? '需人工判断'
                  : '待修正或确认'
          }}
        </span>
      </div>
      <p>
        <b>前镜结束：</b>
        {{ result.previousState }}
      </p>
      <p>
        <b>本镜起点：</b>
        {{ result.currentState }}
      </p>
      <p>
        <b>动作衔接：</b>
        {{ result.motion }}
      </p>
      <ul v-if="result.issues?.length">
        <li v-for="(issue, index) in result.issues" :key="index">{{ issue }}</li>
      </ul>
      <p v-if="result.advice">{{ result.advice }}</p>
      <div class="pv-review-actions">
        <button
          class="pv-review-icon"
          title="预览此处衔接"
          aria-label="预览此处衔接"
          :disabled="!current"
          @click="emit('preview', result)"
        >
          <i class="ri-play-circle-line" aria-hidden="true"></i>
        </button>
        <button
          class="pv-review-icon"
          title="编辑对应分镜"
          aria-label="编辑对应分镜"
          :disabled="!current"
          @click="emit('edit', result.currentId)"
        >
          <i class="ri-edit-line" aria-hidden="true"></i>
        </button>
        <button
          v-if="result.suggestedPreviousEnd != null || result.suggestedCurrentStart != null"
          :disabled="!current || job.status !== 'completed'"
          @click="emit('apply-cut', result)"
        >
          <i class="ri-scissors-cut-line" aria-hidden="true"></i>
          应用切点建议
        </button>
        <button
          v-if="result.status !== 'pass' || result.issues?.length"
          :disabled="!current || job.status !== 'completed'"
          :aria-pressed="Boolean(accepted(result))"
          @click="emit('acknowledge', result.index, !accepted(result))"
        >
          <i
            :class="accepted(result) ? 'ri-check-line' : 'ri-checkbox-blank-line'"
            aria-hidden="true"
          ></i>
          {{ accepted(result) ? '撤销确认' : '接受当前衔接' }}
        </button>
      </div>
    </article>
  </details>
</template>

<style scoped>
.pv-continuity-review {
  margin: 0 0 16px;
  border-bottom: 1px solid var(--canvas-border);
  padding-bottom: 12px;
  font-size: 12px;
}
summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  min-height: 32px;
}
summary span {
  color: var(--canvas-text-muted);
  font-size: 11px;
}
summary strong { min-width: 0; overflow-wrap: anywhere; }
summary span { flex-shrink: 0; }
.pv-review-model {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 10px 0;
  color: var(--canvas-text-muted);
}
.pv-review-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 32px;
  padding: 5px 9px;
  border: 1px solid var(--canvas-border);
  border-radius: 5px;
  color: var(--canvas-text);
  background: var(--canvas-surface);
  font-size: 11px;
  cursor: pointer;
}
button:hover:not(:disabled) {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-surface-hover);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
.pv-review-icon {
  width: 32px;
  padding: 0;
  flex-shrink: 0;
  font-size: 17px;
}
progress {
  display: block;
  width: 100%;
  height: 5px;
  margin: 12px 0;
  accent-color: var(--canvas-accent);
}
p,
li {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
p {
  margin: 8px 0;
}
ul {
  margin: 8px 0;
  padding-left: 18px;
}
.pv-review-warning,
.pv-review-whole {
  color: #dcad61;
}
.pv-review-whole label {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 8px 0;
  font-size: 11px;
}
input {
  accent-color: var(--canvas-accent);
}
.pv-review-summary {
  color: var(--canvas-text-muted);
}
.pv-review-boundary {
  padding: 10px 0 10px 10px;
  margin: 12px 0;
  border-left: 2px solid var(--canvas-border);
}
.pv-review-boundary.pass {
  border-left-color: #32b78c;
}
.pv-review-boundary.attention {
  border-left-color: #d9a855;
}
.pv-review-boundary-heading {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pv-review-boundary-heading span {
  color: var(--canvas-text-muted);
  font-size: 11px;
}
.pv-review-boundary b {
  font-weight: 500;
}
[data-theme='light'] .pv-review-warning,
[data-theme='light'] .pv-review-whole {
  color: #8a5b12;
}
</style>

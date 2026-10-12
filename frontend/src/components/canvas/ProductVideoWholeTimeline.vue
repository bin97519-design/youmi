<script setup>
import { computed } from 'vue'
import ThemedSelect from '../common/ThemedSelect.vue'
import {
  wholeTimeline,
  wholeSeconds,
  WHOLE_TRANSITIONS,
} from '../../utils/productVideoWholeTimeline.js'
const props = defineProps({
  shot: { type: Object, required: true },
  selectedIndex: { type: Number, default: 0 },
  disabled: Boolean,
  refining: Boolean,
  canRefine: Boolean,
})
const emit = defineEmits([
  'select',
  'update',
  'boundary',
  'initialize',
  'refine',
  'split',
  'remove',
])
const beats = computed(() => wholeTimeline(props.shot))
const selected = computed(() => beats.value[props.selectedIndex] || beats.value[0])
const index = computed(() => Math.max(0, beats.value.indexOf(selected.value)))
function edit(key, value) {
  emit('update', index.value, key, value)
}
function boundary(event) {
  emit('boundary', index.value, Number(event.target.value))
  event.target.value = selected.value.end
}
</script>

<template>
  <section class="pv-whole-timeline" aria-label="整片时段编辑">
    <header>
      <strong>整片时间轴</strong>
      <span>{{ wholeSeconds(shot) }} 秒 · {{ beats.length }} 段</span>
    </header>
    <button v-if="!beats.length" :disabled="disabled" @click="emit('initialize')">
      <i class="ri-add-line" aria-hidden="true"></i>
      建立单镜时间轴
    </button>
    <template v-else>
      <div class="whole-beat-list" role="group" aria-label="选择整片时段">
        <button
          v-for="(beat, i) in beats"
          :key="i"
          :aria-pressed="i === index"
          :class="{ selected: i === index }"
          :aria-label="`编辑第 ${i + 1} 时段 ${beat.start} 至 ${beat.end} 秒`"
          @click="emit('select', i)"
        >
          <b>{{ i + 1 }}</b>
          <span>{{ beat.start }}-{{ beat.end }} 秒</span>
        </button>
      </div>
      <div class="whole-beat-heading">
        <strong>第 {{ index + 1 }} 时段</strong>
        <div>
          <button
            title="拆分时段"
            aria-label="拆分时段"
            :disabled="disabled || beats.length >= 8 || selected.end - selected.start < 2"
            @click="emit('split', index)"
          >
            <i class="ri-scissors-cut-line" aria-hidden="true"></i>
          </button>
          <button
            title="合并移除此时段"
            aria-label="合并移除此时段"
            :disabled="disabled || beats.length < 2"
            @click="emit('remove', index)"
          >
            <i class="ri-delete-bin-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="whole-beat-fields">
        <label>
          起点（秒）
          <input :value="selected.start" readonly aria-label="整片时段起点" />
        </label>
        <label>
          结束（秒）
          <input
            type="number"
            step="0.1"
            :value="selected.end"
            :min="selected.start + 1"
            :max="beats[index + 1] ? beats[index + 1].end - 1 : wholeSeconds(shot)"
            :readonly="index === beats.length - 1"
            :disabled="disabled"
            aria-label="整片时段结束"
            @change="boundary"
          />
        </label>
        <label class="whole-beat-wide">
          进入方式
          <ThemedSelect
            :model-value="selected.transitionType"
            :options="
              WHOLE_TRANSITIONS.filter((item) =>
                index ? item.value !== 'opening' : item.value === 'opening',
              )
            "
            :disabled="disabled"
            aria-label="整片时段进入方式"
            @update:model-value="edit('transitionType', $event)"
          />
        </label>
        <label>
          开始状态
          <textarea
            :value="selected.startState"
            maxlength="120"
            rows="2"
            :disabled="disabled"
            aria-label="整片时段开始状态"
            @change="edit('startState', $event.target.value)"
          />
        </label>
        <label>
          结束状态
          <textarea
            :value="selected.endState"
            maxlength="120"
            rows="2"
            :disabled="disabled"
            aria-label="整片时段结束状态"
            @change="edit('endState', $event.target.value)"
          />
        </label>
        <label class="whole-beat-wide">
          执行描述
          <textarea
            :value="selected.description"
            maxlength="1800"
            rows="4"
            :disabled="disabled"
            aria-label="整片时段执行描述"
            @change="edit('description', $event.target.value)"
          />
        </label>
      </div>
      <button :disabled="disabled || refining || !canRefine" @click="emit('refine', index)">
        <i :class="refining ? 'ri-loader-4-line' : 'ri-sparkling-line'" aria-hidden="true"></i>
        {{ refining ? '完善中' : '完善当前时段' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.pv-whole-timeline {
  padding: 14px 0;
  border-block: 1px solid var(--canvas-border);
  margin: 12px 0;
  font-size: 12px;
}
header,
.whole-beat-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
header span {
  color: var(--canvas-text-muted);
  font-size: 11px;
}
.whole-beat-heading > div {
  display: flex;
  gap: 6px;
}
.whole-beat-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  border: 1px solid var(--canvas-border);
  border-radius: 5px;
  padding: 5px 9px;
  color: var(--canvas-text);
  background: var(--canvas-surface);
  font-size: 11px;
  cursor: pointer;
}
.whole-beat-heading button {
  width: 32px;
  padding: 0;
  font-size: 16px;
}
.whole-beat-list button {
  min-width: 95px;
}
.whole-beat-list b {
  color: var(--canvas-text-muted);
}
button.selected,
button:hover:not(:disabled) {
  border-color: var(--canvas-accent-border);
  background: var(--canvas-accent-soft);
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.whole-beat-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  color: var(--canvas-text-muted);
}
.whole-beat-wide {
  grid-column: 1 / -1;
}
input,
textarea {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--canvas-border);
  border-radius: 5px;
  color: var(--canvas-text);
  background: var(--canvas-surface);
  font: inherit;
  line-height: 1.5;
}
textarea {
  resize: vertical;
  overflow-wrap: anywhere;
}
input[readonly] {
  color: var(--canvas-text-muted);
}
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--canvas-accent);
  outline-offset: 2px;
}
@media (max-width: 480px) {
  .whole-beat-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

<script setup>
import { computed, nextTick, reactive, ref, useId, watch } from 'vue'
import {
  directorQuestionNeedsImages,
  directorScriptSourceMode,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
  normalizeDirectorQuestions,
} from '../config/directorClarifications.js'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  questions: { type: Array, default: () => [] },
  answers: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  referenceImages: { type: Array, default: () => [] },
  hasHistoryReferences: { type: Boolean, default: false },
  uploading: { type: Boolean, default: false },
  initiallyExpanded: { type: Boolean, default: false },
  mode: {
    type: String,
    default: 'auto',
    validator: (value) => ['auto', 'record', 'form'].includes(value),
  },
})
const emit = defineEmits(['answer', 'image-source-change', 'script-source-change'])
const instanceId = useId()
const expanded = ref(props.initiallyExpanded)
const page = ref(0)
const questionHeading = ref(null)
const drafts = reactive({})
const questions = computed(() => normalizeDirectorQuestions(props.questions))
const savedAnswers = computed(() =>
  normalizeDirectorClarificationAnswers(questions.value, props.answers),
)
const answered = computed(() => savedAnswers.value.length > 0)
const showRecord = computed(() => props.mode === 'record' || answered.value)
const currentQuestion = computed(() => questions.value[page.value])
const currentKind = computed(() => currentQuestion.value?.kind || 'choice')
const displayOptions = computed(() =>
  (currentQuestion.value?.options || []).filter((option) => !/^其[他它]/u.test(option)),
)
const lastPage = computed(() => page.value === questions.value.length - 1)
const draftAnswers = computed(() =>
  questions.value.map((question) => ({
    questionId: question.id,
    answer:
      question.kind === 'image_upload'
        ? props.referenceImages.length
          ? '已提供参考图片'
          : ''
        : drafts[question.id]?.mode === 'custom'
          ? drafts[question.id].custom
          : drafts[question.id]?.option || '',
  })),
)
const currentAnswered = computed(
  () =>
    scriptHistoryAvailable.value &&
    isDirectorClarificationReady(
      currentQuestion.value ? [currentQuestion.value] : [],
      draftAnswers.value,
      props.referenceImages,
    ),
)
const currentScriptMode = computed(() =>
  directorScriptSourceMode(
    currentQuestion.value ? [currentQuestion.value] : [],
    draftAnswers.value,
  ),
)
const scriptHistoryAvailable = computed(
  () =>
    props.hasHistoryReferences ||
    directorScriptSourceMode(questions.value, draftAnswers.value) !== 'history',
)
const missingImagesHint = computed(() =>
  directorScriptSourceMode(questions.value, draftAnswers.value) === 'history'
    ? '请选择要沿用的商品图'
    : '请上传或选择至少一张参考图片',
)
const currentNeedsImages = computed(() =>
  directorQuestionNeedsImages(
    currentQuestion.value,
    draftAnswers.value.find((answer) => answer.questionId === currentQuestion.value?.id)?.answer,
  ),
)
const missingImages = computed(
  () =>
    !props.referenceImages.length &&
    questions.value.some((question) =>
      directorQuestionNeedsImages(
        question,
        draftAnswers.value.find((answer) => answer.questionId === question.id)?.answer,
      ),
    ),
)
const canSubmit = computed(
  () =>
    !props.disabled &&
    !props.uploading &&
    !answered.value &&
    scriptHistoryAvailable.value &&
    isDirectorClarificationReady(questions.value, draftAnswers.value, props.referenceImages),
)
const canContinue = computed(
  () => !props.disabled && !props.uploading && !answered.value && currentAnswered.value,
)

watch(
  questions,
  (items, previousItems) => {
    const changed = JSON.stringify(items) !== JSON.stringify(previousItems || [])
    if (changed) {
      page.value = 0
      for (const id of Object.keys(drafts)) delete drafts[id]
    }
    for (const question of items) {
      drafts[question.id] ||= { mode: '', option: '', custom: '' }
    }
  },
  { immediate: true },
)
watch(answered, (value) => {
  if (value) expanded.value = props.initiallyExpanded
})

function selectAnswer(questionId, option) {
  if (props.disabled || answered.value) return
  const question = questions.value.find((item) => item.id === questionId)
  if (!question || !question.options.includes(option)) return
  if (
    question.kind === 'script_source' &&
    option === '沿用历史商品图' &&
    !props.hasHistoryReferences
  )
    return
  const changed = drafts[questionId].option !== option || drafts[questionId].mode !== 'option'
  drafts[questionId].mode = 'option'
  drafts[questionId].option = option
  if (question.kind === 'image_source' && changed) {
    emit('image-source-change', option === '参考图生图' ? 'reference' : 'text')
  }
  if (question.kind === 'script_source' && changed) {
    emit('script-source-change', directorScriptSourceMode([question], draftAnswers.value))
  }
}

function selectCustom(questionId) {
  if (props.disabled || answered.value) return
  const question = questions.value.find((item) => item.id === questionId)
  if (!question || (question.kind && question.kind !== 'choice')) return
  drafts[questionId].mode = 'custom'
}

function setCustomAnswer(questionId, value) {
  if (props.disabled || answered.value) return
  drafts[questionId].custom = value
}

async function changePage(direction) {
  if (props.disabled || answered.value || (direction > 0 && !canContinue.value)) return
  const nextPage = page.value + direction
  if (nextPage < 0 || nextPage >= questions.value.length) return
  page.value = nextPage
  await nextTick()
  questionHeading.value?.focus?.()
}

function submitAnswers() {
  if (!lastPage.value) {
    if (canContinue.value) void changePage(1)
    return
  }
  if (!canSubmit.value) return
  emit('answer', normalizeDirectorClarificationAnswers(questions.value, draftAnswers.value))
}
</script>

<template>
  <section
    v-if="questions.length"
    class="cv3-director-clarification"
    :class="{ 'is-form': !showRecord, 'is-record': showRecord }"
    :aria-label="showRecord ? '需求补充记录' : '需求补充'"
  >
    <template v-if="showRecord">
      <component
        :is="answered ? 'button' : 'div'"
        :type="answered ? 'button' : undefined"
        class="cv3-director-clarification-heading"
        :aria-expanded="answered ? expanded : undefined"
        :aria-controls="answered ? `${instanceId}-answers` : undefined"
        @click="answered && (expanded = !expanded)"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 3.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-5l-4 3v-3H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.25"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ answered ? '已询问' : '询问中' }}</span>
        <CanvasIcon
          v-if="answered"
          name="chevron"
          :size="12"
          :class="{ 'is-collapsed': !expanded }"
        />
      </component>
      <ul
        v-if="answered && expanded"
        :id="`${instanceId}-answers`"
        class="cv3-director-clarification-records"
      >
        <li v-for="answer in savedAnswers" :key="answer.questionId">
          <p>{{ answer.question }}</p>
          <p class="cv3-director-clarification-answer">{{ answer.answer }}</p>
        </li>
      </ul>
    </template>

    <form
      v-else-if="currentQuestion"
      class="cv3-director-clarification-form"
      @submit.prevent="submitAnswers"
    >
      <header class="cv3-director-clarification-page-heading">
        <h3 :id="`${instanceId}-question`" ref="questionHeading" tabindex="-1">
          {{ currentQuestion.question }}
        </h3>
        <nav v-if="questions.length > 1" aria-label="问题分页">
          <button
            type="button"
            aria-label="上一题"
            :disabled="disabled || page === 0"
            @click="changePage(-1)"
          >
            <CanvasIcon name="chevron" :size="16" class="is-previous" />
          </button>
          <span aria-live="polite" aria-atomic="true">{{ page + 1 }}/{{ questions.length }}</span>
          <button
            type="button"
            aria-label="下一题"
            :disabled="!canContinue || lastPage"
            @click="changePage(1)"
          >
            <CanvasIcon name="chevron" :size="16" class="is-next" />
          </button>
        </nav>
      </header>
      <fieldset
        :key="currentQuestion.id"
        :disabled="disabled"
        :aria-labelledby="`${instanceId}-question`"
      >
        <div v-if="currentKind !== 'image_upload'" class="cv3-director-clarification-options">
          <label
            v-for="(option, index) in displayOptions"
            :key="option"
            class="cv3-director-clarification-option"
            :class="{
              'is-unavailable':
                currentKind === 'script_source' &&
                option === '沿用历史商品图' &&
                !hasHistoryReferences,
              'is-selected':
                drafts[currentQuestion.id].mode === 'option' &&
                drafts[currentQuestion.id].option === option,
            }"
          >
            <input
              type="radio"
              :name="`${instanceId}-${currentQuestion.id}`"
              :value="option"
              :disabled="
                currentKind === 'script_source' &&
                option === '沿用历史商品图' &&
                !hasHistoryReferences
              "
              :aria-label="option"
              :checked="
                drafts[currentQuestion.id].mode === 'option' &&
                drafts[currentQuestion.id].option === option
              "
              :data-option-index="index"
              @change="selectAnswer(currentQuestion.id, option)"
            />
            <span class="cv3-director-clarification-option-number" aria-hidden="true">
              {{ index + 1 }}
            </span>
            <span>{{ option }}</span>
          </label>
          <label
            v-if="currentKind === 'choice'"
            class="cv3-director-clarification-option is-custom"
            :class="{ 'is-selected': drafts[currentQuestion.id].mode === 'custom' }"
          >
            <input
              type="radio"
              :name="`${instanceId}-${currentQuestion.id}`"
              value="custom"
              aria-label="其他，请直接描述"
              :checked="drafts[currentQuestion.id].mode === 'custom'"
              @change="selectCustom(currentQuestion.id)"
            />
            <span class="cv3-director-clarification-option-number" aria-hidden="true">
              {{ displayOptions.length + 1 }}
            </span>
            <span>其他，请直接描述</span>
          </label>
        </div>
        <p
          v-if="currentKind === 'script_source' && !hasHistoryReferences"
          class="cv3-director-clarification-image-hint"
        >
          暂无可沿用的历史商品图，可上传商品图或仅根据文字策划。
        </p>
        <textarea
          v-if="currentKind === 'choice' && drafts[currentQuestion.id].mode === 'custom'"
          :aria-label="`${currentQuestion.question}，自行填写`"
          :value="drafts[currentQuestion.id].custom"
          rows="2"
          maxlength="1200"
          placeholder="填写你的需求"
          @input="setCustomAnswer(currentQuestion.id, $event.target.value)"
        />
        <div v-if="currentNeedsImages" class="cv3-director-clarification-reference-upload">
          <slot
            v-if="currentKind === 'script_source' && currentScriptMode === 'history'"
            name="history-reference"
            :question="currentQuestion"
          />
          <slot v-else name="reference-upload" :question="currentQuestion" />
        </div>
        <p v-if="missingImages" class="cv3-director-clarification-image-hint" role="status">
          {{ missingImagesHint }}
        </p>
        <p v-else-if="uploading" class="cv3-director-clarification-image-hint" role="status">
          参考图片上传中，请稍候
        </p>
      </fieldset>
      <footer class="cv3-director-clarification-actions">
        <button
          type="submit"
          class="cv3-director-clarification-submit"
          :disabled="lastPage ? !canSubmit : !canContinue"
        >
          {{ lastPage ? '提交并继续' : '下一步' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.cv3-director-clarification {
  min-width: 0;
  color: #ededed;
  font-size: 13px;
  line-height: 20px;
}
.cv3-director-clarification.is-record {
  margin: 12px 0;
}
.cv3-director-clarification.is-form {
  box-sizing: border-box;
  margin: 0;
  padding: 18px 16px 12px;
  border: 1px solid #383838;
  border-radius: 20px;
  background: #141414;
}
.cv3-director-clarification-heading {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #919191;
  font: inherit;
}
button.cv3-director-clarification-heading {
  cursor: pointer;
}
.cv3-director-clarification-heading .is-collapsed {
  transform: rotate(-90deg);
}
.cv3-director-clarification-page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 24px;
  margin-bottom: 16px;
}
.cv3-director-clarification-page-heading h3 {
  min-width: 0;
  margin: 0;
  color: #f2f2f2;
  font: inherit;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.cv3-director-clarification-page-heading h3:focus {
  outline: none;
}
.cv3-director-clarification-page-heading nav {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  margin-top: -2px;
  color: #eee;
  font-variant-numeric: tabular-nums;
}
.cv3-director-clarification-page-heading nav button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cv3-director-clarification-page-heading nav button:hover:enabled {
  background: #292929;
}
.cv3-director-clarification-page-heading nav button:active:enabled {
  background: #383838;
}
.cv3-director-clarification-page-heading nav button:disabled {
  color: #555;
  cursor: default;
}
.cv3-director-clarification-page-heading .is-previous {
  transform: rotate(90deg);
}
.cv3-director-clarification-page-heading .is-next {
  transform: rotate(-90deg);
}
.cv3-director-clarification-form fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.cv3-director-clarification-options {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.cv3-director-clarification-option {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  box-sizing: border-box;
  min-height: 35px;
  padding: 7px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #ededed;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.cv3-director-clarification-option:hover {
  background: #202020;
}
.cv3-director-clarification-option:active {
  background: #303030;
}
.cv3-director-clarification-option.is-selected {
  border-color: #484848;
  background: #292929;
  color: #fff;
}
.cv3-director-clarification-option.is-custom:not(.is-selected) {
  color: #777;
}
.cv3-director-clarification-option.is-unavailable {
  color: #777;
  cursor: not-allowed;
}
.cv3-director-clarification-option.is-unavailable:hover,
.cv3-director-clarification-option.is-unavailable:active {
  background: transparent;
}
.cv3-director-clarification-option input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.cv3-director-clarification-option-number {
  display: inline-flex;
  flex: 0 0 16px;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 4px;
  background: #303030;
  color: #ececec;
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
}
.is-selected .cv3-director-clarification-option-number {
  background: #f2f2f2;
  color: #303030;
}
.cv3-director-clarification-form fieldset:disabled {
  opacity: 0.55;
}
.cv3-director-clarification-form fieldset:disabled label {
  cursor: default;
}
.cv3-director-clarification-form fieldset:disabled label:hover,
.cv3-director-clarification-form fieldset:disabled label:active {
  background: transparent;
}
.cv3-director-clarification-form textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 70px;
  max-height: 160px;
  margin-top: 8px;
  padding: 7px 9px;
  resize: vertical;
  border: 1px solid #515151;
  border-radius: 8px;
  background: #202020;
  color: #e6e6e6;
  font: inherit;
}
.cv3-director-clarification-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
.cv3-director-clarification-reference-upload {
  margin-top: 12px;
}
.cv3-director-clarification-image-hint {
  margin: 8px 0 0;
  color: #a3a3a3;
  font-size: 12px;
  line-height: 18px;
}
.cv3-director-clarification-submit {
  min-height: 30px;
  padding: 4px 12px;
  border: 0;
  border-radius: 8px;
  background: #ececec;
  color: #242424;
  font: inherit;
  cursor: pointer;
}
.cv3-director-clarification-submit:active:enabled {
  background: #ccc;
}
.cv3-director-clarification-submit:disabled {
  opacity: 0.35;
  cursor: default;
}
.cv3-director-clarification-heading:focus-visible,
.cv3-director-clarification-page-heading nav button:focus-visible,
.cv3-director-clarification-option:focus-within,
.cv3-director-clarification-submit:focus-visible,
.cv3-director-clarification-form textarea:focus-visible {
  outline: 1px solid #a8a8a8;
  outline-offset: 3px;
}
.cv3-director-clarification-records {
  margin: 8px 0 0;
  padding-left: 15px;
}
.cv3-director-clarification-records li {
  margin-top: 7px;
  overflow-wrap: anywhere;
}
.cv3-director-clarification-records p {
  margin: 0;
}
.cv3-director-clarification-answer {
  margin-top: 2px !important;
  color: #919191;
}
</style>

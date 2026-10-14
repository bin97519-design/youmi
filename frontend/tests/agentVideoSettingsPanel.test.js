import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import * as models from '../src/utils/productVideo.js'
import * as settings from '../src/utils/chatVideoSettings.js'

const component = parse(
  fs.readFileSync(
    new URL('../src/components/canvas/AgentVideoSettings.vue', import.meta.url),
    'utf8',
  ),
)
const source = component.descriptor.scriptSetup.content.replace(
  /^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm,
  '',
)
function setup(patch = {}, extra = {}) {
  const emitted = []
  const props = {
    modelValue: {
      model: models.ANMIAO20_FAST_VIDEO_MODEL,
      ratio: '3:4',
      resolution: '720p',
      duration: 5,
      referenceMode: 'first_last_frame',
      generateAudio: true,
      ...patch,
    },
    references: [],
    referenceVideoCount: 0,
    allowSeedanceFrames: true,
    modelOptions: [{ value: models.ANMIAO20_FAST_VIDEO_MODEL, provider: 'lingke' }],
    disabled: false,
    compact: true,
    ...extra,
  }
  const context = vm.createContext({
    ...models,
    ...settings,
    defineProps: () => props,
    defineEmits:
      () =>
      (...args) =>
        emitted.push(args),
    computed: (read) => ({
      get value() {
        return read()
      },
    }),
    formatMiValue: String,
  })
  vm.runInContext(source, context)
  return {
    props,
    emitted,
    panel: vm.runInContext(
      '({ change, ratio, ratioLocked, resolutionOptions, durationOptions, modeOptions, modeVisible, price })',
      context,
    ),
  }
}

test('compact video settings retain mapped fast model choices and default ratio', () => {
  const { panel } = setup()
  assert.equal(panel.ratio.value, '3:4')
  assert.deepEqual(
    Array.from(panel.resolutionOptions.value, (item) => item.value),
    ['480p', '720p'],
  )
  assert.deepEqual(
    Array.from(panel.durationOptions.value, (item) => item.value),
    Array.from({ length: 12 }, (_, index) => index + 4),
  )
  assert.equal(panel.price.value, 0)
  assert.equal(panel.modeVisible.value, true)
})

test('control updates keep unrelated generation parameters and honor disabled state', () => {
  const { props, panel, emitted } = setup()
  panel.change('ratio', '16:9')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0][0], 'update:modelValue')
  assert.equal(emitted[0][1].ratio, '16:9')
  assert.equal(emitted[0][1].duration, 5)
  assert.equal(emitted[0][1].generateAudio, true)
  props.disabled = true
  panel.change('generateAudio', false)
  assert.equal(emitted.length, 1)
})

test('reference-controlled ratios and reference video mode restrictions remain enforced', () => {
  const framed = setup(
    { model: models.ANMIAO25_VIDEO_MODEL },
    { references: [{ url: 'https://media.test/frame.png' }] },
  )
  assert.equal(framed.panel.ratio.value, 'adaptive')
  assert.equal(framed.panel.ratioLocked.value, true)
  const video = setup(
    { model: models.ANMIAO25_VIDEO_MODEL, referenceMode: 'cankaosheng' },
    { referenceVideoCount: 1 },
  )
  assert.equal(video.panel.ratioLocked.value, false)
  assert.equal(video.panel.modeOptions.value[0].disabled, true)
  assert.equal(video.panel.modeOptions.value[1].disabled, undefined)
  const native = setup({ model: models.HAILUO_H3_VIDEO_MODEL })
  assert.equal(native.panel.ratioLocked.value, true)
  assert.equal(native.panel.modeOptions.value.length, 1)
})

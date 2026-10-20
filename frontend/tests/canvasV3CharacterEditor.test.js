import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import {
  CHARACTER_FACE_GROUPS,
  CHARACTER_BODY_CONTROLS,
  CHARACTER_MAKEUP_GROUPS,
  CHARACTER_VOICE_LIBRARY,
  characterStudioRecord,
  characterStudioInstruction,
  characterStudioVisualConfig,
} from '../src/features/canvas-v3/config/characterStudioControls.js'

const componentPromise = readFile(
  new URL('../src/features/canvas-v3/components/CharacterStudioEditor.vue', import.meta.url),
  'utf8',
).then(async (source) => {
  assert.doesNotMatch(source, /v-html|innerHTML|fetch\(/)
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'character-editor-test', inlineTemplate: true })
  const moduleSource = compiled.content
    .replace(/from (['"])vue\1/g, `from '${import.meta.resolve('vue')}'`)
    .replace(
      /from (['"])\.\.\/config\/characterStudioControls\.js\1/g,
      `from '${new URL('../src/features/canvas-v3/config/characterStudioControls.js', import.meta.url).href}'`,
    )
    .replace(
      /import CanvasIcon from ['"]\.\/CanvasIcon\.vue['"]/,
      'const CanvasIcon = { render: () => null }',
    )
  return (
    await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)
  ).default
})

const node = (type, text = '') => ({
  type,
  text,
  props: {},
  children: [],
  parent: null,
  clicks: 0,
  click() {
    this.clicks++
  },
})
const detach = (child) => {
  if (!child.parent) return
  const children = child.parent.children
  const index = children.indexOf(child)
  if (index >= 0) children.splice(index, 1)
  child.parent = null
}
const renderer = createRenderer({
  createElement: (type) => node(type),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (target, text) => {
    target.text = text
  },
  setElementText: (target, text) => {
    target.text = text
    target.children = []
  },
  patchProp: (target, key, _old, value) => {
    target.props[key] = value
  },
  parentNode: (target) => target.parent,
  nextSibling: (target) =>
    target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
  insert: (child, parent, anchor = null) => {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach,
})
const all = (target, predicate) => [
  ...(predicate(target) ? [target] : []),
  ...target.children.flatMap((child) => all(child, predicate)),
]
const text = (target) =>
  `${target.type === '#comment' ? '' : target.text}${target.children.map(text).join('')}`
const button = (root, label) =>
  all(
    root,
    (item) =>
      item.type === 'button' && (item.props['aria-label'] === label || text(item).trim() === label),
  )[0]
const input = (root, label) =>
  all(root, (item) => item.type === 'input' && item.props['aria-label'] === label)[0]

test('blank editor names and voice categories use model terminology but saved names and stable voice IDs remain unchanged', () => {
  assert.equal(characterStudioRecord().name, '未命名模特')
  assert.equal(characterStudioRecord({ name: '角色甲' }).name, '角色甲')
  const cartoonVoice = CHARACTER_VOICE_LIBRARY.find((voice) => voice.id === 'pig-character')
  assert.ok(cartoonVoice)
  assert.equal(cartoonVoice.name, '卡通猪小琪')
  assert.equal(cartoonVoice.gender, '卡通')
})

async function mount(overrides = {}) {
  const Editor = await componentPromise
  const state = reactive({
    character: {
      id: 'character-1',
      name: '角色甲',
      gender: '女',
      imageUrl: 'https://example.test/character.jpg',
      config: {},
    },
    busy: false,
    models: [{ value: 'real-model', label: '已接入模型' }],
    ...overrides,
  })
  const events = []
  const root = node('root')
  const app = renderer.createApp({
    setup: () => () =>
      h(Editor, {
        ...state,
        onChange: (value) => events.push(['change', value]),
        onGenerate: (value) => events.push(['generate', value]),
        onSave: (value) => events.push(['save', value]),
        onBack: () => events.push(['back']),
        onAgeVariant: (value) => events.push(['age-variant', value]),
        onUploadReference: (value) => events.push(['upload-reference', value]),
        onChooseReference: (value) => events.push(['choose-reference', value]),
        onUploadDecal: (value) => events.push(['upload-decal', value]),
        onDesignVoice: (value) => events.push(['design-voice', value]),
      }),
  })
  app.mount(root)
  return { root, state, events, app }
}

test('character controls cover all observed groups with zero defaults and clamp invalid values', () => {
  assert.deepEqual(
    CHARACTER_FACE_GROUPS.map((group) => group.label),
    ['皮肤', '眉眼', '鼻子', '嘴唇', '脸部', '妆造'],
  )
  const record = characterStudioRecord({
    name: '角色',
    config: {
      facial: { noseSize: 999, skinTexture: -500, eyeLight: 'invented' },
      body: { bust: -90, height: 999 },
      styleReferenceUrls: ['javascript:bad', 'https://example.test/ref.jpg'],
      makeup: { lipstick: '车厘子' },
    },
  })
  assert.equal(record.config.facial.noseSize, 100)
  assert.equal(record.config.facial.skinTexture, 0)
  assert.equal(record.config.facial.eyeLight, '无')
  assert.equal(record.config.body.bust, -90)
  assert.equal(record.config.body.height, 100)
  assert.equal(record.config.makeup.lipstick, '车厘子')
  assert.deepEqual(record.config.styleReferenceUrls, ['https://example.test/ref.jpg'])
  const defaults = characterStudioRecord({}).config
  assert.deepEqual(characterStudioRecord({ config: null }).config, defaults)
  for (const control of CHARACTER_FACE_GROUPS.flatMap((group) => group.controls))
    assert.equal(defaults.facial[control.key], 0)
  for (const control of CHARACTER_BODY_CONTROLS) assert.equal(defaults.body[control.key], 0)
  assert.equal(CHARACTER_BODY_CONTROLS.length, 18)
  assert.equal(CHARACTER_MAKEUP_GROUPS.length, 11)
  assert.equal(CHARACTER_VOICE_LIBRARY.length, 20)
})

test('visual instructions carry concrete controls and staging decals without voice changing images', () => {
  const instruction = characterStudioInstruction(
    {
      config: {
        facial: { noseSize: -25, skinWhitening: 30, removeBlemishes: true },
        clothes: { hairStyle: '高马尾', hairCategory: '古风', hairColor: '#000000' },
        features: { decals: [{ kind: 'mole', x: 40, y: 25, rotation: 15 }] },
        voice: { description: 'secret voice-only description' },
      },
    },
    '保留原来的眼睛',
  )
  assert.match(instruction, /鼻子大小：-25/)
  assert.match(instruction, /皮肤美白：\+30/)
  assert.match(instruction, /横向 40%、纵向 25%/)
  assert.match(instruction, /古风 \/ 高马尾/)
  assert.match(instruction, /保留原来的眼睛/)
  assert.doesNotMatch(instruction, /secret voice-only description/)
  assert.match(instruction, /不是实际尺寸/)
})

test('visual fingerprint excludes voice, identity, task settings and applied marker metadata', () => {
  const baseline = characterStudioVisualConfig({})
  assert.equal(
    characterStudioVisualConfig({
      name: '角色',
      config: { voice: { pitch: 40 }, model: 'model', appliedVisualConfig: 'old-marker' },
    }),
    baseline,
  )
  assert.notEqual(characterStudioVisualConfig({ config: { facial: { noseSize: -5 } } }), baseline)
})

test('editor changes are isolated and stay pending until the real result includes its applied config marker', async () => {
  const { root, state, events, app } = await mount()
  input(root, '皮肤透亮').props.onInput({ target: { value: '35' } })
  await nextTick()
  assert.equal(events.at(-1)[1].config.facial.skinBrightness, 35)
  assert.equal(state.character.config.facial, undefined)
  assert.match(text(root), /调整待生成生效/)
  state.character = { ...state.character, config: { facial: { skinBrightness: 1 } } }
  await nextTick()
  assert.equal(
    input(root, '皮肤透亮').props.value,
    35,
    'same-id parent echoes cannot erase draft sliders',
  )
  button(root, '确认生成').props.onClick()
  assert.equal(events.at(-1)[0], 'generate')
  assert.equal(events.at(-1)[1].kind, 'edit')
  assert.equal(events.at(-1)[1].character.config.facial.skinBrightness, 35)
  assert.equal(
    all(root, (item) => item.type === 'img')[0].props.src,
    'https://example.test/character.jpg',
  )
  state.character = { ...state.character, imageUrl: 'https://example.test/real-generated.jpg' }
  await nextTick()
  assert.equal(
    all(root, (item) => item.type === 'img')[0].props.src,
    'https://example.test/real-generated.jpg',
  )
  assert.match(
    text(root),
    /调整待生成生效/,
    'a new image URL alone cannot apply unsent slider changes',
  )
  state.character = {
    ...state.character,
    config: {
      ...state.character.config,
      appliedVisualConfig: characterStudioVisualConfig({
        config: { facial: { skinBrightness: 35 } },
      }),
    },
  }
  await nextTick()
  assert.doesNotMatch(text(root), /调整待生成生效/)
  app.unmount()
})

test('metadata-only saved adjustments stay pending after reopening while a recorded applied snapshot does not', async () => {
  const saved = {
    id: 'saved-character',
    name: '保存了参数的角色',
    imageUrl: 'https://example.test/original.jpg',
    config: { facial: { skinBrightness: 25 } },
  }
  const first = await mount({ character: saved })
  assert.match(text(first.root), /调整待生成生效/)
  button(first.root, '保存').props.onClick()
  const snapshot = first.events.at(-1)[1].character
  first.app.unmount()
  const reopened = await mount({ character: snapshot })
  assert.equal(input(reopened.root, '皮肤透亮').props.value, 25)
  assert.match(text(reopened.root), /调整待生成生效/)
  reopened.app.unmount()
  const applied = await mount({
    character: {
      ...saved,
      config: { ...saved.config, appliedVisualConfig: characterStudioVisualConfig(saved) },
    },
  })
  assert.doesNotMatch(text(applied.root), /调整待生成生效/)
  applied.app.unmount()
})

test('an older completed generation cannot mark newer local adjustments as applied', async () => {
  const { root, state, app } = await mount()
  input(root, '皮肤透亮').props.onInput({ target: { value: '20' } })
  const submittedSnapshot = characterStudioVisualConfig({
    config: { facial: { skinBrightness: 20 } },
  })
  input(root, '皮肤透亮').props.onInput({ target: { value: '60' } })
  state.character = {
    ...state.character,
    imageUrl: 'https://example.test/finished-job.jpg',
    config: { appliedVisualConfig: submittedSnapshot },
  }
  await nextTick()
  assert.equal(input(root, '皮肤透亮').props.value, 60)
  assert.match(text(root), /调整待生成生效/)
  app.unmount()
})

test('undo, restore, group reset and changing character id preserve expected edit history', async () => {
  const { root, state, events, app } = await mount()
  input(root, '皮肤透亮').props.onInput({ target: { value: '35' } })
  await nextTick()
  button(root, '撤销调整').props.onClick()
  await nextTick()
  assert.equal(input(root, '皮肤透亮').props.value, 0)
  button(root, '恢复调整').props.onClick()
  await nextTick()
  assert.equal(input(root, '皮肤透亮').props.value, 35)
  button(root, '重置').props.onClick()
  await nextTick()
  assert.equal(events.at(-1)[1].config.facial.skinBrightness, 0)
  state.character = {
    id: 'other-character',
    name: '角色乙',
    imageUrl: 'https://example.test/other.jpg',
    config: { facial: { skinBrightness: 17 } },
  }
  await nextTick()
  assert.equal(input(root, '皮肤透亮').props.value, 17)
  assert.equal(button(root, '撤销调整').props.disabled, true)
  app.unmount()
})

test('save and save-and-insert emit distinct explicit requests and asset generation can be opted out', async () => {
  const { root, events, app } = await mount()
  button(root, '保存').props.onClick()
  assert.equal(events.at(-1)[0], 'save')
  assert.equal(events.at(-1)[1].withAssets, true)
  assert.equal(events.at(-1)[1].insert, false)
  const checkbox = all(root, (item) => item.type === 'input' && item.props.type === 'checkbox').at(
    -1,
  )
  checkbox.props.onChange({ target: { checked: false } })
  await nextTick()
  button(root, '保存并添加到画布').props.onClick()
  assert.equal(events.at(-1)[1].withAssets, false)
  assert.equal(events.at(-1)[1].insert, true)
  assert.equal(events.at(-1)[1].character.imageUrl, 'https://example.test/character.jpg')
  app.unmount()
})

test('all feature decals support accessible keyboard placement, rotate, remove and real custom uploads', async () => {
  const { root, events, app } = await mount()
  button(root, '脸部 & 身体特征').props.onClick()
  await nextTick()
  assert.match(text(root), /纹身 & 疤痕/)
  button(root, '痣').props.onClick()
  await nextTick()
  const decal = button(root, '痣贴图，方向键移动')
  assert.ok(decal)
  decal.props.onKeydown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} })
  await nextTick()
  assert.equal(events.at(-1)[1].config.features.decals[0].x, 51)
  assert.match(text(root), /当前为布局示意/)
  button(root, '删除').props.onClick()
  await nextTick()
  assert.equal(events.at(-1)[1].config.features.decals.length, 0)
  const upload = all(root, (item) => item.type === 'input' && item.props.type === 'file')[0]
  const file = { type: 'image/png', name: 'decal.png' }
  const target = { files: [file], value: 'fakepath' }
  upload.props.onChange({ target })
  assert.deepEqual(events.at(-1), ['upload-decal', file])
  assert.equal(target.value, '')
  app.unmount()
})

test('clothes exposes captured categories, real source upload and selected style references', async () => {
  const { root, state, events, app } = await mount()
  button(root, '服装造型').props.onClick()
  await nextTick()
  assert.ok(button(root, '仙侠'))
  button(root, '高马尾').props.onClick()
  assert.equal(events.at(-1)[1].config.clothes.hairStyle, '高马尾')
  button(root, '服装').props.onClick()
  await nextTick()
  assert.ok(button(root, '家居 3'))
  button(root, 'AI 生成').props.onClick()
  await nextTick()
  button(root, '选择参考图').props.onClick()
  assert.deepEqual(events.at(-1), ['choose-reference', { purpose: 'styling' }])
  const file = { name: 'style.jpg', type: 'image/jpeg' }
  const target = { files: [file], value: 'fakepath' }
  all(root, (item) => item.type === 'input' && item.props.type === 'file')[0].props.onChange({
    target,
  })
  assert.deepEqual(events.at(-1), ['upload-reference', file])
  state.character = {
    ...state.character,
    config: { styleReferenceUrls: ['https://example.test/style.jpg'] },
  }
  await nextTick()
  assert.equal(
    all(root, (item) => item.type === 'img' && item.props.alt === '造型参考图 1')[0].props.src,
    'https://example.test/style.jpg',
  )
  app.unmount()
})

test('voice library filters and design emits configuration without fake generated audio', async () => {
  const { root, events, app } = await mount()
  const imageGenerateButton = button(root, '确认生成')
  button(root, '音色音调').props.onClick()
  await nextTick()
  assert.equal(button(root, '确认生成'), undefined)
  assert.equal(button(root, '智能调整'), undefined)
  imageGenerateButton.props.onClick()
  assert.equal(
    events.some((event) => event[0] === 'generate'),
    false,
  )
  assert.ok(button(root, '保存'), 'voice profile settings remain saveable')
  assert.match(text(root), /播放使用浏览器系统音色示范/)
  button(root, '筛选音色').props.onClick()
  await nextTick()
  button(root, '儿童').props.onClick()
  await nextTick()
  assert.match(text(root), /聪明男童/)
  assert.doesNotMatch(text(root), /霸道青年音色/)
  button(root, '我的音色').props.onClick()
  await nextTick()
  assert.match(text(root), /暂无音色数据/)
  button(root, 'AI 生成').props.onClick()
  await nextTick()
  button(root, '生成音色').props.onClick()
  assert.equal(events.at(-1)[0], 'design-voice')
  assert.match(text(root), /未配置时不会提交或扣费/)
  assert.equal(all(root, (item) => item.type === 'audio').length, 0)
  app.unmount()
})

test('an explicit voice entry opens the real voice library and selections remain draft-only', async () => {
  const { root, state, events, app } = await mount({ initialTab: 'voice' })
  const original = JSON.parse(JSON.stringify(state.character))
  assert.equal(button(root, '音色音调').props['aria-pressed'], true)
  assert.ok(input(root, '搜索音色'))
  assert.equal(input(root, '皮肤透亮'), undefined)
  assert.equal(button(root, '确认生成'), undefined)
  assert.deepEqual(events, [], 'opening the voice entry cannot mutate, save, or generate')
  const voices = all(
    root,
    (item) => item.type === 'button' && item.props.class === 'cv3-character-voice-select',
  )
  assert.equal(voices.length, CHARACTER_VOICE_LIBRARY.length)
  voices[0].props.onClick()
  await nextTick()
  assert.deepEqual(
    events.map(([event]) => event),
    ['change'],
  )
  assert.equal(events[0][1].config.voice.selectedVoice, CHARACTER_VOICE_LIBRARY[0].id)
  assert.equal(voices[0].props['aria-pressed'], true)
  assert.deepEqual(
    state.character,
    original,
    'selecting a voice cannot mutate parent character data',
  )
  assert.equal(button(root, '保存').props.disabled, false)
  app.unmount()
})

test('normal editing and invalid initial tabs fall back to face without side effects', async () => {
  for (const overrides of [{}, { initialTab: 'injected' }, { initialTab: '__proto__' }]) {
    const { root, events, app } = await mount(overrides)
    assert.equal(button(root, '脸部精修').props['aria-pressed'], true)
    assert.ok(input(root, '皮肤透亮'))
    assert.equal(input(root, '搜索音色'), undefined)
    assert.deepEqual(events, [])
    app.unmount()
  }
})

test('changing the entry tab only navigates and preserves edits and undo history without emitting', async () => {
  const { root, state, events, app } = await mount()
  const original = JSON.parse(JSON.stringify(state.character))
  input(root, '皮肤透亮').props.onInput({ target: { value: '35' } })
  await nextTick()
  assert.equal(events.length, 1)
  state.initialTab = 'voice'
  await nextTick()
  assert.equal(button(root, '音色音调').props['aria-pressed'], true)
  assert.ok(input(root, '搜索音色'))
  assert.equal(events.length, 1)
  state.initialTab = 'body'
  await nextTick()
  assert.equal(button(root, '身材塑形').props['aria-pressed'], true)
  assert.equal(events.length, 1)
  state.initialTab = 'unknown'
  await nextTick()
  assert.equal(button(root, '脸部精修').props['aria-pressed'], true)
  assert.equal(input(root, '皮肤透亮').props.value, 35)
  assert.equal(events.length, 1)
  assert.deepEqual(state.character, original)
  button(root, '撤销调整').props.onClick()
  await nextTick()
  assert.equal(input(root, '皮肤透亮').props.value, 0)
  assert.deepEqual(
    events.map(([event]) => event),
    ['change', 'change'],
  )
  app.unmount()
})

test('changing character identity resets the default editor to face while respecting an explicit voice entry', async () => {
  const normal = await mount()
  button(normal.root, '音色音调').props.onClick()
  await nextTick()
  normal.state.character = { ...normal.state.character, id: 'normal-next' }
  await nextTick()
  assert.equal(button(normal.root, '脸部精修').props['aria-pressed'], true)
  assert.deepEqual(normal.events, [])
  normal.app.unmount()
  const explicit = await mount({ initialTab: 'voice' })
  explicit.state.character = { ...explicit.state.character, id: 'voice-next' }
  await nextTick()
  assert.equal(button(explicit.root, '音色音调').props['aria-pressed'], true)
  assert.deepEqual(explicit.events, [])
  explicit.app.unmount()
})

test('busy state gates paid and metadata actions without silently creating anything', async () => {
  const { root, events, app } = await mount({ busy: true })
  assert.equal(button(root, '处理中…').props.disabled, true)
  assert.equal(button(root, '保存').props.disabled, true)
  input(root, '皮肤透亮').props.onInput({ target: { value: '66' } })
  button(root, '保存').props.onClick()
  assert.deepEqual(events, [])
  app.unmount()
})

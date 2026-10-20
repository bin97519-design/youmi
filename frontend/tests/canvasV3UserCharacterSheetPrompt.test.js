import test from 'node:test'
import assert from 'node:assert/strict'
import {
  characterStudioAssetFormat,
  characterStudioAssetPrompt,
  CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE,
} from '../src/features/canvas-v3/config/characterStudioAssetFormats.js'
import {
  characterStudioGenerationSpec,
  characterStudioPrompt,
} from '../src/features/canvas-v3/config/characterStudioRuntime.js'
import {
  imageGridTemplate,
  imageGridPreset,
} from '../src/features/canvas-v3/config/imageGridTemplates.js'

const model = { value: 'configured-model', label: '已配置图片模型' }
const character = (changes = {}) => ({
  id: 'mine-model',
  name: '用户模特',
  imageUrl: 'https://assets.example.com/reference.jpg',
  config: {},
  ...changes,
})
const settings = (changes = {}) => ({
  character: character(),
  kind: 'assets',
  assetType: 'character-sheet',
  model: model.value,
  models: [model],
  ratio: '16:9',
  resolution: '2K',
  ...changes,
})
const sheetPrompt = (changes = {}) =>
  characterStudioPrompt(character(changes), 'assets', '', 'character-sheet')

test('only the user-supplied character-sheet template changes provenance and version', () => {
  const sheet = characterStudioAssetFormat('character-sheet')
  assert.equal(sheet.label, '角色设定图')
  assert.equal(sheet.ratio, '16:9')
  assert.equal(sheet.formatVersion, 'user-model-sheet-v2')
  assert.equal(sheet.promptSource, 'user-provided')
  assert.equal(sheet.promptSourceLabel, '用户模板＋参考画风自适应与3＋6布局校准')
  assert.ok(Object.isFrozen(sheet))
  assert.match(characterStudioAssetPrompt('character-sheet'), /16:9 横版画幅/)
  for (const type of ['full-body', 'half-body', 'emotion-grid']) {
    const format = characterStudioAssetFormat(type)
    assert.equal(format.formatVersion, 'libtv-assets-visual-v1')
    assert.equal(format.promptSource, 'visual-reconstruction')
    assert.match(format.promptSourceLabel, /非原始提示词/)
    assert.match(characterStudioAssetPrompt(type), /不要强制转换为写实风格/)
  }
})

test('the user sheet locks all identity features while preserving the reference visual style', () => {
  const prompt = sheetPrompt({ gender: '女', ageGroup: '成年' })
  for (const feature of [
    '同一名女性模特',
    '不是多人合照',
    '脸型',
    '五官比例',
    '眼睛形状',
    '鼻型',
    '嘴唇',
    '眉形',
    '发际线',
    '肤色',
    '年龄感',
    '身材比例',
    '个人辨识度',
    '不能换脸',
    '不能美化成另一个人',
    '85mm',
    '真实皮肤纹理',
    '模特档案',
    '专业选角资料风格',
    '高分辨率',
    '边缘干净',
    '标题',
    '标注',
    '箭头',
    '边框',
    '水印',
  ]) {
    assert.ok(prompt.includes(feature), feature)
  }
  assert.match(prompt, /纯白色?无缝背景|纯白色?背景/)
  assert.match(prompt, /柔和均匀布光|柔和.*均匀/)
  assert.match(prompt, /不裁切头部、手部和脚部|头部.*手部.*脚部.*不裁切/)
  assert.match(prompt, /不要强制转换为写实风格/)
})

test('the original user template is retained but photographic rendering is conditional in effective prompts', () => {
  assert.match(CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE, /专业的真人模特角色设定表/)
  assert.match(CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE, /85mm人像摄影质感/)
  assert.match(CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE, /真实皮肤纹理/)
  assert.match(CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE, /同一名女性模特/)
  assert.match(
    CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE,
    /\{填写年龄、气质、脸型、肤色、发型、身材\}/,
  )
  for (const description of ['真人女性产品讲解员', '蓝发双辫动漫插画少女', '三维 CG 角色']) {
    const prompt = sheetPrompt({ description })
    assert.match(prompt, /(?:仅|只|若|当|如)[^\n]*真人[^\n]*85mm|85mm[^\n]*(?:仅|只)[^\n]*真人/)
    assert.match(prompt, /插画/)
    assert.match(prompt, /动漫/)
    assert.match(prompt, /CG/)
    assert.match(prompt, /线条/)
    assert.match(prompt, /上色/)
    assert.match(prompt, /渲染/)
    assert.match(prompt, /不要强制转换为写实风格/)
    assert.doesNotMatch(prompt, /\n使用我提供的模特参考图，生成一张专业的真人模特角色设定表。/)
    assert.doesNotMatch(prompt, /\n正面平视镜头，85mm人像摄影质感/)
  }
})

test('the nine views retain the user-specified directions and expressions in exact reading order', () => {
  const prompt = sheetPrompt()
  assert.match(prompt, /左(?:侧|半区).*3.*全身/)
  assert.match(prompt, /正面自然站立全身照[\s\S]*左侧\s*90\s*度侧面全身照[\s\S]*背面自然站立全身照/)
  assert.match(prompt, /右(?:侧|半区).*3\s*列\s*[×x]\s*2\s*行/)
  assert.match(
    prompt,
    /正面平静表情[\s\S]*右前方\s*45\s*度微笑[\s\S]*右侧\s*90\s*度侧脸[\s\S]*背面发型展示[\s\S]*左前方\s*45\s*度自然表情[\s\S]*正面轻微微笑/,
  )
  assert.match(prompt, /头顶.*鞋底/)
  assert.match(prompt, /相同身高、头身比、肩宽、腰臀比例和腿部比例/)
  assert.doesNotMatch(prompt, /上排从左到右为正面、微侧面、侧面/)
  assert.doesNotMatch(prompt, /下排从左到右为背面、自然微笑正面、平静正面/)
})

test('the fixed three-plus-six sheet contains nine complete views rather than detail collages', () => {
  const prompt = sheetPrompt({ description: '蓝发双辫动漫角色，保持原画风' })
  assert.match(prompt, /左[^\n]*47%/)
  assert.match(prompt, /右[^\n]*51%/)
  assert.match(prompt, /3\s*列\s*[×x]\s*2\s*行/)
  assert.match(prompt, /每[^\n]*格[^\n]*完整[^\n]*头顶/)
  assert.match(prompt, /脸(?:部)?|面部/)
  assert.match(prompt, /背脑|后脑/)
  assert.match(prompt, /颈肩|颈部.*双肩/)
  assert.match(prompt, /上胸/)
  for (const forbiddenDetail of ['眼睛', '嘴', '耳', '鞋', '衣服', '配饰', '纹身', '辫子']) {
    const prohibition = prompt
      .split('\n')
      .find(
        (line) =>
          /禁止|不得|不要|不能|不生成|不做/.test(line) &&
          line.includes(forbiddenDetail) &&
          /局部|细节/.test(line),
      )
    assert.ok(prohibition, `missing explicit detail-collage prohibition: ${forbiddenDetail}`)
  }
  assert.match(
    prompt,
    /不(?:增加|添加|生成)[^\n]*(?:视图|格子|画格)|禁止[^\n]*额外[^\n]*(?:视图|格子|画格)/,
  )
})

test('missing appearance slots preserve the reference without generating unsupported facts', () => {
  const prompt = sheetPrompt()
  assert.doesNotMatch(prompt, /\{[^}]*\}|请填写|undefined|null/)
  assert.match(prompt, /参考图/)
  assert.match(prompt, /未(?:填写|提供|明确)[\s\S]*参考图|以参考图.*为准/)
  assert.doesNotMatch(prompt, /同一名女性模特|同一名男性模特/)
  assert.doesNotMatch(prompt, /\d+\s*岁|\d+\s*(?:cm|厘米)|羊绒|真丝|棉麻/)
})

test('explicit appearance fields are used but identity-changing beauty controls are excluded only from the sheet', () => {
  const selected = character({
    gender: '女',
    ageGroup: '中年',
    description: '沉静自然，有左侧浅酒窝',
    config: {
      features: {
        faceShape: '方脸',
        skinTone: '小麦色',
        hairStyle: '长发',
        hairColor: '棕色',
      },
      clothes: {
        upper: '蓝色衬衫',
        lower: '深色长裤',
        shoes: '白色运动鞋',
        accessories: '银色耳钉',
        hairStyle: '低马尾',
        hairColor: '#171412',
      },
      facial: { eyeSizeLeft: 25, noseBridge: -30, removeBlemishes: true },
      body: { bust: 40, hips: 30, shoulderWidth: -20, height: 10 },
    },
  })
  const prompt = characterStudioPrompt(selected, 'assets', '', 'character-sheet')
  for (const field of [
    '中年',
    '沉静自然，有左侧浅酒窝',
    '方脸',
    '小麦色',
    '低马尾',
    '#171412',
    '蓝色衬衫',
    '深色长裤',
    '白色运动鞋',
    '银色耳钉',
  ])
    assert.ok(prompt.includes(field), field)
  assert.doesNotMatch(
    prompt,
    /眼睛大小（左）：|鼻梁：|自然去除斑点与痘痘|丰胸：|美臀：|肩膀宽度：|AI 增高：/,
  )
  for (const assetType of ['full-body', 'half-body', 'emotion-grid']) {
    const other = characterStudioPrompt(selected, 'assets', '', assetType)
    assert.match(other, /鼻梁：-30/)
    assert.match(other, /肩膀宽度：-20/)
  }
  assert.match(characterStudioPrompt(selected, 'edit'), /眼睛大小（左）：\+25/)
})

test('male and child identities are not replaced by an adult female model and retain safety checks', () => {
  const man = sheetPrompt({ gender: '男', ageGroup: '中年' })
  assert.match(man, /同一名男性模特/)
  assert.doesNotMatch(man, /同一名女性模特/)
  for (const gender of ['男', '女', '']) {
    const prompt = sheetPrompt({ gender, ageGroup: '儿童' })
    assert.doesNotMatch(prompt, /同一名女性模特|同一名男性模特|成年女性|成年男性/)
    assert.match(prompt, /符合年龄.*正常着装|正常着装[\s\S]*符合年龄/)
    assert.match(prompt, /不做成人化或性化塑形/)
    assert.throws(
      () =>
        characterStudioPrompt(
          character({ gender, ageGroup: '儿童' }),
          'assets',
          'nude',
          'character-sheet',
        ),
      /未成年模特/,
    )
  }
})

test('sheet requests preserve a confirmed ratio, selected model, reference and single-image scope', () => {
  for (const ratio of ['16:9', '1:1', '3:4']) {
    const spec = characterStudioGenerationSpec(settings({ ratio }))
    assert.equal(spec.model, model.value)
    assert.equal(spec.ratio, ratio)
    assert.equal(spec.resolution, '2K')
    assert.equal(spec.count, 1)
    assert.equal(spec.assetType, 'character-sheet')
    assert.equal(spec.formatVersion, 'user-model-sheet-v2')
    assert.equal(spec.promptSource, 'user-provided')
    assert.deepEqual(spec.referenceUrls, ['https://assets.example.com/reference.jpg'])
    assert.match(spec.prompt, new RegExp(`${ratio} `))
    assert.match(spec.prompt, /不擅自更改比例/)
    assert.equal(Object.hasOwn(spec, 'auth'), false)
    assert.equal(Object.hasOwn(spec, 'dryRun'), false)
    assert.ok(Object.isFrozen(spec))
  }
  assert.throws(
    () => characterStudioGenerationSpec(settings({ character: character({ imageUrl: '' }) })),
    /模特原图/,
  )
  assert.throws(() => characterStudioGenerationSpec(settings({ models: [] })), /已配置/)
})

test('the image-grid character-sheet entry shares the user template and its 16:9 default only', () => {
  const template = imageGridTemplate('character-sheet')
  assert.equal(template.ratio, '16:9')
  assert.equal(template.prompt, characterStudioAssetPrompt('character-sheet'))
  assert.deepEqual(imageGridPreset('character-sheet').params, { ratio: '16:9', count: '1张' })
  assert.equal(imageGridTemplate('product-sheet').ratio, '4:3')
  assert.doesNotMatch(imageGridTemplate('product-sheet').prompt, /85mm|女性模特|脸型/)
  assert.doesNotMatch(imageGridTemplate('face-three').prompt, /85mm|左侧90度侧面全身照/)
})

test('create, edit and age operations do not inherit the new asset-only template', () => {
  const selected = character({ config: { ageTarget: '老年' } })
  for (const kind of ['create', 'edit', 'age']) {
    const prompt = characterStudioPrompt(selected, kind)
    assert.equal(prompt, characterStudioPrompt(selected, kind, '', 'character-sheet'))
    assert.doesNotMatch(prompt, /85mm|左侧\s*90\s*度侧面全身照|专业选角资料风格/)
    const spec = characterStudioGenerationSpec(settings({ character: selected, kind }))
    for (const key of ['assetType', 'formatVersion', 'promptSource'])
      assert.equal(Object.hasOwn(spec, key), false)
  }
})

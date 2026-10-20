// Public template portraits observed in the reference character studio. These are
// templates, never fabricated user assets or a promise of access to LibTV's models.
const templates = [
  ['003', '甜妹/清新少女', '女', '青年', '东亚'],
  ['001', '霸总/精英大佬', '男', '青年', '东亚'],
  ['002', '温柔熟男/理想男友', '男', '青年', '东亚'],
  ['004', '清冷千金/白切黑女主', '女', '青年', '东亚'],
  ['005', '古风男主', '男', '青年', '东亚'],
  ['006', '古风女主', '女', '青年', '东亚'],
  ['007', '恶毒女配/白莲花', '女', '青年', '东亚'],
  ['010', '正派长辈/父', '男', '中年', '东亚'],
  ['011', '正派长辈/母', '女', '中年', '东亚'],
  ['012', '反派长辈/势利亲戚', '男', '老年', '东亚'],
  ['013', '反派长辈/势利亲戚', '女', '老年', '东亚'],
  ['014', '生活方式普通人', '男', '青年', '东亚'],
  ['015', '生活方式普通人', '女', '青年', '东亚'],
  ['016', '时尚感亚洲男生', '男', '青年', '东亚'],
  ['018', '时尚感亚洲女生', '女', '青年', '东亚'],
  ['022', '时尚感欧美男生', '男', '青年', '欧美'],
  ['021', '时尚感欧美女生', '女', '青年', '欧美'],
  ['008', '小男孩', '男', '儿童', '东亚'],
  ['009', '小女孩', '女', '儿童', '东亚'],
  ['019', '时尚感亚洲女生', '女', '青年', '东亚'],
  ['020', '时尚感亚洲女生', '女', '青年', '东亚'],
  ['017', '时尚感亚洲男生', '男', '青年', '东亚'],
  ['023', '时尚感欧美女生', '女', '青年', '欧美'],
]

// These four URLs were supplied and visually verified. Do not infer sibling
// assets for other templates, or label the original site's prompts as retrieved.
const publicReference003 = (type, name, file, preview) =>
  Object.freeze({
    type,
    name,
    url: `https://libtv-res.liblib.art/tool/character/003_${file}_1.png?x-oss-process=image/resize,h_440,m_lfit/format,webp/ignore-error,1`,
    previewUrl: `/canvas-v3/characters/assets/003-${preview}.webp`,
    source: 'public-reference',
    promptSource: 'not-retrieved',
    sourceUrl: `https://libtv-res.liblib.art/tool/character/003_${file}_1.png?x-oss-process=image/resize,h_440,m_lfit/format,webp/ignore-error,1`,
  })
const reference003 = Object.freeze([
  publicReference003('full-body', '全身图', 'full_body', 'full-body'),
  publicReference003('half-body', '上身图', 'face_closeup', 'face-closeup'),
  publicReference003('emotion-grid', '表情九宫格', 'expression_grid', 'expression-grid'),
  publicReference003('character-sheet', '角色设定图', 'character_sheet', 'character-sheet'),
])

export const CHARACTER_STUDIO_TEMPLATES = Object.freeze(
  templates.map(([id, name, gender, ageGroup, culture]) => {
    const reference = id === '003' ? reference003 : null
    const imageUrl =
      reference?.[0].url ||
      `https://libtv-res.liblib.art/tool/character/${id}_full_body_t.png?x-oss-process=image/resize,w_800,m_lfit/format,webp/ignore-error,1`
    return Object.freeze({
      id: `official-${id}`,
      name,
      gender,
      ageGroup,
      culture,
      imageUrl,
      coverUrl: imageUrl,
      sourceImageUrl: imageUrl,
      previewUrl: `/canvas-v3/characters/${id}.webp`,
      description: `${name}，${ageGroup}模特参考，保持人物身份与服装一致。`,
      official: true,
      ...(reference
        ? {
            assetPreviewUrl: reference[0].previewUrl,
            source: 'public-reference',
            promptSource: 'not-retrieved',
            sourceUrl: reference[0].sourceUrl,
          }
        : {}),
      config: {
        templateId: id,
        era: ['005', '006'].includes(id) ? '古风' : '现代',
        ...(reference ? { assets: Object.freeze(reference.slice(1)) } : {}),
      },
    })
  }),
)

const text = (value) => (typeof value === 'string' ? value.trim() : '')
const bundledPreviewUrls = new Set(
  CHARACTER_STUDIO_TEMPLATES.flatMap((item) => [item.previewUrl, item.assetPreviewUrl]).filter(
    Boolean,
  ),
)

function currentPreviewSource(record) {
  const imageUrl = text(record?.imageUrl) || text(record?.coverUrl)
  // A saved copy can reuse an official portrait only while its current original
  // is exactly that template's source. Metadata must not hide a later user edit.
  const template = CHARACTER_STUDIO_TEMPLATES.find((item) => item.imageUrl === imageUrl)
  const candidate = text(record?.previewUrl)
  const previewUrl = imageUrl && !template && bundledPreviewUrls.has(candidate) ? '' : candidate
  return { imageUrl, template, previewUrl }
}

/** Display-only cutout for library/editor portraits; never a generation asset. */
export function characterStudioPortraitPreview(record = {}) {
  const { imageUrl, template, previewUrl } = currentPreviewSource(record)
  return template?.previewUrl || previewUrl || imageUrl
}

/** Keep verified white-background assets separate from transparent portraits. */
export function characterStudioAssetPreview(record = {}) {
  const { imageUrl, template, previewUrl } = currentPreviewSource(record)
  return template?.assetPreviewUrl || template?.previewUrl || previewUrl || imageUrl
}

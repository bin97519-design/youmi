const style01 = new URL(
  '../assets/emotions/fcf8ef980afd3acabd1a3121633d9cfd1858787a.webp',
  import.meta.url,
).href
const style02 = new URL(
  '../assets/emotions/fa7a23dd2eb7f4985c8aa305f0ab39ff150250a9.webp',
  import.meta.url,
).href
const style03 = new URL(
  '../assets/emotions/f860884a22d69d14ea6d516e597aaab9af76f616.webp',
  import.meta.url,
).href
const style04 = new URL(
  '../assets/emotions/ef62d88906e06c3416a7d04497482c5eb8a01927.webp',
  import.meta.url,
).href
const style05 = new URL(
  '../assets/emotions/d29f7057ce1f72438159718adb2d231de2be149f.webp',
  import.meta.url,
).href
const style06 = new URL(
  '../assets/emotions/c9ab7ed41e7a740c10e264c8505870509586c4c3.webp',
  import.meta.url,
).href
const style07 = new URL(
  '../assets/emotions/ba8549aa963901567fb8f56f32233a4487930687.webp',
  import.meta.url,
).href
const style08 = new URL(
  '../assets/emotions/ae94a80a000100f7521d45b162531a7d7389a180.webp',
  import.meta.url,
).href
const style09 = new URL(
  '../assets/emotions/a60a8091fe682a14f32df3ee9de9a12a79f395df.webp',
  import.meta.url,
).href
const style10 = new URL(
  '../assets/emotions/a30b34e052b59547252f1a478785902b5cf7757f.webp',
  import.meta.url,
).href
const style11 = new URL(
  '../assets/emotions/a01bac0d530aed666e68a87869ad0b694a6a1ec3.webp',
  import.meta.url,
).href
const style12 = new URL(
  '../assets/emotions/9a18f44a8173e49d183422c60c1b98d6cd7f42c7.webp',
  import.meta.url,
).href
const style13 = new URL(
  '../assets/emotions/85f26fe2f1def1def0be41789e3b53a0a81d4518.webp',
  import.meta.url,
).href
const style14 = new URL(
  '../assets/emotions/7bb8214329026230e8312c404dba211d63b32993.webp',
  import.meta.url,
).href
const style15 = new URL(
  '../assets/emotions/7af110f648cab83296beaf24bbf9de335c5fe939.webp',
  import.meta.url,
).href

export const STYLE_GALLERY_TABS = ['风格广场', '我的收藏', '最近使用']
export const STYLE_CATEGORIES = [
  '推荐',
  '摄影写真',
  '电商营销',
  '动漫游戏',
  '风格插画',
  '平面设计',
  '建筑及室内设计',
  '创意玩法',
  '文创周边',
  '小说推文',
]
export const STYLE_MODELS = ['全部', 'Seedream 5.0', 'Qwen Image', 'Z Image', 'Lib Image']

const styles = [
  [
    'seedream-gold',
    'Seedream 5.0 pro',
    '推荐',
    '热点推荐官',
    '614.0w',
    'Seedream 5.0',
    style01,
    false,
    '黑金丝绒、低调奢华、强烈明暗层次',
  ],
  [
    'comic-turnaround',
    'J_漫剧素材三视图',
    '动漫游戏',
    'JM32',
    '1.3w',
    'Lib Image',
    style02,
    true,
    '漫剧角色设定、干净白底、统一多视图',
  ],
  [
    'short-drama-character',
    '短剧角色四视图 V8.0',
    '摄影写真',
    '捌陆设计',
    '861',
    'Z Image',
    style03,
    true,
    '写实短剧角色、电影级妆造、多角度一致性',
  ],
  [
    'wind-handwriting',
    'Qwen 随风手写体',
    '平面设计',
    '小汀AIGC',
    '1.0w',
    'Qwen Image',
    style04,
    true,
    '自然手写字体、柔和笔触、清新排版',
  ],
  [
    'ancient-character',
    'Qwen 古风角色立绘',
    '风格插画',
    'yuhong126',
    '5200',
    'Qwen Image',
    style05,
    true,
    '东方古风立绘、精致服饰、国风配色',
  ],
  [
    'double-ninth',
    'Zimage 九九重阳节',
    '文创周边',
    'FreeWood',
    '1700',
    'Z Image',
    style06,
    true,
    '节日国风、层叠山水、温暖秋日色彩',
  ],
  [
    'cute-avatar',
    '超可爱女生头像',
    '动漫游戏',
    '捏捏脸',
    '1.1w',
    'Qwen Image',
    style07,
    true,
    '可爱头像、柔软光线、精致二次元五官',
  ],
  [
    'multi-view-person',
    '一键生成人物多视图',
    '创意玩法',
    '像素农夫DESIGN',
    '4.8w',
    'Lib Image',
    style08,
    true,
    '人物多视图、造型一致、清晰设定稿',
  ],
  [
    'dunhuang',
    '敦煌岩彩工笔仕女',
    '风格插画',
    '沐沐',
    '1300',
    'Qwen Image',
    style09,
    true,
    '敦煌岩彩、工笔仕女、矿物质感',
  ],
  [
    'natural-light',
    'Z-Image 自然光少女',
    '摄影写真',
    '造物先生',
    '178',
    'Z Image',
    style10,
    true,
    '自然光人像、真实肤质、轻盈生活感',
  ],
  [
    'industrial-product',
    '产品工业设计渲染',
    '电商营销',
    'UU',
    '2600',
    'Qwen Image',
    style11,
    true,
    '工业设计渲染、干净材质、专业棚拍布光',
  ],
  [
    'hardware-kv',
    '硬件产品精细化视觉',
    '电商营销',
    'UU',
    '8800',
    'Qwen Image',
    style12,
    true,
    '高端硬件 KV、金属质感、冷峻轮廓光',
  ],
  [
    'clay-house',
    '毛呢粘土微缩房子',
    '建筑及室内设计',
    'UU',
    '9200',
    'Qwen Image',
    style13,
    true,
    '毛毡粘土、微缩建筑、柔软梦幻氛围',
  ],
  [
    'storyboard',
    '分镜脚本故事版',
    '小说推文',
    'YOUS',
    '3000',
    'Lib Image',
    style14,
    true,
    '电影故事板、清晰镜头节奏、统一角色造型',
  ],
  [
    'ecommerce-scene',
    '创意电商产品场景',
    '电商营销',
    '大摸鱼家_Xr',
    '23.9w',
    'Qwen Image',
    style15,
    true,
    '电商主视觉、夸张产品舞台、强转化构图',
  ],
]

export const STYLE_GALLERY_ITEMS = styles.map(
  ([id, title, category, author, uses, model, image, commercial, prompt]) => ({
    id,
    title,
    category,
    author,
    uses,
    model,
    image,
    commercial,
    prompt,
    description: `将画面转换为「${title}」视觉体系，保持主体身份、产品结构和关键信息稳定。`,
  }),
)

export function filterStyleGallery(
  items,
  { tab, favorites, recent, query, category, commercial, model },
) {
  const normalizedQuery = String(query || '')
    .trim()
    .toLowerCase()
  return items.filter((item) => {
    if (tab === '我的收藏' && !favorites.has(item.id)) return false
    if (tab === '最近使用' && !recent.includes(item.id)) return false
    if (category && category !== '推荐' && item.category !== category) return false
    if (commercial && !item.commercial) return false
    if (model && model !== '全部' && item.model !== model) return false
    if (
      normalizedQuery &&
      ![item.title, item.author, item.model].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      )
    )
      return false
    return true
  })
}

export function imageStyleInstructions(data) {
  const style = data?.stylePreset
  if (!style?.prompt) return ''
  return [
    `风格预设：${style.title || '已选风格'}`,
    style.prompt,
    '仅迁移视觉风格、配色、材质、光线与构图语言；保持引用图中的主体身份、产品结构、文字信息和关键细节。',
  ].join('\n')
}

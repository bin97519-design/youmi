const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)))

// Labels, hierarchy and control changes are verified against the current TV Director UI.
export const DIRECTOR_MODES = Object.freeze({
  omni: Object.freeze({
    id: 'omni',
    label: '全能创作',
    triggerLabel: '全能创作',
    placeholder: '开始你的创作，或者 @ 引用工作流/节点/资源',
    menuLevel: 0,
    menuGroup: null,
    menuPath: Object.freeze(['全能创作']),
    controls: Object.freeze(['attachment', 'mode', 'model', 'skill', 'manual', 'send']),
    auxiliaryControls: Object.freeze([]),
  }),
  script_original: Object.freeze({
    id: 'script_original',
    label: '原创剧本',
    triggerLabel: '剧本创编 · 原创',
    placeholder: '输入你的剧本想法...',
    menuLevel: 1,
    menuGroup: 'script',
    menuPath: Object.freeze(['剧本创编', '原创剧本']),
    controls: Object.freeze(['attachment', 'mode', 'scriptModel', 'manual', 'send']),
    auxiliaryControls: Object.freeze(['scriptPreset']),
  }),
  script_adaptation: Object.freeze({
    id: 'script_adaptation',
    label: '故事改编',
    triggerLabel: '剧本创编 · 改编',
    placeholder: '输入你的改编想法...',
    menuLevel: 1,
    menuGroup: 'script',
    menuPath: Object.freeze(['剧本创编', '故事改编']),
    controls: Object.freeze(['attachment', 'mode', 'scriptModel', 'manual', 'send']),
    auxiliaryControls: Object.freeze(['scriptUpload', 'adaptationSettings']),
  }),
  directing: Object.freeze({
    id: 'directing',
    label: '导演执导',
    triggerLabel: '导演执导',
    placeholder: '选择视频节点或直接输入你的想法...',
    menuLevel: 0,
    menuGroup: null,
    menuPath: Object.freeze(['导演执导']),
    controls: Object.freeze(['attachment', 'mode', 'scriptModel', 'send']),
    auxiliaryControls: Object.freeze(['directorRole']),
  }),
})

export const DIRECTOR_MODE_MENU = freezeList([
  { id: 'omni', type: 'mode', modeId: 'omni', label: '全能创作', order: 0 },
  {
    id: 'script',
    type: 'group',
    label: '剧本创编',
    order: 1,
    children: Object.freeze(['script_original', 'script_adaptation']),
  },
  { id: 'directing', type: 'mode', modeId: 'directing', label: '导演执导', order: 2 },
])

// LibTV serves the preset catalogue remotely. This local list keeps the cloned UI deterministic.
export const DIRECTOR_HOT_PRESETS = freezeList([
  {
    id: 'fantasy-cultivation-counterattack',
    rank: 1,
    label: '玄幻修仙逆袭',
    genre: '玄幻修仙',
    prompt: '以修炼成长、境界突破和逆境反击为主线，创作玄幻修仙逆袭故事。',
  },
  {
    id: 'realistic-workplace-growth',
    rank: 2,
    label: '现实职场成长',
    genre: '职场行业',
    prompt: '从真实职场困境切入，用专业积累、关系变化和关键选择推动人物成长。',
  },
  {
    id: 'apocalypse-survival-building',
    rank: 3,
    label: '末世生存基建',
    genre: '末世科幻',
    prompt: '围绕资源收集、生存危机与据点建设，创作逐步升级的末世群像故事。',
  },
  {
    id: 'intangible-cultural-heritage',
    rank: 4,
    label: '非遗国潮视觉',
    genre: '文旅非遗',
    prompt: '以非遗技艺与地方文化为叙事核心，用当代国潮视觉完成文化元素新表达。',
  },
  {
    id: 'ancient-romance',
    rank: 5,
    label: '古代女频甜宠',
    genre: '古装言情',
    prompt: '以古代情境下的双向心动、身份差异与情感守护创作高甜女频故事。',
  },
  {
    id: 'rule-horror-mystery',
    rank: 6,
    label: '规则怪谈悬疑',
    genre: '惊悚怪谈',
    prompt: '以互相矛盾的生存规则制造压迫感，让主角通过观察与推理寻找规则漏洞。',
  },
  {
    id: 'rebirth-revenge',
    rank: 7,
    label: '重生复仇爽剧',
    genre: '都市现实',
    prompt: '主角带着前世记忆归来，在连续反转中完成复仇、逆袭与自我救赎。',
  },
  {
    id: 'sect-favorite-daily-life',
    rank: 8,
    label: '仙门团宠日常',
    genre: '玄幻修仙',
    prompt: '围绕仙门中的团宠主角与同门日常，用轻喜互动和共同历练推进故事。',
  },
])

export const DIRECTOR_GENRES = freezeList([
  { id: 'fantasy-cultivation', label: '玄幻修仙' },
  { id: 'urban-reality', label: '都市现实' },
  { id: 'costume-romance', label: '古装言情' },
  { id: 'suspense', label: '悬疑推理' },
  { id: 'horror', label: '惊悚怪谈' },
  { id: 'crime-espionage', label: '犯罪谍战' },
  { id: 'family-ethics', label: '家庭伦理' },
  { id: 'apocalypse-scifi', label: '末世科幻' },
  { id: 'historical-legend', label: '历史传奇' },
  { id: 'comedy', label: '喜剧' },
  { id: 'main-theme', label: '主旋律' },
  { id: 'sports', label: '体育竞技' },
  { id: 'workplace-industry', label: '职场行业' },
  { id: 'culture-tourism', label: '文旅非遗' },
  { id: 'other', label: '其他' },
])

export const DIRECTOR_AUDIENCES = freezeList([
  { id: 'male', label: '男频' },
  { id: 'female', label: '女频' },
  { id: 'general', label: '泛人群' },
  { id: 'overseas', label: '出海' },
  { id: 'senior', label: '银发' },
  { id: 'other', label: '其他' },
])

export const DIRECTOR_CHARACTER_SETTINGS = freezeList([
  { id: 'ordinary-person', label: '小人物' },
  { id: 'worker', label: '打工人' },
  { id: 'strong-woman', label: '女强' },
  { id: 'imperfect-growth', label: '不完美成长型' },
  { id: 'professional', label: '专业型' },
  { id: 'genius', label: '天才' },
  { id: 'power-couple', label: '双强' },
  { id: 'scheming', label: '腹黑' },
  { id: 'black-lotus', label: '黑莲花' },
  { id: 'loyal', label: '忠犬' },
  { id: 'obsessive', label: '病娇' },
  { id: 'lucky-child', label: '福宝' },
  { id: 'young-lady', label: '大小姐' },
  { id: 'young-master', label: '少爷' },
  { id: 'prince', label: '王爷' },
  { id: 'princess-consort', label: '王妃' },
  { id: 'emperor', label: '皇帝' },
  { id: 'general', label: '将军' },
  { id: 'cultivator', label: '修士' },
  { id: 'dragon-king', label: '龙王' },
  { id: 'doctor', label: '医者' },
  { id: 'lawyer', label: '律师' },
  { id: 'detective', label: '警探' },
  { id: 'teacher', label: '教师' },
  { id: 'model', label: '模特' },
  { id: 'other', label: '其他' },
])

export const DIRECTOR_ERAS = freezeList([
  { id: 'ancient', label: '古代' },
  { id: 'modern', label: '现代' },
  { id: 'fictional', label: '架空' },
  { id: 'apocalypse', label: '末世' },
  { id: 'republican', label: '民国' },
  { id: 'eighties-nineties', label: '年代（80–90s）' },
  { id: 'near-future', label: '近未来' },
  { id: 'parallel-world', label: '平行世界' },
  { id: 'multi-timeline', label: '多时空穿越' },
  { id: 'other', label: '其他' },
])

export const DIRECTOR_HIGHLIGHTS = freezeList([
  { id: 'artifact-cheat', label: '器物金手指' },
  { id: 'collect-upgrade', label: '收集升级' },
  { id: 'base-building', label: '基建生存' },
  { id: 'professional-dominance', label: '专业碾压' },
  { id: 'hidden-master', label: '马甲大佬' },
  { id: 'marriage-first', label: '先婚后爱' },
  { id: 'rebirth-revenge', label: '重生复仇' },
  { id: 'group-favorite', label: '团宠被爱' },
  { id: 'ip-remix', label: 'IP二创' },
  { id: 'mutual-redemption', label: '双向救赎' },
  { id: 'other-world-travel', label: '穿越异世' },
  { id: 'underestimated-master', label: '扮猪吃虎' },
  { id: 'industry-detail', label: '亲历行业细节' },
  { id: 'real-growth', label: '真实成长' },
  { id: 'forbidden-rules', label: '规则禁忌' },
  { id: 'episodic-mystery', label: '单元解谜' },
  { id: 'cultural-reuse', label: '文化元素新用' },
  { id: 'style-mix', label: '风格混搭' },
  { id: 'visual-spectacle', label: '视觉奇观' },
  { id: 'hidden-identity', label: '隐藏身份' },
  { id: 'true-false-heiress', label: '真假千金' },
  { id: 'contract-marriage', label: '契约婚姻' },
  { id: 'cute-child-assist', label: '萌宝助攻' },
  { id: 'son-in-law-counterattack', label: '赘婿逆袭' },
  { id: 'system-support', label: '系统傍身' },
  { id: 'bickering-lovers', label: '欢喜冤家' },
  { id: 'ordinary-people', label: '普通人的处境' },
  { id: 'ensemble-era', label: '群像时代切片' },
  { id: 'older-woman-younger-man', label: '姐弟恋' },
  { id: 'book-transmigration', label: '穿书' },
  { id: 'time-loop', label: '时间循环' },
])

export const DIRECTOR_VISUAL_STYLES = freezeList([
  { id: 'custom', label: '自定义' },
  { id: 'court-intrigue', label: '冷峻宫廷权谋' },
  { id: 'domestic-cool-suspense', label: '国产冷调悬疑' },
  { id: 'urban-realism', label: '都市写实' },
  { id: 'soft-costume-romance', label: '柔光古装言情' },
  { id: 'japanese-youth-film', label: '日系青春胶片' },
  { id: 'realistic-wuxia', label: '写实江湖武侠' },
  { id: 'high-key-commercial', label: '高调棚拍广告' },
  { id: 'classic-hollywood', label: '经典好莱坞' },
  { id: 'cyber-scifi', label: '赛博科幻' },
  { id: 'cool-art', label: '冷感文艺' },
  { id: 'dark-horror', label: '暗黑恐怖' },
  { id: '3d-fantasy-animation', label: '3D 奇幻动画' },
  { id: 'industrial', label: '工业质感' },
  { id: 'nostalgic-hong-kong', label: '怀旧港片' },
  { id: 'chinese-3d', label: '唯美国风 3D' },
  { id: 'toon-shading-anime', label: '三渲二动漫' },
  { id: 'hyperreal-3d', label: '超写实 3D' },
  { id: 'dark-fantasy-cg', label: '暗调奇幻 CG' },
  { id: 'oriental-fantasy-3d', label: '东方玄幻 3D' },
  { id: 'classic-chinese-art', label: '经典国产美术' },
  { id: 'chinese-mural', label: '国风壁画' },
])

export const DIRECTOR_SCRIPT_STRUCTURES = freezeList([
  { id: 'three-act', label: '三幕式' },
  { id: 'five-act', label: '五幕式' },
  { id: 'hero-journey', label: '英雄旅程' },
  { id: 'parallel', label: '平行结构' },
  { id: 'cross', label: '交叉结构' },
  { id: 'nonlinear', label: '非线性结构' },
  { id: 'circular', label: '环形结构' },
  { id: 'episodic', label: '单元结构' },
])

export const DIRECTOR_SCRIPT_EPISODES = Object.freeze({
  min: 1,
  max: 100,
  step: 1,
  default: 20,
})

export const DIRECTOR_SCRIPT_FIELDS = freezeList([
  { id: 'audience', label: '目标受众', maxSelect: 2, options: DIRECTOR_AUDIENCES },
  {
    id: 'characters',
    label: '角色设定',
    maxSelect: 5,
    options: DIRECTOR_CHARACTER_SETTINGS,
  },
  { id: 'era', label: '时代背景', maxSelect: 2, options: DIRECTOR_ERAS },
  { id: 'highlights', label: '核心看点', maxSelect: 3, options: DIRECTOR_HIGHLIGHTS },
  { id: 'visualStyle', label: '画风', maxSelect: 1, options: DIRECTOR_VISUAL_STYLES },
  {
    id: 'structure',
    label: '剧本结构',
    maxSelect: 1,
    options: DIRECTOR_SCRIPT_STRUCTURES,
  },
])

export const DIRECTOR_ADAPTATION_DIRECTIONS = freezeList([
  { id: 'condense', label: '剧本浓缩', description: '压缩冗余情节，保留主线与关键转折' },
  { id: 'expand', label: '故事扩写', description: '补足人物动机、场景与叙事细节' },
  { id: 'conflict', label: '强化冲突', description: '提高对抗强度，让矛盾逐级升级' },
  { id: 'hook', label: '强化钩子', description: '加强开场抓力与每集结尾悬念' },
])

export const DIRECTOR_ADAPTATION_EPISODES = Object.freeze({
  min: 2,
  max: 100,
  step: 1,
  default: 100,
})

export const DIRECTOR_ROLES = freezeList([
  {
    id: 'auto',
    label: '自动',
    description: '根据创作意图自动选择合适的导演风格',
    isDefault: true,
  },
  { id: 'tvc', label: 'TVC广告', description: '强调品牌卖点、视觉记忆点与商业节奏' },
  { id: 'suspense-short', label: '悬疑短剧', description: '擅长线索铺陈、紧张节奏与多层反转' },
  { id: 'spoken-sales', label: '口播带货', description: '突出产品利益点、口播节奏与转化钩子' },
  { id: 'animated-story', label: '动画剧情', description: '强调角色表演、幻想场景与动画节奏' },
  { id: 'documentary', label: '纪录片', description: '重视真实观察、环境细节与纪实表达' },
  { id: 'beat-mv', label: '卡点MV', description: '围绕音乐节拍设计镜头切换与动作卡点' },
])

export function getDirectorMode(id) {
  return typeof id === 'string' && Object.hasOwn(DIRECTOR_MODES, id)
    ? DIRECTOR_MODES[id]
    : DIRECTOR_MODES.omni
}

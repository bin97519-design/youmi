// The first three formats are reconstructed from public asset images. The
// model-sheet template was explicitly supplied by the user, not scraped from LibTV.
// Provenance is descriptive metadata, never generation consent.
export const CHARACTER_STUDIO_ASSET_FORMAT_VERSION = 'libtv-assets-visual-v1'
export const CHARACTER_STUDIO_MODEL_SHEET_FORMAT_VERSION = 'user-model-sheet-v2'

export const CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE = `使用我提供的模特参考图，生成一张专业的真人模特角色设定表。

【身份一致性】
画面中出现的所有人物必须是同一名女性模特，是同一个人在不同角度下的重复展示，不是多人合照。
严格保留参考图中模特的真实身份特征：脸型、五官比例、眼睛形状、鼻型、嘴唇、眉形、发际线、肤色、年龄感、身材比例和个人辨识度。
不同视角下人物身份必须高度一致，不能换脸，不能美化成另一个人。

【角色外观】
模特：{填写年龄、气质、脸型、肤色、发型、身材}
发型：{填写发色、长度、卷直、刘海和扎发方式}
服装：{填写上衣、裤子、鞋子和配饰}
所有视角保持完全相同的发型、服装、鞋子、配饰、妆容和身材比例。

【版式结构】
制作横向16:9角色设定表，纯白色无缝背景，影棚柔光，排版整洁，人物之间留有均匀间距。

画面左侧排列3个全身视图：
1. 正面自然站立全身照；
2. 左侧90度侧面全身照；
3. 背面自然站立全身照。

画面右侧排列6个胸像或头肩特写：
1. 正面平静表情；
2. 右前方45度微笑；
3. 右侧90度侧脸；
4. 背面发型展示；
5. 左前方45度自然表情；
6. 正面轻微微笑。

【拍摄要求】
正面平视镜头，85mm人像摄影质感，柔和均匀布光，肤色自然，面部清晰，真实皮肤纹理，服装结构准确。
全身视图必须从头顶完整展示到鞋底，不裁切头部、手部和脚部。
所有人物保持相同身高、头身比、肩宽、腰臀比例和腿部比例。
标准电商模特档案照，专业选角资料风格，高分辨率，边缘干净。

禁止文字、标题、标注、箭头、边框、水印和复杂背景。`

const source = {
  formatVersion: CHARACTER_STUDIO_ASSET_FORMAT_VERSION,
  promptSource: 'visual-reconstruction',
  promptSourceLabel: '依据原站公开资产图重建，非原始提示词',
}
const common =
  '使用干净的纯白背景，各视图的背景白色一致，不添加场景、道具、文字、标签、水印、边框或网格线。保持参考图中同一人物的身份、五官、发型、服装、肤色与整体画风一致；不要强制转换为写实风格，不改变年龄、服装或人物身份。'

export const CHARACTER_STUDIO_ASSET_FORMATS = Object.freeze({
  'full-body': Object.freeze({
    ...source,
    type: 'full-body',
    label: '全身图',
    ratio: '3:4',
    instruction:
      '只生成一张全身站姿图：同一角色从头顶到双脚的完整单人全身，正常着装，自然站立，人物居中，手臂与双脚完整清晰。头顶上方与脚底下方保留适量白色空白，不裁切头顶或双脚，不做半身肖像、角色设定表或表情九宫格。',
  }),
  'half-body': Object.freeze({
    ...source,
    type: 'half-body',
    label: '上身图',
    ratio: '3:4',
    instruction:
      '只生成一张半身肖像：使用从头顶至胸部或上胸的近景胸像，头部占画面较大比例，五官清晰，双肩自然放松，正常着装，正面或自然微侧面。不采用头顶至腰部的远景，不做全身站姿、角色设定表或表情九宫格。',
  }),
  'emotion-grid': Object.freeze({
    ...source,
    type: 'emotion-grid',
    label: '表情九宫格',
    ratio: '3:4',
    instruction:
      '只生成一张 3×3 表情九宫格：严格按 3 列×3 行排列九个相同大小的区域，统一头肩肖像构图、头部大小、拍摄角度与光线。九种不同自然表情按从左到右排列：上排为平静直视、闭口微笑、皱眉生气；中排为委屈撇嘴、露齿大笑、悲伤哭泣；下排为惊讶张嘴、不耐烦皱眉、担忧不安。只改变表情，其余身份与造型不变。九格共同组成一张完整成图，不是九张独立图片，不增加第四行或第四列，不画可见网格线或分隔框。',
  }),
  'character-sheet': Object.freeze({
    formatVersion: CHARACTER_STUDIO_MODEL_SHEET_FORMAT_VERSION,
    promptSource: 'user-provided',
    promptSourceLabel: '用户模板＋参考画风自适应与3＋6布局校准',
    type: 'character-sheet',
    label: '角色设定图',
    ratio: '16:9',
    instruction: CHARACTER_STUDIO_MODEL_SHEET_PROMPT_TEMPLATE,
  }),
})

const ratios = new Set(['1:1', '3:4', '4:3', '9:16', '16:9', '3:2', '2:3'])

/** A strict format lookup; inherited property names are never asset types. */
export function characterStudioAssetFormat(type = 'character-sheet') {
  if (typeof type !== 'string' || !Object.hasOwn(CHARACTER_STUDIO_ASSET_FORMATS, type)) {
    throw new Error('请选择支持的模特资产类型')
  }
  return CHARACTER_STUDIO_ASSET_FORMATS[type]
}

/** Preserve the confirmed ratio, even when the user changes the suggested format. */
export function characterStudioAssetPrompt(type, ratio, appearance = {}) {
  const format = characterStudioAssetFormat(type)
  const actualRatio = ratio === undefined ? format.ratio : ratio
  if (!ratios.has(actualRatio)) throw new Error('请选择支持的图片比例')
  const [width, height] = actualRatio.split(':').map(Number)
  const orientation = width === height ? '方形' : width > height ? '横版' : '竖版'
  if (format.type === 'character-sheet') {
    const supplied = (key, fallback) => {
      const value = typeof appearance[key] === 'string' ? appearance[key].trim() : ''
      return value.replace(/\{[^{}\n]*(?:填写|选择)[^{}\n]*\}/g, '').trim() || fallback
    }
    const subject = supplied('subject', '模特')
    const frame = width === height ? '方形' : width > height ? '横向' : '竖向'
    const prompt = format.instruction
      .replace(
        '使用我提供的模特参考图，生成一张专业的真人模特角色设定表。',
        '使用我提供的角色参考图，生成一张专业角色设定表。画面表现必须跟随参考图，不以“角色设定”之名生成服装配件拆解或局部细节拼贴。',
      )
      .replace('同一名女性模特', () => `同一名${subject}`)
      .replace('{填写年龄、气质、脸型、肤色、发型、身材}', () =>
        supplied('model', '年龄、气质、脸型、肤色、发型和身材均以参考图为准，不推断未填写的资料'),
      )
      .replace('{填写发色、长度、卷直、刘海和扎发方式}', () =>
        supplied('hair', '发色、长度、卷直、刘海和扎发方式均按参考图保持'),
      )
      .replace('{填写上衣、裤子、鞋子和配饰}', () =>
        supplied('clothing', '上衣、裤子、鞋子、配饰与妆容均按参考图保持'),
      )
      .replace('横向16:9', `${frame}${actualRatio}`)
      .replace(
        '【拍摄要求】\n正面平视镜头，85mm人像摄影质感，柔和均匀布光，肤色自然，面部清晰，真实皮肤纹理，服装结构准确。',
        '【画面表现要求】\n若参考图为真人照片，才使用正面平视镜头、85mm人像摄影质感、柔和均匀布光、自然肤色与真实皮肤纹理。若参考图为插画、动漫或CG角色，严格保持原图线条、上色、笔触、材质表现与渲染风格；不要强制转换为写实风格，不要真人化，不把真人皮肤、镜头景深或摄影滤镜套到插画上。所有风格均须面部清晰、服装结构准确、光线均匀，人物完整可辨认。',
      )
      .replace(
        '标准电商模特档案照，专业选角资料风格，高分辨率，边缘干净。',
        '真人参考采用标准电商模特档案照、专业选角资料风格；插画、动漫与CG参考采用同画风的标准角色转面表。两者均要求高分辨率、边缘干净。',
      )
    return [
      `最终成图采用用户确认的 ${actualRatio} ${orientation}画幅，不擅自更改比例。`,
      '【最高优先级】只做同一个角色的全身三视图＋上身六视图。真人参考保留真人摄影风格；插画、动漫、CG参考保留其原有画风，不互相转换。以下身份一致性与固定九视图版式同时满足，不能用物件或局部特写替代人物视图。',
      prompt,
      '【资料使用边界】已填写的外观资料仅辅助辨认同一人物；若与模特参考图不一致，以参考图的真实身份、年龄感和身材比例为准。未填写的部分保持参考图，不自动换性别、换年龄、改脸、美颜或塑形。',
      '【固定版式，禁止自由拼贴】扣除四周少量白色留边后的可用区域，左侧约47%宽度用于3个全身视图，中央约2%为空白间距，右侧约51%宽度用于6个上身视图。左侧3个全身视图等宽、人物同高、鞋底基线对齐，头顶至鞋底完整展示。右侧6个上身视图严格按3列×2行排列，依上述1—6顺序从左到右、从上到下展示，六格同尺度、同大小，不额外分栏，不画分隔线。',
      '【右侧每一格的景别】每格都必须完整包含头顶、整张脸或完整后脑、颈部、双肩和上胸，统一裁切到胸部；背面格展示完整后脑发型、颈肩与上背。不能出现只有眼睛、嘴唇或头发碎片的格子，不能以脸部超近景替代胸像。六格人物头部尺寸一致，禁止把某一格放大占据其他格的位置。',
      '【绝对禁止的错误版式】禁止眼睛、嘴唇、耳朵、鞋子、衣服、配饰、纹身、辫子的独立局部图；禁止任何服装配件细节拼贴、材质样片、放大镜小窗、分解图、额外格子、大小不一的碎片拼贴或竖向第三排。鞋子只能出现在左侧全身人物脚上，服装和配饰只能随人物整体出现，不能单独成图。',
      '只生成一张合并角色设定表，恰好包含3个全身人物视图和6个完整上身人物视图，一共9个视图，不是九张独立图片。输出前检查：左3全身、右3列×2行6上身、没有任何独立局部或物件图。',
    ].join('\n')
  }
  return [
    `最终成图采用用户确认的 ${actualRatio} ${orientation}画幅，所有视图适配这一张画布，不擅自更改比例。`,
    format.instruction,
    common,
  ].join('\n')
}

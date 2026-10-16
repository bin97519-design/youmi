// All 25 names/positions and preview hashes verified against the live reference, 2026-10-15.
// The matching WebP assets are bundled locally, not hotlinked to the reference site.
const observed = {
  '0-0': ['欣然愉悦', '7aab6073a10b101facfa9aad33fe7137fcb87ce3'],
  '1-0': ['骤然错愕', 'ba8549aa963901567fb8f56f32233a4487930687'],
  '2-0': ['惊魂未定', 'f860884a22d69d14ea6d516e597aaab9af76f616'],
  '3-0': ['心跳骤停', '9a18f44a8173e49d183422c60c1b98d6cd7f42c7'],
  '4-0': ['暴怒沉怒', 'ef62d88906e06c3416a7d04497482c5eb8a01927'],
  '0-1': ['浅然莞尔', 'a01bac0d530aed666e68a87869ad0b694a6a1ec3'],
  '1-1': ['难以置信', '1df17c2bce78d59f2a1a18fa631d7c77892dbce3'],
  '2-1': ['受惊后退', '85f26fe2f1def1def0be41789e3b53a0a81d4518'],
  '3-1': ['强忍悲戚', 'c9ab7ed41e7a740c10e264c8505870509586c4c3'],
  '4-1': ['隐忍愠怒', '7bb8214329026230e8312c404dba211d63b32993'],
  '0-2': ['含情凝望', '0592b3087479f2a016496e73199444928fb8fee8'],
  '1-2': ['欲言又止', 'fcf8ef980afd3acabd1a3121633d9cfd1858787a'],
  '2-2': ['淡然自若', '2af2e0ef781cb3350315e2397e890af4da1025a8'],
  '3-2': ['警觉审视', '0dd12de189831872cd5ce39f5d844c57db308ee7'],
  '4-2': ['眉宇凝霜', '499b769fe592d1e643dcda0a4ebf874b98549a7b'],
  '0-3': ['满眼宠溺', '520bf79e13bc771def1fb81e199ebed2efe5ea3a'],
  '1-3': ['万般无奈', 'd29f7057ce1f72438159718adb2d231de2be149f'],
  '2-3': ['触景伤情', '7af110f648cab83296beaf24bbf9de335c5fe939'],
  '3-3': ['隐忍心伤', '3564bb3eda9c9c1a1302240bbf0d427924f6ee98'],
  '4-3': ['冷眼漠然', 'ae94a80a000100f7521d45b162531a7d7389a180'],
  '0-4': ['积郁憋闷', '7649d5a97cbadd7bfc408fc55f7e35bb0d533e4b'],
  '1-4': ['默然垂泪', 'a30b34e052b59547252f1a478785902b5cf7757f'],
  '2-4': ['疲惫失神', '40852613d3ba041e275c68fd8b0123ae93022e90'],
  '3-4': ['哀悼压抑', 'a60a8091fe682a14f32df3ee9de9a12a79f395df'],
  '4-4': ['疏离冷淡', 'fa7a23dd2eb7f4985c8aa305f0ab39ff150250a9'],
}

export function emotionAt(x = 50, y = 50) {
  const snap = (value) =>
    Math.max(
      0,
      Math.min(4, Math.round(((Number.isFinite(Number(value)) ? Number(value) : 50) - 10) / 20)),
    )
  const column = snap(x)
  const row = snap(y)
  const known = observed[`${column}-${row}`]
  const affinity = ['非常亲近', '亲近', '中性', '疏离', '非常疏离'][column]
  const arousal = ['非常激动', '激动', '自然平稳', '平静', '非常平静'][row]
  return {
    x: 10 + column * 20,
    y: 10 + row * 20,
    label: known?.[0] || `${affinity} · ${arousal}`,
    description: `亲近—疏离轴：${affinity}；激动—平静轴：${arousal}`,
    preview: known?.[1] ? new URL(`../assets/emotions/${known[1]}.webp`, import.meta.url).href : '',
  }
}

export function validFaceBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return false
  return box.every((v) => v >= 0 && v <= 1) && box[2] - box[0] >= 0.01 && box[3] - box[1] >= 0.01
}

export function boxFromDrag(start, end) {
  const clamp = (n) => Math.max(0, Math.min(1, n))
  const box = [
    Math.min(start.x, end.x),
    Math.min(start.y, end.y),
    Math.max(start.x, end.x),
    Math.max(start.y, end.y),
  ].map(clamp)
  return validFaceBox(box) ? box : null
}

export function emotionRoleInstructions(roles) {
  const valid = (roles || []).filter((role) => validFaceBox(role.box))
  if (!valid.length) throw new Error('请先识别并选择面部，或手动框选面部后再调节表情')
  return (
    valid
      .map((role, i) => {
        const mood = emotionAt(role.x ?? 50, role.y ?? 50)
        const box = role.box.map((n) => Number(n.toFixed(3)))
        return `角色${i + 1}：原图面部区域[left,top,right,bottom]=${JSON.stringify(box)}（0到1归一化坐标）；目标表情：${mood.label}；${mood.description}。`
      })
      .join('\n') + '\n分别应用以上角色的目标表情，只调整这些框选面部；未选中的人物及背景保持不变。'
  )
}

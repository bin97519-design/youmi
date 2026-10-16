import { imageEditPreset, imageEditTemplate } from './imageEditPresets.js'
import { imageGridPreset } from './imageGridTemplates.js'

// Categories/order/new markers transcribed from the supplied reference panel.
export const IMAGE_SHORTCUT_COLUMNS = [
  [
    {
      label: '分镜叙事',
      items: [
        { id: 'staging-storyboard', isNew: true, description: '生成带有运动轨迹等调度草图分镜' },
        { id: 'storyboard', isNew: true, description: '生成完整剧情片段' },
        { id: 'story-twenty-five', description: '生成连续分镜长图' },
        { id: 'story-four', description: '生成四格剧情推演' },
        { id: 'future-three-seconds', description: '推演画面后续动作' },
        { id: 'past-five-seconds', description: '还原画面前置状态' },
      ],
    },
    {
      label: '质感调节',
      items: [
        { id: 'portrait-texture', isNew: true, description: '降低 AI 感，优化人物质感与光影' },
        { id: 'cinematic-light', description: '调整画面光影质感' },
      ],
    },
  ],
  [
    {
      label: '空间与机位',
      items: [
        { id: 'panorama-720', description: '生成全景场景图' },
        { id: 'multi-camera', description: '生成多视角机位图' },
      ],
    },
    {
      label: '设定图',
      items: [
        { id: 'face-three', description: '基于一张参考图生成脸部细节三视图' },
        { id: 'character-sheet', description: '角色主视觉与设定拆解' },
        { id: 'character-three', description: '正侧背视图与脸部特写' },
        { id: 'scene-sheet', description: '角色主视觉与设定拆解' },
        { id: 'product-sheet', description: '角色主视觉与设定拆解' },
      ],
    },
  ],
].map((column) =>
  column.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...imageEditTemplate(item.id),
      ...item,
      icon: 'shortcut-' + item.id,
    })),
  })),
)

// Only patch module-owned fields. Never clear the user's extra prompt, references,
// model, generated assets or task IDs when replacing/removing a shortcut.
export function imageShortcutPatch(data, id) {
  if (id === null) return data.editTemplate ? { editTemplate: null } : null
  if (data.editTemplate?.id === id) return null
  if (!IMAGE_SHORTCUT_COLUMNS.flat().some((group) => group.items.some((item) => item.id === id)))
    return null
  const preset = imageEditPreset(id) || imageGridPreset(id)
  return {
    editTemplate: {
      ...preset.editTemplate,
      ...(data.editTemplate?.sourceNodeId ? { sourceNodeId: data.editTemplate.sourceNodeId } : {}),
    },
    params: { ...data.params, ...preset.params },
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const componentUrl = new URL(
  '../src/features/canvas-v3/components/DirectorPanel.vue',
  import.meta.url,
)
const shellUrl = new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url)
const orbUrl = new URL('../src/features/canvas-v3/components/AgentOrb.vue', import.meta.url)
const canvasCssUrl = new URL('../src/features/canvas-v3/canvas-v3.css', import.meta.url)

test('the shell uses the independent Director panel and hides its launcher while open', async () => {
  const shellSource = await readFile(shellUrl, 'utf8')

  assert.match(shellSource, /import DirectorPanel from ['"]\.\/DirectorPanel\.vue['"]/)
  const directorTag = shellSource.match(/<DirectorPanel\b[\s\S]*?\/>/)?.[0] || ''
  assert.match(directorTag, /v-if="activePanel === 'assistant'"/)
  assert.match(directorTag, /@close="closeDirector"/)

  const orbTag = shellSource.match(/<AgentOrb\b[\s\S]*?\/>/)?.[0] || ''
  assert.ok(orbTag, 'the shell must render the Director launcher')
  assert.match(shellSource, /v-if="activePanel !== 'assistant'" class="cv3-agent-slot"/)

  const utilityTag = shellSource.match(/<CanvasUtilityPanel\b[\s\S]*?\/>/)?.[0] || ''
  assert.match(utilityTag, /!\['nodes', 'assistant'\]\.includes\(activePanel\)/)
})

test('the floating Director panel keeps the captured LibTV geometry and welcome actions', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /const DEFAULT_RECT = \{ right: 16, bottom: 16, width: 400, height: 640 \}/)
  assert.match(source, /border-radius: 28px/)

  const welcomeActions = [
    '感知画布开始创作',
    '从爆款预设开始剧本原创',
    '上传故事来改编',
    '批量优化提示词',
  ]
  for (const copy of welcomeActions) {
    assert.ok(source.includes(copy), `missing welcome copy: ${copy}`)
  }
})

test('the Director panel persists and exposes all eight resize hit areas', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const declaration = source.match(/const resizeDirections = \[([\s\S]*?)\]/)?.[1] || ''
  const directions = [...declaration.matchAll(/['"](w|e|n|s|nw|ne|sw|se)['"]/g)].map(
    (match) => match[1],
  )

  assert.deepEqual(directions, ['w', 'e', 'n', 's', 'nw', 'ne', 'sw', 'se'])
  assert.match(source, /v-for="direction in resizeDirections"/)
  assert.match(source, /:data-resize-direction="direction"/)
  assert.match(source, /class="cv3-director-resize-handle"/)
  assert.match(source, /libtv:chatAgentDrawer:floatRect/)
  assert.match(source, /localStorage\.getItem\(STORAGE_KEY\)/)
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/)
  assert.match(source, /window\.addEventListener\(['"]resize['"], handleViewportResize\)/)
  assert.match(source, /window\.removeEventListener\(['"]resize['"], handleViewportResize\)/)
})

test('the Director panel is non-modal and restores focus across every close path', async () => {
  const [panelSource, shellSource, orbSource] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
    readFile(orbUrl, 'utf8'),
  ])

  assert.match(panelSource, /role="dialog"/)
  assert.match(panelSource, /aria-modal="false"/)
  assert.match(panelSource, /aria-labelledby="cv3-director-title"/)
  assert.match(panelSource, /data-canvas-shortcuts-ignore/)
  assert.doesNotMatch(panelSource, /cv3-director-(?:scrim|backdrop)/)
  assert.match(panelSource, /closeButton\.value\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(panelSource, /aria-label="关闭 TV Director"/)
  assert.match(panelSource, /@click="emit\('close'\)"/)

  assert.match(orbSource, /defineExpose\(\{[\s\S]*?focus:/)
  assert.match(shellSource, /const agentOrb = ref\(null\)/)
  assert.match(shellSource, /async function closeDirector\(/)
  assert.match(shellSource, /await nextTick\(\)/)
  assert.match(shellSource, /agentOrb\.value\?\.focus\(\)/)
  assert.match(shellSource, /event\.key === 'Escape'[\s\S]{0,260}closeDirector\(/)
})

test('the Director dock mode and width follow the captured persistence and sizing contract', async () => {
  const [source, shellSource] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
  ])
  const dockSource = `${shellSource}\n${source}`

  assert.match(shellSource, /libtv:chatAgentDrawer:mode/)
  assert.match(shellSource, /libtv:chatAgentDrawer:width/)
  assert.match(shellSource, /localStorage\.getItem\([\s\S]{0,100}(?:MODE|mode)/)
  assert.match(shellSource, /localStorage\.setItem\([\s\S]{0,100}(?:MODE|mode)/)
  assert.match(shellSource, /localStorage\.getItem\([\s\S]{0,100}(?:WIDTH|width)/)
  assert.match(shellSource, /localStorage\.setItem\([\s\S]{0,100}(?:WIDTH|width)/)
  assert.match(dockSource, /window\.innerWidth\s*>\s*1520\s*\?\s*400\s*:\s*340/)
  assert.match(dockSource, /320/)
  assert.match(dockSource, /Math\.min\(\s*600\s*,\s*(?:window\.)?innerWidth\s*-\s*48\s*\)/)
  assert.match(dockSource, /(?:clamp|Math\.min|Math\.max)\(/)
})

test('the Director dock control exposes both modes and swaps floating resize handles', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const buttonTags = [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0])
  const dockButton = buttonTags.find(
    (tag) => tag.includes('停靠到右侧') || tag.includes('切换为浮窗'),
  )
  const spanTags = [...source.matchAll(/<span\b[\s\S]*?\/>/g)].map((match) => match[0])
  const floatingResizeHandle = spanTags.find((tag) => tag.includes('cv3-director-resize-handle'))
  const dockResizeHandle = spanTags.find((tag) => tag.includes('cv3-director-dock-resize-handle'))

  assert.ok(dockButton, 'missing Director dock toggle')
  assert.ok(source.includes('停靠到右侧'))
  assert.ok(source.includes('切换为浮窗'))
  assert.match(dockButton, /:aria-label=/)
  assert.match(dockButton, /:aria-pressed="docked"/)
  assert.match(dockButton, /@click="emit\('update:docked', !docked\)"/)
  assert.match(source, /:class="\{ 'is-docked': docked \}"/)

  assert.ok(floatingResizeHandle, 'missing the eight-way floating resize handles')
  assert.match(floatingResizeHandle, /v-for="direction in resizeDirections"/)
  assert.match(source, /<template v-if="!docked">[\s\S]*?cv3-director-resize-handle/)

  assert.ok(dockResizeHandle, 'missing the docked left-edge resize handle')
  assert.match(dockResizeHandle, /v-if="docked"/)
  assert.match(dockResizeHandle, /data-docked-resize-edge="w"/)
  assert.match(dockResizeHandle, /aria-orientation="vertical"/)

  assert.match(source, /props\.docked[\s\S]{0,160}top:\s*['"]0px['"]/)
  assert.match(source, /props\.docked[\s\S]{0,200}right:\s*['"]0px['"]/)
  assert.match(source, /props\.docked[\s\S]{0,260}height:\s*['"]100vh['"]/)
  const dockedRule = source.match(/\.cv3-director-panel\.is-docked\s*\{([\s\S]*?)\}/)?.[1] || ''
  assert.match(dockedRule, /border-radius:\s*0/)
  assert.match(dockedRule, /background:\s*(?:#212121|rgb\(\s*33\s*,\s*33\s*,\s*33\s*\))/i)
  assert.match(dockedRule, /box-shadow:\s*none/)
  assert.match(dockedRule, /border-left:/)

  const dockResizeRule =
    source.match(/\.cv3-director-dock-resize-handle\s*\{([\s\S]*?)\}/)?.[1] || ''
  assert.match(dockResizeRule, /left:\s*0/)
  assert.match(dockResizeRule, /top:\s*0/)
  assert.match(dockResizeRule, /bottom:\s*0/)
  assert.match(dockResizeRule, /width:\s*12px/)
})

test('docking reserves workspace width without close resetting the saved mode or width', async () => {
  const [panelSource, shellSource, canvasCss] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
    readFile(canvasCssUrl, 'utf8'),
  ])
  const combinedLayoutSource = `${shellSource}\n${canvasCss}`
  const closeDirectorBody =
    shellSource.match(/async function closeDirector\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] || ''

  assert.match(shellSource, /is-director-docked/)
  assert.match(shellSource, /--cv3-director-dock-width/)
  assert.match(
    combinedLayoutSource,
    /width:\s*calc\(\s*100%\s*-\s*var\(--cv3-director-dock-width\)\s*\)/,
  )
  assert.doesNotMatch(`${panelSource}\n${shellSource}`, /localStorage\.removeItem\(/)
  assert.doesNotMatch(closeDirectorBody, /localStorage|directorDock|isDocked|dockWidth/)
  assert.match(closeDirectorBody, /activePanel\.value\s*=\s*''/)
  assert.match(closeDirectorBody, /agentOrb\.value\?\.focus\(\)/)
})

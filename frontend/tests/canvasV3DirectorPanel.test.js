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
const scriptSetupUrl = new URL(
  '../src/features/canvas-v3/components/ScriptSetupDialog.vue',
  import.meta.url,
)

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

test('the floating Director panel keeps its geometry and introduces the four home product workflows', async () => {
  const source = await readFile(componentUrl, 'utf8')

  assert.match(source, /const DEFAULT_RECT = \{ right: 16, bottom: 16, width: 400, height: 640 \}/)
  assert.match(source, /border-radius: 28px/)

  const welcomeActions = [
    '有米家居创作导演',
    '专注窗帘、床垫、实木床与儿童床的电商内容创作',
    '窗帘：场景与卖点策划',
    '床垫：体验与视频策划',
    '实木床：结构与质感表达',
    '儿童床：空间与使用演示',
  ]
  for (const copy of welcomeActions) {
    assert.ok(source.includes(copy), `missing welcome copy: ${copy}`)
  }
  const shortcutBody = source.match(/function activateShortcut\(shortcut\)[\s\S]*?\n\}/)?.[0] || ''
  assert.match(shortcutBody, /prompt\.value = shortcut\.prompt/)
  assert.match(shortcutBody, /composerInput\.value\?\.focus/)
  assert.doesNotMatch(shortcutBody, /emit\(|submit|selectMode\(/)
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

test('the Director creation-mode trigger exposes the complete accessible menu hierarchy', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const buttonTags = [...source.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((match) => match[0])
  const modeTrigger = buttonTags.find((tag) => tag.includes('aria-label="选择创作模式"')) || ''

  assert.ok(modeTrigger, 'missing creation-mode trigger')
  assert.match(modeTrigger, /ref="modeTrigger"/)
  assert.match(modeTrigger, /aria-haspopup="menu"/)
  assert.match(modeTrigger, /:aria-expanded="modeMenuOpen"/)
  assert.match(modeTrigger, /aria-controls="cv3-director-mode-menu"/)
  assert.match(modeTrigger, /@click\.stop="toggleModeMenu"/)
  assert.match(modeTrigger, /activeMode\.triggerLabel/)

  assert.match(source, /id="cv3-director-mode-menu"[\s\S]{0,240}role="menu"/)
  assert.match(
    source,
    /role="menuitemradio"[\s\S]{0,180}:aria-checked="activeModeId === item\.modeId"/,
  )
  assert.match(
    source,
    /:data-mode-id="item\.modeId"[\s\S]{0,100}@click="selectMode\(item\.modeId\)"/,
  )
  assert.match(source, /role="menuitem"[\s\S]{0,160}aria-haspopup="menu"/)
  assert.match(source, /class="cv3-director-script-submenu"[\s\S]{0,120}role="menu"/)
  assert.match(source, /role="menuitemradio"[\s\S]{0,180}:aria-checked="activeModeId === modeId"/)
})

test('switching Director modes updates context without replacing or clearing the composer', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const selectModeBody = source.match(/function selectMode\(modeId[\s\S]*?\n\}/)?.[0] || ''

  assert.match(
    source,
    /import \{[\s\S]*?DIRECTOR_MODE_MENU[\s\S]*?getDirectorMode[\s\S]*?\} from ['"]\.\.\/config\/directorModes\.js['"]/,
  )
  assert.match(selectModeBody, /activeModeId\.value\s*=\s*getDirectorMode\(modeId\)\.id/)
  assert.match(selectModeBody, /closeInlinePopups\(\{ restoreFocus: true \}\)/)
  assert.match(
    selectModeBody,
    /activeModeId\.value === ['"]script_original['"][\s\S]*?scriptSetupOpen\.value = true/,
  )
  assert.match(selectModeBody, /composerInput\.value\?\.focus/)
  assert.doesNotMatch(selectModeBody, /prompt\.value\s*=/)
  assert.doesNotMatch(selectModeBody, /sentMessages\.value\s*=/)
  assert.match(source, /ref="composerInput"[\s\S]{0,160}v-model="prompt"/)
  assert.match(source, /:placeholder="activeMode\.placeholder"/)
})

test('Director mode popups dismiss before the shell closes the Director panel', async () => {
  const [panelSource, shellSource] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
  ])
  const escapeBody = panelSource.match(/function handlePanelEscape\(event\)[\s\S]*?\n\}/)?.[0] || ''

  assert.match(
    panelSource,
    /:data-director-popup-open="hasInlinePopup \|\| scriptSetupOpen \? 'true' : undefined"/,
  )
  assert.match(panelSource, /@keydown\.esc="handlePanelEscape"/)
  assert.match(escapeBody, /if \(!hasInlinePopup\.value\) return/)
  assert.match(escapeBody, /event\.preventDefault\(\)/)
  assert.match(escapeBody, /event\.stopPropagation\(\)/)
  assert.match(escapeBody, /closeInlinePopups/)
  assert.match(
    shellSource,
    /event\.target\?\.closest\?\.\(['"]\[data-director-popup-open="true"\]['"]\)[\s\S]{0,80}if \(directorPopupOpen\) return/,
  )

  assert.match(
    panelSource,
    /document\.addEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
  )
  assert.match(
    panelSource,
    /document\.removeEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
  )
  assert.match(panelSource, /modeTrigger\.value, modeMenu\.value/)
})

test('script, adaptation and directing modes expose their captured functional controls', async () => {
  const [panelSource, scriptSetupSource] = await Promise.all([
    readFile(componentUrl, 'utf8'),
    readFile(scriptSetupUrl, 'utf8'),
  ])

  assert.match(panelSource, /activeModeId === ['"]script_original['"]/)
  assert.match(panelSource, /v-for="preset in DIRECTOR_HOT_PRESETS"/)
  assert.ok(panelSource.includes('从爆款题材开始'))
  assert.match(
    panelSource,
    /<ScriptSetupDialog[\s\S]*?:open="scriptSetupOpen"[\s\S]*?@confirm="confirmScriptSetup"/,
  )
  assert.match(scriptSetupSource, /role="dialog"/)
  assert.match(scriptSetupSource, /aria-modal="true"/)
  assert.match(scriptSetupSource, /v-for="field in DIRECTOR_SCRIPT_FIELDS"/)
  assert.match(scriptSetupSource, /DIRECTOR_SCRIPT_EPISODES\.(?:min|max|step)/)

  assert.match(panelSource, /activeModeId === ['"]script_adaptation['"]/)
  assert.ok(panelSource.includes('上传故事，快速改编为可拍剧本'))
  assert.match(panelSource, /accept="\.pdf,\.txt,\.md,\.doc,\.docx"/)
  assert.match(
    panelSource,
    /class="cv3-director-adaptation-popover"[\s\S]{0,160}role="dialog"[\s\S]{0,80}aria-label="改编设定"/,
  )
  assert.match(panelSource, /v-for="direction in DIRECTOR_ADAPTATION_DIRECTIONS"/)
  assert.match(panelSource, /:min="DIRECTOR_ADAPTATION_EPISODES\.min"/)
  assert.match(panelSource, /:max="DIRECTOR_ADAPTATION_EPISODES\.max"/)
  assert.match(panelSource, /@click="resetAdaptationSettings"/)

  assert.match(panelSource, /activeModeId === ['"]directing['"]/)
  assert.match(panelSource, /v-for="role in DIRECTOR_ROLES"/)
  assert.match(panelSource, /role="radiogroup" aria-label="导演角色"/)
  assert.match(
    panelSource,
    /role="radio"[\s\S]{0,100}:aria-checked="role\.id === activeDirectorRoleId"/,
  )
  assert.ok(panelSource.includes('创建新的导演角色'))
  assert.ok(panelSource.includes('导入已有的导演角色'))
  assert.ok(panelSource.includes('优化镜头语言'))
  assert.ok(panelSource.includes('一句话生成分镜'))
})

test('Director mode transitions are anchored and honor reduced-motion preferences', async () => {
  const source = await readFile(componentUrl, 'utf8')
  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'))

  assert.match(source, /\.cv3-director-mode-menu\s*\{[\s\S]*?bottom:/)
  assert.match(
    source,
    /\.cv3-director-popover-enter-active,[\s\S]*?transform-origin:\s*bottom left/,
  )
  assert.match(
    source,
    /\.cv3-director-popover-enter-from,[\s\S]*?opacity:\s*0[\s\S]*?translateY\(5px\) scale\(0\.98\)/,
  )
  assert.match(reducedMotion, /\.cv3-director-script-home/)
  assert.match(reducedMotion, /\.cv3-director-directing/)
  assert.match(reducedMotion, /\.cv3-director-popover-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-popover-leave-active[\s\S]*?transition:\s*none/)
})

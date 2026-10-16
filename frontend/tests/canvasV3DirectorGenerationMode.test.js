import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DIRECTOR_MODES } from '../src/features/canvas-v3/config/directorModes.js'
import {
  DIRECTOR_IMAGE_TASK_MODEL_ALIASES,
  resolveConfiguredImageTaskModel,
  resolveDirectorImageTaskModel,
} from '../src/features/canvas-v3/config/directorModelCatalog.js'

const pickerUrl = new URL(
  '../src/features/canvas-v3/components/DirectorGenerationModePicker.vue',
  import.meta.url,
)
const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)
const shellUrl = new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url)

function getFunction(source, name) {
  return source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0] || ''
}

test('generation-mode picker matches the captured 240px portal positioned eight pixels above its trigger', async () => {
  const source = await readFile(pickerUrl, 'utf8')

  assert.match(source, /const MENU_WIDTH = 240/)
  assert.match(source, /const TRIGGER_GAP = 8/)
  assert.match(source, /<Teleport to="body">/)
  assert.match(source, /\.cv3-director-generation-menu\s*\{[\s\S]*?position:\s*fixed/)
  assert.match(source, /left:\s*`\$\{left\}px`/)
  assert.match(
    source,
    /bottom:\s*`\$\{Math\.round\(window\.innerHeight - anchor\.top \+ TRIGGER_GAP\)\}px`/,
  )
  assert.match(source, /width:\s*`\$\{Math\.round\(width\)\}px`/)
  assert.match(source, /transform-origin:[^\n]*--cv3-generation-origin-x[^\n]*bottom/)
})

test('generation-mode picker exposes the exact manual and automatic choices, copy, icons and pressed state', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const option = source.match(/<button[\s\S]*?v-for="mode in MODES"[\s\S]*?<\/button>/)?.[0] || ''

  assert.match(
    source,
    /id:\s*['"]manual['"][\s\S]*?label:\s*['"]手动生成['"][\s\S]*?description:\s*['"]TV Director 每次生成前询问['"][\s\S]*?dryRun:\s*true/,
  )
  assert.match(
    source,
    /id:\s*['"]auto['"][\s\S]*?label:\s*['"]自动生成['"][\s\S]*?description:\s*['"]TV Director 可直接消耗积分['"][\s\S]*?dryRun:\s*false/,
  )
  assert.equal((source.match(/\bid:\s*['"](?:manual|auto)['"]/g) || []).length, 2)

  assert.ok(option, 'missing generation mode options')
  assert.match(option, /role="menuitemradio"/)
  assert.match(option, /:aria-checked="modelValue === mode\.dryRun"/)
  assert.match(option, /:aria-pressed="modelValue === mode\.dryRun"/)
  assert.match(option, /:data-generation-mode="mode\.id"/)
  assert.match(option, /<svg v-if="mode\.dryRun"/)
  assert.match(option, /<svg v-else/)
  assert.match(option, /<strong>\{\{ mode\.label \}\}<\/strong>/)
  assert.match(option, /<small>\{\{ mode\.description \}\}<\/small>/)

  assert.match(source, /aria-haspopup="menu"/)
  assert.match(source, /:aria-expanded="open"/)
  assert.match(source, /:title="activeMode\.label"/)
  assert.match(source, /:aria-label="activeMode\.label"/)
  assert.match(source, /id="cv3-director-generation-mode-menu"/)
  assert.match(source, /role="menu"/)
  assert.match(source, /aria-label="选择生成方式"/)
})

test('manual dry-run is the safe default and choosing either mode only updates intent then closes', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const selectMode = getFunction(source, 'selectMode')
  const toggleMenu = getFunction(source, 'toggleMenu')

  assert.match(source, /modelValue:\s*\{\s*type:\s*Boolean,\s*default:\s*true\s*\}/)
  assert.match(
    source,
    /const activeMode = computed\([\s\S]*?\(\) => MODES\.find\(\(mode\) => mode\.dryRun === props\.modelValue\) \|\| MODES\[0\][\s\S]*?\)/,
  )
  assert.match(selectMode, /emit\(['"]update:modelValue['"], mode\.dryRun\)/)
  assert.match(selectMode, /emit\(['"]change['"], mode\.dryRun\)/)
  assert.match(selectMode, /closeMenu\(\{ restoreFocus: true \}\)/)
  assert.match(toggleMenu, /props\.open[\s\S]*?closeMenu\(\{ restoreFocus: false \}\)/)
  assert.match(toggleMenu, /else requestOpen\(true\)/)

  for (const body of [selectMode, toggleMenu]) {
    assert.doesNotMatch(
      body,
      /fetch\s*\(|axios|image-tasks|video-tasks|runImage|runVideo|submitTask/,
    )
  }
  assert.doesNotMatch(
    source,
    /\/api\/(?:image|video)-tasks|tasks\.(?:runImage|runVideo)|(?:image|video)TaskStore/,
  )
})

test('generation-mode popup supports Escape, outside dismissal, selected focus and trigger focus restoration', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const triggerKeys = getFunction(source, 'handleTriggerKeydown')
  const menuKeys = getFunction(source, 'handleMenuKeydown')
  const outsidePointer = getFunction(source, 'handleDocumentPointerDown')

  assert.match(triggerKeys, /event\.key === ['"]ArrowDown['"] \|\| event\.key === ['"]ArrowUp['"]/)
  assert.match(triggerKeys, /event\.key === ['"]Escape['"] && props\.open/)
  assert.match(triggerKeys, /event\.preventDefault\(\)/)
  assert.match(triggerKeys, /event\.stopPropagation\(\)/)
  assert.match(triggerKeys, /closeMenu\(\{ restoreFocus: true \}\)/)

  for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter']) {
    assert.ok(menuKeys.includes(`'${key}'`), `missing menu key: ${key}`)
  }
  assert.match(menuKeys, /items\[current\]\.click\(\)/)
  assert.match(menuKeys, /items\[next\]\?\.focus\(\{ preventScroll: true \}\)/)

  assert.match(outsidePointer, /const path = event\.composedPath\?\.\(\) \|\| \[\]/)
  assert.match(outsidePointer, /\[trigger\.value, menu\.value\]/)
  assert.match(outsidePointer, /if \(!inside\) closeMenu\(\{ restoreFocus: false \}\)/)
  assert.match(
    source,
    /document\.addEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
  )
  assert.match(
    source,
    /document\.removeEventListener\(['"]pointerdown['"], handleDocumentPointerDown, true\)/,
  )

  assert.match(source, /focusMode\(focusOnOpen\)/)
  assert.match(source, /getAttribute\(['"]aria-checked['"]\) === ['"]true['"]/)
  assert.match(source, /trigger\.value\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(source, /restoreFocusAfterClose/)
})

test('generation-mode popup has symmetrical viewport listeners and honors reduced motion', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  const reducedMotion = source.slice(source.indexOf('@media (prefers-reduced-motion: reduce)'))
  const listenerPairs = [
    [
      /window\.addEventListener\(['"]resize['"], updatePosition\)/,
      /window\.removeEventListener\(['"]resize['"], updatePosition\)/,
    ],
    [
      /window\.addEventListener\(['"]scroll['"], updatePosition, true\)/,
      /window\.removeEventListener\(['"]scroll['"], updatePosition, true\)/,
    ],
    [
      /window\.visualViewport\?\.addEventListener\(['"]resize['"], updatePosition\)/,
      /window\.visualViewport\?\.removeEventListener\(['"]resize['"], updatePosition\)/,
    ],
    [
      /window\.visualViewport\?\.addEventListener\(['"]scroll['"], updatePosition\)/,
      /window\.visualViewport\?\.removeEventListener\(['"]scroll['"], updatePosition\)/,
    ],
  ]

  for (const [add, remove] of listenerPairs) {
    assert.match(source, add)
    assert.match(source, remove)
  }
  assert.match(source, /watch\([\s\S]*?\(\) => props\.open/)
  assert.match(reducedMotion, /\.cv3-director-generation-trigger/)
  assert.match(reducedMotion, /\.cv3-director-generation-option/)
  assert.match(reducedMotion, /\.cv3-director-generation-popover-enter-active/)
  assert.match(reducedMotion, /\.cv3-director-generation-popover-leave-active/)
  assert.match(reducedMotion, /transform:\s*none/)
})

test('Director panel integrates one mutually exclusive generation-mode picker and closes it with other inline popups', async () => {
  const source = await readFile(panelUrl, 'utf8')

  assert.match(
    source,
    /import DirectorGenerationModePicker from ['"]\.\/DirectorGenerationModePicker\.vue['"]/,
  )
  assert.match(source, /const generationModeMenuOpen = ref\(false\)/)
  assert.match(source, /const directorDryRun = ref\(true\)/)
  assert.match(source, /const pendingDryRunIntent = ref\((?:undefined|null|true)\)/)
  assert.match(source, /sessionId:\s*\{\s*type:\s*String/)
  assert.match(source, /defineEmits\([\s\S]*?['"]submit['"]/)
  assert.match(source, /const hasInlinePopup = computed\([\s\S]*?generationModeMenuOpen\.value/)
  assert.match(source, /function closeInlinePopups[\s\S]*?generationModeMenuOpen\.value = false/)

  const pickerTag = source.match(/<DirectorGenerationModePicker\b[\s\S]*?\/>/)?.[0] || ''
  assert.ok(pickerTag, 'missing generation-mode picker integration')
  assert.match(pickerTag, /v-if="activeMode\.controls\.includes\(['"]send['"]\)"/)
  assert.match(pickerTag, /v-model:open="generationModeMenuOpen"/)
  assert.match(pickerTag, /v-model="directorDryRun"/)
  assert.match(pickerTag, /@change="handleGenerationModeChange"/)

  const mutualExclusion =
    source.match(/watch\(generationModeMenuOpen,[\s\S]*?\n\}\)/)?.[0] ||
    getFunction(source, 'handleGenerationModeOpen') ||
    getFunction(source, 'setGenerationModeMenuOpen') ||
    getFunction(source, 'toggleGenerationModeMenu')
  assert.ok(mutualExclusion, 'missing generation-mode mutual-exclusion behavior')
  assert.match(mutualExclusion, /generationModeMenuOpen|watch\(generationModeMenuOpen/)
  assert.match(mutualExclusion, /modelMenuOpen\.value = false/)
  assert.match(mutualExclusion, /skillMenuOpen\.value = false/)
  assert.match(mutualExclusion, /(?:modeMenuOpen\.value = false|closeModeMenu\(\))/)
  assert.doesNotMatch(
    mutualExclusion,
    /fetch\s*\(|\/api\/(?:image|video)-tasks|runImage|runVideo|submitTask/,
  )
})

test('every submittable Director mode visibly exposes the manual or automatic generation state', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const pickerTag = source.match(/<DirectorGenerationModePicker\b[\s\S]*?\/>/)?.[0] || ''

  for (const mode of Object.values(DIRECTOR_MODES)) {
    if (mode.controls.includes('send'))
      assert.ok(mode.controls.includes('manual'), `${mode.id} hides its paid generation state`)
  }
  assert.match(pickerTag, /activeMode\.controls\.includes\(['"]send['"]\)/)
})

test('Director generation choice persists as a global user default without weakening the safe default', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const restoreMode = getFunction(source, 'restoreGenerationMode')
  const changeMode = getFunction(source, 'handleGenerationModeChange')

  assert.match(source, /const GENERATION_MODE_KEY = ['"]libtv:director:generationMode['"]/)
  assert.match(restoreMode, /localStorage\.getItem\(GENERATION_MODE_KEY\)/)
  assert.match(restoreMode, /directorDryRun\.value = stored !== ['"]auto['"]/)
  assert.match(restoreMode, /catch[\s\S]*?directorDryRun\.value = true/)
  assert.match(
    changeMode,
    /localStorage\.setItem\(GENERATION_MODE_KEY, directorDryRun\.value \? ['"]manual['"] : ['"]auto['"]\)/,
  )
  assert.doesNotMatch(source, /generationModeStorageKey|sessionStorage/)
  assert.match(changeMode, /pendingDryRunIntent\.value = directorDryRun\.value/)
  assert.match(changeMode, /mode:\s*directorDryRun\.value \? ['"]manual['"] : ['"]auto['"]/)
  assert.doesNotMatch(changeMode, /fetch\s*\(|\/api\/(?:image|video)-tasks|runImage|runVideo/)
})

test('Director send payload carries dryRunIntent and metadata without selection or send bypassing task approval', async () => {
  const source = await readFile(panelUrl, 'utf8')
  const submitPrompt = getFunction(source, 'submitPrompt')

  assert.ok(submitPrompt, 'missing Director submitPrompt')
  assert.match(
    submitPrompt,
    /const dryRunIntent = pendingDryRunIntent\.value \?\? directorDryRun\.value/,
  )
  assert.match(submitPrompt, /dryRunIntent,/)
  assert.match(
    submitPrompt,
    /context:\s*\{[\s\S]*?metadata:\s*\{[\s\S]*?dryRun:\s*dryRunIntent[\s\S]*?generationMode:\s*dryRunIntent\s*\?\s*['"]manual['"]\s*:\s*['"]auto['"]/,
  )
  assert.match(submitPrompt, /emit\(['"]submit['"],\s*[^)]+\)/)
  assert.doesNotMatch(submitPrompt, /directorDryRun\.value\s*=\s*(?:true|false)/)
  assert.doesNotMatch(
    submitPrompt,
    /\/api\/(?:image|video)-tasks|tasks\.(?:runImage|runVideo)|runImage|runVideo/,
  )

  const selectionBodies = [
    getFunction(source, 'handleGenerationModeChange'),
    getFunction(source, 'handleGenerationModeOpen'),
    getFunction(source, 'setGenerationModeMenuOpen'),
  ].filter(Boolean)
  for (const body of selectionBodies) {
    assert.doesNotMatch(
      body,
      /fetch\s*\(|\/api\/(?:image|video)-tasks|tasks\.(?:runImage|runVideo)|runImage|runVideo/,
    )
  }

  assert.match(source, /const dryRunIntent = pendingDryRunIntent\.value \?\? directorDryRun\.value/)
})

test('Director catalogue aliases resolve one exact executable task model and never fall back', () => {
  const options = [
    { value: 'GPT-image2.5', label: 'GPT-image2.5快速' },
    { value: 'gpt-image2.5-sunburst-api', label: 'GPT-image2.5高质' },
    { value: 'banana-pro-api', label: '香蕉 Pro' },
  ]

  assert.ok(Object.isFrozen(DIRECTOR_IMAGE_TASK_MODEL_ALIASES))
  assert.equal(resolveDirectorImageTaskModel('lib-image-2.5-f', options).value, 'GPT-image2.5')
  assert.equal(
    resolveDirectorImageTaskModel('lib-image-2.5-s', options).value,
    'gpt-image2.5-sunburst-api',
  )
  assert.equal(
    resolveDirectorImageTaskModel('Lib Image 2.5 Pro', options).value,
    'gpt-image2.5-sunburst-api',
  )
  assert.equal(resolveDirectorImageTaskModel('nebula-ultra', options).value, 'banana-pro-api')
  assert.equal(resolveConfiguredImageTaskModel('banana-pro-api', options).value, 'banana-pro-api')
  assert.throws(
    () =>
      resolveDirectorImageTaskModel('lib-image-2.5-s', [
        { value: 'some-other-provider-model', label: 'GPT-image2.5高质' },
      ]),
    /尚未映射到模型管理/,
  )
  assert.throws(() => resolveDirectorImageTaskModel('mj-v8.2', options), /尚未映射到模型管理/)
  assert.throws(() => resolveConfiguredImageTaskModel('', options), /请.*选择/)
})

test('Canvas shell consumes Director submits through a two-stage plan and generation pipeline', async () => {
  const shell = await readFile(shellUrl, 'utf8')
  const directorTag = shell.match(/<DirectorPanel\b[\s\S]*?\/>/)?.[0] || ''
  const handleSubmit = getFunction(shell, 'handleDirectorSubmit')
  const plan = getFunction(shell, 'planDirectorMessage')
  const submitDraft = getFunction(shell, 'submitDirectorDraft')
  const confirm = getFunction(shell, 'confirmDirectorGeneration')

  assert.match(directorTag, /:agent-runs="directorAgentRuns"/)
  assert.match(directorTag, /@submit="handleDirectorSubmit"/)
  assert.match(directorTag, /@confirm-generation="confirmDirectorGeneration"/)
  assert.match(directorTag, /@retry-agent="retryDirectorAgent"/)

  assert.match(handleSubmit, /dryRun:\s*message\.dryRunIntent !== false/)
  assert.match(handleSubmit, /const generationIntent = createDirectorGenerationIntent\(message\)/)
  assert.match(handleSubmit, /generationIntent,/)
  assert.match(handleSubmit, /clientTaskId:\s*directorRequestId\(['"]director-image['"]\)/)
  assert.match(handleSubmit, /submissionStarted:\s*false/)
  assert.match(handleSubmit, /clientMessageId:\s*message\.id \|\| ['"]/)
  assert.match(handleSubmit, /void planDirectorMessage\(run\.id\)/)
  assert.doesNotMatch(handleSubmit, /tasks\.runImage|\/api\/image-tasks|\/api\/video-tasks/)

  assert.match(plan, /\/api\/ai\/canvas-agent\/chat/)
  assert.match(shell, /if \(!requested\.length && !intent\.nodeModel\) return \[\]/)
  assert.match(plan, /Agent 不会替你选择付费模型/)
  assert.match(shell, /if \(requestedKeys\.size > 1\)[\s\S]*?一次生成只能选择一个模型/)
  assert.match(plan, /canCreateAgentDraft\(response, prompts\)/)
  assert.match(
    plan,
    /draft\?\.generationType === ['"]image['"] && nextRun\?\.dryRun === false[\s\S]*?await submitDirectorDraft\(runId\)/,
  )
  assert.doesNotMatch(plan, /\/api\/(?:image|video)-tasks/)

  assert.match(submitDraft, /directorGenerationSubmissions\.has\(runId\)/)
  assert.match(submitDraft, /directorGenerationSubmissions\.add\(runId\)/)
  assert.match(submitDraft, /graph\.(?:createImageVariation|addNode)\(/)
  assert.match(submitDraft, /graph\.connect\(/)
  assert.match(
    submitDraft,
    /await tasks\.runImage\(target\.id, focusGenerated, \{[\s\S]*?clientTaskId:\s*run\.clientTaskId,[\s\S]*?onSubmitStart:/,
  )
  assert.match(
    submitDraft,
    /run\.submissionStarted \|\| run\.submissionState === ['"]uncertain['"]/,
  )
  assert.match(submitDraft, /generation:\s*\{[\s\S]*?clientTaskId:\s*run\.clientTaskId/)
  assert.match(submitDraft, /await tasks\.resume\(resumed\.id\)/)
  assert.ok(
    submitDraft.indexOf('await tasks.resume(resumed.id)') <
      submitDraft.indexOf('await tasks.loadModels()'),
    'uncertain tasks must resume before model or reference revalidation',
  )
  assert.match(
    submitDraft,
    /!\[['"]queued['"], ['"]running['"], ['"]paused['"], ['"]succeeded['"]\]\.includes\(submitted\.data\.runState\)/,
  )
  assert.doesNotMatch(submitDraft, /fetch\s*\(|\/api\/image-tasks|\/api\/video-tasks/)
  assert.match(shell, /tasks\.attach\(props\.projectId, \{ beforeImageSubmit: saveNow \}\)/)

  assert.match(confirm, /run\.phase !== ['"]ready['"]/)
  assert.match(confirm, /run\.draft\?\.generationType !== ['"]image['"]/)
  assert.match(confirm, /void submitDirectorDraft\(runId\)/)
})

test('Director task orchestration keeps mode selection inert and unsafe media out of auto-submit', async () => {
  const shell = await readFile(shellUrl, 'utf8')
  const panel = await readFile(panelUrl, 'utf8')
  const changeMode = getFunction(panel, 'handleGenerationModeChange')
  const plan = getFunction(shell, 'planDirectorMessage')

  assert.doesNotMatch(changeMode, /fetch\s*\(|tasks\.runImage|\/api\/(?:image|video)-tasks/)
  assert.match(
    shell,
    /const referenceNodes = selectedNodes\.filter\([\s\S]*?node\.data\.kind === ['"]image['"] && node\.data\.assetUrl/,
  )
  assert.match(plan, /generationType:\s*intent\.generationType/)
  assert.match(plan, /responseGenerationType !== intent\.generationType[\s\S]*?与发送时选择的/)
  assert.match(plan, /draftRequested && !paidConfigurationError/)
  assert.match(
    plan,
    /if \(draft\?\.generationType === ['"]image['"] && nextRun\?\.dryRun === false\)/,
  )
  assert.match(
    shell,
    /for \(const controller of directorPlanningRequests\.values\(\)\) controller\.abort\(\)/,
  )
  assert.doesNotMatch(shell, /fetch\(apiPath\(['"]\/api\/(?:image|video)-tasks/)
})

test('Director freezes paid parameters at send time and ignores Agent parameter overrides', async () => {
  const shell = await readFile(shellUrl, 'utf8')
  const panel = await readFile(panelUrl, 'utf8')
  const createIntent = getFunction(shell, 'createDirectorGenerationIntent')
  const plan = getFunction(shell, 'planDirectorMessage')

  assert.match(createIntent, /const selectedNodes = \[\.\.\.graph\.selectedNodes\]/)
  assert.match(createIntent, /requestedModels:\s*Object\.freeze\(requestedModels\)/)
  assert.match(createIntent, /referenceLayerIds:\s*Object\.freeze/)
  assert.match(createIntent, /referenceAssets:\s*Object\.freeze/)
  for (const field of ['ratio', 'resolution', 'count', 'quality', 'background'])
    assert.match(createIntent, new RegExp(`${field}:`), `missing frozen ${field}`)
  assert.match(
    createIntent,
    /count:\s*generationType === ['"]image['"] \? 1 : directorCount\(params\.count\)/,
    'Director image generation must ignore a multi-image node count and freeze one output',
  )
  assert.match(createIntent, /return Object\.freeze\(/)

  for (const field of ['referenceLayerIds', 'model', 'ratio', 'resolution', 'count'])
    assert.doesNotMatch(plan, new RegExp(`response\\.${field}`), `Agent overrides ${field}`)
  assert.doesNotMatch(plan, /response\.(?:imageModel|imageModels)/)
  assert.match(plan, /modelLabel:\s*primaryModel\?\.label/)
  assert.match(plan, /background:\s*intent\.background/)
  assert.match(shell, /参考图片在发送后已发生变化/)

  assert.match(panel, /aria-label="生成参数与费用摘要"/)
  assert.match(panel, /item\.run\.draft\.modelLabel/)
  assert.match(panel, /item\.run\.draft\.count/)
  assert.match(panel, /directorDraftOutputSummary\(item\.run\.draft\)/)
  assert.match(panel, /directorDraftCostSummary\(item\.run\.draft\)/)
})

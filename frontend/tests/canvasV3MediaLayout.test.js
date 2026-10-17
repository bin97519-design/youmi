import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  isStandaloneUploadedImage,
  nodeSize,
} from '../src/features/canvas-v3/config/nodeGeometry.js'

const shellSource = fs.readFileSync(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const toolbarSource = fs.readFileSync(
  new URL('../src/features/canvas-v3/components/ImageActionToolbar.vue', import.meta.url),
  'utf8',
)

test('image nodes fit their real media ratio instead of leaving letterbox gaps', () => {
  assert.deepEqual(
    nodeSize('image', { assetUrl: 'data:image/png;base64,x', mediaWidth: 1039, mediaHeight: 931 }),
    { width: 391, height: 350 },
  )
  assert.deepEqual(
    nodeSize('image', {
      assetUrl: 'data:image/png;base64,x',
      mediaWidth: 1039,
      mediaHeight: 931,
      rotation: 90,
    }),
    { width: 314, height: 350 },
  )
  assert.deepEqual(nodeSize('image'), { width: 624, height: 350 })
})

test('uploaded image detection is explicit and remains compatible with older local canvases', () => {
  assert.equal(
    isStandaloneUploadedImage({
      kind: 'image',
      assetUrl: 'data:image/png;base64,x',
      artifactStatus: 'ready',
      runState: 'idle',
    }),
    true,
  )
  assert.equal(
    isStandaloneUploadedImage({
      kind: 'image',
      assetUrl: 'https://example.test/result.png',
      artifactStatus: 'ready',
      runState: 'succeeded',
      generation: { taskIds: ['task-1'] },
    }),
    false,
  )
})

test('the image toolbar stays anchored to the selected image center without viewport clamping', () => {
  assert.match(
    shellSource,
    /left: \(node\.position\.x \+ size\.width \/ 2\) \* view\.zoom \+ view\.x/,
  )
  assert.match(shellSource, /top: node\.position\.y \* view\.zoom \+ view\.y - 84/)
  assert.doesNotMatch(shellSource, /const imageToolbarTop/)
  assert.match(toolbarSource, /left: left \+ 'px'/)
})

test('standalone uploads keep image tools but do not render the generation composer', () => {
  assert.match(shellSource, /!isStandaloneUploadedImage\(graph\.activeNode\.data\)/)
  assert.match(shellSource, /graph\.activeNode\?\.data\.kind === 'image'/)
})

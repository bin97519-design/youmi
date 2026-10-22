import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('only grouped child labels use canvas coordinates, while the group toolbar keeps fixed screen typography', async () => {
  const node = await readFile(
    new URL('../src/features/canvas-v3/components/GeneratorNode.vue', import.meta.url),
    'utf8',
  )
  const toolbar = await readFile(
    new URL('../src/features/canvas-v3/components/GroupActionToolbar.vue', import.meta.url),
    'utf8',
  )
  assert.match(node, /'is-grouped': Boolean\(data.groupId\)/)
  assert.match(node, /<style scoped>/)
  assert.match(
    node,
    /\.cv3-media-node\.is-grouped > \.cv3-media-node-label\s*\{[^}]*width: 100%;[^}]*transform: none;/s,
  )
  assert.match(node, /'--cv3-node-inverse-zoom': 1 \/ zoom/)
  assert.match(toolbar, /font-size: 13px/)
  assert.doesNotMatch(toolbar, /scale\(/)
})

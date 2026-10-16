import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sourceUrl = new URL('../src/features/canvas-v3/components/AgentOrb.vue', import.meta.url)

test('the canvas agent keeps the LibTV liquid-orb structure and states', async () => {
  const source = await readFile(sourceUrl, 'utf8')

  assert.match(source, /width: 48px/)
  assert.match(source, /width: 28px/)
  assert.match(source, /width: 82px/)
  assert.match(source, /0\.3414634146/)
  assert.match(source, /'static', 'working', 'waiting-user-actions'/)
  assert.equal(source.match(/class="cv3-liquid-orbit-path/g)?.length, 4)
  assert.match(source, /v-for="\(particle, index\) in particles"/)
  assert.equal(source.match(/\{ size:/g)?.length, 8)
  assert.match(source, /feTurbulence/)
  assert.match(source, /feDisplacementMap/)
  assert.match(source, /prefers-reduced-motion: reduce/)
})

test('the agent pill remains accessible and keeps its hidden Director label outside the toolbar flow', async () => {
  const [orbSource, shellSource, canvasCss] = await Promise.all([
    readFile(sourceUrl, 'utf8'),
    readFile(
      new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/features/canvas-v3/canvas-v3.css', import.meta.url), 'utf8'),
  ])

  assert.match(orbSource, /aria-label="创作助手"/)
  assert.match(orbSource, /:aria-expanded="active"/)
  assert.match(orbSource, />TV Director</)
  assert.match(orbSource, /class="cv3-agent-orb-tooltip" role="tooltip"/)
  assert.match(orbSource, /\.cv3-agent-orb:focus-visible/)
  assert.match(shellSource, /class="cv3-agent-slot"/)
  assert.match(canvasCss, /left: calc\(100% \+ 6px\)/)
  assert.match(canvasCss, /transform: translateX\(-50%\)/)
})

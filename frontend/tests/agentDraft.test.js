import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agentVideoDraftError,
  canCreateAgentDraft,
  totalAgentGenerationCount,
} from '../src/utils/agentDraft.js'

test('only exposes Agent generation after the backend marks the draft ready', () => {
  assert.equal(canCreateAgentDraft({ readyToGenerate: false }, ['draft']), false)
  assert.equal(canCreateAgentDraft({ readyToGenerate: true }, []), false)
  assert.equal(canCreateAgentDraft({ readyToGenerate: true }, ['draft']), true)
  assert.equal(
    canCreateAgentDraft({ readyToGenerate: true, generationType: 'video' }, ['script']),
    true,
  )
  assert.equal(
    canCreateAgentDraft({ readyToGenerate: true, generationType: 'execute' }, ['script']),
    false,
  )
})

test('video drafts validate model, script, duration, references and configured pricing before confirmation', () => {
  const config = {
    model: 'seedance-2.0-fast-0826-720p',
    resolution: '720p',
    duration: 15,
    referenceMode: 'shouweizhen',
  }
  assert.equal(agentVideoDraftError(config, [], 'script', null), '')
  assert.ok(agentVideoDraftError({ ...config, duration: 30 }, [], 'script', null))
  assert.ok(agentVideoDraftError({ ...config, model: 'minimax-h3-max' }, [], 'script', null))
  assert.ok(agentVideoDraftError(config, [], 'x'.repeat(2501), null))
  assert.ok(agentVideoDraftError(config, [], '', null))
  const h3 = { ...config, model: 'minimax-h3', resolution: '768p' }
  assert.ok(agentVideoDraftError(h3, [], 'script', null))
  const caps = { minimaxVideo: true, minimaxMiPerSecondByResolution: { '768p': 5 } }
  assert.equal(agentVideoDraftError(h3, [], 'script', caps), '')
  assert.ok(agentVideoDraftError(h3, [{}, {}, {}], 'script', caps))
  assert.equal(
    agentVideoDraftError({ ...h3, referenceMode: 'cankaosheng' }, [{}, {}, {}], 'script', caps),
    '',
  )
})

test('counts every selected model and per-model image quantity', () => {
  assert.equal(totalAgentGenerationCount(['banana2', 'gpt-image-2'], 2), 4)
  assert.equal(totalAgentGenerationCount(['banana2', 'banana2'], 8), 4)
})

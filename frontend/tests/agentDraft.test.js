import assert from 'node:assert/strict'
import test from 'node:test'

import { canCreateAgentDraft, totalAgentGenerationCount } from '../src/utils/agentDraft.js'

test('only exposes Agent generation after the backend marks the draft ready', () => {
  assert.equal(canCreateAgentDraft({ readyToGenerate: false }, ['draft']), false)
  assert.equal(canCreateAgentDraft({ readyToGenerate: true }, []), false)
  assert.equal(canCreateAgentDraft({ readyToGenerate: true }, ['draft']), true)
})

test('counts every selected model and per-model image quantity', () => {
  assert.equal(totalAgentGenerationCount(['banana2', 'gpt-image-2'], 2), 4)
  assert.equal(totalAgentGenerationCount(['banana2', 'banana2'], 8), 4)
})

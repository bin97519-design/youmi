import test from 'node:test'
import assert from 'node:assert/strict'
import { agentProviderRejection, isProviderRejectionText, AGENT_PROVIDER_BLOCKED_MESSAGE } from '../src/utils/agentProviderError.js'
import { readAgentStream, recoverInterruptedAgentMessage } from '../src/utils/agentStream.js'
import { canCreateAgentDraft, canDisplayAgentVideoDraft } from '../src/utils/agentDraft.js'

const notice = "The prompt could not be submitted. The prompt contains sensitive words that violate Google's [Generative AI Prohibited Use policy]."

test('a policy notice cannot become an image or video draft even if marked successful', () => {
  for (const generationType of ['image', 'video']) {
    const response = { generationType, readyToGenerate: true, draftPrompts: [notice] }
    assert.equal(agentProviderRejection(response), true)
    assert.equal(canCreateAgentDraft(response, response.draftPrompts), false)
    assert.equal(canDisplayAgentVideoDraft(response, response.draftPrompts), false)
  }
  assert.equal(isProviderRejectionText('小女孩坐在床边，母亲整理床铺。'), false)
  assert.equal(isProviderRejectionText('Explain the Generative AI Prohibited Use policy.'), false)
})

test('legacy policy cards become clear failures while preserving original attachments', () => {
  const message = { agent: true, role: 'assistant', generating: false, failed: false,
    text: '请再告诉我一些画面要求', referenceVideos: [{ url: 'https://media.test/original.mp4' }],
    agentDraft: { generationType: 'video', promptOnly: true, prompt: notice, items: [{ prompt: notice }] } }
  const fixed = recoverInterruptedAgentMessage(message)
  assert.equal(fixed.failed, true)
  assert.equal(fixed.agentDraft, null)
  assert.equal(fixed.text, AGENT_PROVIDER_BLOCKED_MESSAGE)
  assert.equal(fixed.referenceVideos, message.referenceVideos)
  const user = { ...message, role: 'user' }
  assert.equal(recoverInterruptedAgentMessage(user), user)
})

test('both streamed and ordinary JSON replies reject policy notices before displaying a result', async () => {
  const result = { generationType: 'video', draftPrompts: [notice] }
  const streamed = new Response(JSON.stringify({ type: 'result', data: result }) + '\n',
    { headers: { 'content-type': 'application/x-ndjson' } })
  await assert.rejects(readAgentStream(streamed, () => {}, () => {}), { code: 'PROVIDER_CONTENT_BLOCKED' })
  const ordinary = new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
  await assert.rejects(readAgentStream(ordinary, () => {}, response => response.json()), { code: 'PROVIDER_CONTENT_BLOCKED' })
  const blocked = new Response(JSON.stringify({ type: 'error', code: 'PROVIDER_CONTENT_BLOCKED', message: AGENT_PROVIDER_BLOCKED_MESSAGE }) + '\n',
    { headers: { 'content-type': 'application/x-ndjson' } })
  await assert.rejects(readAgentStream(blocked, () => {}, () => {}), { code: 'PROVIDER_CONTENT_BLOCKED' })
})

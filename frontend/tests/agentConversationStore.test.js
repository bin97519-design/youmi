import assert from 'node:assert/strict'
import test from 'node:test'

import {
  partitionConversationMessages,
  stripAgentMessages,
} from '../src/utils/agentConversationStore.js'

test('keeps Agent messages out of ordinary image chat', () => {
  const imageMessage = { id: 'image-1', role: 'user', text: '普通生图' }
  const agentMessage = { id: 'agent-1', role: 'user', text: '优化提示词', agent: true }
  const result = partitionConversationMessages([imageMessage, agentMessage], 'conversation-1')

  assert.deepEqual(result.regularMessages, [imageMessage])
  assert.equal(result.agentMessagesById.get('conversation-1')?.length, 1)
  assert.equal(result.agentMessagesById.get('conversation-1')?.[0].agentConversationId, 'conversation-1')
})

test('removes legacy and current Agent messages from canvas chat payload', () => {
  assert.deepEqual(
    stripAgentMessages([
      { id: 'image-1' },
      { id: 'legacy-agent', agent: true },
      { id: 'current-agent', agentConversationId: 'conversation-1' },
    ]),
    [{ id: 'image-1' }],
  )
})

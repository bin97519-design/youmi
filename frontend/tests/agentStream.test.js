import test from 'node:test'
import assert from 'node:assert/strict'
import { readAgentStream, recoverInterruptedAgentMessage, AGENT_REQUEST_TIMEOUT_MS } from '../src/utils/agentStream.js'

function response(chunks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    controller.close()
  } }), { headers: { 'content-type': 'application/x-ndjson' } })
}

test('split stream events deliver progress and preserve the final structured draft', async () => {
  const events = []
  const result = await readAgentStream(response([
    '{"type":"thinking","label":"正在策划"}\n{"type":"reply_',
    'delta","delta":"你好"}\n{"type":"result","data":{"draftPrompts":["完整方案"]}}',
  ]), event => events.push(event), () => assert.fail('unexpected fallback'))
  assert.equal(events[1].delta, '你好')
  assert.deepEqual(result.draftPrompts, ['完整方案'])
})

test('stream without a final result reports interruption instead of remaining busy', async () => {
  await assert.rejects(readAgentStream(response(['{"type":"reply_delta","delta":"部分"}\n']), () => {}, () => {}), /中断/)
  await assert.rejects(readAgentStream(response(['{"type":"error","message":"通道超时"}\n']), () => {}, () => {}), /通道超时/)
})

test('missing format headers still parse a successful stream instead of reporting HTTP 200 as failure', async () => {
  const events = []
  const body = '{"type":"reply_delta","delta":"回复"}\n{"type":"result","data":{"reply":"完整回复"}}\n'
  const result = await readAgentStream(new Response(body), event => events.push(event),
    () => assert.fail('must not parse NDJSON as regular JSON'))
  assert.equal(result.reply, '完整回复')
  assert.equal(events.length, 1)
})

test('only old unfinished Agent replies are recovered, completed replies stay unchanged', () => {
  const now = 2000000
  const stale = { agent: true, role: 'assistant', generating: true, createdAt: 1 }
  assert.equal(recoverInterruptedAgentMessage(stale, now).generating, false)
  const current = { ...stale, createdAt: now }
  assert.equal(recoverInterruptedAgentMessage(current, now), current)
  const completed = { ...stale, generating: false }
  assert.equal(recoverInterruptedAgentMessage(completed, now), completed)
  assert.equal(AGENT_REQUEST_TIMEOUT_MS, 1800000)
  const twentyMinutesOld = { ...stale, createdAt: now - 20 * 60000 }
  assert.equal(recoverInterruptedAgentMessage(twentyMinutesOld, now), twentyMinutesOld)
})

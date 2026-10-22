import test from 'node:test'
import assert from 'node:assert/strict'
import { recoverAgentVideoDraft, recoverFailedAgentVideoDrafts } from '../src/utils/agentVideoRecovery.js'

function fixture() {
  return [{ id:'draft', role:'assistant', agentDraft:{ generationType:'video', prompt:'完整原脚本',
    video:{model:'seedance-2.0-anci', version:'标准'}, referenceImages:[{url:'https://assets.example/original.png'}],
    items:[{id:'item', taskId:'failed-task', status:'submitted', prompt:'完整原脚本'},
      {id:'other', taskId:'other-task', status:'submitted', prompt:'其他方案'}] } },
  { id:'receipt', role:'assistant', videoGeneration:true, taskId:'failed-task', failed:true, generating:false }]
}

test('confirmed terminal video failure unlocks only its matching draft and preserves all originals', async () => {
  const messages = fixture(), source = JSON.stringify(messages), queried = []
  const recovered = await recoverFailedAgentVideoDrafts(messages, async id => {
    queried.push(id)
    return {status:'failed', error:'素材已失效（已退款）'}
  })
  assert.deepEqual(queried,['failed-task'])
  assert.equal(recovered[0].agentDraft.items[0].status,'failed')
  assert.equal(recovered[0].agentDraft.items[0].failureMessage,'素材已失效（已退款）')
  assert.equal(recovered[0].agentDraft.items[1],messages[0].agentDraft.items[1])
  assert.equal(recovered[0].agentDraft.video,messages[0].agentDraft.video)
  assert.equal(recovered[0].agentDraft.referenceImages,messages[0].agentDraft.referenceImages)
  assert.equal(recovered[0].agentDraft.prompt,'完整原脚本')
  assert.equal(JSON.stringify(messages),source)
})

test('local errors, interrupted polling, successful videos and uncertain states never permit duplicate generation', async () => {
  for (const status of ['queued','running','processing','persisting','completed','unknown','']) {
    const messages=fixture()
    const recovered=await recoverFailedAgentVideoDrafts(messages,async()=>({status}))
    assert.equal(recovered[0],messages[0],status)
  }
  const messages=fixture()
  const recovered=await recoverFailedAgentVideoDrafts(messages,async()=>{throw new Error('network timeout')})
  assert.equal(recovered[0],messages[0])
  messages[1].videoUrl='https://assets.example/result.mp4'
  await recoverFailedAgentVideoDrafts(messages,()=>assert.fail('a returned video must remain locked'))
})

test('an older failure cannot unlock a newer submission or an image draft', () => {
  const message=fixture()[0]
  message.agentDraft.items[0].taskId='new-task'
  assert.equal(recoverAgentVideoDraft(message,'failed-task',{status:'failed'}),message)
  message.agentDraft.items[0].taskId='failed-task'
  message.agentDraft.items[0].status='submitting'
  assert.equal(recoverAgentVideoDraft(message,'failed-task',{status:'failed'}),message)
  message.agentDraft.generationType='image'
  assert.equal(recoverAgentVideoDraft(message,'failed-task',{status:'failed'}),message)
})

test('legacy single video drafts recover only after confirmed cancellation', () => {
  const message={agentDraft:{generationType:'video',status:'submitted',taskId:'old-task',prompt:'原脚本'}}
  const recovered=recoverAgentVideoDraft(message,'old-task',{status:'canceled',error:'任务取消'})
  assert.equal(recovered.agentDraft.status,'failed')
  assert.equal(recovered.agentDraft.prompt,'原脚本')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { directorClarificationInstruction } from '../src/features/canvas-v3/config/directorClarifications.js'

function question(id, label) {
  return { id, question: label, options: ['方向一', '方向二'] }
}

function makeChain(length, prefix = 'home') {
  return Array.from({ length }, (_, index) => ({
    id: `${prefix}-${index}`,
    instruction: index ? `旧的合成上下文-${index}，禁止重复嵌套` : `为${prefix}商品策划15秒视频`,
    message: index
      ? { context: { clarification: { sourceRunId: `${prefix}-${index - 1}` } } }
      : { content: `为${prefix}商品策划15秒视频` },
    questions: [question(`question-${index}`, `第${index + 1}轮需要补充什么？`)],
    clarificationAnswers: [
      { questionId: `question-${index}`, answer: `已确认需求-${prefix}-${index}` },
    ],
    reply: `模型建议：不要将建议-${prefix}-${index}当成商品事实`,
  }))
}

test('retains the original brief and chronological answers after more than six rounds', () => {
  const runs = makeChain(9)
  const instruction = directorClarificationInstruction(runs, 'home-8', '本轮选择安静卧室场景')
  assert.ok(instruction.includes('为home商品策划15秒视频'))
  assert.ok(instruction.endsWith('需求补充不代表生成或付费授权，仍须遵守现有界面确认。'))
  let previousIndex = -1
  for (let index = 0; index < 9; index += 1) {
    const answerIndex = instruction.indexOf(`已确认需求-home-${index}`)
    assert.ok(answerIndex > previousIndex)
    previousIndex = answerIndex
  }
  assert.ok(instruction.indexOf('本轮选择安静卧室场景') > previousIndex)
  assert.equal(instruction.includes('旧的合成上下文'), false)
  assert.equal(instruction.includes('模型建议：'), false)
})

test('JSON-restored and unordered run records reconstruct the same isolated chain', () => {
  const runs = makeChain(4)
  const original = JSON.stringify(runs)
  const expected = directorClarificationInstruction(runs, 'home-3', '最新答案')
  const restored = JSON.parse(original).reverse()
  assert.equal(directorClarificationInstruction(restored, 'home-3', '最新答案'), expected)
  assert.equal(JSON.stringify(runs), original)
})

test('does not import another product chain or unselected model options as facts', () => {
  const runs = [...makeChain(3, '窗帘'), ...makeChain(4, '儿童床')]
  const instruction = directorClarificationInstruction(runs, '窗帘-2', '目标是窗帘场景视频')
  assert.ok(instruction.includes('已确认需求-窗帘-0'))
  assert.equal(instruction.includes('儿童床'), false)
  assert.equal(instruction.includes('方向一'), false)
  assert.ok(instruction.includes('模型提出的选项不是商品事实'))
})

test('terminates cyclic ancestry without reusing synthesized instructions', () => {
  const runs = makeChain(3)
  runs[0].instruction = '循环中的合成instruction，不允许当根需求'
  runs[0].message.context = { clarification: { sourceRunId: 'home-2' } }
  const instruction = directorClarificationInstruction(runs, 'home-2', '继续当前补充')
  assert.ok(instruction.includes('原始需求未能恢复'))
  assert.equal(instruction.includes('循环中的合成instruction'), false)
  assert.equal(instruction.includes('旧的合成上下文'), false)
  for (let index = 0; index < 3; index += 1) {
    assert.equal(instruction.split(`已确认需求-home-${index}`).length - 1, 1)
  }
  assert.ok(instruction.includes('继续当前补充'))
})

test('handles missing sources without guessing a root or using unrelated runs', () => {
  const runs = makeChain(2)
  runs[1].message.context.clarification.sourceRunId = 'deleted'
  const instruction = directorClarificationInstruction(runs, 'home-1', '当前回答')
  assert.ok(instruction.includes('原始需求未能恢复'))
  assert.ok(instruction.includes('已确认需求-home-1'))
  assert.equal(instruction.includes('为home商品策划15秒视频'), false)
  assert.equal(instruction.includes('已确认需求-home-0'), false)
  assert.ok(directorClarificationInstruction(null, 'missing', '继续').includes('继续'))
})

test('caps accumulated context while retaining the brief and the newest answers', () => {
  const runs = makeChain(20)
  runs[0].instruction = '原始需求：实木儿童床，保留护栏和梯位，不宣称绝对安全。'
  for (const [index, run] of runs.entries()) {
    run.clarificationAnswers[0].answer = `确认-${index}：${'具体需求'.repeat(240)}`
  }
  const instruction = directorClarificationInstruction(runs, 'home-19', '最新回答：仅修改床品配色')
  assert.ok(instruction.length <= 10000, `received ${instruction.length} characters`)
  assert.ok(instruction.includes(runs[0].instruction))
  assert.ok(instruction.includes('确认-19：'))
  assert.ok(instruction.includes('最新回答：仅修改床品配色'))
  assert.ok(instruction.includes('更早的补充因长度限制省略'))
})

test('bounds oversized root and current content and retains their endings', () => {
  const runs = makeChain(1)
  runs[0].instruction = `需求开头${'商品资料'.repeat(4000)}需求末尾不可改款`
  const current = `本轮开头${'当前补充'.repeat(4000)}本轮末尾无口播`
  const instruction = directorClarificationInstruction(runs, 'home-0', current)
  assert.ok(instruction.length <= 10000, `received ${instruction.length} characters`)
  assert.ok(instruction.includes('需求开头'))
  assert.ok(instruction.includes('需求末尾不可改款'))
  assert.ok(instruction.includes('本轮开头'))
  assert.ok(instruction.includes('本轮末尾无口播'))
})

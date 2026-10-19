import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)
const richTextUrl = new URL(
  '../src/features/canvas-v3/components/DirectorRichText.vue',
  import.meta.url,
)
const shellUrl = new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url)

test('Director conversation matches the observed LibTV message hierarchy and actions', async () => {
  const source = await readFile(panelUrl, 'utf8')

  assert.match(source, /class="cv3-director-user-message"/)
  assert.match(source, /class="cv3-director-thinking-trigger"/)
  assert.match(source, />思考过程</)
  assert.match(source, /:aria-expanded="thinkingOpen\.has\(item\.run\.id\)"/)
  assert.match(source, /class="cv3-director-thinking-detail"/)
  assert.match(source, /<p>\{\{ directorThinkingNarrative\(item\.run\) \}\}<\/p>/)
  assert.match(source, /async function toggleThinking\(runId\)/)
  assert.match(source, /thinkingOpen\.value = next\s+await nextTick\(\)\s+onMessagesScroll\(\)/)
  assert.match(source, /<DirectorRichText[\s\S]*?:text="item\.run\.reply"/)
  assert.match(source, /aria-label="点赞"/)
  assert.match(source, /aria-label="点踩"/)
  assert.match(source, /aria-label="回到底部"/)
  assert.match(source, /class="cv3-director-thinking-live"/)
  assert.match(source, />思考中\.\.\.<\/span>/)
  assert.match(source, /class="cv3-director-thinking-preview"/)
  assert.match(source, /aria-label="流式思考过程"/)
  assert.match(source, /class="cv3-director-thinking-tail"/)
  assert.match(
    source,
    /item\.run\.reply && \['planning', 'streaming'\]\.includes\(item\.run\.phase\)/,
  )
  assert.doesNotMatch(
    source,
    /directorThinkingPreviewTarget\(run\)[\s\S]*?run\?\.reply[\s\S]*?return ''/,
  )
  assert.match(source, /thinkingPreviewTimers/)
  assert.match(source, /aria-label="停止生成"/)
  assert.match(source, /emit\('cancel-agent', activeAgentRun\.value\.id\)/)
  assert.match(source, /copyMessage\(item\.run\.id, directorRunDisplayText\(item\.run\)\)/)

  const messagesRule = source.match(/\.cv3-director-messages\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(messagesRule, /overflow-y:\s*scroll/)
  assert.match(messagesRule, /scrollbar-gutter:\s*stable/)
  assert.match(source, /\.cv3-director-messages::-webkit-scrollbar-thumb/)
  assert.match(source, /vertical:decrement/)
  assert.match(source, /vertical:increment/)
  const scrollBottomRule =
    source.match(/\.cv3-director-scroll-bottom\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(scrollBottomRule, /left:\s*50%/)
  assert.match(scrollBottomRule, /bottom:\s*144px/)
  assert.match(scrollBottomRule, /width:\s*40px/)
  assert.match(scrollBottomRule, /height:\s*40px/)

  const assistantRule = source.match(/\.cv3-director-agent-run\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(assistantRule, /width:\s*100%/)
  assert.doesNotMatch(assistantRule, /background:|border:/)
  const userRule = source.match(/\.cv3-director-user-message\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(userRule, /padding:\s*12px 16px/)
  assert.match(userRule, /border-radius:\s*12px/)
  assert.match(userRule, /rgba\(255, 255, 255, 0\.05\)/)

  const thinkingDetailRule =
    source.match(/\.cv3-director-thinking-detail\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  assert.match(thinkingDetailRule, /color:\s*#919191/)
  assert.match(thinkingDetailRule, /font-size:\s*13px/)
  assert.match(thinkingDetailRule, /line-height:\s*24px/)
  assert.match(thinkingDetailRule, /font-weight:\s*400/)
  assert.match(thinkingDetailRule, /margin:\s*8px 0/)
  assert.doesNotMatch(thinkingDetailRule, /padding-left|border-left/)
  assert.match(source, /class="cv3-director-thinking-copy"/)
})

test('clarification lives in a paged bottom dock and leaves its record in the Agent message', async () => {
  const source = await readFile(panelUrl, 'utf8')
  assert.match(source, /directorConversationItems\(sentMessages\.value, props\.agentRuns\)/)
  assert.match(source, /mode="record"[\s\S]*?:answers="item\.run\.clarificationAnswers \|\| \[\]"/)
  assert.match(source, /v-if="pendingClarificationRun" class="cv3-director-question-dock"/)
  assert.match(
    source,
    /mode="form"[\s\S]*?@answer="submitClarification\(pendingClarificationRun, \$event\)"/,
  )
  assert.match(source, /v-else\s+class="cv3-director-composer"/)
  assert.match(source, /run\.clarificationReplyRunId/)
  assert.match(
    source,
    /isDirectorClarificationComplete\(run\.questions, run\.clarificationAnswers\)/,
  )
  assert.match(source, /<DirectorRichText[\s\S]*?:text="text"/)
  assert.match(source, /<DirectorRichText :text="item\.run\.draft\.prompt"/)
  assert.match(source, /本轮补充素材/)
  assert.match(
    source,
    /parts: readyAttachments\.value\.map\(serializeDirectorAttachment\)\.filter\(Boolean\)/,
  )
  assert.match(source, /有附件上传失败，请重新上传或移除后再提交/)
  assert.match(source, /aria-label="已补充的素材"/)
  const shell = await readFile(shellUrl, 'utf8')
  assert.match(
    shell,
    /directorClarificationInstruction\(directorAgentRuns\.value, sourceRunId, currentInstruction\)/,
  )
  assert.match(
    shell,
    /directorClarificationAssetsIntent\([\s\S]*?source\.generationIntent,[\s\S]*?createDirectorGenerationIntent\(message\)\.attachments/,
  )
})

test('Director rich text safely supports long-form Markdown without HTML injection', async () => {
  const source = await readFile(richTextUrl, 'utf8')

  assert.match(source, /function parseMarkdown\(/)
  assert.match(source, /type: 'heading'/)
  assert.match(source, /type: 'list'/)
  assert.match(source, /type: 'table'/)
  assert.match(source, /type: 'code'/)
  assert.match(source, /rel="noreferrer"/)
  assert.doesNotMatch(source, /v-html/)
  assert.doesNotMatch(source, /innerHTML/)
  assert.match(source, /'is-wide': block\.header\.length >= 4/)
  assert.match(source, /min-width:\s*780px/)
  assert.match(source, /overflow-x:\s*auto/)
})

test('Director header controls create, restore, delete, share and configure conversations', async () => {
  const source = await readFile(panelUrl, 'utf8')

  assert.match(source, /@click\.stop="startNewConversation"/)
  assert.match(source, /@click\.stop="toggleHistory"/)
  assert.match(source, /@click\.stop="shareConversation"/)
  assert.match(source, /@click\.stop="toggleSettings"/)
  assert.match(source, /@click\.stop="togglePlugin"/)
  assert.match(source, /v-for="conversation in conversations"/)
  assert.match(source, /@click="restoreConversation\(conversation\)"/)
  assert.match(source, /class="cv3-director-history-delete"/)
  assert.match(source, /:aria-label="`删除对话 \$\{conversation\.title \|\| '新对话'\}`"/)
  assert.match(source, /@click\.stop="deleteConversation\(conversation\)"/)
  assert.match(source, /emit\('new-conversation'\)/)
  assert.match(source, /emit\('load-conversations'\)/)
  assert.match(source, /emit\('select-conversation', conversation\)/)
  assert.match(source, /emit\('delete-conversation', conversation,/)
})

test('Canvas shell persists complete Director sessions and restores the selected run history', async () => {
  const source = await readFile(shellUrl, 'utf8')
  const directorTag = source.match(/<DirectorPanel\b[\s\S]*?\/>/)?.[0] || ''

  assert.match(source, /\/api\/ai\/canvas-agent\/conversations\/\$\{encodeURIComponent/)
  assert.match(source, /method:\s*'PUT'/)
  assert.match(source, /messages:\s*directorConversationMessages\(\)/)
  assert.match(source, /\/api\/ai\/canvas-agent\/conversations\?canvasId=/)
  assert.match(source, /function startDirectorConversation\(/)
  assert.match(source, /function selectDirectorConversation\(/)
  assert.match(source, /async function deleteDirectorConversation\(conversation, complete\)/)
  assert.match(source, /method:\s*'DELETE'/)
  assert.match(source, /directorConversations\.value = directorConversations\.value\.filter/)
  assert.match(source, /conversationId:\s*directorConversationId\.value/)
  assert.match(source, /agentModel:\s*'default'/)
  assert.match(source, /thinking:\s*\[/)
  assert.match(directorTag, /:conversations="directorConversations"/)
  assert.match(directorTag, /:conversation-id="directorConversationId"/)
  assert.match(directorTag, /:conversation-deleting-ids="directorConversationDeletingIds"/)
  assert.match(directorTag, /@new-conversation="startDirectorConversation"/)
  assert.match(directorTag, /@select-conversation="selectDirectorConversation"/)
  assert.match(directorTag, /@delete-conversation="deleteDirectorConversation"/)
  assert.match(directorTag, /@cancel-agent="cancelDirectorAgent"/)
  assert.match(source, /function cancelDirectorAgent\(runId\)/)
  assert.match(source, /event\.type === 'thinking_delta'/)
  assert.match(source, /thinkingText:\s*`\$\{run\.thinkingText \|\| ''\}\$\{delta\}`/)
  assert.match(source, /directorPlanningRequests\.get\(runId\)\?\.abort\(\)/)
  assert.match(source, /phase:\s*'cancelled'/)
})

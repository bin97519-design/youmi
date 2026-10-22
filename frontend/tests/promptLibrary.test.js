import assert from 'node:assert/strict'
import test from 'node:test'

import {
  derivePromptLibraryTitle,
  filterPromptLibraryItems,
  mergePromptIntoComposer,
  normalizePromptLibraryTags,
  PROMPT_LIBRARY_CATEGORIES,
} from '../src/utils/promptLibrary.js'

test('derives a compact title and normalizes tags', () => {
  assert.equal(derivePromptLibraryTitle('第一行提示词\n第二行'), '第一行提示词')
  assert.deepEqual(normalizePromptLibraryTags('主图, 电商 主图 #产品'), ['主图', '电商', '产品'])
})

test('replaces or appends a prompt without losing paragraph spacing', () => {
  assert.equal(mergePromptIntoComposer('原内容', '新提示词'), '新提示词')
  assert.equal(mergePromptIntoComposer('原内容', '新提示词', 'append'), '原内容\n\n新提示词')
})

test('filters personal, public and recent prompts independently', () => {
  const items = [
    { id: 1, scope: 'PERSONAL', title: '主图模板', category: 'MAIN_IMAGE', updatedAt: 2 },
    { id: 2, scope: 'PUBLIC', title: '场景模板', category: 'SCENE', updatedAt: 3 },
    { id: 3, scope: 'PERSONAL', title: '详情模板', category: 'DETAIL', lastUsedAt: 10 },
  ]
  assert.deepEqual(filterPromptLibraryItems(items, { view: 'mine' }).map((item) => item.id), [1, 3])
  assert.deepEqual(filterPromptLibraryItems(items, { view: 'public' }).map((item) => item.id), [2])
  assert.deepEqual(filterPromptLibraryItems(items, { view: 'recent' }).map((item) => item.id), [3])
  assert.deepEqual(
    filterPromptLibraryItems(items, { view: 'mine', query: '主图', category: 'MAIN_IMAGE' })
      .map((item) => item.id),
    [1],
  )
})

test('video prompts can be found in personal, public and recent libraries', () => {
  assert.ok(PROMPT_LIBRARY_CATEGORIES.some((category) => category.value === 'VIDEO'))
  const items = [
    { id: 1, scope: 'PERSONAL', category: 'VIDEO', content: '分镜一\n连续动作', lastUsedAt: 10 },
    { id: 2, scope: 'PUBLIC', category: 'VIDEO', title: '生活种草' },
    { id: 3, scope: 'PERSONAL', category: 'SCENE', title: '生活种草' },
  ]
  assert.deepEqual(filterPromptLibraryItems(items, { category: 'VIDEO' }).map((item) => item.id), [1])
  assert.deepEqual(filterPromptLibraryItems(items, { category: 'VIDEO', view: 'public', query: '种草' })
    .map((item) => item.id), [2])
  assert.deepEqual(filterPromptLibraryItems(items, { category: 'VIDEO', view: 'recent' })
    .map((item) => item.id), [1])
})

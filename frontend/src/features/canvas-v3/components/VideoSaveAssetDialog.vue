<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUserStore } from '../../../stores/user'
import { apiPath } from '../../../utils/apiBase'
import { createVideoSavedAssetClient, videoAssetSourceUrl } from '../sync/videoSavedAssetClient.js'
import {
  imageAssetFolderPath,
  imageAssetName,
  loadImageAssetCollections,
  saveImageAssetCollections,
} from '../config/imageAssetCollections.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  node: { type: Object, default: null },
  video: { type: String, default: '' },
  poster: { type: String, default: '' },
  name: { type: String, default: '' },
})
const emit = defineEmits(['close', 'saved'])
const user = useUserStore()
const client = createVideoSavedAssetClient({
  path: apiPath,
  headers: () => user.authHeaders(),
})
const dialog = ref(null)
const nameInput = ref(null)
const assetName = ref('')
const videoUrl = ref('')
const posterUrl = ref('')
const fileName = ref('')
const folderId = ref('')
const tags = ref([])
const collections = ref({ folders: [], tags: [] })
const expanded = ref(new Set())
const menu = ref('')
const adding = ref('')
const parentFolderId = ref('')
const newName = ref('')
const saving = ref(false)
const error = ref('')
const collectionNotice = ref('')
const accountId = computed(() => String(user.profile?.id || user.profile?.userId || ''))
const selectedFolder = computed(() =>
  imageAssetFolderPath(collections.value.folders, folderId.value).join(' / '),
)
const canSave = computed(
  () =>
    !saving.value &&
    !!videoUrl.value &&
    !!assetName.value.trim() &&
    !!selectedFolder.value &&
    assetName.value.trim().length <= 50,
)
const visibleFolders = computed(() => {
  const rows = []
  const walk = (parentId, depth) => {
    for (const folder of collections.value.folders.filter((item) => item.parentId === parentId)) {
      const children = collections.value.folders.some((item) => item.parentId === folder.id)
      rows.push({ ...folder, depth, children })
      if (expanded.value.has(folder.id)) walk(folder.id, depth + 1)
    }
  }
  walk('', 0)
  return rows
})
let controller
let session = 0
let openedAccount = ''
let previousFocus
let sourceNode = null

function storage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}
function restoreFocus() {
  if (previousFocus?.isConnected !== false) previousFocus?.focus?.({ preventScroll: true })
  previousFocus = null
}
function invalidate() {
  session += 1
  controller?.abort()
  controller = null
  saving.value = false
}
async function initialize() {
  invalidate()
  openedAccount = accountId.value
  const data = props.node?.data || {}
  sourceNode = {
    id: props.node?.id,
    width: data.mediaWidth || data.width,
    height: data.mediaHeight || data.height,
    duration: data.mediaDuration || data.duration,
  }
  fileName.value = props.name || data.title || data.fileName || '未命名视频'
  assetName.value = imageAssetName(
    props.name || fileName.value.replace(/\.(?:mp4|webm|mov|m4v|avi|mkv|ogg)$/i, ''),
  )
  videoUrl.value = videoAssetSourceUrl(props.video || data.assetUrl || data.videoUrl || '')
  posterUrl.value = videoAssetSourceUrl(props.poster || data.posterUrl || data.thumbnail || '')
  folderId.value = ''
  tags.value = []
  collections.value = loadImageAssetCollections(storage(), openedAccount)
  expanded.value = new Set()
  menu.value = ''
  adding.value = ''
  newName.value = ''
  error.value = videoUrl.value ? '' : '视频地址无效，无法保存资产'
  collectionNotice.value = ''
  await nextTick()
  if (props.open) nameInput.value?.focus?.({ preventScroll: true })
}
function close() {
  if (saving.value) return
  menu.value = ''
  adding.value = ''
  emit('close')
}
function toggleMenu(value) {
  if (saving.value) return
  menu.value = menu.value === value ? '' : value
  adding.value = ''
}
function selectFolder(id) {
  if (saving.value || !collections.value.folders.some((item) => item.id === id)) return
  folderId.value = id
  menu.value = ''
  adding.value = ''
}
function toggleFolder(id) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
function toggleTag(tag) {
  if (saving.value || !collections.value.tags.includes(tag)) return
  tags.value = tags.value.includes(tag)
    ? tags.value.filter((item) => item !== tag)
    : [...tags.value, tag]
}
async function startAdd(kind, parentId = '') {
  if (saving.value) return
  adding.value = kind
  parentFolderId.value = parentId
  newName.value = ''
  collectionNotice.value = '目录和标签保存在本机当前账号，资产本身会保存到云端。'
  await nextTick()
  dialog.value?.querySelector?.('[data-save-asset-new-name]')?.focus?.()
}
function commitAdd() {
  const value = newName.value.trim()
  if (saving.value || !value) return
  if (!user.requireLogin()) return
  if (openedAccount !== accountId.value || !accountId.value) {
    error.value = '登录账号已变化，请重新打开保存窗口'
    return
  }
  if (
    [...value].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  ) {
    error.value = '名称包含无效字符'
    return
  }
  const updated = { folders: [...collections.value.folders], tags: [...collections.value.tags] }
  let newFolderId = ''
  if (adding.value === 'folder') {
    const duplicate = updated.folders.find(
      (folder) => folder.parentId === parentFolderId.value && folder.name === value,
    )
    if (duplicate) newFolderId = duplicate.id
    else {
      if (updated.folders.length >= 200) {
        error.value = '目录数量已达上限'
        return
      }
      newFolderId = `folder-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
      updated.folders.push({
        id: newFolderId,
        name: value.slice(0, 40),
        parentId: parentFolderId.value,
      })
    }
  } else if (!updated.tags.includes(value)) {
    if (updated.tags.length >= 100) {
      error.value = '标签数量已达上限'
      return
    }
    updated.tags.push(value.slice(0, 30))
  }
  try {
    collections.value = saveImageAssetCollections(storage(), openedAccount, updated)
    if (newFolderId) {
      folderId.value = newFolderId
      expanded.value = new Set([...expanded.value, parentFolderId.value])
    } else if (!tags.value.includes(value)) tags.value = [...tags.value, value.slice(0, 30)]
    adding.value = ''
    newName.value = ''
    error.value = ''
  } catch (cause) {
    error.value = cause.message
  }
}
async function save() {
  if (!canSave.value) return
  if (!user.requireLogin()) return
  if (openedAccount !== accountId.value || !accountId.value) {
    error.value = '登录账号已变化，请重新打开保存窗口'
    return
  }
  const current = ++session
  const request = new AbortController()
  controller = request
  saving.value = true
  error.value = ''
  menu.value = ''
  try {
    const saved = await client.save(
      {
        name: assetName.value.trim(),
        videoUrl: videoUrl.value,
        posterUrl: posterUrl.value,
        folderId: folderId.value,
        folderPath: imageAssetFolderPath(collections.value.folders, folderId.value),
        tags: [...tags.value],
        sourceNodeId: sourceNode?.id,
        width: sourceNode?.width,
        height: sourceNode?.height,
        duration: sourceNode?.duration,
      },
      { signal: request.signal },
    )
    if (
      !props.open ||
      current !== session ||
      request.signal.aborted ||
      openedAccount !== accountId.value
    )
      return
    emit('saved', saved)
    emit('close')
  } catch (cause) {
    if (current === session && props.open && !request.signal.aborted)
      error.value = cause.message?.replace(/模特/g, '资产') || '保存失败，请稍后重试'
  } finally {
    if (current === session) {
      saving.value = false
      controller = null
    }
  }
}
function keydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (adding.value) adding.value = ''
    else if (menu.value) menu.value = ''
    else close()
  } else if (event.key === 'Tab') {
    const controls = [
      ...(dialog.value?.querySelectorAll?.(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
      ) || []),
    ]
    if (!controls.length) return
    const active = globalThis.document?.activeElement
    if (event.shiftKey && (active === controls[0] || !controls.includes(active))) {
      event.preventDefault()
      controls.at(-1)?.focus?.()
    } else if (!event.shiftKey && (active === controls.at(-1) || !controls.includes(active))) {
      event.preventDefault()
      controls[0]?.focus?.()
    }
  }
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      previousFocus = globalThis.document?.activeElement
      initialize()
    } else {
      invalidate()
      restoreFocus()
    }
  },
  { immediate: true },
)
watch(accountId, () => {
  if (props.open) initialize()
})
watch(
  () => [props.node?.id, props.video, props.poster, props.name],
  () => {
    if (props.open) initialize()
  },
)
onBeforeUnmount(() => {
  invalidate()
  restoreFocus()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="cv3-save-asset-backdrop"
      data-video-context-dialog
      data-canvas-shortcuts-ignore
      @pointerdown.self="close"
      @contextmenu.prevent
      @keydown="keydown"
    >
      <section
        ref="dialog"
        class="cv3-save-asset-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="保存资产"
        :aria-busy="saving"
        @pointerdown="menu = ''"
      >
        <header class="cv3-save-asset-header">
          <h2>保存资产</h2>
          <button type="button" aria-label="关闭保存资产" :disabled="saving" @click="close">
            ×
          </button>
        </header>
        <form class="cv3-save-asset-body" @submit.prevent="save">
          <div class="cv3-save-asset-preview">
            <img
              v-if="posterUrl"
              :src="posterUrl"
              alt="待保存视频封面"
              referrerpolicy="no-referrer"
            />
            <video
              v-else-if="videoUrl"
              :src="videoUrl"
              aria-label="待保存视频"
              preload="metadata"
              muted
              playsinline
            />
            <div v-else class="cv3-save-asset-no-preview">视频无法预览</div>
            <p :title="fileName">{{ fileName }}</p>
          </div>
          <div class="cv3-save-asset-fields">
            <label class="cv3-save-asset-label" for="cv3-save-video-asset-name">
              资产名称
              <span>*</span>
            </label>
            <div class="cv3-save-asset-name-wrap">
              <input
                id="cv3-save-video-asset-name"
                ref="nameInput"
                v-model="assetName"
                aria-label="资产名称"
                maxlength="50"
                autocomplete="off"
                :disabled="saving"
              />
              <span>{{ assetName.length }}/50</span>
            </div>
            <label class="cv3-save-asset-label">
              保存位置
              <span>*</span>
            </label>
            <div class="cv3-save-asset-select-wrap" @pointerdown.stop>
              <button
                type="button"
                class="cv3-save-asset-select"
                aria-label="选择保存位置"
                aria-haspopup="tree"
                :aria-expanded="menu === 'folder'"
                :disabled="saving"
                @click="toggleMenu('folder')"
              >
                <span :class="{ 'cv3-save-asset-placeholder': !selectedFolder }">
                  {{ selectedFolder || '请选择保存位置' }}
                </span>
                <span class="cv3-save-asset-chevron">⌄</span>
              </button>
              <div v-if="menu === 'folder'" class="cv3-save-asset-dropdown">
                <div class="cv3-save-asset-menu-header">
                  <span>个人资产库</span>
                  <button type="button" aria-label="新建根目录" @click="startAdd('folder')">
                    ＋
                  </button>
                </div>
                <div class="cv3-save-asset-tree" role="tree" aria-label="资产目录">
                  <div
                    v-for="folder in visibleFolders"
                    :key="folder.id"
                    class="cv3-save-asset-folder"
                    :class="{ 'is-selected': folderId === folder.id }"
                    :style="{ paddingLeft: `${10 + folder.depth * 16}px` }"
                  >
                    <button
                      v-if="folder.children"
                      type="button"
                      class="cv3-save-asset-folder-arrow"
                      :aria-label="`${expanded.has(folder.id) ? '收起' : '展开'}${folder.name}`"
                      @click="toggleFolder(folder.id)"
                    >
                      {{ expanded.has(folder.id) ? '⌄' : '›' }}
                    </button>
                    <span v-else class="cv3-save-asset-folder-arrow" aria-hidden="true"></span>
                    <button
                      type="button"
                      class="cv3-save-asset-folder-name"
                      role="treeitem"
                      :aria-selected="folderId === folder.id"
                      :aria-label="`选择目录${folder.name}`"
                      @click="selectFolder(folder.id)"
                    >
                      <span class="cv3-save-asset-folder-icon" aria-hidden="true">▱</span>
                      {{ folder.name }}
                    </button>
                    <button
                      type="button"
                      class="cv3-save-asset-folder-add"
                      :aria-label="`在${folder.name}中新建目录`"
                      @click="startAdd('folder', folder.id)"
                    >
                      ＋
                    </button>
                    <span v-if="folderId === folder.id" aria-hidden="true">✓</span>
                  </div>
                </div>
                <div v-if="adding === 'folder'" class="cv3-save-asset-create">
                  <input
                    v-model="newName"
                    data-save-asset-new-name
                    aria-label="新目录名称"
                    maxlength="40"
                    placeholder="新建文件夹"
                    @keydown.enter.prevent="commitAdd"
                  />
                  <button type="button" :disabled="!newName.trim()" @click="commitAdd">确定</button>
                  <button type="button" aria-label="取消新建目录" @click="adding = ''">×</button>
                </div>
              </div>
            </div>
            <label class="cv3-save-asset-label">设置标签</label>
            <div class="cv3-save-asset-select-wrap" @pointerdown.stop>
              <button
                type="button"
                class="cv3-save-asset-select"
                aria-label="设置标签"
                aria-haspopup="listbox"
                :aria-expanded="menu === 'tag'"
                :disabled="saving"
                @click="toggleMenu('tag')"
              >
                <span :class="{ 'cv3-save-asset-placeholder': !tags.length }">
                  {{ tags.join('、') || '请选择标签' }}
                </span>
                <span class="cv3-save-asset-chevron">⌄</span>
              </button>
              <div
                v-if="menu === 'tag'"
                class="cv3-save-asset-dropdown cv3-save-asset-tag-dropdown"
              >
                <div class="cv3-save-asset-menu-header">
                  <span>标签</span>
                  <button type="button" aria-label="新建标签" @click="startAdd('tag')">＋</button>
                </div>
                <div
                  role="listbox"
                  aria-label="资产标签"
                  aria-multiselectable="true"
                  class="cv3-save-asset-tags"
                >
                  <button
                    v-for="tag in collections.tags"
                    :key="tag"
                    type="button"
                    role="option"
                    :aria-selected="tags.includes(tag)"
                    :aria-label="`标签${tag}`"
                    class="cv3-save-asset-tag"
                    @click="toggleTag(tag)"
                  >
                    <span>{{ tag }}</span>
                    <span v-if="tags.includes(tag)">✓</span>
                  </button>
                </div>
                <div v-if="adding === 'tag'" class="cv3-save-asset-create">
                  <input
                    v-model="newName"
                    data-save-asset-new-name
                    aria-label="新标签名称"
                    maxlength="30"
                    placeholder="输入标签名称"
                    @keydown.enter.prevent="commitAdd"
                  />
                  <button type="button" :disabled="!newName.trim()" @click="commitAdd">确定</button>
                  <button type="button" aria-label="取消新建标签" @click="adding = ''">×</button>
                </div>
              </div>
            </div>
            <p v-if="collectionNotice && menu" class="cv3-save-asset-local-note">
              {{ collectionNotice }}
            </p>
            <p v-if="error" class="cv3-save-asset-error" role="alert">{{ error }}</p>
            <footer class="cv3-save-asset-actions">
              <button type="button" :disabled="saving" @click="close">取消</button>
              <button type="submit" class="cv3-save-asset-submit" :disabled="!canSave">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </footer>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.cv3-save-asset-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #0008;
  backdrop-filter: blur(5px);
}
.cv3-save-asset-dialog {
  width: 720px;
  max-width: 100%;
  max-height: calc(100dvh - 32px);
  overflow: visible;
  color: #eee;
  background: #262626;
  border: 1px solid #363636;
  border-radius: 16px;
  box-shadow: 0 16px 56px #0005;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
.cv3-save-asset-dialog * {
  box-sizing: border-box;
}
.cv3-save-asset-dialog button,
.cv3-save-asset-dialog input {
  color: inherit;
  font: inherit;
}
.cv3-save-asset-dialog button {
  cursor: pointer;
  border: 0;
}
.cv3-save-asset-dialog button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.cv3-save-asset-dialog button:focus-visible,
.cv3-save-asset-dialog input:focus-visible {
  outline: 1px solid #aaa;
  outline-offset: 2px;
}
.cv3-save-asset-header {
  height: 49px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid #363636;
}
.cv3-save-asset-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.cv3-save-asset-header button {
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  color: #999;
  font-size: 22px;
  line-height: 20px;
}
.cv3-save-asset-body {
  display: flex;
  gap: 24px;
  padding: 24px;
  margin: 0;
}
.cv3-save-asset-preview {
  width: 200px;
  flex: 0 0 200px;
  min-width: 0;
}
.cv3-save-asset-preview img,
.cv3-save-asset-preview video,
.cv3-save-asset-no-preview {
  display: block;
  width: 200px;
  height: 200px;
  object-fit: cover;
  border-radius: 8px;
  background: #202020;
}
.cv3-save-asset-no-preview {
  display: grid;
  place-items: center;
  color: #888;
}
.cv3-save-asset-preview p {
  margin: 8px 0 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  color: #aaa;
}
.cv3-save-asset-fields {
  flex: 1;
  min-width: 0;
}
.cv3-save-asset-label {
  display: block;
  margin: 0 0 8px;
  font-size: 13px;
  color: #aaa;
}
.cv3-save-asset-label span {
  color: #ee6868;
}
.cv3-save-asset-name-wrap {
  height: 32px;
  display: flex;
  gap: 8px;
  align-items: center;
  background: #333;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 0 8px;
  margin: 0 0 10px;
}
.cv3-save-asset-name-wrap:focus-within {
  border-color: #888;
}
.cv3-save-asset-name-wrap input {
  width: 0;
  min-width: 0;
  flex: 1;
  height: 28px;
  border: 0;
  background: none;
  outline: 0;
}
.cv3-save-asset-name-wrap input:focus-visible {
  outline: none;
}
.cv3-save-asset-name-wrap > span {
  flex-shrink: 0;
  color: #888;
  font-size: 12px;
}
.cv3-save-asset-select-wrap {
  position: relative;
  margin-bottom: 10px;
}
.cv3-save-asset-select {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: #333;
  border: 1px solid #444 !important;
  border-radius: 8px;
  text-align: left;
}
.cv3-save-asset-select > span:first-child {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv3-save-asset-placeholder {
  color: #777;
}
.cv3-save-asset-chevron {
  font-size: 16px;
  color: #999;
}
.cv3-save-asset-dropdown {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 2;
  padding: 4px;
  border: 1px solid #333;
  border-radius: 12px;
  background: #1f1f1f;
  box-shadow: 0 8px 24px #0006;
}
.cv3-save-asset-menu-header {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  color: #aaa;
}
.cv3-save-asset-menu-header button {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  background: none;
  color: #aaa;
  font-size: 18px;
}
.cv3-save-asset-menu-header button:hover {
  background: #444;
}
.cv3-save-asset-tree,
.cv3-save-asset-tags {
  max-height: 220px;
  overflow: auto;
}
.cv3-save-asset-folder {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 32px;
  padding-right: 8px;
  border-radius: 4px;
}
.cv3-save-asset-folder:hover,
.cv3-save-asset-folder.is-selected {
  background: #414141;
}
.cv3-save-asset-folder-arrow {
  flex: 0 0 14px;
  width: 14px;
  padding: 0;
  background: none;
  color: #aaa;
}
.cv3-save-asset-folder-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0;
  text-align: left;
  background: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cv3-save-asset-folder-icon {
  font-size: 21px;
  color: #aaa;
}
.cv3-save-asset-folder-add {
  width: 20px;
  height: 24px;
  background: none;
  color: #aaa;
  opacity: 0;
}
.cv3-save-asset-folder:hover .cv3-save-asset-folder-add,
.cv3-save-asset-folder:focus-within .cv3-save-asset-folder-add {
  opacity: 1;
}
.cv3-save-asset-tag {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  width: 100%;
  padding: 0 8px;
  border-radius: 4px;
  text-align: left;
  background: none;
}
.cv3-save-asset-tag:hover,
.cv3-save-asset-tag[aria-selected='true'] {
  background: #414141;
}
.cv3-save-asset-create {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 4px 2px;
}
.cv3-save-asset-create input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  background: #333;
  border: 1px solid #555;
  border-radius: 4px;
}
.cv3-save-asset-create button {
  background: none;
  padding: 4px;
}
.cv3-save-asset-local-note {
  margin: -8px 0 8px;
  color: #888;
  font-size: 11px;
}
.cv3-save-asset-error {
  margin: -4px 0 8px;
  color: #ef9696;
  font-size: 12px;
}
.cv3-save-asset-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
.cv3-save-asset-actions button {
  min-width: 64px;
  height: 32px;
  padding: 0 16px;
  background: #393939;
  border-radius: 6px;
}
.cv3-save-asset-actions .cv3-save-asset-submit {
  background: #f3f3f3;
  color: #222;
}
@media (max-width: 560px) {
  .cv3-save-asset-dialog {
    overflow: auto;
  }
  .cv3-save-asset-body {
    flex-direction: column;
  }
  .cv3-save-asset-preview {
    align-self: center;
    flex-basis: auto;
  }
  .cv3-save-asset-dropdown {
    position: relative;
    top: auto;
    margin-top: 4px;
  }
}
</style>

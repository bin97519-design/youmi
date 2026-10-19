import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  DIRECTOR_ATTACHMENT_ACCEPT,
  DIRECTOR_ATTACHMENT_LIMIT,
  DIRECTOR_ATTACHMENT_LIMITS,
  directorAttachmentKind,
  normalizeDirectorAsset,
  serializeDirectorAttachment,
} from '../src/features/canvas-v3/config/directorAttachments.js'

const pickerUrl = new URL(
  '../src/features/canvas-v3/components/DirectorAttachmentPicker.vue',
  import.meta.url,
)
const panelUrl = new URL('../src/features/canvas-v3/components/DirectorPanel.vue', import.meta.url)
const shellUrl = new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url)

test('Director attachment policy recognizes supported media and preserves safe limits', () => {
  assert.equal(DIRECTOR_ATTACHMENT_LIMIT, 10)
  assert.match(DIRECTOR_ATTACHMENT_ACCEPT, /image\/\*/)
  assert.match(DIRECTOR_ATTACHMENT_ACCEPT, /video\/\*/)
  assert.match(DIRECTOR_ATTACHMENT_ACCEPT, /audio\/\*/)
  assert.match(DIRECTOR_ATTACHMENT_ACCEPT, /\.pdf/)
  assert.equal(directorAttachmentKind({ type: 'image/webp' }), 'image')
  assert.equal(directorAttachmentKind({ mimeType: 'video/mp4' }), 'video')
  assert.equal(directorAttachmentKind({ kind: 'audio' }), 'audio')
  assert.equal(directorAttachmentKind({ type: 'application/pdf' }), 'file')
  assert.ok(DIRECTOR_ATTACHMENT_LIMITS.video > DIRECTOR_ATTACHMENT_LIMITS.image)
})

test('Director material assets normalize and serialize into structured Agent parts', () => {
  const asset = normalizeDirectorAsset({
    id: 'image-1',
    title: '客厅沙发',
    kind: 'image',
    assetUrl: 'https://example.com/sofa.png',
  })
  assert.deepEqual(asset, {
    id: 'image-1',
    layerId: 'image-1',
    name: '客厅沙发',
    kind: 'image',
    mimeType: '',
    size: 0,
    url: 'https://example.com/sofa.png',
    previewUrl: 'https://example.com/sofa.png',
    source: 'library',
    status: 'ready',
    progress: 100,
  })
  assert.deepEqual(serializeDirectorAttachment(asset), {
    type: 'attachment',
    id: 'image-1',
    layerId: 'image-1',
    name: '客厅沙发',
    kind: 'image',
    mimeType: '',
    size: 0,
    url: 'https://example.com/sofa.png',
    source: 'library',
  })
  assert.equal(serializeDirectorAttachment({ ...asset, status: 'uploading' }), null)
})

test('attachment trigger reproduces both observed entries and a complete library picker', async () => {
  const source = await readFile(pickerUrl, 'utf8')
  assert.match(source, /aria-label="添加附件"/)
  assert.match(source, /<span>本地上传<\/span>/)
  assert.match(source, /<span>素材库添加<\/span>/)
  assert.match(
    source,
    /type="file"[\s\S]{0,120}multiple[\s\S]{0,120}:accept="DIRECTOR_ATTACHMENT_ACCEPT"/,
  )
  assert.match(source, /aria-labelledby="cv3-director-asset-dialog-title"/)
  assert.match(source, /<h2 id="cv3-director-asset-dialog-title">资产管理<\/h2>/)
  assert.match(source, /个人资产库/)
  assert.match(source, /待分类资产/)
  assert.match(source, /placeholder="搜索"/)
  assert.match(
    source,
    /all: '全部素材',[\s\S]*?image: '图片',[\s\S]*?video: '视频',[\s\S]*?audio: '音频'/,
  )
  assert.match(source, /aria-label="筛选"/)
  assert.match(source, />新建</)
  assert.match(source, /上传资产/)
  assert.match(source, /新建文件夹/)
  assert.match(source, /role="listbox"/)
  assert.match(source, /role="option"/)
  assert.match(source, /@click="confirmAssets"/)
  assert.match(source, /function handleDialogKeydown/)
  assert.match(source, /event\.key !== 'Escape'/)
})

test('Director composer uploads, retries, removes, renders and submits attachment context', async () => {
  const [panel, shell] = await Promise.all([readFile(panelUrl, 'utf8'), readFile(shellUrl, 'utf8')])
  assert.match(
    panel,
    /import DirectorAttachmentPicker from ['"]\.\/DirectorAttachmentPicker\.vue['"]/,
  )
  assert.match(panel, /uploadFileDirect\(attachment\.file/)
  assert.match(panel, /dir: 'youmi-canvas\/director-attachments'/)
  assert.match(panel, /function retryAttachment\(/)
  assert.match(panel, /function removeAttachment\(/)
  assert.match(panel, /class="cv3-director-attachment-chips"/)
  assert.match(panel, /class="cv3-director-attachment-preview"/)
  assert.match(panel, /role="dialog"[\s\S]*?:aria-label="`\$\{attachment\.name\} 预览`"/)
  assert.match(panel, /@dragstart="beginAttachmentDrag\(\$event, index\)"/)
  assert.match(panel, /@drop="dropAttachment\(\$event, index\)"/)
  assert.match(panel, /@keydown\.delete\.prevent="removeAttachment\(attachment\.id\)"/)
  assert.match(
    panel,
    /\.cv3-director-attachment-chip \{[\s\S]*?max-width: 135px;[\s\S]*?height: 24px;/,
  )
  assert.match(panel, /\.cv3-director-attachment-thumb \{[\s\S]*?width: 16px;[\s\S]*?height: 16px;/)
  assert.match(panel, /\.cv3-director-attachment-chips \{[\s\S]*?flex-wrap: wrap;/)
  assert.match(panel, /\.cv3-director-attachment-chip:hover \.cv3-director-attachment-preview/)
  assert.match(panel, /function positionAttachmentPreview\(event\)/)
  assert.match(panel, /const previewWidth = 290/)
  assert.match(panel, /@mouseenter="positionAttachmentPreview"/)
  assert.match(
    panel,
    /\.cv3-director-attachment-preview \{[\s\S]*?bottom: calc\(100% \+ 5px\);[\s\S]*?left: 50%;[\s\S]*?width: 290px;/,
  )
  assert.match(panel, /\.cv3-director-attachment-preview-media \{[\s\S]*?aspect-ratio: 1;/)
  assert.match(panel, /object-fit: cover;/)
  assert.doesNotMatch(panel, /cv3-director-attachment-preview-footer/)
  assert.match(
    panel,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cv3-director-attachment-preview/,
  )
  assert.match(panel, /\.\.\.serializedAttachments/)
  assert.match(panel, /attachmentUploadActive/)
  assert.match(panel, /@local-files="handleAttachmentFiles"/)
  assert.match(panel, /@select-assets="handleLibraryAssets"/)

  assert.match(shell, /:available-assets="directorAvailableAssets"/)
  assert.match(shell, /part\?\.type === 'attachment'/)
  assert.match(shell, /layers: directorRequestLayers\(intent\)/)
  assert.match(shell, /本轮附加了 \$\{attachments\.length\} 个素材/)
  assert.match(shell, /\['upload', 'library'\]\.includes\(reference\.source\)/)
})

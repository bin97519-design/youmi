<script setup>
import { computed, ref } from 'vue'
import { directorAttachmentKind } from '../config/directorAttachments.js'
import { DIRECTOR_REFERENCE_IMAGE_LIMIT } from '../config/directorClarifications.js'
import DirectorAttachmentPicker from './DirectorAttachmentPicker.vue'
import CanvasIcon from './CanvasIcon.vue'

const props = defineProps({
  images: { type: Array, default: () => [] },
  availableAssets: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  open: { type: Boolean, default: false },
})
const emit = defineEmits([
  'local-files',
  'select-assets',
  'remove',
  'retry',
  'update-role',
  'update:open',
])
const input = ref(null)
const availableImages = computed(() =>
  props.availableAssets.filter((asset) => directorAttachmentKind(asset) === 'image'),
)
const selectedIds = computed(() => props.images.map((image) => String(image.layerId || image.id)))

function pickFiles(event) {
  const files = [...(event.target.files || [])]
  event.target.value = ''
  if (!props.disabled && files.length) emit('local-files', files)
}
</script>

<template>
  <section class="cv3-director-reference-upload" aria-label="参考图片上传">
    <input
      ref="input"
      type="file"
      accept="image/*"
      multiple
      hidden
      :disabled="disabled"
      @change="pickFiles"
    />
    <button
      type="button"
      class="cv3-director-reference-upload-button"
      :disabled="disabled"
      @click="input?.click()"
    >
      <CanvasIcon name="upload" :size="22" />
      <span>上传参考图片</span>
      <small>最多 {{ DIRECTOR_REFERENCE_IMAGE_LIMIT }} 张图片，单张不超过 20 MB</small>
    </button>
    <div v-if="!disabled" class="cv3-director-reference-library">
      <DirectorAttachmentPicker
        :open="open"
        :available-assets="availableImages"
        :attached-ids="selectedIds"
        @update:open="emit('update:open', $event)"
        @local-files="!disabled && emit('local-files', $event)"
        @select-assets="!disabled && emit('select-assets', $event)"
      />
      <span>也可以从画布或素材库选择已有图片</span>
    </div>
    <ul v-if="images.length" class="cv3-director-reference-images" aria-label="已选择的参考图片">
      <li v-for="image in images" :key="image.layerId || image.id || image.url">
        <div class="cv3-director-reference-thumbnail">
          <img
            v-if="image.previewUrl || image.url"
            :src="image.previewUrl || image.url"
            :alt="image.name || '参考图片'"
          />
          <span v-if="image.status === 'uploading'" role="status">
            上传中 {{ Math.round(image.progress || 0) }}%
          </span>
          <span
            v-else-if="['error', 'failed'].includes(image.status)"
            class="is-error"
            role="alert"
          >
            上传失败
          </span>
          <span v-else class="is-ready">已就绪</span>
        </div>
        <div class="cv3-director-reference-image-info">
          <span :title="image.name">{{ image.name || '参考图片' }}</span>
          <select
            :aria-label="`${image.name || '参考图片'}的参考用途`"
            :value="image.referenceRole || ''"
            :disabled="disabled"
            @change="emit('update-role', image, $event.target.value)"
          >
            <option value="">参考用途未指定</option>
            <option value="product">商品原图 · 保持商品外观</option>
            <option value="style">风格参考 · 参考构图与光线</option>
            <option value="other">其他参考</option>
          </select>
          <small v-if="image.error" class="cv3-director-reference-error">{{ image.error }}</small>
          <button
            v-if="['error', 'failed'].includes(image.status) && image.retryable !== false"
            type="button"
            :disabled="disabled"
            @click="emit('retry', image)"
          >
            重新上传
          </button>
        </div>
        <button
          type="button"
          class="cv3-director-reference-remove"
          :aria-label="`移除参考图片 ${image.name || '参考图片'}`"
          :disabled="disabled"
          @click="emit('remove', image)"
        >
          ×
        </button>
      </li>
    </ul>
    <p>商品原图用于还原商品外观；风格参考仅借鉴构图、背景与光线，不作为商品事实。</p>
  </section>
</template>

<style scoped>
.cv3-director-reference-upload {
  display: grid;
  min-width: 0;
  gap: 10px;
  padding-top: 12px;
}
.cv3-director-reference-upload-button {
  display: flex;
  min-height: 100px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
  border: 1px dashed #626262;
  border-radius: 12px;
  background: #1c1c1c;
  color: #ededed;
  cursor: pointer;
  font: inherit;
}
.cv3-director-reference-upload-button small,
.cv3-director-reference-library,
.cv3-director-reference-upload > p {
  color: #999;
  font-size: 12px;
  font-weight: 400;
  line-height: 19px;
}
.cv3-director-reference-upload-button:hover {
  border-color: #aaa;
  background: #252525;
}
.cv3-director-reference-upload-button:active {
  background: #303030;
}
.cv3-director-reference-upload :where(button, select):focus-visible {
  outline: 1px solid #bdbdbd;
  outline-offset: 2px;
}
.cv3-director-reference-upload :where(button, select):disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.cv3-director-reference-library {
  display: flex;
  align-items: center;
  gap: 5px;
}
.cv3-director-reference-images {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cv3-director-reference-images > li {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
  padding: 7px;
  border: 1px solid #3d3d3d;
  border-radius: 10px;
  background: #202020;
}
.cv3-director-reference-thumbnail {
  position: relative;
  width: 68px;
  height: 68px;
  flex: 0 0 68px;
  overflow: hidden;
  border-radius: 7px;
  background: #303030;
}
.cv3-director-reference-thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv3-director-reference-thumbnail > span {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 2px;
  background: #141414d9;
  color: #ddd;
  font-size: 10px;
  text-align: center;
}
.cv3-director-reference-thumbnail > .is-error,
.cv3-director-reference-error {
  color: #e4ac75;
}
.cv3-director-reference-image-info {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 5px;
}
.cv3-director-reference-image-info > span {
  overflow: hidden;
  color: #ddd;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cv3-director-reference-image-info select {
  min-width: 0;
  width: 100%;
  padding: 4px;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #282828;
  color: #ccc;
  font-size: 11px;
}
.cv3-director-reference-image-info button {
  width: max-content;
  padding: 2px 6px;
  border: 1px solid #555;
  border-radius: 5px;
  background: #303030;
  color: #eee;
  cursor: pointer;
  font-size: 11px;
}
.cv3-director-reference-remove {
  flex: 0 0 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font-size: 19px;
}
.cv3-director-reference-upload > p {
  margin: 0;
}
</style>

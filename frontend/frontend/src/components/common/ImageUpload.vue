<template>
  <div class="image-upload" :class="{ 'image-upload--button': variant === 'button' }">
    <label v-if="variant === 'button'" class="image-upload__button">
      <input
        ref="inputRef"
        class="image-upload__input"
        type="file"
        :accept="accept"
        :multiple="multiple"
        :disabled="disabled || uploading"
        @change="handleFileChange"
      />
      <span v-if="uploading">{{ progressText || '上传中' }}</span>
      <span v-else>{{ buttonText }}</span>
    </label>

    <label
      v-else
      class="image-upload__box"
      :class="{
        'image-upload__box--disabled': disabled,
        'image-upload__box--dragging': dragging,
        'image-upload__box--has-image': currentUrl,
      }"
      :style="{ height: normalizedHeight }"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragEnter"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <input
        ref="inputRef"
        class="image-upload__input"
        type="file"
        :accept="accept"
        :multiple="multiple"
        :disabled="disabled || uploading"
        @change="handleFileChange"
      />
      <img v-if="currentUrl" class="image-upload__preview" :src="currentUrl" alt="" />
      <span v-if="currentUrl && clearable" class="image-upload__clear" role="button" @click.prevent="clearImage">x</span>
      <span v-if="uploading" class="image-upload__mask">
        <strong>{{ progress }}%</strong>
        <small>{{ progressText }}</small>
      </span>
      <span v-else-if="!currentUrl" class="image-upload__empty">
        <strong>+</strong>
        <small>{{ placeholder }}</small>
      </span>
    </label>

    <div v-if="showUrlInput" class="image-upload__url-row">
      <input
        v-model="manualUrl"
        class="image-upload__url-input"
        :disabled="disabled"
        :placeholder="urlPlaceholder"
        @change="commitManualUrl"
      />
      <button class="image-upload__url-button" type="button" :disabled="disabled" @click="commitManualUrl">填入</button>
    </div>

    <p v-if="errorMessage" class="image-upload__error">{{ errorMessage }}</p>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import OSS from 'ali-oss';

const props = defineProps({
  modelValue: { type: String, default: '' },
  ossStsEndpoint: { type: String, default: '/api/v1/file/oss-sts' },
  dirPrefix: { type: String, default: 'uploads' },
  accept: { type: String, default: 'image/*' },
  placeholder: { type: String, default: '上传图片' },
  urlPlaceholder: { type: String, default: '也可以直接粘贴图片 URL' },
  height: { type: [Number, String], default: 180 },
  showUrlInput: { type: Boolean, default: true },
  clearable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false },
  multiple: { type: Boolean, default: false },
  variant: {
    type: String,
    default: 'box',
    validator: (value) => ['box', 'button'].includes(value),
  },
  buttonText: { type: String, default: '上传图片' },
});

const emit = defineEmits(['update:modelValue', 'uploaded', 'error', 'clear']);

const inputRef = ref(null);
const currentUrl = ref(props.modelValue || '');
const manualUrl = ref(props.modelValue || '');
const uploading = ref(false);
const dragging = ref(false);
const progress = ref(0);
const progressText = ref('');
const errorMessage = ref('');

const normalizedHeight = computed(() => (typeof props.height === 'number' ? `${props.height}px` : props.height));

watch(
  () => props.modelValue,
  (value) => {
    currentUrl.value = value || '';
    manualUrl.value = value || '';
  },
);

function handleDragEnter() {
  if (!props.disabled && !uploading.value) {
    dragging.value = true;
  }
}

function handleDragLeave(event) {
  if (!event.currentTarget?.contains(event.relatedTarget)) {
    dragging.value = false;
  }
}

async function handleDrop(event) {
  dragging.value = false;
  if (props.disabled || uploading.value) return;
  await uploadFiles(event.dataTransfer?.files || []);
}

async function handleFileChange(event) {
  await uploadFiles(event.target.files || []);
  event.target.value = '';
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
  if (!files.length) return;
  const pickedFiles = props.multiple ? files : files.slice(0, 1);
  for (const file of pickedFiles) {
    await uploadFile(file);
  }
}

async function uploadFile(file) {
  uploading.value = true;
  progress.value = 1;
  progressText.value = '正在获取上传凭证';
  errorMessage.value = '';

  try {
    const dir = `${props.dirPrefix}/${new Date().toISOString().slice(0, 10)}`;
    const credential = await getOssCredential(dir);
    const objectName = `${credential.dir}/${createUploadFileName(file.name)}`;
    const client = new OSS({
      region: credential.region,
      endpoint: credential.endpoint,
      accessKeyId: credential.accessKeyId,
      accessKeySecret: credential.accessKeySecret,
      stsToken: credential.securityToken,
      bucket: credential.bucket,
      authorizationV4: true,
    });

    progress.value = 20;
    progressText.value = '正在上传到 OSS';
    const uploadResult = await client.put(objectName, file, {
      mime: file.type || 'application/octet-stream',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
    });

    const finalObjectName = uploadResult.name || objectName;
    const uploadedUrl = buildOssFileUrl(credential.endpoint, credential.bucket, finalObjectName);
    currentUrl.value = uploadedUrl;
    manualUrl.value = uploadedUrl;
    progress.value = 100;
    progressText.value = '上传完成';
    emit('update:modelValue', uploadedUrl);
    emit('uploaded', { url: uploadedUrl, objectName: finalObjectName, file, response: uploadResult });

    window.setTimeout(() => {
      uploading.value = false;
      progress.value = 0;
      progressText.value = '';
    }, 500);
  } catch (error) {
    uploading.value = false;
    progress.value = 0;
    progressText.value = '';
    errorMessage.value = error instanceof Error ? error.message : '上传失败';
    emit('error', error);
  }
}

async function getOssCredential(dir) {
  const response = await fetch(props.ossStsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, durationSeconds: 3600 }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 0) {
    throw new Error(result?.message || `获取上传凭证失败：${response.status}`);
  }
  return result.data || {};
}

function commitManualUrl() {
  const value = manualUrl.value.trim();
  currentUrl.value = value;
  emit('update:modelValue', value);
}

function clearImage() {
  currentUrl.value = '';
  manualUrl.value = '';
  errorMessage.value = '';
  if (inputRef.value) {
    inputRef.value.value = '';
  }
  emit('update:modelValue', '');
  emit('clear');
}

function createUploadFileName(fileName) {
  const cleanName = fileName || 'file';
  const ext = cleanName.includes('.') ? cleanName.slice(cleanName.lastIndexOf('.')).toLowerCase() : '';
  const safeExt = /^\.[0-9a-z]+$/.test(ext) && ext.length <= 16 ? ext : '';
  const random = Math.random().toString(16).slice(2);
  return `${Date.now()}-${random}${safeExt}`;
}

function buildOssFileUrl(endpoint, bucket, objectName) {
  const normalizedEndpoint = String(endpoint || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${bucket}.${normalizedEndpoint}/${objectName}`;
}
</script>

<style scoped>
.image-upload {
  width: 100%;
}

.image-upload--button {
  display: contents;
}

.image-upload__button {
  display: inline-flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: flex-start;
  border: 0;
  border-radius: 10px;
  padding: 0 15px;
  background: #111a2d;
  box-shadow: inset 0 0 0 1px rgba(139, 108, 255, 0.38);
  color: #dce8fb;
  font-size: 14px;
  font-weight: 900;
  cursor: pointer;
  user-select: none;
}

.image-upload__button:hover {
  background: #2b255d;
}

.image-upload__box {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 96px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px dashed rgba(148, 163, 184, 0.58);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.04);
  color: #64748b;
  cursor: pointer;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.image-upload__box:hover,
.image-upload__box--dragging {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.image-upload__box--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.image-upload__box--has-image {
  border-style: solid;
  background: #0b0f16;
}

.image-upload__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.image-upload__preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-upload__empty {
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.image-upload__empty strong {
  width: 46px;
  height: 46px;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
  font-size: 32px;
  line-height: 42px;
  text-align: center;
}

.image-upload__empty small,
.image-upload__mask small {
  font-size: 13px;
}

.image-upload__clear {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  font-size: 16px;
  line-height: 20px;
  text-align: center;
}

.image-upload__mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.68);
  color: #fff;
}

.image-upload__mask strong {
  font-size: 22px;
}

.image-upload__url-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.image-upload__url-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 6px;
  padding: 0 10px;
  background: #fff;
  color: #111827;
}

.image-upload__url-button {
  height: 36px;
  border: 0;
  border-radius: 6px;
  padding: 0 14px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
}

.image-upload__error {
  margin: 8px 0 0;
  color: #dc2626;
  font-size: 13px;
}
</style>

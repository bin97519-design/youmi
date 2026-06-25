import { apiPath } from './apiBase';

function readUploadSign(payload) {
  const data = payload?.data || payload || {};
  if (!data.uploadUrl || !data.url) {
    throw new Error(payload?.message || 'OSS direct upload signature is incomplete');
  }
  return data;
}

function putToOss(uploadUrl, file, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value != null && String(value).trim()) xhr.setRequestHeader(key, String(value));
    });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`OSS direct upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('OSS direct upload network error'));
    xhr.send(file);
  });
}

export async function uploadFileDirect(file, options = {}) {
  if (!file) throw new Error('No file selected');
  const signResponse = await fetch(apiPath('/api/file/oss-sign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({
      fileName: file.name || 'upload.png',
      contentType: file.type || 'application/octet-stream',
      dir: options.dir || 'youmi/uploads',
      expireSeconds: options.expireSeconds || 900,
    }),
  });
  const signPayload = await signResponse.json().catch(() => ({}));
  if (!signResponse.ok || signPayload.code) {
    throw new Error(signPayload.message || `Create OSS upload signature failed: ${signResponse.status}`);
  }
  const sign = readUploadSign(signPayload);
  await putToOss(sign.uploadUrl, file, sign.headers, options.onProgress);
  if (options.onProgress) {
    options.onProgress({ loaded: file.size || 0, total: file.size || 0, percent: 100 });
  }
  return sign.url;
}

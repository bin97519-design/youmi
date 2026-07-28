const enabled = document.getElementById('enabled');
const count = document.getElementById('count');
const last = document.getElementById('last');
const kinds = document.getElementById('kinds');
const preview = document.getElementById('preview');
const download = document.getElementById('download');
const clear = document.getElementById('clear');
const capture = document.getElementById('capture');
const includeScreenshot = document.getElementById('includeScreenshot');
const includeEvents = document.getElementById('includeEvents');
const snapshotStatus = document.getElementById('snapshotStatus');
const reverseCategory = document.getElementById('reverseCategory');
const version = document.getElementById('version');

version.textContent = `v${chrome.runtime.getManifest().version}`;

function send(message) {
  return chrome.runtime.sendMessage(message);
}

function setSnapshotStatus(message, state = '') {
  snapshotStatus.textContent = message;
  snapshotStatus.className = `snapshot-status ${state}`.trim();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function refresh() {
  const [data, reverseSettings, lastSnapshot] = await Promise.all([
    send({ type: 'recorder:get' }),
    send({ type: 'youmi:reverse-prompt:get-settings' }),
    send({ type: 'recorder:getLastSnapshot' }),
  ]);
  enabled.checked = data.enabled;
  reverseCategory.value = reverseSettings?.category || 'mattress';
  count.textContent = `${data.events.length} 条`;
  const lastEvent = data.events.at(-1);
  last.textContent = lastEvent ? `${lastEvent.kind} · ${lastEvent.time}` : '暂无事件';
  kinds.innerHTML = Object.entries(data.kinds || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([kind, value]) => `<span>${kind}: ${value}</span>`)
    .join('');
  preview.textContent = JSON.stringify(data.events.slice(-5), null, 2);

  if (lastSnapshot?.snapshot) {
    const item = lastSnapshot.snapshot;
    setSnapshotStatus(`上次：${item.title || item.pageUrl} · ${formatBytes(item.size)}`, 'success');
  }
}

enabled.addEventListener('change', async () => {
  await send({ type: 'recorder:setEnabled', enabled: enabled.checked });
  await refresh();
});

reverseCategory.addEventListener('change', async () => {
  await send({ type: 'youmi:reverse-prompt:set-category', category: reverseCategory.value });
});

capture.addEventListener('click', async () => {
  capture.disabled = true;
  capture.textContent = '正在采集...';
  setSnapshotStatus('正在读取页面结构与样式...');
  try {
    const result = await send({
      type: 'recorder:captureSnapshot',
      options: {
        includeScreenshot: includeScreenshot.checked,
        includeRecentEvents: includeEvents.checked,
      },
    });
    if (!result?.ok) throw new Error(result?.error || '网页快照生成失败');
    setSnapshotStatus(`已保存 ${result.metadata.filename} · ${formatBytes(result.metadata.size)}`, 'success');
  } catch (error) {
    setSnapshotStatus(String(error?.message || error), 'error');
  } finally {
    capture.disabled = false;
    capture.textContent = '保存当前网页快照';
  }
});

download.addEventListener('click', async () => {
  try {
    download.disabled = true;
    download.textContent = '导出中...';
    const result = await send({ type: 'recorder:download' });
    if (!result?.ok) throw new Error(result?.error || '导出失败');
    download.textContent = '已导出';
    setTimeout(() => {
      download.textContent = '导出日志';
      download.disabled = false;
    }, 1200);
  } catch (error) {
    preview.textContent = `导出失败：${error?.message || error}`;
    download.textContent = '导出日志';
    download.disabled = false;
  }
});

clear.addEventListener('click', async () => {
  await send({ type: 'recorder:clear' });
  await refresh();
});

refresh().catch((error) => setSnapshotStatus(String(error?.message || error), 'error'));

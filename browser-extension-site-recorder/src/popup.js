const enabled = document.getElementById('enabled');
const count = document.getElementById('count');
const last = document.getElementById('last');
const kinds = document.getElementById('kinds');
const preview = document.getElementById('preview');
const download = document.getElementById('download');
const clear = document.getElementById('clear');

function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function refresh() {
  const data = await send({ type: 'recorder:get' });
  enabled.checked = data.enabled;
  count.textContent = `${data.events.length} logs`;
  const lastEvent = data.events.at(-1);
  last.textContent = lastEvent ? `${lastEvent.kind} · ${lastEvent.time}` : 'No events';
  kinds.innerHTML = Object.entries(data.kinds || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([kind, value]) => `<span>${kind}: ${value}</span>`)
    .join('');
  preview.textContent = JSON.stringify(data.events.slice(-5), null, 2);
}

enabled.addEventListener('change', async () => {
  await send({ type: 'recorder:setEnabled', enabled: enabled.checked });
  await refresh();
});

download.addEventListener('click', async () => {
  try {
    download.disabled = true;
    download.textContent = '导出中...';
    const result = await send({ type: 'recorder:download' });
    if (!result?.ok) {
      throw new Error(result?.error || '导出失败');
    }
    download.textContent = '已导出';
    setTimeout(() => {
      download.textContent = '导出 JSON';
      download.disabled = false;
    }, 1200);
  } catch (error) {
    preview.textContent = `导出失败：${error?.message || error}`;
    download.textContent = '导出 JSON';
    download.disabled = false;
  }
});

clear.addEventListener('click', async () => {
  await send({ type: 'recorder:clear' });
  await refresh();
});

refresh();

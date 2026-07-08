const DEFAULT_SELECTORS = [
  'aside.workbench-global-nav',
  'aside.workbench-global-nav.expanded',
  '.sidebar-nav-item',
  '.sidebar-nav-item--designer',
  '#workbench-home-dialog-slot',
  '.chat-panel-wrap',
  '.reference-panel.home-dialog',
  '.home-dialog',
  '.home-cases',
  '.case-card',
  '.login-modal',
  '[role="dialog"]',
].join('\n');

const selectors = document.getElementById('selectors');
const includeTree = document.getElementById('includeTree');
const includeAssets = document.getElementById('includeAssets');
const includeText = document.getElementById('includeText');
const collect = document.getElementById('collect');
const previewBtn = document.getElementById('previewBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');

selectors.value = window.localStorage.getItem('domCollectorSelectors') || DEFAULT_SELECTORS;

function getOptions() {
  const extraSelectors = selectors.value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  window.localStorage.setItem('domCollectorSelectors', selectors.value);

  return {
    extraSelectors,
    includeTree: includeTree.checked,
    includeAssets: includeAssets.checked,
    includeText: includeText.checked,
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('没有找到当前标签页');
  return tab;
}

async function collectSnapshot() {
  const tab = await getActiveTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'dom-style-collector:collect',
      options: getOptions(),
    });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js'],
    });
    return chrome.tabs.sendMessage(tab.id, {
      type: 'dom-style-collector:collect',
      options: getOptions(),
    });
  }
}

function downloadJson(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeHost = new URL(snapshot.page.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  chrome.downloads.download({
    url,
    filename: `dom-style-${safeHost}-${stamp}.json`,
    saveAs: true,
  });
}

async function handleCollect(shouldDownload) {
  try {
    collect.disabled = true;
    previewBtn.disabled = true;
    status.textContent = '采集中...';
    const snapshot = await collectSnapshot();
    const summary = {
      page: snapshot.page,
      viewport: snapshot.viewport,
      treeNodes: snapshot.summary.treeNodes,
      targets: snapshot.summary.targets,
      assets: snapshot.summary.assets,
    };
    preview.textContent = JSON.stringify(summary, null, 2);
    status.textContent = shouldDownload ? '采集完成，正在导出...' : '预览完成';
    if (shouldDownload) downloadJson(snapshot);
    setTimeout(() => {
      status.textContent = shouldDownload ? '已导出 JSON' : '等待采集';
    }, 900);
  } catch (error) {
    status.textContent = '采集失败';
    preview.textContent = error?.message || String(error);
  } finally {
    collect.disabled = false;
    previewBtn.disabled = false;
  }
}

collect.addEventListener('click', () => handleCollect(true));
previewBtn.addEventListener('click', () => handleCollect(false));

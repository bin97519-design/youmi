const MAX_EVENTS = 2000;
const MAX_TEXT = 6000;
const REVERSE_PROMPT_MENU_ROOT = 'youmi-reverse-prompt-root';
const REVERSE_PROMPT_MENU_AUTO = 'youmi-reverse-prompt-auto';
const REVERSE_PROMPT_MENU_SELECTION = 'youmi-reverse-prompt-selection';
const REVERSE_PROMPT_DEFAULT_CATEGORY = 'mattress';

const memory = {
  enabled: true,
  events: [],
};

const reversePrompt = {
  running: false,
  lastHoverByTab: {},
};

function clip(value, limit = MAX_TEXT) {
  if (typeof value !== 'string') return value;
  return value.length > limit ? `${value.slice(0, limit)}...<trimmed ${value.length - limit}>` : value;
}

function sanitizeEvent(event) {
  return {
    ...event,
    time: event.time || new Date().toISOString(),
    pageUrl: clip(event.pageUrl, 1200),
    detail: event.detail ? JSON.parse(JSON.stringify(event.detail, (key, value) => clip(value))) : undefined,
  };
}

async function persist() {
  await chrome.storage.local.set({
    recorderEnabled: memory.enabled,
    recorderEvents: memory.events.slice(-MAX_EVENTS),
  });
}

async function load() {
  const data = await chrome.storage.local.get(['recorderEnabled', 'recorderEvents']);
  memory.enabled = data.recorderEnabled ?? true;
  memory.events = Array.isArray(data.recorderEvents) ? data.recorderEvents : [];
}

async function forwardTmallImages(payload) {
  const tabs = await chrome.tabs.query({
    url: ['http://127.0.0.1:5173/*', 'http://127.0.0.1:5174/*', 'http://localhost:5173/*', 'http://localhost:5174/*'],
  });

  await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, {
      type: 'youmi:tmall-descv8-images',
      payload,
    })),
  );

  return tabs.length;
}

async function sendMessageWithContentScript(tab, message) {
  if (!tab?.id) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    return true;
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      await chrome.tabs.sendMessage(tab.id, message);
      return true;
    } catch {
      return false;
    }
  }
}

async function forwardReversePromptResult(payload) {
  const tabs = await chrome.tabs.query({
    url: ['http://127.0.0.1:5173/*', 'http://127.0.0.1:5174/*', 'http://localhost:5173/*', 'http://localhost:5174/*'],
  });

  await Promise.allSettled(
    tabs.map((tab) => sendMessageWithContentScript(tab, {
      type: 'youmi:reverse-prompt-result',
      payload,
    })),
  );

  return tabs.length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openReversePromptCanvasIfNeeded() {
  const tabs = await chrome.tabs.query({
    url: ['http://127.0.0.1:5173/*', 'http://127.0.0.1:5174/*', 'http://localhost:5173/*', 'http://localhost:5174/*'],
  });
  if (tabs.length) return tabs.length;
  await chrome.tabs.create({ url: 'http://127.0.0.1:5174/reverse-prompt', active: true });
  return 1;
}

async function getReversePromptCategory() {
  const data = await chrome.storage.local.get(['youmi_reverse_prompt_category']);
  return data.youmi_reverse_prompt_category || REVERSE_PROMPT_DEFAULT_CATEGORY;
}

function reversePromptMenuTitle() {
  return '反推提示词';
}

async function ensureReversePromptMenus() {
  const title = reversePromptMenuTitle();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: REVERSE_PROMPT_MENU_ROOT,
    title,
    contexts: ['page', 'selection', 'link', 'image'],
  });
  chrome.contextMenus.create({
    id: REVERSE_PROMPT_MENU_AUTO,
    parentId: REVERSE_PROMPT_MENU_ROOT,
    title: '自动选择',
    contexts: ['page', 'selection', 'link', 'image'],
  });
  chrome.contextMenus.create({
    id: REVERSE_PROMPT_MENU_SELECTION,
    parentId: REVERSE_PROMPT_MENU_ROOT,
    title: '框选区域',
    contexts: ['page', 'selection', 'link', 'image'],
  });
}

function dataUrlBase64(dataUrl) {
  const text = String(dataUrl || '');
  return text.startsWith('data:') ? text.split(',', 2)[1] || '' : text;
}

async function imageUrlToBase64(imageUrl) {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('data:')) return dataUrlBase64(imageUrl);
  const response = await fetch(imageUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`图片下载失败：${response.status}`);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function cropVisibleTab(tab, rect) {
  if (!rect || rect.width < 8 || rect.height < 8) {
    throw new Error('框选区域太小');
  }
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const image = await createImageBitmap(await (await fetch(screenshot)).blob());
  const scale = Number(rect.devicePixelRatio || 1);
  const sourceX = Math.max(0, Math.round(rect.x * scale));
  const sourceY = Math.max(0, Math.round(rect.y * scale));
  const sourceWidth = Math.max(1, Math.round(rect.width * scale));
  const sourceHeight = Math.max(1, Math.round(rect.height * scale));
  const width = Math.min(sourceWidth, image.width - sourceX);
  const height = Math.min(sourceHeight, image.height - sourceY);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    imageBase64: btoa(binary),
    thumbnailUrl: `data:image/jpeg;base64,${btoa(binary)}`,
  };
}

async function pushReversePromptImage({ imageUrl = '', thumbnailUrl = '', source = 'context-menu', pageUrl = '' }, tab = null) {
  const category = await getReversePromptCategory();
  const payload = {
    source,
    category,
    categoryLabel: {
      general: '通用',
      mattress: '床垫',
      curtain: '窗帘',
      solid_wood_bed: '实木床',
    }[category] || '',
    imageUrl: imageUrl || thumbnailUrl,
    thumbnailUrl: thumbnailUrl || imageUrl,
    pageUrl: pageUrl || tab?.url || '',
    promptJson: {},
    promptText: '',
    pendingPromptAnalysis: true,
    createdAt: new Date().toISOString(),
  };

  const { reversePromptHistory = [] } = await chrome.storage.local.get(['reversePromptHistory']);
  await chrome.storage.local.set({
    reversePromptLastResult: payload,
    reversePromptHistory: [payload, ...reversePromptHistory].slice(0, 30),
  });
  await openReversePromptCanvasIfNeeded();
  await forwardReversePromptResult(payload);
  await delay(700);
  await forwardReversePromptResult(payload);
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'youmi:reverse-prompt-result',
      payload,
    }).catch(() => {});
  }
  return payload;
}

async function notifyReversePromptTab(tab, message, state = 'info') {
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, {
    type: 'youmi:reverse-prompt-toast',
    message,
    state,
  }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(async () => {
  await load();
  await ensureReversePromptMenus();
});
chrome.runtime.onStartup.addListener(async () => {
  await load();
  await ensureReversePromptMenus();
});
load();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'recorder:event') {
      if (!memory.enabled) {
        sendResponse({ ok: true, ignored: true });
        return;
      }

      const event = sanitizeEvent({
        ...message.event,
        tabId: sender.tab?.id,
        frameId: sender.frameId,
      });
      memory.events.push(event);
      if (memory.events.length > MAX_EVENTS) {
        memory.events = memory.events.slice(-MAX_EVENTS);
      }
      await persist();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'youmi:tmall-descv8-images') {
      const forwardedTabs = await forwardTmallImages(message.payload || {});
      sendResponse({ ok: true, forwardedTabs });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt-hover-image' && sender.tab?.id) {
      reversePrompt.lastHoverByTab[sender.tab.id] = message.image || null;
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt-selection' && sender.tab?.id) {
      if (reversePrompt.running) {
        sendResponse({ ok: false, error: '正在处理图片，请稍后再试' });
        return;
      }
      reversePrompt.running = true;
      const tab = sender.tab;
      try {
        await notifyReversePromptTab(tab, '正在截取框选区域...', 'running');
        const cropped = await cropVisibleTab(tab, message.rect);
        await notifyReversePromptTab(tab, '正在把框选图片推送到画布...', 'running');
        const result = await pushReversePromptImage({
          imageUrl: cropped.thumbnailUrl,
          thumbnailUrl: cropped.thumbnailUrl,
          source: 'selection',
          pageUrl: message.pageUrl || tab.url || '',
        }, tab);
        await notifyReversePromptTab(tab, '图片已推送到反推提示词画布', 'done');
        sendResponse({ ok: true, result });
      } catch (error) {
        const errorMessage = String(error?.message || error);
        await notifyReversePromptTab(tab, errorMessage, 'error');
        sendResponse({ ok: false, error: errorMessage });
      } finally {
        reversePrompt.running = false;
      }
      return;
    }

    if (message?.type === 'recorder:get') {
      const kinds = memory.events.reduce((map, event) => {
        map[event.kind] = (map[event.kind] || 0) + 1;
        return map;
      }, {});
      sendResponse({ ok: true, enabled: memory.enabled, events: memory.events, kinds });
      return;
    }

    if (message?.type === 'recorder:setEnabled') {
      memory.enabled = Boolean(message.enabled);
      await persist();
      sendResponse({ ok: true, enabled: memory.enabled });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt:get-settings') {
      sendResponse({ ok: true, category: await getReversePromptCategory() });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt:get-last') {
      const data = await chrome.storage.local.get(['reversePromptLastResult']);
      if (data.reversePromptLastResult) {
        await chrome.storage.local.remove(['reversePromptLastResult']);
      }
      sendResponse({ ok: true, payload: data.reversePromptLastResult || null });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt:clear-last') {
      await chrome.storage.local.remove(['reversePromptLastResult']);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'youmi:reverse-prompt:set-category') {
      const category = message.category || REVERSE_PROMPT_DEFAULT_CATEGORY;
      await chrome.storage.local.set({ youmi_reverse_prompt_category: category });
      await ensureReversePromptMenus();
      sendResponse({ ok: true, category });
      return;
    }

    if (message?.type === 'recorder:clear') {
      memory.events = [];
      await persist();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'recorder:download') {
      try {
        const json = JSON.stringify(memory.events, null, 2);
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        const downloadId = await chrome.downloads.download({
          url,
          filename: `site-recorder-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
          saveAs: true,
        });
        sendResponse({ ok: true, downloadId });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    }
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (reversePrompt.running) {
    await notifyReversePromptTab(tab, '正在处理图片，请稍后再试', 'running');
    return;
  }

  if (info.menuItemId === REVERSE_PROMPT_MENU_SELECTION) {
    await chrome.tabs.sendMessage(tab.id, { type: 'youmi:reverse-prompt-start-selection' }).catch(async () => {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'youmi:reverse-prompt-start-selection' });
    });
    return;
  }

  const hoverImage = reversePrompt.lastHoverByTab[tab.id];
  const imageUrl = info.menuItemId === REVERSE_PROMPT_MENU_AUTO
    ? info.srcUrl || hoverImage?.url || ''
    : '';

  if (!imageUrl) {
    await notifyReversePromptTab(tab, '没有找到可推送的图片，请右键图片或使用框选区域', 'error');
    return;
  }

  reversePrompt.running = true;
  try {
    await notifyReversePromptTab(tab, '正在把图片推送到画布...', 'running');
    await pushReversePromptImage({
      imageUrl,
      thumbnailUrl: hoverImage?.thumbnailUrl || imageUrl,
      source: info.srcUrl ? 'context-menu' : 'hover-image',
      pageUrl: tab.url || '',
    }, tab);
    await notifyReversePromptTab(tab, '图片已推送到反推提示词画布', 'done');
    await chrome.action.setBadgeText({ text: 'OK' });
    await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } catch (error) {
    await notifyReversePromptTab(tab, String(error?.message || error), 'error');
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } finally {
    reversePrompt.running = false;
  }
});

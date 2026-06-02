const MAX_EVENTS = 2000;
const MAX_TEXT = 6000;

const memory = {
  enabled: true,
  events: [],
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
    url: ['http://127.0.0.1:5173/*', 'http://localhost:5173/*'],
  });

  await Promise.allSettled(
    tabs.map((tab) => chrome.tabs.sendMessage(tab.id, {
      type: 'youmi:tmall-descv8-images',
      payload,
    })),
  );

  return tabs.length;
}

chrome.runtime.onInstalled.addListener(load);
chrome.runtime.onStartup.addListener(load);
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

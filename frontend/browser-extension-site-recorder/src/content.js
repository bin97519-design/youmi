const PAGE_EVENT = '__YOUmi_SITE_RECORDER__';
const MAX_TEXT = 2000;
const INTERACTIVE_SELECTOR = 'button,a,[role="button"],input,textarea,select,label,[draggable="true"],[contenteditable="true"]';
const IMPORTANT_SELECTORS = [
  '.workbench-global-nav',
  '.workbench-home-top',
  '.workbench-home-shortcuts',
  '.canvas',
  '.canvas-page',
  '.editor',
  '.editor-page',
  '.toolbar',
  '.panel',
  '.layer',
  '[class*="canvas"]',
  '[class*="editor"]',
  '[class*="toolbar"]',
  '[class*="panel"]',
  '[class*="layer"]',
];

const TMALL_EXTRACT_HASH = 'youmiExtractDescV8';

function isTmallDetailPage() {
  return /detail\.tmall\.com$/i.test(location.hostname);
}

function isYoumiLocalPage() {
  return ['127.0.0.1', 'localhost'].includes(location.hostname) && ['5173', '5174'].includes(location.port);
}

function now() {
  return new Date().toISOString();
}

function clip(text, limit = MAX_TEXT) {
  if (typeof text !== 'string') return text;
  return text.length > limit ? `${text.slice(0, limit)}...<trimmed ${text.length - limit}>` : text;
}

function selectorFor(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
  const parts = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
    let part = node.localName;
    if (node.id) {
      part += `#${CSS.escape(node.id)}`;
      parts.unshift(part);
      break;
    }
    const className = [...node.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('');
    part += className;
    const parent = node.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.localName === node.localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function rectFor(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function styleFor(element) {
  const style = getComputedStyle(element);
  return {
    display: style.display,
    position: style.position,
    zIndex: style.zIndex,
    overflow: style.overflow,
    cursor: style.cursor,
    color: style.color,
    backgroundColor: style.backgroundColor,
    borderRadius: style.borderRadius,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
  };
}

function describeElement(element) {
  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
    text: clip((element.innerText || element.value || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim(), 260),
    className: clip(element.className ? String(element.className) : '', 400),
    id: element.id || undefined,
    role: element.getAttribute('role') || undefined,
    href: element.href || undefined,
    src: element.currentSrc || element.src || undefined,
    rect: rectFor(element),
    style: styleFor(element),
  };
}

function send(kind, detail = {}) {
  chrome.runtime.sendMessage({
    type: 'recorder:event',
    event: {
      kind,
      time: now(),
      pageUrl: location.href,
      title: document.title,
      detail,
    },
  }).catch(() => {});
}

function parseYoumiExtractParams() {
  if (!isTmallDetailPage()) return null;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hash.get(TMALL_EXTRACT_HASH) !== '1' && hash.get(TMALL_EXTRACT_HASH) !== 'true') return null;
  return {
    requestId: hash.get('requestId') || '',
    returnOrigin: hash.get('returnOrigin') || 'http://127.0.0.1:5173',
  };
}

function tmallSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tmallRand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function normalizeTmallImageUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;

  url = url
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\\\//g, '/');

  if (url.startsWith('//')) url = `${location.protocol}${url}`;

  try {
    url = new URL(url, location.href).href;
  } catch {
    return null;
  }

  url = url.replace(/#.*/, '');
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) ? url : null;
}

function addTmallImageUrl(set, raw) {
  const url = normalizeTmallImageUrl(raw);
  if (url) set.add(url);
}

function normalizePageImageUrl(raw) {
  if (!raw) return '';
  const text = String(raw).trim();
  if (!text || text.startsWith('blob:')) return '';
  if (text.startsWith('data:')) return text;
  try {
    return new URL(text, location.href).href;
  } catch {
    return '';
  }
}

function extractCssBackgroundUrl(backgroundImage) {
  if (!backgroundImage || backgroundImage === 'none') return '';
  const matches = [...String(backgroundImage).matchAll(/url\((['"]?)(.*?)\1\)/g)];
  return matches.length ? matches[matches.length - 1][2] : '';
}

function reversePromptImageInfoFromElement(element) {
  if (!element) return null;

  const image = element.closest?.('img, source');
  if (image) {
    const srcset = image.getAttribute('srcset') || image.getAttribute('data-srcset') || '';
    const rawUrl =
      image.currentSrc ||
      image.src ||
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-original') ||
      srcset.split(',')[0]?.trim().split(/\s+/)[0];
    const url = normalizePageImageUrl(rawUrl);
    if (url) {
      return {
        url,
        kind: 'image',
        alt: image.getAttribute('alt') || '',
        pageUrl: location.href,
      };
    }
  }

  let node = element;
  while (node && node !== document.documentElement) {
    const url = normalizePageImageUrl(extractCssBackgroundUrl(getComputedStyle(node).backgroundImage));
    if (url) {
      return {
        url,
        kind: 'background',
        alt: node.getAttribute?.('aria-label') || node.textContent?.trim().slice(0, 80) || '',
        pageUrl: location.href,
      };
    }
    node = node.parentElement;
  }

  return null;
}

function sendReversePromptHoverImage(image) {
  chrome.runtime.sendMessage({
    type: 'youmi:reverse-prompt-hover-image',
    image,
  }).catch(() => {});
}

function showReversePromptToast(message, state = 'info') {
  if (!message) return;
  let toast = document.getElementById('youmi-reverse-prompt-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'youmi-reverse-prompt-toast';
    toast.style.position = 'fixed';
    toast.style.top = '18px';
    toast.style.right = '18px';
    toast.style.zIndex = '2147483647';
    toast.style.maxWidth = '360px';
    toast.style.padding = '12px 14px';
    toast.style.borderRadius = '8px';
    toast.style.font = '13px/1.5 "Microsoft YaHei", "Segoe UI", sans-serif';
    toast.style.boxShadow = '0 12px 32px rgba(0,0,0,.35)';
    toast.style.pointerEvents = 'none';
    document.documentElement.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.color = state === 'error' ? '#fecaca' : '#dbeafe';
  toast.style.background = state === 'error' ? '#450a0a' : '#0f172a';
  toast.style.border = state === 'error' ? '1px solid #991b1b' : '1px solid #2563eb';
  clearTimeout(showReversePromptToast.timer);
  showReversePromptToast.timer = setTimeout(() => {
    toast.style.display = 'none';
  }, state === 'running' ? 3000 : 7000);
}

function postReversePromptResult(payload) {
  window.postMessage({
    type: 'youmi:reverse-prompt-result',
    payload: payload || {},
  }, location.origin);
}

async function requestLastReversePromptResult() {
  const response = await chrome.runtime.sendMessage({ type: 'youmi:reverse-prompt:get-last' }).catch(() => null);
  if (response?.ok && response.payload) postReversePromptResult(response.payload);
}

async function clearLastReversePromptResult() {
  await chrome.runtime.sendMessage({ type: 'youmi:reverse-prompt:clear-last' }).catch(() => null);
}

function startReversePromptSelection() {
  if (document.getElementById('youmi-reverse-selection-overlay')) return;
  showReversePromptToast('拖拽框选要反推的区域，按 Esc 取消', 'running');

  const overlay = document.createElement('div');
  overlay.id = 'youmi-reverse-selection-overlay';
  overlay.innerHTML = '<div class="youmi-reverse-selection-tip">拖拽框选图片区域</div><div class="youmi-reverse-selection-box"></div>';
  const style = document.createElement('style');
  style.textContent = `
    #youmi-reverse-selection-overlay{position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(15,23,42,.18);user-select:none}
    #youmi-reverse-selection-overlay .youmi-reverse-selection-tip{position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:999px;background:rgba(15,23,42,.95);border:1px solid rgba(37,99,235,.7);color:#dbeafe;font:700 13px/1.4 "Microsoft YaHei","Segoe UI",sans-serif;box-shadow:0 10px 32px rgba(0,0,0,.35);pointer-events:none}
    #youmi-reverse-selection-overlay .youmi-reverse-selection-box{position:fixed;display:none;border:2px solid #60a5fa;background:rgba(96,165,250,.14);box-shadow:0 0 0 9999px rgba(0,0,0,.32);pointer-events:none}
  `;
  overlay.appendChild(style);
  document.documentElement.appendChild(overlay);

  const box = overlay.querySelector('.youmi-reverse-selection-box');
  let startX = 0;
  let startY = 0;
  let dragging = false;

  function updateBox(currentX, currentY) {
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    box.style.display = 'block';
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    return { x: left, y: top, width, height, devicePixelRatio: window.devicePixelRatio || 1 };
  }

  function cleanup() {
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  }

  function onMouseMove(event) {
    if (!dragging) return;
    event.preventDefault();
    updateBox(event.clientX, event.clientY);
  }

  async function onMouseUp(event) {
    if (!dragging) return;
    event.preventDefault();
    dragging = false;
    const rect = updateBox(event.clientX, event.clientY);
    cleanup();
    if (rect.width < 8 || rect.height < 8) {
      showReversePromptToast('框选区域太小', 'error');
      return;
    }
    showReversePromptToast('已提交框选区域，正在反推...', 'running');
    const response = await chrome.runtime.sendMessage({
      type: 'youmi:reverse-prompt-selection',
      rect,
      pageUrl: location.href,
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!response?.ok) showReversePromptToast(response?.error || '框选识别失败', 'error');
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cleanup();
    showReversePromptToast('已取消框选', 'info');
  }

  overlay.addEventListener('mousedown', (event) => {
    event.preventDefault();
    startX = event.clientX;
    startY = event.clientY;
    dragging = true;
    updateBox(startX, startY);
  });
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('keydown', onKeyDown, true);
}

function extractTmallDescV8Images() {
  const selector = 'div.descV8-container';
  const container = document.querySelector(selector);
  const urls = new Set();

  if (container) {
    container.querySelectorAll('img, source').forEach((el) => {
      [
        'src',
        'data-src',
        'data-ks-lazyload',
        'data-lazy',
        'data-original',
        'data-img',
        'data-imgurl',
        'original',
        'lazyload',
      ].forEach((attr) => addTmallImageUrl(urls, el.getAttribute(attr)));

      const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => addTmallImageUrl(urls, part.trim().split(/\s+/)[0]));
      }
    });

    container.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      for (const match of style.matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
        addTmallImageUrl(urls, match[2]);
      }
    });

    const html = container.outerHTML
      .replace(/\\\//g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

    for (const match of html.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi)) {
      addTmallImageUrl(urls, match[0]);
    }
  }

  return {
    selector,
    foundContainer: Boolean(container),
    imageNodeCount: container ? container.querySelectorAll('img, source').length : 0,
    imageUrls: Array.from(urls),
  };
}

async function waitForTmallDescContainer(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const container = document.querySelector('div.descV8-container');
    if (container) return container;
    await tmallSleep(500);
  }
  return null;
}

async function humanLikeTmallScroll() {
  let lastY = -1;
  let stableSteps = 0;
  const container = document.querySelector('div.descV8-container');

  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await tmallSleep(tmallRand(500, 900));
  }

  for (let step = 1; step <= 80; step += 1) {
    const x = tmallRand(Math.round(innerWidth * 0.35), Math.round(innerWidth * 0.78));
    const y = tmallRand(Math.round(innerHeight * 0.32), Math.round(innerHeight * 0.76));

    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: x,
      clientY: y,
    }));

    const deltaY = tmallRand(1300, 3400);
    window.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaMode: 0,
      deltaY,
    }));
    document.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaMode: 0,
      deltaY,
    }));
    window.scrollBy({
      top: deltaY,
      left: tmallRand(-6, 6),
      behavior: 'smooth',
    });

    await tmallSleep(tmallRand(160, 420));
    if (step % 8 === 0) await tmallSleep(tmallRand(500, 1000));

    const currentY = Math.round(scrollY);
    stableSteps = Math.abs(currentY - lastY) < 12 ? stableSteps + 1 : 0;
    lastY = currentY;

    const nearBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 100;
    if (nearBottom || stableSteps >= 4) break;
  }

  await tmallSleep(700);
}

async function runTmallDescV8Bridge() {
  const params = parseYoumiExtractParams();
  if (!params) return;

  await tmallSleep(tmallRand(300, 700));
  await waitForTmallDescContainer();
  await humanLikeTmallScroll();
  const result = extractTmallDescV8Images();

  const payload = {
    type: 'youmi:tmall-descv8-images',
    requestId: params.requestId,
    pageUrl: location.href,
    title: document.title,
    ...result,
  };

  try {
    window.opener?.postMessage(payload, params.returnOrigin);
  } catch {
    // The opener may be unavailable when the tab is opened with noopener.
  }

  chrome.runtime.sendMessage({
    type: 'youmi:tmall-descv8-images',
    payload,
  }).catch(() => {});

  send('tmall:descv8-images', {
    requestId: params.requestId,
    foundContainer: result.foundContainer,
    imageCount: result.imageUrls.length,
  });
}

function injectPageHook() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('src/injected.js');
  script.onload = () => script.remove();
  (document.documentElement || document.head).appendChild(script);
}

function snapshotDom(reason) {
  const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 30).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: clip(el.innerText.trim(), 160),
    selector: selectorFor(el),
  }));
  const buttons = [...document.querySelectorAll('button,[role="button"],a')].slice(0, 80).map((el) => ({
    tag: el.tagName.toLowerCase(),
    text: clip((el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim(), 140),
    href: el.href || undefined,
    selector: selectorFor(el),
  }));
  const inputs = [...document.querySelectorAll('input,textarea,select')].slice(0, 50).map((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type') || undefined,
    placeholder: el.getAttribute('placeholder') || undefined,
    label: el.getAttribute('aria-label') || undefined,
    selector: selectorFor(el),
  }));
  const images = [...document.images].slice(0, 80).map((img) => ({
    src: img.currentSrc || img.src,
    alt: img.alt,
    width: img.naturalWidth,
    height: img.naturalHeight,
    selector: selectorFor(img),
  }));
  const important = IMPORTANT_SELECTORS.flatMap((selector) => {
    try {
      return [...document.querySelectorAll(selector)].slice(0, 20).map(describeElement);
    } catch {
      return [];
    }
  }).slice(0, 120);
  const activeElement = document.activeElement && document.activeElement !== document.body ? describeElement(document.activeElement) : null;

  send('dom:snapshot', {
    reason,
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    counts: {
      elements: document.querySelectorAll('*').length,
      buttons: buttons.length,
      inputs: inputs.length,
      images: images.length,
    },
    headings,
    buttons,
    inputs,
    images,
    important,
    activeElement,
  });
}

function watchDom() {
  let timer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => snapshotDom('mutation'), 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
}

function watchNavigation() {
  let lastUrl = location.href;
  const emit = (source) => {
    if (lastUrl === location.href) return;
    lastUrl = location.href;
    send('navigation', { source, url: location.href });
    setTimeout(() => snapshotDom(`navigation:${source}`), 300);
  };
  ['pushState', 'replaceState'].forEach((method) => {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      emit(method);
      return result;
    };
  });
  window.addEventListener('popstate', () => emit('popstate'));
  window.addEventListener('hashchange', () => emit('hashchange'));
}

function watchUserActions() {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest(INTERACTIVE_SELECTOR);
      if (!target) return;
      send('ui:click', {
        pointer: { x: event.clientX, y: event.clientY, button: event.button },
        selector: selectorFor(target),
        text: clip((target.innerText || target.value || target.getAttribute('aria-label') || target.getAttribute('title') || '').trim(), 180),
        tag: target.tagName.toLowerCase(),
        element: describeElement(target),
      });
    },
    true,
  );

  document.addEventListener(
    'contextmenu',
    (event) => {
      const target = event.target.closest('*');
      if (!target) return;
      send('ui:contextmenu', {
        pointer: { x: event.clientX, y: event.clientY, button: event.button },
        element: describeElement(target),
      });
    },
    true,
  );

  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target.closest(INTERACTIVE_SELECTOR) || event.target.closest('[class*="canvas"],[class*="panel"],[class*="toolbar"],img');
      if (!target) return;
      send('ui:pointerdown', {
        pointer: { x: event.clientX, y: event.clientY, button: event.button, pointerType: event.pointerType },
        element: describeElement(target),
      });
    },
    true,
  );

  document.addEventListener(
    'pointerup',
    (event) => {
      const target = event.target.closest(INTERACTIVE_SELECTOR) || event.target.closest('[class*="canvas"],[class*="panel"],[class*="toolbar"],img');
      if (!target) return;
      send('ui:pointerup', {
        pointer: { x: event.clientX, y: event.clientY, button: event.button, pointerType: event.pointerType },
        element: describeElement(target),
      });
    },
    true,
  );

  document.addEventListener(
    'dragstart',
    (event) => {
      const target = event.target.closest('*');
      if (!target) return;
      send('ui:dragstart', { element: describeElement(target), pointer: { x: event.clientX, y: event.clientY } });
    },
    true,
  );

  document.addEventListener(
    'drop',
    (event) => {
      const files = [...(event.dataTransfer?.files || [])].map((file) => ({ name: file.name, type: file.type, size: file.size }));
      send('ui:drop', {
        pointer: { x: event.clientX, y: event.clientY },
        files,
        element: event.target?.closest?.('*') ? describeElement(event.target.closest('*')) : null,
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!target?.matches?.('input,textarea,select')) return;
      const files = target.type === 'file' ? [...target.files].map((file) => ({ name: file.name, type: file.type, size: file.size })) : undefined;
      send('ui:change', {
        element: describeElement(target),
        valuePreview: target.type === 'file' ? undefined : clip(target.value || '', 500),
        files,
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      send('ui:keydown', {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        element: event.target?.closest?.('*') ? describeElement(event.target.closest('*')) : null,
      });
    },
    true,
  );
}

let lastReversePromptHoverImage = null;
document.addEventListener(
  'mousemove',
  (event) => {
    const image = reversePromptImageInfoFromElement(document.elementFromPoint(event.clientX, event.clientY));
    if (!image || image.url === lastReversePromptHoverImage?.url) return;
    lastReversePromptHoverImage = image;
    sendReversePromptHoverImage(image);
  },
  { passive: true },
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'youmi:reverse-prompt-toast') {
    showReversePromptToast(message.message || '', message.state || 'info');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'youmi:reverse-prompt-start-selection') {
    startReversePromptSelection();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'youmi:reverse-prompt-result') {
    postReversePromptResult(message.payload);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

if (isYoumiLocalPage()) {
  window.postMessage({ type: 'youmi:extension-bridge-ready' }, location.origin);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type === 'youmi:extension-bridge-ping') {
      window.postMessage({ type: 'youmi:extension-bridge-ready' }, location.origin);
      return;
    }
    if (event.data?.type === 'youmi:reverse-prompt-request-last') {
      requestLastReversePromptResult();
      return;
    }
    if (event.data?.type === 'youmi:reverse-prompt-clear-last') {
      clearLastReversePromptResult();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'youmi:tmall-descv8-images') {
      window.postMessage(message.payload, location.origin);
    }
  });
} else if (isTmallDetailPage()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runTmallDescV8Bridge, { once: true });
  } else {
    runTmallDescV8Bridge();
  }
} else {
  window.addEventListener(PAGE_EVENT, (event) => {
    send(event.detail?.kind || 'page:event', event.detail?.detail || {});
  });

  injectPageHook();
  watchNavigation();
  watchUserActions();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      snapshotDom('DOMContentLoaded');
      watchDom();
    });
  } else {
    snapshotDom('initial');
    watchDom();
  }
}

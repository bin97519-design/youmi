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
  return ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '5173';
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

if (isYoumiLocalPage()) {
  window.postMessage({ type: 'youmi:extension-bridge-ready' }, location.origin);
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== 'youmi:extension-bridge-ping') return;
    window.postMessage({ type: 'youmi:extension-bridge-ready' }, location.origin);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'youmi:tmall-descv8-images') return;
    window.postMessage(message.payload, location.origin);
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

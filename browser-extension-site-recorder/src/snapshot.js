(function installYoumiSnapshot() {
  if (globalThis.__youmiSnapshotInstalled) return;
  globalThis.__youmiSnapshotInstalled = true;

  const SCHEMA_VERSION = '1.0.0';
  const MAX_STYLED_ELEMENTS = 8000;
  const MAX_NODE_TEXT = 500;
  const EXTENSION_NODE_PREFIXES = ['youmi-reverse-', 'youmi-snapshot-'];
  const STYLE_PROPERTIES = [
    'display', 'position', 'inset', 'top', 'right', 'bottom', 'left', 'z-index',
    'float', 'clear', 'box-sizing', 'width', 'min-width', 'max-width', 'height',
    'min-height', 'max-height', 'aspect-ratio', 'margin', 'margin-top', 'margin-right',
    'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right',
    'padding-bottom', 'padding-left', 'overflow', 'overflow-x', 'overflow-y',
    'overscroll-behavior', 'contain', 'content-visibility',
    'flex', 'flex-basis', 'flex-direction', 'flex-flow', 'flex-grow', 'flex-shrink',
    'flex-wrap', 'grid', 'grid-area', 'grid-auto-columns', 'grid-auto-flow',
    'grid-auto-rows', 'grid-column', 'grid-column-end', 'grid-column-start',
    'grid-row', 'grid-row-end', 'grid-row-start', 'grid-template',
    'grid-template-areas', 'grid-template-columns', 'grid-template-rows',
    'gap', 'row-gap', 'column-gap', 'align-content', 'align-items', 'align-self',
    'justify-content', 'justify-items', 'justify-self', 'place-content', 'place-items',
    'place-self', 'order', 'columns', 'column-count', 'column-width',
    'color', 'background', 'background-color', 'background-image', 'background-position',
    'background-repeat', 'background-size', 'background-attachment', 'border',
    'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color',
    'border-style', 'border-width', 'border-radius', 'border-collapse', 'border-spacing',
    'outline', 'outline-offset', 'box-shadow', 'opacity', 'visibility', 'filter',
    'backdrop-filter', 'clip', 'clip-path', 'mask', 'mix-blend-mode', 'isolation',
    'transform', 'transform-origin', 'transform-style', 'perspective', 'perspective-origin',
    'object-fit', 'object-position', 'image-rendering',
    'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch',
    'font-variant', 'font-feature-settings', 'font-kerning', 'line-height',
    'letter-spacing', 'word-spacing', 'text-align', 'text-align-last', 'text-indent',
    'text-transform', 'text-decoration', 'text-decoration-color', 'text-decoration-line',
    'text-decoration-style', 'text-overflow', 'text-shadow', 'white-space',
    'word-break', 'overflow-wrap', 'hyphens', 'writing-mode', 'direction',
    'vertical-align', 'list-style', 'list-style-image', 'list-style-position',
    'list-style-type', 'table-layout', 'caption-side', 'empty-cells',
    'cursor', 'pointer-events', 'user-select', 'resize', 'appearance', 'accent-color',
  ];

  function now() {
    return new Date().toISOString();
  }

  function clip(value, limit = MAX_NODE_TEXT) {
    const text = String(value || '');
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function absoluteUrl(value) {
    const text = String(value || '').trim();
    if (!text || text.startsWith('data:') || text.startsWith('blob:') || text.startsWith('#')) return text;
    try {
      return new URL(text, document.baseURI).href;
    } catch {
      return text;
    }
  }

  function doctypeText() {
    const value = document.doctype;
    if (!value) return '<!doctype html>';
    const publicId = value.publicId ? ` PUBLIC "${value.publicId}"` : '';
    const systemId = value.systemId ? `${value.publicId ? '' : ' SYSTEM'} "${value.systemId}"` : '';
    return `<!DOCTYPE ${value.name}${publicId}${systemId}>`;
  }

  function rectFor(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round((rect.x + Number.EPSILON) * 100) / 100,
      y: Math.round((rect.y + Number.EPSILON) * 100) / 100,
      width: Math.round((rect.width + Number.EPSILON) * 100) / 100,
      height: Math.round((rect.height + Number.EPSILON) * 100) / 100,
      documentX: Math.round((rect.x + scrollX + Number.EPSILON) * 100) / 100,
      documentY: Math.round((rect.y + scrollY + Number.EPSILON) * 100) / 100,
    };
  }

  function selectorFor(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
      let part = node.localName || node.tagName.toLowerCase();
      if (node.id) {
        part += `#${CSS.escape(node.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = [...node.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('');
      part += classes;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((child) => child.localName === node.localName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function elementText(element) {
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || '';
    if (label) return clip(label);
    const directText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (directText) return clip(directText);
    if (!element.firstElementChild) return clip((element.textContent || '').replace(/\s+/g, ' ').trim());
    return '';
  }

  function isExtensionNode(element) {
    const id = element?.id || '';
    return EXTENSION_NODE_PREFIXES.some((prefix) => id.startsWith(prefix));
  }

  function collectCssValueUrls(value, addResource, source) {
    if (!value || value === 'none') return;
    for (const match of String(value).matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
      const url = absoluteUrl(match[2]);
      if (url) addResource(url, 'style-resource', source);
    }
  }

  function safeComputedStyle(element, pseudo) {
    try {
      return getComputedStyle(element, pseudo);
    } catch {
      return null;
    }
  }

  function declarationsFor(style) {
    if (!style) return '';
    return STYLE_PROPERTIES.map((property) => {
      const value = style.getPropertyValue(property);
      return value ? `${property}:${value} !important` : '';
    }).filter(Boolean).join(';');
  }

  function pseudoRule(elementId, element, pseudo, addResource) {
    const style = safeComputedStyle(element, pseudo);
    if (!style) return '';
    const content = style.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') return '';
    collectCssValueUrls(style.getPropertyValue('background-image'), addResource, `${elementId}${pseudo}`);
    return `[data-youmi-snapshot-id="${elementId}"]${pseudo}{${declarationsFor(style)};content:${content} !important}`;
  }

  function applyRuntimeState(source, clone) {
    if (source instanceof HTMLInputElement) {
      if (source.type === 'password') {
        clone.value = '';
        clone.setAttribute('value', '');
        clone.setAttribute('data-youmi-redacted', 'password');
      } else if (!['file', 'image'].includes(source.type)) {
        clone.value = source.value;
        clone.setAttribute('value', source.value);
      }
      clone.checked = source.checked;
      if (source.checked) clone.setAttribute('checked', '');
      else clone.removeAttribute('checked');
    } else if (source instanceof HTMLTextAreaElement) {
      clone.value = source.value;
      clone.textContent = source.value;
    } else if (source instanceof HTMLSelectElement) {
      [...clone.options].forEach((option, index) => {
        option.selected = Boolean(source.options[index]?.selected);
        if (option.selected) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      });
    } else if (source instanceof HTMLDetailsElement) {
      clone.open = source.open;
      if (source.open) clone.setAttribute('open', '');
      else clone.removeAttribute('open');
    }

    if (source.scrollTop || source.scrollLeft) {
      clone.setAttribute('data-youmi-scroll-top', String(source.scrollTop));
      clone.setAttribute('data-youmi-scroll-left', String(source.scrollLeft));
    }

    if (source instanceof HTMLMediaElement) {
      clone.setAttribute('data-youmi-current-time', String(source.currentTime || 0));
      if (source.muted) clone.setAttribute('muted', '');
      if (source.paused) clone.removeAttribute('autoplay');
    }
  }

  function canvasImage(source, clone) {
    if (!(source instanceof HTMLCanvasElement)) return clone;
    try {
      const image = document.createElement('img');
      for (const attribute of clone.attributes) image.setAttribute(attribute.name, attribute.value);
      image.src = source.toDataURL('image/png');
      image.alt = source.getAttribute('aria-label') || 'Canvas snapshot';
      image.width = source.width;
      image.height = source.height;
      clone.replaceWith(image);
      return image;
    } catch {
      clone.setAttribute('data-youmi-canvas-unavailable', 'true');
      return clone;
    }
  }

  function stripExecutableContent(root) {
    root.querySelectorAll('script,noscript').forEach((node) => node.remove());
    root.querySelectorAll('meta[http-equiv]').forEach((node) => {
      const value = (node.getAttribute('http-equiv') || '').toLowerCase();
      if (['content-security-policy', 'refresh', 'set-cookie'].includes(value)) node.remove();
    });
    root.querySelectorAll('*').forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      });
    });
  }

  function collectStyleSheets() {
    return [...document.styleSheets].map((sheet) => {
      const record = {
        href: sheet.href || null,
        media: sheet.media?.mediaText || '',
        disabled: Boolean(sheet.disabled),
        rules: [],
        readable: true,
      };
      try {
        record.rules = [...sheet.cssRules].map((rule) => rule.cssText);
      } catch (error) {
        record.readable = false;
        record.error = String(error?.message || error);
      }
      return record;
    });
  }

  async function collectSnapshot(options = {}) {
    if (window.top !== window) return { ok: false, error: 'Only the top frame can create a page snapshot.' };
    if (!document.documentElement) return { ok: false, error: 'The page DOM is not ready.' };

    const startedAt = performance.now();
    const cloneRoot = document.documentElement.cloneNode(true);
    const computedRules = [];
    const nodes = [];
    const resources = new Map();
    const warnings = [];
    const removals = [];
    let elementId = 0;
    let styledElements = 0;
    let shadowRootCount = 0;

    function addResource(rawUrl, type = 'resource', source = '') {
      const url = absoluteUrl(rawUrl);
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
      const existing = resources.get(url) || { url, types: [], sources: [] };
      if (!existing.types.includes(type)) existing.types.push(type);
      if (source && !existing.sources.includes(source) && existing.sources.length < 12) existing.sources.push(source);
      resources.set(url, existing);
    }

    function processElement(source, initialClone) {
      if (!source || !initialClone || source.nodeType !== Node.ELEMENT_NODE) return;
      let clone = initialClone;
      elementId += 1;
      const id = elementId;

      if (isExtensionNode(source)) removals.push(clone);
      applyRuntimeState(source, clone);
      clone.setAttribute('data-youmi-snapshot-id', String(id));
      clone = canvasImage(source, clone);

      const computed = safeComputedStyle(source);
      if (computed && styledElements < MAX_STYLED_ELEMENTS) {
        styledElements += 1;
        const declarations = declarationsFor(computed);
        if (declarations) computedRules.push(`[data-youmi-snapshot-id="${id}"]{${declarations}}`);
        const before = pseudoRule(id, source, '::before', addResource);
        const after = pseudoRule(id, source, '::after', addResource);
        const marker = pseudoRule(id, source, '::marker', addResource);
        if (before) computedRules.push(before);
        if (after) computedRules.push(after);
        if (marker) computedRules.push(marker);
        collectCssValueUrls(computed.getPropertyValue('background-image'), addResource, `node:${id}`);
        collectCssValueUrls(computed.getPropertyValue('mask-image'), addResource, `node:${id}`);
        collectCssValueUrls(computed.getPropertyValue('list-style-image'), addResource, `node:${id}`);
      }

      const tag = source.tagName.toLowerCase();
      const attributeResources = [
        ['src', source.currentSrc || source.getAttribute('src')],
        ['href', source.getAttribute('href')],
        ['poster', source.getAttribute('poster')],
        ['data', source.getAttribute('data')],
      ];
      attributeResources.forEach(([attribute, value]) => {
        if (value) addResource(value, `${tag}:${attribute}`, `node:${id}`);
      });
      const srcset = source.getAttribute('srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => addResource(part.trim().split(/\s+/)[0], `${tag}:srcset`, `node:${id}`));
      }

      nodes.push({
        id,
        tag,
        selector: selectorFor(source),
        text: elementText(source),
        rect: rectFor(source),
        visible: Boolean(computed && computed.display !== 'none' && computed.visibility !== 'hidden' && source.getClientRects().length),
        role: source.getAttribute('role') || null,
        ariaLabel: source.getAttribute('aria-label') || null,
        className: clip(source.className ? String(source.className) : '', 1000),
      });

      const sourceChildren = [...source.childNodes];
      const cloneChildren = [...clone.childNodes];
      sourceChildren.forEach((sourceChild, index) => {
        if (sourceChild.nodeType === Node.ELEMENT_NODE && cloneChildren[index]?.nodeType === Node.ELEMENT_NODE) {
          processElement(sourceChild, cloneChildren[index]);
        }
      });

      if (source.shadowRoot) {
        shadowRootCount += 1;
        const template = document.createElement('template');
        template.setAttribute('data-youmi-shadowroot', source.shadowRoot.mode || 'open');
        const sourceShadowChildren = [...source.shadowRoot.childNodes];
        sourceShadowChildren.forEach((child) => template.content.appendChild(child.cloneNode(true)));
        clone.appendChild(template);
        const cloneShadowChildren = [...template.content.childNodes];
        sourceShadowChildren.forEach((sourceChild, index) => {
          if (sourceChild.nodeType === Node.ELEMENT_NODE && cloneShadowChildren[index]?.nodeType === Node.ELEMENT_NODE) {
            processElement(sourceChild, cloneShadowChildren[index]);
          }
        });
      }
    }

    processElement(document.documentElement, cloneRoot);
    removals.forEach((node) => node.remove());
    stripExecutableContent(cloneRoot);

    if (elementId > MAX_STYLED_ELEMENTS) {
      warnings.push(`页面包含 ${elementId} 个元素，仅为前 ${MAX_STYLED_ELEMENTS} 个元素固化了计算样式。`);
    }

    performance.getEntriesByType('resource').forEach((entry) => {
      addResource(entry.name, entry.initiatorType || 'performance-resource', 'performance');
    });

    const styleSheets = collectStyleSheets();
    styleSheets.forEach((sheet, index) => {
      if (sheet.href) addResource(sheet.href, 'stylesheet', `stylesheet:${index}`);
    });

    const head = cloneRoot.querySelector('head') || cloneRoot.insertBefore(document.createElement('head'), cloneRoot.firstChild);
    head.querySelectorAll('base').forEach((node) => node.remove());
    const charset = document.createElement('meta');
    charset.setAttribute('charset', 'UTF-8');
    head.prepend(charset);
    const base = document.createElement('base');
    base.href = document.baseURI;
    head.insertBefore(base, charset.nextSibling);

    const snapshotStyle = document.createElement('style');
    snapshotStyle.id = 'youmi-snapshot-computed-styles';
    snapshotStyle.textContent = `
      *,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}
      [data-youmi-redacted="password"]{background-image:repeating-linear-gradient(135deg,rgba(127,127,127,.12) 0 4px,transparent 4px 8px) !important}
      ${computedRules.join('\n').replace(/<\/style/gi, '<\\/style')}
    `;
    head.appendChild(snapshotStyle);

    const restoreScript = document.createElement('script');
    restoreScript.textContent = `
      (()=>{
        document.querySelectorAll('template[data-youmi-shadowroot]').forEach((template)=>{
          const host=template.parentElement;
          if(!host||host.shadowRoot)return;
          try{host.attachShadow({mode:'open'}).appendChild(template.content.cloneNode(true));template.remove();}catch{}
        });
        document.querySelectorAll('[data-youmi-scroll-top],[data-youmi-scroll-left]').forEach((node)=>{
          node.scrollTop=Number(node.dataset.youmiScrollTop||0);
          node.scrollLeft=Number(node.dataset.youmiScrollLeft||0);
        });
        scrollTo(${Math.round(scrollX)},${Math.round(scrollY)});
      })();
    `;
    (cloneRoot.querySelector('body') || cloneRoot).appendChild(restoreScript);

    const html = `${doctypeText()}\n${cloneRoot.outerHTML}`;
    const captureDurationMs = Math.round(performance.now() - startedAt);
    const viewport = {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX,
      scrollY,
      documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      documentHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    };

    return {
      ok: true,
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        capturedAt: now(),
        generator: {
          name: 'Youmi Site Structure Recorder',
          version: chrome.runtime.getManifest().version,
        },
        page: {
          url: location.href,
          baseUrl: document.baseURI,
          origin: location.origin,
          title: document.title,
          language: document.documentElement.lang || navigator.language || '',
          characterSet: document.characterSet,
          referrer: document.referrer,
          viewport,
          userAgent: navigator.userAgent,
          colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        },
        summary: {
          elementCount: elementId,
          styledElementCount: styledElements,
          shadowRootCount,
          resourceCount: resources.size,
          styleSheetCount: styleSheets.length,
          captureDurationMs,
        },
        options: {
          includeScreenshot: options.includeScreenshot !== false,
          includeRecentEvents: options.includeRecentEvents !== false,
        },
        warnings,
        nodes,
        resources: [...resources.values()],
        styleSheets,
        document: {
          doctype: doctypeText(),
          html,
        },
      },
    };
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function zipDate(date) {
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function bytesFor(value) {
    if (value instanceof Uint8Array) return value;
    return new TextEncoder().encode(String(value));
  }

  function createZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const timestamp = zipDate(new Date());

    files.forEach((file) => {
      const name = new TextEncoder().encode(file.name);
      const data = bytesFor(file.data);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write16(localView, 8, 0);
      write16(localView, 10, timestamp.time);
      write16(localView, 12, timestamp.date);
      write32(localView, 14, crc);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      write16(localView, 28, 0);
      local.set(name, 30);
      chunks.push(local, data);

      const header = new Uint8Array(46 + name.length);
      const headerView = new DataView(header.buffer);
      write32(headerView, 0, 0x02014b50);
      write16(headerView, 4, 20);
      write16(headerView, 6, 20);
      write16(headerView, 8, 0x0800);
      write16(headerView, 10, 0);
      write16(headerView, 12, timestamp.time);
      write16(headerView, 14, timestamp.date);
      write32(headerView, 16, crc);
      write32(headerView, 20, data.length);
      write32(headerView, 24, data.length);
      write16(headerView, 28, name.length);
      write16(headerView, 30, 0);
      write16(headerView, 32, 0);
      write16(headerView, 34, 0);
      write16(headerView, 36, 0);
      write32(headerView, 38, 0);
      write32(headerView, 42, offset);
      header.set(name, 46);
      central.push(header);
      offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, value) => sum + value.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, files.length);
    write16(endView, 10, files.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, offset);
    write16(endView, 20, 0);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  function base64Bytes(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function safeFilePart(value) {
    return String(value || 'page')
      .replace(/^www\./i, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'page';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadSnapshot(payload) {
    const snapshot = payload.snapshot;
    const files = [
      { name: 'snapshot.json', data: JSON.stringify(snapshot, null, 2) },
      { name: 'page.html', data: snapshot.document.html },
      {
        name: 'README.txt',
        data: [
          'Youmi 网页完整快照',
          '',
          'page.html      可直接打开的静态页面预览。',
          'snapshot.json  DOM、计算样式、元素坐标、资源清单、样式表和操作记录。',
          'screenshot.png 捕获时的页面截图（存在截图权限时为完整页面）。',
          '',
          `原始地址：${snapshot.page.url}`,
          `捕获时间：${snapshot.capturedAt}`,
          '',
          '注意：登录态、服务端数据、复杂脚本行为和跨域 iframe 不会在离线预览中执行；',
          '它们的地址与结构会保留在 snapshot.json 中，供网页复刻时分析。',
        ].join('\r\n'),
      },
    ];
    if (payload.screenshotBase64) files.push({ name: 'screenshot.png', data: base64Bytes(payload.screenshotBase64) });
    const zip = createZip(files);
    const timestamp = snapshot.capturedAt.replace(/[:.]/g, '-');
    const host = safeFilePart(new URL(snapshot.page.url).hostname);
    const filename = `youmi-snapshot-${host}-${timestamp}.zip`;
    downloadBlob(zip, filename);
    return { ok: true, filename, size: zip.size };
  }

  globalThis.YoumiSnapshot = Object.freeze({
    collectSnapshot,
    createZip,
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (window.top !== window) return false;
    if (message?.type === 'youmi:snapshot:collect') {
      collectSnapshot(message.options || {})
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (message?.type === 'youmi:snapshot:download') {
      downloadSnapshot(message.payload)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    return false;
  });
})();

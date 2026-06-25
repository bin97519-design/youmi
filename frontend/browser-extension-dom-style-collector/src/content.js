const STYLE_PROPS = [
  'display',
  'position',
  'inset',
  'top',
  'right',
  'bottom',
  'left',
  'zIndex',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'padding',
  'boxSizing',
  'overflow',
  'overflowX',
  'overflowY',
  'opacity',
  'transform',
  'transition',
  'animation',
  'flexDirection',
  'justifyContent',
  'alignItems',
  'gap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'whiteSpace',
  'color',
  'background',
  'backgroundColor',
  'backgroundImage',
  'border',
  'borderRadius',
  'boxShadow',
  'filter',
  'backdropFilter',
  'objectFit',
  'objectPosition',
  'cursor',
];

const DEFAULT_TARGETS = [
  'body',
  '#root',
  'aside',
  'aside.workbench-global-nav',
  '.workbench-global-nav',
  '.sidebar-nav-item',
  '.sidebar-nav-item--designer',
  '#workbench-home-dialog-slot',
  '.chat-panel-wrap',
  '.reference-panel.home-dialog',
  '.home-dialog',
  '[role="dialog"]',
];

function round(value) {
  return Math.round(value * 100) / 100;
}

function rectOf(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    left: round(rect.left),
  };
}

function stylesOf(element) {
  const computed = window.getComputedStyle(element);
  return Object.fromEntries(STYLE_PROPS.map((prop) => [prop, computed[prop]]));
}

function textOf(element, includeText) {
  if (!includeText) return '';
  const text = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join(' ');
  return text.slice(0, 160);
}

function attrsOf(element) {
  const allow = ['id', 'class', 'role', 'aria-label', 'aria-expanded', 'href', 'src', 'alt', 'title', 'type'];
  return Object.fromEntries(
    allow
      .filter((name) => element.hasAttribute(name))
      .map((name) => [name, element.getAttribute(name)])
  );
}

function selectorOf(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const classes = Array.from(element.classList || []).slice(0, 4).map((item) => `.${CSS.escape(item)}`).join('');
  const tag = element.tagName.toLowerCase();
  return `${tag}${classes}`;
}

function nodeOf(element, options, depth = 0, state = { count: 0 }) {
  if (!element || state.count > 900 || depth > 8) return null;
  state.count += 1;

  const children = Array.from(element.children)
    .slice(0, 24)
    .map((child) => nodeOf(child, options, depth + 1, state))
    .filter(Boolean);

  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorOf(element),
    attrs: attrsOf(element),
    text: textOf(element, options.includeText),
    rect: rectOf(element),
    style: stylesOf(element),
    children,
  };
}

function collectTargets(options) {
  const selectors = [...DEFAULT_TARGETS, ...(options.extraSelectors || [])];
  const seen = new Set();
  const targets = [];

  for (const selector of selectors) {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      targets.push({ selector, error: 'Invalid selector' });
      continue;
    }

    nodes.slice(0, 30).forEach((element, index) => {
      const key = `${selector}:${index}:${element.tagName}:${element.className}:${element.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      targets.push({
        query: selector,
        index,
        tag: element.tagName.toLowerCase(),
        attrs: attrsOf(element),
        text: (element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 260),
        rect: rectOf(element),
        style: stylesOf(element),
        childCount: element.children.length,
        outerHTMLPreview: element.outerHTML.slice(0, 900),
      });
    });
  }

  return targets;
}

function collectAssets() {
  const images = Array.from(document.images).map((image) => ({
    src: image.currentSrc || image.src,
    alt: image.alt,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    rect: rectOf(image),
  }));

  const stylesheets = Array.from(document.styleSheets).map((sheet) => ({
    href: sheet.href,
    disabled: sheet.disabled,
  }));

  const fonts = document.fonts
    ? Array.from(document.fonts).map((font) => ({
        family: font.family,
        style: font.style,
        weight: font.weight,
        status: font.status,
      }))
    : [];

  const svgs = Array.from(document.querySelectorAll('svg')).slice(0, 80).map((svg) => ({
    attrs: attrsOf(svg),
    rect: rectOf(svg),
    outerHTMLPreview: svg.outerHTML.slice(0, 1200),
  }));

  return { images, stylesheets, fonts, svgs };
}

function collectSnapshot(options = {}) {
  const tree = options.includeTree ? nodeOf(document.body, options) : null;
  const targets = collectTargets(options);
  const assets = options.includeAssets ? collectAssets() : null;

  return {
    capturedAt: new Date().toISOString(),
    page: {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: round(window.scrollX),
      scrollY: round(window.scrollY),
    },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    summary: {
      treeNodes: tree ? countTree(tree) : 0,
      targets: targets.length,
      assets: assets ? assets.images.length + assets.stylesheets.length + assets.fonts.length + assets.svgs.length : 0,
    },
    targets,
    tree,
    assets,
  };
}

function countTree(node) {
  if (!node) return 0;
  return 1 + (node.children || []).reduce((sum, child) => sum + countTree(child), 0);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'dom-style-collector:collect') return false;
  sendResponse(collectSnapshot(message.options || {}));
  return true;
});

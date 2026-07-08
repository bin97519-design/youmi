/*
 * Run this script in the browser console on a Tmall detail page.
 * It slowly scrolls like a real visitor, then extracts image URLs only from:
 *   div.descV8-container
 */
(async () => {
  const options = {
    selector: 'div.descV8-container',
    maxSteps: 80,
    minPauseMs: 120,
    maxPauseMs: 360,
    longPauseEvery: 8,
    longPauseMinMs: 500,
    longPauseMaxMs: 1000,
    minScrollPx: 1300,
    maxScrollPx: 3400,
    settleMs: 700,
    copyToClipboard: true,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  const normalizeImageUrl = (raw) => {
    if (!raw) return null;

    let url = String(raw).trim();
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;

    url = url
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/\\\//g, '/');

    if (url.startsWith('//')) url = `${window.location.protocol}${url}`;

    try {
      url = new URL(url, window.location.href).href;
    } catch {
      return null;
    }

    url = url.replace(/#.*/, '');
    return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) ? url : null;
  };

  const addUrl = (set, raw) => {
    const url = normalizeImageUrl(raw);
    if (url) set.add(url);
  };

  const extractDescV8Images = () => {
    const container = document.querySelector(options.selector);
    const urls = new Set();

    if (!container) {
      return {
        pageUrl: window.location.href,
        title: document.title,
        selector: options.selector,
        foundContainer: false,
        imageUrls: [],
      };
    }

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
      ].forEach((attr) => addUrl(urls, el.getAttribute(attr)));

      const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
      if (srcset) {
        srcset.split(',').forEach((part) => {
          addUrl(urls, part.trim().split(/\s+/)[0]);
        });
      }
    });

    container.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') || '';
      for (const match of style.matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
        addUrl(urls, match[2]);
      }
    });

    const html = container.outerHTML
      .replace(/\\\//g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');

    for (const match of html.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s"'<>\\]*)?/gi)) {
      addUrl(urls, match[0]);
    }

    return {
      pageUrl: window.location.href,
      title: document.title,
      selector: options.selector,
      foundContainer: true,
      imageNodeCount: container.querySelectorAll('img, source').length,
      imageUrls: Array.from(urls),
    };
  };

  const waitForDescContainer = async (timeoutMs = 20000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const container = document.querySelector(options.selector);
      if (container) return container;
      await sleep(500);
    }
    return null;
  };

  const humanLikeScroll = async () => {
    const startY = window.scrollY;
    let lastY = -1;
    let stableSteps = 0;
    const container = document.querySelector(options.selector);

    if (container) {
      container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      await sleep(rand(500, 900));
    }

    for (let step = 1; step <= options.maxSteps; step += 1) {
      const x = rand(Math.round(window.innerWidth * 0.35), Math.round(window.innerWidth * 0.8));
      const y = rand(Math.round(window.innerHeight * 0.32), Math.round(window.innerHeight * 0.78));

      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        clientX: x,
        clientY: y,
      }));

      const delta = rand(options.minScrollPx, options.maxScrollPx);
      window.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaMode: 0,
        deltaY: delta,
      }));
      document.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaMode: 0,
        deltaY: delta,
      }));
      window.scrollBy({ top: delta, left: rand(-6, 6), behavior: 'smooth' });

      await sleep(rand(options.minPauseMs, options.maxPauseMs));

      if (step % options.longPauseEvery === 0) {
        await sleep(rand(options.longPauseMinMs, options.longPauseMaxMs));
      }

      const currentY = Math.round(window.scrollY);
      if (Math.abs(currentY - lastY) < 12) {
        stableSteps += 1;
      } else {
        stableSteps = 0;
      }
      lastY = currentY;

      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
      if (nearBottom || stableSteps >= 4) break;
    }

    await sleep(options.settleMs);
    return {
      startY,
      endY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
    };
  };

  console.info('[tmall-descv8] Start slow scrolling...');
  await waitForDescContainer();
  const scrollInfo = await humanLikeScroll();
  const result = extractDescV8Images();
  const text = result.imageUrls.join('\n');

  window.__tmallDescV8Images = result;

  if (options.copyToClipboard && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      result.copiedToClipboard = true;
    } catch {
      result.copiedToClipboard = false;
    }
  }

  console.info('[tmall-descv8] Scroll info:', scrollInfo);
  console.info(`[tmall-descv8] Extracted ${result.imageUrls.length} images from ${options.selector}`);
  console.table(result.imageUrls.map((url, index) => ({ index: index + 1, url })));
  console.log(JSON.stringify(result, null, 2));

  return result;
})();

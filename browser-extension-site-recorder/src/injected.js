(function installRecorderHooks() {
  if (window.__YOUmiRecorderInstalled) return;
  window.__YOUmiRecorderInstalled = true;

  const EVENT = '__YOUmi_SITE_RECORDER__';
  const MAX_BODY = 4000;

  function clip(text, limit = MAX_BODY) {
    if (typeof text !== 'string') return text;
    return text.length > limit ? `${text.slice(0, limit)}...<trimmed ${text.length - limit}>` : text;
  }

  function emit(kind, detail) {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { kind, detail } }));
  }

  function headersToObject(headers) {
    const out = {};
    try {
      headers?.forEach?.((value, key) => {
        out[key] = value;
      });
    } catch {}
    return out;
  }

  function bodySummary(body) {
    if (!body) return undefined;
    if (body instanceof FormData) {
      const fields = [];
      for (const [key, value] of body.entries()) {
        if (value instanceof File) {
          fields.push({ key, file: { name: value.name, type: value.type, size: value.size } });
        } else {
          fields.push({ key, value: clip(String(value), 500) });
        }
      }
      return { type: 'FormData', fields };
    }
    if (body instanceof URLSearchParams) {
      return { type: 'URLSearchParams', value: clip(body.toString(), 1000) };
    }
    if (typeof body === 'string') {
      return { type: 'string', value: clip(body, 1000) };
    }
    if (body instanceof Blob) {
      return { type: body.constructor.name, size: body.size, mime: body.type };
    }
    return { type: body?.constructor?.name || typeof body };
  }

  function isTargetApi(url) {
    try {
      return new URL(url, location.href).host === 'api.youqianai.com';
    } catch {
      return false;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function recordedFetch(input, init = {}) {
    const startedAt = performance.now();
    const url = typeof input === 'string' ? input : input?.url;
    const method = init?.method || (typeof input !== 'string' && input?.method) || 'GET';
    emit('network:fetch:request', {
      url,
      method,
      isTargetApi: isTargetApi(url),
      headers: init?.headers || {},
      body: bodySummary(init?.body),
    });

    try {
      const response = await originalFetch.apply(this, arguments);
      const clone = response.clone();
      const contentType = response.headers.get('content-type') || '';
      let bodyPreview = '';
      if (contentType.includes('json') || contentType.includes('text') || contentType.includes('html')) {
        bodyPreview = clip(await clone.text());
      }
      emit('network:fetch:response', {
        url: response.url || url,
        method,
        isTargetApi: isTargetApi(response.url || url),
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - startedAt),
        contentType,
        headers: headersToObject(response.headers),
        bodyPreview,
      });
      return response;
    } catch (error) {
      emit('network:fetch:error', {
        url,
        method,
        isTargetApi: isTargetApi(url),
        durationMs: Math.round(performance.now() - startedAt),
        error: String(error),
      });
      throw error;
    }
  };

  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function RecordedXHR() {
    const xhr = new OriginalXHR();
    const meta = { method: 'GET', url: '', startedAt: 0 };
    const originalOpen = xhr.open;
    const originalSend = xhr.send;

    xhr.open = function open(method, url) {
      meta.method = method;
      meta.url = url;
      return originalOpen.apply(xhr, arguments);
    };

    xhr.send = function send(body) {
      meta.startedAt = performance.now();
      emit('network:xhr:request', {
        url: meta.url,
        method: meta.method,
        isTargetApi: isTargetApi(meta.url),
        body: bodySummary(body),
      });
      xhr.addEventListener('loadend', () => {
        emit('network:xhr:response', {
          url: meta.url,
          method: meta.method,
          isTargetApi: isTargetApi(meta.url),
          status: xhr.status,
          durationMs: Math.round(performance.now() - meta.startedAt),
          responseType: xhr.responseType || 'text',
          responsePreview: xhr.responseType === '' || xhr.responseType === 'text' ? clip(xhr.responseText || '') : `<${xhr.responseType}>`,
        });
      });
      return originalSend.apply(xhr, arguments);
    };

    return xhr;
  };

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!['img', 'script', 'css', 'fetch', 'xmlhttprequest'].includes(entry.initiatorType)) continue;
      emit('resource:load', {
        name: entry.name,
        initiatorType: entry.initiatorType,
        durationMs: Math.round(entry.duration),
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
      });
    }
  });
  try {
    observer.observe({ type: 'resource', buffered: true });
  } catch {}

  window.addEventListener('error', (event) => {
    emit('runtime:error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    emit('runtime:unhandledrejection', {
      reason: String(event.reason),
    });
  });

  emit('recorder:installed', {
    url: location.href,
    userAgent: navigator.userAgent,
  });
})();

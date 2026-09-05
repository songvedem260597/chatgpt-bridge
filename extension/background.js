const DEFAULT_BASE = 'http://127.0.0.1:5000';

async function getSettings() {
  const data = await chrome.storage.local.get({
    backendUrl: DEFAULT_BASE,
    enabled: true,
    autoExecute: true,
  });
  return data;
}

async function callLocal(path, options = {}) {
  const settings = await getSettings();
  const base = String(settings.backendUrl || DEFAULT_BASE).replace(/\/$/, '');
  const res = await fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }
  if (!res.ok) {
    const message = body?.detail || body?.error || `HTTP ${res.status}`;
    throw new Error(String(message));
  }
  return body;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'bridge:status') {
    callLocal('/local/status')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'bridge:execute') {
    getSettings().then((settings) => {
      if (!settings.enabled) throw new Error('bridge is disabled');
      return callLocal('/local/execute', {
        method: 'POST',
        body: JSON.stringify(message.request || {}),
      });
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'bridge:get-settings') {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message.type === 'bridge:set-settings') {
    chrome.storage.local.set(message.settings || {})
      .then(() => getSettings())
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

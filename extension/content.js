const TOOL_BLOCK_RE = /```local_tool\s*([\s\S]*?)```/gi;
const seenBlocks = new Set();
let scanning = false;

function getEditor() {
  return document.querySelector('div[contenteditable="true"][role="textbox"]')
    || document.querySelector('textarea[name="prompt-textarea"]')
    || document.querySelector('#prosemirror-editor-container [contenteditable]');
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(h >>> 0);
}

async function sendToComposer(text) {
  const editor = getEditor();
  if (!editor) throw new Error('ChatGPT composer not found');
  editor.focus();
  if (editor.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    editor.innerHTML = '';
    document.execCommand('insertText', false, text);
  }
  await new Promise(r => setTimeout(r, 250));
  const send = document.querySelector('button[data-testid="send-button"]')
    || document.querySelector('form button[type="submit"]');
  if (send && !send.disabled) send.click();
  else editor.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
    bubbles: true, cancelable: true,
  }));
}

function formatResult(request, response) {
  return '[LOCAL_RESULT]\n' + JSON.stringify({ request, response }, null, 2);
}

async function executeBlock(raw) {
  let request;
  try { request = JSON.parse(raw); }
  catch (e) {
    await sendToComposer('[LOCAL_RESULT]\n' + JSON.stringify({ ok: false, error: 'Invalid local_tool JSON: ' + e.message }, null, 2));
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: 'bridge:execute', request });
  await sendToComposer(formatResult(request, response));
}

async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const settingsResp = await chrome.runtime.sendMessage({ type: 'bridge:get-settings' });
    if (!settingsResp?.settings?.enabled || !settingsResp?.settings?.autoExecute) return;
    const messages = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    for (const msg of messages.slice(-4)) {
      const text = msg.innerText || '';
      TOOL_BLOCK_RE.lastIndex = 0;
      let match;
      while ((match = TOOL_BLOCK_RE.exec(text))) {
        const raw = match[1].trim();
        const id = hash(location.href + '\n' + raw);
        if (seenBlocks.has(id)) continue;
        seenBlocks.add(id);
        await executeBlock(raw);
      }
    }
  } finally {
    scanning = false;
  }
}

const badge = document.createElement('button');
badge.textContent = 'Local Bridge';
badge.title = 'ChatGPT Local Bridge';
badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;border:0;border-radius:999px;padding:7px 10px;background:#16a34a;color:white;font:12px system-ui;opacity:.85;cursor:pointer';
badge.onclick = async () => {
  const r = await chrome.runtime.sendMessage({ type: 'bridge:status' });
  badge.textContent = r?.ok ? 'Bridge ready' : 'Bridge offline';
  badge.style.background = r?.ok ? '#16a34a' : '#dc2626';
  setTimeout(() => badge.textContent = 'Local Bridge', 1800);
};
document.documentElement.appendChild(badge);

const observer = new MutationObserver(() => { void scan(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(() => { void scan(); }, 1500);
void scan();

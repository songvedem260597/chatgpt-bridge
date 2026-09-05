const TOOL_MARKER_RE = /\[\[LOCAL_TOOL\]\]\s*([\s\S]*?)\s*\[\[\/LOCAL_TOOL\]\]/gi;
const LEGACY_TOOL_BLOCK_RE = /```local_tool\s*([\s\S]*?)```/gi;
const SEEN_KEY = 'chatgpt-local-bridge-seen-v2';
const MAX_RESULT_MESSAGE_CHARS = 24000;
const STABLE_TURN_MS = 750;

let scanning = false;
let candidateKey = '';
let candidateSince = 0;
const seenBlocks = new Set(loadSeen());

function loadSeen() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(value) ? value.slice(-200) : [];
  } catch {
    return [];
  }
}

function rememberSeen(id) {
  seenBlocks.add(id);
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenBlocks].slice(-200)));
  } catch {}
}

function getEditor() {
  return document.querySelector('div[contenteditable="true"][role="textbox"]')
    || document.querySelector('textarea[name="prompt-textarea"]')
    || document.querySelector('#prosemirror-editor-container [contenteditable]');
}

function composerRoot(editor) {
  return editor?.closest('form')
    || editor?.closest('[data-testid="composer"]')
    || editor?.parentElement
    || document.body;
}

function hasPendingAttachment(editor) {
  const root = composerRoot(editor);
  const selectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="file-thumbnail"]',
    '[data-testid*="file-chip"]',
    'button[aria-label^="Remove file"]',
    'button[aria-label^="remove file"]',
    'button[aria-label*="Remove attachment"]',
    'button[aria-label*="remove attachment"]'
  ];
  return selectors.some((selector) => {
    try {
      return !!root.querySelector(selector);
    } catch {
      return false;
    }
  });
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(h >>> 0);
}

function isGenerating() {
  const stopSelectors = [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label*="Stop streaming"]',
    'button[aria-label="Stop answering"]',
  ];
  if (stopSelectors.some((selector) => document.querySelector(selector))) return true;

  const submit = document.querySelector('#composer-submit-button');
  const submitLabel = `${submit?.getAttribute?.('aria-label') || ''} ${submit?.textContent || ''}`;
  return Boolean(submit && /\bstop\b/i.test(submitLabel));
}

function latestAssistantTurn() {
  const turns = [...document.querySelectorAll('[data-message-author-role]')];
  const latest = turns[turns.length - 1];
  return latest?.getAttribute?.('data-message-author-role') === 'assistant' ? latest : null;
}

function messageIdentity(message, text) {
  const explicitId = message?.getAttribute?.('data-message-id')
    || message?.closest?.('[data-message-id]')?.getAttribute?.('data-message-id')
    || message?.id
    || '';
  return explicitId ? `message:${explicitId}` : `content:${hash(text)}`;
}

function toolBlockId(message, text, raw) {
  return hash(`${location.pathname}\n${messageIdentity(message, text)}\n${raw}`);
}

function resetCandidate() {
  candidateKey = '';
  candidateSince = 0;
}

function clipMessage(text) {
  if (text.length <= MAX_RESULT_MESSAGE_CHARS) return text;
  const keep = Math.floor((MAX_RESULT_MESSAGE_CHARS - 120) / 2);
  return text.slice(0, keep)
    + '\n...[LOCAL_RESULT truncated before sending to ChatGPT; no file was uploaded]...\n'
    + text.slice(-keep);
}

async function sendToComposer(text) {
  const editor = getEditor();
  if (!editor) throw new Error('ChatGPT composer not found');

  // Strict plain-text mode: never submit while a file/image attachment is pending.
  // This extension never creates File/DataTransfer objects and never uploads attachments.
  if (hasPendingAttachment(editor)) {
    throw new Error('Composer has a pending attachment; refusing auto-send in plain-text mode');
  }

  const safeText = clipMessage(String(text));
  editor.focus();

  if (editor.tagName === 'TEXTAREA') {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    descriptor?.set?.call(editor, safeText);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    editor.innerHTML = '';
    document.execCommand('insertText', false, safeText);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: safeText,
    }));
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  const send = document.querySelector('button[data-testid="send-button"]')
    || document.querySelector('form button[type="submit"]');

  if (send && !send.disabled) {
    send.click();
  } else {
    editor.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
  }
}

function formatResult(request, response) {
  return '[LOCAL_RESULT]\n' + JSON.stringify({ request, response }, null, 2);
}

async function executeBlock(raw) {
  let request;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    await sendToComposer('[LOCAL_RESULT]\n' + JSON.stringify({
      ok: false,
      error: 'Invalid LOCAL_TOOL JSON: ' + error.message,
    }, null, 2));
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'bridge:execute',
    request,
  });

  await sendToComposer(formatResult(request, response));
}

function collectToolBlocks(text) {
  const blocks = [];
  for (const regex of [TOOL_MARKER_RE, LEGACY_TOOL_BLOCK_RE]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text))) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}

function primeExistingLatestTurn() {
  // Loading/reloading the extension must never execute tool blocks that were already
  // sitting in conversation history. If a response is actively streaming we leave it
  // unprimed so a newly completed tool block can still execute once.
  if (isGenerating()) return;
  const message = latestAssistantTurn();
  if (!message) return;
  const text = message.innerText || '';
  for (const raw of collectToolBlocks(text)) {
    rememberSeen(toolBlockId(message, text, raw));
  }
}

async function scan() {
  if (scanning) return;
  scanning = true;

  try {
    const settingsResp = await chrome.runtime.sendMessage({ type: 'bridge:get-settings' });
    if (!settingsResp?.settings?.enabled || !settingsResp?.settings?.autoExecute) return;
    if (isGenerating()) {
      resetCandidate();
      return;
    }

    // Only the newest conversation turn is eligible, and it must be an assistant turn.
    // This prevents old tool examples or completed requests from replaying when ChatGPT
    // virtualizes/reorders DOM nodes or while a newer user result is already pending.
    const message = latestAssistantTurn();
    if (!message) {
      resetCandidate();
      return;
    }

    const text = message.innerText || '';
    const blocks = collectToolBlocks(text);
    if (!blocks.length) {
      resetCandidate();
      return;
    }

    // One assistant turn produces at most one automatic result message. If the model
    // includes examples plus a real request, the final LOCAL_TOOL block is the request
    // closest to the end of the response.
    const raw = blocks[blocks.length - 1];
    const id = toolBlockId(message, text, raw);
    if (seenBlocks.has(id)) {
      resetCandidate();
      return;
    }

    // ChatGPT can remove the stop button slightly before the final DOM paint. Require
    // the same latest-turn content to remain unchanged briefly before executing it.
    const nextCandidateKey = `${messageIdentity(message, text)}:${hash(text)}:${hash(raw)}`;
    if (candidateKey !== nextCandidateKey) {
      candidateKey = nextCandidateKey;
      candidateSince = Date.now();
      return;
    }
    if (Date.now() - candidateSince < STABLE_TURN_MS) return;

    rememberSeen(id);
    resetCandidate();
    try {
      await executeBlock(raw);
    } catch (error) {
      console.error('[ChatGPT Local Bridge] tool execution failed:', error);
      setBadge('Bridge error', '#dc2626');
    }
  } finally {
    scanning = false;
  }
}

const badge = document.createElement('button');
badge.textContent = 'Local Bridge';
badge.title = 'ChatGPT Local Bridge — plain-text transport only';
badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:999999;border:0;border-radius:999px;padding:7px 10px;background:#16a34a;color:white;font:12px system-ui;opacity:.85;cursor:pointer';

function setBadge(text, color = '#16a34a') {
  badge.textContent = text;
  badge.style.background = color;
}

badge.onclick = async () => {
  const response = await chrome.runtime.sendMessage({ type: 'bridge:status' });
  setBadge(response?.ok ? 'Bridge ready' : 'Bridge offline', response?.ok ? '#16a34a' : '#dc2626');
  setTimeout(() => setBadge('Local Bridge'), 1800);
};

document.documentElement.appendChild(badge);

primeExistingLatestTurn();
const observer = new MutationObserver(() => { void scan(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(() => { void scan(); }, 1500);
void scan();

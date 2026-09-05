import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

const storage = new Map();
const executed = [];
const sent = [];
let turns = [];
let generating = false;
let focusedEditor = null;

function makeTurn(role, id, text) {
  return {
    id: '',
    innerText: text,
    getAttribute(name) {
      if (name === 'data-message-author-role') return role;
      if (name === 'data-message-id') return id;
      return null;
    },
    closest() { return null; },
  };
}

const editorRoot = { querySelector: () => null };
const editor = {
  tagName: 'DIV',
  innerHTML: '',
  textContent: '',
  parentElement: editorRoot,
  closest: () => editorRoot,
  focus() { focusedEditor = editor; },
  dispatchEvent() {},
};

const sendButton = {
  disabled: false,
  click() { sent.push(editor.textContent); },
};

const document = {
  body: {},
  documentElement: { appendChild() {} },
  createElement() {
    return { textContent: '', title: '', style: { cssText: '', background: '' }, onclick: null };
  },
  querySelectorAll(selector) {
    if (selector === '[data-message-author-role]') return turns;
    return [];
  },
  querySelector(selector) {
    if (selector === 'button[data-testid="stop-button"]') return generating ? {} : null;
    if (selector === 'button[data-testid="send-button"]') return sendButton;
    if (selector === 'div[contenteditable="true"][role="textbox"]') return editor;
    if (selector === '#composer-submit-button') return null;
    return null;
  },
  execCommand(command, _ui, value) {
    if (command === 'insertText' && focusedEditor) {
      focusedEditor.textContent = value;
      return true;
    }
    return false;
  },
};

const context = {
  console,
  document,
  location: { pathname: '/c/replay-smoke' },
  sessionStorage: {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
  },
  chrome: {
    runtime: {
      async sendMessage(message) {
        if (message.type === 'bridge:get-settings') {
          return { settings: { enabled: true, autoExecute: true } };
        }
        if (message.type === 'bridge:execute') {
          executed.push(message.request);
          return { ok: true, data: { action: message.request.action } };
        }
        return { ok: true };
      },
    },
  },
  MutationObserver: class {
    observe() {}
  },
  setInterval() { return 0; },
  setTimeout,
  clearTimeout,
  Date,
  Event: class {},
  InputEvent: class {},
  KeyboardEvent: class {},
  HTMLTextAreaElement: class {},
};

vm.createContext(context);

// Existing history at extension load must be primed, never replayed.
turns = [
  makeTurn('assistant', 'old-package', '[[LOCAL_TOOL]]\n{"action":"read_file","path":"package.json"}\n[[/LOCAL_TOOL]]'),
];
vm.runInContext(source, context, { filename: 'content.js' });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(executed.length, 0, 'existing tool block replayed on extension load');

// A new assistant request should execute once, only after the response is stable.
turns = [
  turns[0],
  makeTurn('user', 'user-1', '[LOCAL_RESULT] previous result'),
  makeTurn('assistant', 'read-agents', 'Reading next.\n[[LOCAL_TOOL]]\n{"action":"read_file","path":"AGENTS.md"}\n[[/LOCAL_TOOL]]'),
];
await context.scan();
assert.equal(executed.length, 0, 'tool executed before stability window');
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 1);
assert.equal(executed[0].action, 'read_file');
assert.equal(executed[0].path, 'AGENTS.md');
assert.equal(sent.length, 1, 'expected exactly one LOCAL_RESULT send');

// Re-render/re-scan of the same message id must not execute again.
turns[2] = makeTurn('assistant', 'read-agents', turns[2].innerText);
await context.scan();
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 1, 'same assistant turn replayed after DOM re-render');

// While ChatGPT is generating, a complete-looking block must not execute.
turns.push(makeTurn('user', 'user-2', '[LOCAL_RESULT] AGENTS result'));
turns.push(makeTurn('assistant', 'during-stream', '[[LOCAL_TOOL]]\n{"action":"read_file","path":"README.md"}\n[[/LOCAL_TOOL]]'));
generating = true;
await context.scan();
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 1, 'tool executed while ChatGPT was still generating');
generating = false;
await context.scan();
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 2, 'new stable assistant turn did not execute');
assert.equal(executed[1].path, 'README.md');

// Same command is allowed again in a later assistant turn with a different stable id.
turns.push(makeTurn('user', 'user-3', '[LOCAL_RESULT] README result'));
turns.push(makeTurn('assistant', 'read-agents-again', '[[LOCAL_TOOL]]\n{"action":"read_file","path":"AGENTS.md"}\n[[/LOCAL_TOOL]]'));
await context.scan();
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 3);
assert.equal(executed[2].path, 'AGENTS.md');

// Independent requests can be batched into one LOCAL_TOOL block and one LOCAL_RESULT message.
turns.push(makeTurn('user', 'user-4', '[LOCAL_RESULT] AGENTS result'));
turns.push(makeTurn('assistant', 'batch-read', '[[LOCAL_TOOL]]\n[{"action":"read_file","path":"AGENTS.md"},{"action":"read_file","path":"package.json"}]\n[[/LOCAL_TOOL]]'));
const sentBeforeBatch = sent.length;
await context.scan();
await new Promise((resolve) => setTimeout(resolve, 800));
await context.scan();
assert.equal(executed.length, 5, 'batch did not execute both local requests');
assert.equal(executed[3].path, 'AGENTS.md');
assert.equal(executed[4].path, 'package.json');
assert.equal(sent.length, sentBeforeBatch + 1, 'batch should send exactly one LOCAL_RESULT message');
assert.match(sent.at(-1), /"batch": true/);
assert.match(sent.at(-1), /"path": "AGENTS.md"/);
assert.match(sent.at(-1), /"path": "package.json"/);

console.log('local-bridge-replay-smoke: ok');

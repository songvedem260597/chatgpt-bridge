const $ = (id) => document.getElementById(id);

async function load() {
  const r = await chrome.runtime.sendMessage({ type: 'bridge:get-settings' });
  const s = r?.settings || {};
  $('backend').value = s.backendUrl || 'http://127.0.0.1:5000';
  $('enabled').checked = s.enabled !== false;
  $('auto').checked = s.autoExecute !== false;
}

$('save').onclick = async () => {
  const settings = {
    backendUrl: $('backend').value.trim(),
    enabled: $('enabled').checked,
    autoExecute: $('auto').checked,
  };
  const r = await chrome.runtime.sendMessage({ type: 'bridge:set-settings', settings });
  $('status').textContent = r?.ok ? 'Saved' : ('Error: ' + (r?.error || 'unknown'));
};

$('test').onclick = async () => {
  $('status').textContent = 'Testing...';
  const r = await chrome.runtime.sendMessage({ type: 'bridge:status' });
  $('status').textContent = r?.ok ? JSON.stringify(r.data, null, 2) : ('Offline: ' + (r?.error || 'unknown'));
};

void load();

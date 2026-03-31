const DEFAULTS = {
  apiKey: '',
  grokModel: 'grok-3-latest',
  defaultVideoCount: 5,
  defaultDuration: 30,
  defaultStyle: 'educational',
  defaultLanguage: 'en',
  aspectRatio: '9:16',
  colorTheme: 'dark-purple',
  videoQuality: 'medium',
  exportFormat: 'webm',
  autoDownload: 'manual',
};

// --- Load saved settings ---
async function loadSettings() {
  const saved = await chrome.storage.sync.get(DEFAULTS);

  document.getElementById('apiKey').value = saved.apiKey || '';
  document.getElementById('grokModel').value = saved.grokModel;
  document.getElementById('defaultVideoCount').value = saved.defaultVideoCount;
  document.getElementById('videoCountVal').textContent = saved.defaultVideoCount;
  document.getElementById('defaultDuration').value = saved.defaultDuration;
  document.getElementById('durationVal').textContent = saved.defaultDuration + 's';
  document.getElementById('defaultLanguage').value = saved.defaultLanguage;
  document.getElementById('aspectRatio').value = saved.aspectRatio;
  document.getElementById('videoQuality').value = saved.videoQuality;
  document.getElementById('exportFormat').value = saved.exportFormat;
  document.getElementById('autoDownload').value = saved.autoDownload;

  setToggleActive('styleToggle', saved.defaultStyle);
  setToggleActive('themeToggle', saved.colorTheme);

  if (saved.apiKey) {
    showApiStatus('unknown', '🔒 API key is saved (not verified)');
  }
}

function setToggleActive(groupId, value) {
  const group = document.getElementById(groupId);
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === value);
  });
}

function getActiveToggle(groupId) {
  const group = document.getElementById(groupId);
  const active = group.querySelector('.toggle-btn.active');
  return active ? active.dataset.val : null;
}

// --- Range inputs ---
document.getElementById('defaultVideoCount').addEventListener('input', e => {
  document.getElementById('videoCountVal').textContent = e.target.value;
});

document.getElementById('defaultDuration').addEventListener('input', e => {
  document.getElementById('durationVal').textContent = e.target.value + 's';
});

// --- Toggle buttons ---
['styleToggle', 'themeToggle'].forEach(groupId => {
  document.getElementById(groupId).addEventListener('click', e => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    document.getElementById(groupId).querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// --- API key visibility toggle (click to show/hide) ---
document.getElementById('apiKey').addEventListener('dblclick', function () {
  this.type = this.type === 'password' ? 'text' : 'password';
});

// --- Test API key ---
function showApiStatus(type, message) {
  const el = document.getElementById('apiKeyStatus');
  el.style.display = 'flex';
  el.className = `api-key-status status-${type}`;
  el.textContent = message;
}

document.getElementById('testApiBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showApiStatus('invalid', '✗ Please enter an API key first');
    return;
  }

  const btn = document.getElementById('testApiBtn');
  btn.disabled = true;
  btn.textContent = '...';
  showApiStatus('testing', '⏳ Testing connection to xAI API...');

  try {
    const model = document.getElementById('grokModel').value;
    const resp = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with one word: hello' }],
        max_tokens: 5,
      }),
    });

    if (resp.ok) {
      showApiStatus('valid', '✓ API key is valid and working');
    } else {
      const data = await resp.json().catch(() => ({}));
      showApiStatus('invalid', `✗ API error ${resp.status}: ${data.error?.message || resp.statusText}`);
    }
  } catch (err) {
    showApiStatus('invalid', `✗ Connection failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
});

// --- Save settings ---
document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    grokModel: document.getElementById('grokModel').value,
    defaultVideoCount: parseInt(document.getElementById('defaultVideoCount').value),
    defaultDuration: parseInt(document.getElementById('defaultDuration').value),
    defaultStyle: getActiveToggle('styleToggle'),
    defaultLanguage: document.getElementById('defaultLanguage').value,
    aspectRatio: document.getElementById('aspectRatio').value,
    colorTheme: getActiveToggle('themeToggle'),
    videoQuality: document.getElementById('videoQuality').value,
    exportFormat: document.getElementById('exportFormat').value,
    autoDownload: document.getElementById('autoDownload').value,
  };

  await chrome.storage.sync.set(settings);

  const status = document.getElementById('saveStatus');
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2500);
});

// --- Reset to defaults ---
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  await chrome.storage.sync.set(DEFAULTS);
  await loadSettings();
});

// Init
loadSettings();

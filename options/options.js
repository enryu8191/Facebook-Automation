const DEFAULTS = {
  defaultVideoCount: 5,
  defaultDuration: 30,
  defaultStyle: 'educational',
  defaultLanguage: 'en',
  colorTheme: 'dark-purple',
  videoQuality: 'medium',
  includeHashtags: 'yes',
};

// -----------------------------------------------------------------------
// Check if grok.com is open
// -----------------------------------------------------------------------
async function checkGrokStatus() {
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  const el = document.getElementById('grokStatus');
  const txt = document.getElementById('grokStatusText');

  if (tabs.length > 0) {
    el.className = 'status-box ok';
    txt.textContent = '✓ grok.com is open — ready to generate!';
  } else {
    el.className = 'status-box warn';
    txt.innerHTML = '⚠ grok.com is not open. <a href="https://grok.com" target="_blank">Open and log in</a> before generating videos.';
  }
}

// -----------------------------------------------------------------------
// Load / Save
// -----------------------------------------------------------------------
async function loadSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);

  document.getElementById('defaultVideoCount').value = s.defaultVideoCount;
  document.getElementById('videoCountVal').textContent = s.defaultVideoCount;
  document.getElementById('defaultDuration').value = s.defaultDuration;
  document.getElementById('durationVal').textContent = s.defaultDuration + 's';
  document.getElementById('defaultLanguage').value = s.defaultLanguage;
  document.getElementById('videoQuality').value = s.videoQuality;

  setToggleActive('styleToggle', s.defaultStyle);
  setToggleActive('themeToggle', s.colorTheme);
  setToggleActive('hashtagToggle', s.includeHashtags);
}

function setToggleActive(groupId, value) {
  document.querySelectorAll(`#${groupId} [data-val]`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === value);
  });
}

function getActiveToggle(groupId) {
  return document.querySelector(`#${groupId} .active`)?.dataset.val ?? null;
}

// -----------------------------------------------------------------------
// Event listeners
// -----------------------------------------------------------------------
document.getElementById('defaultVideoCount').addEventListener('input', e => {
  document.getElementById('videoCountVal').textContent = e.target.value;
});
document.getElementById('defaultDuration').addEventListener('input', e => {
  document.getElementById('durationVal').textContent = e.target.value + 's';
});

['styleToggle', 'themeToggle', 'hashtagToggle'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    document.querySelectorAll(`#${id} [data-val]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const settings = {
    defaultVideoCount: parseInt(document.getElementById('defaultVideoCount').value),
    defaultDuration: parseInt(document.getElementById('defaultDuration').value),
    defaultStyle: getActiveToggle('styleToggle'),
    defaultLanguage: document.getElementById('defaultLanguage').value,
    colorTheme: getActiveToggle('themeToggle'),
    videoQuality: document.getElementById('videoQuality').value,
    includeHashtags: getActiveToggle('hashtagToggle'),
  };
  await chrome.storage.sync.set(settings);
  const s = document.getElementById('saveStatus');
  s.classList.add('visible');
  setTimeout(() => s.classList.remove('visible'), 2500);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  await chrome.storage.sync.set(DEFAULTS);
  await loadSettings();
});

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
checkGrokStatus();
loadSettings();

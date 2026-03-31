import { generateVideoSeries } from '../utils/grok-api.js';
import { renderVideo } from '../utils/video-renderer.js';

// -----------------------------------------------------------------------
// State
// -----------------------------------------------------------------------
const state = {
  currentStep: 1,
  settings: null,
  series: null,           // VideoSeries from Grok
  blobs: [],              // Rendered video blobs (indexed)
  renderStatus: [],       // 'queued' | 'rendering' | 'ready'
};

// -----------------------------------------------------------------------
// Step navigation helpers
// -----------------------------------------------------------------------
function goToStep(step) {
  state.currentStep = step;

  // Update panels
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  const panel = document.getElementById(`panel-${step}`);
  if (panel) panel.classList.remove('hidden');

  // Update step indicators
  document.querySelectorAll('.step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s < step) el.classList.add('completed');
    else if (s === step) el.classList.add('active');
  });

  document.querySelectorAll('.step-line').forEach((line, i) => {
    line.classList.toggle('completed', i + 1 < step);
  });
}

// -----------------------------------------------------------------------
// Toggle group helpers
// -----------------------------------------------------------------------
function getToggleVal(groupId) {
  const el = document.querySelector(`#${groupId} .toggle-btn.active`);
  return el ? el.dataset.val : null;
}

function setToggleVal(groupId, val) {
  document.querySelectorAll(`#${groupId} .toggle-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}

document.querySelectorAll('.toggle-group, .theme-grid').forEach(group => {
  group.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    group.querySelectorAll('[data-val]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// -----------------------------------------------------------------------
// Step 1: Topic input
// -----------------------------------------------------------------------
const topicInput = document.getElementById('topicInput');
const audienceInput = document.getElementById('audienceInput');
const videoCountSlider = document.getElementById('videoCount');
const charCount = document.getElementById('charCount');

topicInput.addEventListener('input', () => {
  const len = topicInput.value.length;
  charCount.textContent = len;
  document.getElementById('step1Next').disabled = len < 5 || len > 300;
});

videoCountSlider.addEventListener('input', () => {
  document.getElementById('videoCountVal').textContent =
    `${videoCountSlider.value} video${videoCountSlider.value > 1 ? 's' : ''}`;
});

// Quick idea chips
document.getElementById('quickIdeas').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  // Strip emoji prefix
  const idea = chip.textContent.replace(/^\S+\s/, '').trim();
  topicInput.value = idea;
  charCount.textContent = idea.length;
  document.getElementById('step1Next').disabled = false;
});

document.getElementById('step1Next').addEventListener('click', () => goToStep(2));

// -----------------------------------------------------------------------
// Step 2: Style
// -----------------------------------------------------------------------
document.getElementById('step2Back').addEventListener('click', () => goToStep(1));
document.getElementById('step2Next').addEventListener('click', () => {
  goToStep(3);
  startGeneration();
});

// -----------------------------------------------------------------------
// Step 3: Generate
// -----------------------------------------------------------------------
async function startGeneration() {
  const settings = await chrome.storage.sync.get({
    defaultDuration: 30,
    colorTheme: 'dark-purple',
    videoQuality: 'medium',
    includeHashtags: 'yes',
  });

  // Reset state
  state.series = null;
  state.blobs = [];
  state.renderStatus = [];

  showGenerationProgress();
  setProgressBar(5);
  setProgressStep('ps-script', 'active');
  document.getElementById('step3Footer').style.display = 'none';
  document.getElementById('videoList').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');

  try {
    // Phase 1: Generate scripts with Grok
    const series = await generateVideoSeries({
      topic: topicInput.value.trim(),
      audience: audienceInput.value.trim(),
      videoCount: parseInt(videoCountSlider.value),
      duration: parseInt(getToggleVal('videoDuration') || '30'),
      style: getToggleVal('videoStyle') || 'educational',
      language: 'en',
      includeHashtags: getToggleVal('hashtagToggle') !== 'no',
      onProgress: p => setProgressBar(5 + p * 0.6),
    });

    state.series = series;
    state.blobs = new Array(series.videos.length).fill(null);
    state.renderStatus = series.videos.map(() => 'queued');

    setProgressBar(70);
    setProgressStep('ps-script', 'done');
    setProgressStep('ps-render', 'active');

    // Phase 2: Render videos
    buildVideoList(series);
    document.getElementById('videoList').classList.remove('hidden');

    const renderOpts = {
      aspectRatio: '9:16',
      theme: getToggleVal('colorTheme') || 'dark-purple',
      animation: getToggleVal('textAnimation') || 'fade',
      duration: parseInt(getToggleVal('videoDuration') || '30'),
      quality: 'medium',
    };

    for (let i = 0; i < series.videos.length; i++) {
      updateVideoCardStatus(i, 'rendering');
      state.renderStatus[i] = 'rendering';

      const blob = await renderVideo(series.videos[i], {
        ...renderOpts,
        videoIndex: i,
        totalVideos: series.videos.length,
        onProgress: p => {
          const overallP = 70 + ((i + p / 100) / series.videos.length) * 25;
          setProgressBar(overallP);
        },
      });

      state.blobs[i] = blob;
      state.renderStatus[i] = 'ready';
      updateVideoCardStatus(i, 'ready');
    }

    setProgressBar(100);
    setProgressStep('ps-render', 'done');
    setProgressStep('ps-done', 'done');

    // Show footer
    document.getElementById('step3Footer').style.display = '';
    document.getElementById('generateTitle').textContent = `${series.videos.length} videos ready!`;
    document.getElementById('generateDesc').textContent =
      `"${series.seriesTitle}" — click Export to download your videos.`;

  } catch (err) {
    showError(err.message);
  }
}

function setProgressBar(pct) {
  document.getElementById('progressBar').style.width = `${Math.min(100, pct)}%`;
}

function setProgressStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  else if (state === 'done') el.classList.add('done');
}

function showGenerationProgress() {
  document.getElementById('generateProgress').classList.remove('hidden');
}

function showError(msg) {
  document.getElementById('generateProgress').classList.add('hidden');
  document.getElementById('errorState').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
}

document.getElementById('retryBtn').addEventListener('click', () => {
  goToStep(2);
});

// --- Video card list ---
function buildVideoList(series) {
  const list = document.getElementById('videoList');
  list.innerHTML = '';

  series.videos.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.id = `vc-${i}`;
    card.innerHTML = `
      <div class="vc-header">
        <div class="vc-number">${i + 1}</div>
        <div class="vc-title">${v.title}</div>
        <span class="vc-status queued" id="vcs-${i}">Queued</span>
      </div>
      <div class="vc-hook">${v.hook}</div>
      <div class="vc-meta">
        <span class="vc-tag">🎬 ${v.scenes.length} scenes</span>
        <span class="vc-tag">📝 ${v.narration.split(' ').length} words</span>
        ${v.hashtags.length ? `<span class="vc-tag">🏷 ${v.hashtags.length} hashtags</span>` : ''}
      </div>
    `;
    list.appendChild(card);
  });
}

function updateVideoCardStatus(idx, status) {
  const badge = document.getElementById(`vcs-${idx}`);
  const card = document.getElementById(`vc-${idx}`);
  if (!badge || !card) return;

  badge.className = `vc-status ${status}`;
  badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  card.className = `video-card ${status}`;
}

document.getElementById('step3Back').addEventListener('click', () => goToStep(2));
document.getElementById('step3Next').addEventListener('click', () => {
  goToStep(4);
  buildExportPanel();
});

// -----------------------------------------------------------------------
// Step 4: Export
// -----------------------------------------------------------------------
function buildExportPanel() {
  if (!state.series) return;

  const { series, blobs } = state;
  const readyCount = blobs.filter(Boolean).length;

  document.getElementById('exportSummary').innerHTML =
    `<strong>${series.seriesTitle}</strong><br>
     ${series.description}<br><br>
     ${readyCount} of ${series.videos.length} videos rendered and ready to download.`;

  // Build per-video download list
  const list = document.getElementById('exportVideoList');
  list.innerHTML = '';

  series.videos.forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'export-item';
    item.innerHTML = `
      <input type="checkbox" id="ec-${i}" checked />
      <label class="export-item-title" for="ec-${i}">${v.emoji} ${v.title}</label>
      <button class="export-item-dl" data-idx="${i}" title="Download this video">⬇</button>
    `;
    list.appendChild(item);
  });

  // Individual download
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    downloadVideo(idx);
  });
}

function downloadVideo(idx) {
  const blob = state.blobs[idx];
  if (!blob) return;

  const title = state.series.videos[idx].title
    .replace(/[^a-z0-9]/gi, '-')
    .toLowerCase();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `grok-video-${idx + 1}-${title}.webm`;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadAllAsZip() {
  // Simple sequential download (no JSZip dependency needed for the extension)
  for (let i = 0; i < state.blobs.length; i++) {
    if (state.blobs[i]) {
      await new Promise(r => setTimeout(r, 300));
      downloadVideo(i);
    }
  }
}

function downloadSelected() {
  for (let i = 0; i < (state.series?.videos.length || 0); i++) {
    const cb = document.getElementById(`ec-${i}`);
    if (cb?.checked && state.blobs[i]) downloadVideo(i);
  }
}

function copyAllScripts() {
  if (!state.series) return;
  const text = state.series.videos.map((v, i) =>
    `=== Video ${i + 1}: ${v.title} ===\n` +
    `Hook: ${v.hook}\n\n` +
    `Scenes:\n${v.scenes.map((s, j) => `  ${j + 1}. ${s}`).join('\n')}\n\n` +
    `Narration:\n${v.narration}\n\n` +
    `CTA: ${v.callToAction}\n` +
    (v.hashtags.length ? `Hashtags: ${v.hashtags.map(h => `#${h}`).join(' ')}\n` : '') +
    '\n'
  ).join('\n');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyScripts');
    btn.querySelector('.eo-text strong').textContent = '✓ Copied!';
    setTimeout(() => {
      btn.querySelector('.eo-text strong').textContent = 'Copy Scripts';
    }, 2000);
  });
}

document.getElementById('exportAll').addEventListener('click', downloadAllAsZip);
document.getElementById('exportSelected').addEventListener('click', downloadSelected);
document.getElementById('copyScripts').addEventListener('click', copyAllScripts);
document.getElementById('step4Back').addEventListener('click', () => goToStep(3));
document.getElementById('newSeriesBtn').addEventListener('click', () => {
  state.series = null;
  state.blobs = [];
  state.renderStatus = [];
  topicInput.value = '';
  charCount.textContent = '0';
  document.getElementById('step1Next').disabled = true;
  goToStep(1);
});

// -----------------------------------------------------------------------
// Settings button
// -----------------------------------------------------------------------
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('openGrok')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://grok.com' });
  document.getElementById('noApiBanner').classList.add('hidden');
});

// -----------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------
async function init() {
  const settings = await chrome.storage.sync.get({
    defaultVideoCount: 5,
    defaultDuration: 30,
    defaultStyle: 'educational',
    colorTheme: 'dark-purple',
    includeHashtags: 'yes',
  });
  state.settings = settings;

  // Apply saved defaults
  videoCountSlider.value = settings.defaultVideoCount;
  document.getElementById('videoCountVal').textContent = `${settings.defaultVideoCount} videos`;
  setToggleVal('videoDuration', String(settings.defaultDuration));
  setToggleVal('videoStyle', settings.defaultStyle);
  setToggleVal('colorTheme', settings.colorTheme);
  setToggleVal('hashtagToggle', settings.includeHashtags);

  // Check if grok.com is open; show banner if not
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (tabs.length === 0) {
    document.getElementById('noApiBanner').classList.remove('hidden');
  }

  // Pre-fill topic from context menu if set
  const session = await chrome.storage.session.get({ pendingTopic: '' });
  if (session.pendingTopic) {
    topicInput.value = session.pendingTopic;
    charCount.textContent = session.pendingTopic.length;
    document.getElementById('step1Next').disabled = session.pendingTopic.length < 5;
    chrome.storage.session.remove('pendingTopic');
  }

  goToStep(1);
}

init();

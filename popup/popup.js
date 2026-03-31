import { generateScripts, generateAllImages } from '../utils/grok-api.js';
import { renderProject } from '../utils/video-renderer.js';

// ─────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────
const state = {
  step: 1,
  project: null,   // StoryProject
  blobs: [],       // Rendered Blob[] indexed by video
};

// ─────────────────────────────────────────────────────
// Step navigation
// ─────────────────────────────────────────────────────
function goToStep(n) {
  state.step = n;
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`panel-${n}`)?.classList.remove('hidden');

  document.querySelectorAll('.step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.remove('active', 'completed');
    if (s < n) el.classList.add('completed');
    else if (s === n) el.classList.add('active');
  });
  document.querySelectorAll('.step-line').forEach((l, i) => {
    l.classList.toggle('completed', i + 1 < n);
  });
}

// ─────────────────────────────────────────────────────
// Toggle helpers
// ─────────────────────────────────────────────────────
function getToggle(id) {
  return document.querySelector(`#${id} .active, #${id} [class*="btn"].active`)?.dataset.val ?? null;
}

function setToggle(id, val) {
  document.querySelectorAll(`#${id} [data-val]`).forEach(b =>
    b.classList.toggle('active', b.dataset.val === val)
  );
}

// Wire all toggle groups + style grids
document.querySelectorAll('.toggle-group, .style-grid, .format-cards').forEach(group => {
  group.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    group.querySelectorAll('[data-val]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show/hide series episode count
    if (group.id === 'formatCards') {
      document.getElementById('seriesCountGroup')
        .classList.toggle('hidden', btn.dataset.val !== 'series');
    }
  });
});

// ─────────────────────────────────────────────────────
// Step 1: Story
// ─────────────────────────────────────────────────────
const storyInput = document.getElementById('storyInput');
const charCount  = document.getElementById('charCount');

storyInput.addEventListener('input', () => {
  const n = storyInput.value.length;
  charCount.textContent = n;
  document.getElementById('step1Next').disabled = n < 10 || n > 500;
});

// Range sliders
document.getElementById('episodeCount').addEventListener('input', e => {
  document.getElementById('episodeCountVal').textContent = `${e.target.value} episodes`;
});
document.getElementById('sceneCount').addEventListener('input', e => {
  document.getElementById('sceneCountVal').textContent = `${e.target.value} scenes`;
});

// Quick chips
document.getElementById('quickChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const text = chip.textContent.replace(/^\S+\s/, '').trim();
  storyInput.value = text;
  charCount.textContent = text.length;
  document.getElementById('step1Next').disabled = false;
});

document.getElementById('step1Next').addEventListener('click', () => goToStep(2));

// ─────────────────────────────────────────────────────
// Step 2: Style
// ─────────────────────────────────────────────────────
document.getElementById('step2Back').addEventListener('click', () => goToStep(1));
document.getElementById('step2Next').addEventListener('click', () => {
  goToStep(3);
  startCreation();
});

// ─────────────────────────────────────────────────────
// Step 3: Create
// ─────────────────────────────────────────────────────

function setPhase(id, status, subText) {
  const item = document.getElementById(`phase-${id}`);
  const badge = document.getElementById(`phase-${id}-status`);
  const sub   = document.getElementById(`phase-${id}-sub`);
  if (!item) return;

  item.classList.remove('active', 'done', 'error');
  badge.classList.remove('idle', 'working', 'done', 'error');

  if (status === 'working') {
    item.classList.add('active');
    badge.classList.add('working');
    badge.textContent = '⏳ Working';
  } else if (status === 'done') {
    item.classList.add('done');
    badge.classList.add('done');
    badge.textContent = '✓ Done';
  } else if (status === 'error') {
    item.classList.add('error');
    badge.classList.add('error');
    badge.textContent = '✗ Error';
  } else {
    badge.classList.add('idle');
    badge.textContent = '—';
  }

  if (subText && sub) sub.textContent = subText;
}

function setProgress(pct) {
  document.getElementById('progressBar').style.width = `${Math.min(100, pct)}%`;
}

function showError(msg) {
  document.getElementById('errorState').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
  document.getElementById('phaseList').classList.add('hidden');
}

// Scene thumbnail strip
function addSceneThumb(videoIndex, scene) {
  const strip = document.getElementById('sceneStrip');
  const thumbs = document.getElementById('sceneThumbs');
  strip.classList.remove('hidden');

  const id = `thumb-v${videoIndex}-s${scene.index}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'scene-thumb loading';
    el.id = id;
    el.innerHTML = `<span class="scene-thumb-num">${videoIndex + 1}.${scene.index + 1}</span>`;
    thumbs.appendChild(el);
  }

  if (scene.imageDataUrl) {
    el.classList.remove('loading');
    el.innerHTML = `
      <img src="${scene.imageDataUrl}" alt="scene" />
      <span class="scene-thumb-num">${videoIndex + 1}.${scene.index + 1}</span>
    `;
  }
}

async function startCreation() {
  state.project = null;
  state.blobs   = [];

  // Reset UI
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('phaseList').classList.remove('hidden');
  document.getElementById('sceneStrip').classList.add('hidden');
  document.getElementById('sceneThumbs').innerHTML = '';
  document.getElementById('step3Footer').classList.add('hidden');
  setProgress(0);
  setPhase('script', 'idle');
  setPhase('images', 'idle');
  setPhase('render', 'idle');

  const format       = getToggle('formatCards') || 'single';
  const episodeCount = parseInt(document.getElementById('episodeCount').value);
  const sceneCount   = parseInt(document.getElementById('sceneCount').value);

  try {
    // ── Phase 1: Generate scripts ──
    setPhase('script', 'working', 'Sending your story to Grok...');
    document.getElementById('genTitle').textContent = 'Writing your script...';

    const project = await generateScripts({
      story:        storyInput.value.trim(),
      format,
      episodeCount,
      sceneCount,
      artStyle:     getToggle('artStyle')   || 'cinematic',
      mood:         getToggle('moodStyle')  || 'dramatic',
      shotType:     getToggle('shotType')   || 'varied',
      onProgress:   p => setProgress(p * 0.3),
    });

    state.project = project;
    setPhase('script', 'done',
      `Script ready: ${project.videos.length} video${project.videos.length > 1 ? 's' : ''}, ${sceneCount} scenes each`
    );
    setProgress(30);

    // ── Phase 2: Generate images via Grok Imagine ──
    const totalScenes = project.videos.reduce((n, v) => n + v.scenes.length, 0);
    setPhase('images', 'working', `Generating ${totalScenes} images via Grok Imagine...`);
    document.getElementById('genTitle').textContent = 'Generating images...';
    document.getElementById('genDesc').textContent  =
      `Grok Imagine is creating ${totalScenes} scene images. The grok.com tab will update as each one is made.`;

    // Add placeholder thumbs
    project.videos.forEach((v, vi) => {
      v.scenes.forEach(s => addSceneThumb(vi, s));
    });

    await generateAllImages(
      project,
      p => setProgress(30 + p * 0.45),
      (vi, scene) => addSceneThumb(vi, scene)
    );

    setPhase('images', 'done', `${totalScenes} images generated`);
    setProgress(75);

    // ── Phase 3: Render videos ──
    setPhase('render', 'working', 'Compositing images into video...');
    document.getElementById('genTitle').textContent = 'Rendering videos...';
    document.getElementById('genDesc').textContent  = 'Almost done — combining images, captions, and transitions.';

    const blobs = await renderProject(
      project,
      {
        captionStyle: getToggle('captionStyle') || 'subtitle',
        transition:   getToggle('transition')   || 'crossfade',
        quality:      'medium',
      },
      (vi) => setPhase('render', 'working', `Rendering video ${vi + 1}/${project.videos.length}...`),
      (vi, p) => setProgress(75 + ((vi + p / 100) / project.videos.length) * 25),
      (vi, blob) => { state.blobs[vi] = blob; }
    );

    state.blobs = blobs;
    setPhase('render', 'done', `${blobs.length} video${blobs.length > 1 ? 's' : ''} ready to export`);
    setProgress(100);

    document.getElementById('genTitle').textContent =
      `${blobs.length} video${blobs.length > 1 ? 's' : ''} ready!`;
    document.getElementById('genDesc').textContent  =
      project.seriesTitle
        ? `"${project.seriesTitle}" — ${blobs.length} episodes rendered.`
        : `"${project.videos[0]?.title}" — your video is ready to download.`;

    document.getElementById('step3Footer').classList.remove('hidden');
    chrome.runtime.sendMessage({ type: 'GENERATION_DONE' });

  } catch (err) {
    setPhase('script', 'error');
    setPhase('images', 'error');
    setPhase('render', 'error');
    showError(err.message);
    chrome.runtime.sendMessage({ type: 'GENERATION_ERROR' });
  }
}

document.getElementById('retryBtn').addEventListener('click', () => goToStep(2));
document.getElementById('step3Back').addEventListener('click', () => goToStep(2));
document.getElementById('step3Next').addEventListener('click', () => {
  goToStep(4);
  buildExportPanel();
});

// ─────────────────────────────────────────────────────
// Step 4: Export
// ─────────────────────────────────────────────────────
function buildExportPanel() {
  const { project, blobs } = state;
  if (!project) return;

  document.getElementById('exportDesc').textContent =
    project.seriesTitle
      ? `${project.seriesTitle} — ${blobs.length} videos ready`
      : `${project.videos[0]?.title} — ready to download`;

  document.getElementById('exportAllSub').textContent =
    `Save ${blobs.length} video${blobs.length > 1 ? 's' : ''} as .webm`;

  const list = document.getElementById('videoPreviewList');
  list.innerHTML = '';
  project.videos.forEach((v, i) => {
    const firstImg = v.scenes.find(s => s.imageDataUrl)?.imageDataUrl;
    const card = document.createElement('div');
    card.className = 'video-preview-card';
    card.innerHTML = `
      <div class="vpc-thumb">
        ${firstImg ? `<img src="${firstImg}" />` : ''}
      </div>
      <div class="vpc-info">
        <div class="vpc-title">${v.episode ? `${v.episode}: ` : ''}${v.title}</div>
        <div class="vpc-meta">${v.scenes.length} scenes · ${v.scenes.reduce((t, s) => t + (s.duration || 5), 0)}s</div>
      </div>
      <button class="vpc-dl" data-idx="${i}" title="Download">⬇</button>
    `;
    list.appendChild(card);
  });

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-idx]');
    if (btn) downloadVideo(+btn.dataset.idx);
  });
}

function downloadVideo(idx) {
  const blob  = state.blobs[idx];
  const video = state.project?.videos[idx];
  if (!blob || !video) return;

  const slug = (video.episode || video.title)
    .replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40);
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = `grok-video-${idx + 1}-${slug}.webm`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('exportAll').addEventListener('click', async () => {
  for (let i = 0; i < state.blobs.length; i++) {
    await sleep(350);
    downloadVideo(i);
  }
});

document.getElementById('copyScripts').addEventListener('click', () => {
  if (!state.project) return;
  const text = state.project.videos.map((v, i) =>
    `=== ${v.episode ? `${v.episode}: ` : ''}${v.title} ===\n\n` +
    `Hook: ${v.hook}\n\n` +
    v.scenes.map((s, j) =>
      `Scene ${j + 1} [${s.duration}s]\n` +
      `  Caption: ${s.caption}\n` +
      `  Narration: ${s.narration}\n` +
      `  Image prompt: ${s.imagePrompt}`
    ).join('\n\n') +
    `\n\nOutro: ${v.outro}\n` +
    (v.hashtags.length ? `Hashtags: ${v.hashtags.map(h => `#${h}`).join(' ')}\n` : '')
  ).join('\n\n' + '─'.repeat(50) + '\n\n');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyScripts');
    btn.querySelector('.eo-text strong').textContent = '✓ Copied!';
    setTimeout(() => btn.querySelector('.eo-text strong').textContent = 'Copy Scripts', 2500);
  });
});

document.getElementById('step4Back').addEventListener('click', () => goToStep(3));
document.getElementById('newVideoBtn').addEventListener('click', () => {
  state.project = null;
  state.blobs   = [];
  storyInput.value = '';
  charCount.textContent = '0';
  document.getElementById('step1Next').disabled = true;
  goToStep(1);
});

// ─────────────────────────────────────────────────────
// Settings + Grok banner
// ─────────────────────────────────────────────────────
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById('openGrokBtn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://grok.com' });
  document.getElementById('noGrokBanner').classList.add('hidden');
});

// ─────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────
async function init() {
  // Check if Grok tab is open
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (tabs.length === 0) {
    document.getElementById('noGrokBanner').classList.remove('hidden');
  }

  // Load saved defaults
  const s = await chrome.storage.sync.get({
    defaultStyle: 'cinematic', colorTheme: 'dark-purple',
  });
  setToggle('artStyle', s.defaultStyle);

  // Pre-fill topic from context menu
  const session = await chrome.storage.session.get({ pendingTopic: '' });
  if (session.pendingTopic) {
    storyInput.value = session.pendingTopic;
    charCount.textContent = session.pendingTopic.length;
    document.getElementById('step1Next').disabled = session.pendingTopic.length < 10;
    chrome.storage.session.remove('pendingTopic');
  }

  goToStep(1);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

init();

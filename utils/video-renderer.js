/**
 * Canvas-based video renderer
 * Generates animated short-form videos from script data using
 * the Canvas 2D API and MediaRecorder for export.
 */

/** Canvas dimensions per aspect ratio */
const DIMENSIONS = {
  '9:16': { width: 540, height: 960 },
  '1:1':  { width: 720, height: 720 },
  '16:9': { width: 960, height: 540 },
};

/** Quality settings: bitrate (bps) */
const QUALITY_BITRATE = {
  high:   4_000_000,
  medium: 2_000_000,
  low:    800_000,
};

/** Color themes: [bg gradient stops, accent, text] */
const THEMES = {
  'dark-purple': {
    bg: ['#0d001a', '#1a0533', '#2d1b69'],
    accent: '#a855f7',
    accentGlow: 'rgba(168, 85, 247, 0.4)',
    text: '#f5f3ff',
    sub: '#c4b5fd',
  },
  'dark-blue': {
    bg: ['#030712', '#0d1b4b', '#1e3a8a'],
    accent: '#3b82f6',
    accentGlow: 'rgba(59, 130, 246, 0.4)',
    text: '#eff6ff',
    sub: '#93c5fd',
  },
  sunset: {
    bg: ['#1c0a00', '#7c2d12', '#9d174d'],
    accent: '#f97316',
    accentGlow: 'rgba(249, 115, 22, 0.4)',
    text: '#fff7ed',
    sub: '#fdba74',
  },
  forest: {
    bg: ['#001a0a', '#052e16', '#14532d'],
    accent: '#22c55e',
    accentGlow: 'rgba(34, 197, 94, 0.4)',
    text: '#f0fdf4',
    sub: '#86efac',
  },
  neon: {
    bg: ['#000000', '#0a0a0a', '#0d0d14'],
    accent: '#00ff88',
    accentGlow: 'rgba(0, 255, 136, 0.4)',
    text: '#ffffff',
    sub: '#00ff88',
  },
  minimal: {
    bg: ['#0f172a', '#1e293b', '#334155'],
    accent: '#94a3b8',
    accentGlow: 'rgba(148, 163, 184, 0.3)',
    text: '#f8fafc',
    sub: '#cbd5e1',
  },
};

/**
 * Wrap text to fit within a max width
 * @returns {string[]} Array of lines
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draw a rounded rectangle
 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draw the animated background
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w width
 * @param {number} h height
 * @param {Object} theme
 * @param {number} t time 0..1
 */
function drawBackground(ctx, w, h, theme, t) {
  // Static gradient base
  const grad = ctx.createLinearGradient(0, 0, w * 0.3, h);
  grad.addColorStop(0, theme.bg[0]);
  grad.addColorStop(0.5, theme.bg[1]);
  grad.addColorStop(1, theme.bg[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Animated radial glow
  const glowX = w * (0.5 + 0.2 * Math.sin(t * Math.PI * 2));
  const glowY = h * (0.4 + 0.1 * Math.cos(t * Math.PI * 2));
  const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, w * 0.6);
  glow.addColorStop(0, theme.accentGlow);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Particle dots
  ctx.fillStyle = `rgba(255,255,255,${0.03 + 0.02 * Math.sin(t * Math.PI)})`;
  for (let i = 0; i < 20; i++) {
    const px = ((i * 137.5 + t * 20) % w);
    const py = ((i * 53.7 + t * 10) % h);
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw the video number badge
 */
function drawBadge(ctx, w, theme, videoNum, totalVideos) {
  const text = `${videoNum}/${totalVideos}`;
  ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, Arial, sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 24;
  const bh = 36;
  const bx = w - bw - 20;
  const by = 24;

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fill();

  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = theme.sub;
  ctx.textAlign = 'center';
  ctx.fillText(text, bx + bw / 2, by + 25);
}

/**
 * Draw the hook text with animation
 * @param {number} alpha 0..1
 */
function drawHook(ctx, w, h, theme, text, alpha, animation) {
  const padding = w * 0.08;
  const maxW = w - padding * 2;
  const fontSize = Math.round(w * 0.07);

  ctx.globalAlpha = alpha;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  ctx.textAlign = 'center';

  const lines = wrapText(ctx, text, maxW);
  const lineH = fontSize * 1.3;
  const totalH = lines.length * lineH;
  let startY = h * 0.18;

  // Draw text shadow / glow
  ctx.shadowColor = theme.accentGlow;
  ctx.shadowBlur = 20;

  lines.forEach((line, i) => {
    let x = w / 2;
    let y = startY + i * lineH;

    if (animation === 'slide') {
      x = w / 2 + (1 - alpha) * w * 0.3;
    } else if (animation === 'bounce') {
      y += Math.sin(alpha * Math.PI) * -10;
    }

    ctx.fillStyle = theme.text;
    ctx.fillText(line, x, y);
  });

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/**
 * Draw a scene card with text
 * @param {number} alpha 0..1
 * @param {number} yOffset slide offset
 */
function drawSceneCard(ctx, w, h, theme, text, alpha, yOffset = 0) {
  const padding = w * 0.06;
  const cardW = w - padding * 2;
  const fontSize = Math.round(w * 0.055);

  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  const lines = wrapText(ctx, text, cardW - 32);
  const lineH = fontSize * 1.4;
  const cardH = lines.length * lineH + 32;
  const cardX = padding;
  const cardY = h * 0.38 + yOffset;

  ctx.globalAlpha = alpha;

  // Card background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 14);
  ctx.fill();

  ctx.strokeStyle = `${theme.accent}88`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Left accent bar
  ctx.fillStyle = theme.accent;
  roundRect(ctx, cardX, cardY, 4, cardH, [14, 0, 0, 14]);
  ctx.fill();

  // Text
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    ctx.fillText(line, cardX + 20, cardY + 28 + i * lineH);
  });

  ctx.globalAlpha = 1;
}

/**
 * Draw emoji + narration excerpt
 */
function drawNarrationStrip(ctx, w, h, theme, emoji, narrationSnippet, alpha) {
  const stripH = 64;
  const stripY = h * 0.72;

  ctx.globalAlpha = alpha * 0.9;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, stripY, w, stripH);

  // Emoji
  ctx.font = `${Math.round(w * 0.08)}px serif`;
  ctx.textAlign = 'left';
  ctx.fillText(emoji, 20, stripY + 44);

  // Narration snippet
  const fontSize = Math.round(w * 0.04);
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  ctx.fillStyle = theme.sub;

  const maxW = w - 80;
  const lines = wrapText(ctx, narrationSnippet, maxW);
  ctx.fillText(lines[0] || '', 70, stripY + 32);
  if (lines[1]) ctx.fillText(lines[1], 70, stripY + 32 + fontSize * 1.3);

  ctx.globalAlpha = 1;
}

/**
 * Draw CTA + hashtags
 */
function drawCTA(ctx, w, h, theme, cta, hashtags, alpha) {
  ctx.globalAlpha = alpha;

  const fontSize = Math.round(w * 0.045);
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
  ctx.textAlign = 'center';

  // CTA background pill
  const ctaW = w * 0.8;
  const ctaH = 44;
  const ctaX = w * 0.1;
  const ctaY = h * 0.82;

  const grad = ctx.createLinearGradient(ctaX, 0, ctaX + ctaW, 0);
  grad.addColorStop(0, theme.accent);
  grad.addColorStop(1, theme.bg[2]);
  ctx.fillStyle = grad;
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, 22);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.fillText(cta, w / 2, ctaY + 30);

  // Hashtags
  if (hashtags.length > 0) {
    const hashText = hashtags.slice(0, 4).map(h => `#${h}`).join(' ');
    ctx.font = `${Math.round(w * 0.035)}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
    ctx.fillStyle = theme.sub;
    ctx.fillText(hashText, w / 2, ctaY + 68);
  }

  ctx.globalAlpha = 1;
}

/**
 * Draw a progress bar at the bottom
 */
function drawProgressBar(ctx, w, h, theme, progress) {
  const barH = 4;
  const barY = h - barH;

  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, barY, w, barH);

  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, barY, w * progress, barH);
}

/**
 * Render one video to a Blob
 *
 * @param {Object} script  VideoScript object
 * @param {Object} options
 * @param {string} options.aspectRatio  '9:16' | '1:1' | '16:9'
 * @param {string} options.theme        theme key
 * @param {string} options.animation    'fade' | 'slide' | 'typewriter' | 'bounce'
 * @param {number} options.duration     seconds
 * @param {string} options.quality      'high' | 'medium' | 'low'
 * @param {number} options.videoIndex   0-based index
 * @param {number} options.totalVideos
 * @param {function} options.onProgress (0..100)
 * @returns {Promise<Blob>} WebM video blob
 */
export function renderVideo(script, options) {
  return new Promise((resolve, reject) => {
    const {
      aspectRatio = '9:16',
      theme: themeKey = 'dark-purple',
      animation = 'fade',
      duration = 30,
      quality = 'medium',
      videoIndex = 0,
      totalVideos = 1,
      onProgress,
    } = options;

    const { width, height } = DIMENSIONS[aspectRatio] || DIMENSIONS['9:16'];
    const theme = THEMES[themeKey] || THEMES['dark-purple'];
    const fps = 30;
    const totalFrames = duration * fps;
    const bitrate = QUALITY_BITRATE[quality] || QUALITY_BITRATE.medium;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Set up MediaRecorder
    const stream = canvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: bitrate,
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.onerror = e => reject(new Error(`MediaRecorder error: ${e.error?.message}`));

    recorder.start();

    // --- Animation timeline ---
    // Segment durations (in frames):
    //   0-10%  : Hook intro
    //   10-75% : Scenes (equally divided)
    //   75-90% : Narration strip
    //   90-100%: CTA + hashtags
    const sceneCount = Math.max(script.scenes.length, 1);
    const hookEnd = totalFrames * 0.12;
    const scenesStart = hookEnd;
    const scenesEnd = totalFrames * 0.75;
    const narrationStart = scenesEnd;
    const narrationEnd = totalFrames * 0.88;
    const ctaStart = narrationEnd;

    const sceneFrames = (scenesEnd - scenesStart) / sceneCount;

    let frame = 0;
    const narrationWords = script.narration.split(' ');

    function renderFrame() {
      if (frame >= totalFrames) {
        recorder.stop();
        return;
      }

      const t = frame / totalFrames; // global time 0..1

      // --- Background ---
      drawBackground(ctx, width, height, theme, t);

      // --- Badge ---
      drawBadge(ctx, width, theme, videoIndex + 1, totalVideos);

      // --- Hook phase ---
      if (frame < hookEnd) {
        const localT = frame / hookEnd;
        let alpha;
        if (animation === 'typewriter') {
          // Reveal characters progressively
          alpha = 1;
          const chars = Math.floor(localT * script.hook.length);
          drawHook(ctx, width, height, theme, script.hook.slice(0, chars), 1, animation);
        } else {
          alpha = Math.min(1, localT * 3); // quick fade in
          drawHook(ctx, width, height, theme, script.hook, alpha, animation);
        }
      } else {
        // Keep hook visible at reduced opacity
        drawHook(ctx, width, height, theme, script.hook, 0.35, 'fade');
      }

      // --- Scenes phase ---
      if (frame >= scenesStart && frame < scenesEnd) {
        const sceneIdx = Math.floor((frame - scenesStart) / sceneFrames);
        const localT = ((frame - scenesStart) % sceneFrames) / sceneFrames;
        const sceneText = script.scenes[Math.min(sceneIdx, sceneCount - 1)] || '';

        let alpha, yOffset = 0;
        if (animation === 'slide') {
          alpha = Math.min(1, localT * 4);
          yOffset = (1 - alpha) * 40;
        } else if (animation === 'bounce') {
          alpha = Math.min(1, localT * 4);
          yOffset = alpha < 1 ? (1 - alpha) * -30 : 0;
        } else {
          alpha = localT < 0.15 ? localT / 0.15
                : localT > 0.85 ? (1 - localT) / 0.15
                : 1;
        }

        drawSceneCard(ctx, width, height, theme, sceneText, alpha, yOffset);
      }

      // --- Narration strip ---
      if (frame >= narrationStart && frame < narrationEnd) {
        const localT = (frame - narrationStart) / (narrationEnd - narrationStart);
        const alpha = Math.min(1, localT * 3);

        // Show progressive narration snippet
        const wordCount = Math.floor(localT * narrationWords.length);
        const snippet = narrationWords.slice(0, Math.max(8, wordCount)).join(' ') + '...';
        drawNarrationStrip(ctx, width, height, theme, script.emoji, snippet, alpha);
      }

      // --- CTA phase ---
      if (frame >= ctaStart) {
        const localT = (frame - ctaStart) / (totalFrames - ctaStart);
        const alpha = Math.min(1, localT * 2);
        drawCTA(ctx, width, height, theme, script.callToAction, script.hashtags, alpha);
      }

      // --- Progress bar ---
      drawProgressBar(ctx, width, height, theme, t);

      // --- Video title watermark ---
      ctx.globalAlpha = 0.5;
      ctx.font = `bold ${Math.round(width * 0.033)}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'left';
      ctx.fillText(script.title, 16, height - 20);
      ctx.globalAlpha = 1;

      frame++;
      onProgress?.(Math.round((frame / totalFrames) * 100));
      requestAnimationFrame(renderFrame);
    }

    renderFrame();
  });
}

/**
 * Render all videos in a series
 * @param {import('./grok-api.js').VideoSeries} series
 * @param {Object} options  Same as renderVideo options
 * @param {function} onVideoProgress (videoIndex, frameProgress 0-100)
 * @param {function} onVideoDone (videoIndex, blob)
 * @returns {Promise<Blob[]>}
 */
export async function renderSeries(series, options, onVideoProgress, onVideoDone) {
  const blobs = [];

  for (let i = 0; i < series.videos.length; i++) {
    const script = series.videos[i];
    const blob = await renderVideo(script, {
      ...options,
      videoIndex: i,
      totalVideos: series.videos.length,
      onProgress: (p) => onVideoProgress?.(i, p),
    });
    blobs.push(blob);
    onVideoDone?.(i, blob);
  }

  return blobs;
}

/**
 * Image-based video renderer
 *
 * Takes an array of scenes (each with a Grok Imagine data URL) and
 * renders them into an animated WebM video using:
 *  - Ken Burns effect (slow pan + zoom) on each image
 *  - Scene transitions (crossfade / slide / zoom / cut)
 *  - Caption bar with typewriter or subtitle style
 *  - Hook title card at the start
 *  - Outro card at the end
 *  - MediaRecorder for export
 */

// ─────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────

const CANVAS_W = 540;
const CANVAS_H = 960;   // 9:16 vertical (TikTok / Reels)
const FPS = 30;

const QUALITY_BITRATE = { high: 4_000_000, medium: 2_000_000, low: 900_000 };

const FALLBACK_GRADIENTS = [
  ['#0d001a', '#2d1b69'],
  ['#030712', '#1e3a8a'],
  ['#1c0a00', '#9d174d'],
  ['#001a0a', '#14532d'],
  ['#0a0a0a', '#1a1a2e'],
];

// ─────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null); // silently fall back
    img.src = src;
  });
}

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t)   { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// ─────────────────────────────────────────────────────
// Drawing helpers
// ─────────────────────────────────────────────────────

/** Draw an image with Ken Burns (pan + zoom) effect. t = 0..1 */
function drawKenBurns(ctx, img, t, sceneIndex) {
  // Alternate between zoom-in and zoom-out, different pan directions
  const isEven = sceneIndex % 2 === 0;
  const scale  = isEven
    ? lerp(1.0, 1.12, easeInOut(t))
    : lerp(1.12, 1.0, easeInOut(t));

  // Pan direction based on scene index
  const panDirs = [
    { x: 0,    y: -0.03 }, // up
    { x: 0.03, y: 0     }, // right
    { x: 0,    y: 0.03  }, // down
    { x: -0.03, y: 0    }, // left
  ];
  const pan = panDirs[sceneIndex % panDirs.length];
  const panX = lerp(0, pan.x, easeInOut(t));
  const panY = lerp(0, pan.y, easeInOut(t));

  // Fit image to canvas (cover)
  const imgAspect    = img.naturalWidth / img.naturalHeight;
  const canvasAspect = CANVAS_W / CANVAS_H;
  let drawW, drawH;
  if (imgAspect > canvasAspect) {
    drawH = CANVAS_H * scale;
    drawW = drawH * imgAspect;
  } else {
    drawW = CANVAS_W * scale;
    drawH = drawW / imgAspect;
  }

  const x = (CANVAS_W - drawW) / 2 + panX * CANVAS_W;
  const y = (CANVAS_H - drawH) / 2 + panY * CANVAS_H;

  ctx.drawImage(img, x, y, drawW, drawH);
}

/** Draw a fallback gradient when no image is available */
function drawFallbackGradient(ctx, sceneIndex) {
  const [c1, c2] = FALLBACK_GRADIENTS[sceneIndex % FALLBACK_GRADIENTS.length];
  const grad = ctx.createLinearGradient(0, 0, CANVAS_W * 0.4, CANVAS_H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Subtle animated radial glow
  const cx = CANVAS_W * 0.5, cy = CANVAS_H * 0.35;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, CANVAS_W * 0.7);
  glow.addColorStop(0, 'rgba(168,85,247,0.25)');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** Dark gradient scrim over the bottom of the image for text readability */
function drawScrim(ctx, intensity = 0.75) {
  const grad = ctx.createLinearGradient(0, CANVAS_H * 0.45, 0, CANVAS_H);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, `rgba(0,0,0,${intensity})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Lighter top scrim for hook/title area
  const topGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H * 0.25);
  topGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
  topGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/** Caption at the bottom of the screen */
function drawCaption(ctx, text, style, alpha, t) {
  if (!text || style === 'none') return;

  ctx.globalAlpha = alpha;
  const padX = 28;
  const maxW  = CANVAS_W - padX * 2;

  if (style === 'bold_center') {
    ctx.font      = `bold ${Math.round(CANVAS_W * 0.072)}px -apple-system, Arial, sans-serif`;
    ctx.textAlign = 'center';
    const lines   = wrapText(ctx, text, maxW);
    const lineH   = Math.round(CANVAS_W * 0.085);
    const totalH  = lines.length * lineH;
    const baseY   = CANVAS_H * 0.75 - totalH / 2;

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur  = 12;
    ctx.fillStyle   = '#ffffff';
    lines.forEach((line, i) => ctx.fillText(line, CANVAS_W / 2, baseY + i * lineH));
    ctx.shadowBlur  = 0;

  } else if (style === 'typewriter') {
    const chars = Math.floor(t * text.length);
    const shown = text.slice(0, chars);
    ctx.font      = `600 ${Math.round(CANVAS_W * 0.058)}px -apple-system, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8f8f8';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10;
    ctx.fillText(shown, CANVAS_W / 2, CANVAS_H * 0.82);
    ctx.shadowBlur = 0;

  } else {
    // subtitle bar (default)
    ctx.font = `600 ${Math.round(CANVAS_W * 0.055)}px -apple-system, Arial, sans-serif`;
    const lines  = wrapText(ctx, text, maxW);
    const lineH  = Math.round(CANVAS_W * 0.065);
    const barH   = lines.length * lineH + 20;
    const barY   = CANVAS_H - barH - 24;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.roundRect(12, barY, CANVAS_W - 24, barH, 10);
    ctx.fill();

    ctx.fillStyle   = '#ffffff';
    ctx.textAlign   = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    lines.forEach((line, i) => {
      ctx.fillText(line, CANVAS_W / 2, barY + 16 + (i + 0.8) * lineH);
    });
    ctx.shadowBlur = 0;
  }

  ctx.globalAlpha = 1;
}

/** Hook / title card drawn at the very start */
function drawHookCard(ctx, hook, alpha) {
  ctx.globalAlpha = alpha;

  const fontSize = Math.round(CANVAS_W * 0.076);
  ctx.font = `bold ${fontSize}px -apple-system, Arial, sans-serif`;
  ctx.textAlign = 'center';

  const lines = wrapText(ctx, hook, CANVAS_W * 0.82);
  const lineH = fontSize * 1.3;
  const totalH = lines.length * lineH + 40;
  const startY = (CANVAS_H - totalH) / 2 - 20;

  // Card background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(24, startY - 16, CANVAS_W - 48, totalH, 18);
  ctx.fill();

  // Accent top bar
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.roundRect(24, startY - 16, CANVAS_W - 48, 5, [18, 18, 0, 0]);
  ctx.fill();

  ctx.fillStyle   = '#ffffff';
  ctx.shadowColor = 'rgba(120,50,220,0.5)'; ctx.shadowBlur = 20;
  lines.forEach((line, i) => {
    ctx.fillText(line, CANVAS_W / 2, startY + i * lineH + lineH * 0.6);
  });
  ctx.shadowBlur = 0;

  ctx.globalAlpha = 1;
}

/** Outro card */
function drawOutroCard(ctx, outro, hashtags, alpha) {
  ctx.globalAlpha = alpha;

  const fontSize = Math.round(CANVAS_W * 0.065);
  ctx.font = `bold ${fontSize}px -apple-system, Arial, sans-serif`;
  ctx.textAlign = 'center';

  const lines = wrapText(ctx, outro, CANVAS_W * 0.8);
  const lineH = fontSize * 1.35;

  // Pill CTA
  const ctaW = CANVAS_W * 0.78;
  const ctaH = lines.length * lineH + 28;
  const ctaX = (CANVAS_W - ctaW) / 2;
  const ctaY = CANVAS_H * 0.78;

  const grad = ctx.createLinearGradient(ctaX, 0, ctaX + ctaW, 0);
  grad.addColorStop(0, '#7c3aed');
  grad.addColorStop(1, '#2563eb');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(ctaX, ctaY, ctaW, ctaH, 14);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  lines.forEach((line, i) => {
    ctx.fillText(line, CANVAS_W / 2, ctaY + 20 + (i + 0.75) * lineH);
  });

  // Hashtags
  if (hashtags.length > 0) {
    const tagStr = hashtags.slice(0, 5).map(h => `#${h}`).join('  ');
    ctx.font = `${Math.round(CANVAS_W * 0.038)}px -apple-system, Arial, sans-serif`;
    ctx.fillStyle = 'rgba(200,180,255,0.85)';
    ctx.fillText(tagStr, CANVAS_W / 2, ctaY + ctaH + 26);
  }

  ctx.globalAlpha = 1;
}

/** Episode / series badge in top-right corner */
function drawBadge(ctx, label) {
  if (!label) return;
  ctx.font = `bold ${Math.round(CANVAS_W * 0.04)}px -apple-system, Arial, sans-serif`;
  const tw = ctx.measureText(label).width;
  const bw = tw + 20, bh = 28, bx = CANVAS_W - bw - 12, by = 14;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(124,58,237,0.6)'; ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#c4b5fd';
  ctx.textAlign = 'center';
  ctx.fillText(label, bx + bw / 2, by + 18);
}

/** Bottom progress bar */
function drawProgressBar(ctx, progress) {
  const h = 4;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(0, CANVAS_H - h, CANVAS_W, h);
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(0, CANVAS_H - h, CANVAS_W * progress, h);
}

/** Crossfade overlay between two scenes */
function drawTransitionOverlay(ctx, transitionT, transitionType, prevImg, sceneIndex) {
  if (transitionType === 'cut') return;

  if (transitionType === 'slide') {
    // Draw previous scene shifted out to the right
    if (prevImg) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - transitionT * 2);
      ctx.translate(CANVAS_W * transitionT, 0);
      ctx.drawImage(prevImg, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  } else if (transitionType === 'zoom') {
    if (transitionT < 0.5) {
      const scale = 1 + transitionT * 0.15;
      ctx.save();
      ctx.globalAlpha = 1 - transitionT * 2;
      ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
      if (prevImg) ctx.drawImage(prevImg, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  } else {
    // crossfade — black fade through
    const fadeAlpha = transitionT < 0.5
      ? transitionT * 2
      : (1 - transitionT) * 2;
    ctx.globalAlpha = Math.min(1, fadeAlpha);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;
  }
}

// ─────────────────────────────────────────────────────
// Main render function
// ─────────────────────────────────────────────────────

/**
 * Render a single video from a VideoScript object.
 *
 * @param {import('./grok-api.js').VideoScript} script
 * @param {Object} options
 * @param {string}   options.captionStyle   'subtitle' | 'bold_center' | 'typewriter' | 'none'
 * @param {string}   options.transition     'crossfade' | 'slide' | 'zoom' | 'cut'
 * @param {string}   options.quality        'high' | 'medium' | 'low'
 * @param {function} options.onProgress     (0-100)
 * @returns {Promise<Blob>}
 */
export function renderVideo(script, options = {}) {
  return new Promise(async (resolve, reject) => {
    const {
      captionStyle = 'subtitle',
      transition   = 'crossfade',
      quality      = 'medium',
      onProgress,
    } = options;

    // Pre-load all images
    const images = await Promise.all(
      script.scenes.map(s => loadImage(s.imageDataUrl))
    );

    // Build frame timeline
    const HOOK_SECS  = 1.5;
    const OUTRO_SECS = 2.5;
    const TRANS_SECS = 0.4; // transition overlap duration

    const segments = [];

    // Hook card
    segments.push({ type: 'hook', duration: HOOK_SECS, text: script.hook });

    // Scenes
    script.scenes.forEach((scene, i) => {
      segments.push({
        type:      'scene',
        duration:  scene.duration || 5,
        scene,
        img:       images[i],
        prevImg:   i > 0 ? images[i - 1] : null,
        index:     i,
      });
    });

    // Outro
    segments.push({ type: 'outro', duration: OUTRO_SECS });

    const totalDuration = segments.reduce((s, seg) => s + seg.duration, 0);
    const totalFrames   = Math.ceil(totalDuration * FPS);

    // Canvas + recorder setup
    const canvas  = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx     = canvas.getContext('2d');

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(canvas.captureStream(FPS), {
      mimeType,
      videoBitsPerSecond: QUALITY_BITRATE[quality] || QUALITY_BITRATE.medium,
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = e => reject(new Error(e.error?.message || 'MediaRecorder error'));
    recorder.start();

    // ── Frame loop ──
    let frameNum = 0;

    function renderFrame() {
      if (frameNum >= totalFrames) {
        recorder.stop();
        return;
      }

      const globalT   = frameNum / totalFrames;
      const timeSec   = frameNum / FPS;
      onProgress?.(Math.round(globalT * 100));

      // Find which segment we're in
      let elapsed = 0;
      let seg = null;
      for (const s of segments) {
        if (timeSec < elapsed + s.duration) { seg = s; break; }
        elapsed += s.duration;
      }
      if (!seg) { recorder.stop(); return; }

      const localT = (timeSec - elapsed) / seg.duration; // 0..1 within segment

      // ── Segment rendering ──
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      if (seg.type === 'hook') {
        // Hook: gradient BG + centered title card
        drawFallbackGradient(ctx, 0);
        const alpha = localT < 0.15 ? localT / 0.15
                    : localT > 0.85 ? (1 - localT) / 0.15
                    : 1;
        drawHookCard(ctx, seg.text, alpha);

      } else if (seg.type === 'scene') {
        const { img, index, scene, prevImg } = seg;

        // Transition phase at start of scene
        const isTransition = localT < (TRANS_SECS / seg.duration);
        const transT = isTransition ? localT / (TRANS_SECS / seg.duration) : 1;

        // Draw current scene with Ken Burns
        if (img) {
          drawKenBurns(ctx, img, localT, index);
        } else {
          drawFallbackGradient(ctx, index);
        }
        drawScrim(ctx);

        // Transition overlay (fades prev scene out)
        if (isTransition && index > 0) {
          drawTransitionOverlay(ctx, transT, transition, prevImg, index);
        }

        // Caption fades in after transition
        const captionAlpha = localT < (TRANS_SECS / seg.duration) * 1.5
          ? 0
          : Math.min(1, (localT - TRANS_SECS / seg.duration * 1.5) / 0.12);

        drawCaption(ctx, scene.caption, captionStyle, captionAlpha, localT);
        drawBadge(ctx, script.episode);

      } else if (seg.type === 'outro') {
        // Use last scene image as BG
        const lastImg = images[images.length - 1];
        if (lastImg) {
          ctx.drawImage(lastImg, 0, 0, CANVAS_W, CANVAS_H);
        } else {
          drawFallbackGradient(ctx, script.scenes.length);
        }
        drawScrim(ctx, 0.85);

        const alpha = localT < 0.2 ? localT / 0.2 : 1;
        drawOutroCard(ctx, script.outro, script.hashtags, alpha);
      }

      drawProgressBar(ctx, globalT);

      frameNum++;
      requestAnimationFrame(renderFrame);
    }

    renderFrame();
  });
}

/**
 * Render all videos in a project, one at a time.
 *
 * @param {import('./grok-api.js').StoryProject} project
 * @param {Object}   options   Same options as renderVideo
 * @param {function} onVideoStart    (index)
 * @param {function} onVideoProgress (index, 0-100)
 * @param {function} onVideoDone     (index, blob)
 * @returns {Promise<Blob[]>}
 */
export async function renderProject(project, options, onVideoStart, onVideoProgress, onVideoDone) {
  const blobs = [];
  for (let i = 0; i < project.videos.length; i++) {
    onVideoStart?.(i);
    const blob = await renderVideo(project.videos[i], {
      ...options,
      onProgress: p => onVideoProgress?.(i, p),
    });
    blobs.push(blob);
    onVideoDone?.(i, blob);
  }
  return blobs;
}

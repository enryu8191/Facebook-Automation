/**
 * Image-based video renderer — no captions, no text overlays.
 *
 * Each scene image plays with a Ken Burns (pan + zoom) effect.
 * Scenes are joined with the chosen transition (crossfade / slide / zoom / cut).
 * Output: WebM blob via MediaRecorder.
 *
 * Users add their own captions, music, and sounds in CapCut / their editor.
 */

const CANVAS_W = 540;
const CANVAS_H = 960;   // 9:16 vertical — TikTok / Reels
const FPS      = 30;

const QUALITY_BITRATE = { high: 4_000_000, medium: 2_000_000, low: 900_000 };

// Fallback gradients when a scene has no image
const FALLBACKS = [
  ['#0d001a', '#2d1b69'],
  ['#030712', '#1e3a8a'],
  ['#1c0a00', '#9d174d'],
  ['#001a0a', '#14532d'],
  ['#0a0a0a', '#1a1a2e'],
];

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function lerp(a, b, t)  { return a + (b - a) * t; }
function easeIO(t)       { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

// ─────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────

/** Draw image with Ken Burns effect. t = 0..1 within scene */
function drawKenBurns(ctx, img, t, sceneIdx) {
  const zoomIn = sceneIdx % 2 === 0;
  const scale  = zoomIn
    ? lerp(1.0, 1.12, easeIO(t))
    : lerp(1.12, 1.0, easeIO(t));

  const pans = [
    { x: 0,     y: -0.03 },
    { x: 0.03,  y:  0    },
    { x: 0,     y:  0.03 },
    { x: -0.03, y:  0    },
  ];
  const pan  = pans[sceneIdx % pans.length];
  const panX = lerp(0, pan.x, easeIO(t));
  const panY = lerp(0, pan.y, easeIO(t));

  // Cover-fit
  const ia = img.naturalWidth / img.naturalHeight;
  const ca = CANVAS_W / CANVAS_H;
  let dw, dh;
  if (ia > ca) { dh = CANVAS_H * scale; dw = dh * ia; }
  else          { dw = CANVAS_W * scale; dh = dw / ia; }

  const x = (CANVAS_W - dw) / 2 + panX * CANVAS_W;
  const y = (CANVAS_H - dh) / 2 + panY * CANVAS_H;
  ctx.drawImage(img, x, y, dw, dh);
}

/** Gradient fallback when no image */
function drawFallback(ctx, idx) {
  const [c1, c2] = FALLBACKS[idx % FALLBACKS.length];
  const g = ctx.createLinearGradient(0, 0, CANVAS_W * 0.4, CANVAS_H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/**
 * Transition between previous and current scene image.
 * transitionT = 0..1 (how far through the transition we are)
 */
function drawTransition(ctx, transitionT, type, prevImg, sceneIdx) {
  if (type === 'cut') return;

  if (type === 'slide') {
    if (prevImg) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - transitionT * 2.5);
      ctx.translate(CANVAS_W * transitionT, 0);
      ctx.drawImage(prevImg, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  } else if (type === 'zoom') {
    if (prevImg && transitionT < 0.5) {
      const scale = 1 + transitionT * 0.18;
      ctx.save();
      ctx.globalAlpha = 1 - transitionT * 2;
      ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
      ctx.scale(scale, scale);
      ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
      ctx.drawImage(prevImg, 0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
  } else {
    // crossfade — dip to black
    const fade = transitionT < 0.5 ? transitionT * 2 : (1 - transitionT) * 2;
    ctx.globalAlpha = Math.min(1, fade);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;
  }
}

// ─────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────

/**
 * Render a single video from a VideoScript.
 *
 * @param {import('./grok-api.js').VideoScript} script
 * @param {Object}   options
 * @param {string}   options.transition  'crossfade' | 'slide' | 'zoom' | 'cut'
 * @param {string}   options.quality     'high' | 'medium' | 'low'
 * @param {function} options.onProgress  (0-100)
 * @returns {Promise<Blob>}
 */
export function renderVideo(script, options = {}) {
  return new Promise(async (resolve, reject) => {
    const {
      transition = 'crossfade',
      quality    = 'medium',
      onProgress,
    } = options;

    const TRANS_SECS = 0.35; // seconds spent on transition between scenes

    // Pre-load all scene images
    const images = await Promise.all(
      script.scenes.map(s => loadImage(s.imageDataUrl))
    );

    // Build timeline — just scenes, no hook/outro text cards
    const totalDuration = script.scenes.reduce((sum, s) => sum + (s.duration || 5), 0);
    const totalFrames   = Math.ceil(totalDuration * FPS);

    // Canvas + MediaRecorder
    const canvas  = document.createElement('canvas');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx     = canvas.getContext('2d');

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(canvas.captureStream(FPS), {
      mimeType,
      videoBitsPerSecond: QUALITY_BITRATE[quality] ?? QUALITY_BITRATE.medium,
    });

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop  = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = e => reject(new Error(e.error?.message ?? 'MediaRecorder error'));
    recorder.start();

    // Pre-compute scene start times
    let t = 0;
    const sceneTimes = script.scenes.map(s => {
      const start = t;
      t += s.duration || 5;
      return start;
    });

    let frameNum = 0;

    function renderFrame() {
      if (frameNum >= totalFrames) {
        recorder.stop();
        return;
      }

      const timeSec = frameNum / FPS;
      onProgress?.(Math.round((frameNum / totalFrames) * 100));

      // Which scene are we in?
      let sceneIdx = script.scenes.length - 1;
      for (let i = 0; i < sceneTimes.length; i++) {
        if (timeSec < sceneTimes[i] + (script.scenes[i].duration || 5)) {
          sceneIdx = i;
          break;
        }
      }

      const sceneStart = sceneTimes[sceneIdx];
      const sceneDur   = script.scenes[sceneIdx].duration || 5;
      const localT     = (timeSec - sceneStart) / sceneDur; // 0..1
      const img        = images[sceneIdx];
      const prevImg    = sceneIdx > 0 ? images[sceneIdx - 1] : null;
      const isTransition = localT < TRANS_SECS / sceneDur;
      const transT       = isTransition ? localT / (TRANS_SECS / sceneDur) : 1;

      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      // Draw current scene
      if (img) {
        drawKenBurns(ctx, img, localT, sceneIdx);
      } else {
        drawFallback(ctx, sceneIdx);
      }

      // Transition overlay
      if (isTransition && sceneIdx > 0) {
        drawTransition(ctx, transT, transition, prevImg, sceneIdx);
      }

      frameNum++;
      requestAnimationFrame(renderFrame);
    }

    renderFrame();
  });
}

/**
 * Render all videos in a project and call back as each finishes.
 *
 * @param {import('./grok-api.js').StoryProject} project
 * @param {Object}   options
 * @param {function} onVideoProgress (videoIndex, 0-100)
 * @param {function} onVideoDone     (videoIndex, Blob)
 * @returns {Promise<Blob[]>}
 */
export async function renderProject(project, options, onVideoProgress, onVideoDone) {
  const blobs = [];
  for (let i = 0; i < project.videos.length; i++) {
    const blob = await renderVideo(project.videos[i], {
      ...options,
      onProgress: p => onVideoProgress?.(i, p),
    });
    blobs.push(blob);
    onVideoDone?.(i, blob);
  }
  return blobs;
}

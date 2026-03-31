/**
 * Grok Web Bridge — Script generation + Grok Imagine image generation
 *
 * No API key. Communicates via background.js → content/grok-bridge.js
 * which controls the live grok.com tab.
 */

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} Scene
 * @property {number} index
 * @property {string} narration        Spoken narration text for this scene
 * @property {string} caption          Short on-screen caption (max 8 words)
 * @property {string} imagePrompt      Prompt sent to Grok Imagine
 * @property {string} [imageDataUrl]   Base64 data URL once image is generated
 * @property {number} duration         Seconds this scene plays
 */

/**
 * @typedef {Object} VideoScript
 * @property {string}  title
 * @property {string}  hook             Opening text (shown before scene 1)
 * @property {Scene[]} scenes
 * @property {string}  outro            Closing caption / CTA
 * @property {string[]} hashtags
 * @property {string}  episode          e.g. "Episode 1" or "" for single video
 */

/**
 * @typedef {Object} StoryProject
 * @property {string}        seriesTitle   "" for single video
 * @property {string}        description
 * @property {VideoScript[]} videos
 */

// ─────────────────────────────────────────────────────────
// Low-level bridge helpers
// ─────────────────────────────────────────────────────────

/**
 * Send a text prompt to Grok via the content script bridge.
 * Returns the full text response.
 */
export function askGrok(prompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'GROK_PROMPT', prompt, expectImage: false },
      (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.error) return reject(new Error(res.error));
        resolve(res?.text ?? '');
      }
    );
  });
}

/**
 * Send an image generation prompt to Grok Imagine.
 * Returns a data URL of the first generated image.
 */
export function askGrokImagine(imagePrompt) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'GROK_PROMPT', prompt: imagePrompt, expectImage: true },
      (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.error) return reject(new Error(res.error));
        resolve(res?.imageDataUrl ?? null);
      }
    );
  });
}

// ─────────────────────────────────────────────────────────
// Script generation
// ─────────────────────────────────────────────────────────

/**
 * Build the art-style suffix appended to every image prompt.
 */
function buildStyleSuffix(artStyle, mood, shotType) {
  const styleMap = {
    cinematic:    'cinematic photography, film grain, anamorphic lens',
    anime:        'anime illustration, Studio Ghibli style, detailed',
    cartoon:      'vibrant cartoon illustration, bold outlines',
    realistic:    'ultra-realistic photography, hyperdetailed, 8K',
    oil_painting: 'oil painting, thick brushstrokes, museum quality',
    watercolor:   'soft watercolor illustration, delicate washes',
    pixel_art:    'pixel art, 16-bit, retro game aesthetic',
    dark_fantasy: 'dark fantasy concept art, dramatic, detailed',
    lofi:         'lo-fi aesthetic, cozy, warm tones, illustrated',
  };
  const moodMap = {
    dramatic: 'dramatic lighting, high contrast',
    soft:     'soft diffused lighting, pastel tones',
    dark:     'dark moody atmosphere, deep shadows',
    vibrant:  'vibrant saturated colors, energetic',
    golden:   'golden hour lighting, warm glow',
    neon:     'neon lights, cyberpunk palette',
  };
  const shotMap = {
    closeup: 'extreme close-up shot',
    wide:    'wide establishing shot',
    pov:     'first-person POV shot',
    aerial:  'aerial bird\'s eye view',
    varied:  '',
  };

  return [styleMap[artStyle], moodMap[mood], shotMap[shotType]]
    .filter(Boolean).join(', ');
}

/**
 * Generate the full project (scripts for all videos) in one Grok call.
 *
 * @param {Object} params
 * @param {string}   params.story
 * @param {string}   params.format         'single' | 'series'
 * @param {number}   params.episodeCount   ignored when format=single
 * @param {number}   params.sceneCount     scenes per video
 * @param {string}   params.artStyle
 * @param {string}   params.mood
 * @param {string}   params.shotType
 * @param {function} params.onProgress
 * @returns {Promise<StoryProject>}
 */
export async function generateScripts(params) {
  const {
    story, format, episodeCount, sceneCount,
    artStyle, mood, shotType, onProgress,
  } = params;

  const isSeries  = format === 'series';
  const numVideos = isSeries ? episodeCount : 1;
  const styleSuffix = buildStyleSuffix(artStyle, mood, shotType);

  onProgress?.(5);

  const prompt =
`You are a short-form video director for TikTok/Reels.

Create ${numVideos === 1 ? 'a single short video' : `a ${numVideos}-episode short video series`} based on this idea:
"${story}"

${isSeries ? 'Each episode should be a self-contained story beat that builds into a complete arc across all episodes.' : ''}

For EACH video, write ${sceneCount} scenes. Each scene needs:
- A narration line (what the viewer hears, 1-2 sentences)
- A caption (max 8 words shown on screen)
- An image_prompt (a vivid visual description for AI image generation, append this style: "${styleSuffix}")
- A duration in seconds (4-8s per scene)

Reply with ONLY valid JSON, no markdown, no explanation:

{
  "seriesTitle": "${isSeries ? 'series title here' : ''}",
  "description": "one sentence description",
  "videos": [
    {
      "title": "video title",
      "hook": "opening hook text (shown before scene 1, max 10 words)",
      "episode": "${isSeries ? 'Episode 1' : ''}",
      "scenes": [
        {
          "index": 0,
          "narration": "narration text for this scene",
          "caption": "short on-screen caption",
          "imagePrompt": "vivid image description, ${styleSuffix}",
          "duration": 5
        }
      ],
      "outro": "closing CTA or final caption",
      "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
    }
  ]
}`;

  const raw = await askGrok(prompt);
  onProgress?.(60);

  // Parse JSON
  let project;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    project = JSON.parse(cleaned);
  } catch {
    const match = raw.match(/\{[\s\S]*"videos"[\s\S]*\}/);
    if (!match) throw new Error('Grok returned an unexpected format. Please try again.');
    project = JSON.parse(match[0]);
  }

  if (!Array.isArray(project.videos) || project.videos.length === 0) {
    throw new Error('No videos returned. Try rephrasing your idea.');
  }

  // Normalize
  project.videos = project.videos.map((v, vi) => ({
    title:    v.title    || `Video ${vi + 1}`,
    hook:     v.hook     || '',
    episode:  v.episode  || '',
    outro:    v.outro    || 'Follow for more',
    hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
    scenes:   (v.scenes || []).slice(0, sceneCount).map((s, si) => ({
      index:       si,
      narration:   s.narration   || '',
      caption:     s.caption     || '',
      imagePrompt: s.imagePrompt || `${story}, scene ${si + 1}, ${styleSuffix}`,
      duration:    Number(s.duration) || 5,
      imageDataUrl: null,
    })),
  }));

  onProgress?.(75);
  return project;
}

// ─────────────────────────────────────────────────────────
// Image generation — one scene at a time
// ─────────────────────────────────────────────────────────

/**
 * Generate the image for a single scene via Grok Imagine.
 * Updates scene.imageDataUrl in-place and calls onImage callback.
 *
 * @param {Scene}    scene
 * @param {function} onImage  (scene) => void  called when image arrives
 */
export async function generateSceneImage(scene, onImage) {
  try {
    const dataUrl = await askGrokImagine(scene.imagePrompt);
    if (dataUrl) {
      scene.imageDataUrl = dataUrl;
      onImage?.(scene);
    }
  } catch (err) {
    // Non-fatal: scene will render with gradient fallback
    console.warn(`Image generation failed for scene ${scene.index}:`, err.message);
    scene.imageDataUrl = null;
    onImage?.(scene);
  }
}

/**
 * Generate images for every scene across all videos, sequentially.
 * Calls onProgress and onSceneImage for each result.
 *
 * @param {StoryProject} project
 * @param {function}     onProgress    (0-100)
 * @param {function}     onSceneImage  (videoIndex, scene)
 */
export async function generateAllImages(project, onProgress, onSceneImage) {
  const allScenes = project.videos.flatMap((v, vi) =>
    v.scenes.map(s => ({ scene: s, vi }))
  );
  const total = allScenes.length;

  for (let i = 0; i < total; i++) {
    const { scene, vi } = allScenes[i];
    await generateSceneImage(scene, (s) => onSceneImage?.(vi, s));
    onProgress?.(Math.round(((i + 1) / total) * 100));
  }
}

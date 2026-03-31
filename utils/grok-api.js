/**
 * Grok Web Bridge
 * Instead of an API key, this module sends a message to the background
 * service worker which opens grok.com, injects the prompt via a content
 * script, waits for the full response, then returns the text.
 *
 * No API key required — just a logged-in Grok session.
 */

/**
 * @typedef {Object} VideoScript
 * @property {string} title
 * @property {string} hook
 * @property {string[]} scenes
 * @property {string} narration
 * @property {string} callToAction
 * @property {string[]} hashtags
 * @property {string} emoji
 * @property {string} bgKeyword
 */

/**
 * @typedef {Object} VideoSeries
 * @property {string} seriesTitle
 * @property {string} description
 * @property {VideoScript[]} videos
 */

/**
 * Ask Grok a question via the browser bridge.
 * Sends a message to background.js which controls the Grok tab.
 *
 * @param {string} prompt
 * @param {function} onProgress  optional (0-100)
 * @returns {Promise<string>}    raw text response from Grok
 */
export async function askGrokViaBrowser(prompt, onProgress) {
  return new Promise((resolve, reject) => {
    onProgress?.(5);

    chrome.runtime.sendMessage(
      { type: 'GROK_PROMPT', prompt },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (response?.error) {
          return reject(new Error(response.error));
        }
        onProgress?.(80);
        resolve(response?.text ?? '');
      }
    );
  });
}

/**
 * Generate a complete video series by prompting Grok via its web UI.
 *
 * @param {Object} params
 * @param {string} params.topic
 * @param {string} params.audience
 * @param {number} params.videoCount
 * @param {number} params.duration      seconds per video
 * @param {string} params.style
 * @param {string} params.language
 * @param {boolean} params.includeHashtags
 * @param {function} params.onProgress
 * @returns {Promise<VideoSeries>}
 */
export async function generateVideoSeries(params) {
  const {
    topic, audience, videoCount, duration,
    style, language, includeHashtags, onProgress,
  } = params;

  const styleGuide = {
    educational:  'informative, fact-based, teaches something new in each video',
    motivational: 'inspiring, uplifting, energetic, pushes viewer to take action',
    storytelling: 'narrative-driven, emotional, builds a story arc across videos',
    tutorial:     'step-by-step, practical, actionable, shows exactly how to do it',
    entertainment:'funny, engaging, surprising, keeps viewer hooked with humor or shock',
  }[style] || 'engaging and informative';

  const languageNote = language !== 'en'
    ? `Write all content in ${language} language.`
    : '';

  const hashtagNote = includeHashtags
    ? `"hashtags": ["tag1","tag2","tag3","tag4","tag5"]`
    : `"hashtags": []`;

  const prompt =
`You are a viral short-form video script writer for TikTok/Reels.

Create a series of ${videoCount} short videos (~${duration}s each) about: "${topic}"
Target audience: ${audience || 'general social media users'}
Style: ${styleGuide}
${languageNote}

IMPORTANT: Reply with ONLY a valid JSON object, no markdown, no explanation, no code fences.

{
  "seriesTitle": "punchy series title (4-7 words)",
  "description": "1-2 sentence description",
  "videos": [
    {
      "title": "short punchy title (3-6 words)",
      "hook": "grabbing opening sentence — surprising or asks a question",
      "scenes": [
        "scene 1 on-screen text (5-10 words)",
        "scene 2 on-screen text",
        "scene 3 on-screen text",
        "scene 4 on-screen text"
      ],
      "narration": "full spoken narration (~${Math.round(duration * 2.5)} words)",
      "callToAction": "closing CTA sentence",
      ${hashtagNote},
      "emoji": "🎯",
      "bgKeyword": "abstract"
    }
  ]
}

Make ${videoCount} unique videos with different angles. Use powerful hooks and clear takeaways.`;

  onProgress?.(10);

  const raw = await askGrokViaBrowser(prompt, p => onProgress?.(10 + p * 0.7));

  onProgress?.(85);

  // Parse JSON — strip any accidental markdown fences Grok might add
  let series;
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    series = JSON.parse(cleaned);
  } catch {
    // Try extracting a JSON block from the response
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Grok did not return valid JSON. Try again.');
    series = JSON.parse(match[0]);
  }

  if (!Array.isArray(series.videos)) {
    throw new Error('Unexpected response format from Grok. Please try again.');
  }

  // Normalize
  series.videos = series.videos.slice(0, videoCount).map((v, i) => ({
    title:        v.title        || `Video ${i + 1}`,
    hook:         v.hook         || '',
    scenes:       Array.isArray(v.scenes) ? v.scenes : [],
    narration:    v.narration    || '',
    callToAction: v.callToAction || 'Follow for more!',
    hashtags:     Array.isArray(v.hashtags) ? v.hashtags : [],
    emoji:        v.emoji        || '🎬',
    bgKeyword:    v.bgKeyword    || 'abstract',
  }));

  onProgress?.(100);
  return series;
}

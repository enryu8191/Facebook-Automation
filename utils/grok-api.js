/**
 * Grok API client for xAI
 * Compatible with the OpenAI chat completions API format
 */

const GROK_API_BASE = 'https://api.x.ai/v1';

/**
 * @typedef {Object} VideoScript
 * @property {string} title         - Short punchy title (3-6 words)
 * @property {string} hook          - Opening hook sentence (grabs attention in 3s)
 * @property {string[]} scenes      - Array of scene text segments (2-4 words each)
 * @property {string} narration     - Full narration text for the video
 * @property {string} callToAction  - Closing CTA ("Follow for more...", "Try this today...")
 * @property {string[]} hashtags    - 5-8 relevant hashtags (without #)
 * @property {string} emoji         - Single representative emoji
 * @property {string} bgKeyword     - Background visual keyword (e.g. "cosmos", "city", "forest")
 */

/**
 * @typedef {Object} VideoSeries
 * @property {string} seriesTitle   - Overall series title
 * @property {string} description   - Series description
 * @property {VideoScript[]} videos - Array of individual video scripts
 */

/**
 * Call the Grok API
 * @param {string} apiKey
 * @param {string} model
 * @param {Object[]} messages
 * @param {Object} opts
 * @returns {Promise<string>}
 */
export async function callGrok(apiKey, model, messages, opts = {}) {
  const resp = await fetch(`${GROK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.85,
      max_tokens: opts.maxTokens ?? 4096,
      ...opts.extra,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      `Grok API error ${resp.status}: ${err.error?.message || resp.statusText}`
    );
  }

  const data = await resp.json();
  return data.choices[0].message.content;
}

/**
 * Generate a complete video series using Grok
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.topic         - User's topic/idea
 * @param {string} params.audience      - Target audience
 * @param {number} params.videoCount    - Number of videos to generate
 * @param {number} params.duration      - Duration per video (seconds)
 * @param {string} params.style         - Video style (educational, motivational, etc.)
 * @param {string} params.language      - Language code
 * @param {boolean} params.includeHashtags
 * @param {function} params.onProgress  - Progress callback (0-100)
 * @returns {Promise<VideoSeries>}
 */
export async function generateVideoSeries(params) {
  const {
    apiKey, model, topic, audience, videoCount,
    duration, style, language, includeHashtags, onProgress,
  } = params;

  onProgress?.(5);

  const styleGuide = {
    educational: 'informative, fact-based, teaches something new in each video',
    motivational: 'inspiring, uplifting, energetic, pushes the viewer to take action',
    storytelling: 'narrative-driven, emotional, builds a story arc across videos',
    tutorial: 'step-by-step, practical, actionable, shows exactly how to do something',
    entertainment: 'funny, engaging, surprising, keeps viewer hooked with humor or shock',
  }[style] || 'engaging and informative';

  const languageNote = language !== 'en'
    ? `Write all content in ${language} language.`
    : '';

  const prompt = `You are a viral short-form video script writer specializing in TikTok/Reels content.

Create a series of ${videoCount} short videos (each ~${duration} seconds) about: "${topic}"
Target audience: ${audience || 'general social media users'}
Style: ${styleGuide}
${languageNote}

Each video should be a standalone piece that can also work as part of a series.

Return ONLY a valid JSON object in this exact format (no markdown, no explanation):
{
  "seriesTitle": "The overall series title (punchy, 4-7 words)",
  "description": "1-2 sentence series description",
  "videos": [
    {
      "title": "Short punchy title (3-6 words)",
      "hook": "Opening hook sentence that grabs attention in the first 3 seconds. End with a question or surprising statement.",
      "scenes": [
        "Scene 1 text (5-10 words shown on screen)",
        "Scene 2 text",
        "Scene 3 text",
        "Scene 4 text"
      ],
      "narration": "Full narration text for the video (${Math.round(duration * 2.5)} words approx). Write as if speaking to camera.",
      "callToAction": "Closing call-to-action (1 sentence)",
      "hashtags": ${includeHashtags ? '["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]' : '[]'},
      "emoji": "🎯",
      "bgKeyword": "abstract"
    }
  ]
}

Make each video unique with a different angle on the topic. Use powerful hooks, concrete examples, and clear takeaways.`;

  onProgress?.(15);

  const raw = await callGrok(apiKey, model, [
    { role: 'system', content: 'You are a viral video content creator. Always respond with valid JSON only, no markdown or extra text.' },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, maxTokens: 6000 });

  onProgress?.(70);

  // Parse and validate the response
  let series;
  try {
    // Strip potential markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    series = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Grok response as JSON. Raw: ${raw.slice(0, 200)}`);
  }

  if (!series.videos || !Array.isArray(series.videos)) {
    throw new Error('Invalid response structure from Grok API');
  }

  // Normalize / fill defaults for any missing fields
  series.videos = series.videos.map((v, i) => ({
    title: v.title || `Video ${i + 1}`,
    hook: v.hook || '',
    scenes: Array.isArray(v.scenes) ? v.scenes : [],
    narration: v.narration || '',
    callToAction: v.callToAction || 'Follow for more!',
    hashtags: Array.isArray(v.hashtags) ? v.hashtags : [],
    emoji: v.emoji || '🎬',
    bgKeyword: v.bgKeyword || 'abstract',
  }));

  onProgress?.(85);
  return series;
}

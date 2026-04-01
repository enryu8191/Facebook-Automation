/**
 * Niche presets — click a card to pre-fill everything.
 * Each preset sets: story prompt, art style, mood, shot type,
 * transition, caption style, format, and scene count.
 */

export const NICHES = [
  // ──────────────────────────────────────────────
  //  YOUR OWN IDEA
  // ──────────────────────────────────────────────
  {
    id: 'original',
    name: 'Your Own Idea',
    emoji: '✍️',
    tag: 'Custom',
    tagColor: '#475569',
    description: 'Write your own story or topic from scratch.',
    prompt: '',   // user fills this in themselves
    artStyle: 'cinematic',
    mood: 'dramatic',
    shotType: 'varied',
    transition: 'crossfade',
    format: 'single',
    sceneCount: 5,
    previewColors: ['#1e293b', '#334155'],
  },

  // ──────────────────────────────────────────────
  //  3D SKELETON CHARACTERS
  // ──────────────────────────────────────────────
  {
    id: 'skeleton',
    name: '3D Skeleton',
    emoji: '💀',
    tag: '🔥 Viral',
    tagColor: '#ef4444',
    description: 'A funny skeleton living everyday human life — relatable & hilarious.',
    prompt:
      'A funny 3D skeleton character with glowing eyes goes through relatable everyday moments: ' +
      'waking up groggy, drinking coffee, scrolling on a phone, going to the gym and flexing bones, ' +
      'cooking dinner with tiny skeleton hands, watching TV on the couch. ' +
      'Humorous and expressive. Each scene is a different slice-of-life moment.',
    artStyle: 'cartoon',
    mood: 'vibrant',
    shotType: 'varied',
    transition: 'cut',
    format: 'single',
    sceneCount: 6,
    previewColors: ['#1a0533', '#2d1b69'],
    sampleImageHint: '3D cartoon skeleton character with glowing eyes, funny expression',
  },

  // ──────────────────────────────────────────────
  //  AI FOOD CHARACTERS
  // ──────────────────────────────────────────────
  {
    id: 'food',
    name: 'AI Food Characters',
    emoji: '🍕',
    tag: '🔥 Viral',
    tagColor: '#ef4444',
    description: 'Cute food characters with faces & arms going on tiny adventures.',
    prompt:
      'Adorable AI-generated food characters with big expressive eyes, tiny arms and legs, and cute faces: ' +
      'a cheeseburger, a slice of pizza, a taco, and a hot dog are best friends going on adventures in a giant kitchen world. ' +
      'They explore the fridge, race across the countertop, get chased by a fork, ' +
      'and have a dance party on the cutting board. Cute, colorful, and fun for all ages.',
    artStyle: 'cartoon',
    mood: 'vibrant',
    shotType: 'closeup',
    transition: 'zoom',
    format: 'single',
    sceneCount: 5,
    previewColors: ['#7c2d12', '#c2410c'],
    sampleImageHint: 'cute cartoon food character with face and arms, big eyes, colorful',
  },
];

/**
 * Get a niche by id.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getNicheById(id) {
  return NICHES.find(n => n.id === id);
}

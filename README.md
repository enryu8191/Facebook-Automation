# Grok Video Series Generator — Chrome Extension

Generate TikTok/Reels-style short video series using **Grok AI** (xAI) directly from your browser. Input a topic, choose a style, and get a fully rendered, downloadable video series in seconds.

---

## Features

- **AI-powered scripts** — Grok generates hooks, scene text, narration, and hashtags
- **Canvas video rendering** — Animated short-form videos rendered in-browser using Canvas 2D + MediaRecorder
- **Multiple themes** — Dark Purple, Dark Blue, Sunset, Forest, Neon, Minimal
- **Text animations** — Fade, Slide, Typewriter, Bounce
- **4 video styles** — Educational, Motivational, Storytelling, Tutorial, Entertainment
- **Flexible durations** — 15s, 30s, 45s, 60s per video
- **Batch export** — Download all videos or select individual ones
- **Script clipboard** — Copy all scripts as formatted text

---

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. The extension icon will appear in your toolbar

### Generate Icons

Before loading, generate the required PNG icons:

**Option A — Browser:**
Open `icons/create-icons.html` in Chrome; icons will auto-download.

**Option B — Node.js** (requires `canvas` package):
```bash
cd icons
npm install canvas
node generate-icons.js
```

Move the downloaded `icon16.png`, `icon48.png`, `icon128.png` into the `icons/` folder.

---

## Setup

1. Click the extension icon → click **⚙ Settings**
2. Enter your **xAI API key** from [console.x.ai](https://console.x.ai)
3. Click **Test** to verify the key
4. Click **Save Settings**

---

## Usage

1. **Topic** — Describe your video series idea (e.g. "5 science facts that will blow your mind")
2. **Style** — Pick video style, duration, color theme, and animation type
3. **Generate** — Grok writes the scripts; videos render in your browser
4. **Export** — Download individual `.webm` videos or copy scripts to clipboard

---

## Architecture

```
├── manifest.json           # Chrome Extension Manifest V3
├── popup/
│   ├── popup.html          # 4-step UI (Topic → Style → Generate → Export)
│   ├── popup.css           # Dark UI styles
│   └── popup.js            # Step controller, state management
├── options/
│   ├── options.html        # Settings page
│   └── options.js          # API key config, defaults
├── background/
│   └── background.js       # Service worker (install, context menu, API relay)
├── utils/
│   ├── grok-api.js         # Grok API client + series generation prompt
│   └── video-renderer.js   # Canvas 2D video renderer + MediaRecorder export
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Video Rendering Pipeline

1. **Script generation** — Grok returns structured JSON with title, hook, scenes, narration, CTA, hashtags
2. **Canvas rendering** — Each frame is drawn at 30fps:
   - Animated gradient background
   - Hook text (with chosen animation)
   - Scene cards (slide in/out)
   - Narration strip with emoji
   - CTA pill + hashtags
   - Progress bar
3. **MediaRecorder** — Captures canvas stream as WebM (VP9 codec)
4. **Download** — Blob URL → `<a download>` trigger

---

## Grok API

Uses the [xAI API](https://docs.x.ai) which is OpenAI-compatible:
- Base URL: `https://api.x.ai/v1`
- Models: `grok-3-latest`, `grok-3-mini-latest`, `grok-2-latest`
- Single API call generates all video scripts as structured JSON

---

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save API key and preferences |
| `activeTab` | Read page title for context menu feature |
| `host_permissions: api.x.ai` | Call the Grok API |

---

## License

MIT

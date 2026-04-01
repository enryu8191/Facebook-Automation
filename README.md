# Grok Video Series Generator — Chrome Extension

Generate TikTok/Reels-style short video series using **Grok AI** — directly through the Grok website. **No API key required.** Just log in to grok.com and the extension handles everything automatically.

---

## How It Works

The extension opens grok.com in a tab, automatically types your prompt into Grok's chat, waits for the full response, then uses it to render animated short-form videos — all in your browser.

---

## Features

- **No API key** — Uses your existing grok.com login via browser automation
- **AI-powered scripts** — Grok generates hooks, scene text, narration, and hashtags
- **Canvas video rendering** — Animated short-form videos rendered in-browser using Canvas 2D + MediaRecorder
- **Multiple themes** — Dark Purple, Dark Blue, Sunset, Forest, Neon, Minimal
- **Text animations** — Fade, Slide, Typewriter, Bounce
- **5 video styles** — Educational, Motivational, Storytelling, Tutorial, Entertainment
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

1. Open [grok.com](https://grok.com) and **log in** with your X account
2. Keep the grok.com tab open
3. Click the extension icon and start generating!

No API keys, no configuration needed.

---

## Usage

1. **Topic** — Describe your video series idea (e.g. "5 science facts that will blow your mind")
2. **Style** — Pick video style, duration, color theme, and animation type
3. **Generate** — The extension auto-prompts Grok; videos render in your browser
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

## Architecture

```
├── manifest.json           # Chrome Extension Manifest V3
├── popup/
│   ├── popup.html          # 4-step UI (Topic → Style → Generate → Export)
│   ├── popup.css           # Dark UI styles
│   └── popup.js            # Step controller, state management
├── options/
│   ├── options.html        # Settings page (no API key needed)
│   └── options.js          # Defaults config + Grok tab status check
├── background/
│   └── background.js       # Service worker: tab management, message relay
├── content/
│   └── grok-bridge.js      # Content script on grok.com: injects prompts, extracts responses
├── utils/
│   ├── grok-api.js         # Prompt builder + JSON parser
│   └── video-renderer.js   # Canvas 2D video renderer + MediaRecorder export
└── icons/
```

## Browser Automation Flow

1. **Popup** → background: `GROK_PROMPT { prompt }`
2. **Background** → finds/opens grok.com tab, verifies content script loaded
3. **Background** → content script: `INJECT_PROMPT { prompt }`
4. **Content script** → sets textarea value, submits form, watches for response
5. **Content script** → background: response text (JSON)
6. **Background** → popup: response text
7. **Popup** → parses JSON, renders Canvas videos, offers download

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save preferences |
| `tabs` | Find/open grok.com tab |
| `scripting` | Inject content script into pre-existing grok.com tabs |
| `contextMenus` | Right-click "Generate video series about this" |
| `activeTab` | Read page title for context menu |
| `host_permissions: grok.com` | Run content script on grok.com |

---

## License

MIT

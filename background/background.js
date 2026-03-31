/**
 * Background service worker for Grok Video Series Generator
 * Handles extension lifecycle, context menu, and inter-tab messaging.
 */

// -----------------------------------------------------------------------
// Install / update lifecycle
// -----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // Open the options page on first install to prompt for API key
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  }
});

// -----------------------------------------------------------------------
// Context menu: "Generate video series about this page"
// -----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'grok-video-from-page',
    title: 'Generate Grok video series about this page',
    contexts: ['page', 'selection'],
  });
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'grok-video-from-page') return;

  const topic = info.selectionText
    ? info.selectionText.slice(0, 200)
    : tab.title || 'this topic';

  // Store topic so popup can read it on open
  chrome.storage.session.set({ pendingTopic: topic });
  chrome.action.openPopup?.();
});

// -----------------------------------------------------------------------
// Message passing: relay API requests from popup (CSP-friendly fallback)
// -----------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GROK_API_REQUEST') {
    handleGrokRequest(msg.payload).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async
  }

  if (msg.type === 'PING') {
    sendResponse({ pong: true });
  }
});

async function handleGrokRequest({ apiKey, model, messages, options = {} }) {
  const resp = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.85,
      max_tokens: options.maxTokens ?? 4096,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Grok API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }

  return resp.json();
}

// -----------------------------------------------------------------------
// Badge: show number of pending renders
// -----------------------------------------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if ('renderCount' in changes) {
    const count = changes.renderCount.newValue;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  }
});

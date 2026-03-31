/**
 * Background Service Worker — Grok Video Series Generator
 *
 * Responsibilities:
 *  1. Open / reuse a grok.com tab
 *  2. Inject INJECT_PROMPT into the content script
 *  3. Return the response text to the popup
 */

const GROK_URL = 'https://grok.com';

// -----------------------------------------------------------------------
// Install: open Grok on first install so the user logs in
// -----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: GROK_URL });
  }
});

// -----------------------------------------------------------------------
// Context menu — "Generate video series about this page"
// -----------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'grok-video-from-selection',
    title: 'Generate Grok video series about "%s"',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'grok-video-from-page',
    title: 'Generate Grok video series about this page',
    contexts: ['page'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const topic =
    info.menuItemId === 'grok-video-from-selection'
      ? info.selectionText?.slice(0, 200)
      : tab.title || 'this topic';

  chrome.storage.session.set({ pendingTopic: topic });
  // Open the popup — user will see the topic pre-filled
});

// -----------------------------------------------------------------------
// Main message handler: GROK_PROMPT from popup
// -----------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GROK_PROMPT') {
    handleGrokPrompt(msg.prompt)
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }

  if (msg.type === 'BRIDGE_READY') {
    // Content script announced itself — check if we have a pending prompt
    const tabId = _sender.tab?.id;
    if (tabId != null) {
      grokTabId = tabId;
      flushPendingPrompt(tabId);
    }
  }
});

// -----------------------------------------------------------------------
// Tab management
// -----------------------------------------------------------------------
let grokTabId = null;

/** Pending resolve/reject while waiting for content script */
let pending = null;

async function handleGrokPrompt(prompt) {
  return new Promise(async (resolve, reject) => {
    pending = { resolve, reject };

    try {
      const tabId = await getOrCreateGrokTab();
      grokTabId = tabId;

      // Make sure content script is injected (it auto-injects via manifest,
      // but if the tab was opened before extension installed, inject manually)
      await ensureContentScript(tabId);

      await sleep(800); // brief wait for script to initialise

      chrome.tabs.sendMessage(tabId, { type: 'INJECT_PROMPT', prompt }, response => {
        if (!pending) return;
        const p = pending;
        pending = null;

        if (chrome.runtime.lastError) {
          return p.reject(new Error(
            'Could not reach Grok tab. Make sure grok.com is open and you are logged in.'
          ));
        }
        if (response?.error) return p.reject(new Error(response.error));
        p.resolve(response?.text ?? '');
      });

    } catch (err) {
      if (pending) { pending.reject(err); pending = null; }
    }
  });
}

/** Flush a prompt that arrived while content script was loading */
function flushPendingPrompt(_tabId) {
  // Currently prompts are sent directly after ensureContentScript
  // so no explicit queue needed — this is a hook for future use.
}

/**
 * Find an existing grok.com tab, or create a new one.
 * Returns the tab ID.
 */
async function getOrCreateGrokTab() {
  // 1. Check our cached tab ID
  if (grokTabId != null) {
    try {
      const tab = await chrome.tabs.get(grokTabId);
      if (tab && tab.url?.startsWith(GROK_URL)) {
        // Bring it to front
        await chrome.tabs.update(grokTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return grokTabId;
      }
    } catch {
      grokTabId = null;
    }
  }

  // 2. Search all open tabs
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    grokTabId = tab.id;
    return tab.id;
  }

  // 3. Open a new tab
  const newTab = await chrome.tabs.create({ url: GROK_URL });
  grokTabId = newTab.id;

  // Wait for it to fully load
  await waitForTabLoad(newTab.id);

  return newTab.id;
}

/**
 * Wait for a tab to finish loading
 */
function waitForTabLoad(tabId, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // proceed anyway
    }, timeout);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Make sure the content script is running in the given tab.
 * The manifest handles automatic injection, but for pre-existing tabs
 * we use scripting.executeScript as a fallback.
 */
async function ensureContentScript(tabId) {
  try {
    // Ping the content script
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, response => {
        if (chrome.runtime.lastError || !response?.pong) {
          reject(new Error('no response'));
        } else {
          resolve();
        }
      });
    });
  } catch {
    // Content script not loaded yet — inject it manually
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/grok-bridge.js'],
    });
    await sleep(500);
  }
}

// -----------------------------------------------------------------------
// Keep track of tab closure so we re-open when needed
// -----------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === grokTabId) grokTabId = null;
});

// -----------------------------------------------------------------------
// Badge: show spinner while processing
// -----------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GROK_PROMPT') {
    chrome.action.setBadgeText({ text: '…' });
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  }
  if (msg.type === 'GENERATION_DONE' || msg.type === 'GENERATION_ERROR') {
    chrome.action.setBadgeText({ text: '' });
  }
});

// -----------------------------------------------------------------------
// Util
// -----------------------------------------------------------------------
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

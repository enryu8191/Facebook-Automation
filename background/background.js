/**
 * Background Service Worker
 *
 * Key design decisions:
 *  - grok.com tab is NEVER brought to focus (so popup stays open)
 *  - Progress is written to chrome.storage.session so popup can read it
 *  - Image generation loops through scenes one at a time via content script
 */

const GROK_URL = 'https://grok.com';
let grokTabId  = null;

// ─────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // Open grok.com on first install so user can log in
    chrome.tabs.create({ url: GROK_URL });
  }

  chrome.contextMenus.create({
    id: 'grok-video-page',
    title: 'Make a Grok video about this page',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'grok-video-selection',
    title: 'Make a Grok video about "%s"',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const topic =
    info.menuItemId === 'grok-video-selection'
      ? info.selectionText?.slice(0, 300)
      : tab.title || '';
  if (topic) chrome.storage.session.set({ pendingTopic: topic });
});

// ─────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BRIDGE_READY') {
    if (sender.tab?.id) grokTabId = sender.tab.id;
    return;
  }

  if (msg.type === 'GROK_PROMPT') {
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(result => sendResponse(result))
      .catch(err   => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

// ─────────────────────────────────────────────────────
// Core: send a prompt to the Grok content script
// ─────────────────────────────────────────────────────
async function handlePrompt(prompt, expectImage) {
  const tabId = await getOrCreateGrokTab();
  await ensureContentScript(tabId);
  await sleep(800);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'INJECT_PROMPT', prompt, expectImage },
      (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(
            'Could not reach Grok. Make sure grok.com is open and you are logged in.'
          ));
        }
        if (res?.error) return reject(new Error(res.error));
        resolve(res);
      }
    );
  });
}

// ─────────────────────────────────────────────────────
// Tab management — NEVER activate the tab so popup stays open
// ─────────────────────────────────────────────────────
async function getOrCreateGrokTab() {
  // 1. Reuse cached tab if still valid
  if (grokTabId != null) {
    try {
      const tab = await chrome.tabs.get(grokTabId);
      if (tab?.url?.startsWith(GROK_URL)) return grokTabId;
    } catch {
      grokTabId = null;
    }
  }

  // 2. Find any existing grok.com tab (don't activate it)
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (tabs.length > 0) {
    grokTabId = tabs[0].id;
    return grokTabId;
  }

  // 3. Open a new background tab (active: false keeps popup open)
  const newTab = await chrome.tabs.create({ url: GROK_URL, active: false });
  grokTabId = newTab.id;
  await waitForTabLoad(newTab.id);
  await sleep(1500); // let Grok's JS fully initialise
  return grokTabId;
}

function waitForTabLoad(tabId, timeout = 30_000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureContentScript(tabId) {
  // Ping first
  const alive = await new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, res => {
      resolve(!chrome.runtime.lastError && res?.pong === true);
    });
  });

  if (!alive) {
    // Inject manually (handles pre-existing tabs)
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/grok-bridge.js'],
    });
    await sleep(800);
  }
}

chrome.tabs.onRemoved.addListener(id => {
  if (id === grokTabId) grokTabId = null;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

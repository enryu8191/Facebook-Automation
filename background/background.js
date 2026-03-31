/**
 * Background Service Worker
 * Manages the grok.com tab and relays GROK_PROMPT messages
 * from the popup to the content script.
 */

const GROK_URL = 'https://grok.com';
let grokTabId  = null;

// ─────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
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
// Message relay: popup → grok tab content script
// ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BRIDGE_READY') {
    if (sender.tab?.id) grokTabId = sender.tab.id;
    return;
  }

  if (msg.type === 'GROK_PROMPT') {
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }
});

async function handlePrompt(prompt, expectImage) {
  const tabId = await getOrCreateGrokTab();

  // Ensure content script is running
  await ensureContentScript(tabId);
  await sleep(600);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'INJECT_PROMPT', prompt, expectImage },
      (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(
            'Cannot reach Grok tab. Open grok.com and log in, then try again.'
          ));
        }
        if (res?.error) return reject(new Error(res.error));
        resolve(res);
      }
    );
  });
}

// ─────────────────────────────────────────────────────
// Tab management
// ─────────────────────────────────────────────────────
async function getOrCreateGrokTab() {
  // 1. Reuse cached tab
  if (grokTabId != null) {
    try {
      const tab = await chrome.tabs.get(grokTabId);
      if (tab?.url?.startsWith(GROK_URL)) {
        await chrome.tabs.update(grokTabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return grokTabId;
      }
    } catch { grokTabId = null; }
  }

  // 2. Find existing grok.com tab
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    grokTabId = tab.id;
    return tab.id;
  }

  // 3. Open new tab and wait for load
  const newTab = await chrome.tabs.create({ url: GROK_URL });
  grokTabId = newTab.id;
  await waitForTabLoad(newTab.id);
  return newTab.id;
}

function waitForTabLoad(tabId, timeout = 25_000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
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

async function ensureContentScript(tabId) {
  try {
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, res => {
        chrome.runtime.lastError || !res?.pong ? reject() : resolve();
      });
    });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/grok-bridge.js'] });
    await sleep(500);
  }
}

chrome.tabs.onRemoved.addListener(id => { if (id === grokTabId) grokTabId = null; });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Background Service Worker
 *
 * Key design decisions:
 *  - grok.com tab is NEVER brought to focus (so popup stays open)
 *  - Progress is written to chrome.storage.session so popup can read it
 *  - Image generation loops through scenes one at a time via content script
 */

const GROK_CHAT_URL    = 'https://grok.com';
const GROK_IMAGINE_URL = 'https://grok.com/imagine';
let grokChatTabId    = null;
let grokImagineTabId = null;

// ─────────────────────────────────────────────────────
// Install
// ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: GROK_CHAT_URL });
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
    const tabId = sender.tab?.id;
    const url   = sender.tab?.url || '';
    if (tabId) {
      if (url.includes('/imagine')) grokImagineTabId = tabId;
      else                          grokChatTabId    = tabId;
    }
    return;
  }

  if (msg.type === 'GROK_PROMPT') {
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(result => sendResponse(result))
      .catch(err   => sendResponse({ error: err.message }));
    return true;
  }
});

// ─────────────────────────────────────────────────────
// Core: send a prompt to the Grok content script
// ─────────────────────────────────────────────────────
async function handlePrompt(prompt, expectImage) {
  // Route to the right tab: /imagine for images, chat for text
  const targetUrl = expectImage ? GROK_IMAGINE_URL : GROK_CHAT_URL;
  const tabId     = await getOrCreateTab(targetUrl, expectImage);

  await ensureContentScript(tabId);
  await sleep(600);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'INJECT_PROMPT', prompt, expectImage },
      (res) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(
            `Could not reach ${expectImage ? 'grok.com/imagine' : 'grok.com'}. ` +
            'Make sure you are logged in.'
          ));
        }
        if (res?.error) return reject(new Error(res.error));
        resolve(res);
      }
    );
  });
}

// ─────────────────────────────────────────────────────
// Tab management — never activate so popup stays open
// ─────────────────────────────────────────────────────
async function getOrCreateTab(url, isImagine) {
  const cachedId = isImagine ? grokImagineTabId : grokChatTabId;

  // 1. Reuse cached tab
  if (cachedId != null) {
    try {
      const tab = await chrome.tabs.get(cachedId);
      if (tab?.url?.startsWith(url)) {
        if (isImagine) grokImagineTabId = cachedId;
        else           grokChatTabId    = cachedId;
        return cachedId;
      }
    } catch {
      if (isImagine) grokImagineTabId = null;
      else           grokChatTabId    = null;
    }
  }

  // 2. Find existing open tab
  const pattern = isImagine ? 'https://grok.com/imagine*' : 'https://grok.com/*';
  const tabs    = await chrome.tabs.query({ url: pattern });
  // For chat, exclude /imagine tabs
  const match   = tabs.find(t =>
    isImagine
      ? t.url.includes('/imagine')
      : !t.url.includes('/imagine')
  );
  if (match) {
    if (isImagine) grokImagineTabId = match.id;
    else           grokChatTabId    = match.id;
    return match.id;
  }

  // 3. Open new background tab (active:false keeps popup open)
  const newTab = await chrome.tabs.create({ url, active: false });
  await waitForTabLoad(newTab.id);
  await sleep(2000); // let Grok's React fully initialise
  if (isImagine) grokImagineTabId = newTab.id;
  else           grokChatTabId    = newTab.id;
  return newTab.id;
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
  if (id === grokChatTabId)    grokChatTabId    = null;
  if (id === grokImagineTabId) grokImagineTabId = null;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

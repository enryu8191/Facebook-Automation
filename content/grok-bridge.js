/**
 * Grok Bridge — Content Script
 * Controls grok.com to:
 *   1. Send text prompts and capture text responses  (expectImage: false)
 *   2. Send image prompts and capture generated images (expectImage: true)
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────
  // DOM Selectors  (multiple fallbacks for resilience)
  // ─────────────────────────────────────────────────────

  function findInput() {
    return (
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][data-testid]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"]')
    );
  }

  function findSendButton() {
    return (
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="submit" i]') ||
      document.querySelector('button[data-testid*="send" i]') ||
      document.querySelector('button[type="submit"]') ||
      (() => {
        return [...document.querySelectorAll('button')].find(b =>
          b.querySelector('svg') &&
          b.closest('form, [class*="input"], [class*="chat"], footer')
        );
      })()
    );
  }

  function findStopButton() {
    return (
      document.querySelector('button[aria-label*="Stop" i]') ||
      document.querySelector('button[aria-label*="stop" i]') ||
      document.querySelector('button[data-testid*="stop" i]') ||
      [...document.querySelectorAll('button')].find(b =>
        b.textContent.trim().toLowerCase() === 'stop' ||
        b.textContent.trim().toLowerCase().includes('stop generating')
      )
    );
  }

  // ─────────────────────────────────────────────────────
  // Input control
  // ─────────────────────────────────────────────────────

  function setInputValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  }

  function submitInput(input) {
    const btn = findSendButton();
    if (btn && !btn.disabled) { btn.click(); return; }
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, ctrlKey: false,
    }));
  }

  // ─────────────────────────────────────────────────────
  // Response extraction — TEXT
  // ─────────────────────────────────────────────────────

  function extractTextResponse() {
    // Priority 1: code blocks (JSON responses)
    const codeBlocks = [...document.querySelectorAll('pre code, pre')];
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const t = codeBlocks[i].innerText?.trim();
      if (t && (t.startsWith('{') || t.startsWith('['))) return t;
    }

    // Priority 2: last assistant message
    const candidates = [
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('[data-testid*="message"]'),
      ...document.querySelectorAll('[class*="message"][class*="assistant"]'),
      ...document.querySelectorAll('[class*="response"]'),
      ...document.querySelectorAll('article'),
    ];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const t = candidates[i].innerText?.trim();
      if (t && t.length > 20) return t;
    }

    // Priority 3: find JSON anywhere in page text
    const all = document.body.innerText || '';
    const m = all.match(/\{[\s\S]*?"videos"[\s\S]*?\}/);
    return m ? m[0] : '';
  }

  // ─────────────────────────────────────────────────────
  // Response extraction — IMAGES
  // ─────────────────────────────────────────────────────

  /**
   * Convert an <img> element to a base64 data URL by drawing it on a canvas.
   * Falls back to fetching the src if cross-origin blocks the canvas.
   */
  async function imgElementToDataUrl(img) {
    // Try canvas approach first (works for same-origin images)
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || img.width  || 512;
      canvas.height = img.naturalHeight || img.height || 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.92);
    } catch { /* cross-origin, fall through */ }

    // Fetch approach (works when CORS allows)
    try {
      const resp = await fetch(img.src, { mode: 'cors' });
      const blob = await resp.blob();
      return await blobToDataUrl(blob);
    } catch { /* give up */ }

    // Return src as-is (background service worker will try fetching it)
    return img.src;
  }

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  /**
   * Find all generated images in the most recent assistant message.
   * Grok Imagine returns images as <img> elements inside the response.
   */
  async function extractGeneratedImages() {
    // Look for images added to the page after we submitted (newest message)
    const msgContainers = [
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('[data-testid*="message"]'),
      ...document.querySelectorAll('[class*="message"][class*="assistant"]'),
      ...document.querySelectorAll('article'),
    ];

    // Walk from newest message backwards
    for (let i = msgContainers.length - 1; i >= 0; i--) {
      const container = msgContainers[i];
      const imgs = [...container.querySelectorAll('img')].filter(img => {
        // Exclude tiny icons, avatars, UI images
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const src = img.src || '';
        return (
          (w > 100 || h > 100 || w === 0) && // include lazy-loaded
          !src.includes('avatar') &&
          !src.includes('icon') &&
          !src.includes('logo') &&
          !src.includes('emoji') &&
          src.length > 0
        );
      });

      if (imgs.length > 0) {
        const dataUrls = await Promise.all(imgs.map(imgElementToDataUrl));
        return dataUrls.filter(Boolean);
      }
    }

    return [];
  }

  // ─────────────────────────────────────────────────────
  // Wait for Grok to finish streaming
  // ─────────────────────────────────────────────────────

  function waitForResponse(expectImage = false, maxWait = 120_000) {
    return new Promise((resolve, reject) => {
      let streamStarted  = false;
      let settled        = false;
      let stableTimer    = null;
      let lastContent    = '';

      const timeoutHandle = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        // Return partial results
        if (expectImage) {
          extractGeneratedImages().then(imgs => {
            if (imgs.length > 0) resolve({ images: imgs });
            else reject(new Error('Grok Imagine did not return an image in time. Make sure you are logged in at grok.com.'));
          });
        } else {
          const t = extractTextResponse();
          if (t.length > 30) resolve({ text: t });
          else reject(new Error('Grok did not respond in time. Make sure you are logged in at grok.com.'));
        }
      }, maxWait);

      const poll = setInterval(async () => {
        const stopBtn = findStopButton();

        // Snapshot current "content" — text + image count
        const textSnap = extractTextResponse();
        const imgCount = expectImage
          ? document.querySelectorAll('img[src]').length
          : 0;
        const currentContent = `${textSnap}::${imgCount}`;

        if (!streamStarted) {
          if (stopBtn || currentContent !== lastContent) {
            streamStarted = true;
          }
          lastContent = currentContent;
          return;
        }

        if (!stopBtn) {
          // Stream may have ended — watch for stability
          if (currentContent !== lastContent) {
            lastContent = currentContent;
            if (stableTimer) clearTimeout(stableTimer);
            stableTimer = setTimeout(finish, expectImage ? 2500 : 1500);
          } else if (!stableTimer) {
            stableTimer = setTimeout(finish, expectImage ? 2500 : 1500);
          }
        } else {
          // Still streaming
          lastContent = currentContent;
          if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
        }
      }, 350);

      async function finish() {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        clearTimeout(timeoutHandle);

        if (expectImage) {
          const imgs = await extractGeneratedImages();
          resolve({ images: imgs });
        } else {
          resolve({ text: extractTextResponse() });
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────
  // New conversation — click "New chat" if available
  // ─────────────────────────────────────────────────────

  function tryNewChat() {
    const newChatBtn = (
      document.querySelector('button[aria-label*="New chat" i]') ||
      document.querySelector('button[aria-label*="new conversation" i]') ||
      document.querySelector('[data-testid*="new-chat"]') ||
      [...document.querySelectorAll('button, a')].find(el =>
        el.textContent.trim().toLowerCase().includes('new chat')
      )
    );
    if (newChatBtn) newChatBtn.click();
  }

  // ─────────────────────────────────────────────────────
  // Main entry
  // ─────────────────────────────────────────────────────

  let busy = false;

  async function handlePrompt(prompt, expectImage) {
    // For image generation, start a fresh chat to avoid context confusion
    if (expectImage) {
      tryNewChat();
      await sleep(800);
    }

    const input = findInput();
    if (!input) {
      throw new Error(
        'Could not find Grok\'s input. Make sure grok.com is loaded and you are logged in.'
      );
    }

    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    await sleep(300);

    setInputValue(input, prompt);
    await sleep(400);

    submitInput(input);
    await sleep(600);

    const result = await waitForResponse(expectImage);

    if (expectImage) {
      return { imageDataUrl: result.images?.[0] ?? null };
    } else {
      return { text: result.text ?? '' };
    }
  }

  // ─────────────────────────────────────────────────────
  // Message listener
  // ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ pong: true });
      return true;
    }

    if (msg.type !== 'INJECT_PROMPT') return false;

    if (busy) {
      sendResponse({ error: 'Grok bridge is busy. Please wait.' });
      return true;
    }

    busy = true;
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(result => { busy = false; sendResponse(result); })
      .catch(err  => { busy = false; sendResponse({ error: err.message }); });

    return true; // async
  });

  // Announce ready
  chrome.runtime.sendMessage({ type: 'BRIDGE_READY' });
  console.log('[Grok Bridge] Ready on', location.hostname);

  // ─────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

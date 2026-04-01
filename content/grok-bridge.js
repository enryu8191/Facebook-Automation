/**
 * Grok Bridge — Content Script
 * Runs on grok.com. Injects prompts and captures responses / images.
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────
  // Find the chat input — wait until it exists
  // ─────────────────────────────────────────────────────

  function findInput() {
    // Try all known Grok input patterns
    return (
      document.querySelector('textarea[data-testid]') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][aria-label]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"]')
    );
  }

  function waitForInput(timeout = 15_000) {
    return new Promise((resolve, reject) => {
      const el = findInput();
      if (el) return resolve(el);

      const timer = setTimeout(() => {
        obs.disconnect();
        reject(new Error(
          'Could not find Grok\'s chat input. ' +
          'Make sure grok.com is fully loaded and you are logged in.'
        ));
      }, timeout);

      const obs = new MutationObserver(() => {
        const found = findInput();
        if (found) {
          clearTimeout(timer);
          obs.disconnect();
          resolve(found);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ─────────────────────────────────────────────────────
  // Set text in the input (handles both textarea & contenteditable)
  // Most reliable cross-framework approach
  // ─────────────────────────────────────────────────────

  async function setInputText(el, text) {
    el.focus();
    await sleep(150);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // 1. Override via native React setter so React sees the change
      const proto  = window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }

      // 2. Fire the events React listens for
      el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event ('change', { bubbles: true }));

    } else {
      // contenteditable (Lexical / ProseMirror / Slate)
      el.focus();
      // Select all existing content and replace
      document.execCommand('selectAll', false, null);
      await sleep(50);
      document.execCommand('delete',    false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    await sleep(200);
  }

  // ─────────────────────────────────────────────────────
  // Submit
  // ─────────────────────────────────────────────────────

  function findSendButton() {
    // Ordered by specificity
    const checks = [
      () => document.querySelector('button[aria-label="Send message"]'),
      () => document.querySelector('button[aria-label="Send"]'),
      () => document.querySelector('button[data-testid*="send"]'),
      () => document.querySelector('button[type="submit"]'),
      // Generic: a button with an SVG inside near the input area
      () => [...document.querySelectorAll('button')].find(b =>
        b.querySelector('svg') &&
        !b.disabled &&
        b.closest('form, [class*="input"], [class*="compose"], [class*="chat"], footer, main')
      ),
    ];
    for (const fn of checks) {
      try { const r = fn(); if (r) return r; } catch {}
    }
    return null;
  }

  function submit(input) {
    // Try the send button first
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
      return;
    }
    // Fall back to Enter key on the input element
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, cancelable: true,
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true,
    }));
  }

  // ─────────────────────────────────────────────────────
  // Detect streaming state
  // ─────────────────────────────────────────────────────

  function isStreaming() {
    // "Stop" / "Stop generating" button appears while streaming
    return !![
      document.querySelector('button[aria-label*="Stop" i]'),
      document.querySelector('button[aria-label*="stop generating" i]'),
      document.querySelector('button[data-testid*="stop"]'),
      [...document.querySelectorAll('button')].find(b =>
        /^stop/i.test(b.textContent.trim())
      ),
    ].find(Boolean);
  }

  // ─────────────────────────────────────────────────────
  // Extract text response
  // ─────────────────────────────────────────────────────

  function extractText() {
    // 1. Code blocks first (JSON will be in a <pre><code> block)
    const blocks = [...document.querySelectorAll('pre code, pre')];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const t = blocks[i].innerText?.trim();
      if (t && (t.startsWith('{') || t.startsWith('['))) return t;
    }

    // 2. Last assistant message
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="message"]',
      '[class*="AssistantMessage"]',
      '[class*="assistant"][class*="message"]',
      'article',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (let i = els.length - 1; i >= 0; i--) {
        const t = els[i].innerText?.trim();
        if (t && t.length > 20) return t;
      }
    }

    // 3. Scan entire page text for a JSON block
    const page = document.body.innerText || '';
    const m = page.match(/\{[\s\S]*?"videos"[\s\S]*?\}/);
    return m ? m[0] : '';
  }

  // ─────────────────────────────────────────────────────
  // Extract generated images
  // ─────────────────────────────────────────────────────

  async function imgToDataUrl(img) {
    // Attempt 1: canvas (works if image is same-origin or CORS-allowed)
    try {
      const c = document.createElement('canvas');
      c.width  = img.naturalWidth  || 512;
      c.height = img.naturalHeight || 512;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.92);
    } catch {}

    // Attempt 2: fetch as blob
    try {
      const r    = await fetch(img.src, { mode: 'cors' });
      const blob = await r.blob();
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    } catch {}

    return img.src; // fallback — raw URL
  }

  async function extractImages() {
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="message"]',
      'article',
      'main',
    ];

    for (const sel of selectors) {
      const containers = document.querySelectorAll(sel);
      for (let i = containers.length - 1; i >= 0; i--) {
        const imgs = [...containers[i].querySelectorAll('img')].filter(img => {
          const w   = img.naturalWidth || img.width || 0;
          const src = img.src || '';
          return (
            w > 80 &&
            src.length > 0 &&
            !src.includes('avatar') &&
            !src.includes('icon') &&
            !src.includes('logo') &&
            !src.includes('emoji')
          );
        });
        if (imgs.length > 0) {
          return Promise.all(imgs.slice(0, 1).map(imgToDataUrl));
        }
      }
    }
    return [];
  }

  // ─────────────────────────────────────────────────────
  // Wait for response to complete
  // ─────────────────────────────────────────────────────

  function waitForDone(expectImage, maxWait = 120_000) {
    return new Promise((resolve, reject) => {
      let started     = false;
      let settled     = false;
      let stableTimer = null;
      let lastSnap    = '';

      const tid = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        collectResult().then(resolve).catch(reject);
      }, maxWait);

      async function finish() {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        clearTimeout(tid);
        if (stableTimer) clearTimeout(stableTimer);
        const r = await collectResult();
        resolve(r);
      }

      async function collectResult() {
        if (expectImage) {
          const imgs = await extractImages();
          if (imgs.length === 0) throw new Error('No image was returned by Grok Imagine. Try again.');
          return { imageDataUrl: imgs[0] };
        }
        const t = extractText();
        if (!t) throw new Error('Grok returned an empty response. Try again.');
        return { text: t };
      }

      const pid = setInterval(() => {
        const streaming = isStreaming();
        const snap = expectImage
          ? String(document.querySelectorAll('img[src]').length)
          : extractText().slice(-120);

        if (!started) {
          if (streaming || snap !== lastSnap) started = true;
          lastSnap = snap;
          return;
        }

        if (streaming) {
          // Still generating — reset stable timer
          if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
          lastSnap = snap;
          return;
        }

        // Not streaming — wait for content to stabilise
        if (snap !== lastSnap) {
          lastSnap = snap;
          if (stableTimer) clearTimeout(stableTimer);
          stableTimer = setTimeout(finish, expectImage ? 2500 : 1500);
        } else if (!stableTimer) {
          stableTimer = setTimeout(finish, expectImage ? 2500 : 1500);
        }
      }, 400);
    });
  }

  // ─────────────────────────────────────────────────────
  // Main handler
  // ─────────────────────────────────────────────────────

  let busy = false;

  async function handlePrompt(prompt, expectImage) {
    const input = await waitForInput();

    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    await setInputText(input, prompt);
    await sleep(300);

    submit(input);
    await sleep(500);

    return waitForDone(expectImage);
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
      sendResponse({ error: 'Grok is busy with a previous request. Please wait.' });
      return true;
    }

    busy = true;
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(r  => { busy = false; sendResponse(r); })
      .catch(e => { busy = false; sendResponse({ error: e.message }); });

    return true;
  });

  chrome.runtime.sendMessage({ type: 'BRIDGE_READY' });
  console.log('[Grok Bridge] Ready');

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

/**
 * Grok Bridge — Content Script
 * Injects prompts into grok.com and captures responses / images.
 *
 * Shows a visible overlay so the user can see what the extension is doing.
 */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────
  // Status overlay — visible on the Grok page
  // ─────────────────────────────────────────────────────
  let overlay = null;

  function showOverlay(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = '__grok_bridge_overlay__';
      overlay.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
        'background:rgba(124,58,237,0.95)', 'color:#fff',
        'font:600 13px/1.4 -apple-system,sans-serif',
        'padding:10px 16px', 'border-radius:10px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
        'max-width:280px', 'pointer-events:none',
      ].join(';');
      document.body.appendChild(overlay);
    }
    overlay.textContent = '🎬 Grok Video: ' + text;
    overlay.style.display = 'block';
  }

  function hideOverlay() {
    if (overlay) overlay.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────
  // Find the chat input — polls until it appears
  // ─────────────────────────────────────────────────────
  function findInput() {
    // Try every known selector pattern for Grok's input
    const selectors = [
      'textarea[data-testid]',
      'textarea[placeholder]',
      'textarea',
      '[contenteditable="true"][aria-label]',
      '[contenteditable="true"]',
      'div[role="textbox"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function waitForInput(timeout = 20_000) {
    return new Promise((resolve, reject) => {
      const found = findInput();
      if (found) return resolve(found);

      const deadline = setTimeout(() => {
        obs.disconnect();
        reject(new Error(
          'Grok input not found. Make sure you are logged in at grok.com.'
        ));
      }, timeout);

      const obs = new MutationObserver(() => {
        const el = findInput();
        if (el) {
          clearTimeout(deadline);
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ─────────────────────────────────────────────────────
  // Set text — reliable for React-controlled textareas
  // ─────────────────────────────────────────────────────
  function setReactValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // 1. Use native setter so React's internal value tracker is bypassed
      const proto  = window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, text);
      } else {
        el.value = text;
      }
      // 2. Fire a plain input event — React reads element.value on this event
      el.dispatchEvent(new Event('input', { bubbles: true }));

    } else {
      // contenteditable (Lexical / ProseMirror)
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // ─────────────────────────────────────────────────────
  // Submit — try every known method
  // ─────────────────────────────────────────────────────
  function findSendButton() {
    const patterns = [
      () => document.querySelector('button[aria-label="Send message"]'),
      () => document.querySelector('button[aria-label="Send"]'),
      () => document.querySelector('button[data-testid*="send" i]'),
      () => document.querySelector('button[type="submit"]'),
      () => {
        // Generic: enabled button with SVG near the input area
        return [...document.querySelectorAll('button')].find(b =>
          !b.disabled &&
          b.querySelector('svg') &&
          b.closest('form, main, [class*="input"], [class*="chat"], [class*="compose"], footer')
        );
      },
    ];
    for (const fn of patterns) {
      try { const r = fn(); if (r && !r.disabled) return r; } catch {}
    }
    return null;
  }

  function submitInput(input) {
    // Try send button first
    const btn = findSendButton();
    if (btn) {
      btn.click();
      return;
    }
    // Fall back to Enter keydown on the textarea
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      which: 13, bubbles: true, cancelable: true,
    }));
  }

  // ─────────────────────────────────────────────────────
  // Detect streaming (stop button visible = Grok is generating)
  // ─────────────────────────────────────────────────────
  function isStreaming() {
    return !![
      document.querySelector('button[aria-label*="Stop" i]'),
      document.querySelector('button[data-testid*="stop"]'),
      [...document.querySelectorAll('button')].find(b =>
        /^stop/i.test(b.textContent.trim())
      ),
    ].find(Boolean);
  }

  // ─────────────────────────────────────────────────────
  // Extract the last text response
  // ─────────────────────────────────────────────────────
  function extractText() {
    // 1. Code blocks (Grok puts JSON in <pre><code>)
    const blocks = [...document.querySelectorAll('pre code, pre')];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const t = blocks[i].innerText?.trim();
      if (t && (t.startsWith('{') || t.startsWith('['))) return t;
    }
    // 2. Last assistant message
    const candidates = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="message"]',
      '[class*="AssistantMessage"]',
      '[class*="message"][class*="assistant"]',
      'article',
    ];
    for (const sel of candidates) {
      const els = document.querySelectorAll(sel);
      for (let i = els.length - 1; i >= 0; i--) {
        const t = els[i].innerText?.trim();
        if (t && t.length > 30) return t;
      }
    }
    // 3. Scan for JSON anywhere on page
    const page = document.body.innerText || '';
    const m = page.match(/\{[\s\S]*?"videos"[\s\S]*?\}/);
    return m ? m[0] : '';
  }

  // ─────────────────────────────────────────────────────
  // Extract generated images
  // ─────────────────────────────────────────────────────
  async function imgToDataUrl(img) {
    try {
      const c = document.createElement('canvas');
      c.width  = img.naturalWidth  || 512;
      c.height = img.naturalHeight || 512;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.92);
    } catch {}
    try {
      const r = await fetch(img.src, { mode: 'cors' });
      const b = await r.blob();
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload  = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(b);
      });
    } catch {}
    return img.src;
  }

  async function extractImages() {
    const containerSelectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="message"]',
      'article', 'main',
    ];
    for (const sel of containerSelectors) {
      const containers = document.querySelectorAll(sel);
      for (let i = containers.length - 1; i >= 0; i--) {
        const imgs = [...containers[i].querySelectorAll('img')].filter(img => {
          const w   = img.naturalWidth || img.width || 0;
          const src = img.src || '';
          return w > 80 && src && !src.includes('avatar')
            && !src.includes('icon') && !src.includes('logo');
        });
        if (imgs.length > 0) return Promise.all(imgs.slice(0, 1).map(imgToDataUrl));
      }
    }
    return [];
  }

  // ─────────────────────────────────────────────────────
  // Wait for Grok to finish
  // ─────────────────────────────────────────────────────
  function waitForDone(expectImage, maxWait = 120_000) {
    return new Promise((resolve, reject) => {
      let started     = false;
      let settled     = false;
      let stableTimer = null;
      let lastSnap    = '';
      let checkCount  = 0;

      const tid = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        collectAndResolve();
      }, maxWait);

      async function collectAndResolve() {
        if (expectImage) {
          const imgs = await extractImages();
          if (imgs.length > 0) resolve({ imageDataUrl: imgs[0] });
          else reject(new Error('No image returned. Check that Grok Imagine is available on your account.'));
        } else {
          const t = extractText();
          if (t.length > 30) resolve({ text: t });
          else reject(new Error('Grok returned an empty response. Try again.'));
        }
      }

      async function finish() {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        clearTimeout(tid);
        if (stableTimer) clearTimeout(stableTimer);
        await sleep(300); // brief wait to ensure DOM is flushed
        collectAndResolve();
      }

      const pid = setInterval(() => {
        checkCount++;
        const streaming = isStreaming();
        const snap = expectImage
          ? String(document.querySelectorAll('img[src]').length)
          : extractText().slice(-100);

        if (!started) {
          // Wait up to 12s for streaming to start before giving up
          if (streaming || snap !== lastSnap) {
            started = true;
          } else if (checkCount > 30) {
            // 12 seconds passed, nothing happened — input may have failed
            settled = true;
            clearInterval(pid);
            clearTimeout(tid);
            reject(new Error(
              'Grok did not start responding. The prompt may not have been sent. ' +
              'Make sure you are logged in at grok.com.'
            ));
            return;
          }
          lastSnap = snap;
          return;
        }

        if (streaming) {
          // Still generating
          if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
          lastSnap = snap;
          return;
        }

        // Not streaming — wait for content to stop changing
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
    showOverlay(expectImage ? 'Generating image...' : 'Sending prompt...');

    const input = await waitForInput();

    showOverlay(expectImage ? 'Asking Grok Imagine...' : 'Typing prompt...');
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    await sleep(300);

    setReactValue(input, prompt);
    await sleep(400);

    // Verify value was set
    const currentVal = input.value || input.innerText || '';
    if (!currentVal.trim()) {
      throw new Error(
        'Could not set text in Grok\'s input. ' +
        'Try clicking on grok.com first, then generate again.'
      );
    }

    showOverlay(expectImage ? 'Submitting to Grok Imagine...' : 'Submitting...');
    submitInput(input);
    await sleep(600);

    showOverlay(expectImage ? 'Waiting for image...' : 'Waiting for response...');
    const result = await waitForDone(expectImage);

    showOverlay(expectImage ? '✓ Image received!' : '✓ Response received!');
    await sleep(800);
    hideOverlay();

    return result;
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
      sendResponse({ error: 'Grok is busy. Please wait for the current request to finish.' });
      return true;
    }

    busy = true;
    handlePrompt(msg.prompt, msg.expectImage ?? false)
      .then(r  => { busy = false; hideOverlay(); sendResponse(r); })
      .catch(e => { busy = false; hideOverlay(); sendResponse({ error: e.message }); });

    return true;
  });

  chrome.runtime.sendMessage({ type: 'BRIDGE_READY' });
  console.log('[Grok Bridge] Loaded on', location.hostname);

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

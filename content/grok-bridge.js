/**
 * Grok Bridge — Content Script
 * Runs on both grok.com (chat) and grok.com/imagine (image generation).
 * Detects which page it's on and uses the right strategy for each.
 */
(function () {
  'use strict';

  const IS_IMAGINE = location.pathname.startsWith('/imagine');

  // ─────────────────────────────────────────────────────
  // Visible status overlay
  // ─────────────────────────────────────────────────────
  let overlay = null;

  function showStatus(text) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.cssText = [
        'position:fixed', 'top:14px', 'right:14px', 'z-index:2147483647',
        'background:rgba(109,40,217,0.97)', 'color:#fff',
        'font:600 13px/1.5 -apple-system,sans-serif',
        'padding:10px 16px', 'border-radius:10px',
        'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
        'max-width:300px', 'word-break:break-word',
      ].join(';');
      document.body.appendChild(overlay);
    }
    overlay.textContent = '🎬 ' + text;
    overlay.style.display = 'block';
    console.log('[Grok Bridge]', text);
  }

  function hideStatus() {
    if (overlay) overlay.style.display = 'none';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─────────────────────────────────────────────────────
  // Generic: wait for an element matching a selector
  // ─────────────────────────────────────────────────────
  function waitFor(selectorFn, timeout = 20_000) {
    return new Promise((resolve, reject) => {
      const found = selectorFn();
      if (found) return resolve(found);

      const deadline = setTimeout(() => {
        obs.disconnect();
        reject(new Error('Element not found after ' + timeout + 'ms'));
      }, timeout);

      const obs = new MutationObserver(() => {
        const el = selectorFn();
        if (el) { clearTimeout(deadline); obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ─────────────────────────────────────────────────────
  //  ██████╗ ██╗  ██╗ █████╗ ████████╗
  // ██╔════╝ ██║  ██║██╔══██╗╚══██╔══╝
  // ██║      ███████║███████║   ██║
  // ██║      ██╔══██║██╔══██║   ██║
  // ╚██████╗ ██║  ██║██║  ██║   ██║
  //  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
  //
  //  grok.com/imagine — dedicated image generation page
  // ─────────────────────────────────────────────────────

  async function handleImagine(prompt) {
    showStatus('Finding Grok Imagine input...');

    // Use the EXACT placeholder text visible in the UI: "Type to imagine"
    const input = await waitFor(() =>
      document.querySelector('input[placeholder="Type to imagine"]') ||
      document.querySelector('textarea[placeholder="Type to imagine"]') ||
      document.querySelector('input[placeholder*="imagine" i]') ||
      document.querySelector('textarea[placeholder*="imagine" i]') ||
      document.querySelector('input[placeholder*="Imagine" i]') ||
      document.querySelector('input[placeholder]') ||
      document.querySelector('textarea')
    , 25_000).catch(() => {
      throw new Error(
        'Could not find the "Type to imagine" input on grok.com/imagine. ' +
        'Make sure you are logged in and the page is fully loaded.'
      );
    });

    showStatus('Typing prompt into Grok Imagine...');
    input.focus();
    await sleep(300);

    // Set value — use native React setter so React sees the change
    const inputProto    = window.HTMLInputElement.prototype;
    const textareProto  = window.HTMLTextAreaElement.prototype;
    const setter =
      Object.getOwnPropertyDescriptor(inputProto,   'value')?.set ||
      Object.getOwnPropertyDescriptor(textareProto, 'value')?.set;

    if (setter) {
      setter.call(input, prompt);
    } else {
      input.value = prompt;
    }
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);

    // Find the send arrow button (↑ icon, bottom-right of the input bar)
    showStatus('Clicking send...');
    const sendBtn = (
      // Arrow / send button closest to the input
      input.closest('form, div')?.querySelector('button[type="submit"]') ||
      input.closest('form, div')?.querySelector('button:last-of-type') ||
      document.querySelector('button[aria-label*="send" i]') ||
      document.querySelector('button[aria-label*="submit" i]') ||
      document.querySelector('button[type="submit"]') ||
      // The arrow button is typically the last button in the input container
      (() => {
        const container = input.closest('[class*="input"], [class*="compose"], [class*="prompt"], form, footer, div');
        if (container) {
          const btns = [...container.querySelectorAll('button')].filter(b => !b.disabled);
          return btns[btns.length - 1]; // last button = send arrow
        }
        return null;
      })()
    );

    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fall back to Enter key on the input
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13,
        which: 13, bubbles: true, cancelable: true,
      }));
    }

    await sleep(500);

    // Wait for image to appear
    showStatus('Waiting for Grok Imagine to generate image...');
    const imageDataUrl = await waitForImagineResult();
    showStatus('✓ Image generated!');
    await sleep(800);
    hideStatus();
    return { imageDataUrl };
  }

  async function waitForImagineResult(maxWait = 120_000) {
    // Snapshot of existing images before generation
    const existingImgs = new Set(
      [...document.querySelectorAll('img[src]')].map(i => i.src)
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      let checkCount = 0;

      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        reject(new Error('Grok Imagine did not return an image in time.'));
      }, maxWait);

      const pid = setInterval(async () => {
        checkCount++;

        // Look for new images that weren't there before
        const allImgs = [...document.querySelectorAll('img[src]')];
        const newImgs = allImgs.filter(img => {
          const src = img.src;
          const w   = img.naturalWidth || img.width || 0;
          return (
            !existingImgs.has(src) &&
            w > 100 &&
            !src.includes('avatar') &&
            !src.includes('icon') &&
            !src.includes('logo') &&
            !src.includes('spinner') &&
            !src.includes('loading')
          );
        });

        if (newImgs.length > 0) {
          settled = true;
          clearInterval(pid);
          clearTimeout(deadline);

          const dataUrl = await imgToDataUrl(newImgs[0]);
          resolve(dataUrl);
          return;
        }

        // After 60s with nothing, give up
        if (checkCount > 150) {
          settled = true;
          clearInterval(pid);
          clearTimeout(deadline);
          reject(new Error('No image appeared on grok.com/imagine. Try logging in again.'));
        }
      }, 400);
    });
  }

  // ─────────────────────────────────────────────────────
  //  ██████╗██╗  ██╗ █████╗ ████████╗
  // ██╔════╝██║  ██║██╔══██╗╚══██╔══╝
  // ██║     ███████║███████║   ██║
  // ██║     ██╔══██║██╔══██║   ██║
  // ╚██████╗██║  ██║██║  ██║   ██║
  //  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝
  //
  //  grok.com — chat interface for script generation
  // ─────────────────────────────────────────────────────

  async function handleChat(prompt) {
    showStatus('Finding Grok chat input...');

    const input = await waitFor(() =>
      document.querySelector('textarea[data-testid]') ||
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"]')
    ).catch(() => {
      throw new Error(
        'Could not find Grok chat input. ' +
        'Make sure you are logged in at grok.com.'
      );
    });

    showStatus('Pasting script prompt...');
    input.focus();
    await sleep(200);

    // Native React setter
    const isTextarea = input.tagName === 'TEXTAREA';
    const proto  = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      if (setter) setter.call(input, prompt); else input.value = prompt;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, prompt);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(300);

    // Verify it was set
    const val = input.value || input.innerText || '';
    if (!val.trim()) {
      throw new Error(
        'Text could not be set in Grok\'s input. ' +
        'Please click on the grok.com tab once, then try again.'
      );
    }

    showStatus('Submitting to Grok...');

    // Submit: try button then Enter
    const btn = (
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label="Send"]') ||
      document.querySelector('button[data-testid*="send" i]') ||
      [...document.querySelectorAll('button')].find(b =>
        !b.disabled && b.querySelector('svg') &&
        b.closest('form, main, footer, [class*="input"], [class*="compose"]')
      )
    );
    if (btn) btn.click();
    else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13,
        which: 13, bubbles: true, cancelable: true,
      }));
    }
    await sleep(500);

    showStatus('Waiting for Grok to respond...');
    const text = await waitForChatResponse();
    showStatus('✓ Script received!');
    await sleep(800);
    hideStatus();
    return { text };
  }

  function waitForChatResponse(maxWait = 120_000) {
    return new Promise((resolve, reject) => {
      let started  = false;
      let settled  = false;
      let stable   = null;
      let lastSnap = '';
      let ticks    = 0;

      const deadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(pid);
        const t = extractText();
        t.length > 30 ? resolve(t) : reject(new Error('Grok timed out without responding.'));
      }, maxWait);

      const pid = setInterval(() => {
        ticks++;
        const streaming = isStreaming();
        const snap = extractText().slice(-120);

        if (!started) {
          if (streaming || snap !== lastSnap) started = true;
          else if (ticks > 30) {
            // 12 s with no activity — input likely failed
            settled = true; clearInterval(pid); clearTimeout(deadline);
            reject(new Error(
              'Grok did not respond. The prompt may not have been sent. ' +
              'Try clicking the grok.com tab once, then generate again.'
            ));
          }
          lastSnap = snap; return;
        }

        if (streaming) { lastSnap = snap; if (stable) { clearTimeout(stable); stable = null; } return; }

        if (snap !== lastSnap) {
          lastSnap = snap;
          if (stable) clearTimeout(stable);
          stable = setTimeout(finish, 1500);
        } else if (!stable) {
          stable = setTimeout(finish, 1500);
        }
      }, 400);

      function finish() {
        if (settled) return;
        settled = true; clearInterval(pid); clearTimeout(deadline);
        setTimeout(() => {
          const t = extractText();
          t.length > 30 ? resolve(t) : reject(new Error('Grok returned an empty response.'));
        }, 300);
      }
    });
  }

  function isStreaming() {
    return !![
      document.querySelector('button[aria-label*="Stop" i]'),
      document.querySelector('button[data-testid*="stop"]'),
      [...document.querySelectorAll('button')].find(b => /^stop/i.test(b.textContent.trim())),
    ].find(Boolean);
  }

  function extractText() {
    const blocks = [...document.querySelectorAll('pre code, pre')];
    for (let i = blocks.length - 1; i >= 0; i--) {
      const t = blocks[i].innerText?.trim();
      if (t && (t.startsWith('{') || t.startsWith('['))) return t;
    }
    const sels = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="message"]',
      '[class*="AssistantMessage"]',
      'article',
    ];
    for (const sel of sels) {
      const els = document.querySelectorAll(sel);
      for (let i = els.length - 1; i >= 0; i--) {
        const t = els[i].innerText?.trim();
        if (t && t.length > 30) return t;
      }
    }
    return '';
  }

  // ─────────────────────────────────────────────────────
  // Image conversion helper
  // ─────────────────────────────────────────────────────
  async function imgToDataUrl(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 512; c.height = img.naturalHeight || 512;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.92);
    } catch {}
    try {
      const r = await fetch(img.src, { mode: 'cors' });
      const b = await r.blob();
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(b);
      });
    } catch {}
    return img.src;
  }

  // ─────────────────────────────────────────────────────
  // Message listener
  // ─────────────────────────────────────────────────────
  let busy = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ pong: true }); return true; }
    if (msg.type !== 'INJECT_PROMPT') return false;

    if (busy) {
      sendResponse({ error: 'Grok bridge is busy. Please wait.' });
      return true;
    }

    busy = true;

    const handler = (IS_IMAGINE || msg.expectImage)
      ? handleImagine(msg.prompt)
      : handleChat(msg.prompt);

    handler
      .then(r  => { busy = false; hideStatus(); sendResponse(r); })
      .catch(e => { busy = false; hideStatus(); sendResponse({ error: e.message }); });

    return true;
  });

  chrome.runtime.sendMessage({ type: 'BRIDGE_READY' });
  console.log('[Grok Bridge] Ready on', location.pathname);
})();

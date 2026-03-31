/**
 * Grok Bridge — Content Script
 * Runs on grok.com. Listens for INJECT_PROMPT messages from the background
 * service worker, types the prompt into Grok's chat input, submits it,
 * waits for the full response, then sends it back.
 */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Selectors (Grok.com UI — multiple fallbacks for resilience)
  // -----------------------------------------------------------------------

  /** Find the main chat textarea / contenteditable input */
  function findInput() {
    return (
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][data-testid]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('div[role="textbox"]')
    );
  }

  /** Find the send / submit button */
  function findSendButton() {
    return (
      document.querySelector('button[aria-label*="Send" i]') ||
      document.querySelector('button[aria-label*="submit" i]') ||
      document.querySelector('button[data-testid*="send" i]') ||
      document.querySelector('button[type="submit"]') ||
      // Look for a button near the input
      (() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.find(b =>
          b.querySelector('svg') &&
          b.closest('form,div[role="form"],.chat-input,footer')
        );
      })()
    );
  }

  /**
   * Find the "stop generating" button — its presence means Grok is still
   * streaming. When it disappears we know the response is done.
   */
  function findStopButton() {
    return (
      document.querySelector('button[aria-label*="Stop" i]') ||
      document.querySelector('button[aria-label*="stop" i]') ||
      document.querySelector('button[data-testid*="stop" i]') ||
      [...document.querySelectorAll('button')].find(b =>
        b.textContent.trim().toLowerCase().includes('stop')
      )
    );
  }

  /**
   * Find the last assistant message container
   */
  function findLastResponse() {
    // Common patterns across Grok versions
    const candidates = [
      ...document.querySelectorAll('[data-testid*="message"]'),
      ...document.querySelectorAll('[data-message-author-role="assistant"]'),
      ...document.querySelectorAll('.message-content'),
      ...document.querySelectorAll('[class*="message"][class*="assistant"]'),
      ...document.querySelectorAll('[class*="response"]'),
      ...document.querySelectorAll('article'),
    ];

    // Return the last one that has text content
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      const text = el.innerText?.trim();
      if (text && text.length > 10) return el;
    }

    return null;
  }

  /**
   * Get the full text of the last response, trying to extract the
   * raw text (not formatted HTML).
   */
  function extractResponseText() {
    // 1. Try to find a code block first (Grok often puts JSON in ```json blocks)
    const codeBlocks = document.querySelectorAll('pre code, code.language-json, pre');
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const text = codeBlocks[i].innerText?.trim();
      if (text && text.startsWith('{')) return text;
    }

    // 2. Fall back to last assistant message
    const el = findLastResponse();
    if (el) return el.innerText?.trim() || '';

    // 3. Last resort: scan all text visible on page for a JSON block
    const allText = document.body.innerText || '';
    const jsonMatch = allText.match(/\{[\s\S]*"seriesTitle"[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];

    return '';
  }

  // -----------------------------------------------------------------------
  // Core: type text into input
  // -----------------------------------------------------------------------

  /**
   * Set the value of a textarea using React's synthetic events
   * (plain assignment is often ignored by React-controlled inputs)
   */
  function setInputValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // React input override
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      el.focus();
      el.innerHTML = '';
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  }

  /**
   * Click the send button or press Enter to submit
   */
  function submitInput(input) {
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
      return;
    }
    // Fallback: Ctrl+Enter or Enter
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13,
      bubbles: true, ctrlKey: false,
    }));
  }

  // -----------------------------------------------------------------------
  // Core: wait for Grok to finish responding
  // -----------------------------------------------------------------------

  /**
   * Wait until Grok finishes streaming its response.
   * Strategy:
   *  1. Watch for the stop button to appear (streaming started)
   *  2. Then watch for it to disappear (streaming ended)
   *  3. Also use a MutationObserver on the response container as backup
   *  4. Timeout after maxWait ms
   */
  function waitForResponse(maxWait = 90_000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      let streamingStarted = false;
      let settled = false;
      let stableTimer = null;
      let lastText = '';

      function finish() {
        if (settled) return;
        settled = true;
        clearInterval(pollInterval);
        clearTimeout(timeoutHandle);
        if (stableTimer) clearTimeout(stableTimer);
        resolve(extractResponseText());
      }

      function onTimeout() {
        if (settled) return;
        settled = true;
        clearInterval(pollInterval);
        // Return whatever we have so far (partial is better than nothing)
        const text = extractResponseText();
        if (text.length > 50) {
          resolve(text);
        } else {
          reject(new Error('Grok did not respond in time. Make sure you are logged in at grok.com.'));
        }
      }

      const timeoutHandle = setTimeout(onTimeout, maxWait);

      const pollInterval = setInterval(() => {
        const stopBtn = findStopButton();
        const currentText = extractResponseText();

        if (!streamingStarted) {
          // Detect start: either stop button appeared, or text started growing
          if (stopBtn || (currentText.length > lastText.length && currentText.length > 20)) {
            streamingStarted = true;
          }
          lastText = currentText;
          return;
        }

        // Streaming started — wait for it to stop
        if (!stopBtn) {
          // No stop button; check text has stabilised (no change for 1.5s)
          if (currentText !== lastText) {
            lastText = currentText;
            if (stableTimer) clearTimeout(stableTimer);
            stableTimer = setTimeout(finish, 1500);
          } else if (!stableTimer) {
            stableTimer = setTimeout(finish, 1500);
          }
        } else {
          // Stop button still present — still streaming
          lastText = currentText;
          if (stableTimer) { clearTimeout(stableTimer); stableTimer = null; }
        }
      }, 300);
    });
  }

  // -----------------------------------------------------------------------
  // Main entry: inject prompt and get response
  // -----------------------------------------------------------------------

  async function injectAndRespond(prompt) {
    // 1. Find input
    const input = findInput();
    if (!input) {
      throw new Error(
        'Could not find Grok\'s chat input. Make sure grok.com is fully loaded and you are logged in.'
      );
    }

    // 2. Scroll to bottom / focus input
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    await sleep(300);

    // 3. Clear any existing text and set our prompt
    setInputValue(input, prompt);
    await sleep(400);

    // 4. Submit
    submitInput(input);
    await sleep(500);

    // 5. Wait for full response
    const text = await waitForResponse();
    return text;
  }

  // -----------------------------------------------------------------------
  // Message listener
  // -----------------------------------------------------------------------

  let busy = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ pong: true });
      return true;
    }

    if (msg.type !== 'INJECT_PROMPT') return false;

    if (busy) {
      sendResponse({ error: 'Grok bridge is busy with another request. Please wait.' });
      return true;
    }

    busy = true;

    injectAndRespond(msg.prompt)
      .then(text => {
        busy = false;
        sendResponse({ text });
      })
      .catch(err => {
        busy = false;
        sendResponse({ error: err.message });
      });

    return true; // async
  });

  // Announce readiness to background
  chrome.runtime.sendMessage({ type: 'BRIDGE_READY' });

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  console.log('[Grok Video Bridge] Content script loaded on', location.hostname);
})();

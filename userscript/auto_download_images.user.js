// ==UserScript==
// @name         ChatGPT Auto Download Images
// @namespace    chatgpt-auto-dl
// @version      5.0.0
// @description  Auto-download only NEW AI-generated images (polling approach)
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const downloaded = new Set();
  let initialized = false;

  function isGeneratedImage(src) {
    return src && src.includes('backend-api/estuary/content');
  }

  function isAssistantImage(img) {
    let el = img;
    while (el && el !== document.body) {
      const role = el.getAttribute && el.getAttribute('data-message-author-role');
      if (role === 'assistant') return true;
      if (role === 'user') return false;
      el = el.parentElement;
    }
    return false;
  }

  function downloadImg(src) {
    if (downloaded.has(src)) return;
    downloaded.add(src);
    const name = 'chatgpt_' + Date.now() + '.png';
    console.log('[AutoDL v5] Downloading:', src.substring(0, 100));
    if (typeof GM_download !== 'undefined') {
      GM_download({ url: src, name: name });
    } else {
      const a = document.createElement('a');
      a.href = src; a.download = name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  function scanImages() {
    const imgs = document.querySelectorAll('img');
    let newFound = null;
    for (const img of imgs) {
      const src = img.src || '';
      if (!isGeneratedImage(src)) continue;
      if (downloaded.has(src)) continue;
      if (!initialized) {
        // First scan: mark all as existing
        downloaded.add(src);
        continue;
      }
      if (!isAssistantImage(img)) continue;
      // Found a new assistant image!
      newFound = src;
    }
    if (!initialized) {
      initialized = true;
      console.log('[AutoDL v5] Init done. Marked', downloaded.size, 'existing images.');
    }
    // Download only the LATEST new image
    if (newFound) {
      downloadImg(newFound);
    }
  }

  // First scan after 5 seconds (mark existing)
  setTimeout(() => {
    scanImages();
    // Then poll every 3 seconds
    setInterval(scanImages, 3000);
    console.log('[AutoDL v5] Polling started (every 3s).');
  }, 5000);

  console.log('[AutoDL v5] Loaded. Will start in 5 seconds...');
})();

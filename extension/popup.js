// popup.js - Interactive Controller for ZVibe TikTok Helper Extension
document.addEventListener('DOMContentLoaded', () => {
  const btnOpenLocal = document.getElementById('btn-open-local');
  const btnOpenWeb = document.getElementById('btn-open-web');
  const localStatusTag = document.getElementById('local-status-tag');

  // Check if Localhost is running on user's machine
  const checkLocalhost = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      await fetch('http://localhost:3000', { mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);
      if (localStatusTag) {
        localStatusTag.textContent = '🟢 Đang chạy';
        localStatusTag.style.color = '#15803d';
        localStatusTag.style.fontWeight = '700';
      }
    } catch (_) {
      // Localhost not actively responding
      if (localStatusTag) {
        localStatusTag.textContent = 'Mở tab ↗';
      }
    }
  };

  checkLocalhost();

  // Helper to open or focus a specific URL
  const openOrFocusUrl = (targetUrl, urlPatterns) => {
    chrome.tabs.query({}, (tabs) => {
      // Find if user already has this tab open
      const existingTab = tabs.find(t => {
        if (!t.url) return false;
        return urlPatterns.some(pattern => t.url.includes(pattern));
      });

      if (existingTab && existingTab.id) {
        // Focus existing tab and window
        chrome.tabs.update(existingTab.id, { active: true }, () => {
          if (existingTab.windowId) {
            chrome.windows.update(existingTab.windowId, { focused: true }, () => {});
          }
          window.close();
        });
      } else {
        // Create new tab
        chrome.tabs.create({ url: targetUrl }, () => {
          window.close();
        });
      }
    });
  };

  // Button 1: Open Localhost
  if (btnOpenLocal) {
    btnOpenLocal.addEventListener('click', (e) => {
      e.preventDefault();
      openOrFocusUrl('http://localhost:3000', ['localhost:3000', '127.0.0.1:3000']);
    });
  }

  // Button 2: Open Web Render
  if (btnOpenWeb) {
    btnOpenWeb.addEventListener('click', (e) => {
      e.preventDefault();
      openOrFocusUrl('https://tiktok-trending-tool.onrender.com', ['tiktok-trending-tool.onrender.com']);
    });
  }
});

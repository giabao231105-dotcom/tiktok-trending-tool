// bridge-content.js - Connects Web App (Render / Local) with ZVibe Chrome Extension
console.log('[ZVibe Extension] Bridge content script initialized.');

let heartbeatInterval = null;

// Notify the web page immediately and periodically that Extension is active
function broadcastReady() {
  try {
    if (!chrome.runtime?.id) {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      return;
    }
    window.postMessage({
      type: 'ZVIBE_EXTENSION_READY',
      version: '2.2.1',
      timestamp: Date.now()
    }, '*');
  } catch (_) {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  }
}

broadcastReady();
// Keep heartbeat so Single Page App (React) always detects it across re-renders
heartbeatInterval = setInterval(broadcastReady, 1500);

// Listen for messages from the web app
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // React pinging to check extension status
  if (event.data.type === 'ZVIBE_PING_EXTENSION') {
    try {
      if (!chrome.runtime?.id) return;
      window.postMessage({
        type: 'ZVIBE_PONG_EXTENSION',
        version: '2.2.1'
      }, '*');
    } catch (_) {}
    return;
  }

  // Web App requests channel scan
  if (event.data.type === 'ZVIBE_START_CHANNEL_SCAN') {
    const { channelUrl, limit } = event.data;
    console.log('[ZVibe Extension Bridge] Received SCAN request:', channelUrl, 'limit:', limit);

    try {
      if (!chrome.runtime?.id) {
        window.postMessage({
          type: 'ZVIBE_CHANNEL_SCAN_ERROR',
          error: 'Extension vừa được tải lại. Vui lòng bấm F5 (Tải lại trang web này) để kết nối!'
        }, '*');
        return;
      }

      chrome.runtime.sendMessage({
        action: 'START_CHANNEL_SCAN',
        channelUrl,
        limit: Number(limit) || 30
      }, (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          console.error('[ZVibe Extension Bridge] Runtime error:', errMsg);
          const isInvalidated = errMsg.includes('Extension context invalidated');
          window.postMessage({
            type: 'ZVIBE_CHANNEL_SCAN_ERROR',
            error: isInvalidated
              ? 'Tiện ích Extension vừa được tải lại. Vui lòng bấm F5 (Tải lại trang web) để kết nối!'
              : (errMsg || 'Không thể kết nối với Extension background script.')
          }, '*');
          return;
        }

        if (response && response.success) {
          console.log('[ZVibe Extension Bridge] Scan finished successfully:', response);
          window.postMessage({
            type: 'ZVIBE_CHANNEL_SCAN_DONE',
            ...response
          }, '*');
        } else {
          console.warn('[ZVibe Extension Bridge] Scan returned failure:', response);
          window.postMessage({
            type: 'ZVIBE_CHANNEL_SCAN_ERROR',
            error: response?.error || 'Quá trình quét kênh thất bại.'
          }, '*');
        }
      });
    } catch (err) {
      console.error('[ZVibe Extension Bridge] Failed to send message to background:', err);
      const isInvalidated = (err.message || '').includes('Extension context invalidated');
      window.postMessage({
        type: 'ZVIBE_CHANNEL_SCAN_ERROR',
        error: isInvalidated
          ? 'Tiện ích Extension vừa được tải lại. Vui lòng bấm F5 (Tải lại trang web) để kết nối!'
          : (err.message || 'Lỗi kết nối tiện ích.')
      }, '*');
    }
  }
});

// Listen for progress events from background service worker and relay to React
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'SCRAPE_PROGRESS') {
      window.postMessage({
        type: 'ZVIBE_CHANNEL_SCAN_PROGRESS',
        count: msg.count,
        limit: msg.limit
      }, '*');
    }
  });
} catch (_) {}

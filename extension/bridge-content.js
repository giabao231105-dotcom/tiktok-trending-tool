// bridge-content.js - Connects Web App (Render / Local) with ZVibe Chrome Extension
console.log('[ZVibe Extension] Bridge content script initialized.');

// Notify the web page immediately and periodically that Extension is active
function broadcastReady() {
  window.postMessage({
    type: 'ZVIBE_EXTENSION_READY',
    version: '1.0.0',
    timestamp: Date.now()
  }, '*');
}

broadcastReady();
// Keep heartbeat so Single Page App (React) always detects it across re-renders
setInterval(broadcastReady, 1500);

// Listen for messages from the web app
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  // React pinging to check extension status
  if (event.data.type === 'ZVIBE_PING_EXTENSION') {
    window.postMessage({
      type: 'ZVIBE_PONG_EXTENSION',
      version: '1.0.0'
    }, '*');
    return;
  }

  // Web App requests channel scan
  if (event.data.type === 'ZVIBE_START_CHANNEL_SCAN') {
    const { channelUrl, limit } = event.data;
    console.log('[ZVibe Extension Bridge] Received SCAN request:', channelUrl, 'limit:', limit);

    try {
      chrome.runtime.sendMessage({
        action: 'START_CHANNEL_SCAN',
        channelUrl,
        limit: Number(limit) || 30
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[ZVibe Extension Bridge] Runtime error:', chrome.runtime.lastError);
          window.postMessage({
            type: 'ZVIBE_CHANNEL_SCAN_ERROR',
            error: chrome.runtime.lastError.message || 'Không thể kết nối với Extension background script.'
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
      window.postMessage({
        type: 'ZVIBE_CHANNEL_SCAN_ERROR',
        error: err.message
      }, '*');
    }
  }
});

// background.js - Service Worker for ZVibe TikTok Trending Helper
console.log('[ZVibe Extension] Background service worker loaded.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_CHANNEL_SCAN') {
    handleScanChannel(request, sender, sendResponse);
    return true; // Keep asynchronous message channel open
  }
});

async function handleScanChannel(request, sender, sendResponse) {
  let { channelUrl, limit = 30 } = request;
  console.log('[ZVibe BG] Starting scan for:', channelUrl, 'Target limit:', limit);

  // Normalize channel URL
  let targetUrl = (channelUrl || '').trim();
  const usernameMatch = targetUrl.match(/(?:@|tiktok\.com\/@?)([a-zA-Z0-9_.-]+)/i);
  if (usernameMatch) {
    targetUrl = `https://www.tiktok.com/@${usernameMatch[1]}`;
  } else if (!targetUrl.startsWith('http')) {
    const cleanUser = targetUrl.replace(/^@+/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^tiktok\.com\/?@?/, '');
    targetUrl = `https://www.tiktok.com/@${cleanUser}`;
  } else {
    targetUrl = targetUrl.split('?')[0].replace(/\/+$/, '');
  }

  const callerTabId = sender?.tab?.id;
  let tiktokTabId = null;
  let isDone = false;

  // Dynamic Timeout guard - resets whenever new progress is made
  const resetTimeout = (seconds = 90) => {
    if (timeoutGuard) clearTimeout(timeoutGuard);
    timeoutGuard = setTimeout(async () => {
      if (!isDone) {
        isDone = true;
        cleanup();
        sendResponse({
          success: false,
          error: `Đã tạm dừng do kênh không phản hồi thêm video mới (${seconds}s). Vui lòng thử lại.`
        });
      }
    }, seconds * 1000);
  };

  let timeoutGuard = null;
  resetTimeout(limit >= 9999 ? 120 : 60);

  const cleanup = async () => {
    if (timeoutGuard) clearTimeout(timeoutGuard);
    chrome.runtime.onMessage.removeListener(tiktokListener);
    if (tiktokTabId) {
      try {
        await chrome.tabs.remove(tiktokTabId);
      } catch (_) {}
    }
    // Switch focus back to the user's web tool tab
    if (callerTabId) {
      try {
        await chrome.tabs.update(callerTabId, { active: true });
      } catch (_) {}
    }
  };

  const tiktokListener = async (msg, msgSender) => {
    if (msgSender.tab && msgSender.tab.id === tiktokTabId) {
      if (msg.action === 'TIKTOK_PAGE_READY') {
        console.log('[ZVibe BG] TikTok page ready, sending EXECUTE_SCRAPE command...');
        try {
          await chrome.tabs.sendMessage(tiktokTabId, {
            action: 'EXECUTE_SCRAPE',
            limit: limit
          }).catch(() => {});
        } catch (err) {
          console.warn('[ZVibe BG] Notice sending EXECUTE_SCRAPE:', err);
        }
      } else if (msg.action === 'SCRAPE_PROGRESS') {
        // Reset timeout guard since the scraper is actively finding videos
        resetTimeout(limit >= 9999 ? 120 : 60);
        // Relay progress to caller tab
        if (callerTabId) {
          try {
            chrome.tabs.sendMessage(callerTabId, {
              action: 'SCRAPE_PROGRESS',
              count: msg.count,
              limit: msg.limit
            }).catch(() => {});
          } catch (_) {}
        }
      } else if (msg.action === 'SCRAPE_FINISHED') {
        if (!isDone) {
          isDone = true;
          if (timeoutGuard) clearTimeout(timeoutGuard);
          console.log(`[ZVibe BG] Scrape complete! Found ${msg.videos?.length || 0} videos.`);
          await cleanup();
          sendResponse({
            success: true,
            videos: msg.videos || [],
            uploader: msg.uploader || '',
            uploaderId: msg.uploaderId || '',
            avatar: msg.avatar || ''
          });
        }
      } else if (msg.action === 'SCRAPE_FAILED') {
        if (!isDone) {
          isDone = true;
          if (timeoutGuard) clearTimeout(timeoutGuard);
          console.warn('[ZVibe BG] Scrape reported failure:', msg.error);
          await cleanup();
          sendResponse({
            success: false,
            error: msg.error || 'Không thể quét danh sách video từ kênh này.'
          });
        }
      }
    }
  };

  chrome.runtime.onMessage.addListener(tiktokListener);

  try {
    // Open TikTok tab in active state so browser naturally executes scripts and renders layout
    const tab = await chrome.tabs.create({
      url: targetUrl,
      active: true
    });
    tiktokTabId = tab.id;
  } catch (err) {
    clearTimeout(timeoutGuard);
    cleanup();
    sendResponse({
      success: false,
      error: `Không thể mở tab TikTok: ${err.message}`
    });
  }
}

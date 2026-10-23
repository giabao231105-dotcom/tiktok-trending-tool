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
  let latestVideos = [];
  let latestMeta = {};

  const cleanup = async () => {
    if (timeoutGuard) clearTimeout(timeoutGuard);
    chrome.runtime.onMessage.removeListener(tiktokListener);
    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
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

  // Dynamic Timeout guard - resets whenever progress or scrolling is happening
  let timeoutGuard = null;
  const resetTimeout = (seconds = 90) => {
    if (timeoutGuard) clearTimeout(timeoutGuard);
    timeoutGuard = setTimeout(async () => {
      if (!isDone) {
        isDone = true;
        // If we already collected videos, return them gracefully instead of failing!
        if (latestVideos && latestVideos.length > 0) {
          console.log(`[ZVibe BG] Timeout reached, but returning ${latestVideos.length} already collected videos.`);
          await cleanup();
          sendResponse({
            success: true,
            videos: latestVideos,
            uploader: latestMeta.uploader || '',
            uploaderId: latestMeta.uploaderId || '',
            avatar: latestMeta.avatar || ''
          });
        } else {
          await cleanup();
          sendResponse({
            success: false,
            error: `Đã tạm dừng do kênh không phản hồi thêm video mới (${seconds}s). Vui lòng thử lại.`
          });
        }
      }
    }, seconds * 1000);
  };

  // Generous initial timeout (180s for all, 90s otherwise)
  resetTimeout(limit >= 9999 ? 180 : 90);

  const triggerScrape = async () => {
    if (!tiktokTabId || isDone) return;
    try {
      await chrome.tabs.sendMessage(tiktokTabId, {
        action: 'EXECUTE_SCRAPE',
        limit: limit
      });
      console.log('[ZVibe BG] Sent EXECUTE_SCRAPE to tab:', tiktokTabId);
    } catch (_) {}
  };

  const tabUpdateListener = (tabId, changeInfo) => {
    if (tabId === tiktokTabId && changeInfo.status === 'complete') {
      setTimeout(triggerScrape, 1200);
    }
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);

  const tiktokListener = async (msg, msgSender) => {
    if (msgSender.tab && msgSender.tab.id === tiktokTabId) {
      if (msg.action === 'TIKTOK_PAGE_READY') {
        console.log('[ZVibe BG] TikTok page ready, sending EXECUTE_SCRAPE command...');
        await triggerScrape();
      } else if (msg.action === 'SCRAPE_PROGRESS') {
        // Reset timeout guard since the scraper is actively working
        resetTimeout(limit >= 9999 ? 120 : 60);

        if (msg.videos && Array.isArray(msg.videos) && msg.videos.length > 0) {
          latestVideos = msg.videos;
        }
        if (msg.uploader || msg.uploaderId) {
          latestMeta = {
            uploader: msg.uploader || latestMeta.uploader,
            uploaderId: msg.uploaderId || latestMeta.uploaderId,
            avatar: msg.avatar || latestMeta.avatar
          };
        }

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
            videos: (msg.videos && msg.videos.length > 0) ? msg.videos : latestVideos,
            uploader: msg.uploader || latestMeta.uploader || '',
            uploaderId: msg.uploaderId || latestMeta.uploaderId || '',
            avatar: msg.avatar || latestMeta.avatar || ''
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
    // Schedule backup triggers in case page loaded faster than listener registration
    setTimeout(triggerScrape, 2000);
    setTimeout(triggerScrape, 4000);
  } catch (err) {
    if (timeoutGuard) clearTimeout(timeoutGuard);
    cleanup();
    sendResponse({
      success: false,
      error: `Không thể mở tab TikTok: ${err.message}`
    });
  }
}

// tiktok-scraper.js - Injected into TikTok to scrape channel video links organically
console.log('[ZVibe Extension] TikTok Scraper injected into:', window.location.href);

let overlayEl = null;

function createProgressOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'zvibe-scraper-overlay';
  overlayEl.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 999999999;
    background: linear-gradient(135deg, #1e1b4b, #312e81);
    color: #ffffff;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.5);
    border: 1px solid rgba(129, 140, 248, 0.3);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-width: 280px;
    max-width: 360px;
    backdrop-filter: blur(8px);
    transition: all 0.3s ease;
  `;

  overlayEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
      <div style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; animation: pulse 1.5s infinite;"></div>
      <strong style="font-size: 14px; font-weight: 700; color: #e0e7ff; letter-spacing: 0.5px;">ZVibe TikTok Helper</strong>
    </div>
    <div id="zvibe-status-text" style="font-size: 13px; color: #cbd5e1; margin-bottom: 6px;">
      Đang chuẩn bị quét danh sách video...
    </div>
    <div id="zvibe-counter" style="font-size: 15px; font-weight: 600; color: #38bdf8;">
      Đã quét: 0 video
    </div>
    <div style="margin-top: 8px; font-size: 11px; color: #94a3b8; font-style: italic;">
      Vui lòng không tắt tab này, hệ thống sẽ tự đóng khi hoàn tất...
    </div>
  `;

  document.body.appendChild(overlayEl);
}

function updateOverlay(text, count, limit) {
  if (!overlayEl) createProgressOverlay();
  const statusEl = document.getElementById('zvibe-status-text');
  const counterEl = document.getElementById('zvibe-counter');
  if (statusEl) statusEl.innerText = text;
  if (counterEl) {
    if (limit >= 9999) {
      counterEl.innerText = `Đã quét: ${count} video (Đang cào toàn bộ đến đáy kênh...)`;
    } else {
      counterEl.innerText = `Đã quét: ${count} / ${limit} video`;
    }
  }
}

function parseCount(text) {
  if (!text) return 0;
  text = String(text).trim().toUpperCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (text.includes('M')) {
    const num = parseFloat(text);
    return Math.round((isNaN(num) ? 0 : num) * 1000000);
  } else if (text.includes('K')) {
    const num = parseFloat(text);
    return Math.round((isNaN(num) ? 0 : num) * 1000);
  } else if (text.includes('B')) {
    const num = parseFloat(text);
    return Math.round((isNaN(num) ? 0 : num) * 1000000000);
  }
  const clean = text.replace(/[^0-9.]/g, '');
  return parseInt(clean, 10) || 0;
}

// Extract unique video cards with rich metadata directly from the DOM
function extractVideoItems(uploader, uploaderId) {
  const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
  const foundMap = new Map();

  for (const a of anchors) {
    const href = a.href || '';
    const match = href.match(/\/video\/(\d+)/);
    if (match) {
      const vid = match[1];
      if (!foundMap.has(vid)) {
        const cleanUrl = href.split('?')[0];

        // Locate card container
        const card = a.closest('[data-e2e="user-post-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement || a;
        
        // Thumbnail
        const img = a.querySelector('img') || card.querySelector('img');
        const thumbnail = img?.src || '';

        // Title / Description
        const title = img?.alt || a.getAttribute('title') || card.querySelector('[data-e2e="user-post-item-desc"]')?.innerText || 'TikTok Video';

        // Views count from card overlay
        let viewText = '';
        const viewEl = card.querySelector('[data-e2e="video-views"]') || 
                       card.querySelector('strong') || 
                       card.querySelector('[data-e2e*="view"]') ||
                       card.querySelector('[class*="VideoCount"]') ||
                       card.querySelector('[class*="PlayCount"]') ||
                       card.querySelector('[class*="count"]');
        if (viewEl) {
          viewText = viewEl.innerText || viewEl.textContent || '';
        }
        if (!viewText) {
          const strongEl = a.querySelector('strong') || a.querySelector('span');
          if (strongEl) viewText = strongEl.innerText || '';
        }
        if (!viewText) {
          const cardText = card.innerText || '';
          const matchNum = cardText.match(/(\d+[.,]?\d*\s*[KkMmBb]?)/);
          if (matchNum) viewText = matchNum[1];
        }
        const viewCount = parseCount(viewText);

        // Detect TikTok Shop product anchor if present
        const anchorEl = card.querySelector('[data-e2e*="anchor"]') || 
                         card.querySelector('a[href*="/product/"]') || 
                         card.querySelector('div[class*="Anchor"]') ||
                         card.querySelector('[class*="shop"]') ||
                         card.querySelector('[class*="product"]');
        const anchorText = anchorEl ? anchorEl.innerText.trim() : null;
        const caption = (title || '').toLowerCase();
        const hasShopMention = !!anchorText || /giỏ hàng|tiktokshop|tiktok shop|sản phẩm|mua tại/i.test(caption);

        let shopProduct = null;
        if (anchorText || hasShopMention) {
          shopProduct = {
            title: anchorText || 'Sản phẩm Giỏ hàng TikTok Shop',
            type: 'TikTokShop',
            icon: '🛍️',
            url: cleanUrl,
            isAffiliate: true
          };
        }

        foundMap.set(vid, {
          id: vid,
          title: title || 'TikTok Video',
          description: title || '',
          thumbnail: thumbnail,
          viewCount: viewCount,
          likeCount: 0,
          commentCount: 0,
          shareCount: 0,
          webpage_url: cleanUrl,
          url: cleanUrl,
          uploader: uploader || '',
          uploader_id: uploaderId || '',
          shopProduct: shopProduct
        });
      }
    }
  }

  return foundMap;
}

// Extract channel metadata
function getChannelMetadata() {
  let uploader = '';
  let avatar = '';
  let uploaderId = '';

  const titleEl = document.querySelector('[data-e2e="user-title"]') || document.querySelector('h1') || document.querySelector('h2');
  if (titleEl) uploader = titleEl.innerText.trim();

  const subEl = document.querySelector('[data-e2e="user-subtitle"]');
  if (subEl) uploaderId = subEl.innerText.replace('@', '').trim();

  if (!uploaderId) {
    const pathParts = window.location.pathname.split('/');
    for (const p of pathParts) {
      if (p.startsWith('@')) {
        uploaderId = p.replace('@', '');
        break;
      }
    }
  }

  const avatarEl = document.querySelector('[data-e2e="user-avatar"] img') || document.querySelector('img[src*="tiktokcdn"]');
  if (avatarEl) avatar = avatarEl.src;

  return { uploader: uploader || uploaderId, uploaderId, avatar };
}

// Perform smooth auto-scroll to collect ALL videos up to `targetLimit`
async function startAutoScrollScrape(targetLimit = 30) {
  createProgressOverlay();
  updateOverlay('Đang kết nối và chuẩn bị quét video...', 0, targetLimit);

  const meta = getChannelMetadata();
  const allVideos = new Map();
  let idleScrolls = 0;
  // If targetLimit >= 100, allow up to 15 idle checks so large channels don't stop prematurely
  const maxIdleScrolls = targetLimit >= 100 ? 15 : 8;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Initial wait for dynamic TikTok items to render
  await wait(1800);

  let lastReportedCount = 0;
  let prevScrollHeight = 0;

  while (allVideos.size < targetLimit && idleScrolls < maxIdleScrolls) {
    const currentBatch = extractVideoItems(meta.uploader, meta.uploaderId);
    let newItemsFound = 0;

    for (const [vid, item] of currentBatch.entries()) {
      if (!allVideos.has(vid)) {
        allVideos.set(vid, item);
        newItemsFound++;
        if (allVideos.size >= targetLimit) break;
      }
    }

    // Send progress heartbeat to background to reset timeout and update UI
    if (allVideos.size !== lastReportedCount) {
      lastReportedCount = allVideos.size;
      try {
        chrome.runtime.sendMessage({
          action: 'SCRAPE_PROGRESS',
          count: allVideos.size,
          limit: targetLimit
        });
      } catch (_) {}
    }

    updateOverlay(
      allVideos.size >= targetLimit ? 'Đã thu thập đủ số lượng video!' : 'Đang cuộn tải thêm video...',
      allVideos.size,
      targetLimit
    );

    if (allVideos.size >= targetLimit) {
      break;
    }

    const currentScrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;

    if (newItemsFound === 0 && currentScrollHeight === prevScrollHeight) {
      idleScrolls++;
      console.log(`[ZVibe Scraper] Idle attempt ${idleScrolls} / ${maxIdleScrolls}`);
    } else {
      idleScrolls = 0;
    }
    prevScrollHeight = currentScrollHeight;

    // STEP 1: Scroll to bottom of the entire page
    window.scrollTo({
      top: currentScrollHeight,
      behavior: 'instant'
    });

    // STEP 2: Scroll the very last video element into viewport to trigger TikTok IntersectionObserver
    const allCards = document.querySelectorAll('[data-e2e="user-post-item"]') || document.querySelectorAll('a[href*="/video/"]');
    if (allCards.length > 0) {
      try {
        allCards[allCards.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
      } catch (_) {}
    }

    // STEP 3: Wait for TikTok's network response
    await wait(1300 + Math.floor(Math.random() * 400));

    // STEP 4: Scroll jiggle (scroll up 350px then down 450px) to force re-evaluation of IntersectionObserver
    window.scrollBy({ top: -350, behavior: 'instant' });
    await wait(200);
    window.scrollBy({ top: 450, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    // Wait for DOM cards to be rendered
    await wait(900 + Math.floor(Math.random() * 300));
  }

  // Final check
  const videoItems = Array.from(allVideos.values());
  const videoUrls = videoItems.map(v => v.webpage_url || v.url);

  updateOverlay(
    `Hoàn tất! Đã quét được ${videoItems.length} video. Đang chuyển về Web Tool...`, 
    videoItems.length, 
    targetLimit
  );
  await wait(600);

  try {
    chrome.runtime.sendMessage({
      action: 'SCRAPE_FINISHED',
      videos: videoItems,
      videoUrls: videoUrls,
      uploader: meta.uploader,
      uploaderId: meta.uploaderId,
      avatar: meta.avatar
    }).catch(() => {});
  } catch (_) {}
}

// Listen for execution command from background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'EXECUTE_SCRAPE') {
    const limit = Number(request.limit) || 30;
    startAutoScrollScrape(limit);
    sendResponse({ received: true });
  }
});

// Inform background that the TikTok page is loaded and ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ action: 'TIKTOK_PAGE_READY' }).catch(() => {});
    } catch (_) {}
  }, 1000);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try {
        chrome.runtime.sendMessage({ action: 'TIKTOK_PAGE_READY' }).catch(() => {});
      } catch (_) {}
    }, 1000);
  });
}

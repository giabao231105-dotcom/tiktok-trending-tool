// tiktok-scraper.js - Injected into TikTok to scrape channel video links and exact TikTok Shop products
console.log('[ZVibe Extension] TikTok Scraper & Shop Extractor active in:', window.location.href);

let overlayEl = null;
let isScrapingActive = false;
const itemDetailsCache = new Map();

// Inject network interceptor to capture TikTok's /api/post/item_list and /item/detail responses
function injectNetworkInterceptor() {
  if (document.getElementById('zvibe-network-interceptor')) return;
  const script = document.createElement('script');
  script.id = 'zvibe-network-interceptor';
  script.textContent = `
    (function() {
      if (window.__zvibe_interceptor_loaded) return;
      window.__zvibe_interceptor_loaded = true;

      // Hook fetch
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await origFetch.apply(this, args);
        try {
          const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
          if (url.includes('/api/post/item_list') || url.includes('/item/detail') || url.includes('/api/item/detail')) {
            const clone = response.clone();
            clone.json().then(data => {
              window.postMessage({ type: 'ZVIBE_TIKTOK_API_DATA', data }, '*');
            }).catch(function() {});
          }
        } catch (_) {}
        return response;
      };

      // Hook XHR
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url) {
        this._zvibeUrl = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
          try {
            if (this._zvibeUrl && (this._zvibeUrl.includes('/api/post/item_list') || this._zvibeUrl.includes('/item/detail'))) {
              const data = JSON.parse(this.responseText);
              window.postMessage({ type: 'ZVIBE_TIKTOK_API_DATA', data }, '*');
            }
          } catch (_) {}
        });
        return origSend.apply(this, arguments);
      };
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
}

injectNetworkInterceptor();

// Parse TikTok Shop Anchor and extract product details
function parseAnchorShop(item) {
  if (!item) return null;
  const anchors = item.anchors || [];
  for (const anchor of anchors) {
    const isShop = anchor.component_key === 'anchor_shop' || 
                   anchor.type === 33 || 
                   (anchor.keyword && /shop|sản phẩm|mua|giỏ hàng/i.test(anchor.keyword)) ||
                   Boolean(anchor.extra);

    if (isShop && anchor.extra) {
      try {
        let extra = typeof anchor.extra === 'string' ? JSON.parse(anchor.extra) : anchor.extra;
        if (Array.isArray(extra)) {
          for (const sub of extra) {
            let inner = sub.extra || sub;
            if (typeof inner === 'string') {
              try { inner = JSON.parse(inner); } catch (_) {}
            }
            if (inner.title || sub.keyword || anchor.keyword) {
              const coverUrl = inner.cover_url || (inner.img_url && inner.img_url[0]) || (anchor.icon?.urlList && anchor.icon.urlList[0]) || null;
              const productId = inner.product_id || sub.id || anchor.id;
              const seoUrl = inner.seo_url || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}` : null);
              return {
                title: inner.title || sub.keyword || anchor.keyword || 'Sản phẩm TikTok Shop',
                coverUrl: coverUrl,
                price: inner.price || inner.format_price || null,
                productId: productId,
                seoUrl: seoUrl,
                url: seoUrl,
                isAffiliate: true,
                source: 'TikTok Shop'
              };
            }
          }
        } else if (typeof extra === 'object' && extra !== null) {
          const coverUrl = extra.cover_url || (extra.img_url && extra.img_url[0]) || (anchor.icon?.urlList && anchor.icon.urlList[0]) || null;
          const productId = extra.product_id || anchor.id;
          const seoUrl = extra.seo_url || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}` : null);
          return {
            title: extra.title || anchor.keyword || 'Sản phẩm TikTok Shop',
            coverUrl: coverUrl,
            price: extra.price || extra.format_price || null,
            productId: productId,
            seoUrl: seoUrl,
            url: seoUrl,
            isAffiliate: true,
            source: 'TikTok Shop'
          };
        }
      } catch (err) {
        console.warn('[ZVibe Scraper] Anchor parse error:', err);
      }
    }
  }

  // Fallback to title keywords if caption explicitly mentions product
  const title = item.desc || item.title || '';
  if (/giỏ hàng|tiktokshop|tiktok shop|sản phẩm|mua tại/i.test(title)) {
    const match = title.match(/(?:mua tại|giỏ hàng|sản phẩm)[:\s]+([^#\n.]+)/i);
    return {
      title: match ? match[1].trim() : 'Sản phẩm gắn trong Giỏ hàng video',
      coverUrl: item.video?.cover || item.video?.originCover || null,
      price: null,
      productId: null,
      seoUrl: null,
      url: null,
      isAffiliate: true,
      source: 'TikTok Shop'
    };
  }

  return null;
}

// Cache video details from itemStruct
function cacheItemData(item) {
  const vid = item.id;
  if (!vid) return;

  const stats = item.stats || {};
  const shopProduct = parseAnchorShop(item);

  itemDetailsCache.set(String(vid), {
    id: String(vid),
    title: item.desc || item.title || '',
    stats: {
      playCount: Number(stats.playCount) || 0,
      diggCount: Number(stats.diggCount) || 0,
      commentCount: Number(stats.commentCount) || 0,
      shareCount: Number(stats.shareCount) || 0
    },
    shopProduct: shopProduct,
    thumbnail: item.video?.cover || item.video?.originCover || item.video?.dynamicCover || '',
    duration: Number(item.video?.duration) || null,
    author: item.author?.uniqueId || item.author?.nickname || ''
  });
}

// Read initial DOM state (__UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE)
function readInitialDOMRehydration() {
  try {
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__') || document.getElementById('SIGI_STATE');
    if (el && el.textContent) {
      const data = JSON.parse(el.textContent);
      const scope = data['__DEFAULT_SCOPE__'] || data;
      const userDetail = scope['webapp.user-detail'] || scope['user-detail'];
      const itemList = userDetail?.itemList || scope.ItemModule || [];
      const items = Array.isArray(itemList) ? itemList : Object.values(itemList);
      for (const item of items) {
        if (item && item.id) {
          cacheItemData(item);
        }
      }
    }
  } catch (err) {
    console.warn('[ZVibe Scraper] Notice parsing initial rehydration state:', err);
  }
}

// Listen for intercepted network responses from TikTok
window.addEventListener('message', (e) => {
  if (e.data?.type === 'ZVIBE_TIKTOK_API_DATA' && e.data.data) {
    const data = e.data.data;
    const itemList = data.itemList || (data.itemInfo ? [data.itemInfo.itemStruct] : []);
    for (const item of itemList) {
      if (item && item.id) {
        cacheItemData(item);
      }
    }
  }
});

// Create and show high-tech on-screen progress overlay on the TikTok page
function createProgressOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'zvibe-scraper-overlay';
  overlayEl.innerHTML = `
    <div style="
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999999;
      background: rgba(18, 18, 18, 0.94);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(254, 44, 85, 0.4);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
      border-radius: 14px;
      padding: 16px 20px;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-width: 320px;
      max-width: 400px;
      pointer-events: none;
      animation: zvibeSlideUp 0.3s ease-out;
    ">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
        <div style="
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FE2C55, #25F4EE);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          animation: zvibeSpin 2s linear infinite;
        ">⚡</div>
        <div>
          <div style="font-weight: 700; font-size: 14px; color: #fff;">ZVibe TikTok Helper</div>
          <div style="font-size: 11px; color: #a1a1aa;">Đang tự động quét & bóc tách video...</div>
        </div>
      </div>
      <div id="zvibe-scrape-status" style="font-size: 12px; margin-bottom: 6px; color: #e4e4e7;">
        Đang chuẩn bị...
      </div>
      <div style="
        background: rgba(255, 255, 255, 0.1);
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 8px;
      ">
        <div id="zvibe-scrape-bar" style="
          width: 0%;
          height: 100%;
          background: linear-gradient(90deg, #FE2C55, #25F4EE);
          transition: width 0.3s ease;
        "></div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #71717a;">
        <span id="zvibe-scrape-counter">Đã quét: 0 video</span>
        <span style="color: #25F4EE;">24/7 Auto-scroll</span>
      </div>
    </div>
    <style>
      @keyframes zvibeSlideUp {
        from { transform: translateY(30px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      @keyframes zvibeSpin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;
  document.body.appendChild(overlayEl);
}

function updateOverlay(status, count, limit) {
  if (!overlayEl) return;
  const statusEl = overlayEl.querySelector('#zvibe-scrape-status');
  const barEl = overlayEl.querySelector('#zvibe-scrape-bar');
  const counterEl = overlayEl.querySelector('#zvibe-scrape-counter');

  if (statusEl) statusEl.innerText = status;
  if (barEl) {
    const pct = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 100;
    barEl.style.width = `${pct}%`;
  }
  if (counterEl) {
    if (limit >= 9999) {
      counterEl.innerText = `Đã quét: ${count} video (Toàn bộ kênh)`;
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

// Extract unique video cards with rich metadata directly from the DOM & cache
function extractVideoItems(uploader, uploaderId) {
  // Confine search strictly to user post list grid to avoid grabbing sidebar or unrelated videos
  const gridContainer = document.querySelector('[data-e2e="user-post-item-list"]') || 
                        document.querySelector('div[class*="DivItemContainerV2"]') || 
                        document.querySelector('div[class*="UserPostItemList"]') ||
                        document.querySelector('main');
  const rootScope = gridContainer || document.body;
  const anchors = Array.from(rootScope.querySelectorAll('a[href*="/video/"]'));
  const foundMap = new Map();

  for (const a of anchors) {
    const href = a.href || '';
    const match = href.match(/\/video\/(\d+)/);
    if (match) {
      const vid = match[1];

      // Smart author & repost verification:
      const linkAuthorMatch = href.match(/tiktok\.com\/@([a-zA-Z0-9_.-]+)\/video/i);
      if (linkAuthorMatch && uploaderId) {
        const linkAuthor = linkAuthorMatch[1].toLowerCase().replace('@', '');
        const targetAuthor = uploaderId.toLowerCase().replace('@', '');
        const isNumericId = /^\d+$/.test(linkAuthor);

        // If linkAuthor is a distinct username (not numeric ID) and does NOT match targetAuthor:
        if (!isNumericId && linkAuthor !== targetAuthor) {
          // Check if card has explicit repost badge or text
          const card = a.closest('[data-e2e="user-post-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement || a;
          const isRepost = card.querySelector('[data-e2e*="repost"]') || 
                           card.querySelector('[class*="Repost"]') || 
                           /đã đăng lại|repost/i.test(card.innerText || '');
          if (isRepost || linkAuthor.length > 2) {
            // Skip videos reposted or linked from other creators
            continue;
          }
        }
      }

      if (!foundMap.has(vid)) {
        // Construct clean, normalized URL with the correct username
        const cleanUrl = uploaderId 
          ? `https://www.tiktok.com/@${uploaderId.replace(/^@+/, '')}/video/${vid}` 
          : href.split('?')[0];

        // Locate card container
        const card = a.closest('[data-e2e="user-post-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement || a;
        
        // Thumbnail
        const img = a.querySelector('img') || card.querySelector('img');
        const thumbnail = img?.src || img?.dataset?.src || '';

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
        let viewCount = parseCount(viewText);

        // Check our rich intercepted/rehydrated cache first
        const cached = itemDetailsCache.get(String(vid));
        let shopProduct = cached?.shopProduct || null;

        if (cached && cached.stats) {
          if (cached.stats.playCount) viewCount = cached.stats.playCount;
        }

        // If not in cache, fallback to DOM anchor or caption
        if (!shopProduct) {
          const anchorEl = card.querySelector('[data-e2e*="anchor"]') || 
                           card.querySelector('a[href*="/product/"]') || 
                           card.querySelector('div[class*="Anchor"]') ||
                           card.querySelector('[class*="shop"]') ||
                           card.querySelector('[class*="product"]');
          const anchorImg = anchorEl ? anchorEl.querySelector('img') : null;
          const anchorText = anchorEl ? anchorEl.innerText.trim() : null;
          const caption = (title || '').toLowerCase();
          const hasShopMention = !!anchorText || /giỏ hàng|tiktokshop|tiktok shop|sản phẩm|mua tại/i.test(caption);

          if (anchorText || hasShopMention) {
            const match = (title || '').match(/(?:mua tại|giỏ hàng|sản phẩm)[:\s]+([^#\n.]+)/i);
            shopProduct = {
              title: anchorText || (match ? match[1].trim() : 'Sản phẩm Giỏ hàng TikTok Shop'),
              coverUrl: anchorImg?.src || thumbnail || null,
              price: null,
              url: cleanUrl,
              seoUrl: cleanUrl,
              isAffiliate: true,
              source: 'TikTok Shop'
            };
          }
        }

        foundMap.set(vid, {
          id: vid,
          title: cached?.title || title || 'TikTok Video',
          description: cached?.title || title || '',
          thumbnail: cached?.thumbnail || thumbnail || '',
          viewCount: viewCount,
          likeCount: cached?.stats?.diggCount || 0,
          commentCount: cached?.stats?.commentCount || 0,
          shareCount: cached?.stats?.shareCount || 0,
          duration: cached?.duration || null,
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

  const pathParts = window.location.pathname.split('/');
  for (const p of pathParts) {
    if (p.startsWith('@')) {
      uploaderId = p.replace('@', '').trim();
      break;
    }
  }

  const subEl = document.querySelector('[data-e2e="user-subtitle"]');
  if (subEl) {
    const text = subEl.innerText.replace('@', '').trim();
    if (text) uploaderId = text;
  }

  const titleEl = document.querySelector('[data-e2e="user-title"]') || document.querySelector('h1[data-e2e="user-title"]') || document.querySelector('h1');
  if (titleEl) uploader = titleEl.innerText.trim();
  if (!uploader) uploader = uploaderId;

  const avatarEl = document.querySelector('[data-e2e="user-avatar"] img') || 
                   document.querySelector('div[data-e2e="user-avatar"] img') || 
                   document.querySelector('img[class*="ImgAvatar"]') ||
                   document.querySelector('img[src*="tiktokcdn"]');
  if (avatarEl && avatarEl.src) avatar = avatarEl.src;

  return { uploader: uploader || uploaderId, uploaderId, avatar };
}

// Perform smooth auto-scroll to collect ALL videos up to `targetLimit`
async function startAutoScrollScrape(targetLimit = 30) {
  createProgressOverlay();
  updateOverlay('Đang kết nối và chuẩn bị quét video...', 0, targetLimit);

  readInitialDOMRehydration();

  const meta = getChannelMetadata();
  const allVideos = new Map();
  let idleScrolls = 0;
  // If no new videos found for 6 consecutive scrolls, channel has ended!
  const maxIdleScrolls = 6;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Initial wait for dynamic TikTok items to render
  await wait(1800);

  while (allVideos.size < targetLimit && idleScrolls < maxIdleScrolls) {
    let newItemsFound = 0;

    // 1. Extract from DOM cards
    const currentBatch = extractVideoItems(meta.uploader, meta.uploaderId);
    for (const [vid, item] of currentBatch.entries()) {
      if (!allVideos.has(vid)) {
        allVideos.set(vid, item);
        newItemsFound++;
        if (allVideos.size >= targetLimit) break;
      }
    }

    // 2. Incorporate from intercepted network cache as well (handles virtualized DOM unmounting)
    for (const [vid, cached] of itemDetailsCache.entries()) {
      if (!allVideos.has(vid)) {
        if (cached.author && meta.uploaderId) {
          const cAuthor = cached.author.toLowerCase().replace('@', '');
          const tAuthor = meta.uploaderId.toLowerCase().replace('@', '');
          if (cAuthor !== tAuthor && !/^\d+$/.test(cAuthor)) {
            continue;
          }
        }
        const cleanUrl = meta.uploaderId 
          ? `https://www.tiktok.com/@${meta.uploaderId.replace(/^@+/, '')}/video/${vid}` 
          : `https://www.tiktok.com/video/${vid}`;

        allVideos.set(vid, {
          id: vid,
          title: cached.title || 'TikTok Video',
          description: cached.title || '',
          thumbnail: cached.thumbnail || '',
          viewCount: cached.stats.playCount || 0,
          likeCount: cached.stats.diggCount || 0,
          commentCount: cached.stats.commentCount || 0,
          shareCount: cached.stats.shareCount || 0,
          duration: cached.duration || null,
          webpage_url: cleanUrl,
          url: cleanUrl,
          uploader: meta.uploader || '',
          uploader_id: meta.uploaderId || '',
          shopProduct: cached.shopProduct || null
        });
        newItemsFound++;
        if (allVideos.size >= targetLimit) break;
      }
    }

    // Send progress heartbeat to background on EVERY cycle so background timeout never fires unexpectedly
    try {
      chrome.runtime.sendMessage({
        action: 'SCRAPE_PROGRESS',
        count: allVideos.size,
        limit: targetLimit,
        isScrolling: true,
        videos: Array.from(allVideos.values()),
        uploader: meta.uploader,
        uploaderId: meta.uploaderId,
        avatar: meta.avatar
      }).catch(() => {});
    } catch (_) {}

    updateOverlay(
      allVideos.size >= targetLimit ? 'Đã thu thập đủ số lượng video!' : `Đang cuộn cào video (Đã có ${allVideos.size} video)...`,
      allVideos.size,
      targetLimit
    );

    if (allVideos.size >= targetLimit) {
      break;
    }

    // Correct idle scroll detection: increment when NO new items were found in this pass
    if (newItemsFound === 0) {
      idleScrolls++;
      console.log(`[ZVibe Scraper] Không thấy video mới, kiểm tra lần: ${idleScrolls} / ${maxIdleScrolls}`);
    } else {
      idleScrolls = 0;
    }

    // Scroll actions to trigger TikTok's lazy loader
    const currentScrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;

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

    // Dispatch scroll & wheel events
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000 }));

    // STEP 3: Wait for TikTok's network response
    await wait(1200 + Math.floor(Math.random() * 300));

    // STEP 4: Scroll jiggle (scroll up 300px then down 400px) to re-trigger IntersectionObserver
    window.scrollBy({ top: -300, behavior: 'instant' });
    await wait(180);
    window.scrollBy({ top: 400, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

    // Wait for DOM cards to render
    await wait(800 + Math.floor(Math.random() * 200));
  }

  // Final check & report
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
    if (!isScrapingActive) {
      isScrapingActive = true;
      const limit = Number(request.limit) || 30;
      console.log('[ZVibe Scraper] Received EXECUTE_SCRAPE with limit:', limit);
      startAutoScrollScrape(limit);
    }
    sendResponse({ received: true });
  }
});

// Inform background that the TikTok page is loaded and ready (send multiple pings)
function notifyBackgroundReady() {
  if (!isScrapingActive) {
    try {
      chrome.runtime.sendMessage({ action: 'TIKTOK_PAGE_READY' }).catch(() => {});
    } catch (_) {}
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(notifyBackgroundReady, 600);
  setTimeout(notifyBackgroundReady, 1800);
  setTimeout(notifyBackgroundReady, 3500);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(notifyBackgroundReady, 600);
    setTimeout(notifyBackgroundReady, 1800);
    setTimeout(notifyBackgroundReady, 3500);
  });
}

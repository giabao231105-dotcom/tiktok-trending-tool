// tiktok-scraper.js - Injected into TikTok to scrape channel video links and exact TikTok Shop products
console.log('[ZVibe Extension] TikTok Scraper & Shop Extractor active in:', window.location.href);

let overlayEl = null;
let isScrapingActive = false;
const itemDetailsCache = new Map();

// Parse TikTok Shop Anchor and extract product details
function parseAnchorShop(item) {
  if (!item) return null;
  const anchors = item.anchors || [];
  for (const anchor of anchors) {
    // Exclude CapCut, POI, Filter/Effects
    if (anchor.component_key === 'anchor_capcut' || anchor.type === 28 || /capcut/i.test(anchor.keyword || '')) {
      continue;
    }
    if (anchor.component_key === 'anchor_poi' || anchor.type === 16) {
      continue;
    }
    if (anchor.component_key === 'anchor_effect' || anchor.type === 6) {
      continue;
    }

    let extra = null;
    if (anchor.extra) {
      try {
        extra = typeof anchor.extra === 'string' ? JSON.parse(anchor.extra) : anchor.extra;
      } catch (_) {}
    }

    // Comprehensive TikTok Shop anchor check
    const isShopKeyOrType = 
      /shop|cart|ecom|product/i.test(anchor.component_key || '') ||
      anchor.type === 33 || 
      anchor.type === 40 || 
      anchor.type === 24 || 
      anchor.type === 56 || 
      anchor.type === 4;

    const hasProductId = Boolean(
      (extra && (extra.product_id || extra.productId || extra.promotion_id || extra.pdp_url)) ||
      (Array.isArray(extra) && extra.some(sub => (sub.extra?.product_id || sub.product_id || sub.id)))
    );

    const isShop = isShopKeyOrType || hasProductId || (anchor.url && /shop\.tiktok\.com|view\/product/i.test(anchor.url)) || (anchor.schema && /product|shop/i.test(anchor.schema));

    if (isShop) {
      // 1. Try parsing from extra (detailed product)
      if (extra) {
        if (Array.isArray(extra)) {
          for (const sub of extra) {
            let inner = sub.extra || sub;
            if (typeof inner === 'string') {
              try { inner = JSON.parse(inner); } catch (_) {}
            }
            const productId = inner.product_id || sub.id || anchor.id;
            const title = inner.title || sub.keyword || anchor.keyword;
            if ((productId || title) && !/capcut/i.test(title || '')) {
              const coverUrl = inner.cover_url || (inner.img_url && inner.img_url[0]) || (anchor.icon?.urlList && anchor.icon.urlList[0]) || null;
              const seoUrl = inner.seo_url || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}` : null);
              return {
                title: title || 'Sản phẩm TikTok Shop',
                coverUrl: coverUrl,
                price: inner.price || inner.format_price || null,
                productId: productId || null,
                seoUrl: seoUrl,
                url: seoUrl,
                isAffiliate: true,
                isShop: true,
                source: 'TikTok Shop'
              };
            }
          }
        } else if (typeof extra === 'object' && extra !== null) {
          const productId = extra.product_id || anchor.id;
          const title = extra.title || anchor.keyword;
          if ((productId || title) && !/capcut/i.test(title || '')) {
            const coverUrl = extra.cover_url || (extra.img_url && extra.img_url[0]) || (anchor.icon?.urlList && anchor.icon.urlList[0]) || null;
            const seoUrl = extra.seo_url || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}` : null);
            return {
              title: title || 'Sản phẩm TikTok Shop',
              coverUrl: coverUrl,
              price: extra.price || extra.format_price || null,
              productId: productId || null,
              seoUrl: seoUrl,
              url: seoUrl,
              isAffiliate: true,
              isShop: true,
              source: 'TikTok Shop'
            };
          }
        }
      }

      // 2. Direct anchor fields if extra was not parsed
      const title = anchor.keyword || anchor.name || anchor.description || 'Sản phẩm TikTok Shop';
      if (!/capcut/i.test(title)) {
        const coverUrl = anchor.icon?.urlList?.[0] || null;
        const productId = anchor.id || null;
        const seoUrl = anchor.url || (productId ? `https://shop.tiktok.com/vn/pdp/${productId}` : null);
        return {
          title: title,
          coverUrl: coverUrl,
          price: null,
          productId: productId,
          seoUrl: seoUrl,
          url: seoUrl,
          isAffiliate: true,
          isShop: true,
          source: 'TikTok Shop'
        };
      }
    }
  }

  // Check item.has_shopping_cart or item.commerceInfo
  if (item.has_shopping_cart || item.hasShoppingCart || item.commerce_info?.has_commerce || item.commerce_info?.hasCommerce) {
    return {
      title: item.commerce_info?.adv_promoter || 'Sản phẩm TikTok Shop (Gắn trong video)',
      coverUrl: item.video?.cover || item.video?.originCover || null,
      price: null,
      productId: item.commerce_info?.product_id || null,
      url: null,
      isAffiliate: true,
      isShop: true,
      source: 'TikTok Shop'
    };
  }

  // Only check item.commerceInfo if it has an actual product_id or product_name
  if (item.commerceInfo || item.shopping_info) {
    const c = item.commerceInfo || item.shopping_info;
    const prodName = c.product_name || c.title;
    const prodId = c.product_id || c.productId;
    if (prodName || prodId) {
      return {
        title: prodName || 'Sản phẩm TikTok Shop',
        coverUrl: c.cover || c.image || item.video?.cover || null,
        price: c.price || c.format_price || null,
        productId: prodId || null,
        seoUrl: c.url || (prodId ? `https://shop.tiktok.com/vn/pdp/${prodId}` : null),
        url: c.url || (prodId ? `https://shop.tiktok.com/vn/pdp/${prodId}` : null),
        isAffiliate: true,
        isShop: true,
        source: 'TikTok Shop'
      };
    }
  }

  // Fallback to title keywords ONLY if caption explicitly mentions shopping cart CTA
  const title = item.desc || item.title || '';
  if (/(?:mua tại giỏ hàng|link (?:ở|tại|trong) giỏ hàng|bấm vào giỏ hàng|gắn ở góc trái|mua tại tiktok\s*shop|giỏ hàng bên dưới|link mua bên dưới)/i.test(title)) {
    const match = title.match(/(?:mua tại|giỏ hàng|sản phẩm)[:\s]+([^#\n.]+)/i);
    return {
      title: match ? match[1].trim() : 'Sản phẩm gắn trong Giỏ hàng video',
      coverUrl: item.video?.cover || item.video?.originCover || null,
      price: null,
      productId: null,
      seoUrl: null,
      url: null,
      isAffiliate: true,
      isShop: true,
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
  const playUrl = item.video?.playAddr || item.video?.downloadAddr || null;
  const images = (item.imagePost?.images || []).map(img => img.display_image?.url_list?.[0] || img.imageURL?.urlList?.[0] || '').filter(Boolean);

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
    thumbnail: item.video?.cover || item.video?.originCover || item.video?.dynamicCover || (images[0] || ''),
    duration: Number(item.video?.duration) || null,
    author: item.author?.uniqueId || item.author?.nickname || '',
    playUrl: playUrl,
    images: images
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

// Listen for intercepted network responses from TikTok (from tiktok-interceptor.js in MAIN world)
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

// Direct detection of shopping bag badge from video card DOM & caption
function detectShopOnCard(card, title, cleanUrl, thumbnail) {
  if (!card) return null;

  const cardRect = card.getBoundingClientRect();
  const cardWidth = cardRect.width || card.offsetWidth || 200;
  const cardHeight = cardRect.height || card.offsetHeight || 300;

  // 1. Look for genuine TikTok Shop badges by explicit attributes / links
  const shopExplicitEl = card.querySelector(
    '[data-e2e*="shop" i], [data-e2e*="cart" i], [data-e2e*="commerce" i], ' +
    '[class*="Shop" i], [class*="Cart" i], [class*="Shopping" i], [class*="Commerce" i], ' +
    'a[href*="shop.tiktok.com"], a[href*="/view/product"]'
  );
  if (shopExplicitEl) {
    const shopText = shopExplicitEl.innerText?.trim();
    return {
      title: shopText || 'Sản phẩm TikTok Shop (Gắn trong video)',
      coverUrl: thumbnail || null,
      price: null,
      url: cleanUrl,
      seoUrl: cleanUrl,
      isAffiliate: true,
      isShop: true,
      source: 'TikTok Shop'
    };
  }

  // 2. Direct geometric detection of Top-Left Shopping Bag Badge
  // On TikTok video cards:
  // - Top-Right (relLeft > 60% width) = Photo Album carousel icon on photo posts (/photo/)
  // - Bottom-Left (relTop > 65% height) = Play triangle icon & views count
  // - Top-Left (relTop < 38% height, relLeft < 42% width) = Either "Pinned" pill OR TikTok Shop Shopping Bag (circle/square icon with SVG)
  const candidateBadges = Array.from(card.querySelectorAll('div, span, button, a, svg'));
  for (const el of candidateBadges) {
    const eRect = el.getBoundingClientRect();
    const relTop = (cardRect.height > 0 && eRect.height > 0) ? (eRect.top - cardRect.top) : (el.offsetTop || 0);
    const relLeft = (cardRect.width > 0 && eRect.width > 0) ? (eRect.left - cardRect.left) : (el.offsetLeft || 0);
    const w = eRect.width || el.offsetWidth || 0;
    const h = eRect.height || el.offsetHeight || 0;

    // Must be located in the Top-Left quadrant of the card
    if (relTop >= -6 && relTop < (cardHeight * 0.38) && relLeft >= -6 && relLeft < (cardWidth * 0.42)) {
      // Ignore elements larger than half the card (e.g. wrapper overlays)
      if (w > (cardWidth * 0.5) || h > (cardHeight * 0.5)) continue;

      const text = (el.innerText || '').trim();
      // Skip if this is the "Pinned" / "Ghim" pill
      if (/pin|ghim/i.test(text) || /pin|ghim/i.test(el.className || '') || w > 48) {
        continue;
      }

      // Check if this element contains an SVG or is an SVG itself
      const svg = el.tagName?.toLowerCase() === 'svg' ? el : el.querySelector('svg');
      if (svg) {
        const svgHtml = svg.outerHTML || '';
        // Skip play button triangle
        if (svgHtml.includes('polygon')) continue;

        // Check size: badge is between 12px and 44px
        if ((w >= 12 && w <= 44) || (h >= 12 && h <= 44) || el.tagName?.toLowerCase() === 'svg') {
          return {
            title: 'Sản phẩm TikTok Shop (Gắn trong video)',
            coverUrl: thumbnail || null,
            price: null,
            url: cleanUrl,
            seoUrl: cleanUrl,
            isAffiliate: true,
            isShop: true,
            source: 'TikTok Shop'
          };
        }
      }
    }
  }

  // 3. Caption keywords - ONLY explicit shopping cart calls to action
  const lower = (title || '').toLowerCase();
  if (/(?:mua tại giỏ hàng|link (?:ở|tại|trong) giỏ hàng|bấm vào giỏ hàng|gắn ở góc trái|mua tại tiktok\s*shop|giỏ hàng bên dưới|link mua bên dưới)/i.test(lower)) {
    const match = lower.match(/(?:mua tại|giỏ hàng|sản phẩm)[:\s]+([^#\n.]+)/i);
    return {
      title: match ? match[1].trim() : 'Sản phẩm gắn Giỏ hàng TikTok Shop',
      coverUrl: thumbnail || null,
      price: null,
      url: cleanUrl,
      seoUrl: cleanUrl,
      isAffiliate: true,
      isShop: true,
      source: 'TikTok Shop'
    };
  }

  return null;
}

// Extract unique video cards with rich metadata directly from the DOM & cache
function extractVideoItems(uploader, uploaderId) {
  // Confine search to user post list grid or main container
  const gridContainer = document.querySelector('[data-e2e="user-post-item-list"]') || 
                        document.querySelector('div[class*="DivItemContainerV2"]') || 
                        document.querySelector('div[class*="UserPostItemList"]') ||
                        document.querySelector('main');
  const rootScope = gridContainer || document.body;
  // Capture BOTH video AND photo carousel posts (e.g. /video/123 or /photo/123)
  const anchors = Array.from(rootScope.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'));
  const foundMap = new Map();

  for (const a of anchors) {
    const href = a.href || '';
    const match = href.match(/\/(video|photo)\/(\d+)/);
    if (match) {
      const postType = match[1]; // 'video' or 'photo'
      const vid = match[2];

      if (!foundMap.has(vid)) {
        // Construct clean, normalized URL with the correct username
        const cleanAuthor = (uploaderId || '').replace(/^@+/, '');
        const cleanUrl = cleanAuthor 
          ? `https://www.tiktok.com/@${cleanAuthor}/${postType}/${vid}` 
          : href.split('?')[0];

        // Locate card container (check up to 3 levels to ensure we capture the top-left badge)
        const card = a.closest('[data-e2e="user-post-item"]') || a.closest('div[class*="DivItemContainer"]') || a.parentElement?.parentElement || a.parentElement || a;
        
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
        if (viewEl) viewText = viewEl.innerText || viewEl.textContent || '';
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

        // If not in cache, detect directly from the card DOM & caption
        if (!shopProduct) {
          shopProduct = detectShopOnCard(card, title, cleanUrl, thumbnail);
        }

        foundMap.set(vid, {
          id: vid,
          title: cached?.title || title || 'TikTok Video',
          description: cached?.title || title || '',
          thumbnail: cached?.thumbnail || thumbnail || (cached?.images?.[0] || ''),
          viewCount: viewCount,
          likeCount: cached?.stats?.diggCount || 0,
          commentCount: cached?.stats?.commentCount || 0,
          shareCount: cached?.stats?.shareCount || 0,
          duration: cached?.duration || null,
          webpage_url: cleanUrl,
          url: cleanUrl,
          playUrl: cached?.playUrl || null,
          images: cached?.images || [],
          uploader: uploader || cleanAuthor || '',
          uploader_id: cleanAuthor || '',
          shopProduct: shopProduct ? {
            ...shopProduct,
            isShop: true,
            isAffiliate: true
          } : null
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
  // Generous idle scroll allowance to ensure final batch is never missed
  const maxIdleScrolls = 8;

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
          uploader: meta.uploader || meta.uploaderId || '',
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

    // STEP 2: Scroll the very last card element into viewport to trigger IntersectionObserver
    const allCards = document.querySelectorAll('[data-e2e="user-post-item"]') || 
                     document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]');
    if (allCards.length > 0) {
      try {
        allCards[allCards.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
      } catch (_) {}
    }

    // Dispatch scroll & wheel events
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1200 }));

    // Wait for network response (1500ms)
    await wait(1400 + Math.floor(Math.random() * 300));

    // Jiggle to force IntersectionObserver
    window.scrollBy({ top: -350, behavior: 'instant' });
    await wait(200);
    window.scrollBy({ top: 450, behavior: 'instant' });
    window.dispatchEvent(new Event('scroll'));

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

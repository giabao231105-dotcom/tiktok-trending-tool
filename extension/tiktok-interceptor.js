// tiktok-interceptor.js - Runs in MAIN world to intercept TikTok API requests
(function() {
  if (window.__zvibe_interceptor_installed) return;
  window.__zvibe_interceptor_installed = true;
  console.log('[ZVibe Extension] TikTok Network Interceptor activated in MAIN context.');

  // Hook Fetch API
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (
        url.includes('/api/post/item_list') || 
        url.includes('/item/detail') || 
        url.includes('/api/item/detail') ||
        url.includes('/api/recommend/item_list')
      ) {
        const clone = response.clone();
        clone.json().then(data => {
          window.postMessage({ type: 'ZVIBE_TIKTOK_API_DATA', data }, '*');
        }).catch(function() {});
      }
    } catch (_) {}
    return response;
  };

  // Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._zvibeUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        if (
          this._zvibeUrl && 
          (this._zvibeUrl.includes('/api/post/item_list') || 
           this._zvibeUrl.includes('/item/detail') ||
           this._zvibeUrl.includes('/api/item/detail'))
        ) {
          const data = JSON.parse(this.responseText);
          window.postMessage({ type: 'ZVIBE_TIKTOK_API_DATA', data }, '*');
        }
      } catch (_) {}
    });
    return origSend.apply(this, arguments);
  };
})();

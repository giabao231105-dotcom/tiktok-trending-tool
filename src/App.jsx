import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';

// Custom lightweight Markdown parser for premium reports
const parseMarkdown = (text) => {
  if (!text) return '';
  
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Blockquotes
  html = html.replace(/^>\s+(.*?)$/gm, '<blockquote>$1</blockquote>');
  
  // Headers
  html = html.replace(/^###\s+(.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*?)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*?)$/gm, '<h1>$1</h1>');
  
  // Bullet lists
  html = html.replace(/^\s*[-*]\s+(.*?)$/gm, '<li>$1</li>');
  
  // Wrap adjacent <li> elements in a <ul>
  html = html.replace(/(?:<li>.*?<\/li>\s*)+/gs, (match) => {
    return `<ul>${match}</ul>`;
  });
  
  // Split by newlines and wrap ordinary lines in paragraphs
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('<h') || 
      trimmed.startsWith('<ul') || 
      trimmed.startsWith('<li') || 
      trimmed.startsWith('<block') || 
      trimmed === ''
    ) {
      return line;
    }
    return `<p>${line}</p>`;
  }).join('\n');
  
  return html;
};

function App() {
  // Navigation & Settings State
  const [activeTab, setActiveTab] = useState('channel');
  const [geminiKey, setGeminiKey] = useState('');
  const [speechKey, setSpeechKey] = useState('');
  const [proxy, setProxy] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');

  // Inputs
  const [channelInput, setChannelInput] = useState('');
  const [videoInputs, setVideoInputs] = useState(['', '', '']);
  const [limit, setLimit] = useState(12);

  // Data State
  const [videos, setVideos] = useState([]);
  const [singleVideos, setSingleVideos] = useState([]);
  const [channelInfo, setChannelInfo] = useState(null);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [toast, setToast] = useState(null);
  
  // Modal State
  const [activeModal, setActiveModal] = useState(null); // 'script' | 'analysis' | 'settings' | null
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [modalContent, setModalContent] = useState('');
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState(null);

  // History & Script optimization state
  const [history, setHistory] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // Batch selection & ZIP download state
  const [selectedChannelVideoIds, setSelectedChannelVideoIds] = useState(new Set());
  const [selectedSingleVideoIds, setSelectedSingleVideoIds] = useState(new Set());
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');

  // Chrome Extension Integration State
  const [isExtensionActive, setIsExtensionActive] = useState(false);

  // TikTok Desktop Video Player Theater State
  const [playerTab, setPlayerTab] = useState('info'); // 'info' | 'script' | 'analysis'
  const [playerIsPlaying, setPlayerIsPlaying] = useState(true);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerIsMuted, setPlayerIsMuted] = useState(false);
  const videoRef = useRef(null);

  // Listen for ZVibe Chrome Extension heartbeat/handshake
  useEffect(() => {
    const handleExtensionMsg = (e) => {
      if (e.data?.type === 'ZVIBE_EXTENSION_READY' || e.data?.type === 'ZVIBE_PONG_EXTENSION') {
        setIsExtensionActive(true);
      }
    };
    window.addEventListener('message', handleExtensionMsg);
    window.postMessage({ type: 'ZVIBE_PING_EXTENSION' }, '*');
    return () => window.removeEventListener('message', handleExtensionMsg);
  }, []);

  // Helper to trigger channel scan via Chrome Extension
  const scanChannelViaExtension = (targetChannel, targetLimit) => {
    return new Promise((resolve, reject) => {
      const isScanAll = targetLimit === 'all' || Number(targetLimit) >= 200;
      let timeoutDuration = isScanAll ? 900000 : 120000; // 15 mins for all/large, 2 mins otherwise
      let timeout = setTimeout(() => {
        window.removeEventListener('message', onResult);
        reject(new Error('Quá thời gian quét kênh từ Extension. Vui lòng thử lại.'));
      }, timeoutDuration);

      const onResult = (e) => {
        if (!e.data) return;
        if (e.data.type === 'ZVIBE_CHANNEL_SCAN_PROGRESS') {
          // Reset timeout upon progress
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            window.removeEventListener('message', onResult);
            reject(new Error('Quá thời gian quét do kênh không tải thêm video mới.'));
          }, timeoutDuration);

          setLoadingMsg(`⚡ Extension đang cuộn cào video: Đã thu thập được ${e.data.count} video...`);
        } else if (e.data.type === 'ZVIBE_CHANNEL_SCAN_DONE') {
          clearTimeout(timeout);
          window.removeEventListener('message', onResult);
          resolve(e.data);
        } else if (e.data.type === 'ZVIBE_CHANNEL_SCAN_ERROR') {
          clearTimeout(timeout);
          window.removeEventListener('message', onResult);
          reject(new Error(e.data.error || 'Extension báo lỗi khi quét kênh.'));
        }
      };

      window.addEventListener('message', onResult);
      window.postMessage({
        type: 'ZVIBE_START_CHANNEL_SCAN',
        channelUrl: targetChannel,
        limit: targetLimit === 'all' ? 999999 : Number(targetLimit) || 30
      }, '*');
    });
  };

  // Load settings & history from LocalStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedSpeechKey = localStorage.getItem('speech_api_key');
    const savedProxy = localStorage.getItem('tiktok_proxy');
    const savedBaseUrl = localStorage.getItem('api_base_url');
    const savedModel = localStorage.getItem('custom_model');
    if (savedKey) setGeminiKey(savedKey);
    if (savedSpeechKey) setSpeechKey(savedSpeechKey);
    if (savedProxy) setProxy(savedProxy);
    if (savedBaseUrl) setApiBaseUrl(savedBaseUrl);
    if (savedModel) setCustomModel(savedModel);

    const savedHistory = localStorage.getItem('tiktok_analysis_history');
    if (savedHistory) {
      try {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
        if (parsed.length > 0) {
          setSelectedHistoryId(parsed[0].id);
        }
      } catch (err) {
        console.error('Failed to parse history:', err);
      }
    }
  }, []);

  // Save/Update item in history list
  const saveToHistory = (video, fields) => {
    let finalHistory;
    setHistory(prev => {
      const index = prev.findIndex(item => item.video.id === video.id);
      if (index > -1) {
        finalHistory = prev.map((item, i) => i === index ? { ...item, ...fields, timestamp: Date.now() } : item);
      } else {
        finalHistory = [{ video, ...fields, id: video.id, timestamp: Date.now() }, ...prev];
      }
      localStorage.setItem('tiktok_analysis_history', JSON.stringify(finalHistory));
      return finalHistory;
    });
    setSelectedHistoryId(video.id);
  };

  // Set up global event listener for dangerouslySetInnerHTML actions in history panels
  useEffect(() => {
    window.dispatchAnalyzeEvent = (id) => {
      const item = history.find(h => h.id === id);
      if (item) {
        handleAnalyzeFromHistory(item);
      }
    };
    return () => {
      delete window.dispatchAnalyzeEvent;
    };
  }, [history, geminiKey, proxy]);

  // Show auto-dismiss toast
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const handleDiagnoseGemini = async () => {
    if (!geminiKey) return showToast('Vui lòng nhập API Key trước khi kiểm tra!', 'error');
    
    setDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const response = await fetch('/api/diagnose-gemini', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        }
      });
      const data = await response.json();
      if (!response.ok) {
        setDiagnoseResult({
          success: false,
          error: data.error || 'Lỗi không xác định khi kết nối với API.'
        });
      } else {
        setDiagnoseResult({
          success: true,
          models: data.models,
          quotaStatus: data.quotaStatus,
          quotaError: data.quotaError
        });
      }
    } catch (err) {
      setDiagnoseResult({
        success: false,
        error: err.message
      });
    } finally {
      setDiagnosing(false);
    }
  };

  // Save Settings
  const handleSaveSettings = (e) => {
    e.preventDefault();
    localStorage.setItem('gemini_api_key', geminiKey.trim());
    localStorage.setItem('speech_api_key', speechKey.trim());
    localStorage.setItem('tiktok_proxy', proxy.trim());
    localStorage.setItem('api_base_url', apiBaseUrl.trim());
    localStorage.setItem('custom_model', customModel.trim());
    showToast('Đã lưu cấu hình cài đặt!');
    setActiveModal(null);
  };

  // Fetch Channel Videos
  const handleFetchChannel = async (e) => {
    e.preventDefault();
    if (!channelInput) return showToast('Vui lòng nhập link kênh hoặc username!', 'error');

    setIsLoading(true);
    setVideos([]);
    setChannelInfo(null);

    // PRIORITY 1: Scan directly via ZVibe Chrome Extension (Immune to TikTok datacenter IP blocks)
    if (isExtensionActive) {
      setLoadingMsg('⚡ Chrome Extension đang tự động mở kênh TikTok và quét video...');
      try {
        const result = await scanChannelViaExtension(channelInput, limit);
        if (!result.videos || result.videos.length === 0) {
          throw new Error('Extension không tìm thấy video nào trên kênh này.');
        }

        // Normalize scraped videos from Extension (support both rich objects and URL strings)
        const rawItems = result.videos;
        const normalizedVideos = rawItems.map((item, idx) => {
          if (typeof item === 'object' && item !== null) {
            return {
              id: item.id || `vid_${idx}_${Date.now()}`,
              title: item.title || 'TikTok Video',
              description: item.description || item.title || '',
              thumbnail: item.thumbnail || result.avatar || 'https://www.w3schools.com/howto/img_avatar.png',
              duration: item.duration || null,
              viewCount: Number(item.viewCount) || 0,
              likeCount: Number(item.likeCount) || 0,
              commentCount: Number(item.commentCount) || 0,
              shareCount: Number(item.shareCount) || 0,
              webpage_url: item.webpage_url || item.url || '',
              url: item.webpage_url || item.url || '',
              uploader: item.uploader || result.uploader || channelInput,
              uploader_id: item.uploader_id || result.uploaderId || channelInput,
              shopProduct: item.shopProduct || null
            };
          } else {
            const urlStr = String(item);
            const vMatch = urlStr.match(/\/video\/(\d+)/);
            const vId = vMatch ? vMatch[1] : `vid_${idx}_${Date.now()}`;
            return {
              id: vId,
              title: 'TikTok Video',
              description: '',
              thumbnail: result.avatar || 'https://www.w3schools.com/howto/img_avatar.png',
              duration: null,
              viewCount: 0,
              likeCount: 0,
              commentCount: 0,
              shareCount: 0,
              webpage_url: urlStr,
              url: urlStr,
              uploader: result.uploader || channelInput,
              uploader_id: result.uploaderId || channelInput,
              shopProduct: null
            };
          }
        });

        // Set channel profile
        setChannelInfo({
          name: result.uploader || normalizedVideos[0]?.uploader || channelInput,
          username: result.uploaderId || normalizedVideos[0]?.uploader_id || channelInput,
          avatar: result.avatar || normalizedVideos[0]?.thumbnail || 'https://www.w3schools.com/howto/img_avatar.png'
        });

        // Render videos immediately!
        setVideos(normalizedVideos);
        showToast(`⚡ Quét thành công ${normalizedVideos.length} video bằng Chrome Extension!`);

        // Optional non-blocking background enrichment for detailed like/comment counts
        const urlsToEnrich = normalizedVideos.map(v => v.webpage_url).filter(Boolean);
        if (urlsToEnrich.length > 0) {
          fetch('/api/batch-video-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urlsToEnrich, proxy })
          })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data && data.videos && data.videos.length > 0) {
                const map = new Map(data.videos.map(v => [v.id, v]));
                setVideos(prev => prev.map(v => {
                  const enriched = map.get(v.id);
                  return enriched ? { ...v, ...enriched } : v;
                }));
              }
            })
            .catch(() => {
              // Ignore background enrichment error, videos are already visible
            });
        }
      } catch (err) {
        console.error('Extension scan error:', err);
        showToast(err.message, 'error');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // PRIORITY 2: Fallback to standard server-side yt-dlp scraping
    setLoadingMsg('Đang tải danh sách video từ kênh TikTok...');
    try {
      const response = await fetch('/api/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: channelInput, limit, proxy })
      });

      const data = await response.json();
      if (!response.ok) {
        // If TikTok blocks server IP, suggest installing Chrome Extension
        setActiveModal('extension');
        throw new Error(data.details || data.error || 'Failed to fetch channel');
      }

      if (data.videos && data.videos.length > 0) {
        setVideos(data.videos);
        
        // Populate channel info from first video metadata
        const first = data.videos[0];
        setChannelInfo({
          name: first.uploader || channelInput,
          username: first.uploader_id || channelInput,
          avatar: first.thumbnail || 'https://www.w3schools.com/howto/img_avatar.png'
        });
        showToast(`Đã tìm thấy ${data.videos.length} video trong kênh!`);
      } else {
        setActiveModal('extension');
        showToast('Không tìm thấy video nào. Vui lòng cài Chrome Extension để quét không bị chặn!', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Multiple Video Links Input Handlers
  const handleAddLinkInput = () => {
    setVideoInputs(prev => [...prev, '']);
  };

  const handleRemoveLinkInput = (index) => {
    if (videoInputs.length <= 1) return;
    setVideoInputs(prev => prev.filter((_, i) => i !== index));
  };

  const handleLinkInputChange = (index, value) => {
    const next = [...videoInputs];
    next[index] = value;
    setVideoInputs(next);
  };

  // Fetch Multiple Video Details
  const handleFetchSingleVideos = async (e) => {
    e.preventDefault();
    const validUrls = videoInputs.map(u => u.trim()).filter(Boolean);
    if (validUrls.length === 0) return showToast('Vui lòng nhập ít nhất 1 link video TikTok!', 'error');

    setIsLoading(true);
    setLoadingMsg(`Đang quét thông tin chi tiết cho ${validUrls.length} video...`);
    setSingleVideos([]);

    try {
      const results = await Promise.all(
        validUrls.map(async (url) => {
          try {
            const response = await fetch('/api/video-info', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, proxy })
            });
            const data = await response.json();
            if (response.ok && data.video) return data.video;
          } catch (err) {
            console.error('Failed to fetch video:', url, err);
          }
          return null;
        })
      );

      const fetched = results.filter(Boolean);
      if (fetched.length > 0) {
        setSingleVideos(fetched);
        showToast(`Đã tìm thấy ${fetched.length} video!`);
      } else {
        showToast('Không thể lấy thông tin video nào. Vui lòng kiểm tra lại link.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper to sanitize filenames
  const sanitizeFilename = (name) => {
    return (name || 'video')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);
  };

  // Toggle single video selection
  const handleToggleSelect = (videoId, tab = 'channel') => {
    if (tab === 'channel') {
      setSelectedChannelVideoIds(prev => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
    } else {
      setSelectedSingleVideoIds(prev => {
        const next = new Set(prev);
        if (next.has(videoId)) next.delete(videoId);
        else next.add(videoId);
        return next;
      });
    }
  };

  // Toggle select all
  const handleSelectAll = (tab = 'channel') => {
    if (tab === 'channel') {
      if (selectedChannelVideoIds.size === videos.length) {
        setSelectedChannelVideoIds(new Set());
      } else {
        setSelectedChannelVideoIds(new Set(videos.map(v => v.id)));
      }
    } else {
      if (selectedSingleVideoIds.size === singleVideos.length) {
        setSelectedSingleVideoIds(new Set());
      } else {
        setSelectedSingleVideoIds(new Set(singleVideos.map(v => v.id || v.webpage_url)));
      }
    }
  };

  // Batch download selected videos packaged as a ZIP file
  const handleDownloadBatchZip = async (tab = 'channel') => {
    const targetList = tab === 'channel' ? videos : singleVideos;
    const selectedIds = tab === 'channel' ? selectedChannelVideoIds : selectedSingleVideoIds;
    const selectedVideos = targetList.filter(v => selectedIds.has(v.id || v.webpage_url));

    if (selectedVideos.length === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 video để tải về!', 'error');
      return;
    }

    setIsZipping(true);
    setZipProgress(`Đang chuẩn bị tải ${selectedVideos.length} video...`);
    showToast(`Bắt đầu đóng gói ${selectedVideos.length} video vào file ZIP...`);

    try {
      const zip = new JSZip();
      let successCount = 0;

      for (let i = 0; i < selectedVideos.length; i++) {
        const v = selectedVideos[i];
        const videoUrl = v.url || v.webpage_url;
        setZipProgress(`Đang tải video ${i + 1}/${selectedVideos.length}: ${v.title ? v.title.slice(0, 30) + '...' : ''}`);

        try {
          const downloadApiUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&proxy=${encodeURIComponent(proxy || '')}`;
          const res = await fetch(downloadApiUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const cleanTitle = sanitizeFilename(v.title);
          const filename = `${String(i + 1).padStart(2, '0')}_${cleanTitle}_${v.id || Date.now()}.mp4`;
          zip.file(filename, blob);
          successCount++;
        } catch (itemErr) {
          console.warn(`Failed to download video ${videoUrl} for zip:`, itemErr.message);
        }
      }

      if (successCount === 0) {
        throw new Error('Không thể tải được video nào để nén.');
      }

      setZipProgress('Đang nén toàn bộ video thành file ZIP...');
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgress(`Đang nén file ZIP: ${Math.round(metadata.percent)}%`);
      });

      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(zipBlob);
      const zipFileName = tab === 'channel' 
        ? `TikTok_${channelInput ? channelInput.replace('@', '') : 'channel'}_${successCount}_videos.zip`
        : `TikTok_batch_${successCount}_videos.zip`;
      downloadLink.download = zipFileName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(downloadLink.href);

      showToast(`Đã tải thành công ${successCount} video trong file ZIP!`);
    } catch (err) {
      console.error('Error generating zip:', err);
      showToast(`Lỗi khi tạo file ZIP: ${err.message}`, 'error');
    } finally {
      setIsZipping(false);
      setZipProgress('');
    }
  };

  // Trigger video download without logo
  const handleDownload = (videoUrl) => {
    const downloadUrl = `/api/download?url=${encodeURIComponent(videoUrl)}&proxy=${encodeURIComponent(proxy || '')}`;
    showToast('Bắt đầu tải video không logo...');
    window.open(downloadUrl, '_blank');
  };

  // Extract transcript (Speech-to-Text)
  const handleGetScript = async (video) => {
    if (!geminiKey) {
      showToast('Vui lòng cấu hình Gemini API Key trước!', 'error');
      setActiveModal('settings');
      return;
    }

    setIsLoading(true);
    setLoadingMsg('Đang tải âm thanh & chuyển giọng nói thành văn bản (Có thể mất 1-2 phút)...');

    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-speech-key': speechKey || geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({ url: video.url || video.webpage_url, proxy })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || 'Failed to transcribe');

      saveToHistory(video, { transcript: data.transcript });
      setActiveTab('history');
      showToast('Trích xuất kịch bản thành công!');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Run AI Video Analysis
  const handleAnalyze = async (video) => {
    if (!geminiKey) {
      showToast('Vui lòng cấu hình Gemini API Key trước!', 'error');
      setActiveModal('settings');
      return;
    }

    setIsLoading(true);
    setLoadingMsg('Đang trích xuất lời thoại trước khi phân tích...');
    let transcriptText = '';

    try {
      const transResponse = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-speech-key': speechKey || geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({ url: video.url || video.webpage_url, proxy })
      });

      const transData = await transResponse.json();
      if (!transResponse.ok) throw new Error(transData.details || transData.error || 'Failed to get transcript');
      transcriptText = transData.transcript;

      setLoadingMsg('Đang phân tích kịch bản & nội dung video bằng Gemini AI...');
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({
          url: video.url || video.webpage_url,
          transcript: transcriptText,
          title: video.title,
          description: video.description || ''
        })
      });

      const analyzeData = await analyzeResponse.json();
      if (!analyzeResponse.ok) throw new Error(analyzeData.details || analyzeData.error || 'Failed to analyze');

      saveToHistory(video, { transcript: transcriptText, analysis: analyzeData.analysis });
      setActiveTab('history');
      showToast('Phân tích AI hoàn thành!');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Extract transcript for video already in history list
  const handleGetScriptFromHistory = async (historyItem) => {
    if (!geminiKey) {
      showToast('Vui lòng cấu hình Gemini API Key trước!', 'error');
      setActiveModal('settings');
      return;
    }

    setIsLoading(true);
    setLoadingMsg('Đang tải âm thanh & chuyển giọng nói thành văn bản...');

    try {
      const response = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-speech-key': speechKey || geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({ url: historyItem.video?.url || historyItem.video?.webpage_url, proxy })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || 'Failed to transcribe');

      saveToHistory(historyItem.video, { ...historyItem, transcript: data.transcript });
      showToast('Trích xuất kịch bản thành công!');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Run AI analysis for video already in history list
  const handleAnalyzeFromHistory = async (historyItem) => {
    if (!geminiKey) {
      showToast('Vui lòng cấu hình Gemini API Key trước!', 'error');
      setActiveModal('settings');
      return;
    }

    setIsLoading(true);
    let transcriptText = historyItem.transcript;

    try {
      if (!transcriptText) {
        setLoadingMsg('Đang trích xuất lời thoại trước khi phân tích...');
        const transResponse = await fetch('/api/transcript', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-gemini-key': geminiKey,
            'x-api-base-url': apiBaseUrl,
            'x-custom-model': customModel
          },
          body: JSON.stringify({ url: historyItem.video?.url || historyItem.video?.webpage_url, proxy })
        });

        const transData = await transResponse.json();
        if (!transResponse.ok) throw new Error(transData.details || transData.error || 'Failed to get transcript');
        transcriptText = transData.transcript;
      }

      setLoadingMsg('Đang phân tích kịch bản & nội dung video bằng Gemini AI...');
      const analyzeResponse = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({
          url: historyItem.video?.url || historyItem.video?.webpage_url,
          transcript: transcriptText,
          title: historyItem.video?.title || '',
          description: historyItem.video?.description || ''
        })
      });

      const analyzeData = await analyzeResponse.json();
      if (!analyzeResponse.ok) throw new Error(analyzeData.details || analyzeData.error || 'Failed to analyze');

      saveToHistory(historyItem.video, { ...historyItem, transcript: transcriptText, analysis: analyzeData.analysis });
      showToast('Phân tích AI hoàn thành!');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Rewrite / Optimize script based on original transcription and analysis
  const handleCreateOptimizedScript = async (historyItem) => {
    if (!geminiKey) {
      showToast('Vui lòng cấu hình Gemini API Key trước!', 'error');
      setActiveModal('settings');
      return;
    }

    setIsOptimizing(true);
    showToast('Bắt đầu tối ưu hóa kịch bản...');

    try {
      const response = await fetch('/api/optimize-script', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-api-base-url': apiBaseUrl,
          'x-custom-model': customModel
        },
        body: JSON.stringify({
          script: historyItem.transcript,
          analysis: historyItem.analysis || ''
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || 'Failed to optimize script');

      saveToHistory(historyItem.video, { 
        ...historyItem,
        optimizedScript: data.optimizedScript 
      });
      showToast('Đã tạo kịch bản tối ưu mới thành công!');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setIsOptimizing(false);
    }
  };

  // Open Watch Modal and enrich in real-time with exact TikTok Shop product & stats
  const handleOpenWatchModal = (video) => {
    if (!video) return;
    setSelectedVideo(video);
    setActiveModal('watch');
    setPlayerIsPlaying(true);
    setPlayerCurrentTime(0);

    const targetUrl = video.webpage_url || video.url;
    if (targetUrl) {
      fetch('/api/video-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, proxy })
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.success && data.video) {
            setSelectedVideo(prev => ({
              ...prev,
              ...data.video,
              shopProduct: data.video.shopProduct || prev?.shopProduct
            }));
            // Update in videos / singleVideos list
            setVideos(prevList => prevList.map(v => (v.id === video.id || v.webpage_url === targetUrl) ? { ...v, ...data.video } : v));
            setSingleVideos(prevList => prevList.map(v => (v.id === video.id || v.webpage_url === targetUrl) ? { ...v, ...data.video } : v));
          }
        })
        .catch(() => {});
    }
  };

  // Helper format view counts
  const formatViews = (num) => {
    if (!num) return '0 lượt xem';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M lượt xem`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K lượt xem`;
    return `${num} lượt xem`;
  };

  // Helper format durations
  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="tt-app-wrapper">
      {/* Top TikTok Desktop Navbar */}
      <header className="tt-navbar">
        <div className="tt-logo-group" onClick={() => setActiveTab('channel')}>
          <div className="tt-logo-icon">
            <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
              <path d="M19.5 2C19.8 4.2 21.2 5.9 23.3 6.3V9.8C21.7 9.8 20.3 9.3 19.3 8.4V18.1C19.3 22.5 15.7 26 11.3 26C6.9 26 3.3 22.4 3.3 18C3.3 13.6 6.9 10 11.3 10C11.9 10 12.5 10.1 13 10.2V13.8C12.5 13.6 11.9 13.5 11.3 13.5C8.8 13.5 6.8 15.5 6.8 18C6.8 20.5 8.8 22.5 11.3 22.5C13.8 22.5 15.8 20.5 15.8 18V2H19.5Z" fill="#161823"/>
              <path d="M19.5 2C19.8 4.2 21.2 5.9 23.3 6.3V9.8C21.7 9.8 20.3 9.3 19.3 8.4V18.1C19.3 22.5 15.7 26 11.3 26C6.9 26 3.3 22.4 3.3 18C3.3 13.6 6.9 10 11.3 10C11.9 10 12.5 10.1 13 10.2V13.8C12.5 13.6 11.9 13.5 11.3 13.5C8.8 13.5 6.8 15.5 6.8 18C6.8 20.5 8.8 22.5 11.3 22.5C13.8 22.5 15.8 20.5 15.8 18V2H19.5Z" fill="#FE2C55" style={{ transform: 'translate(1.5px, 1.5px)', opacity: 0.85, mixBlendMode: 'screen' }}/>
              <path d="M19.5 2C19.8 4.2 21.2 5.9 23.3 6.3V9.8C21.7 9.8 20.3 9.3 19.3 8.4V18.1C19.3 22.5 15.7 26 11.3 26C6.9 26 3.3 22.4 3.3 18C3.3 13.6 6.9 10 11.3 10C11.9 10 12.5 10.1 13 10.2V13.8C12.5 13.6 11.9 13.5 11.3 13.5C8.8 13.5 6.8 15.5 6.8 18C6.8 20.5 8.8 22.5 11.3 22.5C13.8 22.5 15.8 20.5 15.8 18V2H19.5Z" fill="#25F4EE" style={{ transform: 'translate(-1.5px, -1.5px)', opacity: 0.85, mixBlendMode: 'screen' }}/>
            </svg>
          </div>
          <div className="tt-brand-name">
            TikTok <span style={{ fontWeight: 500, color: 'var(--text-secondary)', fontSize: '18px' }}>Studio</span>
            <span className="tt-brand-badge">TRENDS</span>
          </div>
        </div>

        {/* Center Search Pill */}
        <div className="tt-search-container">
          <form className="tt-search-pill" onSubmit={handleFetchChannel}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              className="tt-search-input" 
              placeholder="Tìm kiếm kênh (@username) hoặc dán link TikTok..."
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
            />
            <button type="submit" className="tt-search-btn" title="Quét kênh">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </form>
        </div>

        {/* Right Action Buttons */}
        <div className="tt-nav-actions">
          <button 
            className={`tt-pill-btn ${isExtensionActive ? 'extension-active' : ''}`}
            onClick={() => setActiveModal('extension')}
            title="Quản lý tiện ích Chrome Extension"
          >
            {isExtensionActive ? (
              <>
                <span className="tt-dot-pulse"></span>
                <span>Extension đã kết nối</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '14px' }}>⚡</span>
                <span>Cài Extension</span>
              </>
            )}
          </button>

          <button 
            className="tt-icon-btn" 
            onClick={() => setActiveModal('settings')} 
            title="Cài đặt hệ thống (Gemini AI Key, Proxy...)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </header>

      {/* 2-Column Desktop Body */}
      <div className="tt-app-layout">
        {/* Left Sidebar */}
        <aside className="tt-sidebar">
          <div className="tt-menu-section">
            <button 
              className={`tt-menu-item ${activeTab === 'channel' ? 'active' : ''}`}
              onClick={() => setActiveTab('channel')}
            >
              <div className="tt-menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </div>
              <span>Phân tích Kênh</span>
            </button>

            <button 
              className={`tt-menu-item ${activeTab === 'single' ? 'active' : ''}`}
              onClick={() => setActiveTab('single')}
            >
              <div className="tt-menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </div>
              <span>Gắn link riêng</span>
            </button>

            <button 
              className={`tt-menu-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              <div className="tt-menu-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <span>Lịch sử phân tích</span>
              {history.length > 0 && <span className="tt-badge-count">{history.length}</span>}
            </button>

            <div className="tt-sidebar-divider"></div>

            <button 
              className="tt-menu-item"
              onClick={() => setActiveModal('extension')}
            >
              <div className="tt-menu-icon" style={{ color: isExtensionActive ? '#15803d' : '#FE2C55' }}>
                ⚡
              </div>
              <span>Tiện ích Extension</span>
            </button>

            <button 
              className="tt-menu-item"
              onClick={() => setActiveModal('settings')}
            >
              <div className="tt-menu-icon">
                ⚙️
              </div>
              <span>Cài đặt hệ thống</span>
            </button>
          </div>

          <div className="tt-sidebar-footer">
            <p>💡 <strong>Mẹo chuyên nghiệp:</strong></p>
            <p style={{ marginTop: '4px' }}>
              Cài tiện ích <strong>ZVibe Helper</strong> để quét trọn bộ video trực tiếp từ trình duyệt của bạn 100% không lo bị chặn!
            </p>
          </div>
        </aside>

        {/* Right Main Content */}
        <main className="tt-main-content">
          {/* Loading Overlay */}
          {isLoading && (
            <div className="loading-container" style={{ marginBottom: '24px' }}>
              <div className="spinner"></div>
              <p>{loadingMsg}</p>
            </div>
          )}

          {/* Tab 1: Channel Analyzer */}
          {activeTab === 'channel' && !isLoading && (
            <div className="channel-section">
              {/* Hero Search Card */}
              <div className="tt-card" style={{ marginBottom: '20px' }}>
                <div className="tt-section-header">
                  <h2 className="tt-section-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--tt-red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    Quét & Phân Tích Kênh TikTok
                  </h2>
                  <p className="tt-section-subtitle">
                    Nhập link kênh hoặc username để quét toàn bộ video, lọc nội dung thịnh hành và tải video không logo.
                  </p>
                </div>

                {/* Extension Status Banner */}
                <div style={{ marginBottom: '14px' }}>
                  {isExtensionActive ? (
                    <div className="tt-banner-ext active">
                      <span className="tt-dot-pulse"></span>
                      <span><strong>Đã kết nối Chrome Extension:</strong> Tự động mở kênh & quét sạch video qua trình duyệt không bị chặn!</span>
                    </div>
                  ) : (
                    <div className="tt-banner-ext suggest" onClick={() => setActiveModal('extension')}>
                      <span>⚡ <strong>Khuyên dùng:</strong> Cài đặt <strong>ZVibe Chrome Extension</strong> để quét tự động 100% video</span>
                      <span style={{ textDecoration: 'underline', fontWeight: 700 }}>Cài đặt (10s) &rarr;</span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleFetchChannel}>
                  <div className="input-group">
                    <input 
                      type="text" 
                      className="form-control"
                      placeholder="Dán link kênh (ví dụ: tiktok.com/@vtv24news) hoặc nhập @username" 
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                    />
                    <select 
                      className="form-control" 
                      style={{ maxWidth: '175px' }}
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                    >
                      <option value="5">5 video</option>
                      <option value="12">12 video</option>
                      <option value="24">24 video</option>
                      <option value="50">50 video</option>
                      <option value="100">100 video</option>
                      <option value="200">200 video</option>
                      <option value="500">500 video</option>
                      <option value="all">Toàn bộ kênh (Đến đáy)</option>
                    </select>
                    <button className="btn btn-primary" type="submit">
                      Quét Kênh
                    </button>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                    💡 <strong>Mẹo:</strong> Bạn cũng có thể dán link 1 video bất kỳ của kênh vào ô tìm kiếm để hệ thống tự động bóc tách.
                  </p>
                </form>
              </div>

              {channelInfo && (
                <div className="channel-info-card">
                  <img className="channel-avatar" src={channelInfo.avatar} alt="avatar" />
                  <div className="channel-details">
                    <h2>{channelInfo.name}</h2>
                    <p>@{channelInfo.username}</p>
                    <div className="channel-stats">
                      <div className="stat-item">
                        <span>Tổng video:</span>
                        <strong>{videos.length}</strong>
                      </div>
                      <div className="stat-item">
                        <span>Lượt xem tổng:</span>
                        <strong>{formatViews(videos.reduce((acc, v) => acc + (Number(v.viewCount) || 0), 0))}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {videos.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Batch Action Toolbar */}
                  <div className="tt-toolbar">
                    <label className="tt-checkbox-label">
                      <input 
                        type="checkbox"
                        checked={videos.length > 0 && selectedChannelVideoIds.size === videos.length}
                        onChange={() => handleSelectAll('channel')}
                      />
                      <span>Chọn tất cả ({selectedChannelVideoIds.size}/{videos.length} video)</span>
                    </label>

                    <button 
                      className="btn btn-primary"
                      disabled={selectedChannelVideoIds.size === 0 || isZipping}
                      onClick={() => handleDownloadBatchZip('channel')}
                      style={{ height: '38px', padding: '0 18px', fontSize: '13px' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      {isZipping ? (zipProgress || 'Đang nén ZIP...') : `📦 Tải ${selectedChannelVideoIds.size} video đã chọn (.ZIP)`}
                    </button>
                  </div>

                  <div className="video-grid">
                    {videos.map(video => {
                      const isSelected = selectedChannelVideoIds.has(video.id);
                      return (
                        <div className="video-card" key={video.id}>
                          {/* Checkbox overlay */}
                          <div 
                            className={`video-card-checkbox ${isSelected ? 'selected' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleSelect(video.id, 'channel');
                            }}
                            title="Tích chọn video này"
                          >
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={() => {}}
                            />
                          </div>

                          <div 
                            className="video-thumbnail-container"
                            onClick={() => handleOpenWatchModal(video)}
                            title="Click để xem video và thông tin giỏ hàng"
                          >
                            <img className="video-thumbnail" src={video.thumbnail} alt={video.title} loading="lazy" />
                            {video.shopProduct ? (
                              <span style={{ 
                                position: 'absolute', 
                                top: '8px', 
                                right: '8px', 
                                background: 'var(--tt-red)', 
                                color: '#fff', 
                                fontSize: '11px', 
                                fontWeight: 700, 
                                padding: '2px 7px', 
                                borderRadius: '4px', 
                                zIndex: 3, 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '3px',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                              }}>
                                🛍️ Shop
                              </span>
                            ) : null}
                            <span className="video-views">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                              </svg>
                              {formatViews(video.viewCount)}
                            </span>
                            {video.duration ? <span className="video-duration">{formatDuration(video.duration)}</span> : null}
                          </div>

                          <div className="video-content">
                            <div className="video-title" title={video.title}>{video.title}</div>
                            <div className="video-actions">
                              <button className="btn-action btn-action-download" onClick={() => handleDownload(video.url || video.webpage_url)} title="Tải video không logo">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                  <polyline points="7 10 12 15 17 10"></polyline>
                                  <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                Tải
                              </button>
                              <button className="btn-action btn-action-script" onClick={() => handleGetScript(video)} title="Lấy kịch bản thoại">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                  <polyline points="14 2 14 8 20 8"></polyline>
                                  <line x1="16" y1="13" x2="8" y2="13"></line>
                                  <line x1="16" y1="17" x2="8" y2="17"></line>
                                </svg>
                                Kịch bản
                              </button>
                              <button className="btn-action btn-action-analyze" onClick={() => handleAnalyze(video)} title="Phân tích AI xu hướng">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                </svg>
                                AI
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

      {/* Tab 2: Single/Multiple Video Link Analyzer */}
      {activeTab === 'single' && !isLoading && (
        <div className="single-section" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="tt-card">
            <div className="tt-section-header">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <h2 className="tt-section-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--tt-red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                    Quét Nhiều Video TikTok Cùng Lúc
                  </h2>
                  <p className="tt-section-subtitle">
                    Dán danh sách các link video riêng lẻ để bóc tách thông tin, lấy số liệu và tải file ZIP không logo.
                  </p>
                </div>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={handleAddLinkInput}
                  style={{ height: '36px', padding: '0 14px', fontSize: '13px' }}
                >
                  <span style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--tt-red)', lineHeight: 1 }}>+</span> Thêm ô nhập link
                </button>
              </div>
            </div>

            <form onSubmit={handleFetchSingleVideos}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {videoInputs.map((inputVal, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', width: '22px', textAlign: 'right', fontWeight: '600' }}>{idx + 1}.</span>
                    <input 
                      type="text" 
                      className="form-control"
                      placeholder={`Dán link video TikTok #${idx + 1} (https://www.tiktok.com/@user/video/...)`} 
                      value={inputVal}
                      onChange={(e) => handleLinkInputChange(idx, e.target.value)}
                    />
                    {videoInputs.length > 1 && (
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={() => handleRemoveLinkInput(idx)}
                        style={{ height: '44px', width: '44px', padding: 0, color: 'var(--text-muted)' }}
                        title="Xóa ô này"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                  💡 Bạn có thể bấm <strong>"+ Thêm ô nhập link"</strong> để phân tích cùng lúc không giới hạn số lượng video.
                </p>
                <button className="btn btn-primary" type="submit">
                  Quét tất cả video
                </button>
              </div>
            </form>
          </div>

          {/* Scanned Video Results Grid */}
          {singleVideos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Batch Action Toolbar */}
              <div className="tt-toolbar">
                <label className="tt-checkbox-label">
                  <input 
                    type="checkbox"
                    checked={singleVideos.length > 0 && selectedSingleVideoIds.size === singleVideos.length}
                    onChange={() => handleSelectAll('single')}
                  />
                  <span>Chọn tất cả ({selectedSingleVideoIds.size}/{singleVideos.length} video)</span>
                </label>

                <button 
                  className="btn btn-primary"
                  disabled={selectedSingleVideoIds.size === 0 || isZipping}
                  onClick={() => handleDownloadBatchZip('single')}
                  style={{ height: '38px', padding: '0 18px', fontSize: '13px' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  {isZipping ? (zipProgress || 'Đang nén ZIP...') : `📦 Tải ${selectedSingleVideoIds.size} video đã chọn (.ZIP)`}
                </button>
              </div>

              <div className="video-grid">
                {singleVideos.map((vid, i) => {
                  const vidId = vid.id || vid.webpage_url;
                  const isSelected = selectedSingleVideoIds.has(vidId);
                  return (
                    <div className="video-card" key={i}>
                      {/* Checkbox overlay */}
                      <div 
                        className={`video-card-checkbox ${isSelected ? 'selected' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(vidId, 'single');
                        }}
                        title="Tích chọn video này"
                      >
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => {}}
                        />
                      </div>

                      <div 
                        className="video-thumbnail-container"
                        onClick={() => handleOpenWatchModal(vid)}
                        title="Click để xem video và thông tin giỏ hàng"
                      >
                        <img className="video-thumbnail" src={vid.thumbnail} alt={vid.title} loading="lazy" />
                        {vid.shopProduct ? (
                          <span style={{ 
                            position: 'absolute', 
                            top: '8px', 
                            right: '8px', 
                            background: 'var(--tt-red)', 
                            color: '#fff', 
                            fontSize: '11px', 
                            fontWeight: 700, 
                            padding: '2px 7px', 
                            borderRadius: '4px', 
                            zIndex: 3, 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '3px',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
                          }}>
                            🛍️ Shop
                          </span>
                        ) : null}
                        <span className="video-views">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                          </svg>
                          {formatViews(vid.viewCount)}
                        </span>
                        {vid.duration ? <span className="video-duration">{formatDuration(vid.duration)}</span> : null}
                      </div>

                      <div className="video-content">
                        <div className="video-title" title={vid.title}>
                          {vid.title}
                        </div>
                        <div className="video-meta-row">
                          <span>@{vid.uploader_id || vid.uploader || 'creator'}</span>
                          <span>❤️ {vid.likeCount?.toLocaleString() || 0}</span>
                        </div>

                        <div className="video-actions">
                          <button className="btn-action btn-action-download" onClick={() => handleDownload(vid.webpage_url || vid.url)} title="Tải video không logo">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <polyline points="7 10 12 15 17 10"></polyline>
                              <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Tải
                          </button>
                          <button className="btn-action btn-action-script" onClick={() => handleGetScript(vid)} title="Lấy kịch bản">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                              <line x1="16" y1="13" x2="8" y2="13"></line>
                              <line x1="16" y1="17" x2="8" y2="17"></line>
                            </svg>
                            Kịch bản
                          </button>
                          <button className="btn-action btn-action-analyze" onClick={() => handleAnalyze(vid)} title="Phân tích AI">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                            </svg>
                            AI
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: History & Analysis Details */}
      {activeTab === 'history' && !isLoading && (
        <div className="history-section">
          {/* History Sidebar */}
          <div className="history-sidebar">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--border-light)', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                Lịch sử phân tích
              </h3>
              {history.length > 0 && (
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '4px 10px', fontSize: '12px', height: 'auto' }} 
                  onClick={() => {
                    if (window.confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử?')) {
                      setHistory([]);
                      setSelectedHistoryId(null);
                      localStorage.removeItem('tiktok_analysis_history');
                    }
                  }}
                >
                  Xóa tất cả
                </button>
              )}
            </div>
            
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
                <p style={{ fontSize: '13px', margin: 0, fontWeight: 500 }}>Chưa có lịch sử phân tích.</p>
                <p style={{ fontSize: '12px', marginTop: '4px' }}>Hãy quét kênh hoặc quét video riêng để lưu lại tại đây.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: 'calc(100vh - 220px)', paddingRight: '4px' }}>
                {history.map(item => (
                  <div 
                    key={item.id} 
                    onClick={() => setSelectedHistoryId(item.id)}
                    className={`history-item ${selectedHistoryId === item.id ? 'active' : ''}`}
                  >
                    <img 
                      src={item.video?.thumbnail || ''} 
                      alt="thumbnail" 
                      style={{ width: '48px', height: '64px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }} 
                    />
                    <div style={{ flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div 
                        style={{ 
                          fontSize: '13px', 
                          fontWeight: '600',
                          color: selectedHistoryId === item.id ? 'var(--tt-red)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis' 
                        }}
                      >
                        {item.video?.title || item.video?.description || 'Video không tiêu đề'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        @{item.video?.uploader_id || item.video?.uploader || 'user'}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                        <span style={{ 
                          padding: '2px 8px', 
                          borderRadius: '12px', 
                          background: item.analysis ? 'rgba(37, 244, 238, 0.15)' : 'var(--bg-hover)',
                          color: item.analysis ? '#0891b2' : 'var(--text-muted)',
                          fontWeight: '600',
                          fontSize: '10px'
                        }}>
                          {item.analysis ? 'Đã AI' : 'Kịch bản'}
                        </span>
                      </div>
                    </div>

                    {/* Delete item button */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Xóa bản ghi này khỏi lịch sử?')) {
                          const newHistory = history.filter(h => h.id !== item.id);
                          setHistory(newHistory);
                          localStorage.setItem('tiktok_analysis_history', JSON.stringify(newHistory));
                          if (selectedHistoryId === item.id) {
                            setSelectedHistoryId(newHistory[0]?.id || null);
                          }
                        }
                      }}
                      style={{ 
                        position: 'absolute', 
                        top: '6px', 
                        right: '6px', 
                        background: 'transparent', 
                        border: 'none', 
                        color: 'var(--text-muted)', 
                        cursor: 'pointer',
                        padding: '4px',
                        fontSize: '14px',
                        lineHeight: 1
                      }}
                      title="Xóa bản ghi này"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Content Panel */}
          <div className="history-detail-panel">
            {(() => {
              const activeItem = history.find(h => h.id === selectedHistoryId);
              if (!activeItem) {
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', minHeight: '360px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>🎬</div>
                    <h4 style={{ color: 'var(--text-primary)', margin: '0 0 6px 0', fontSize: '16px' }}>Chọn một video để xem chi tiết</h4>
                    <p style={{ margin: 0, fontSize: '13px' }}>Nhấp vào một video trong danh sách bên trái để đọc kịch bản thoại và phân tích chiến lược AI.</p>
                  </div>
                );
              }

              const { video, transcript, analysis, optimizedScript } = activeItem;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Detail Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid var(--border-light)', paddingBottom: '16px' }}>
                    <div style={{ flex: '1 1 400px' }}>
                      <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px', lineHeight: '1.4' }}>
                        {video?.title || video?.description || 'Chi tiết video'}
                      </h2>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span>Kênh: <strong style={{ color: 'var(--text-primary)' }}>@{video?.uploader_id || video?.uploader || 'user'}</strong></span>
                        <span>•</span>
                        <span>Ngày lưu: {new Date(activeItem.timestamp).toLocaleString()}</span>
                        {video?.viewCount ? (
                          <>
                            <span>•</span>
                            <span>{formatViews(video.viewCount)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-secondary" onClick={() => handleOpenWatchModal(video)}>
                        ▶ Xem video
                      </button>
                      <button className="btn btn-primary" onClick={() => handleDownload(video?.url || video?.webpage_url)}>
                        ⬇ Tải không logo
                      </button>
                    </div>
                  </div>

                  {/* Twin Pane: Transcript & Analysis */}
                  <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                    
                    {/* Column 1: Original Transcript */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🎙️</span>
                          <span>Kịch bản gốc (Giọng nói)</span>
                        </h3>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '3px 8px', fontSize: '11px', height: 'auto' }}
                            onClick={() => handleGetScriptFromHistory(activeItem)}
                            title="Chạy AI để trích xuất lại kịch bản thoại"
                          >
                            🔄 Dịch lại
                          </button>
                          {transcript && (
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '3px 8px', fontSize: '11px', height: 'auto' }}
                              onClick={() => {
                                navigator.clipboard.writeText(transcript);
                                showToast('Đã sao chép kịch bản!');
                              }}
                            >
                              📋 Sao chép
                            </button>
                          )}
                        </div>
                      </div>

                      <div style={{ 
                        background: 'var(--bg-input)', 
                        border: '1px solid var(--border-light)', 
                        borderRadius: 'var(--radius-md)', 
                        padding: '16px', 
                        minHeight: '440px', 
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        fontSize: '13px',
                        lineHeight: '1.7',
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {transcript ? transcript : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', minHeight: '300px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>Chưa trích xuất kịch bản thoại của video này.</p>
                            <button className="btn btn-primary" onClick={() => handleGetScriptFromHistory(activeItem)}>
                              Dịch kịch bản ngay
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 2: AI Analysis */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>✨</span>
                          <span>Phân tích xu hướng (AI)</span>
                        </h3>
                        {analysis && (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '3px 8px', fontSize: '11px', height: 'auto' }}
                            onClick={() => {
                              navigator.clipboard.writeText(analysis);
                              showToast('Đã sao chép phân tích AI!');
                            }}
                          >
                            📋 Sao chép
                          </button>
                        )}
                      </div>

                      <div style={{ 
                        background: 'var(--bg-input)', 
                        border: '1px solid var(--border-light)', 
                        borderRadius: 'var(--radius-md)', 
                        padding: '16px', 
                        minHeight: '440px', 
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        fontSize: '13px',
                        lineHeight: '1.7',
                        color: 'var(--text-primary)'
                      }}
                        dangerouslySetInnerHTML={{ 
                          __html: analysis ? parseMarkdown(analysis) : `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 300px; gap: 12px;">
                            <p style="font-size: 13px; color: var(--text-muted); margin: 0;">Chưa chạy phân tích nội dung AI.</p>
                            <button class="btn btn-primary" onclick="window.dispatchAnalyzeEvent('${activeItem.id}')">
                              Chạy phân tích AI ngay
                            </button>
                          </div>`
                        }}
                      />
                    </div>
                  </div>

                  {/* Prominent Call-to-action: Optimize script */}
                  {transcript && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderTop: '1px solid var(--border-light)', paddingTop: '20px', marginTop: '10px' }}>
                      {isOptimizing ? (
                        <div style={{ textAlign: 'center', padding: '16px' }}>
                          <div className="spinner" style={{ margin: '0 auto 10px auto' }}></div>
                          <p style={{ color: 'var(--tt-red)', fontSize: '14px', fontWeight: '600' }}>Đang sáng tạo kịch bản mới tối ưu triệu view...</p>
                        </div>
                      ) : !optimizedScript ? (
                        <button 
                          className="btn btn-primary" 
                          style={{ 
                            padding: '12px 28px',
                            fontSize: '14px',
                            fontWeight: '700',
                            borderRadius: 'var(--radius-pill)',
                            boxShadow: 'var(--shadow-btn)'
                          }}
                          onClick={() => handleCreateOptimizedScript(activeItem)}
                        >
                          🚀 Tạo kịch bản tối ưu mới dựa trên video này
                        </button>
                      ) : (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--tt-red)', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>🔥</span>
                              <span>KỊCH BẢN TỐI ƯU MỚI ĐỀ XUẤT (Cấu trúc chuyên nghiệp)</span>
                            </h3>
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 12px', fontSize: '12px' }}
                              onClick={() => {
                                navigator.clipboard.writeText(optimizedScript);
                                showToast('Đã sao chép kịch bản tối ưu mới!');
                              }}
                            >
                              📋 Sao chép kịch bản
                            </button>
                          </div>

                          <div style={{ 
                            background: 'var(--tt-red-soft)', 
                            border: '1px dashed var(--tt-red-soft-border)', 
                            borderRadius: 'var(--radius-md)', 
                            padding: '20px', 
                            fontSize: '13px', 
                            lineHeight: '1.7', 
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            minHeight: '350px',
                            maxHeight: '70vh',
                            overflowY: 'auto'
                          }}>
                            {optimizedScript}
                          </div>
                          
                          <button 
                            className="btn btn-secondary" 
                            style={{ alignSelf: 'center', marginTop: '6px' }}
                            onClick={() => handleCreateOptimizedScript(activeItem)}
                          >
                            🔄 Viết lại phiên bản tối ưu khác
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

        </main>
      </div>

      {/* Script & Analysis Modal */}
      {(activeModal === 'script' || activeModal === 'analysis') && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {activeModal === 'script' ? 'Kịch bản Video' : 'Phân tích Video bằng AI'}
              </h3>
              <button className="modal-close" onClick={() => setActiveModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.25rem' }}>{selectedVideo?.title}</h4>
                <p style={{ fontSize: '0.85rem' }}>Người đăng: @{selectedVideo?.uploader_id || selectedVideo?.uploader}</p>
              </div>

              {activeModal === 'script' ? (
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', color: 'var(--text-secondary)' }}>
                  {modalContent || 'Không thể trích xuất kịch bản.'}
                </div>
              ) : (
                <div 
                  className="analysis-markdown"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(modalContent) }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* TikTok Desktop Theater Video Player Modal (Matching tiktok.com desktop) */}
      {activeModal === 'watch' && selectedVideo && (() => {
        const currentVideoList = activeTab === 'single' 
          ? singleVideos 
          : (activeTab === 'history' ? history.map(h => h.video).filter(Boolean) : videos);
        const currentVideoIndex = currentVideoList.findIndex(v => (v.id && v.id === selectedVideo.id) || (v.webpage_url && v.webpage_url === selectedVideo.webpage_url));

        const handlePrevVideo = () => {
          if (currentVideoIndex > 0) {
            handleOpenWatchModal(currentVideoList[currentVideoIndex - 1]);
          }
        };

        const handleNextVideo = () => {
          if (currentVideoIndex >= 0 && currentVideoIndex < currentVideoList.length - 1) {
            handleOpenWatchModal(currentVideoList[currentVideoIndex + 1]);
          }
        };

        const handleScrubberClick = (e) => {
          if (!videoRef.current || !playerDuration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const ratio = Math.max(0, Math.min(1, clickX / rect.width));
          const newTime = ratio * playerDuration;
          videoRef.current.currentTime = newTime;
          setPlayerCurrentTime(newTime);
        };

        const shopProduct = selectedVideo.shopProduct || (() => {
          const title = (selectedVideo.title || selectedVideo.description || '').toLowerCase();
          if (/giỏ hàng|tiktokshop|tiktok shop|sản phẩm|mua tại/i.test(title)) {
            const match = title.match(/(?:mua tại|giỏ hàng|sản phẩm)[:\s]+([^#\n.]+)/i);
            return {
              title: match ? match[1].trim() : 'Sản phẩm được gắn trong Giỏ hàng',
              coverUrl: selectedVideo.thumbnail || null,
              type: 'TikTokShop',
              icon: '🛍️',
              url: selectedVideo.webpage_url || selectedVideo.url,
              seoUrl: selectedVideo.webpage_url || selectedVideo.url,
              isAffiliate: true,
              source: 'TikTok Shop',
              note: 'Phát hiện liên kết giỏ hàng TikTok Shop từ nội dung'
            };
          }
          return null;
        })();

        const currentHistoryItem = history.find(h => h.id === selectedVideo.id || h.video?.id === selectedVideo.id);

        return (
          <div className="tt-player-overlay" onClick={() => setActiveModal(null)}>
            {/* Left Theater Canvas (Video player & seek bar) */}
            <div className="tt-player-theater" onClick={(e) => e.stopPropagation()}>
              {/* Top Navigation Bar */}
              <div className="tt-player-topbar">
                <button 
                  className="tt-circle-btn" 
                  onClick={() => setActiveModal(null)} 
                  title="Đóng trình phát (Esc)"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>

                <div className="tt-player-search-pill">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <span>Tìm kiếm nội dung liên quan trên TikTok</span>
                </div>

                <button className="tt-circle-btn" title="Tùy chọn">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="2"></circle>
                    <circle cx="19" cy="12" r="2"></circle>
                    <circle cx="5" cy="12" r="2"></circle>
                  </svg>
                </button>
              </div>

              {/* Video Player Stage */}
              <div className="tt-player-stage">
                <video 
                  ref={videoRef}
                  className="tt-player-video"
                  src={`/api/stream-video?url=${encodeURIComponent(selectedVideo.url || selectedVideo.webpage_url)}&proxy=${encodeURIComponent(proxy || '')}`}
                  autoPlay
                  playsInline
                  onTimeUpdate={() => {
                    if (videoRef.current) {
                      setPlayerCurrentTime(videoRef.current.currentTime);
                      setPlayerDuration(videoRef.current.duration || 0);
                    }
                  }}
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      setPlayerDuration(videoRef.current.duration || 0);
                    }
                  }}
                  onPlay={() => setPlayerIsPlaying(true)}
                  onPause={() => setPlayerIsPlaying(false)}
                  onClick={() => {
                    if (videoRef.current) {
                      if (videoRef.current.paused) videoRef.current.play();
                      else videoRef.current.pause();
                    }
                  }}
                />

                {!playerIsPlaying && (
                  <div className="tt-play-overlay-icon">
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="6 3 20 12 6 21 6 3"></polygon>
                    </svg>
                  </div>
                )}

                {/* Right Edge Chevrons (Up / Down) */}
                <div className="tt-player-nav-group">
                  <button 
                    className="tt-nav-chevron" 
                    disabled={currentVideoIndex <= 0} 
                    onClick={handlePrevVideo} 
                    title="Video trước (Phím mũi tên lên)"
                  >
                    ▲
                  </button>
                  <button 
                    className="tt-nav-chevron" 
                    disabled={currentVideoIndex < 0 || currentVideoIndex >= currentVideoList.length - 1} 
                    onClick={handleNextVideo} 
                    title="Video tiếp theo (Phím mũi tên xuống)"
                  >
                    ▼
                  </button>
                </div>
              </div>

              {/* Bottom Controls Bar with Scrubber Timeline */}
              <div className="tt-player-bottom-bar">
                {/* Scrubber / Seek Bar (Tua video) */}
                <div className="tt-scrubber-track" onClick={handleScrubberClick} title="Bấm hoặc kéo để tua video đến đoạn mong muốn">
                  <div 
                    className="tt-scrubber-progress" 
                    style={{ width: `${playerDuration ? (playerCurrentTime / playerDuration) * 100 : 0}%` }}
                  >
                    <div className="tt-scrubber-thumb"></div>
                  </div>
                </div>

                {/* Actions row under scrubber */}
                <div className="tt-player-actions-row">
                  <div className="tt-player-actions-left">
                    <button 
                      className="tt-theater-pill-btn"
                      onClick={() => handleDownload(selectedVideo.url || selectedVideo.webpage_url)}
                      title="Tải video gốc không logo về máy"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      Tải không logo
                    </button>

                    <button 
                      className="tt-theater-pill-btn"
                      onClick={() => handleAnalyze(selectedVideo)}
                      title="Phân tích chiến lược nội dung AI"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                      Phân tích AI
                    </button>
                  </div>

                  <div className="tt-player-actions-right">
                    <span className="tt-time-display">
                      {formatDuration(playerCurrentTime)} / {formatDuration(playerDuration)}
                    </span>

                    <div className="tt-volume-container">
                      <button 
                        className="tt-circle-btn" 
                        style={{ width: '32px', height: '32px' }}
                        onClick={() => {
                          if (videoRef.current) {
                            const newMuted = !playerIsMuted;
                            videoRef.current.muted = newMuted;
                            setPlayerIsMuted(newMuted);
                          }
                        }}
                        title={playerIsMuted ? 'Bật âm thanh' : 'Tắt tiếng'}
                      >
                        {playerIsMuted || playerVolume === 0 ? '🔇' : '🔊'}
                      </button>

                      <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05" 
                        value={playerIsMuted ? 0 : playerVolume} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setPlayerVolume(val);
                          if (videoRef.current) {
                            videoRef.current.volume = val;
                            videoRef.current.muted = val === 0;
                            setPlayerIsMuted(val === 0);
                          }
                        }}
                        className="tt-volume-slider" 
                        title="Điều chỉnh âm lượng"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Details Panel (TikTok Creator & Shop & Transcript) */}
            <div className="tt-player-sidebar" onClick={(e) => e.stopPropagation()}>
              <div className="tt-sidebar-inner">
                {/* Creator Profile Header */}
                <div className="tt-player-creator-header">
                  <div className="tt-player-creator-info">
                    <img 
                      src={selectedVideo.thumbnail || channelInfo?.avatar || 'https://www.w3schools.com/howto/img_avatar.png'} 
                      alt="creator" 
                      className="tt-player-creator-avatar" 
                    />
                    <div className="tt-player-creator-names">
                      <div className="tt-player-nickname">
                        {selectedVideo.uploader || channelInfo?.name || selectedVideo.uploader_id || 'Creator'}
                      </div>
                      <div className="tt-player-handle-date">
                        @{selectedVideo.uploader_id || channelInfo?.username || 'user'} • {selectedVideo.duration ? formatDuration(selectedVideo.duration) : 'TikTok'}
                      </div>
                    </div>
                  </div>

                  <a 
                    href={selectedVideo.webpage_url || selectedVideo.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ padding: '6px 16px', fontSize: '13px' }}
                  >
                    Xem trên TikTok
                  </a>
                </div>

                {/* Video Caption & Hashtags */}
                <p className="tt-player-caption">
                  {selectedVideo.title || selectedVideo.description || 'Không có tiêu đề'}
                </p>

                {/* Sound / Music Audio Line */}
                <div className="tt-player-sound-bar">
                  <span>🎵</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    âm thanh gốc - {selectedVideo.uploader || selectedVideo.uploader_id || 'TikTok Music'}
                  </span>
                </div>

                {/* =========================================================
                    MỤC SẢN PHẨM GIỎ HÀNG TIKTOK SHOP (Special Feature!)
                    ========================================================= */}
                {shopProduct ? (
                  <div className="tt-shop-product-card">
                    <div className="tt-shop-header">
                      <span className="tt-shop-badge">
                        🛍️ Sản phẩm giỏ hàng TikTok Shop
                      </span>
                      <span className="tt-shop-pill-tag">
                        Đang gắn giỏ hàng
                      </span>
                    </div>

                    <div className="tt-shop-body">
                      <div className="tt-shop-cover-box">
                        {shopProduct.coverUrl ? (
                          <img 
                            src={shopProduct.coverUrl} 
                            alt={shopProduct.title} 
                            className="tt-shop-cover-img"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector('.tt-shop-fallback-icon');
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div 
                          className="tt-shop-fallback-icon" 
                          style={{ display: shopProduct.coverUrl ? 'none' : 'flex' }}
                        >
                          🛍️
                        </div>
                      </div>

                      <div className="tt-shop-details">
                        <div className="tt-shop-title" title={shopProduct.title}>
                          {shopProduct.title}
                        </div>
                        {shopProduct.price ? (
                          <div className="tt-shop-price-tag">
                            💰 Giá bán: <strong>{shopProduct.price}</strong>
                          </div>
                        ) : null}
                        <div className="tt-shop-desc">
                          {shopProduct.source === 'TikTok Shop' 
                            ? '✅ Sản phẩm chính hãng gắn trên giỏ hàng video TikTok' 
                            : (shopProduct.note || 'Sản phẩm được gắn trong giỏ hàng video TikTok')}
                        </div>
                      </div>
                    </div>

                    <a 
                      href={shopProduct.seoUrl || shopProduct.url || selectedVideo.webpage_url || selectedVideo.url} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="tt-shop-action-btn"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                      </svg>
                      Xem chi tiết sản phẩm trên TikTok Shop ↗
                    </a>
                  </div>
                ) : (
                  <div style={{ 
                    padding: '14px 16px', 
                    borderRadius: '10px', 
                    background: 'var(--bg-input)', 
                    border: '1px solid var(--border-light)', 
                    fontSize: '12px', 
                    color: 'var(--text-muted)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '10px' 
                  }}>
                    <span style={{ fontSize: '18px' }}>ℹ️</span>
                    <div>
                      <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: '2px' }}>
                        Video không gắn giỏ hàng TikTok Shop
                      </strong>
                      <span>Đây là video sáng tạo nội dung thông thường, không chứa liên kết tiếp thị liên kết (E-commerce).</span>
                    </div>
                  </div>
                )}

                {/* Engagement Numbers Row */}
                <div className="tt-player-stats-row">
                  <div className="tt-stat-item" title="Lượt thích">
                    <span className="tt-stat-icon">❤️</span>
                    <span>{formatViews(selectedVideo.likeCount || 0)}</span>
                  </div>

                  <div className="tt-stat-item" title="Lượt bình luận">
                    <span className="tt-stat-icon">💬</span>
                    <span>{formatViews(selectedVideo.commentCount || 0)}</span>
                  </div>

                  <div className="tt-stat-item" title="Lượt xem">
                    <span className="tt-stat-icon">▶</span>
                    <span>{formatViews(selectedVideo.viewCount || 0)}</span>
                  </div>

                  <div className="tt-stat-item" title="Lượt chia sẻ">
                    <span className="tt-stat-icon">🔗</span>
                    <span>{formatViews(selectedVideo.shareCount || 0)}</span>
                  </div>
                </div>

                {/* Copy Link Bar */}
                <div className="tt-copy-link-bar">
                  <input 
                    type="text" 
                    readOnly 
                    value={selectedVideo.webpage_url || selectedVideo.url || ''} 
                    className="tt-copy-link-input" 
                  />
                  <button 
                    className="tt-copy-link-btn" 
                    onClick={() => {
                      navigator.clipboard.writeText(selectedVideo.webpage_url || selectedVideo.url);
                      showToast('Đã sao chép link video TikTok!');
                    }}
                  >
                    Sao chép
                  </button>
                </div>

                {/* Action buttons row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => handleGetScript(selectedVideo)}
                    style={{ fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    🎙️ Lấy kịch bản thoại
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => handleAnalyze(selectedVideo)}
                    style={{ fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    ✨ Phân tích AI
                  </button>
                </div>

                {/* Dual Tabs: Kịch bản / Phân tích AI */}
                <div className="tt-player-tabs">
                  <button 
                    className={`tt-player-tab ${playerTab === 'info' ? 'active' : ''}`}
                    onClick={() => setPlayerTab('info')}
                  >
                    Thông tin chi tiết
                  </button>
                  <button 
                    className={`tt-player-tab ${playerTab === 'script' ? 'active' : ''}`}
                    onClick={() => setPlayerTab('script')}
                  >
                    Kịch bản thoại
                  </button>
                  <button 
                    className={`tt-player-tab ${playerTab === 'analysis' ? 'active' : ''}`}
                    onClick={() => setPlayerTab('analysis')}
                  >
                    Chiến lược AI
                  </button>
                </div>

                {/* Tab content area */}
                <div style={{ flexGrow: 1, minHeight: '180px' }}>
                  {playerTab === 'info' && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
                      <p><strong>ID Video:</strong> <code>{selectedVideo.id}</code></p>
                      <p style={{ marginTop: '6px' }}><strong>Kênh tạo:</strong> @{selectedVideo.uploader_id || selectedVideo.uploader}</p>
                      <p style={{ marginTop: '6px' }}><strong>Mẹo:</strong> Sử dụng phím mũi tên <strong>Trái / Phải</strong> để tua nhanh 5s, hoặc bấm vào thanh tiến trình bên dưới để xem bất kỳ đoạn nào bạn muốn!</p>
                    </div>
                  )}

                  {playerTab === 'script' && (
                    <div style={{ background: 'var(--bg-input)', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
                      {currentHistoryItem?.transcript ? (
                        currentHistoryItem.transcript
                      ) : (
                        <div style={{ textAlign: 'center', padding: '16px' }}>
                          <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Chưa trích xuất kịch bản thoại cho video này.</p>
                          <button className="btn btn-primary" onClick={() => handleGetScript(selectedVideo)}>
                            Dịch kịch bản ngay
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {playerTab === 'analysis' && (
                    <div style={{ background: 'var(--bg-input)', padding: '14px', borderRadius: '8px', fontSize: '13px', lineHeight: '1.7', maxHeight: '300px', overflowY: 'auto' }}>
                      {currentHistoryItem?.analysis ? (
                        <div dangerouslySetInnerHTML={{ __html: parseMarkdown(currentHistoryItem.analysis) }} />
                      ) : (
                        <div style={{ textAlign: 'center', padding: '16px' }}>
                          <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>Chưa chạy phân tích chiến lược AI.</p>
                          <button className="btn btn-primary" onClick={() => handleAnalyze(selectedVideo)}>
                            Chạy phân tích AI ngay
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Settings Modal */}
      {activeModal === 'settings' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Cài đặt Hệ thống</h3>
              <button className="modal-close" onClick={() => setActiveModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <form className="settings-form" onSubmit={handleSaveSettings}>
                <div>
                  <label htmlFor="gemini-key" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                    🤖 API Key Phân Tích & Viết Kịch Bản (Gemini hoặc Bên Thứ 3 / ShopAIKey)
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                      type="password" 
                      id="gemini-key"
                      className="form-control"
                      placeholder="Dán API Key (Ví dụ: sk-AM8O... hoặc AIzaSy...)" 
                      value={geminiKey}
                      onChange={(e) => {
                        setGeminiKey(e.target.value);
                        setDiagnoseResult(null);
                      }}
                    />
                    <button 
                      className="btn btn-secondary" 
                      type="button" 
                      disabled={diagnosing}
                      onClick={handleDiagnoseGemini}
                      style={{ padding: '0 1rem', whiteSpace: 'nowrap' }}
                    >
                      {diagnosing ? 'Đang test...' : 'Test Key'}
                    </button>
                  </div>
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Dùng để chạy Phân Tích AI và Viết Kịch Bản Mới Tối Ưu bằng gpt-4o hoặc Gemini.
                  </p>
                </div>

                <div>
                  <label htmlFor="speech-key" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    🎙️ API Key Dịch Giọng Nói Video (Google Gemini Key - Miễn Phí)
                  </label>
                  <input 
                    type="password" 
                    id="speech-key"
                    className="form-control"
                    placeholder="Dán Google Gemini Key (AIzaSy...) để nghe giọng nói chuẩn 100%" 
                    value={speechKey}
                    onChange={(e) => setSpeechKey(e.target.value)}
                  />
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Dùng để nghe trực tiếp file MP4 và bóc tách chính xác từng lời nói của người phát biểu trong video trong 3s.
                  </p>
                </div>

                {diagnoseResult && (
                  <div style={{ 
                    padding: '1rem', 
                    borderRadius: '8px', 
                    fontSize: '0.85rem',
                    background: diagnoseResult.success && diagnoseResult.quotaStatus === 'active' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(254, 44, 85, 0.08)',
                    border: diagnoseResult.success && diagnoseResult.quotaStatus === 'active' ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(254, 44, 85, 0.3)'
                  }}>
                    {diagnoseResult.success ? (
                      <div>
                        {diagnoseResult.quotaStatus === 'active' ? (
                          <p style={{ color: '#15803d', margin: 0, fontWeight: '600' }}>
                            ✅ Kết nối thành công! API Key hoạt động tốt và có sẵn các mô hình: {diagnoseResult.models.join(', ')}.
                          </p>
                        ) : (
                          <div>
                            <p style={{ color: 'var(--tt-red)', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                              ⚠️ Lỗi Quota / Hạn ngạch (limit: 0):
                            </p>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem', lineHeight: '1.4' }}>
                              {diagnoseResult.quotaError}
                            </p>
                            <p style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                              Đề xuất khắc phục:
                            </p>
                            <ul style={{ marginLeft: '1.25rem', marginTop: '0.25rem', color: 'var(--text-secondary)' }}>
                              <li style={{ marginBottom: '0.25rem' }}>Tạo một **API Key mới** trong một dự án Google AI Studio mới.</li>
                              <li>Liên kết tài khoản **Billing (Thẻ tín dụng)** vào Google Cloud Project để mở khóa hạn ngạch miễn phí.</li>
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ color: 'var(--tt-red)', margin: 0 }}>
                        <strong>Lỗi kết nối:</strong> {diagnoseResult.error}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="api-base-url" style={{ display: 'block', marginBottom: '0.5rem' }}>API Endpoint / Base URL (Tùy chọn cho bên thứ 3)</label>
                  <input 
                    type="text" 
                    id="api-base-url"
                    className="form-control"
                    placeholder="Mặc định cho Gemini gốc. Ví dụ bên thứ 3: https://api.openai.com/v1" 
                    value={apiBaseUrl}
                    onChange={(e) => {
                      setApiBaseUrl(e.target.value);
                      setDiagnoseResult(null);
                    }}
                  />
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Điền URL của proxy hoặc nhà cung cấp API bên thứ 3 nếu bạn sử dụng khóa API không phải của Google AI Studio (ví dụ OpenAI, OpenRouter, v.v.).
                  </p>
                </div>

                <div>
                  <label htmlFor="custom-model" style={{ display: 'block', marginBottom: '0.5rem' }}>Model AI tùy chọn (Tùy chọn)</label>
                  <input 
                    type="text" 
                    id="custom-model"
                    className="form-control"
                    placeholder="Ví dụ: gpt-4o-mini, gemini-2.5-flash, whisper-1..." 
                    value={customModel}
                    onChange={(e) => {
                      setCustomModel(e.target.value);
                      setDiagnoseResult(null);
                    }}
                  />
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Điền chính xác ID của model bạn muốn gọi. Nếu để trống, hệ thống sẽ tự động chọn model tối ưu nhất.
                  </p>
                </div>

                <div>
                  <label htmlFor="proxy" style={{ display: 'block', marginBottom: '0.5rem' }}>HTTP/HTTPS Proxy (Tùy chọn)</label>
                  <input 
                    type="text" 
                    id="proxy"
                    className="form-control"
                    placeholder="ví dụ: http://username:password@ip:port" 
                    value={proxy}
                    onChange={(e) => setProxy(e.target.value)}
                  />
                  <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    Sử dụng khi IP của máy tính bị TikTok chặn/giới hạn khi quét danh sách video hoặc tải file.
                  </p>
                </div>

                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" type="button" onClick={() => setActiveModal(null)}>Hủy</button>
                  <button className="btn btn-primary" type="submit">Lưu lại</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Extension Modal */}
      {activeModal === 'extension' && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>⚡</span>
                <h3 style={{ margin: 0 }}>Tiện ích Chrome Extension Quét Kênh</h3>
              </div>
              <button className="modal-close" onClick={() => setActiveModal(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Status banner */}
              <div style={{ 
                padding: '0.85rem 1rem', 
                borderRadius: '10px', 
                background: isExtensionActive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                border: isExtensionActive ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(234, 179, 8, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <span style={{ fontSize: '20px' }}>{isExtensionActive ? '🟢' : '🟡'}</span>
                <div>
                  <strong style={{ color: isExtensionActive ? '#15803d' : '#a16207' }}>
                    {isExtensionActive ? 'Extension đang hoạt động hoàn hảo!' : 'Chưa phát hiện Extension trên trình duyệt'}
                  </strong>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                    {isExtensionActive 
                      ? 'Hệ thống sẽ tự động mượn phiên duyệt Chrome để quét sạch video mỗi khi bạn bấm "Quét Kênh".' 
                      : 'Hãy cài đặt theo các bước bên dưới (chỉ mất 10 giây) để quét kênh mượt mà không lo bị TikTok chặn.'}
                  </p>
                </div>
              </div>

              {/* Big Download Button */}
              <div style={{ textAlign: 'center' }}>
                <a 
                  href="/zvibe-tiktok-helper.zip" 
                  download="zvibe-tiktok-helper.zip"
                  className="btn btn-primary"
                  style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: '10px', 
                    padding: '0.75rem 1.75rem', 
                    fontSize: '1rem',
                    textDecoration: 'none',
                    fontWeight: 700,
                    boxShadow: 'var(--shadow-btn)'
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Tải xuống ZVibe Extension (.ZIP - 9KB)
                </a>
              </div>

              {/* 3 Step Install Guide */}
              <div style={{ background: 'var(--bg-input)', borderRadius: '10px', padding: '1.25rem', border: '1px solid var(--border-light)' }}>
                <h4 style={{ color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.95rem' }}>
                  📖 Hướng dẫn cài đặt nhanh trong 10 giây:
                </h4>
                <ol style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  <li>
                    <strong>Bước 1:</strong> Bấm nút tải ở trên &rarr; Giải nén file <code>zvibe-tiktok-helper.zip</code> thành 1 thư mục trên máy tính của bạn.
                  </li>
                  <li>
                    <strong>Bước 2:</strong> Mở tab mới trên Chrome, truy cập vào đường dẫn: <code style={{ color: 'var(--tt-red)', background: '#FFFFFF', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-light)' }}>chrome://extensions/</code>
                  </li>
                  <li>
                    <strong>Bước 3:</strong> Bật công tắc <strong>"Chế độ cho nhà phát triển" (Developer mode)</strong> ở góc trên bên phải màn hình.
                  </li>
                  <li>
                    <strong>Bước 4:</strong> Bấm nút <strong>"Tải tiện ích đã giải nén" (Load unpacked)</strong> ở góc trái &rarr; Chọn thư mục vừa giải nén.
                  </li>
                  <li>
                    <strong>Bước 5:</strong> Xong! Quay lại trang này bấm <strong>F5</strong> (Tải lại trang) là biểu tượng sẽ chuyển sang màu xanh 🟢.
                  </li>
                </ol>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setActiveModal(null)}>
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast" style={{ borderLeftColor: toast.type === 'error' ? 'var(--tt-red)' : '#15803d' }}>
          {toast.type === 'error' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--tt-red)" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          )}
          <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;

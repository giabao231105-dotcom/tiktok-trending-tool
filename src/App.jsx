import React, { useState, useEffect } from 'react';

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
    setLoadingMsg('Đang tải danh sách video từ kênh TikTok...');
    setVideos([]);
    setChannelInfo(null);

    try {
      const response = await fetch('/api/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: channelInput, limit, proxy })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || 'Failed to fetch channel');

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
        showToast('Không tìm thấy video nào. Hãy thử đổi cài đặt proxy.', 'error');
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
    <div className="app-container">
      {/* Floating Settings Button */}
      <button className="settings-trigger" onClick={() => setActiveModal('settings')} title="Cài đặt">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>

      {/* Header */}
      <header className="header">
        <h1>TikTok trending analysis</h1>
        <p>Tải video không logo, lấy kịch bản và phân tích xu hướng kịch bản bằng Gemini AI</p>
      </header>

      {/* Navigation Tabs */}
      <nav className="tabs-nav">
        <button 
          className={`tab-btn ${activeTab === 'channel' ? 'active' : ''}`}
          onClick={() => setActiveTab('channel')}
        >
          Phân tích Kênh TikTok
        </button>
        <button 
          className={`tab-btn ${activeTab === 'single' ? 'active' : ''}`}
          onClick={() => setActiveTab('single')}
        >
          Gắn link video riêng
        </button>
        <button 
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          Lịch sử & Chi tiết ({history.length})
        </button>
      </nav>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="glass-card loading-container" style={{ marginBottom: '2rem' }}>
          <div className="spinner"></div>
          <p>{loadingMsg}</p>
        </div>
      )}

      {/* Tab 1: Channel Analyzer */}
      {activeTab === 'channel' && !isLoading && (
        <div className="channel-section">
          <form className="glass-card" onSubmit={handleFetchChannel}>
            <div className="input-group">
              <input 
                type="text" 
                className="form-control"
                placeholder="Nhập link kênh (ví dụ: https://www.tiktok.com/@vtv24_tin_tuc) hoặc @username" 
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
              />
              <select 
                className="form-control" 
                style={{ maxWidth: '120px' }}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              >
                <option value="5">5 video</option>
                <option value="12">12 video</option>
                <option value="24">24 video</option>
                <option value="50">50 video</option>
                <option value="100">100 video</option>
                <option value="all">Tất cả</option>
              </select>
              <button className="btn btn-primary" type="submit">Quét Kênh</button>
            </div>
            <p style={{ fontSize: '0.85rem' }}>* Mẹo: Cấu hình API Key trong mục cài đặt (bánh răng) góc trên bên phải để dùng tính năng AI.</p>
          </form>

          {channelInfo && (
            <div className="glass-card channel-info-card" style={{ marginTop: '2rem' }}>
              <img className="channel-avatar" src={channelInfo.avatar} alt="avatar" />
              <div className="channel-details">
                <h2>{channelInfo.name}</h2>
                <p>@{channelInfo.username}</p>
              </div>
            </div>
          )}

          {videos.length > 0 && (
            <div className="video-grid">
              {videos.map(video => (
                <div className="video-card" key={video.id}>
                  <div 
                    className="video-thumbnail-container"
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedVideo(video);
                      setActiveModal('watch');
                    }}
                    title="Click để xem video"
                  >
                    <img className="video-thumbnail" src={video.thumbnail} alt={video.title} />
                    <span className="video-views">{formatViews(video.viewCount)}</span>
                    <span className="video-duration">{formatDuration(video.duration)}</span>
                  </div>
                  <div className="video-content">
                    <div className="video-title" title={video.title}>{video.title}</div>
                    <div className="video-actions">
                      <button className="btn-action btn-action-download" onClick={() => handleDownload(video.url)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Tải video không logo
                      </button>
                      <button className="btn-action btn-action-script" onClick={() => handleGetScript(video)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        Lấy kịch bản
                      </button>
                      <button className="btn-action btn-action-analyze" onClick={() => handleAnalyze(video)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                        Phân tích video (AI)
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Single/Multiple Video Link Analyzer */}
      {activeTab === 'single' && !isLoading && (
        <div className="single-section" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <form className="glass-card" onSubmit={handleFetchSingleVideos} style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <h3 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>
                🔗 Nhập link video TikTok (Quét hàng loạt)
              </h3>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleAddLinkInput}
                style={{ fontSize: '0.85rem', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#00f2fe', lineHeight: 1 }}>+</span> Thêm ô nhập link mới
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {videoInputs.map((inputVal, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', width: '24px', textAlign: 'right', fontWeight: '600' }}>{idx + 1}.</span>
                  <input 
                    type="text" 
                    className="form-control"
                    placeholder={`Dán link video TikTok #${idx + 1} (ví dụ: https://www.tiktok.com/@user/video/...)`} 
                    value={inputVal}
                    onChange={(e) => handleLinkInputChange(idx, e.target.value)}
                  />
                  {videoInputs.length > 1 && (
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      onClick={() => handleRemoveLinkInput(idx)}
                      style={{ padding: '0.45rem 0.75rem', color: '#ff3860', borderColor: 'rgba(255, 56, 96, 0.3)' }}
                      title="Xóa ô này"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                * Màn hình mặc định 3 ô nhập. Bấm nút (+) để mở rộng ô nhập không giới hạn.
              </p>
              <button className="btn btn-primary" type="submit" style={{ padding: '0.6rem 1.75rem' }}>
                Quét tất cả video
              </button>
            </div>
          </form>

          {/* Scanned Video Results Grid */}
          {singleVideos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-cyan)' }}>
                Kết quả quét ({singleVideos.length} video):
              </h3>
              <div className="video-grid">
                {singleVideos.map((vid, i) => (
                  <div className="video-card" key={i}>
                    <div 
                      className="video-thumbnail-container"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedVideo(vid);
                        setActiveModal('watch');
                      }}
                      title="Click để xem video"
                    >
                      <img className="video-thumbnail" src={vid.thumbnail} alt={vid.title} />
                      <span className="video-views">{formatViews(vid.viewCount)}</span>
                      <span className="video-duration">{formatDuration(vid.duration)}</span>
                    </div>
                    <div className="video-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                      <div>
                        <div className="video-title" title={vid.title} style={{ fontSize: '0.9rem', marginBottom: '0.4rem' }}>
                          {vid.title}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0.5rem 0' }}>
                          Kênh: <strong>@{vid.uploader_id}</strong>
                        </p>
                      </div>
                      
                      <div style={{ marginTop: 'auto' }}>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                          <span>❤️ {vid.likeCount?.toLocaleString() || 0}</span>
                          <span>💬 {vid.commentCount?.toLocaleString() || 0}</span>
                          <span>🔄 {vid.shareCount?.toLocaleString() || 0}</span>
                        </div>

                        <div className="video-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
                          <button className="btn-action btn-action-download" style={{ padding: '0.45rem 0.25rem', fontSize: '0.72rem' }} onClick={() => handleDownload(vid.webpage_url)}>
                            Tải video
                          </button>
                          <button className="btn-action btn-action-script" style={{ padding: '0.45rem 0.25rem', fontSize: '0.72rem' }} onClick={() => handleGetScript(vid)}>
                            Kịch bản
                          </button>
                          <button className="btn-action btn-action-analyze" style={{ padding: '0.45rem 0.25rem', fontSize: '0.72rem' }} onClick={() => handleAnalyze(vid)}>
                            Phân tích
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: History & Analysis Details */}
      {activeTab === 'history' && !isLoading && (
        <div className="history-section" style={{ display: 'flex', gap: '1.5rem', minHeight: '60vh' }}>
          {/* History Sidebar */}
          <div className="glass-card history-sidebar" style={{ flex: '1 1 280px', maxWidth: '340px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Lịch sử phân tích</span>
              {history.length > 0 && (
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} 
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
            </h3>
            
            {history.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '2rem' }}>
                Chưa có lịch sử phân tích. Hãy thực hiện quét kênh hoặc quét link video riêng!
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', maxHeight: '70vh', paddingRight: '0.25rem' }}>
                {history.map(item => (
                  <div 
                    key={item.id} 
                    onClick={() => setSelectedHistoryId(item.id)}
                    style={{ 
                      display: 'flex', 
                      gap: '0.75rem', 
                      padding: '0.75rem', 
                      borderRadius: '8px', 
                      cursor: 'pointer',
                      background: selectedHistoryId === item.id ? 'rgba(0, 242, 254, 0.1)' : 'rgba(255, 255, 255, 0.02)',
                      border: selectedHistoryId === item.id ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                    className="history-item"
                  >
                    <img 
                      src={item.video?.thumbnail || ''} 
                      alt="thumbnail" 
                      style={{ width: '50px', height: '65px', borderRadius: '4px', objectFit: 'cover' }} 
                    />
                    <div style={{ flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div 
                        style={{ 
                          fontSize: '0.85rem', 
                          fontWeight: '500',
                          color: selectedHistoryId === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                          whiteSpace: 'nowrap', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis' 
                        }}
                      >
                        {item.video?.title || ''}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        @{item.video?.uploader_id || item.video?.uploader || 'user'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                        <span style={{ 
                          padding: '2px 6px', 
                          borderRadius: '10px', 
                          background: item.analysis ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.1)',
                          color: item.analysis ? '#00f2fe' : 'var(--text-muted)',
                          fontSize: '0.65rem'
                        }}>
                          {item.analysis ? 'Đã phân tích' : 'Chỉ kịch bản'}
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
                        top: '5px', 
                        right: '5px', 
                        background: 'transparent', 
                        border: 'none', 
                        color: 'var(--text-muted)', 
                        cursor: 'pointer',
                        padding: '2px',
                        fontSize: '0.9rem'
                      }}
                      title="Xóa"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detailed Content Panel */}
          <div className="glass-card history-detail-panel" style={{ flex: '2 1 600px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {(() => {
              const activeItem = history.find(h => h.id === selectedHistoryId);
              if (!activeItem) {
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', minHeight: '350px' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '1rem', opacity: 0.5 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <h4>Vui lòng chọn một video trong danh sách lịch sử để xem chi tiết kịch bản và phân tích.</h4>
                  </div>
                );
              }

              const { video, transcript, analysis, optimizedScript } = activeItem;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {/* Detail Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                    <div style={{ flex: '1 1 400px' }}>
                      <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem', lineHeight: '1.5', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {video?.title || video?.description || ''}
                      </h2>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Kênh: <strong>@{video?.uploader_id || video?.uploader || 'user'}</strong> | Ngày lưu: {new Date(activeItem.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button className="btn btn-secondary" onClick={() => {
                        setSelectedVideo(video);
                        setActiveModal('watch');
                      }}>
                        Xem video
                      </button>
                      <button className="btn btn-secondary" onClick={() => handleDownload(video?.url || video?.webpage_url)}>
                        Tải không logo
                      </button>
                    </div>
                  </div>

                  {/* Twin Pane: Transcript & Analysis */}
                  <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    
                    {/* Column 1: Original Transcript */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ fontSize: '1.1rem', color: 'var(--accent-cyan)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Kịch bản gốc (Giọng nói dịch)</span>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={() => handleGetScriptFromHistory(activeItem)}
                            title="Chạy AI để tạo kịch bản thoại chi tiết từng câu từng chữ"
                          >
                            🔄 Tạo lại kịch bản
                          </button>
                          {transcript && (
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                              onClick={() => {
                                navigator.clipboard.writeText(transcript);
                                showToast('Đã sao chép kịch bản!');
                              }}
                            >
                              Sao chép
                            </button>
                          )}
                        </div>
                      </h3>
                      <div style={{ 
                        background: 'rgba(255, 255, 255, 0.01)', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '8px', 
                        padding: '1.25rem', 
                        minHeight: '480px', 
                        maxHeight: '65vh',
                        overflowY: 'auto',
                        fontSize: '0.95rem',
                        lineHeight: '1.7',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'pre-wrap'
                      }}>
                        {transcript ? transcript : (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem' }}>
                            <p style={{ fontSize: '0.85rem' }}>Chưa trích xuất kịch bản thoại.</p>
                            <button className="btn btn-primary" onClick={() => handleGetScriptFromHistory(activeItem)}>
                              Dịch kịch bản ngay
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Column 2: AI Analysis */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      <h3 style={{ fontSize: '1.1rem', color: '#b15cff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Phân tích xu hướng (AI)</span>
                        {analysis && (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                            onClick={() => {
                              navigator.clipboard.writeText(analysis);
                              showToast('Đã sao chép phân tích AI!');
                            }}
                          >
                            Sao chép
                          </button>
                        )}
                      </h3>
                      <div style={{ 
                        background: 'rgba(255, 255, 255, 0.01)', 
                        border: '1px solid var(--border-color)', 
                        borderRadius: '8px', 
                        padding: '1.25rem', 
                        minHeight: '480px', 
                        maxHeight: '65vh',
                        overflowY: 'auto',
                        fontSize: '0.95rem',
                        lineHeight: '1.7',
                        color: 'var(--text-secondary)'
                      }}
                        dangerouslySetInnerHTML={{ 
                          __html: analysis ? parseMarkdown(analysis) : `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 1rem;">
                            <p style="font-size: 0.85rem;">Chưa chạy phân tích video AI.</p>
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
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', marginTop: '0.5rem' }}>
                      {isOptimizing ? (
                        <div style={{ textAlign: 'center', padding: '1rem' }}>
                          <div className="spinner" style={{ margin: '0 auto 0.75rem auto' }}></div>
                          <p style={{ color: '#00f2fe', fontSize: '0.95rem' }}>Đang sáng tạo kịch bản mới tối ưu triệu view...</p>
                        </div>
                      ) : !optimizedScript ? (
                        <button 
                          className="btn" 
                          style={{ 
                            background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)', 
                            color: '#000', 
                            fontWeight: 'bold', 
                            padding: '0.75rem 2rem',
                            fontSize: '1rem',
                            boxShadow: '0 4px 15px rgba(0, 242, 254, 0.3)'
                          }}
                          onClick={() => handleCreateOptimizedScript(activeItem)}
                        >
                          🚀 Tạo kịch bản tối ưu mới dựa trên video này
                        </button>
                      ) : (
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                          <h3 style={{ fontSize: '1.2rem', color: '#00f2fe', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>✨ KỊCH BẢN TỐI ƯU MỚI ĐỀ XUẤT (Cấu trúc chuyên nghiệp)</span>
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                              onClick={() => {
                                navigator.clipboard.writeText(optimizedScript);
                                showToast('Đã sao chép kịch bản tối ưu mới!');
                              }}
                            >
                              Sao chép kịch bản mới
                            </button>
                          </h3>
                          <div style={{ 
                            background: 'rgba(0, 242, 254, 0.03)', 
                            border: '1px dashed rgba(0, 242, 254, 0.4)', 
                            borderRadius: '10px', 
                            padding: '1.5rem', 
                            fontSize: '0.95rem',
                            lineHeight: '1.7',
                            color: 'var(--text-primary)',
                            whiteSpace: 'pre-wrap',
                            minHeight: '400px',
                            maxHeight: '75vh',
                            overflowY: 'auto'
                          }}>
                            {optimizedScript}
                          </div>
                          
                          <button 
                            className="btn btn-secondary" 
                            style={{ alignSelf: 'center', marginTop: '0.5rem' }}
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

      {/* Watch Video Modal */}
      {activeModal === 'watch' && selectedVideo && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Xem Video</h3>
              <button className="modal-close" onClick={() => setActiveModal(null)}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 2rem' }}>
              <video 
                src={`/api/download?url=${encodeURIComponent(selectedVideo.url || selectedVideo.webpage_url)}&proxy=${encodeURIComponent(proxy || '')}`}
                controls
                autoPlay
                style={{ width: '100%', maxHeight: '60vh', borderRadius: '12px', background: '#000' }}
              />
              <div style={{ marginTop: '1.25rem', width: '100%' }}>
                <h4 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', color: 'var(--text-primary)', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{selectedVideo.title}</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Kênh: @{selectedVideo.uploader_id || selectedVideo.uploader}</p>
              </div>
            </div>
          </div>
        </div>
      )}

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
                  <label htmlFor="speech-key" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600', color: '#00f2fe' }}>
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
                    background: diagnoseResult.success && diagnoseResult.quotaStatus === 'active' ? 'rgba(0, 242, 254, 0.05)' : 'rgba(255, 56, 96, 0.05)',
                    border: diagnoseResult.success && diagnoseResult.quotaStatus === 'active' ? '1px solid rgba(0, 242, 254, 0.2)' : '1px solid rgba(255, 56, 96, 0.2)'
                  }}>
                    {diagnoseResult.success ? (
                      <div>
                        {diagnoseResult.quotaStatus === 'active' ? (
                          <p style={{ color: '#00f2fe' }}>
                            <strong>Kết nối thành công!</strong> API Key hoạt động tốt và có sẵn các mô hình: {diagnoseResult.models.join(', ')}.
                          </p>
                        ) : (
                          <div>
                            <p style={{ color: '#ff3860', fontWeight: 'bold', marginBottom: '0.5rem' }}>
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
                      <p style={{ color: '#ff3860' }}>
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

      {/* Toast Notification */}
      {toast && (
        <div className="toast" style={{ borderLeftColor: toast.type === 'error' ? '#ff3860' : 'var(--accent-cyan)' }}>
          {toast.type === 'error' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff3860" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" strokeWidth="2.5">
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

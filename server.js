const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ytdlp = require('./ytdlp-helper');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so our React frontend can communicate with the backend
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Check status / health endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Serve static React build files for single-port production / cloud deployment
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Endpoint to fetch videos list from a channel
app.post('/api/channel', async (req, res) => {
  const { url, limit = 12, proxy = null } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'Channel URL or username is required' });
  }

  // Clean the username/url or handle video URL to extract channel
  let targetUrl = (url || '').trim();

  // If user entered a video URL (e.g. tiktok.com/@user/video/123 or vt.tiktok.com), extract channel_id
  const isVideoLink = targetUrl.includes('/video/') || targetUrl.includes('vt.tiktok.com') || targetUrl.includes('vm.tiktok.com');
  if (isVideoLink) {
    console.log(`Detected video link in channel scanner. Resolving author channel_id via yt-dlp...`);
    try {
      const channelId = await ytdlp.getChannelIdFromVideo(targetUrl, proxy);
      if (channelId) {
        console.log(`Successfully extracted channel_id (${channelId}) from video link!`);
        targetUrl = `tiktokuser:${channelId}`;
      }
    } catch (vidErr) {
      console.warn('Failed to extract channel_id from video link:', vidErr.message);
    }
  } else if (!targetUrl.startsWith('http') && !targetUrl.startsWith('tiktokuser:')) {
    const cleanUser = targetUrl.replace(/^@+/, '');
    targetUrl = `https://www.tiktok.com/@${cleanUser}`;
  } else if (!targetUrl.startsWith('tiktokuser:')) {
    targetUrl = targetUrl.split('?')[0].replace(/\/+$/, '');
  }

  console.log(`Fetching videos for channel: ${targetUrl} (Limit: ${limit}, Proxy: ${proxy ? 'Yes' : 'No'})`);

  try {
    const rawVideos = await ytdlp.getChannelVideos(targetUrl, limit, proxy);
    
    // Enrich videos with full TikWM metadata to get 100% complete titles & hashtags (removing yt-dlp ... truncation)
    const videos = await Promise.all(rawVideos.map(async (v) => {
      try {
        const tikData = await fetchVideoInfoFromTikWM(v.url);
        if (tikData && tikData.title) {
          return {
            ...v,
            title: tikData.title,
            description: tikData.description || tikData.title,
            thumbnail: tikData.thumbnail || v.thumbnail,
            viewCount: tikData.viewCount || v.viewCount,
            likeCount: tikData.likeCount || 0,
            commentCount: tikData.commentCount || 0,
            shareCount: tikData.shareCount || 0
          };
        }
      } catch {}
      return {
        ...v,
        description: v.description || v.title
      };
    }));

    res.json({ success: true, count: videos.length, videos });
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    let errMsg = error.message || '';
    if (errMsg.includes('Unable to extract secondary user ID') || errMsg.includes('secondary user ID')) {
      errMsg = 'TikTok đang bật bảo vệ WAF chặn quét trực tiếp qua username. 👉 GIẢI PHÁP: Bạn chỉ cần dán LINK 1 VIDEO BẤT KỲ của kênh này vào ô tìm kiếm, hệ thống sẽ tự động quét toàn bộ video của kênh!';
    }
    res.status(500).json({
      error: 'Failed to fetch channel videos',
      details: errMsg,
      note: 'Mẹo: Dán link 1 video của kênh để quét toàn bộ kênh không bị chặn.'
    });
  }
});

// Fetch video info using public TikWM API as a fast, anti-block method
async function fetchVideoInfoFromTikWM(videoUrl) {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`;
    console.log(`Attempting to fetch video metadata from TikWM: ${apiUrl}`);
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) throw new Error(`TikWM returned status ${res.status}`);
    const json = await res.json();
    if (json.code === 0 && json.data) {
      console.log('TikWM metadata fetched successfully.');
      const d = json.data;
      return {
        id: d.id,
        title: d.title || 'No Title',
        description: d.title || '',
        uploader: d.author?.nickname || 'TikTok Creator',
        uploader_id: d.author?.unique_id || 'creator',
        thumbnail: d.cover,
        duration: d.duration || null,
        viewCount: d.play_count || 0,
        likeCount: d.digg_count || 0,
        commentCount: d.comment_count || 0,
        shareCount: d.share_count || 0,
        webpage_url: videoUrl,
        playUrl: d.play, // no watermark video
        musicUrl: d.music, // audio stream
      };
    } else {
      throw new Error(json.msg || 'TikWM API returned non-zero code');
    }
  } catch (err) {
    console.warn('TikWM API failed:', err.message);
    return null;
  }
}

// Endpoint to fetch single video details
app.post('/api/video-info', async (req, res) => {
  const { url, proxy = null } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  console.log(`Fetching details for video: ${url}`);
  try {
    let videoDetails = await fetchVideoInfoFromTikWM(url);
    if (!videoDetails) {
      console.log('TikWM failed. Falling back to yt-dlp...');
      const data = await ytdlp.getVideoInfo(url, proxy);
      videoDetails = {
        id: data.id,
        title: data.title || data.description || 'No Title',
        description: data.description || '',
        thumbnail: data.thumbnail || (data.thumbnails?.[0]?.url) || null,
        duration: data.duration || null,
        viewCount: data.view_count || null,
        likeCount: data.like_count || null,
        commentCount: data.comment_count || null,
        shareCount: data.share_count || null,
        uploader: data.uploader || null,
        uploader_id: data.uploader_id || null,
        webpage_url: data.webpage_url
      };
    }

    res.json({ success: true, video: videoDetails });
  } catch (error) {
    console.error('Error fetching video details:', error);
    res.status(500).json({ error: 'Failed to fetch video details', details: error.message });
  }
});

// Endpoint to download video without logo (streaming pipe)
app.get('/api/download', async (req, res) => {
  const { url, proxy = null } = req.query;

  if (!url) {
    return res.status(400).send('Video URL is required');
  }

  try {
    console.log(`Preparing download for: ${url}`);
    let videoData = await fetchVideoInfoFromTikWM(url);
    let directVideoUrl = null;
    let filename = `tiktok_no_watermark_${Date.now()}.mp4`;

    if (videoData && videoData.playUrl) {
      directVideoUrl = videoData.playUrl;
      filename = `tiktok_no_watermark_${videoData.id || Date.now()}.mp4`;
      console.log(`Using TikWM play URL: ${directVideoUrl.substring(0, 100)}...`);
    } else {
      console.log('TikWM failed. Falling back to yt-dlp for format extraction...');
      const info = await ytdlp.getVideoInfo(url, proxy);
      filename = `tiktok_no_watermark_${info.id || Date.now()}.mp4`;
      
      const formats = info.formats || [];
      const mergedFormats = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
      
      let selectedFormat = null;
      if (mergedFormats.length > 0) {
        mergedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
        selectedFormat = mergedFormats.find(f => 
          f.format_id && 
          (f.format_id.includes('play_addr') || f.format_id.includes('download_addr')) && 
          !f.format_id.includes('watermark')
        );
        
        if (!selectedFormat) {
          selectedFormat = mergedFormats.find(f => f.format_id && !f.format_id.includes('watermark'));
        }
        
        if (!selectedFormat) {
          selectedFormat = mergedFormats[0];
        }
      } else {
        const videoFormats = formats.filter(f => f.vcodec && f.vcodec !== 'none');
        if (videoFormats.length > 0) {
          videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
          selectedFormat = videoFormats[0];
        }
      }

      directVideoUrl = selectedFormat ? selectedFormat.url : info.url;
      console.log(`Piping video stream from CDN (Format: ${selectedFormat ? selectedFormat.format_id : 'default'}): ${directVideoUrl.substring(0, 100)}...`);
    }

    if (!directVideoUrl) {
      return res.status(404).send('Direct video download URL not found');
    }

    // Fetch the direct CDN URL with necessary headers to bypass hotlinking protection
    const cdnResponse = await fetch(directVideoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });

    if (!cdnResponse.ok) {
      throw new Error(`Failed to fetch video from CDN: ${cdnResponse.statusText}`);
    }

    // Set response headers for direct download
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Pipe response stream to Express client
    const reader = cdnResponse.body.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      }
    });

    // Write stream to res in chunks
    const nodeStream = require('stream').Readable.from(stream);
    nodeStream.pipe(res);

  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).send(`Download failed: ${error.message}`);
  }
});

// Maps file extensions to MimeTypes for Gemini API
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.m4a': return 'audio/mp4';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.webm': return 'audio/webm';
    case '.ogg': return 'audio/ogg';
    case '.mp4': return 'video/mp4';
    default: return 'audio/mp4';
  }
}

// Fallback helper to run Gemini content generation against a list of active models (resolves 404 retired models)
async function generateContentWithFallback(apiKey, contents, prompt = null, options = {}) {
  const { apiBaseUrl = '', customModel = '' } = options;
  apiKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');

  // Decide if we should use OpenAI-compatible Mode
  const isOpenAI = apiKey.startsWith('sk-') || Boolean(apiBaseUrl);

  if (isOpenAI) {
    const baseUrl = apiBaseUrl || 'https://api.openai.com/v1';
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');

    // Case 1: Speech-to-Text transcription (inlineData is present)
    const isTranscription = contents && contents.inlineData;
    if (isTranscription) {
      const modelName = 'whisper-1';
      console.log(`OpenAI Mode: Transcribing audio/video via ${modelName} at ${cleanBaseUrl}...`);

      const base64Data = contents.inlineData.data;
      const mimeType = contents.inlineData.mimeType || 'audio/mp4';
      const buffer = Buffer.from(base64Data, 'base64');

      let audioFilename = 'audio.m4a';
      if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
        audioFilename = 'audio.mp3';
      }

      // Construct multipart body as a single Buffer to set Content-Length and avoid chunked encoding issues
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const headerPart = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${modelName}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${audioFilename}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
      );
      const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);
      const bodyBuffer = Buffer.concat([headerPart, buffer, footerPart]);

      // Automatic 3x Retry loop for 3rd-party Whisper endpoints
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

        try {
          console.log(`OpenAI Mode: Transcribing audio via ${modelName} at ${cleanBaseUrl} (Attempt ${attempt}/3)...`);
          const response = await fetch(`${cleanBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body: bodyBuffer,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          const data = await response.json();
          if (!response.ok) {
            const msg = data.error?.message || data.details || JSON.stringify(data);
            throw new Error(msg);
          }

          if (data.text || data.transcript) {
            return data.text || data.transcript;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          lastErr = err;
          console.warn(`Whisper transcription attempt ${attempt}/3 failed:`, err.message);
          if (attempt < 3) {
            await new Promise(r => setTimeout(r, 2500)); // 2.5s delay before retry
          }
        }
      }

      if (lastErr && lastErr.name === 'AbortError') {
        throw new Error('Cổng dịch thoại Whisper của nhà cung cấp bên thứ 3 hiện đang bị treo (Timeout 45s). Vui lòng thử lại sau ít phút.');
      }
      throw lastErr || new Error('Không thể dịch thoại bằng Whisper sau 3 lần thử.');
    }

    // Case 2: Ordinary text prompt (e.g. analysis, optimization)
    const modelName = customModel || 'gpt-4o-mini';
    console.log(`OpenAI Mode: Generating content via ${modelName} at ${cleanBaseUrl}...`);

    let promptText = '';
    if (typeof contents === 'string') {
      promptText = contents;
    } else if (contents.text) {
      promptText = contents.text;
    } else {
      promptText = JSON.stringify(contents);
    }

    if (prompt) {
      promptText = `${promptText}\n\n${prompt}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

    try {
      const response = await fetch(`${cleanBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'user', content: promptText }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || data.details || JSON.stringify(data));
      }
      return data.choices[0].message.content;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Yêu cầu AI chat quá thời hạn (Timeout 45s). Máy chủ trung gian bạn đang dùng phản hồi quá lâu.');
      }
      throw err;
    }
  }

  // Google REST API or Google SDK Mode
  const defaultGoogleModels = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.5-flash',
    'gemini-1.5-pro-latest'
  ];

  // If customBaseUrl is set, we use direct REST API calls because Google SDK does not support setting custom base URL easily.
  if (apiBaseUrl) {
    const baseUrl = apiBaseUrl.replace(/\/$/, '');
    const models = customModel ? [customModel] : defaultGoogleModels;
    
    let firstError = null;
    let lastError = null;
    for (const modelName of models) {
      try {
        console.log(`Attempting Google REST API using model: ${modelName} at ${baseUrl}...`);
        
        let requestBody;
        if (contents.inlineData) {
          // Multimodal transcription payload
          requestBody = {
            contents: [
              {
                parts: [
                  { text: prompt || 'Transcribe this' },
                  {
                    inlineData: {
                      mimeType: contents.inlineData.mimeType,
                      data: contents.inlineData.data
                    }
                  }
                ]
              }
            ]
          };
        } else {
          // Text analysis payload
          let textParts = [];
          if (typeof contents === 'string') {
            textParts.push({ text: contents });
          } else if (contents.text) {
            textParts.push({ text: contents.text });
          } else {
            textParts.push({ text: JSON.stringify(contents) });
          }
          if (prompt) {
            textParts.push({ text: prompt });
          }
          requestBody = {
            contents: [{ parts: textParts }]
          };
        }

        const url = `${baseUrl}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error?.message || data.details || JSON.stringify(data));
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response from Google API');
        
        console.log(`Successfully generated content using Google REST model: ${modelName}`);
        return text;
      } catch (err) {
        console.warn(`Google REST model ${modelName} failed:`, err.message);
        if (!firstError) firstError = err;
        lastError = err;
      }
    }
    throw firstError || lastError || new Error('All Google REST models failed');
  }

  // Standard Google SDK Mode (Direct client calling googleapis.com)
  const models = customModel ? [customModel] : defaultGoogleModels;
  const genAI = new GoogleGenerativeAI(apiKey);
  
  let firstError = null;
  let lastError = null;
  for (const modelName of models) {
    try {
      console.log(`Attempting Google SDK using model: ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      
      let result;
      if (prompt) {
        result = await model.generateContent([contents, prompt]);
      } else {
        result = await model.generateContent(contents);
      }
      
      const text = result.response.text();
      console.log(`Successfully generated content using Google SDK model: ${modelName}`);
      return text;
    } catch (err) {
      console.warn(`Google SDK model ${modelName} failed:`, err.message);
      if (!firstError) firstError = err;
      lastError = err;
    }
  }
  
  const finalError = firstError || lastError;
  if (finalError && (finalError.message.includes('429') || finalError.message.includes('Quota exceeded'))) {
    throw new Error('API Key Gemini của bạn đã vượt quá giới hạn gọi lượt miễn phí trong ngày (429 Rate Limit / Quota Exceeded). Vui lòng tạo 1 API Key Gemini mới tại aistudio.google.com hoặc chờ ít phút rồi thử lại.');
  }
  
  throw finalError || new Error('All Google SDK models failed');
}

// Endpoint to transcribe video audio to text (Speech-to-Text)
app.post('/api/transcript', async (req, res) => {
  const { url, proxy = null } = req.body;
  const clientSpeechKey = req.headers['x-speech-key'];
  const clientGeminiKey = req.headers['x-gemini-key'];
  
  let apiKey = (clientSpeechKey && clientSpeechKey.trim()) ? clientSpeechKey.trim() : (clientGeminiKey || process.env.GEMINI_API_KEY);
  let apiBaseUrl = req.headers['x-api-base-url'] || '';
  let customModel = req.headers['x-custom-model'] || '';

  // If the key is a Google Gemini Key (starts with AIza) or if process.env.GEMINI_API_KEY is available, force native Google Gemini mode for 3-second voice transcription
  if (apiKey && apiKey.startsWith('AIza')) {
    apiBaseUrl = '';
    customModel = '';
  }

  if (!url) {
    return res.status(400).json({ error: 'Video URL is required' });
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API Key is required. Please set it in Settings.' });
  }

  const tempAudioFile = path.join(tempDir, `audio_${Date.now()}`);

  try {
    console.log(`Transcribing video: ${url}`);
    
    // Step 0: Check for built-in subtitles first (extremely fast, works instantly, saves tokens)
    try {
      console.log('Checking for built-in subtitles...');
      const info = await ytdlp.getVideoInfo(url, proxy);
      if (info.subtitles && Object.keys(info.subtitles).length > 0) {
        const lang = info.subtitles.vi || Object.values(info.subtitles)[0];
        if (lang && lang[0] && lang[0].url) {
          console.log(`Found built-in subtitles! Fetching: ${lang[0].url}`);
          const subRes = await fetch(lang[0].url);
          const subText = await subRes.text();
          return res.json({ success: true, source: 'subtitles', transcript: subText });
        }
      }
    } catch (err) {
      console.warn('Failed to check built-in subtitles, continuing with audio download:', err.message);
    }

    let finalAudioPath = null;

    // Step 1: Primary Download via TikWM API
    console.log(`Fetching direct video download link via TikWM...`);
    let videoData = await fetchVideoInfoFromTikWM(url);
    const isOpenAI = apiKey.startsWith('sk-') || Boolean(apiBaseUrl);

    if (videoData) {
      // For OpenAI/Whisper Mode, pure MP3 audio from musicUrl is 100x faster (~160KB) and processed instantly by Whisper!
      if (isOpenAI && videoData.musicUrl) {
        console.log(`OpenAI Mode: Downloading pure MP3 audio from TikWM music URL: ${videoData.musicUrl}`);
        try {
          const audioRes = await fetch(videoData.musicUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Referer': 'https://www.tiktok.com/'
            }
          });
          if (audioRes.ok) {
            const audioBuf = await audioRes.arrayBuffer();
            finalAudioPath = `${tempAudioFile}.mp3`;
            fs.writeFileSync(finalAudioPath, Buffer.from(audioBuf));
            console.log(`Pure MP3 audio saved to disk for Whisper: ${finalAudioPath} (${(audioBuf.byteLength / 1024).toFixed(2)} KB)`);
          }
        } catch (mp3Err) {
          console.warn('Failed to download MP3 music stream, falling back to MP4:', mp3Err.message);
        }
      }

      if (!finalAudioPath && videoData.playUrl) {
        console.log(`Downloading video directly from TikWM play URL: ${videoData.playUrl}`);
        const videoRes = await fetch(videoData.playUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.tiktok.com/'
          }
        });
        if (!videoRes.ok) throw new Error(`Failed to fetch video from TikWM CDN: ${videoRes.statusText}`);
        
        const buffer = await videoRes.arrayBuffer();
        finalAudioPath = `${tempAudioFile}.mp4`;
        fs.writeFileSync(finalAudioPath, Buffer.from(buffer));
        console.log(`Media saved to disk: ${finalAudioPath}`);
      }
    } else {
      console.log('TikWM unavailable, attempting yt-dlp fallback download...');
      try {
        const actualAudioPath = await ytdlp.downloadAudio(url, `${tempAudioFile}.%(ext)s`, proxy);
        const files = fs.readdirSync(tempDir);
        const downloadedFile = files.find(f => f.startsWith(path.basename(tempAudioFile)));
        if (!downloadedFile) throw new Error('Downloaded audio file not found on disk');
        finalAudioPath = path.join(tempDir, downloadedFile);
      } catch (ytErr) {
        throw new Error(`Không thể tải video từ TikTok. TikWM và yt-dlp đều thất bại. Chi tiết: ${ytErr.message}`);
      }
    }

    if (!finalAudioPath || !fs.existsSync(finalAudioPath)) {
      throw new Error('File media không tồn tại trên hệ thống sau khi tải.');
    }

    // Step 4: Send audio file to Gemini API
    console.log('Sending audio to Gemini API for transcription...');
    const audioBuffer = fs.readFileSync(finalAudioPath);
    const base64Audio = audioBuffer.toString('base64');
    const mimeType = getMimeType(finalAudioPath);

    const prompt = 'Hãy chép lại lời thoại (transcribe) trong đoạn âm thanh này một cách chính xác từng từ bằng tiếng Việt (hoặc ngôn ngữ gốc của người nói). Đảm bảo giữ nguyên các từ lóng, biểu cảm nói nếu có. Nếu đoạn âm thanh chỉ có nhạc nền hoặc không có tiếng người nói, hãy trả về câu: "Không có lời thoại trong video này (chỉ có nhạc nền hoặc âm thanh khác)". Không cần giải thích thêm, chỉ trả về nội dung chép lời thoại.';

    let transcript = '';
    try {
      transcript = await generateContentWithFallback(
        apiKey,
        {
          inlineData: {
            data: base64Audio,
            mimeType: mimeType
          }
        },
        prompt,
        { apiBaseUrl, customModel }
      );
      console.log('Transcription completed successfully via AI audio model.');
    } catch (aiErr) {
      console.warn('Audio Speech-to-Text model failed after retries:', aiErr.message);
      
      if (videoData && (videoData.description || videoData.title)) {
        transcript = `[Nội dung mô tả / Tiêu đề gốc từ TikTok]:\n${videoData.description || videoData.title}\n\n⚠️ Lưu ý: Cổng dịch thoại Whisper của nhà cung cấp bên thứ 3 (ShopAIKey) hiện đang báo quá tải (Lỗi 429: Upstream saturated). Hệ thống đã thử lại 3 lần nhưng máy chủ Whisper bên thứ 3 tạm thời chưa trả về âm thanh. Bạn vui lòng bấm nút "🔄 Tạo lại kịch bản" sau vài phút khi máy chủ bên thứ 3 ổn định lại.`;
      } else {
        throw new Error(`Cổng dịch thoại Whisper của bên thứ 3 tạm thời quá tải: ${aiErr.message}`);
      }
    }

    // Cleanup temp audio file
    try {
      fs.unlinkSync(finalAudioPath);
    } catch {}

    res.json({ success: true, source: 'ai-speech-to-text', transcript });

  } catch (error) {
    console.error('Error during transcription:', error);
    // Cleanup on error
    try {
      const files = fs.readdirSync(tempDir);
      const tempFiles = files.filter(f => f.startsWith(path.basename(tempAudioFile)));
      tempFiles.forEach(f => fs.unlinkSync(path.join(tempDir, f)));
    } catch {}

    res.status(500).json({ error: 'Failed to transcribe video', details: error.message });
  }
});

// Endpoint to analyze video using Gemini API
app.post('/api/analyze', async (req, res) => {
  const { url, transcript, title, description } = req.body;
  const clientGeminiKey = req.headers['x-gemini-key'];
  const apiKey = clientGeminiKey || process.env.GEMINI_API_KEY;
  const apiBaseUrl = req.headers['x-api-base-url'] || '';
  const customModel = req.headers['x-custom-model'] || '';

  if (!transcript) {
    return res.status(400).json({ error: 'Transcript/Script is required for analysis' });
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API Key is required. Please set it in Settings.' });
  }

  try {
    const prompt = `Bạn là một chuyên gia phân tích nội dung TikTok (TikTok Content Analyst) hàng đầu. Hãy phân tích kịch bản video TikTok sau đây để đánh giá hiệu quả của nó và đề xuất cách cải tiến để tăng tương tác và có khả năng lên xu hướng (viral).

THÔNG TIN VIDEO:
- Tiêu đề: ${title || 'Không có tiêu đề'}
- Mô tả: ${description || 'Không có mô tả'}
- Kịch bản kịch chi tiết (Transcript):
"""
${transcript}
"""

HÃY VIẾT BÁO CÁO PHÂN TÍCH CHI TIẾT BẰNG TIẾNG VIỆT GỒM CÁC PHẦN SAU:
1. **Tóm tắt nội dung chính**: Tóm tắt ngắn gọn chủ đề và nội dung video truyền tải (1-2 câu).
2. **Đánh giá Hook (3 giây đầu)**: Điểm mạnh của câu mở đầu, nó có đủ thu hút người xem dừng lại không? Tại sao? Đề xuất 3 Hook thay thế cuốn hút hơn.
3. **Phân tích Cấu trúc & Nhịp độ**: Video dẫn dắt như thế nào? Sự phân bổ thông tin có hợp lý không? Đoạn nào dễ gây nhàm chán khiến người xem lướt qua?
4. **Đánh giá Call to Action (CTA)**: Lời kêu gọi hành động ở cuối video có rõ ràng không? Đề xuất cách viết CTA kích thích người xem bình luận, chia sẻ hoặc thả tim nhiều hơn.
5. **Yếu tố Viral Triggers (Điểm kích hoạt lan tỏa)**: Video đã chạm tới những cảm xúc/tâm lý nào của người xem (giải trí, tò mò, đồng cảm, giá trị thực tế...)?
6. **Đề xuất cải tiến cụ thể (Actionable Advice)**: Các bước cụ thể và thiết thực để tối ưu lại kịch bản, góc quay, nhịp điệu nhằm tối đa hóa tỷ lệ giữ chân người xem (Retention rate).

Định dạng đầu ra: Hãy viết bằng Markdown thật đẹp mắt, sử dụng các tiêu đề rõ ràng, gạch đầu dòng ngắn gọn và các khối chú thích (Blockquotes) nếu cần thiết để tăng tính thẩm mỹ.`;

    const analysis = await generateContentWithFallback(apiKey, prompt, null, { apiBaseUrl, customModel });
    console.log('Analysis completed successfully.');
    
    res.json({ success: true, analysis });

  } catch (error) {
    console.error('Error during analysis:', error);
    res.status(500).json({ error: 'Failed to analyze video', details: error.message });
  }
});

// Endpoint to diagnose Gemini API Key and list available models
app.post('/api/diagnose-gemini', async (req, res) => {
  const clientGeminiKey = req.headers['x-gemini-key'];
  const apiKey = clientGeminiKey || process.env.GEMINI_API_KEY;
  const apiBaseUrl = req.headers['x-api-base-url'] || '';
  const customModel = req.headers['x-custom-model'] || '';

  if (!apiKey) {
    return res.status(400).json({ error: 'Vui lòng cung cấp Gemini API Key' });
  }

  const isOpenAI = apiKey.startsWith('sk-') || 
                    (apiBaseUrl && (
                      apiBaseUrl.toLowerCase().includes('openai') || 
                      apiBaseUrl.toLowerCase().includes('openrouter') || 
                      apiBaseUrl.toLowerCase().includes('groq') || 
                      apiBaseUrl.toLowerCase().includes('deepseek')
                    ));

  if (isOpenAI) {
    try {
      const baseUrl = apiBaseUrl || 'https://api.openai.com/v1';
      const cleanBaseUrl = baseUrl.replace(/\/$/, '');
      console.log(`Diagnosing OpenAI-compatible API Key on ${cleanBaseUrl}...`);

      let models = [];
      try {
        const response = await fetch(`${cleanBaseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const data = await response.json();
        if (response.ok && data.data) {
          models = data.data.map(m => m.id);
        }
      } catch (err) {
        console.warn('Failed to fetch models list, using default/custom model:', err.message);
      }

      if (models.length === 0) {
        models = [customModel || 'gpt-4o-mini', 'whisper-1'];
      }

      let quotaStatus = 'active';
      let quotaError = null;
      try {
        const testResponse = await fetch(`${cleanBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: customModel || models[0] || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Hi' }]
          })
        });
        const testData = await testResponse.json();
        if (!testResponse.ok) {
          throw new Error(testData.error?.message || JSON.stringify(testData));
        }
      } catch (err) {
        quotaStatus = 'error';
        quotaError = err.message;
      }

      return res.json({
        success: true,
        models,
        quotaStatus,
        quotaError
      });
    } catch (error) {
      console.error('Error diagnosing OpenAI key:', error);
      return res.status(500).json({ error: 'Lỗi chuẩn đoán', details: error.message });
    }
  }

  try {
    console.log('Diagnosing Gemini API Key...');
    const url = `${apiBaseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models?key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.error?.message || 'Lỗi từ Google API',
        details: data.error
      });
    }

    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));

    let quotaStatus = 'active';
    let quotaError = null;
    const testModel = customModel || 
                      (models.includes('gemini-2.5-flash') ? 'gemini-2.5-flash' : 
                       models.includes('gemini-2.0-flash') ? 'gemini-2.0-flash' : 
                       models.includes('gemini-1.5-flash') ? 'gemini-1.5-flash' : 
                       models[0]);

    if (testModel) {
      try {
        await generateContentWithFallback(apiKey, 'Hi', null, { apiBaseUrl, customModel: testModel });
      } catch (err) {
        quotaStatus = 'error';
        quotaError = err.message;
      }
    } else {
      quotaStatus = 'error';
      quotaError = 'Không tìm thấy model nào khả dụng cho API Key này.';
    }

    res.json({
      success: true,
      models,
      quotaStatus,
      quotaError
    });
  } catch (error) {
    console.error('Error diagnosing Gemini key:', error);
    res.status(500).json({ error: 'Lỗi chuẩn đoán', details: error.message });
  }
});

// Endpoint to optimize/rewrite TikTok script based on transcript and analysis
app.post('/api/optimize-script', async (req, res) => {
  const { script, analysis } = req.body;
  const clientGeminiKey = req.headers['x-gemini-key'];
  const apiKey = clientGeminiKey || process.env.GEMINI_API_KEY;
  const apiBaseUrl = req.headers['x-api-base-url'] || '';
  const customModel = req.headers['x-custom-model'] || '';

  if (!script) {
    return res.status(400).json({ error: 'Kịch bản gốc là bắt buộc' });
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'Gemini API Key is required. Please set it in Settings.' });
  }

  try {
    console.log('Optimizing script using Gemini...');
    const prompt = `Bạn là một chuyên gia sáng tạo nội dung TikTok triệu view và viết kịch bản quảng cáo/thu hút hàng đầu.
Dưới đây là kịch bản gốc và phân tích của một video TikTok thành công:

--- KỊCH BẢN GỐC ---
${script}

--- PHÂN TÍCH VIDEO ---
${analysis || 'Chưa có phân tích'}

Nhiệm vụ của bạn: Hãy viết lại một kịch bản TikTok mới tối ưu nhất dựa trên kịch bản gốc này. Kịch bản mới cần đạt được các yếu tố sau:
1. Giữ nguyên giá trị cốt lõi/thông điệp chính của video gốc.
2. Viết lại phần Mở đầu (Hook) cực kỳ cuốn hút trong 3 giây đầu tiên để giữ chân người xem.
3. Tối ưu hóa cấu trúc nội dung (Body) mạch lạc, nhịp độ nhanh, kịch tính, dễ theo dõi.
4. Thêm phần Kêu gọi hành động (CTA) rõ ràng ở cuối để tăng tương tác (thả tim, bình luận, share hoặc click link).
5. Chia rõ cấu trúc kịch bản theo dạng bảng hoặc phân đoạn rõ ràng bao gồm: [Thời gian] | [Hình ảnh/Hành động diễn tả trên video] | [Lời thoại nói (Voiceover)].

Không giải thích dài dòng, hãy trả về kịch bản tối ưu mới một cách chi tiết bằng tiếng Việt.`;

    const optimizedScript = await generateContentWithFallback(apiKey, prompt, null, { apiBaseUrl, customModel });
    res.json({ success: true, optimizedScript });
  } catch (error) {
    console.error('Error optimizing script:', error);
    res.status(500).json({ error: 'Failed to optimize script', details: error.message });
  }
});

// Serves the client static build for single-port deployment
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Server is running. Please run npm run build to generate static frontend files.');
  }
});

app.listen(PORT, () => {
  console.log(`Backend server is running on port ${PORT}`);
  // Run yt-dlp check and update on startup to ensure latest extractor logic
  ytdlp.ensureYtDlp()
    .then(() => ytdlp.updateYtDlp())
    .then(() => console.log('yt-dlp is ready and up to date.'))
    .catch(err => console.error('Error pre-checking yt-dlp:', err));
});

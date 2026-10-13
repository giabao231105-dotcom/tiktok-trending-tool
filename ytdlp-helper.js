const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const binDir = path.join(__dirname, 'bin');
const isWindows = process.platform === 'win32';
const binName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const ytdlpPath = path.join(binDir, binName);
const ytdlpUrl = isWindows 
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

// Helper to ensure bin directory exists and download yt-dlp if missing
async function ensureYtDlp() {
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  if (fs.existsSync(ytdlpPath)) {
    console.log(`${binName} is already present.`);
    if (!isWindows) {
      try { fs.chmodSync(ytdlpPath, 0755); } catch {}
    }
    return ytdlpPath;
  }

  console.log(`${binName} not found. Downloading from ${ytdlpUrl}...`);
  try {
    const response = await fetch(ytdlpUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const fileStream = fs.createWriteStream(ytdlpPath);
    const reader = response.body.getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(Buffer.from(value));
    }
    
    fileStream.end();
    
    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    if (!isWindows) {
      fs.chmodSync(ytdlpPath, 0755);
    }
    
    console.log(`${binName} downloaded successfully.`);
    return ytdlpPath;
  } catch (error) {
    console.error('Failed to download yt-dlp.exe:', error);
    if (fs.existsSync(ytdlpPath)) {
      try { fs.unlinkSync(ytdlpPath); } catch {}
    }
    throw error;
  }
}

// Function to update yt-dlp to latest version
function updateYtDlp() {
  return new Promise(async (resolve) => {
    try {
      const executable = await ensureYtDlp();
      console.log('Checking and updating yt-dlp to latest version...');
      exec(`"${executable}" -U`, (error, stdout, stderr) => {
        console.log('yt-dlp update log:', (stdout || stderr || '').trim());
        resolve(true);
      });
    } catch (e) {
      console.warn('Update yt-dlp failed:', e.message);
      resolve(false);
    }
  });
}

// Generic execution function with automatic self-healing retry on extractor errors
function execYtDlp(args, proxy = null, retryOnUpdate = true) {
  return new Promise(async (resolve, reject) => {
    try {
      const executable = await ensureYtDlp();
      let cmd = `"${executable}" ${args.join(' ')}`;
      if (proxy) {
        cmd += ` --proxy "${proxy}"`;
      }
      
      console.log(`Running yt-dlp command: ${cmd}`);
      exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
        if (error) {
          const errMsg = (stderr || error.message || '').toLowerCase();
          // If error is related to extractor changes or secondary user ID, auto-update and retry
          if (retryOnUpdate && (errMsg.includes('unable to extract') || errMsg.includes('impersonat') || errMsg.includes('extractor') || errMsg.includes('secondary user id'))) {
            console.log('Detected yt-dlp extractor issue. Attempting auto-update and retrying command...');
            await updateYtDlp();
            try {
              const retryRes = await execYtDlp(args, proxy, false);
              return resolve(retryRes);
            } catch (retryErr) {
              return resolve({ success: false, stdout, stderr: retryErr.message, error: retryErr });
            }
          }
          resolve({ success: false, stdout, stderr, error });
        } else {
          resolve({ success: true, stdout, stderr });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Fetch videos list from a channel
async function getChannelVideos(channelUrl, limit = 10, proxy = null) {
  const args = ['--no-warnings'];
  if (limit && limit !== 'all' && parseInt(limit) > 0) {
    args.push(`--playlist-end ${limit}`);
  }
  args.push('--flat-playlist', '-j', `"${channelUrl}"`);
  
  const result = await execYtDlp(args, proxy);
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to fetch channel videos');
  }
  
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const videos = lines.map(line => {
    try {
      const data = JSON.parse(line);
      return {
        id: data.id,
        title: data.title,
        url: `https://www.tiktok.com/@${data.uploader || 'user'}/video/${data.id}`,
        thumbnail: data.thumbnails?.[0]?.url || data.thumbnail || null,
        duration: data.duration || null,
        viewCount: data.view_count || null,
        uploader: data.uploader || null,
        uploader_id: data.uploader_id || null
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  
  return videos;
}

// Fetch details of a single video
async function getVideoInfo(videoUrl, proxy = null) {
  const args = [
    '-j',
    `"${videoUrl}"`
  ];
  
  const result = await execYtDlp(args, proxy);
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to fetch video info');
  }
  
  try {
    const data = JSON.parse(result.stdout);
    return data;
  } catch (err) {
    throw new Error('Failed to parse video info JSON');
  }
}

// Download the best audio file to a temporary location
async function downloadAudio(videoUrl, outputPath, proxy = null) {
  const args = [
    '-f ba', // best audio
    '-o', `"${outputPath}"`,
    `"${videoUrl}"`
  ];
  
  const result = await execYtDlp(args, proxy);
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to download audio');
  }
  return outputPath;
}

module.exports = {
  ensureYtDlp,
  updateYtDlp,
  getChannelVideos,
  getVideoInfo,
  downloadAudio
};

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('Error: GEMINI_API_KEY is not defined in the environment.');
  process.exit(1);
}

const musicUrl = 'https://v19-ies-music.tiktokcdn-us.com/281b52811a99460155a85ae4e7571f17/6a67305b/video/tos/alisg/tos-alisg-ve-2774/owfMgHDgvYnDFohFSQfBZRFLU8uz09tECEB0WQ/?a=583965&bti=OUBzOTg7QGo6OjZAL3AjLTAzYCMxNDNg&&bt=63&ft=4KUr5M9h8Zmo0t-ZRa4jVizqinWrKsd.&mime_type=audio_mp4&rc=aDdnODY7aTdnZmY0OzMzNkBpM3E8PHg5cmt3djMzODlkNEBjYjQvMzMxXl8xNC4yX15jYSNhLmQxMmRjL2NgLS1kYS1zcw%3D%3D&vvpl=1&l=2026072010100367B0730BE4A2280140A2&btag=e00098000&shp=d05b14bd&shcp=-';

function getMimeType(ext) {
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'audio/mp4';
}

async function runTest() {
  const tempFileBase = path.join(__dirname, `test_audio_${Date.now()}`);
  
  try {
    console.log('Downloading audio track...');
    const res = await fetch(musicUrl);
    console.log('Download Status:', res.status, res.statusText);
    const contentType = res.headers.get('content-type') || '';
    console.log('Content-Type header:', contentType);
    
    let ext = '.mp3';
    if (contentType.includes('mp4') || contentType.includes('m4a')) {
      ext = '.m4a';
    }
    
    const finalPath = tempFileBase + ext;
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(finalPath, Buffer.from(buffer));
    console.log(`Audio saved to: ${finalPath} (${buffer.byteLength} bytes)`);
    
    const base64Audio = Buffer.from(buffer).toString('base64');
    const mimeType = getMimeType(ext);
    console.log(`MimeType used for Gemini: ${mimeType}`);
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    
    const prompt = 'Hãy chép lại lời thoại (transcribe) trong đoạn âm thanh này một cách chính xác từng từ bằng tiếng Việt (hoặc ngôn ngữ gốc của người nói). Đảm bảo giữ nguyên các từ lóng, biểu cảm nói nếu có. Không cần giải thích thêm, chỉ trả về nội dung chép lời thoại.';
    
    for (const modelName of models) {
      try {
        console.log(`\n--- Testing model: ${modelName} ---`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          {
            inlineData: {
              data: base64Audio,
              mimeType: mimeType
            }
          },
          prompt
        ]);
        console.log(`Success! Response text:`);
        console.log(result.response.text());
      } catch (err) {
        console.error(`Error for ${modelName}:`, err.message);
      }
    }
    
    // Cleanup
    fs.unlinkSync(finalPath);
  } catch (err) {
    console.error('Error during run:', err);
  }
}

runTest();

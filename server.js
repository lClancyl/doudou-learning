// 讯飞 TTS 代理服务器
// 提供静态页面 + 代理 /api/tts/iflytek 到讯飞 WebSocket API

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const IFLYTEK = {
  appId: '0fe945a4',
  apiKey: '45a3200a4560187742b106225270d615',
  apiSecret: 'N2ZhNjQ2NmMxOWM3NTMwZmM4ZmJlNzQw',
  host: 'tts-api.xfyun.cn',
  path: '/v2/tts'
};
const PORT = 3000;
const TIMEOUT = 15000;

/** 生成讯飞 WebSocket 鉴权 URL */
function getIflytekAuthUrl() {
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${IFLYTEK.host}\ndate: ${date}\nGET ${IFLYTEK.path} HTTP/1.1`;
  const signatureSha = crypto.createHmac('sha256', IFLYTEK.apiSecret).update(signatureOrigin).digest();
  const signature = signatureSha.toString('base64');
  const authOrigin = `api_key="${IFLYTEK.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authOrigin).toString('base64');

  return `wss://${IFLYTEK.host}${IFLYTEK.path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${IFLYTEK.host}`;
}

/** 调用讯飞 WebSocket API 合成语音，返回 MP3 Buffer */
function synthesis(text, vcn) {
  return new Promise((resolve, reject) => {
    const url = getIflytekAuthUrl();
    const ws = new WebSocket(url);
    const chunks = [];
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error('TTS timeout')); }
    }, TIMEOUT);

    ws.onopen = () => {
      const payload = {
        common: { app_id: IFLYTEK.appId },
        business: {
          aue: 'lame',
          sfl: 1,
          auf: 'audio/L16;rate=16000',
          vcn: vcn || 'x4_yezi',
          speed: 50,
          volume: 70,
          pitch: 50,
          tte: 'UTF8'
        },
        data: {
          status: 2,
          text: Buffer.from(text, 'utf8').toString('base64')
        }
      };
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const resp = JSON.parse(event.data.toString());
        if (resp.code !== 0) {
          clearTimeout(timer);
          if (!done) { done = true; ws.close(); reject(new Error(`讯飞错误 ${resp.code}: ${resp.message || '未知'}`)); }
          return;
        }
        if (resp.data && resp.data.audio) {
          chunks.push(Buffer.from(resp.data.audio, 'base64'));
        }
        if (resp.data && resp.data.status === 2) {
          clearTimeout(timer);
          if (!done) {
            done = true;
            ws.close();
            resolve(Buffer.concat(chunks));
          }
        }
      } catch (err) {
        clearTimeout(timer);
        if (!done) { done = true; ws.close(); reject(err); }
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      if (!done) { done = true; reject(new Error('WebSocket 连接失败')); }
    };

    ws.onclose = () => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        if (chunks.length > 0) resolve(Buffer.concat(chunks));
        else reject(new Error('未收到音频数据'));
      }
    };
  });
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // TTS 代理
  if (url.pathname === '/api/tts/iflytek' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { text, vcn } = JSON.parse(body);
        if (!text || !text.trim()) throw new Error('Missing text');
        console.log(`[TTS] "${text.slice(0, 40)}" vcn=${vcn || 'x4_yezi'}`);
        const audio = await synthesis(text.trim(), vcn);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.writeHead(200);
        res.end(audio);
        console.log(`[TTS] OK ${audio.length} bytes`);
      } catch (err) {
        console.error(`[TTS] FAIL: ${err.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 静态文件
  let filePath = path.join(__dirname, url.pathname === '/' ? 'index.html' : url.pathname);
  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', `${mime}; charset=utf-8`);
    res.writeHead(200);
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`✅ 豆豆学习 TTS 服务器已启动`);
  console.log(`   打开浏览器访问 → http://localhost:${PORT}`);
  console.log(`   按 Ctrl+C 停止`);
});

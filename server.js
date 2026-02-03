const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');

const app = express();

// ================= CONFIG =================
const PORT = process.env.PORT || 10000;
const HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
const RENDER_URL = `https://${HOSTNAME}`;

// ================= PROXY SETUP =================
const proxy = createProxyMiddleware({
  target: 'https://api.revenuecat.com',
  changeOrigin: true,
  secure: false,
  selfHandleResponse: true,
  onProxyReq: (proxyReq, req, res) => {
    proxyReq.setHeader('Host', 'api.revenuecat.com');
    console.log(`Proxying: ${req.method} ${req.url}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    let body = [];
    
    proxyRes.on('data', (chunk) => {
      body.push(chunk);
    });
    
    proxyRes.on('end', () => {
      try {
        const contentType = proxyRes.headers['content-type'] || '';
        const isRevenueCat = req.url.includes('/receipts') || req.url.includes('/subscribers');
        
        if (contentType.includes('application/json') && isRevenueCat) {
          const data = JSON.parse(Buffer.concat(body).toString());
          
          // UNLOCK LOGIC
          if (data.subscriber) {
            data.subscriber.entitlements = {
              "pro": {
                "expires_date": "2099-12-31T23:59:59Z",
                "product_identifier": "locket_pro_lifetime",
                "purchase_date": "2024-01-01T00:00:00Z"
              }
            };
            
            data.subscriber.subscriptions = {
              "locket_pro_lifetime": {
                "expires_date": "2099-12-31T23:59:59Z",
                "original_purchase_date": "2024-01-01T00:00:00Z"
              }
            };
          }
          
          const newBody = JSON.stringify(data);
          res.setHeader('Content-Type', 'application/json');
          res.end(newBody);
        } else {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(Buffer.concat(body));
        }
      } catch (error) {
        res.writeHead(500);
        res.end('Error');
      }
    });
  }
});

// ================= ROUTES =================

// 1. HEALTH CHECK - PHẢI ĐẶT TRƯỚC PROXY
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'locket-unlock',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 2. PAC FILE
app.get('/proxy.pac', (req, res) => {
  const pac = `function FindProxyForURL(url, host) {
    if (shExpMatch(host, "api.revenuecat.com") || 
        shExpMatch(host, "*.revenuecat.com")) {
      return "PROXY ${HOSTNAME}:${PORT}; DIRECT";
    }
    return "DIRECT";
  }`;
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pac);
});

// 3. INSTALL PAGE - QUAN TRỌNG NHẤT
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro Unlock</title>
    <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; background: #f0f2f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #667eea; text-align: center; }
        .step { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 15px 0; border-left: 4px solid #667eea; }
        .code { background: #2d3748; color: white; padding: 15px; border-radius: 8px; font-family: monospace; word-break: break-all; }
        .btn { background: #667eea; color: white; padding: 15px; border: none; border-radius: 10px; font-size: 16px; width: 100%; margin: 10px 0; cursor: pointer; }
        .btn:hover { background: #764ba2; }
        .btn-copy { background: #38a169; }
        .status { padding: 15px; background: #e9ecef; border-radius: 8px; text-align: center; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro Unlock</h1>
        
        <div class="step">
            <h3>1. Open Wi-Fi Settings</h3>
            <p>Go to <strong>Settings → Wi-Fi</strong></p>
        </div>
        
        <div class="step">
            <h3>2. Configure Proxy</h3>
            <p>Tap <strong>ⓘ</strong> next to your network</p>
            <p>Scroll to <strong>Configure Proxy → Auto</strong></p>
        </div>
        
        <div class="step">
            <h3>3. Enter PAC URL</h3>
            <div class="code" id="pacUrl">https://${HOSTNAME}/proxy.pac</div>
            <button class="btn btn-copy" onclick="copyUrl()">📋 Copy URL</button>
            <p id="copyStatus"></p>
            <p>Paste this URL into the field</p>
        </div>
        
        <div class="step">
            <h3>4. Save & Test</h3>
            <p>Tap <strong>Save</strong> then open Locket app</p>
            <p>All Pro features should be unlocked! ✅</p>
        </div>
        
        <div class="status">
            <p>Server: <strong>${HOSTNAME}</strong></p>
            <p>Status: <span id="serverStatus">✅ Online</span></p>
        </div>
        
        <p style="text-align: center; color: #666; font-size: 14px;">
            Need help? Make sure proxy is enabled in Wi-Fi settings.
        </p>
    </div>

    <script>
        function copyUrl() {
            const url = document.getElementById('pacUrl').textContent;
            const status = document.getElementById('copyStatus');
            
            // Create temp element
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                status.textContent = '✅ Copied!';
                status.style.color = '#38a169';
            } catch (err) {
                status.textContent = '❌ Please copy manually';
                status.style.color = '#e53e3e';
            }
            
            document.body.removeChild(textArea);
            
            // Clear status
            setTimeout(() => {
                status.textContent = '';
            }, 3000);
        }
    </script>
</body>
</html>`;
  
  res.send(html);
});

// 4. TEST ENDPOINT
app.get('/test', (req, res) => {
  res.json({
    message: 'Locket Proxy is working!',
    endpoints: ['/health', '/proxy.pac', '/install', '/test'],
    version: '2.0.0'
  });
});

// 5. PROXY ALL OTHER TRAFFIC TO REVENUECAT
// QUAN TRỌNG: ĐẶT SAU TẤT CẢ CÁC ROUTE KHÁC
app.use('/', proxy);

// 6. 404 HANDLER
app.use((req, res) => {
  res.redirect('/install');
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`
🚀 Locket Proxy Server Started
─────────────────────────────
📡 Port: ${PORT}
🌐 URL: ${RENDER_URL}
📱 Install: ${RENDER_URL}/install
📄 PAC: ${RENDER_URL}/proxy.pac
❤️ Health: ${RENDER_URL}/health
─────────────────────────────
✅ Ready to unlock Locket Pro!
  `);
  
  // Keep alive ping
  setInterval(() => {
    https.get(`${RENDER_URL}/health`, () => {
      console.log('🔄 Keep-alive ping sent');
    }).on('error', () => {
      console.log('⚠️ Ping failed (server may be starting)');
    });
  }, 300000); // 5 minutes
});

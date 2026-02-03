const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

// ================= CONFIG =================
const PORT = process.env.PORT || 10000;
const HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';

// ================= LOCKET UNLOCK LOGIC (FROM SHADOWROCKET SCRIPT) =================
const applyLocketUnlock = (data) => {
  console.log('🔧 Applying Locket unlock logic from Shadowrocket script...');
  
  // Từ script gốc Locket_Gold.js
  const locket02 = {
    is_sandbox: false,
    ownership_type: "PURCHASED",
    billing_issues_detected_at: null,
    period_type: "normal",
    expires_date: "2099-12-18T01:04:17Z",
    grace_period_expires_date: null,
    unsubscribe_detected_at: null,
    original_purchase_date: "2024-09-12T01:04:18Z",
    purchase_date: "2024-09-12T01:04:17Z",
    store: "app_store"
  };
  
  const locket01 = {
    grace_period_expires_date: null,
    purchase_date: "2024-09-12T01:04:17Z",
    product_identifier: "com.locket02.premium.yearly",
    expires_date: "2099-12-18T01:04:17Z"
  };
  
  // Đảm bảo subscriber object tồn tại
  if (!data.subscriber) {
    data.subscriber = {
      original_app_user_id: "locket_pro_user",
      original_application_version: "2.31.0",
      original_purchase_date: "2024-09-12T01:04:18Z",
      first_seen: "2024-09-12T01:04:18Z",
      last_seen: new Date().toISOString(),
      management_url: "https://apps.apple.com/account/subscriptions",
      non_subscriptions: {},
      entitlements: {},
      subscriptions: {},
      all_purchased_product_identifiers: []
    };
  }
  
  // Áp dụng unlock logic CHÍNH XÁC như script gốc
  data.subscriber.subscriptions = data.subscriber.subscriptions || {};
  data.subscriber.entitlements = data.subscriber.entitlements || {};
  
  // 1. Subscription (com.locket02.premium.yearly)
  data.subscriber.subscriptions["com.locket02.premium.yearly"] = locket02;
  
  // 2. Pro Entitlement
  data.subscriber.entitlements.pro = locket01;
  
  // 3. Gold Entitlement (tùy chọn)
  data.subscriber.entitlements.Gold = {
    ...locket01,
    product_identifier: "Gold"
  };
  
  // 4. All purchased products
  data.subscriber.all_purchased_product_identifiers = [
    "com.locket02.premium.yearly",
    "com.locket02.premium.monthly",
    "com.locket02.gold.yearly"
  ];
  
  // 5. Add Attention message từ script gốc
  data.Attention = "Chúc mừng bạn! Vui lòng không bán hoặc chia sẻ cho người khác!";
  
  // 6. Request dates
  data.request_date = new Date().toISOString();
  data.request_date_ms = Date.now();
  
  console.log('✅ Locket unlock applied successfully!');
  console.log('📦 Subscription:', data.subscriber.subscriptions["com.locket02.premium.yearly"]);
  console.log('🎯 Entitlements:', Object.keys(data.subscriber.entitlements));
  
  return data;
};

// ================= PROXY MIDDLEWARE =================
const proxy = createProxyMiddleware({
  target: 'https://api.revenuecat.com',
  changeOrigin: true,
  secure: false,
  selfHandleResponse: true,
  
  onProxyReq: (proxyReq, req, res) => {
    // Set RevenueCat headers
    proxyReq.setHeader('Host', 'api.revenuecat.com');
    proxyReq.setHeader('X-Platform', 'ios');
    proxyReq.setHeader('X-Platform-Version', '17.0');
    
    // Copy User-Agent để detect Locket app
    if (req.headers['user-agent']) {
      console.log('📱 User-Agent:', req.headers['user-agent'].substring(0, 100));
    }
    
    // Remove X-RevenueCat-ETag (từ deleteheader.js)
    proxyReq.removeHeader('X-RevenueCat-ETag');
    proxyReq.removeHeader('x-revenuecat-etag');
    
    console.log(`📤 Proxying: ${req.method} ${req.url}`);
  },
  
  onProxyRes: (proxyRes, req, res) => {
    let body = [];
    
    proxyRes.on('data', (chunk) => {
      body.push(chunk);
    });
    
    proxyRes.on('end', () => {
      try {
        const contentType = proxyRes.headers['content-type'] || '';
        const isRevenueCat = req.url.includes('revenuecat') || 
                           req.url.includes('/v1/') ||
                           req.url.includes('/receipts') ||
                           req.url.includes('/subscribers');
        
        if (isRevenueCat && contentType.includes('application/json') && body.length > 0) {
          const fullBody = Buffer.concat(body).toString();
          console.log(`🎯 Intercepting RevenueCat API: ${req.url}`);
          
          let data;
          try {
            data = JSON.parse(fullBody);
          } catch (e) {
            console.log('❌ Invalid JSON, passing through');
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(Buffer.concat(body));
            return;
          }
          
          // Áp dụng unlock logic
          const unlockedData = applyLocketUnlock(data);
          
          const newBody = JSON.stringify(unlockedData);
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Length', Buffer.byteLength(newBody));
          res.end(newBody);
          
        } else {
          // Pass through
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(Buffer.concat(body));
        }
      } catch (error) {
        console.error('❌ Error:', error);
        res.writeHead(500);
        res.end('Proxy Error');
      }
    });
  }
});

// ================= ROUTES =================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'locket-proxy-v2.31.0',
    version: '2.31.0',
    timestamp: new Date().toISOString(),
    unlock: 'active (from Shadowrocket script)'
  });
});

// PAC file
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

// Install page với hướng dẫn manual proxy
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro/Gold Unlock v2.31.0</title>
    <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; background: #f0f2f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 25px; border-radius: 15px; box-shadow: 0 5px 15px rgba(0,0,0,0.1); }
        h1 { color: #667eea; text-align: center; }
        .step { background: #f8f9fa; padding: 20px; border-radius: 10px; margin: 15px 0; border-left: 4px solid #667eea; }
        .code { background: #2d3748; color: white; padding: 15px; border-radius: 8px; font-family: monospace; }
        .btn { background: #667eea; color: white; padding: 15px; border: none; border-radius: 10px; width: 100%; margin: 10px 0; cursor: pointer; }
        .btn-copy { background: #38a169; }
        .status { padding: 15px; background: #e9ecef; border-radius: 8px; text-align: center; }
        .success { background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin: 15px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro/Gold Unlock v2.31.0</h1>
        
        <div class="success">
            <h3>✅ Using Official Shadowrocket Script</h3>
            <p>This proxy uses the exact same unlock logic as Shadowrocket.</p>
        </div>
        
        <div class="step">
            <h3>Manual Proxy Setup (Recommended)</h3>
            <p><strong>Settings → Wi-Fi → ⓘ → Configure Proxy → Manual</strong></p>
            <div class="code">Server: ${HOSTNAME}<br>Port: 443</div>
            <button class="btn btn-copy" onclick="copyConfig()">📋 Copy Config</button>
            <p id="copyStatus"></p>
        </div>
        
        <div class="step">
            <h3>Or Use Auto PAC</h3>
            <p><strong>Configure Proxy → Auto</strong></p>
            <div class="code">${HOSTNAME}/proxy.pac</div>
        </div>
        
        <div class="step">
            <h3>Test Connection</h3>
            <button class="btn" onclick="testServer()">Test Server</button>
            <button class="btn" onclick="testUnlock()">Test Unlock</button>
        </div>
        
        <div class="status">
            <p>Status: <span id="serverStatus">Checking...</span></p>
            <p>Version: 2.31.0 (from Shadowrocket script)</p>
        </div>
        
        <div style="text-align: center; color: #666; margin-top: 30px;">
            <p>Unlocks: Pro + Gold entitlements</p>
            <p>Expires: 2099-12-18</p>
        </div>
    </div>

    <script>
        function copyConfig() {
            const config = \`Server: ${HOSTNAME}\\nPort: 443\`;
            const status = document.getElementById('copyStatus');
            
            const textArea = document.createElement('textarea');
            textArea.value = config;
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
            
            setTimeout(() => {
                status.textContent = '';
            }, 3000);
        }
        
        function testServer() {
            const status = document.getElementById('serverStatus');
            status.textContent = 'Testing...';
            
            fetch('/health')
                .then(r => r.json())
                .then(data => {
                    status.textContent = \`✅ \${data.status} (v\${data.version})\`;
                    status.style.color = '#38a169';
                })
                .catch(err => {
                    status.textContent = '❌ Server error';
                    status.style.color = '#e53e3e';
                });
        }
        
        function testUnlock() {
            fetch('/test-unlock')
                .then(r => r.json())
                .then(data => {
                    alert(\`✅ Unlock Test Successful!\\nPro: \${data.subscriber?.entitlements?.pro ? 'YES' : 'NO'}\\nGold: \${data.subscriber?.entitlements?.Gold ? 'YES' : 'NO'}\`);
                })
                .catch(err => {
                    alert('❌ Unlock test failed');
                });
        }
        
        // Auto test on load
        window.onload = testServer;
    </script>
</body>
</html>`;
  
  res.send(html);
});

// Test unlock endpoint
app.get('/test-unlock', (req, res) => {
  const testData = {
    request_date_ms: Date.now(),
    request_date: new Date().toISOString()
  };
  
  const unlockedData = applyLocketUnlock(testData);
  res.json(unlockedData);
});

// Simulate RevenueCat API endpoint
app.post('/v1/receipts', (req, res) => {
  console.log('🧾 Simulating RevenueCat /v1/receipts');
  
  const testData = {
    request_date_ms: Date.now(),
    request_date: new Date().toISOString(),
    subscriber: {
      original_app_user_id: req.body?.app_user_id || 'locket_user'
    }
  };
  
  const unlockedData = applyLocketUnlock(testData);
  res.json(unlockedData);
});

// Apply proxy (MUST BE LAST)
app.use('/', proxy);

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 LOCKET PROXY v2.31.0 (Shadowrocket Script)
─────────────────────────────
📡 Port: ${PORT}
🌐 URL: https://${HOSTNAME}
📱 Install: https://${HOSTNAME}/install
📄 PAC: https://${HOSTNAME}/proxy.pac
❤️ Health: https://${HOSTNAME}/health
🧪 Test: https://${HOSTNAME}/test-unlock
─────────────────────────────
🔧 Using official Shadowrocket unlock logic
✅ Pro + Gold entitlements
⏰ Expires: 2099-12-18
─────────────────────────────
  `);
  
  // Keep alive
  setInterval(() => {
    require('https').get(`https://${HOSTNAME}/health`, () => {
      console.log('🔄 Keep-alive ping');
    }).on('error', () => {});
  }, 300000);
});

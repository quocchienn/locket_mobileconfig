const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const crypto = require('crypto');

const app = express();

// ================= CONFIG =================
const CONFIG = {
  PORT: process.env.PORT || 10000,
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost',
  TARGET: 'https://api.revenuecat.com'
};

// ================= PROXY MIDDLEWARE =================
const proxy = createProxyMiddleware({
  target: CONFIG.TARGET,
  changeOrigin: true,
  secure: false,
  selfHandleResponse: true,
  onProxyReq: (proxyReq, req, res) => {
    proxyReq.setHeader('Host', 'api.revenuecat.com');
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
        const isRevenueCat = req.url.includes('/receipts') || 
                           req.url.includes('/subscribers') ||
                           req.url.includes('/v1/subscribers');
        
        if (contentType.includes('application/json') && isRevenueCat) {
          const data = JSON.parse(Buffer.concat(body).toString());
          
          // ============ UNLOCK LOGIC ============
          if (data.subscriber) {
            // 1. Modify entitlements
            data.subscriber.entitlements = {
              "pro": {
                "expires_date": "2099-12-31T23:59:59Z",
                "grace_period_expires_date": null,
                "product_identifier": "locket_pro_lifetime",
                "purchase_date": "2024-01-01T00:00:00Z"
              },
              "gold": {
                "expires_date": "2099-12-31T23:59:59Z",
                "product_identifier": "locket_gold_yearly",
                "purchase_date": "2024-01-01T00:00:00Z"
              }
            };

            // 2. Modify subscriptions
            data.subscriber.subscriptions = {
              "locket_pro_lifetime": {
                "auto_resume_date": null,
                "billing_issues_detected_at": null,
                "expires_date": "2099-12-31T23:59:59Z",
                "grace_period_expires_date": null,
                "is_sandbox": false,
                "original_purchase_date": "2024-01-01T00:00:00Z",
                "ownership_type": "PURCHASED",
                "period_type": "normal",
                "purchase_date": "2024-01-01T00:00:00Z",
                "refunded_at": null,
                "store": "app_store",
                "unsubscribe_detected_at": null,
                "store_transaction_id": `RC${Date.now()}${Math.floor(Math.random() * 1000)}`
              }
            };

            // 3. Set all products as active
            data.subscriber.all_purchased_product_identifiers = [
              "locket_pro_lifetime",
              "locket_pro_yearly",
              "locket_pro_monthly",
              "locket_gold_yearly"
            ];

            // 4. Clear non-subscriptions
            data.subscriber.non_subscriptions = {};

            // 5. Set first purchase date
            data.subscriber.first_seen = "2024-01-01T00:00:00Z";
            
            // 6. Set management URL
            data.subscriber.management_url = "https://apps.apple.com/account/subscriptions";

            console.log(`✅ Modified response for: ${req.url}`);
          }
          
          const newBody = JSON.stringify(data);
          res.setHeader('Content-Type', 'application/json');
          res.end(newBody);
        } else {
          // Not RevenueCat JSON, pass through
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(Buffer.concat(body));
        }
      } catch (error) {
        console.error('❌ Error modifying response:', error);
        res.writeHead(500);
        res.end('Error processing response');
      }
    });
  }
});

// ================= ROUTES =================

// 1. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'locket-unlock-proxy',
    version: '2.0',
    timestamp: new Date().toISOString(),
    server: CONFIG.HOSTNAME,
    proxy_target: CONFIG.TARGET
  });
});

// 2. PAC (Proxy Auto-Config) file
app.get('/proxy.pac', (req, res) => {
  const pacScript = `function FindProxyForURL(url, host) {
    // Direct connection for local addresses
    if (isPlainHostName(host) ||
        shExpMatch(host, "*.local") ||
        isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0") ||
        isInNet(dnsResolve(host), "172.16.0.0", "255.240.0.0") ||
        isInNet(dnsResolve(host), "192.168.0.0", "255.255.0.0") ||
        isInNet(dnsResolve(host), "127.0.0.0", "255.0.0.0")) {
      return "DIRECT";
    }
    
    // Proxy only RevenueCat API
    if (shExpMatch(host, "*.revenuecat.com") ||
        shExpMatch(host, "api.revenuecat.com") ||
        shExpMatch(host, "*.purchases-api.io")) {
      return "PROXY ${CONFIG.HOSTNAME}:${CONFIG.PORT}; DIRECT";
    }
    
    // All other traffic goes direct
    return "DIRECT";
  }`;
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pacScript);
  console.log('📄 Served PAC file');
});

// 3. Install page - Manual setup instructions (NO MOBILECONFIG)
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro Unlock Setup</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px;
            color: #333;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            color: #764ba2;
            text-align: center;
            font-size: 2.5em;
            margin-bottom: 30px;
        }
        .step {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 25px;
            margin: 25px 0;
            border-radius: 12px;
            position: relative;
        }
        .step-number {
            position: absolute;
            top: -15px;
            left: -15px;
            background: #667eea;
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.2em;
        }
        .screenshot {
            background: #e9ecef;
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            text-align: center;
            color: #666;
            font-style: italic;
        }
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            font-family: 'Courier New', monospace;
            overflow-x: auto;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 35px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.3em;
            margin: 20px 10px;
            text-align: center;
            transition: transform 0.3s;
            border: none;
            cursor: pointer;
        }
        .btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        .btn-secondary {
            background: #6c757d;
        }
        .btn-success {
            background: #28a745;
        }
        .btn-container {
            text-align: center;
            margin: 40px 0;
        }
        .copy-btn {
            background: #38a169;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            margin-top: 10px;
            font-size: 1em;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .copy-btn:hover {
            background: #2f855a;
        }
        .url-display {
            background: #f8f9fa;
            border: 2px dashed #667eea;
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            font-size: 1.1em;
            word-break: break-all;
        }
        @media (max-width: 768px) {
            .container {
                padding: 20px;
            }
            h1 {
                font-size: 2em;
            }
            .btn {
                display: block;
                margin: 10px auto;
                width: 90%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro Unlock Setup</h1>
        
        <div class="success">
            <strong>✅ No Profile Required!</strong> 
            iOS restrictions prevent automatic proxy profiles on personal devices.
            Follow these manual steps instead:
        </div>
        
        <div class="step">
            <div class="step-number">1</div>
            <h3>Open Wi-Fi Settings</h3>
            <p>Go to <strong>Settings → Wi-Fi</strong> on your iPhone</p>
            <div class="screenshot">
                📱 Make sure you're connected to Wi-Fi
            </div>
            <div class="btn-container">
                <button class="btn" onclick="window.location.href='App-Prefs:root=WIFI'">
                    🔗 Open Wi-Fi Settings Now
                </button>
            </div>
        </div>
        
        <div class="step">
            <div class="step-number">2</div>
            <h3>Configure Proxy Settings</h3>
            <p>Tap the <strong>ⓘ</strong> (info) icon next to your connected network</p>
            <p>Scroll down to <strong>"Configure Proxy"</strong> section</p>
            <div class="screenshot">
                ⚙️ Tap "Configure Proxy" (near the bottom)
            </div>
        </div>
        
        <div class="step">
            <div class="step-number">3</div>
            <h3>Select Auto Configuration</h3>
            <p>Tap <strong>"Auto"</strong> (not Manual or Off)</p>
            <div class="screenshot">
                🔄 Choose "Auto" configuration
            </div>
        </div>
        
        <div class="step">
            <div class="step-number">4</div>
            <h3>Enter PAC URL</h3>
            <p>Copy this exact URL and paste into the "URL" field:</p>
            <div class="url-display" id="pacUrl">
                https://locket-mobileconfig.onrender.com/proxy.pac
            </div>
            <button class="copy-btn" onclick="copyPACUrl()">
                📋 Copy PAC URL
            </button>
            <div class="screenshot">
                🌐 Paste URL exactly as shown above
            </div>
        </div>
        
        <div class="step">
            <div class="step-number">5</div>
            <h3>Save Configuration</h3>
            <p>Tap <strong>"Save"</strong> in the top right corner</p>
            <div class="screenshot">
                💾 Save the proxy settings
            </div>
        </div>
        
        <div class="step">
            <div class="step-number">6</div>
            <h3>Test Locket App</h3>
            <p>Open <strong>Locket app</strong> and check:</p>
            <div class="success">
                <strong>Expected results:</strong>
                <ul style="margin-top: 10px; margin-left: 20px;">
                    <li>✅ All Pro features unlocked</li>
                    <li>✅ No advertisements</li>
                    <li>✅ Gold/Premium badge visible</li>
                    <li>✅ Unlimited usage</li>
                </ul>
            </div>
            <div class="btn-container">
                <button class="btn btn-success" onclick="window.location.href='https://apps.apple.com/us/app/locket-widget/id1600528955'">
                    📲 Open Locket App
                </button>
            </div>
        </div>
        
        <div class="warning">
            <h3>🔧 Troubleshooting Guide:</h3>
            <p>If Locket doesn't unlock:</p>
            <ol style="margin-left: 20px; margin-top: 10px;">
                <li><strong>Restart Locket app</strong> completely (swipe up from app switcher)</li>
                <li><strong>Toggle Airplane Mode</strong>: Settings → Airplane Mode (ON, wait 5s, OFF)</li>
                <li><strong>Switch networks</strong>: Try Cellular data instead of Wi-Fi</li>
                <li><strong>Clear app cache</strong>: Settings → General → iPhone Storage → Locket → Offload App</li>
                <li><strong>Check server status</strong> below</li>
            </ol>
        </div>
        
        <div class="btn-container">
            <button class="btn btn-secondary" onclick="window.location.href='https://locket-mobileconfig.onrender.com/proxy.pac'">
                📄 View PAC File
            </button>
            <button class="btn btn-secondary" onclick="window.location.href='https://locket-mobileconfig.onrender.com/health'">
                ❤️ Check Server Status
            </button>
            <button class="btn btn-secondary" onclick="testProxy()">
                🧪 Test Proxy Connection
            </button>
        </div>
        
        <div style="text-align: center; margin-top: 40px; color: #666; font-size: 0.9em;">
            <p>Server: <strong>locket-mobileconfig.onrender.com</strong></p>
            <p>Status: <span id="status">Checking...</span></p>
            <p>Last Updated: <span id="timestamp">${new Date().toLocaleString()}</span></p>
        </div>
    </div>
    
    <script>
        // Check server status on load
        async function checkServerStatus() {
            try {
                const response = await fetch('https://locket-mobileconfig.onrender.com/health');
                const data = await response.json();
                
                document.getElementById('status').innerHTML = 
                    '<span style="color: #28a745;">✅ Online</span>';
                document.getElementById('timestamp').textContent = 
                    new Date(data.timestamp).toLocaleString();
                
                // Update status indicator
                document.title = '✅ Locket Setup - Server Online';
                
            } catch (error) {
                document.getElementById('status').innerHTML = 
                    '<span style="color: #dc3545;">❌ Offline - Server may be sleeping</span>';
                document.getElementById('timestamp').textContent = 'Unknown';
                
                // Show wake-up instructions
                const statusElement = document.getElementById('status');
                statusElement.innerHTML += '<br><small>Click "Check Server Status" to wake up server</small>';
            }
        }
        
        // Copy PAC URL to clipboard
        function copyPACUrl() {
            const text = document.getElementById('pacUrl').innerText;
            navigator.clipboard.writeText(text).then(() => {
                alert('✅ PAC URL copied to clipboard!\n\nNow go to:\nSettings → Wi-Fi → ⓘ → Configure Proxy → Auto\nPaste the URL and tap Save.');
            }).catch(err => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('✅ URL copied! Paste it in Wi-Fi proxy settings.');
            });
        }
        
        // Test proxy connection
        async function testProxy() {
            try {
                const response = await fetch('https://locket-mobileconfig.onrender.com/health');
                const data = await response.json();
                
                if (data.status === 'healthy') {
                    alert('✅ Proxy server is working perfectly!\n\nServer: ' + data.server + 
                          '\\nTarget: ' + data.proxy_target + 
                          '\\nVersion: ' + data.version);
                } else {
                    alert('⚠️ Server responded but status is not healthy');
                }
            } catch (error) {
                alert('❌ Cannot connect to proxy server. Possible issues:\\n\\n' +
                      '1. Server is sleeping (free tier limitation)\\n' +
                      '2. Network connection problem\\n' +
                      '3. Server may need to restart\\n\\n' +
                      'Try clicking "Check Server Status" to wake up the server.');
            }
        }
        
        // Open Wi-Fi settings (iOS only)
        function openWifiSettings() {
            // iOS URL scheme for Wi-Fi settings
            window.location.href = 'App-Prefs:root=WIFI';
            
            // Fallback instructions
            setTimeout(() => {
                alert('If Wi-Fi settings didn\'t open automatically:\\n\\n' +
                      '1. Manually go to Settings → Wi-Fi\\n' +
                      '2. Tap ⓘ next to your network\\n' +
                      '3. Scroll to "Configure Proxy"');
            }, 1000);
        }
        
        // Initialize on page load
        window.addEventListener('load', () => {
            checkServerStatus();
            
            // Auto-scroll for mobile
            if (window.innerWidth < 768) {
                document.querySelector('.step:nth-child(2)').scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }
            
            // Update title with status
            document.title = 'Locket Pro Unlock Setup';
        });
        
        // Keep server awake with periodic pings
        setInterval(() => {
            fetch('https://locket-mobileconfig.onrender.com/health')
                .catch(() => {}); // Silent ping
        }, 300000); // Ping every 5 minutes
    </script>
</body>
</html>`;
  
  res.send(html);
  console.log('📱 Served install page');
});

// 4. Proxy all RevenueCat traffic
app.use('/', proxy);

// 5. 404 handler
app.use((req, res) => {
  if (req.url.includes('/install.mobileconfig')) {
    // Redirect mobileconfig requests to install page
    res.redirect('/install');
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>404 - Locket Proxy</title>
          <style>
              body { font-family: -apple-system, sans-serif; padding: 40px; text-align: center; }
              h1 { color: #764ba2; }
              a { color: #667eea; text-decoration: none; }
          </style>
      </head>
      <body>
          <h1>404 - Page Not Found</h1>
          <p>The page you're looking for doesn't exist.</p>
          <p><a href="/install">Go to Locket Setup Instructions</a></p>
          <p><a href="/proxy.pac">Get PAC File</a></p>
          <p><a href="/health">Check Server Health</a></p>
      </body>
      </html>
    `);
  }
});

// ================= START SERVER =================
app.listen(CONFIG.PORT, () => {
  console.log(`
🚀 ============================================
🚀 LOCKET PRO UNLOCK PROXY v2.0
🚀 ============================================
🚀 Server running on port: ${CONFIG.PORT}
🚀 External URL: https://${CONFIG.HOSTNAME}
🚀 
🚀 📱 Setup Page: https://${CONFIG.HOSTNAME}/install
🚀 📄 PAC File: https://${CONFIG.HOSTNAME}/proxy.pac
🚀 ⚙️ Health Check: https://${CONFIG.HOSTNAME}/health
🚀 ============================================
🚀 Target API: ${CONFIG.TARGET}
🚀 ============================================
  `);
  
  // Keep server alive warning
  console.log(`
⚠️  IMPORTANT FOR FREE TIER:
⚠️  Server may sleep after 15 minutes of inactivity
⚠️  First request after sleep may take 30-60 seconds
⚠️  Regular use will keep server awake
  `);
});

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

app.get('/install', (req, res) => {
  res.send(`
    <!DOCTYPE html>
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
                border: 2px dashed #adb5bd;
            }
            .code-block {
                background: #2d3748;
                color: #e2e8f0;
                padding: 20px;
                border-radius: 10px;
                margin: 15px 0;
                font-family: 'Courier New', monospace;
                font-size: 1.1em;
                word-break: break-all;
                border: 2px solid #4a5568;
            }
            .warning {
                background: #fff3cd;
                border: 2px solid #ffeaa7;
                color: #856404;
                padding: 20px;
                border-radius: 10px;
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
                transition: all 0.3s;
                border: none;
                cursor: pointer;
                width: 100%;
                max-width: 400px;
            }
            .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            }
            .btn-copy {
                background: #38a169;
                color: white;
                border: none;
                padding: 15px 25px;
                border-radius: 50px;
                font-weight: bold;
                font-size: 1.2em;
                cursor: pointer;
                margin: 15px 0;
                width: 100%;
                max-width: 400px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
            }
            .btn-copy:hover {
                background: #2f855a;
                transform: translateY(-2px);
            }
            .btn-container {
                text-align: center;
                margin: 30px 0;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .qr-code {
                background: white;
                padding: 20px;
                border-radius: 10px;
                margin: 20px auto;
                width: 200px;
                height: 200px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 3px solid #667eea;
            }
            .qr-code img {
                width: 100%;
                height: 100%;
            }
            @media (max-width: 768px) {
                .container {
                    padding: 20px;
                }
                h1 {
                    font-size: 2em;
                }
                .btn, .btn-copy {
                    width: 100%;
                }
            }
        </style>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body>
        <div class="container">
            <h1><i class="fas fa-crown"></i> Locket Pro Unlock Setup</h1>
            
            <div class="warning">
                <h3><i class="fas fa-exclamation-triangle"></i> IMPORTANT</h3>
                <p>iOS doesn't allow direct links to Settings. Please follow these steps MANUALLY:</p>
            </div>
            
            <!-- STEP 1 -->
            <div class="step">
                <div class="step-number">1</div>
                <h3><i class="fas fa-wifi"></i> Open Wi-Fi Settings MANUALLY</h3>
                <p>On your iPhone, go to:</p>
                <div class="screenshot">
                    <strong>Settings App</strong> → <strong>Wi-Fi</strong>
                </div>
                <p>Make sure you're connected to a Wi-Fi network</p>
            </div>
            
            <!-- STEP 2 -->
            <div class="step">
                <div class="step-number">2</div>
                <h3><i class="fas fa-cog"></i> Configure Proxy</h3>
                <p>Tap the <strong>ⓘ (blue info icon)</strong> next to your connected network</p>
                <div class="screenshot">
                    Scroll down to <strong>"Configure Proxy"</strong> section
                </div>
                <p>Tap <strong>"Configure Proxy"</strong> (near the bottom)</p>
            </div>
            
            <!-- STEP 3 -->
            <div class="step">
                <div class="step-number">3</div>
                <h3><i class="fas fa-robot"></i> Select Auto Configuration</h3>
                <p>Tap <strong>"Auto"</strong> (NOT "Manual" or "Off")</p>
                <div class="screenshot">
                    Choose <strong>"Auto"</strong> configuration
                </div>
            </div>
            
            <!-- STEP 4 - PAC URL với COPY thực sự hoạt động -->
            <div class="step">
                <div class="step-number">4</div>
                <h3><i class="fas fa-link"></i> Enter PAC URL</h3>
                <p>Copy this EXACT URL:</p>
                
                <div class="code-block" id="pacUrl">
                    https://locket-mobileconfig.onrender.com/proxy.pac
                </div>
                
                <div class="btn-container">
                    <button class="btn-copy" onclick="copyToClipboard()">
                        <i class="fas fa-copy"></i> TAP TO COPY PAC URL
                    </button>
                    <p id="copyStatus" style="color: #38a169; font-weight: bold; margin-top: 10px;"></p>
                </div>
                
                <div class="screenshot">
                    Paste the copied URL into the <strong>"URL"</strong> field
                </div>
                
                <!-- QR Code cho dễ nhập -->
                <div class="qr-code">
                    <div id="qrcode"></div>
                </div>
                <p style="text-align: center; color: #666;">
                    <i class="fas fa-qrcode"></i> Scan QR code with another device to copy URL
                </p>
            </div>
            
            <!-- STEP 5 -->
            <div class="step">
                <div class="step-number">5</div>
                <h3><i class="fas fa-save"></i> Save Configuration</h3>
                <p>Tap <strong>"Save"</strong> in the top right corner</p>
                <div class="screenshot">
                    Save the proxy settings
                </div>
            </div>
            
            <!-- STEP 6 -->
            <div class="step">
                <div class="step-number">6</div>
                <h3><i class="fas fa-check-circle"></i> Test Locket App</h3>
                <p>Open <strong>Locket app</strong> and check:</p>
                <ul style="margin: 15px 0 15px 20px;">
                    <li>✅ All Pro features unlocked</li>
                    <li>✅ No advertisements</li>
                    <li>✅ Gold/Premium badge visible</li>
                </ul>
                <div class="screenshot">
                    If not working, try restarting Locket app
                </div>
            </div>
            
            <!-- Test Buttons -->
            <div class="btn-container">
                <button class="btn" onclick="testPAC()">
                    <i class="fas fa-vial"></i> Test PAC File
                </button>
                <button class="btn" onclick="testServer()">
                    <i class="fas fa-heart"></i> Check Server Status
                </button>
                <button class="btn" onclick="showTroubleshooting()">
                    <i class="fas fa-tools"></i> Troubleshooting
                </button>
            </div>
            
            <!-- Status Display -->
            <div style="text-align: center; margin-top: 30px; padding: 15px; background: #e9ecef; border-radius: 10px;">
                <h4><i class="fas fa-server"></i> Server Status</h4>
                <p>Server: <strong>locket-mobileconfig.onrender.com</strong></p>
                <p>Status: <span id="serverStatus">Checking...</span></p>
                <p id="serverDetails" style="font-size: 0.9em; color: #666;"></p>
            </div>
            
            <!-- Troubleshooting (hidden by default) -->
            <div id="troubleshooting" style="display: none; margin-top: 30px;">
                <div class="warning">
                    <h3><i class="fas fa-tools"></i> Troubleshooting Guide</h3>
                    <p><strong>If Locket doesn't unlock:</strong></p>
                    <ol style="margin: 10px 0 10px 20px;">
                        <li>Restart Locket app completely (swipe up to close)</li>
                        <li>Turn Airplane Mode ON, wait 5 seconds, turn OFF</li>
                        <li>Switch between WiFi and Cellular data</li>
                        <li>Clear Locket app cache: 
                            <br>Settings → General → iPhone Storage → Locket → Offload App
                        </li>
                        <li>Make sure proxy is ON: Settings → Wi-Fi → ⓘ → Configure Proxy should show "Auto"</li>
                    </ol>
                </div>
            </div>
        </div>

        <!-- QR Code Library -->
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        
        <script>
            // Generate QR Code
            document.addEventListener('DOMContentLoaded', function() {
                const pacUrl = document.getElementById('pacUrl').innerText;
                new QRCode(document.getElementById("qrcode"), {
                    text: pacUrl,
                    width: 160,
                    height: 160,
                    colorDark : "#000000",
                    colorLight : "#ffffff",
                    correctLevel : QRCode.CorrectLevel.H
                });
            });
            
            // Copy to Clipboard FUNCTION - FIXED
            function copyToClipboard() {
                const text = document.getElementById('pacUrl').innerText;
                const status = document.getElementById('copyStatus');
                
                // Method 1: Modern clipboard API
                if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(text)
                        .then(() => {
                            status.innerHTML = '✅ Copied to clipboard!';
                            status.style.color = '#38a169';
                            
                            // Show notification
                            showNotification('PAC URL copied!');
                        })
                        .catch(err => {
                            // Fallback to method 2
                            copyFallback(text, status);
                        });
                } else {
                    // Fallback for older browsers
                    copyFallback(text, status);
                }
            }
            
            // Fallback copy method
            function copyFallback(text, status) {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                try {
                    document.execCommand('copy');
                    status.innerHTML = '✅ Copied to clipboard!';
                    status.style.color = '#38a169';
                    showNotification('PAC URL copied!');
                } catch (err) {
                    status.innerHTML = '❌ Failed to copy. Please select and copy manually.';
                    status.style.color = '#e53e3e';
                    textArea.select();
                }
                
                document.body.removeChild(textArea);
            }
            
            // Show notification
            function showNotification(message) {
                if (navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')) {
                    // iOS notification
                    alert(message);
                }
            }
            
            // Test PAC file
            function testPAC() {
                window.open('https://locket-mobileconfig.onrender.com/proxy.pac', '_blank');
            }
            
            // Test server status
            function testServer() {
                const statusEl = document.getElementById('serverStatus');
                const detailsEl = document.getElementById('serverDetails');
                
                statusEl.innerHTML = 'Checking...';
                statusEl.style.color = '#666';
                
                fetch('https://locket-mobileconfig.onrender.com/health')
                    .then(response => {
                        if (!response.ok) throw new Error('Server error');
                        return response.json();
                    })
                    .then(data => {
                        statusEl.innerHTML = '✅ Online & Healthy';
                        statusEl.style.color = '#38a169';
                        detailsEl.innerHTML = 
                            `Version: ${data.version || '2.0.0'} | Uptime: ${Math.floor(data.uptime || 0)}s`;
                    })
                    .catch(error => {
                        statusEl.innerHTML = '❌ Server Error';
                        statusEl.style.color = '#e53e3e';
                        detailsEl.innerHTML = 'Server may be sleeping. Try accessing again.';
                    });
            }
            
            // Show troubleshooting
            function showTroubleshooting() {
                const troubleshooting = document.getElementById('troubleshooting');
                troubleshooting.style.display = troubleshooting.style.display === 'none' ? 'block' : 'none';
            }
            
            // Auto-check server status on load
            window.onload = function() {
                testServer();
                
                // Auto-scroll to top on mobile
                if (window.innerWidth < 768) {
                    window.scrollTo(0, 0);
                }
            };
            
            // Handle iOS back button
            window.onpageshow = function(event) {
                if (event.persisted) {
                    window.location.reload();
                }
            };
        </script>
    </body>
    </html>
  `);
});
  
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

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');

const app = express();

// ================= CONFIG =================
const PORT = process.env.PORT || 10000;
const HOSTNAME = process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost';
const RENDER_URL = `https://${HOSTNAME}`;

// ================= ENHANCED PROXY MIDDLEWARE =================
const createProxy = () => {
  return createProxyMiddleware({
    target: 'https://api.revenuecat.com',
    changeOrigin: true,
    secure: false, // Bypass SSL verification
    selfHandleResponse: true,
    
    onProxyReq: (proxyReq, req, res) => {
      // Set RevenueCat headers
      proxyReq.setHeader('Host', 'api.revenuecat.com');
      proxyReq.setHeader('X-Platform', 'ios');
      proxyReq.setHeader('X-Platform-Version', '17.0');
      proxyReq.setHeader('X-Version', '4.0.0');
      proxyReq.setHeader('User-Agent', 'RevenueCat/4.0.0 (iOS 17.0)');
      
      // Copy original headers
      const headersToCopy = [
        'Authorization',
        'Content-Type',
        'X-Client-Version',
        'X-Platform-Flavor',
        'X-Platform',
        'X-Platform-Version'
      ];
      
      headersToCopy.forEach(header => {
        if (req.headers[header.toLowerCase()]) {
          proxyReq.setHeader(header, req.headers[header.toLowerCase()]);
        }
      });
      
      // Remove problematic headers
      const headersToRemove = [
        'x-revenuecat-etag',
        'if-none-match',
        'if-modified-since',
        'x-forwarded-for',
        'x-forwarded-host'
      ];
      
      headersToRemove.forEach(header => {
        proxyReq.removeHeader(header);
      });
      
      console.log(`📤 [PROXY] Forwarding: ${req.method} ${req.url}`);
    },
    
    onProxyRes: (proxyRes, req, res) => {
      let body = [];
      let isRevenueCat = false;
      
      // Check if this is RevenueCat API
      if (req.url.includes('revenuecat') || 
          req.url.includes('/v1/') ||
          req.url.includes('/receipts') ||
          req.url.includes('/subscribers') ||
          req.url.includes('/purchases')) {
        isRevenueCat = true;
      }
      
      proxyRes.on('data', (chunk) => {
        body.push(chunk);
      });
      
      proxyRes.on('end', () => {
        try {
          const contentType = proxyRes.headers['content-type'] || '';
          const isJson = contentType.includes('application/json');
          
          if (isRevenueCat && isJson && body.length > 0) {
            const fullBody = Buffer.concat(body).toString();
            console.log(`🎯 [REVENUECAT] Intercepting response for: ${req.url}`);
            
            let data;
            try {
              data = JSON.parse(fullBody);
            } catch (parseError) {
              console.log('❌ [ERROR] Failed to parse JSON');
              res.writeHead(proxyRes.statusCode, proxyRes.headers);
              res.end(Buffer.concat(body));
              return;
            }
            
            // ================= ADVANCED UNLOCK LOGIC =================
            console.log('🔧 [UNLOCK] Applying Pro unlock...');
            
            // Handle different RevenueCat response formats
            let subscriber = data.subscriber || data.purchaserInfo || data;
            
            // 1. ENSURE SUBSCRIBER OBJECT EXISTS
            if (!data.subscriber && !data.purchaserInfo) {
              data.subscriber = {
                original_app_user_id: req.body?.app_user_id || 'locket_pro_user',
                original_application_version: '1000',
                original_purchase_date: '2024-01-01T00:00:00Z',
                first_seen: '2024-01-01T00:00:00Z',
                last_seen: new Date().toISOString(),
                management_url: 'https://apps.apple.com/account/subscriptions',
                non_subscriptions: {},
                entitlements: {},
                subscriptions: {},
                all_purchased_product_identifiers: []
              };
              subscriber = data.subscriber;
            }
            
            // 2. UNLOCK PRO ENTITLEMENT
            subscriber.entitlements = subscriber.entitlements || {};
            subscriber.entitlements.pro = {
              "expires_date": "2099-12-31T23:59:59Z",
              "grace_period_expires_date": null,
              "product_identifier": "locket_pro_lifetime",
              "purchase_date": "2024-01-01T00:00:00Z",
              "original_purchase_date": "2024-01-01T00:00:00Z",
              "ownership_type": "PURCHASED",
              "period_type": "normal",
              "store": "app_store",
              "is_sandbox": false,
              "unsubscribe_detected_at": null,
              "billing_issues_detected_at": null
            };
            
            // 3. UNLOCK GOLD ENTITLEMENT
            subscriber.entitlements.gold = {
              "expires_date": "2099-12-31T23:59:59Z",
              "grace_period_expires_date": null,
              "product_identifier": "locket_gold_yearly",
              "purchase_date": "2024-01-01T00:00:00Z",
              "original_purchase_date": "2024-01-01T00:00:00Z",
              "ownership_type": "PURCHASED",
              "period_type": "normal",
              "store": "app_store",
              "is_sandbox": false
            };
            
            // 4. ADD SUBSCRIPTIONS
            subscriber.subscriptions = subscriber.subscriptions || {};
            subscriber.subscriptions.locket_pro_lifetime = {
              "expires_date": "2099-12-31T23:59:59Z",
              "original_purchase_date": "2024-01-01T00:00:00Z",
              "purchase_date": "2024-01-01T00:00:00Z",
              "store": "app_store",
              "is_sandbox": false,
              "ownership_type": "PURCHASED",
              "period_type": "normal",
              "product_identifier": "locket_pro_lifetime",
              "id": "locket_pro_lifetime_" + Date.now(),
              "store_transaction_id": "RC" + Date.now() + Math.random().toString(36).substr(2, 9),
              "unsubscribe_detected_at": null,
              "billing_issues_detected_at": null,
              "grace_period_expires_date": null,
              "refunded_at": null,
              "auto_resume_date": null
            };
            
            // 5. ADD GOLD SUBSCRIPTION
            subscriber.subscriptions.locket_gold_yearly = {
              "expires_date": "2099-12-31T23:59:59Z",
              "original_purchase_date": "2024-01-01T00:00:00Z",
              "purchase_date": "2024-01-01T00:00:00Z",
              "store": "app_store",
              "is_sandbox": false,
              "ownership_type": "PURCHASED",
              "period_type": "normal",
              "product_identifier": "locket_gold_yearly"
            };
            
            // 6. SET ALL PURCHASED PRODUCTS
            subscriber.all_purchased_product_identifiers = [
              "locket_pro_lifetime",
              "locket_pro_yearly",
              "locket_pro_monthly",
              "locket_gold_yearly",
              "locket_gold_monthly"
            ];
            
            // 7. SET NON-SUBSCRIPTIONS
            subscriber.non_subscriptions = subscriber.non_subscriptions || {};
            
            // 8. ENSURE REQUIRED FIELDS
            subscriber.original_application_version = subscriber.original_application_version || "1000";
            subscriber.first_seen = subscriber.first_seen || "2024-01-01T00:00:00Z";
            subscriber.last_seen = new Date().toISOString();
            subscriber.management_url = "https://apps.apple.com/account/subscriptions";
            
            // Update the data object
            if (data.subscriber) data.subscriber = subscriber;
            if (data.purchaserInfo) data.purchaserInfo = subscriber;
            
            // Add request metadata
            data.request_date = new Date().toISOString();
            data.request_date_ms = Date.now();
            
            console.log('✅ [UNLOCK] Successfully unlocked Pro features!');
            
            const newBody = JSON.stringify(data, null, 2);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Length', Buffer.byteLength(newBody));
            res.end(newBody);
            
          } else {
            // Pass through non-RevenueCat or non-JSON responses
            console.log(`↪️ [PASS-THROUGH] Non-RevenueCat: ${req.url}`);
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(Buffer.concat(body));
          }
        } catch (error) {
          console.error('❌ [ERROR] Proxy processing failed:', error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Proxy processing error',
            message: error.message 
          }));
        }
      });
    }
  });
};

// ================= ROUTES (MUST BE BEFORE PROXY) =================

// 1. HEALTH CHECK
app.get('/health', (req, res) => {
  console.log('❤️ [HEALTH] Check requested');
  res.json({
    status: 'healthy',
    service: 'locket-unlock-proxy',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    proxy: 'active',
    endpoints: {
      health: '/health',
      pac: '/proxy.pac',
      install: '/install',
      test: '/test-revenuecat'
    }
  });
});

// 2. PAC FILE
app.get('/proxy.pac', (req, res) => {
  console.log('📄 [PAC] PAC file requested');
  const pac = `function FindProxyForURL(url, host) {
    // Direct connection for local and private networks
    if (isPlainHostName(host) ||
        shExpMatch(host, "*.local") ||
        isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0") ||
        isInNet(dnsResolve(host), "172.16.0.0", "255.240.0.0") ||
        isInNet(dnsResolve(host), "192.168.0.0", "255.255.0.0") ||
        isInNet(dnsResolve(host), "127.0.0.0", "255.0.0.0")) {
      return "DIRECT";
    }
    
    // Proxy RevenueCat APIs
    if (shExpMatch(host, "api.revenuecat.com") || 
        shExpMatch(host, "*.revenuecat.com") ||
        shExpMatch(host, "*.purchases-api.io") ||
        shExpMatch(host, "purchases-api.io")) {
      return "PROXY ${HOSTNAME}:${PORT}; DIRECT";
    }
    
    // All other traffic goes direct
    return "DIRECT";
  }`;
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pac);
});

// 3. INSTALL PAGE
app.get('/install', (req, res) => {
  console.log('📱 [INSTALL] Install page requested');
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>Locket Pro Unlock v3.0</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            padding: 20px;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.98);
            border-radius: 20px;
            padding: 30px;
            color: #333;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.3);
        }
        h1 {
            color: #764ba2;
            text-align: center;
            font-size: 2.2em;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        .step {
            background: #f8f9fa;
            border-left: 5px solid #667eea;
            padding: 22px;
            margin: 20px 0;
            border-radius: 12px;
            position: relative;
        }
        .step-number {
            position: absolute;
            top: -15px;
            left: -15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            width: 35px;
            height: 35px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 1.1em;
            box-shadow: 0 4px 10px rgba(102, 126, 234, 0.4);
        }
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 18px;
            border-radius: 10px;
            margin: 15px 0;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 1em;
            word-break: break-all;
            border: 2px solid #4a5568;
            line-height: 1.5;
            user-select: all;
            -webkit-user-select: all;
        }
        .btn {
            display: block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 30px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.1em;
            margin: 15px 0;
            text-align: center;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            width: 100%;
            box-shadow: 0 6px 15px rgba(102, 126, 234, 0.3);
        }
        .btn:hover, .btn:active {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        .btn-copy {
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
        }
        #copyStatus {
            color: #38a169;
            font-weight: bold;
            margin-top: 10px;
            font-size: 1em;
            min-height: 24px;
            text-align: center;
        }
        .status-box {
            text-align: center;
            margin-top: 25px;
            padding: 18px;
            background: #e9ecef;
            border-radius: 10px;
            border: 2px solid #dee2e6;
        }
        #serverStatus {
            font-weight: bold;
            font-size: 1.1em;
        }
        .success-box {
            background: #d4edda;
            border: 2px solid #c3e6cb;
            color: #155724;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
        }
        .warning-box {
            background: #fff3cd;
            border: 2px solid #ffeaa7;
            color: #856404;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
        }
        @media (max-width: 768px) {
            .container {
                padding: 20px;
                border-radius: 15px;
            }
            h1 {
                font-size: 1.8em;
            }
            .step {
                padding: 18px;
            }
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
    <div class="container">
        <h1><i class="fas fa-crown"></i> Locket Pro Unlock v3.0</h1>
        
        <div class="success-box">
            <h3><i class="fas fa-check-circle"></i> Server Ready</h3>
            <p>Advanced unlock system with enhanced RevenueCat interception.</p>
        </div>
        
        <!-- STEP 1 -->
        <div class="step">
            <div class="step-number">1</div>
            <h3><i class="fas fa-wifi"></i> Configure Wi-Fi Proxy</h3>
            <p>Go to <strong>Settings → Wi-Fi</strong> on your iPhone</p>
            <p>Tap the <strong>ⓘ</strong> icon next to your connected network</p>
        </div>
        
        <!-- STEP 2 -->
        <div class="step">
            <div class="step-number">2</div>
            <h3><i class="fas fa-cog"></i> Set Proxy to Auto</h3>
            <p>Scroll to <strong>"Configure Proxy"</strong></p>
            <p>Select <strong>"Auto"</strong> (not Manual or Off)</p>
        </div>
        
        <!-- STEP 3 -->
        <div class="step">
            <div class="step-number">3</div>
            <h3><i class="fas fa-link"></i> Enter PAC URL</h3>
            <p>Copy this PAC URL:</p>
            <div class="code-block" id="pacUrl">${RENDER_URL}/proxy.pac</div>
            <button class="btn btn-copy" onclick="copyToClipboard()">
                <i class="fas fa-copy"></i> TAP TO COPY PAC URL
            </button>
            <p id="copyStatus"></p>
            <p>Paste the URL into the field in Wi-Fi settings</p>
        </div>
        
        <!-- STEP 4 -->
        <div class="step">
            <div class="step-number">4</div>
            <h3><i class="fas fa-save"></i> Save & Verify</h3>
            <p>Tap <strong>"Save"</strong> in top right corner</p>
            <p>Make sure the checkmark ✓ appears</p>
        </div>
        
        <!-- STEP 5 -->
        <div class="step">
            <div class="step-number">5</div>
            <h3><i class="fas fa-check-circle"></i> Test Locket App</h3>
            <p>Open <strong>Locket app</strong> and check:</p>
            <ul style="margin: 15px 0 15px 25px;">
                <li><i class="fas fa-check" style="color: #38a169;"></i> All Pro features unlocked</li>
                <li><i class="fas fa-check" style="color: #38a169;"></i> No advertisements</li>
                <li><i class="fas fa-check" style="color: #38a169;"></i> Gold/Premium badge visible</li>
            </ul>
        </div>
        
        <div class="warning-box">
            <h3><i class="fas fa-exclamation-triangle"></i> Important Notes</h3>
            <ul style="margin: 10px 0 10px 25px;">
                <li>Free Render server may sleep after 15 minutes of inactivity</li>
                <li>First load after sleep may take 30 seconds</li>
                <li>Check server status below before testing</li>
                <li>If not working, check Render logs for RevenueCat requests</li>
            </ul>
        </div>
        
        <!-- Action Buttons -->
        <button class="btn" onclick="testServer()">
            <i class="fas fa-heartbeat"></i> Check Server Status
        </button>
        
        <button class="btn" onclick="testPAC()">
            <i class="fas fa-vial"></i> Test PAC File
        </button>
        
        <button class="btn" onclick="window.open('https://dashboard.render.com/logs', '_blank')">
            <i class="fas fa-terminal"></i> View Server Logs
        </button>
        
        <!-- Server Status -->
        <div class="status-box">
            <h4><i class="fas fa-server"></i> Server Status</h4>
            <p>URL: <strong>${HOSTNAME}</strong></p>
            <p>Status: <span id="serverStatus">Checking...</span></p>
            <p id="serverDetails"></p>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #666; font-size: 0.85em; padding-top: 20px; border-top: 1px solid #eee;">
            <p><i class="fas fa-info-circle"></i> v3.0 - Enhanced RevenueCat interception</p>
            <p>Proxy active: All RevenueCat API calls are intercepted and modified</p>
        </div>
    </div>

    <script>
        // Copy to Clipboard - iOS Compatible
        function copyToClipboard() {
            const text = document.getElementById('pacUrl').textContent;
            const status = document.getElementById('copyStatus');
            const copyButton = document.querySelector('.btn-copy');
            
            // Reset status
            status.innerHTML = '';
            
            // Create temporary textarea for iOS compatibility
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            
            // Select and copy
            textArea.focus();
            textArea.select();
            
            try {
                // Try execCommand first (works on iOS Safari)
                const successful = document.execCommand('copy');
                
                if (successful) {
                    // Success feedback
                    status.innerHTML = '✅ Copied to clipboard!';
                    status.style.color = '#38a169';
                    copyButton.innerHTML = '<i class="fas fa-check"></i> COPIED!';
                    copyButton.style.background = 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)';
                    
                    // Reset button after 2 seconds
                    setTimeout(() => {
                        copyButton.innerHTML = '<i class="fas fa-copy"></i> TAP TO COPY PAC URL';
                        copyButton.style.background = 'linear-gradient(135deg, #38a169 0%, #2f855a 100%)';
                    }, 2000);
                } else {
                    // Fallback for newer browsers
                    if (navigator.clipboard && window.isSecureContext) {
                        navigator.clipboard.writeText(text)
                            .then(() => {
                                status.innerHTML = '✅ Copied!';
                                status.style.color = '#38a169';
                            })
                            .catch(() => {
                                showManualCopy();
                            });
                    } else {
                        showManualCopy();
                    }
                }
            } catch (err) {
                showManualCopy();
            }
            
            // Clean up
            document.body.removeChild(textArea);
            
            // Auto-hide status after 3 seconds
            setTimeout(() => {
                if (status.innerHTML.includes('✅')) {
                    status.innerHTML = '';
                }
            }, 3000);
        }
        
        // Show manual copy instructions
        function showManualCopy() {
            const status = document.getElementById('copyStatus');
            status.innerHTML = '📱 <strong>Select and copy manually:</strong><br>' + 
                              '<small>Long press on the URL above, then tap "Copy"</small>';
            status.style.color = '#d69e2e';
        }
        
        // Test PAC file
        function testPAC() {
            window.open('${RENDER_URL}/proxy.pac', '_blank');
        }
        
        // Test server status
        function testServer() {
            const statusEl = document.getElementById('serverStatus');
            const detailsEl = document.getElementById('serverDetails');
            
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
            statusEl.style.color = '#666';
            
            // Add cache busting
            const url = '${RENDER_URL}/health?' + Date.now();
            
            fetch(url, { 
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' },
                mode: 'cors'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'healthy') {
                    statusEl.innerHTML = '✅ Online & Healthy';
                    statusEl.style.color = '#38a169';
                    detailsEl.innerHTML = 
                        \`Version: \${data.version} | Proxy: \${data.proxy}\`;
                } else {
                    statusEl.innerHTML = '⚠️ Server Error';
                    statusEl.style.color = '#d69e2e';
                    detailsEl.innerHTML = 'Server returned unhealthy status';
                }
            })
            .catch(error => {
                statusEl.innerHTML = '❌ Connection Failed';
                statusEl.style.color = '#e53e3e';
                detailsEl.innerHTML = 'Server may be sleeping. Try refreshing.';
            });
        }
        
        // Auto-check server status on load
        window.onload = function() {
            testServer();
        };
        
        // Handle iOS back button
        if (window.history && window.history.pushState) {
            window.addEventListener('popstate', function() {
                window.location.reload();
            });
        }
    </script>
</body>
</html>`;
  
  res.send(html);
});

// 4. TEST REVENUECAT ENDPOINT
app.get('/test-revenuecat', (req, res) => {
  console.log('🧪 [TEST] RevenueCat test endpoint called');
  
  const testResponse = {
    "request_date_ms": Date.now(),
    "request_date": new Date().toISOString(),
    "subscriber": {
      "original_app_user_id": "test_user_" + Date.now(),
      "original_application_version": "1000",
      "original_purchase_date": "2024-01-01T00:00:00Z",
      "first_seen": "2024-01-01T00:00:00Z",
      "last_seen": new Date().toISOString(),
      "management_url": "https://apps.apple.com/account/subscriptions",
      "non_subscriptions": {},
      "entitlements": {
        "pro": {
          "expires_date": "2099-12-31T23:59:59Z",
          "grace_period_expires_date": null,
          "product_identifier": "locket_pro_lifetime",
          "purchase_date": "2024-01-01T00:00:00Z",
          "original_purchase_date": "2024-01-01T00:00:00Z",
          "ownership_type": "PURCHASED",
          "period_type": "normal",
          "store": "app_store",
          "is_sandbox": false,
          "unsubscribe_detected_at": null,
          "billing_issues_detected_at": null
        },
        "gold": {
          "expires_date": "2099-12-31T23:59:59Z",
          "product_identifier": "locket_gold_yearly",
          "purchase_date": "2024-01-01T00:00:00Z"
        }
      },
      "subscriptions": {
        "locket_pro_lifetime": {
          "expires_date": "2099-12-31T23:59:59Z",
          "original_purchase_date": "2024-01-01T00:00:00Z",
          "purchase_date": "2024-01-01T00:00:00Z",
          "store": "app_store",
          "is_sandbox": false,
          "ownership_type": "PURCHASED",
          "period_type": "normal",
          "product_identifier": "locket_pro_lifetime"
        }
      },
      "all_purchased_product_identifiers": [
        "locket_pro_lifetime",
        "locket_pro_yearly",
        "locket_pro_monthly",
        "locket_gold_yearly"
      ]
    }
  };
  
  res.json(testResponse);
});

// 5. CREATE AND APPLY PROXY (MUST BE LAST)
const revenueCatProxy = createProxy();
app.use('/', revenueCatProxy);

// ================= START SERVER =================
const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`
🚀 ============================================
🚀 LOCKET PRO UNLOCK PROXY v3.0
🚀 ============================================
🚀 Server running on port: ${PORT}
🚀 External URL: ${RENDER_URL}
🚀 
🚀 📱 Install Page: ${RENDER_URL}/install
🚀 📄 PAC URL: ${RENDER_URL}/proxy.pac
🚀 ⚙️ Health Check: ${RENDER_URL}/health
🚀 🧪 Test Endpoint: ${RENDER_URL}/test-revenuecat
🚀 ============================================
🚀 Advanced RevenueCat interception ENABLED
🚀 All API calls to api.revenuecat.com will be modified
🚀 ============================================
    `);
    
    // Auto keep-alive for Render free tier
    setInterval(() => {
      https.get(`${RENDER_URL}/health`, (resp) => {
        console.log('🔄 Keep-alive ping sent');
      }).on('error', (err) => {
        console.log('⚠️ Keep-alive ping failed:', err.message);
      });
    }, 300000); // Ping every 5 minutes
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🔄 Shutting down gracefully...');
    server.close(() => {
      console.log('👋 Server closed');
      process.exit(0);
    });
  });

  return server;
};

// Start server if not in test mode
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

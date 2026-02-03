const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const crypto = require('crypto');

const app = express();

// ================= CONFIGURATION =================
const CONFIG = {
  PORT: process.env.PORT || 10000,
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost',
  RENDER_URL: process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`,
  TARGET_DOMAIN: 'api.revenuecat.com',
  FAKE_EXPIRY_DATE: '2099-12-31T23:59:59Z',
  FAKE_PURCHASE_DATE: '2024-01-01T00:00:00Z',
  PRODUCT_IDENTIFIER: 'locket_pro_lifetime'
};

// ================= PROXY MIDDLEWARE =================
const modifyResponse = (proxyRes, req, res) => {
  let bodyChunks = [];
  
  proxyRes.on('data', (chunk) => {
    bodyChunks.push(chunk);
  });
  
  proxyRes.on('end', () => {
    try {
      const body = Buffer.concat(bodyChunks);
      const contentType = proxyRes.headers['content-type'] || '';
      const isRevenueCat = req.url.includes('/receipts') || 
                         req.url.includes('/subscribers') ||
                         req.url.includes('/v1/subscribers');
      
      if (contentType.includes('application/json') && isRevenueCat) {
        const data = JSON.parse(body.toString());
        
        // ================= UNLOCK LOGIC =================
        if (data.subscriber) {
          // 1. Modify entitlements
          data.subscriber.entitlements = {
            "pro": {
              "expires_date": CONFIG.FAKE_EXPIRY_DATE,
              "product_identifier": CONFIG.PRODUCT_IDENTIFIER,
              "purchase_date": CONFIG.FAKE_PURCHASE_DATE
            },
            "gold": {
              "expires_date": CONFIG.FAKE_EXPIRY_DATE,
              "product_identifier": "locket_gold_yearly",
              "purchase_date": CONFIG.FAKE_PURCHASE_DATE
            }
          };
          
          // 2. Modify subscriptions
          data.subscriber.subscriptions = {
            [CONFIG.PRODUCT_IDENTIFIER]: {
              "billing_issues_detected_at": null,
              "expires_date": CONFIG.FAKE_EXPIRY_DATE,
              "is_sandbox": false,
              "original_purchase_date": CONFIG.FAKE_PURCHASE_DATE,
              "period_type": "normal",
              "purchase_date": CONFIG.FAKE_PURCHASE_DATE,
              "store": "app_store",
              "unsubscribe_detected_at": null
            }
          };
          
          // 3. Set all purchased products
          data.subscriber.all_purchased_product_identifiers = [
            CONFIG.PRODUCT_IDENTIFIER,
            "locket_pro_yearly",
            "locket_pro_monthly"
          ];
          
          // 4. Set first seen date
          data.subscriber.first_seen = CONFIG.FAKE_PURCHASE_DATE;
        }
        
        const modifiedBody = JSON.stringify(data);
        proxyRes.headers['content-length'] = Buffer.byteLength(modifiedBody);
        
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(modifiedBody);
        console.log(`✅ Modified response for: ${req.url}`);
      } else {
        // Not RevenueCat JSON, pass through
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        res.end(body);
      }
    } catch (error) {
      console.error('❌ Error modifying response:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy processing error' }));
    }
  });
};

const revenueCatProxy = createProxyMiddleware({
  target: `https://${CONFIG.TARGET_DOMAIN}`,
  changeOrigin: true,
  secure: false,
  selfHandleResponse: true,
  onProxyReq: (proxyReq, req, res) => {
    // Preserve original headers
    proxyReq.setHeader('Host', CONFIG.TARGET_DOMAIN);
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
    
    // Remove tracking headers
    const headersToRemove = [
      'x-revenuecat-etag',
      'x-revenuecat-version',
      'if-none-match',
      'if-modified-since'
    ];
    
    headersToRemove.forEach(header => {
      if (proxyReq.getHeader(header)) {
        proxyReq.removeHeader(header);
      }
    });
    
    // Add fake headers
    proxyReq.setHeader('X-RevenueCat-Proxy', 'locket-unlock');
    proxyReq.setHeader('X-Forwarded-Proto', 'https');
    
    console.log(`📤 Proxying: ${req.method} ${req.url}`);
  },
  onProxyRes: modifyResponse
});

// ================= ROUTES =================

// 1. Proxy all RevenueCat traffic
app.use('/', revenueCatProxy);

// 2. Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'locket-unlock-proxy',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      install: '/install',
      pac: '/proxy.pac',
      status: '/health'
    }
  });
});

// 3. PAC (Proxy Auto-Config) file
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
      return "PROXY ${CONFIG.HOSTNAME}:${CONFIG.PORT}; " +
             "PROXY ${CONFIG.HOSTNAME.replace('https://', '').replace('http://', '')}:${CONFIG.PORT}; " +
             "DIRECT";
    }
    
    // All other traffic goes direct
    return "DIRECT";
  }`;
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pacScript);
  console.log('📄 Served PAC file');
});

// 4. Main Install Page (MANUAL SETUP - NO MOBILECONFIG)
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>Locket Pro Unlock Setup</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            padding: 15px;
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.98);
            border-radius: 20px;
            padding: 25px;
            color: #333;
            box-shadow: 0 15px 40px rgba(0,0,0,0.2);
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
            padding: 20px;
            margin: 20px 0;
            border-radius: 12px;
            position: relative;
            transition: transform 0.2s;
        }
        .step:hover {
            transform: translateX(5px);
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
        .screenshot {
            background: #e9ecef;
            padding: 12px;
            border-radius: 10px;
            margin: 12px 0;
            text-align: center;
            color: #666;
            font-style: italic;
            border: 2px dashed #adb5bd;
            font-size: 0.95em;
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
        .warning {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border: 2px solid #ffd54f;
            color: #856404;
            padding: 18px;
            border-radius: 10px;
            margin: 20px 0;
            font-size: 0.95em;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 30px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.2em;
            margin: 15px 5px;
            text-align: center;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            width: 100%;
            max-width: 350px;
            box-shadow: 0 6px 15px rgba(102, 126, 234, 0.3);
            -webkit-appearance: none;
        }
        .btn:hover, .btn:active {
            transform: translateY(-3px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        .btn-copy {
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
            color: white;
            border: none;
            padding: 16px 25px;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.1em;
            cursor: pointer;
            margin: 15px 0;
            width: 100%;
            max-width: 350px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            box-shadow: 0 6px 15px rgba(56, 161, 105, 0.3);
        }
        .btn-copy:active {
            transform: scale(0.98);
        }
        .btn-container {
            text-align: center;
            margin: 25px 0;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .qr-container {
            background: white;
            padding: 20px;
            border-radius: 15px;
            margin: 20px auto;
            width: 220px;
            height: 220px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 3px solid #667eea;
            box-shadow: 0 8px 20px rgba(0,0,0,0.1);
        }
        .qr-placeholder {
            width: 180px;
            height: 180px;
            background: #f8f9fa;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #666;
            font-weight: bold;
            border-radius: 10px;
            border: 2px dashed #adb5bd;
        }
        #copyStatus {
            color: #38a169;
            font-weight: bold;
            margin-top: 10px;
            font-size: 1em;
            min-height: 24px;
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
        #serverDetails {
            font-size: 0.9em;
            color: #666;
            margin-top: 5px;
        }
        .troubleshooting {
            display: none;
            margin-top: 25px;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
            .container {
                padding: 20px;
                border-radius: 15px;
            }
            h1 {
                font-size: 1.8em;
            }
            .btn, .btn-copy {
                width: 100%;
                max-width: 100%;
                padding: 18px 20px;
            }
            .step {
                padding: 18px;
            }
            .code-block {
                font-size: 0.9em;
                padding: 15px;
            }
        }
        @media (max-width: 480px) {
            body {
                padding: 10px;
            }
            .container {
                padding: 15px;
            }
            h1 {
                font-size: 1.6em;
            }
        }
        .ios-tip {
            background: #e3f2fd;
            border: 2px solid #90caf9;
            color: #1565c0;
            padding: 12px;
            border-radius: 8px;
            margin: 10px 0;
            font-size: 0.9em;
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>
<body>
    <div class="container">
        <h1><i class="fas fa-crown"></i> Locket Pro Unlock</h1>
        
        <div class="warning">
            <h3><i class="fas fa-exclamation-triangle"></i> Important Notice</h3>
            <p>iOS restricts automatic proxy profiles. Please follow these <strong>manual steps</strong> carefully.</p>
        </div>
        
        <!-- STEP 1 -->
        <div class="step">
            <div class="step-number">1</div>
            <h3><i class="fas fa-wifi"></i> Open Wi-Fi Settings</h3>
            <p>On your iPhone, manually open:</p>
            <div class="screenshot">
                <strong>Settings App</strong> → <strong>Wi-Fi</strong>
            </div>
            <div class="ios-tip">
                <i class="fas fa-lightbulb"></i> Tip: Make sure you're connected to Wi-Fi
            </div>
        </div>
        
        <!-- STEP 2 -->
        <div class="step">
            <div class="step-number">2</div>
            <h3><i class="fas fa-cog"></i> Configure Proxy</h3>
            <p>Tap the <strong>ⓘ blue info icon</strong> next to your connected network</p>
            <div class="screenshot">
                Scroll down to <strong>"Configure Proxy"</strong>
            </div>
            <p>Tap <strong>"Configure Proxy"</strong> (near the bottom)</p>
        </div>
        
        <!-- STEP 3 -->
        <div class="step">
            <div class="step-number">3</div>
            <h3><i class="fas fa-toggle-on"></i> Select Auto</h3>
            <p>Tap <strong>"Auto"</strong> (NOT "Manual" or "Off")</p>
            <div class="screenshot">
                Choose <strong>"Auto"</strong> configuration
            </div>
        </div>
        
        <!-- STEP 4 - PAC URL -->
        <div class="step">
            <div class="step-number">4</div>
            <h3><i class="fas fa-link"></i> Enter PAC URL</h3>
            <p>Copy this EXACT URL:</p>
            
            <div class="code-block" id="pacUrl">
                https://locket-mobileconfig.onrender.com/proxy.pac
            </div>
            
            <div class="btn-container">
                <button class="btn-copy" onclick="copyToClipboard()" id="copyButton">
                    <i class="fas fa-copy"></i> TAP TO COPY PAC URL
                </button>
                <p id="copyStatus"></p>
            </div>
            
            <div class="screenshot">
                Paste the URL into the <strong>"URL"</strong> field in Wi-Fi settings
            </div>
            
            <!-- QR Code -->
            <div class="qr-container">
                <div id="qrcode" class="qr-placeholder">
                    QR Code Loading...
                </div>
            </div>
            <p style="text-align: center; color: #666; font-size: 0.9em;">
                <i class="fas fa-qrcode"></i> Scan with another device to copy URL easily
            </p>
        </div>
        
        <!-- STEP 5 -->
        <div class="step">
            <div class="step-number">5</div>
            <h3><i class="fas fa-save"></i> Save Settings</h3>
            <p>Tap <strong>"Save"</strong> in the top right corner</p>
            <div class="screenshot">
                Wait for the checkmark ✓ to appear
            </div>
        </div>
        
        <!-- STEP 6 -->
        <div class="step">
            <div class="step-number">6</div>
            <h3><i class="fas fa-check-circle"></i> Test Locket App</h3>
            <p>Open <strong>Locket app</strong> and check:</p>
            <ul style="margin: 15px 0 15px 25px;">
                <li><i class="fas fa-check" style="color: #38a169;"></i> All Pro features unlocked</li>
                <li><i class="fas fa-check" style="color: #38a169;"></i> No advertisements</li>
                <li><i class="fas fa-check" style="color: #38a169;"></i> Gold/Premium badge visible</li>
            </ul>
            <div class="screenshot">
                If not working, try restarting Locket app completely
            </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="btn-container">
            <button class="btn" onclick="testPAC()">
                <i class="fas fa-vial"></i> Test PAC File
            </button>
            <button class="btn" onclick="testServer()">
                <i class="fas fa-heartbeat"></i> Check Server Status
            </button>
            <button class="btn" onclick="toggleTroubleshooting()">
                <i class="fas fa-tools"></i> Troubleshooting
            </button>
        </div>
        
        <!-- Server Status -->
        <div class="status-box">
            <h4><i class="fas fa-server"></i> Server Status</h4>
            <p>URL: <strong>locket-mobileconfig.onrender.com</strong></p>
            <p>Status: <span id="serverStatus">Checking...</span></p>
            <p id="serverDetails"></p>
        </div>
        
        <!-- Troubleshooting -->
        <div id="troubleshooting" class="troubleshooting">
            <div class="warning">
                <h3><i class="fas fa-tools"></i> Troubleshooting Guide</h3>
                
                <p><strong>If proxy doesn't work:</strong></p>
                <ol style="margin: 10px 0 10px 25px;">
                    <li>Verify proxy is ON: Settings → Wi-Fi → ⓘ → Configure Proxy shows "Auto"</li>
                    <li>Restart Locket app completely (swipe up from app switcher)</li>
                    <li>Toggle Airplane Mode: ON for 5 sec → OFF</li>
                    <li>Switch between Wi-Fi and Cellular data</li>
                </ol>
                
                <p><strong>If still not working:</strong></p>
                <ol style="margin: 10px 0 10px 25px;">
                    <li>Clear Locket cache: Settings → General → iPhone Storage → Locket → Offload App</li>
                    <li>Reinstall Locket app</li>
                    <li>Restart iPhone</li>
                </ol>
                
                <p><strong>Server issues:</strong></p>
                <ul style="margin: 10px 0 10px 25px;">
                    <li>Free Render server sleeps after 15min inactivity</li>
                    <li>First load may take 30 seconds to wake up</li>
                    <li>Check server status above</li>
                </ul>
            </div>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #666; font-size: 0.85em; padding-top: 20px; border-top: 1px solid #eee;">
            <p><i class="fas fa-info-circle"></i> This setup only works while proxy is active. Turn off in Wi-Fi settings when not needed.</p>
            <p>Server v2.0.0 | Last updated: ${new Date().toLocaleDateString()}</p>
        </div>
    </div>

    <!-- QR Code Library -->
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    
    <script>
        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            // Generate QR Code
            const pacUrl = document.getElementById('pacUrl').innerText;
            const qrContainer = document.getElementById('qrcode');
            
            // Clear placeholder
            qrContainer.innerHTML = '';
            
            // Generate QR code
            QRCode.toCanvas(qrContainer, pacUrl, {
                width: 180,
                height: 180,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            }, function(error) {
                if (error) {
                    qrContainer.innerHTML = '<div style="color: #666; text-align: center;">QR Code Error<br><small>Copy URL manually</small></div>';
                }
            });
            
            // Check server status on load
            testServer();
            
            // Auto-select URL on tap (for easier copying)
            const urlElement = document.getElementById('pacUrl');
            urlElement.addEventListener('click', function() {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(this);
                selection.removeAllRanges();
                selection.addRange(range);
            });
            
            // Handle iOS zoom prevention
            document.addEventListener('touchstart', function(event) {
                if (event.touches.length > 1) {
                    event.preventDefault();
                }
            }, { passive: false });
            
            let lastTouchEnd = 0;
            document.addEventListener('touchend', function(event) {
                const now = Date.now();
                if (now - lastTouchEnd <= 300) {
                    event.preventDefault();
                }
                lastTouchEnd = now;
            }, false);
        });
        
        // Copy to Clipboard - FIXED FOR iOS
        function copyToClipboard() {
            const text = document.getElementById('pacUrl').innerText;
            const status = document.getElementById('copyStatus');
            const copyButton = document.getElementById('copyButton');
            
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
                    
                    // iOS haptic feedback (if available)
                    if (window.navigator.vibrate) {
                        window.navigator.vibrate(50);
                    }
                } else {
                    // Fallback for newer browsers
                    if (navigator.clipboard && window.isSecureContext) {
                        navigator.clipboard.writeText(text)
                            .then(() => {
                                status.innerHTML = '✅ Copied!';
                                status.style.color = '#38a169';
                            })
                            .catch(() => {
                                showManualCopy(text, status);
                            });
                    } else {
                        showManualCopy(text, status);
                    }
                }
            } catch (err) {
                showManualCopy(text, status);
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
        function showManualCopy(text, status) {
            status.innerHTML = '📱 <strong>Select and copy manually:</strong><br>' + 
                              '<small>Long press on the URL above, then tap "Copy"</small>';
            status.style.color = '#d69e2e';
            
            // Select the text for user
            const urlElement = document.getElementById('pacUrl');
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(urlElement);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        
        // Test PAC file
        function testPAC() {
            window.open('https://locket-mobileconfig.onrender.com/proxy.pac', '_blank');
        }
        
        // Test server status
        function testServer() {
            const statusEl = document.getElementById('serverStatus');
            const detailsEl = document.getElementById('serverDetails');
            
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
            statusEl.style.color = '#666';
            
            // Add cache busting
            const url = 'https://locket-mobileconfig.onrender.com/health?' + Date.now();
            
            fetch(url, { 
                method: 'GET',
                headers: { 'Cache-Control': 'no-cache' },
                mode: 'cors'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.status === 'healthy') {
                    statusEl.innerHTML = '✅ Online & Healthy';
                    statusEl.style.color = '#38a169';
                    detailsEl.innerHTML = 
                        `Version: ${data.version || '2.0.0'} | Uptime: ${formatUptime(data.uptime || 0)}`;
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
                console.log('Server check error:', error.message);
            })
            .finally(() => {
                // Auto-refresh status every 30 seconds
                setTimeout(testServer, 30000);
            });
        }
        
        // Format uptime
        function formatUptime(seconds) {
            if (seconds < 60) return `${Math.floor(seconds)}s`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
            return `${Math.floor(seconds / 86400)}d`;
        }
        
        // Toggle troubleshooting
        function toggleTroubleshooting() {
            const troubleshooting = document.getElementById('troubleshooting');
            const isVisible = troubleshooting.style.display === 'block';
            troubleshooting.style.display = isVisible ? 'none' : 'block';
            
            // Scroll to troubleshooting if showing
            if (!isVisible) {
                setTimeout(() => {
                    troubleshooting.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 100);
            }
        }
        
        // Handle iOS back button
        if (window.history && window.history.pushState) {
            window.addEventListener('popstate', function() {
                window.location.reload();
            });
        }
        
        // Prevent pinch zoom
        document.addEventListener('gesturestart', function(e) {
            e.preventDefault();
        });
        
        // Auto-refresh page if server was sleeping
        let lastActive = Date.now();
        document.addEventListener('click', () => lastActive = Date.now());
        document.addEventListener('touchstart', () => lastActive = Date.now());
        
        setInterval(() => {
            if (Date.now() - lastActive > 300000) { // 5 minutes
                const statusEl = document.getElementById('serverStatus');
                if (statusEl && statusEl.innerHTML.includes('Failed')) {
                    window.location.reload();
                }
            }
        }, 60000); // Check every minute
    </script>
</body>
</html>`;
  
  res.send(html);
});

// 5. Keep-alive endpoint to prevent Render sleep
app.get('/keep-alive', (req, res) => {
  res.json({ 
    status: 'awake', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 6. Test endpoint for RevenueCat API
app.get('/test', (req, res) => {
  res.json({
    message: 'Locket Unlock Proxy Test',
    endpoints: {
      proxy: 'Active (intercepts api.revenuecat.com)',
      pac: '/proxy.pac',
      install: '/install',
      health: '/health',
      test: '/test'
    },
    config: {
      target: CONFIG.TARGET_DOMAIN,
      fake_expiry: CONFIG.FAKE_EXPIRY_DATE,
      port: CONFIG.PORT
    }
  });
});

// 7. 404 handler
app.use((req, res) => {
  res.redirect('/install');
});

// ================= START SERVER =================
const startServer = () => {
  const server = app.listen(CONFIG.PORT, () => {
    console.log(`
    🚀 ============================================
    🚀 LOCKET PRO UNLOCK PROXY v2.0
    🚀 ============================================
    🚀 Server running on port: ${CONFIG.PORT}
    🚀 Local URL: http://localhost:${CONFIG.PORT}
    🚀 External URL: ${CONFIG.RENDER_URL}
    🚀 
    🚀 📱 Install Page: ${CONFIG.RENDER_URL}/install
    🚀 📄 PAC URL: ${CONFIG.RENDER_URL}/proxy.pac
    🚀 ⚙️ Health Check: ${CONFIG.RENDER_URL}/health
    🚀 ============================================
    🚀 Target: ${CONFIG.TARGET_DOMAIN}
    🚀 Fake Expiry: ${CONFIG.FAKE_EXPIRY_DATE}
    🚀 ============================================
    `);
    
    // Auto keep-alive for Render free tier
    setInterval(() => {
      require('https').get(`${CONFIG.RENDER_URL}/health`, () => {
        console.log('🔄 Keep-alive ping sent');
      }).on('error', () => {
        console.log('⚠️ Keep-alive ping failed');
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

module.exports = { app, startServer, CONFIG };

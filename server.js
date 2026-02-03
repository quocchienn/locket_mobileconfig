const express = require('express');
const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ================= CONFIGURATION =================
const CONFIG = {
  TARGET_DOMAIN: 'api.revenuecat.com',
  FAKE_EXPIRY_DATE: '2099-12-31T23:59:59Z',
  FAKE_PURCHASE_DATE: '2024-01-01T00:00:00Z',
  PRODUCT_IDENTIFIER: 'locket_pro_lifetime',
  PORT: process.env.PORT || 3000,
  HOSTNAME: process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost',
  RENDER_URL: process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`
};

// ================= HELPER FUNCTIONS =================
const generateResponseModifier = () => {
  return (proxyRes, req, res) => {
    let body = [];
    let modified = false;

    proxyRes.on('data', (chunk) => {
      body.push(chunk);
    });

    proxyRes.on('end', () => {
      try {
        const contentType = proxyRes.headers['content-type'] || '';
        const isJson = contentType.includes('application/json');
        const isRevenueCat = req.url.includes('/receipts') || 
                           req.url.includes('/subscribers') ||
                           req.url.includes('/v1/subscribers');

        if (isJson && isRevenueCat) {
          const bodyStr = Buffer.concat(body).toString();
          const data = JSON.parse(bodyStr);

          // ================= UNLOCK LOGIC =================
          if (data.subscriber) {
            // 1. Modify entitlements
            data.subscriber.entitlements = {
              "pro": {
                "expires_date": CONFIG.FAKE_EXPIRY_DATE,
                "grace_period_expires_date": null,
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
                "auto_resume_date": null,
                "billing_issues_detected_at": null,
                "expires_date": CONFIG.FAKE_EXPIRY_DATE,
                "grace_period_expires_date": null,
                "is_sandbox": false,
                "original_purchase_date": CONFIG.FAKE_PURCHASE_DATE,
                "ownership_type": "PURCHASED",
                "period_type": "normal",
                "purchase_date": CONFIG.FAKE_PURCHASE_DATE,
                "refunded_at": null,
                "store": "app_store",
                "unsubscribe_detected_at": null,
                "store_transaction_id": `RC${Date.now()}${Math.floor(Math.random() * 1000)}`
              }
            };

            // 3. Set all products as active
            data.subscriber.all_purchased_product_identifiers = [
              CONFIG.PRODUCT_IDENTIFIER,
              "locket_pro_yearly",
              "locket_pro_monthly",
              "locket_gold_yearly"
            ];

            // 4. Set latest app purchase
            data.subscriber.non_subscriptions = {};

            // 5. Set first purchase date
            data.subscriber.first_seen = CONFIG.FAKE_PURCHASE_DATE;
            
            // 6. Set management URL to fake
            data.subscriber.management_url = "https://apps.apple.com/account/subscriptions";

            modified = true;
          }

          const newBody = JSON.stringify(data);
          proxyRes.headers['content-length'] = Buffer.byteLength(newBody);

          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(newBody);
          console.log(`✅ Modified response for: ${req.url}`);
        } else {
          // Not RevenueCat JSON, pass through
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          res.end(Buffer.concat(body));
        }
      } catch (error) {
        console.error('❌ Error modifying response:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy processing error' }));
      }
    });
  };
};

// ================= PROXY MIDDLEWARE =================
const revenueCatProxy = createProxyMiddleware({
  target: `https://${CONFIG.TARGET_DOMAIN}`,
  changeOrigin: true,
  secure: false, // Bypass SSL verification
  selfHandleResponse: true,
  onProxyReq: (proxyReq, req, res) => {
    // Preserve original headers
    proxyReq.setHeader('Host', CONFIG.TARGET_DOMAIN);
    proxyReq.setHeader('X-Forwarded-Host', req.headers.host);
    
    // Remove tracking headers (like deleteheader.js)
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
    
    // Add fake headers to bypass checks
    proxyReq.setHeader('X-RevenueCat-Proxy', 'locket-unlock');
    proxyReq.setHeader('X-Forwarded-Proto', 'https');
    
    console.log(`📤 Proxying: ${req.method} ${req.url}`);
  },
  onProxyRes: generateResponseModifier(),
  pathFilter: (pathname, req) => {
    // Only proxy RevenueCat API calls
    return pathname.includes('/v1/') || 
           pathname.includes('/receipts') || 
           pathname.includes('/subscribers');
  }
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
    uptime: process.uptime()
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

// 4. Mobileconfig profile generator
app.get('/install.mobileconfig', (req, res) => {
  const uuid = () => crypto.randomUUID();
  const serverUrl = req.get('host') || CONFIG.HOSTNAME;
  
  const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <!-- HTTP Proxy Configuration -->
        <dict>
            <key>PayloadType</key>
            <string>com.apple.proxy.http.global</string>
            <key>PayloadIdentifier</key>
            <string>com.locket.unlock.proxy.${uuid()}</string>
            <key>PayloadUUID</key>
            <string>${uuid()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadDisplayName</key>
            <string>Locket Proxy Settings</string>
            <key>PayloadDescription</key>
            <string>Proxy for Locket Pro unlock</string>
            <key>ProxyType</key>
            <string>Auto</string>
            <key>ProxyAutoConfigURLString</key>
            <string>https://${serverUrl}/proxy.pac</string>
        </dict>
        
        <!-- WiFi Proxy for specific networks -->
        <dict>
            <key>PayloadType</key>
            <string>com.apple.wifi.managed</string>
            <key>PayloadIdentifier</key>
            <string>com.locket.unlock.wifi.${uuid()}</string>
            <key>PayloadUUID</key>
            <string>${uuid()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadDisplayName</key>
            <string>Locket WiFi Proxy</string>
            <key>PayloadDescription</key>
            <string>Auto-configure proxy on WiFi</string>
            <key>HIDDEN_NETWORK</key>
            <false/>
            <key>AutoJoin</key>
            <true/>
            <key>ProxyType</key>
            <string>Auto</string>
            <key>ProxyAutoConfigURL</key>
            <string>https://${serverUrl}/proxy.pac</string>
            <key>EncryptionType</key>
            <string>WPA2</string>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>🎁 Locket Pro Unlock v2.0</string>
    <key>PayloadIdentifier</key>
    <string>com.locket.unlock.${uuid()}</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${uuid()}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
    <key>PayloadOrganization</key>
    <string>Locket Unlock Service</string>
</dict>
</plist>`;
  
  res.header('Content-Type', 'application/x-apple-aspen-config');
  res.header('Content-Disposition', 'attachment; filename="Locket-Pro-Unlock.mobileconfig"');
  res.send(mobileconfig);
  console.log('📱 Served mobileconfig profile');
});

// 5. Direct install page
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro Unlock Installer</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
        }
        .container {
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            padding: 40px;
            color: #333;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            margin-top: 40px;
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
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.2em;
            margin: 10px;
            text-align: center;
            transition: transform 0.3s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }
        .btn-container {
            text-align: center;
            margin: 40px 0;
        }
        .status {
            padding: 15px;
            background: #d4edda;
            border-radius: 8px;
            color: #155724;
            margin: 20px 0;
        }
        .warning {
            padding: 15px;
            background: #fff3cd;
            border-radius: 8px;
            color: #856404;
            margin: 20px 0;
        }
        code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro Unlock Installer</h1>
        
        <div class="status">
            ✅ Server is running: <strong>${CONFIG.HOSTNAME}</strong>
        </div>
        
        <div class="step">
            <h2>📱 Method 1: Auto Install (Recommended)</h2>
            <p>Click the button below to automatically install the configuration profile:</p>
            <div class="btn-container">
                <a href="/install.mobileconfig" class="btn">🔗 Install Profile Now</a>
            </div>
            <p>After clicking, follow the prompts on your iOS device.</p>
        </div>
        
        <div class="step">
            <h2>⚙️ Method 2: Manual Proxy Setup</h2>
            <p>If auto-install doesn't work, configure manually:</p>
            <ol>
                <li>Go to <strong>Settings → Wi-Fi</strong></li>
                <li>Tap the <strong>(i)</strong> icon next to your network</li>
                <li>Scroll to <strong>Configure Proxy</strong></li>
                <li>Select <strong>Auto</strong></li>
                <li>Enter URL: <code>https://${serverUrl}/proxy.pac</code></li>
                <li>Tap <strong>Save</strong></li>
            </ol>
        </div>
        
        <div class="step">
            <h2>🔧 Method 3: Using Apps</h2>
            <p>If you have these apps, use these proxy settings:</p>
            <ul>
                <li><strong>HTTP Catcher/Thor</strong>: Set proxy to <code>${serverUrl}:${CONFIG.PORT}</code></li>
                <li><strong>Shadowrocket/Quantumult X</strong>: Import this PAC URL</li>
            </ul>
        </div>
        
        <div class="warning">
            <h3>⚠️ Important Notes:</h3>
            <ul>
                <li>Keep this server running for the unlock to work</li>
                <li>You may need to restart the Locket app after setup</li>
                <li>Clear Locket app cache if features don't unlock immediately</li>
                <li>Works on both WiFi and Cellular data</li>
            </ul>
        </div>
        
        <div class="step">
            <h2>✅ Verification</h2>
            <p>After setup, open Locket app and check:</p>
            <ul>
                <li>All Pro features should be unlocked</li>
                <li>No ads should appear</li>
                <li>Gold/Premium badge should show</li>
            </ul>
            <p>Server Status: <a href="/health" style="color: #667eea;">Check Here</a></p>
        </div>
        
        <div style="text-align: center; margin-top: 40px; color: #666; font-size: 0.9em;">
            <p>Server: ${serverUrl} | Version: 2.0.0 | Updated: ${new Date().toLocaleDateString()}</p>
        </div>
    </div>
</body>
</html>`;
  
  res.send(html);
});

// 6. Status page
app.get('/status', (req, res) => {
  res.json({
    service: 'Locket Pro Unlock Proxy',
    version: '2.0.0',
    server: CONFIG.HOSTNAME,
    target: CONFIG.TARGET_DOMAIN,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      pac: '/proxy.pac',
      mobileconfig: '/install.mobileconfig',
      install: '/install',
      status: '/status'
    }
  });
});

// ================= ERROR HANDLING =================
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
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
    🚀 📱 Install URL: ${CONFIG.RENDER_URL}/install
    🚀 📄 PAC URL: ${CONFIG.RENDER_URL}/proxy.pac
    🚀 ⚙️ Health Check: ${CONFIG.RENDER_URL}/health
    🚀 ============================================
    🚀 Target: ${CONFIG.TARGET_DOMAIN}
    🚀 Fake Expiry: ${CONFIG.FAKE_EXPIRY_DATE}
    🚀 ============================================
    `);
  });

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🔄 Shutting down gracefully...');
    server.close(() => {
      console.log('👋 Server closed');
      process.exit(0);
    });
  });

  return server;
};

// ================= STARTUP =================
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, CONFIG };
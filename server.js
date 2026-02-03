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
        console.log('✅ Modified response for: ' + req.url);
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
  target: 'https://' + CONFIG.TARGET_DOMAIN,
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
    
    console.log('📤 Proxying: ' + req.method + ' ' + req.url);
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
  const serverHost = CONFIG.HOSTNAME.replace('https://', '').replace('http://', '');
  const pacScript = 'function FindProxyForURL(url, host) {\n' +
    '  // Direct connection for local addresses\n' +
    '  if (isPlainHostName(host) ||\n' +
    '      shExpMatch(host, "*.local") ||\n' +
    '      isInNet(dnsResolve(host), "10.0.0.0", "255.0.0.0") ||\n' +
    '      isInNet(dnsResolve(host), "172.16.0.0", "255.240.0.0") ||\n' +
    '      isInNet(dnsResolve(host), "192.168.0.0", "255.255.0.0") ||\n' +
    '      isInNet(dnsResolve(host), "127.0.0.0", "255.0.0.0")) {\n' +
    '    return "DIRECT";\n' +
    '  }\n' +
    '  \n' +
    '  // Proxy only RevenueCat API\n' +
    '  if (shExpMatch(host, "*.revenuecat.com") ||\n' +
    '      shExpMatch(host, "api.revenuecat.com") ||\n' +
    '      shExpMatch(host, "*.purchases-api.io")) {\n' +
    '    return "PROXY ' + CONFIG.HOSTNAME + ':' + CONFIG.PORT + '; " +\n' +
    '           "PROXY ' + serverHost + ':' + CONFIG.PORT + '; " +\n' +
    '           "DIRECT";\n' +
    '  }\n' +
    '  \n' +
    '  // All other traffic goes direct\n' +
    '  return "DIRECT";\n' +
    '}';
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pacScript);
  console.log('📄 Served PAC file');
});

// 4. SIMPLIFIED INSTALL PAGE (FIXED VERSION)
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro Unlock Setup</title>
    <style>
        body {
            font-family: -apple-system, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            color: white;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            color: #333;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        h1 {
            color: #764ba2;
            text-align: center;
            margin-bottom: 30px;
        }
        .step {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            margin: 20px 0;
            border-radius: 10px;
        }
        .code {
            background: #2d3748;
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            word-break: break-all;
            margin: 10px 0;
        }
        .btn {
            display: block;
            width: 100%;
            background: #667eea;
            color: white;
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 18px;
            font-weight: bold;
            margin: 20px 0;
            cursor: pointer;
        }
        .btn:hover {
            background: #764ba2;
        }
        .btn-copy {
            background: #38a169;
        }
        .btn-copy:hover {
            background: #2f855a;
        }
        .status {
            padding: 15px;
            background: #e9ecef;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro Unlock Setup</h1>
        
        <div class="step">
            <h3>Step 1: Open Wi-Fi Settings</h3>
            <p>Go to <strong>Settings → Wi-Fi</strong> on your iPhone</p>
        </div>
        
        <div class="step">
            <h3>Step 2: Configure Proxy</h3>
            <p>Tap the <strong>ⓘ</strong> icon next to your network</p>
            <p>Scroll to <strong>"Configure Proxy"</strong></p>
        </div>
        
        <div class="step">
            <h3>Step 3: Select Auto</h3>
            <p>Tap <strong>"Auto"</strong> (not Manual or Off)</p>
        </div>
        
        <div class="step">
            <h3>Step 4: Copy and Paste URL</h3>
            <p>Copy this URL:</p>
            <div class="code" id="pacUrl">https://locket-mobileconfig.onrender.com/proxy.pac</div>
            <button class="btn btn-copy" onclick="copyUrl()">📋 Copy URL</button>
            <p id="copyStatus"></p>
            <p>Paste into the URL field in Wi-Fi settings</p>
        </div>
        
        <div class="step">
            <h3>Step 5: Save</h3>
            <p>Tap <strong>"Save"</strong> in top right corner</p>
        </div>
        
        <div class="step">
            <h3>Step 6: Open Locket App</h3>
            <p>All Pro features should now be unlocked!</p>
        </div>
        
        <div class="status">
            <p>Server Status: <span id="serverStatus">Checking...</span></p>
            <button class="btn" onclick="checkServer()">Check Server</button>
        </div>
        
        <div style="text-align: center; margin-top: 30px; color: #666;">
            <p>Need help? Make sure proxy is enabled in Wi-Fi settings.</p>
        </div>
    </div>

    <script>
        // Copy URL function
        function copyUrl() {
            const url = document.getElementById('pacUrl').textContent;
            const status = document.getElementById('copyStatus');
            
            // Create temporary textarea
            const textArea = document.createElement('textarea');
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                status.textContent = '✅ Copied!';
                status.style.color = '#38a169';
            } catch (err) {
                status.textContent = '❌ Failed to copy. Please copy manually.';
                status.style.color = '#e53e3e';
            }
            
            document.body.removeChild(textArea);
            
            // Clear status after 3 seconds
            setTimeout(() => {
                status.textContent = '';
            }, 3000);
        }
        
        // Check server status
        function checkServer() {
            const status = document.getElementById('serverStatus');
            status.textContent = 'Checking...';
            
            fetch('https://locket-mobileconfig.onrender.com/health')
                .then(response => response.json())
                .then(data => {
                    status.textContent = '✅ Online';
                    status.style.color = '#38a169';
                })
                .catch(error => {
                    status.textContent = '❌ Offline';
                    status.style.color = '#e53e3e';
                });
        }
        
        // Auto-check on load
        window.onload = checkServer;
    </script>
</body>
</html>`;
  
  res.send(html);
});

// 5. Keep-alive endpoint
app.get('/keep-alive', (req, res) => {
  res.json({ 
    status: 'awake', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 6. Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Locket Unlock Proxy Test',
    status: 'active',
    version: '2.0.0'
  });
});

// 7. 404 handler
app.use((req, res) => {
  res.redirect('/install');
});

// ================= START SERVER =================
const startServer = () => {
  const server = app.listen(CONFIG.PORT, () => {
    console.log('\n🚀 LOCKET PRO UNLOCK PROXY v2.0');
    console.log('🚀 Server running on port: ' + CONFIG.PORT);
    console.log('🚀 Install Page: ' + CONFIG.RENDER_URL + '/install');
    console.log('🚀 PAC URL: ' + CONFIG.RENDER_URL + '/proxy.pac');
    console.log('🚀 Health Check: ' + CONFIG.RENDER_URL + '/health');
    console.log('🚀 Target: ' + CONFIG.TARGET_DOMAIN);
    console.log('🚀 Fake Expiry: ' + CONFIG.FAKE_EXPIRY_DATE);
    
    // Auto keep-alive
    setInterval(() => {
      const https = require('https');
      https.get(CONFIG.RENDER_URL + '/health', () => {
        console.log('🔄 Keep-alive ping sent');
      }).on('error', () => {
        console.log('⚠️ Keep-alive ping failed');
      });
    }, 300000);
  });

  process.on('SIGTERM', () => {
    console.log('🔄 Shutting down...');
    server.close(() => {
      console.log('👋 Server closed');
      process.exit(0);
    });
  });

  return server;
};

// Start server
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, CONFIG };

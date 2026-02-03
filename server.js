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
                           req.url.includes('/subscribers');
        
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'locket-unlock',
    timestamp: new Date().toISOString() 
  });
});

// PAC file
app.get('/proxy.pac', (req, res) => {
  const pac = `function FindProxyForURL(url, host) {
    if (shExpMatch(host, "api.revenuecat.com") || 
        shExpMatch(host, "*.revenuecat.com")) {
      return "PROXY ${CONFIG.HOSTNAME}:${CONFIG.PORT}; DIRECT";
    }
    return "DIRECT";
  }`;
  
  res.header('Content-Type', 'application/x-ns-proxy-autoconfig');
  res.send(pac);
});

// Install page
app.get('/install', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Locket Pro Unlock</title>
    <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; }
        .btn { display: inline-block; background: #007AFF; color: white; 
               padding: 15px 30px; border-radius: 10px; text-decoration: none;
               font-weight: bold; margin: 10px; }
        .step { background: #f5f5f7; padding: 20px; border-radius: 10px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎁 Locket Pro Unlock</h1>
        
        <div class="step">
            <h2>📱 Method 1: Auto Install</h2>
            <a href="/install.mobileconfig" class="btn">Install Profile</a>
            <p>Click and follow prompts on iPhone</p>
        </div>
        
        <div class="step">
            <h2>⚙️ Method 2: Manual Setup</h2>
            <p>Go to <strong>Settings → Wi-Fi</strong></p>
            <p>Tap <strong>(i)</strong> → <strong>Configure Proxy</strong> → <strong>Auto</strong></p>
            <p>URL: <code>https://${CONFIG.HOSTNAME}/proxy.pac</code></p>
        </div>
        
        <p>Server: ${CONFIG.HOSTNAME}:${CONFIG.PORT}</p>
    </div>
</body>
</html>`;
  
  res.send(html);
});

// Mobileconfig profile
app.get('/install.mobileconfig', (req, res) => {
  const uuid = () => crypto.randomUUID();
  const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.proxy.http.global</string>
            <key>PayloadIdentifier</key>
            <string>com.locket.proxy.${uuid()}</string>
            <key>PayloadUUID</key>
            <string>${uuid()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>ProxyType</key>
            <string>Auto</string>
            <key>ProxyAutoConfigURLString</key>
            <string>https://${CONFIG.HOSTNAME}/proxy.pac</string>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Locket Pro Unlock</string>
    <key>PayloadIdentifier</key>
    <string>com.locket.profile</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${uuid()}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;
  
  res.header('Content-Type', 'application/x-apple-aspen-config');
  res.header('Content-Disposition', 'attachment; filename="Locket-Unlock.mobileconfig"');
  res.send(mobileconfig);
});

// Proxy all other traffic
app.use('/', proxy);

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`
🚀 Server running on port: ${CONFIG.PORT}
📱 Install URL: http://${CONFIG.HOSTNAME}:${CONFIG.PORT}/install
📄 PAC URL: http://${CONFIG.HOSTNAME}:${CONFIG.PORT}/proxy.pac
  `);
});

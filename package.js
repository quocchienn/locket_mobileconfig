{
  "name": "locket-unlock-proxy",
  "version": "1.0.0",
  "description": "Reverse proxy to unlock Locket Pro features",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "generate-cert": "node generate-cert.js",
    "test": "node test-proxy.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "http-proxy-middleware": "^2.0.6",
    "node-forge": "^1.3.1",
    "crypto-js": "^4.1.1",
    "body-parser": "^1.20.2",
    "axios": "^1.6.2",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "keywords": ["locket", "unlock", "proxy", "revenuecat"],
  "author": "Locket Unlock Service",
  "license": "MIT"
}
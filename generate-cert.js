const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

console.log('🔐 Generating self-signed certificates...');

// Create CA certificate
const caKeys = forge.pki.rsa.generateKeyPair(2048);
const caCert = forge.pki.createCertificate();

caCert.publicKey = caKeys.publicKey;
caCert.serialNumber = '01';
caCert.validity.notBefore = new Date();
caCert.validity.notAfter = new Date();
caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

const caAttrs = [
  { name: 'commonName', value: 'Locket Unlock CA' },
  { name: 'countryName', value: 'US' },
  { shortName: 'ST', value: 'California' },
  { name: 'localityName', value: 'San Francisco' },
  { name: 'organizationName', value: 'Locket Unlock Service' },
  { shortName: 'OU', value: 'Certificate Authority' }
];

caCert.setSubject(caAttrs);
caCert.setIssuer(caAttrs);
caCert.setExtensions([
  { name: 'basicConstraints', cA: true },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true },
  { name: 'subjectKeyIdentifier' }
]);

caCert.sign(caKeys.privateKey, forge.md.sha256.create());

// Create server certificate
const serverKeys = forge.pki.rsa.generateKeyPair(2048);
const serverCert = forge.pki.createCertificate();

serverCert.publicKey = serverKeys.publicKey;
serverCert.serialNumber = '02';
serverCert.validity.notBefore = new Date();
serverCert.validity.notAfter = new Date();
serverCert.validity.notAfter.setFullYear(serverCert.validity.notBefore.getFullYear() + 1);

const serverAttrs = [
  { name: 'commonName', value: 'api.revenuecat.com' },
  { name: 'countryName', value: 'US' },
  { shortName: 'ST', value: 'California' },
  { name: 'localityName', value: 'San Francisco' },
  { name: 'organizationName', value: 'RevenueCat' },
  { shortName: 'OU', value: 'API Services' }
];

serverCert.setSubject(serverAttrs);
serverCert.setIssuer(caAttrs);
serverCert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  { 
    name: 'subjectAltName', 
    altNames: [
      { type: 2, value: 'api.revenuecat.com' },
      { type: 2, value: '*.revenuecat.com' }
    ]
  }
]);

serverCert.sign(caKeys.privateKey, forge.md.sha256.create());

// Convert to PEM format
const caCertPem = forge.pki.certificateToPem(caCert);
const caKeyPem = forge.pki.privateKeyToPem(caKeys.privateKey);
const serverCertPem = forge.pki.certificateToPem(serverCert);
const serverKeyPem = forge.pki.privateKeyToPem(serverKeys.privateKey);

// Save to files
const certDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

fs.writeFileSync(path.join(certDir, 'ca-cert.pem'), caCertPem);
fs.writeFileSync(path.join(certDir, 'ca-key.pem'), caKeyPem);
fs.writeFileSync(path.join(certDir, 'server-cert.pem'), serverCertPem);
fs.writeFileSync(path.join(certDir, 'server-key.pem'), serverKeyPem);

// Create .mobileconfig with embedded certificate
const mobileconfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <dict>
            <key>PayloadType</key>
            <string>com.apple.security.pem</string>
            <key>PayloadIdentifier</key>
            <string>com.locket.unlock.certificate</string>
            <key>PayloadUUID</key>
            <string>${require('crypto').randomUUID()}</string>
            <key>PayloadVersion</key>
            <integer>1</integer>
            <key>PayloadDisplayName</key>
            <string>Locket Unlock CA Certificate</string>
            <key>PayloadDescription</key>
            <string>Certificate for Locket Pro unlock service</string>
            <key>PayloadCertificateFileName</key>
            <string>locket-ca.crt</string>
            <key>PayloadContent</key>
            <data>${Buffer.from(caCertPem).toString('base64')}</data>
        </dict>
    </array>
    <key>PayloadDisplayName</key>
    <string>Locket CA Certificate</string>
    <key>PayloadIdentifier</key>
    <string>com.locket.unlock.cert</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>${require('crypto').randomUUID()}</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
</dict>
</plist>`;

fs.writeFileSync(path.join(certDir, 'ca-profile.mobileconfig'), mobileconfig);

console.log('✅ Certificates generated successfully!');
console.log('📁 Saved to:', certDir);
console.log('📱 CA Profile:', path.join(certDir, 'ca-profile.mobileconfig'));
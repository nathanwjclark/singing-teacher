# Private same-Wi-Fi HTTPS

Run `npm run https:prepare` once to create an application-specific local CA, server certificate and iPhone certificate profile in ignored `.local-certs/`. Keys are stored with owner-only permissions. Run it again if your Wi-Fi address changes; it reuses the CA so the phone does not need a new trust installation while that CA remains valid.

Run `npm run local:private` after `npm run build`. This starts the desktop app on loopback HTTP port 5173, the phone HTTPS endpoint bound only to the selected private Wi-Fi IPv4 on port 5174, and a certificate-setup page on that same private address on port 5175. The setup server serves only its tokenized instructions and public certificate profile, never private keys or session media. No public tunnel, cloud server, or router forwarding is created.

Open http://127.0.0.1:5173 and choose **Connect phone / QR**:

1. Scan the **first-time iPhone setup** QR. Download the certificate profile in Safari.
2. On iPhone, install **Singing Teacher Local HTTPS** in Settings → General → VPN & Device Management.
3. Enable **Singing Teacher Local CA** in Settings → General → About → Certificate Trust Settings. [Apple's instructions](https://support.apple.com/102390).
4. Scan the pairing QR in the desktop dialog. Both devices must remain on the same Wi-Fi.

The profile installs one root certificate, not MDM, a VPN, or a private key. The setup page and desktop dialog display its SHA-256 fingerprint. Remove the profile through VPN & Device Management when this local setup is no longer needed. A phone requires those manual trust steps before its camera/microphone can work securely. The desktop keeps using its existing localhost origin and browser data.

Captures and recordings retain their existing explicit controls. Some guest Wi-Fi networks block peer-to-peer connections; if setup is unreachable, move both devices onto a network allowing local device connections. There is no STUN/TURN cloud relay. Browser capture still does not expose raw measured TrueDepth/LiDAR.

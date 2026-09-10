# Local phone connection

No public server or CD is configured. `npm run build && npm run local` serves the desktop app and pairing API at http://127.0.0.1:5173. Captured bootstrap snapshots are stored in ignored `.local-data/captures/`; audio/video recordings stay in the browser until explicitly downloaded. Phone microphone audio uses a local WebRTC connection and is not saved by the server.

A phone needs a reachable **trusted HTTPS** address to use its camera and microphone. Plain `http://<laptop-ip>` is insufficient. Options are a local certificate authority installed/trusted on both devices, or a separately approved HTTPS tunnel/host. We have not published a tunnel or exposed a public server.

To run privately on the same Wi-Fi after provisioning a trusted certificate whose subjectAltName includes your laptop's local hostname or IP:

```sh
HOST=0.0.0.0 PORT=5173 HTTPS_CERT=/absolute/path/server.crt HTTPS_KEY=/absolute/path/server.key PHONE_BASE_URL=https://your-laptop.local:5173 npm run local
```

Open that HTTPS address on the laptop, use **Connect phone**, then scan the QR. Creating a pairing must be done from the same computer; each link has a random token and expires after 12 hours or a server restart. Both devices must trust the certificate. iOS certificate profile installation and full root-certificate trust are manual device setup steps. Never share the CA's private key.

If the laptop itself opens via its LAN address, the server still recognizes local interface addresses as the pairing creator. Camera and microphone permissions are explicit on the phone. Use front/profile/open-mouth/tongue instructions only as comfortable; skip any step. Browser photos are visible-surface evidence, not measured depth or reconstructed musculature. Raw TrueDepth/LiDAR remains a native-acquisition dependency.

Some guest Wi-Fi networks isolate devices. If pairing loads but live microphone cannot connect, check whether both devices can reach each other. There is no cloud STUN/TURN relay in this local prototype.

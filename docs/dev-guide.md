# 🛠 Developer Guide

*← [Back to README](../README.md)*

---

<details>
<summary>Tech stack</summary>

| Layer | Technology |
|---|---|
| App framework | [Apache Cordova](https://cordova.apache.org/) |
| Target platforms | Android (primary), Browser (planned) |
| UI | Vanilla JS + CSS — no framework |
| Auth | OAuth 2.0 (Google / Discord) via custom URL scheme |
| Background playback | Custom local Cordova plugin |
| Music controls | Custom local Cordova plugin |

> iOS is not planned. No Apple hardware, no Apple development.

</details>

<details>
<summary>Project structure</summary>

```
mobile/
├── www/                        # Web assets (the app itself)
│   ├── index.html              # App shell
│   ├── auth.js                 # OAuth login flow
│   ├── js/client/
│   │   ├── core/               # Shared utilities, file protocol
│   │   ├── playback/           # Audio engine, queue, runtime
│   │   ├── ui/                 # UI components (player, menus, sheets)
│   │   ├── library/            # Library tab logic
│   │   ├── search/             # Search logic
│   │   └── sync/               # Account state sync
│   └── styles/                 # CSS per feature/tab
├── local-plugins/              # Custom Cordova plugins
│   ├── cordova-plugin-starl-music-controls/
│   ├── cordova-plugin-starl-background/
│   └── cordova-plugin-starl-statusbar/
├── docs/                       # Documentation
├── config.xml                  # Cordova project config
└── package.json
```

</details>

<details>
<summary>Prerequisites</summary>

- [Node.js](https://nodejs.org/) v18+
- [Apache Cordova CLI](https://cordova.apache.org/docs/en/latest/guide/cli/) — `npm install -g cordova`
- [Android Studio](https://developer.android.com/studio) with Android SDK
- Java 17+

</details>

<details>
<summary>Setup & running</summary>

```bash
# Clone the repo
git clone https://github.com/everm4iva/starl.git
cd starl/mobile

# Install dependencies
npm install

# Add Android platform
cordova platform add android

# Point to your backend
# In www/auth.js and www/index.html, set:
#   window.STARL_API_BASE = 'https://your-server-url-here';
```

```bash
# Run on a connected device or emulator
npm start

# Build a release APK
cordova build android --release
```

</details>

<details>
<summary>Local plugins</summary>

The three local Cordova plugins (`music-controls`, `background`, `statusbar`) live in `local-plugins/` and are referenced by path — `npm install` picks them up automatically, no extra steps needed.

</details>

<details>
<summary>Backend</summary>

The backend is a separate project, not yet publicly available. The compiled releases connect to a public server run by the author. When the server is open-sourced, this section will be updated with a link and setup guide.

</details>

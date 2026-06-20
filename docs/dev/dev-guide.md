# Developer Guide

*- [Back to documentation](https://github.com/everm4iva/starl/blob/main/docs/index.md)*

---

### Overall Architecture

| Layer | Technology |
|---|---|
| App framework | [Apache Cordova](https://cordova.apache.org/) |
| Target platforms | Android (primary), Browser (planned) |
| UI | Vanilla JS + CSS - no framework |
| Auth | OAuth 2.0 (Google / Discord) via custom URL scheme |
| Background playback | Custom local Cordova plugin |
| Music controls | Custom local Cordova plugin |

> iOS is not planned. I don't own any apple stuff so no Apple development.

## Project structure

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
│   └── cordova-plugin-starl-splash/
│   └── ...
├── docs/                       # Documentation
├── config.xml                  # Cordova project config
└── package.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Apache Cordova CLI](https://cordova.apache.org/docs/en/latest/guide/cli/) - `npm install -g cordova`
- [Android Studio](https://developer.android.com/studio) with Android SDK
- Java 17+

## Setup & running

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

## Local plugins

The three local Cordova plugins (`music-controls`, `background`, `statusbar`) live in `local-plugins/` and are referenced by path - `npm install` picks them up automatically, no extra steps needed.

## Backend

It's planned to release a standalone executable server for you to config and host your own stuff, but for now.. it's not ready.
So i host a version of the executable server with auth for data protection and basic user handling.
When the server is open-sourced, this section will be updated with a link and setup guide.

### Backend architecture (for curious minds)

learn more about the backend architecture in [server-architecture.md](./server-architecture.md).
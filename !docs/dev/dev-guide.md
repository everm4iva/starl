# Developer Guide

*- [Back to documentation](../index.md)*



# -- Mobile Client --

### Overall Architecture

| Layer | Technology |
|---|---|
| App framework | [Apache Cordova](https://cordova.apache.org/) |
| Target platforms | Android (primary), Browser (planned) |
| UI | Vanilla JS + CSS - no framework |
| Auth | OAuth (Google / Discord) via custom URL scheme |
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

# -- Backend --

### Overall Architecture

| Layer | Technology |
|---|---|
| Target platforms | Windows, Linux, MacOS |
| UI | Vanilla JS + CSS |
| Runtime | Nodejs +22 + Python 3.14 (worker) |
| Packages | Express.js (nodejs) + YtDlp (Python) |
| Auth | Local accounts |

## Project structure

```
server/
├── pot-provider/               # Tool to fetch tokens from YouTube
├── web/                        # Web assets (the custom panel)
│   ├── index.html
│   ├── css/                    # Styles
│   ├── js/                     # Scripts logic
│   └── shc/                    # Icons
│   └── ...
├── worker/                     # Python workers for fetching
├── src/                  # Nodejs server code
│   ├── api/                    # API endpoints
│   ├── auth/                   # Authentication logic´
│   ├── jobs/                   # Background jobs (like cleaning cache)
│   ├── music/                    # Music providing logic
│   ├── routes/                   # Server routes (web + API)
│   ├── search/                    # Search logic
│   ├── security/                   # Security logic (like cors or rate limiting)
│   ├── stats/                   # Statistics logic
│   └── ...
└── package.json
```
## Prerequisites

- [Node.js](https://nodejs.org/) v21+
- [Python](https://www.python.org/) v3.14+

## Setup & running

```bash
# Clone the repo
git clone https://github.com/everm4iva/starl.git
cd starl/server

# Install dependencies (nodejs)
npm install

# Install dependencies (python)
cd worker
pip install -r requirements.txt

# -- Configure the server in the config file (config.json) --

# Run the server
npm start
# or run in development mode (auto-reload)
npm run dev
```

learn more about the backend architecture in [server-architecture.md](./server-architecture.md).

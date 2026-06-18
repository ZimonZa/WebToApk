# WebToApk

Turn **any website into a real mobile app** — Android now, iOS too. Paste a URL in a simple GUI,
click Build, download an APK. All the heavy building (Capacitor + Gradle/Xcode) runs **free in the
cloud on GitHub Actions**, so your PC needs nothing but Node.js — no Java, no 5 GB Android Studio.

```
 [ GUI on your PC ]  --config+icon-->  [ GitHub repo ]  --workflow_dispatch-->  [ GitHub Actions ]
        ^                                                                              |
        |---------------------------  APK download link  <----------- Release asset ---|
```

## How it works

1. The **GUI** (`gui/`) is a tiny local web app. You enter a website URL, app name, package id, color,
   and (optional) icon.
2. On **Build**, it uploads the icon to your GitHub repo and triggers a build **workflow** with your config.
3. The **workflow** runs `scripts/scaffold.mjs`, which copies the **Capacitor template** (`template/`),
   sets `server.url` to your website (this is what makes the app load your site fullscreen), adds the
   native platform, generates icons/splash, and builds.
4. The finished **APK** is published as a GitHub Release asset; the GUI shows a direct download link.

The same scaffold + template also targets **iOS** on a free macOS runner (see iOS section below).

---

## Setup (one time)

### 1. Create the builds repo
Create a GitHub repo (e.g. `WebToApk`) and push this project to it. The workflows in
`.github/workflows/` must live on the default branch (`main`).

```bash
git init
git add .
git commit -m "WebToApk"
git branch -M main
git remote add origin https://github.com/<you>/WebToApk.git
git push -u origin main
```

### 2. Make a GitHub token
Create a **fine-grained Personal Access Token** scoped to that repo with:
- **Contents:** Read and write
- **Actions:** Read and write
- **Workflows:** Read and write

### 3. Configure the GUI
```bash
cd gui
cp .env.example .env        # then edit .env: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO
npm install
npm start
```
Open **http://localhost:3000**, fill the form, click **Build app**. In ~3–6 min you get an APK link.

> The token stays in `gui/.env` (gitignored) and is never sent to the browser.

---

## Android

- Output is a **debug APK**, auto-signed with the debug keystore → installable on any Android phone for
  testing (enable "Install unknown apps"). Good for sharing and sideloading.
- **Google Play** needs a signed release **AAB**. To add that: generate a keystore with `keytool`, store
  it + passwords as GitHub **encrypted secrets**, and add a `bundleRelease` step. (Planned Phase 5.)

## iOS — free build, honest limits

Pick **iOS (simulator)** in the GUI to run `.github/workflows/build-ios.yml` on a free macOS runner.

- **Free:** an **unsigned simulator build** (`.app`) you can run in Xcode's iOS Simulator.
- **Real iPhone (free-ish):** open the generated `_build/ios` in Xcode on a Mac and run with a personal
  Apple ID — works for **7 days** per signing, your device only.
- **App Store / TestFlight / other people's iPhones:** requires the **Apple Developer Program ($99/yr)**
  for code signing. There is **no fully free path** to distribute an iOS app publicly. This is an Apple
  policy, not a WebToApk limit.

---

## Run the scaffold locally (optional, advanced)

You don't need this for normal use, but you can scaffold a Capacitor project on your own machine
(building it then needs JDK 17 + Android SDK):

```bash
APP_URL=https://example.com APP_NAME="Demo" APP_ID=com.demo.app node scripts/scaffold.mjs
# output project in _build/ ; then: cd _build/android && ./gradlew assembleDebug
```

## Config reference

| Field | Env var | Notes |
|---|---|---|
| Website URL | `APP_URL` | http(s), loaded fullscreen via Capacitor `server.url` |
| App name | `APP_NAME` | display name |
| Package id | `APP_ID` | reverse-DNS, e.g. `com.company.app` |
| Theme color | `THEME_COLOR` | hex `#RRGGBB`, used for icon/splash/background |
| Orientation | `ORIENTATION` | `default` \| `portrait` \| `landscape` (Android) |
| Icon | `ICON_PATH` / `ICON_URL` | square PNG ≥ 512px; default generated if omitted |

## Notes & limits

- The app loads the **live** website, so it needs internet. (Offline/bundled-site mode is a future option.)
- Make sure the site is mobile-responsive — the app is a fullscreen WebView of it.
- CI uses Node 20 + Java 17 for builds regardless of your local Node version.

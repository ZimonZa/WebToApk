# WebToApk

Turn **any website into a real mobile app** — Android now, iOS too. Use the hosted web app: paste a
URL, toggle permissions, watch a live preview, click **Build**, download an APK. All the heavy work
(Capacitor + Gradle/Xcode) runs **free in the cloud on GitHub Actions**. Nothing to install locally.

**Live app:** https://zimonza.github.io/WebToApk/

```
 [ web app in your browser ] --config.json + icon--> [ your GitHub repo ] --dispatch--> [ GitHub Actions ]
        ^                                                                                      |
        |------------------------------  APK download link  <----------- Release asset --------|
```

## How it works

1. The web app ([webapp/](webapp/)) is 100% client-side. It talks to the GitHub API directly with a
   token **you paste** (kept only in your browser's localStorage — never on any server).
2. On **Build**, it uploads `inputs/<buildId>/config.json` (+ your icon) to your repo and triggers a
   build workflow with just the `buildId`.
3. The workflow reads that config, runs [scripts/scaffold.mjs](scripts/scaffold.mjs) — which copies the
   Capacitor [template/](template/), points `server.url` at your website (this is what makes the app
   load your site fullscreen), applies your permissions/options, generates icons, and builds.
4. The APK is published as a GitHub **Release** asset; the app shows a direct download link.

## Setup (one time)

1. **Create a repo** (e.g. `WebToApk`) and push this project to it. Workflows must be on the default
   branch (`main`). Make the repo **public** if you want APK links that download without a login.
2. **Create a token** — a fine-grained PAT scoped to the repo with **Contents**, **Actions**, and
   **Workflows** = Read & write. (Classic PAT: scopes `repo` + `workflow`.)
3. Open the web app, **Connect GitHub** (owner, repo, branch, token), then build.

To host your own copy of the UI, GitHub Pages is enabled via
[.github/workflows/pages.yml](.github/workflows/pages.yml) (serves `webapp/`).

## App options

| Option | Effect |
|---|---|
| **Camera / Microphone / Location** | Declares the Android permission, requests it at runtime, and bridges the WebView so the wrapped site's `getUserMedia` / geolocation calls work. |
| **Notifications** | Declares `POST_NOTIFICATIONS` and requests it (Android 13+). |
| **Swipe to refresh** | Native `SwipeRefreshLayout` — pull down at the top of the page to reload. |
| **Show reload button** | A floating reload button inside the app. |
| **Orientation** | Free rotate / portrait / landscape lock. |
| **Theme color** | Icon, splash, status bar, and app background. |

> Camera/mic/location only do something if the **wrapped website's own JavaScript** asks for them —
> the app can't add features the site doesn't use.

## Android

- Output is a **debug APK**, auto-signed with the debug keystore → installable on any phone for testing.
- **Google Play** needs a signed release **AAB** (generate a keystore with `keytool`, store it as GitHub
  secrets, add a `bundleRelease` step) — not included yet.

## iOS — free build, honest limits

Pick **iOS (simulator)** to run [.github/workflows/build-ios.yml](.github/workflows/build-ios.yml) on a
free macOS runner → an **unsigned simulator build**. A real iPhone or the App Store needs the **Apple
Developer Program ($99/yr)** for code signing — there is no fully free path to distribute publicly.
iOS permission bridging is partial this pass (Info.plist usage strings are declared).

## Run the scaffold locally (advanced)

Building locally additionally needs JDK 17 + the Android SDK.

```bash
APP_URL=https://example.com APP_NAME="Demo" APP_ID=com.demo.app \
  PERM_CAMERA=true PERM_LOCATION=true PULL_REFRESH=true SHOW_RELOAD=true \
  node scripts/scaffold.mjs
# then: cd _build/android && ./gradlew assembleDebug
```

## Notes & limits

- The app loads the **live** website, so it needs internet. Make sure the site is mobile-responsive.
- The web app's live preview uses an `<iframe>`; many sites block embedding (X-Frame-Options/CSP) — the
  built app still loads them fine.
- CI builds with Node 20 + Java 17 regardless of your local Node version.

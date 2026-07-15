#!/usr/bin/env node
/**
 * scaffold.mjs — materialize a Capacitor project from a config, ready to build.
 *
 * Used by the GitHub Actions Android/iOS workflows (and runnable locally).
 * It does NOT run gradle/xcode — the workflow does that after this script
 * has produced the native project.
 *
 * Config comes from environment variables:
 *   APP_URL            (required)  https URL of the website to wrap
 *   APP_NAME           (required)  display name, e.g. "Gen B"
 *   APP_ID             (required)  reverse-DNS package id, e.g. com.genb.app
 *   THEME_COLOR        (optional)  hex, default #111827
 *   ORIENTATION        (optional)  default | portrait | landscape
 *   ICON_PATH          (optional)  path to a source PNG (>=1024px square)
 *   ICON_URL           (optional)  URL to a source PNG (used if ICON_PATH unset)
 *   OUT_DIR            (optional)  output project dir (default: ./_build)
 *   PLATFORM           (optional)  android | ios | both (default: android)
 *   PERM_CAMERA        (optional)  "true"/"false" — allow site to use the camera
 *   PERM_MIC           (optional)  "true"/"false" — allow site to use the microphone
 *   PERM_LOCATION      (optional)  "true"/"false" — allow site to use geolocation
 *   PERM_NOTIFICATIONS (optional)  "true"/"false" — declare POST_NOTIFICATIONS
 *   PULL_REFRESH       (optional)  "true"/"false" — swipe-down to reload
 *   SHOW_RELOAD        (optional)  "true"/"false" — floating reload button
 *
 * Run locally:
 *   APP_URL=https://example.com APP_NAME="Demo" APP_ID=com.demo.app node scripts/scaffold.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TEMPLATE = join(ROOT, 'template');

// ---- read + validate config ------------------------------------------------
const bool = (v) => String(v ?? '').toLowerCase() === 'true';
const cfg = {
  url: process.env.APP_URL,
  name: process.env.APP_NAME,
  id: process.env.APP_ID,
  theme: process.env.THEME_COLOR || '#111827',
  orientation: (process.env.ORIENTATION || 'default').toLowerCase(),
  iconPath: process.env.ICON_PATH || '',
  iconUrl: process.env.ICON_URL || '',
  outDir: resolve(ROOT, process.env.OUT_DIR || '_build'),
  platform: (process.env.PLATFORM || 'android').toLowerCase(),
  perms: {
    camera: bool(process.env.PERM_CAMERA),
    mic: bool(process.env.PERM_MIC),
    location: bool(process.env.PERM_LOCATION),
    notifications: bool(process.env.PERM_NOTIFICATIONS),
  },
  pullRefresh: bool(process.env.PULL_REFRESH),
  showReload: bool(process.env.SHOW_RELOAD),
};

function fail(msg) {
  console.error(`\n✖ scaffold: ${msg}\n`);
  process.exit(1);
}

if (!cfg.url || !/^https?:\/\//i.test(cfg.url)) fail('APP_URL must be a valid http(s) URL');
if (!cfg.name) fail('APP_NAME is required');
if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(cfg.id || '')) {
  fail('APP_ID must be reverse-DNS, e.g. com.company.app');
}
if (!/^#[0-9a-fA-F]{6}$/.test(cfg.theme)) fail('THEME_COLOR must be hex like #111827');
if (!['default', 'portrait', 'landscape'].includes(cfg.orientation)) {
  fail('ORIENTATION must be default | portrait | landscape');
}

const run = (cmd, cwd = cfg.outDir) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
};

// ---- 1. fresh output dir from template -------------------------------------
console.log(`→ Building "${cfg.name}" (${cfg.id}) wrapping ${cfg.url}`);
console.log(`  permissions: ${Object.entries(cfg.perms).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}` +
  ` | pull-refresh: ${cfg.pullRefresh} | reload-btn: ${cfg.showReload}`);
if (existsSync(cfg.outDir)) rmSync(cfg.outDir, { recursive: true, force: true });
mkdirSync(cfg.outDir, { recursive: true });
cpSync(TEMPLATE, cfg.outDir, { recursive: true });

// ---- 2. write capacitor.config.json (JSON, not TS) -------------------------
// JSON avoids the Capacitor CLI's TypeScript-config parser, which needs the
// `typescript` package and breaks on newer Node ("...reading 'CommonJS'").
const capConfig = {
  appId: cfg.id,
  appName: cfg.name,
  webDir: 'www',
  server: { url: cfg.url, androidScheme: 'https', cleartext: false },
  android: { backgroundColor: cfg.theme },
  ios: { backgroundColor: cfg.theme },
};
writeFileSync(join(cfg.outDir, 'capacitor.config.json'), JSON.stringify(capConfig, null, 2));
rmSync(join(cfg.outDir, 'capacitor.config.template.ts'), { force: true });

// substitute theme color into the loading shell
const shellPath = join(cfg.outDir, 'www', 'index.html');
writeFileSync(shellPath, readFileSync(shellPath, 'utf8').replaceAll('__THEME_COLOR__', cfg.theme));

// ---- 3. install Capacitor deps ---------------------------------------------
run('npm install --no-audit --no-fund');

// ---- 4. prepare source icon at assets/logo.png (1024x1024) ------------------
async function prepareIcon() {
  // Resolve sharp from the freshly-installed project (CJS) — works cross-platform,
  // unlike await import() of a raw Windows path (d:\... is not a valid file:// URL).
  const requireFromOut = createRequire(join(cfg.outDir, 'package.json'));
  const sharp = requireFromOut('sharp');
  const assetsDir = join(cfg.outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const out = join(assetsDir, 'logo.png');

  let srcBuf = null;
  if (cfg.iconPath && existsSync(cfg.iconPath)) {
    srcBuf = readFileSync(cfg.iconPath);
  } else if (cfg.iconUrl) {
    const res = await fetch(cfg.iconUrl);
    if (res.ok) srcBuf = Buffer.from(await res.arrayBuffer());
  }

  if (srcBuf) {
    await sharp(srcBuf).resize(1024, 1024, { fit: 'cover' }).png().toFile(out);
    console.log('→ icon: using supplied image');
  } else {
    // default icon: theme-colored rounded square with the app's first letter
    const letter = (cfg.name.trim()[0] || 'A').toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <rect width="1024" height="1024" rx="220" fill="${cfg.theme}"/>
      <text x="50%" y="52%" font-family="Arial, sans-serif" font-size="560"
        font-weight="700" fill="#ffffff" text-anchor="middle"
        dominant-baseline="central">${letter}</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log('→ icon: generated default');
  }
  // splash reuses the logo on a theme background
  await sharp({
    create: { width: 2732, height: 2732, channels: 4, background: cfg.theme },
  })
    .composite([{ input: await sharp(out).resize(640, 640).toBuffer(), gravity: 'centre' }])
    .png()
    .toFile(join(assetsDir, 'splash.png'));
}

// ---- 5. add native platform(s) ---------------------------------------------
const wantAndroid = cfg.platform === 'android' || cfg.platform === 'both';
const wantIos = cfg.platform === 'ios' || cfg.platform === 'both';
if (wantAndroid) run('npx --no-install cap add android');
if (wantIos) run('npx --no-install cap add ios');

// ---- 6. generate icons + splash --------------------------------------------
await prepareIcon();
const assetFlags = [
  wantAndroid ? '--android' : '',
  wantIos ? '--ios' : '',
  `--iconBackgroundColor "${cfg.theme}"`,
  `--splashBackgroundColor "${cfg.theme}"`,
].filter(Boolean).join(' ');
run(`npx --no-install @capacitor/assets generate ${assetFlags}`);

// ---- 7. Android native patches (permissions, WebView bridging, options) -----
if (wantAndroid) patchAndroid();
if (wantIos) patchIos();

function patchAndroid() {
  const androidDir = join(cfg.outDir, 'android');

  // 7a. AndroidManifest permissions ----------------------------------------
  const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (existsSync(manifestPath)) {
    let xml = readFileSync(manifestPath, 'utf8');
    const perms = [];
    if (cfg.perms.camera) perms.push('android.permission.CAMERA');
    if (cfg.perms.mic) perms.push('android.permission.RECORD_AUDIO');
    if (cfg.perms.location) perms.push('android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION');
    if (cfg.perms.notifications) perms.push('android.permission.POST_NOTIFICATIONS');
    const lines = perms
      .filter((p) => !xml.includes(p))
      .map((p) => `    <uses-permission android:name="${p}" />`);
    if (cfg.perms.camera && !xml.includes('android.hardware.camera')) {
      lines.push('    <uses-feature android:name="android.hardware.camera" android:required="false" />');
    }
    if (lines.length) {
      xml = xml.replace(/(<manifest[^>]*>)/, `$1\n${lines.join('\n')}`);
    }
    // orientation lock (kept from v1)
    if (cfg.orientation !== 'default' && !/android:screenOrientation/.test(xml)) {
      xml = xml.replace(
        /(<activity\b[^>]*android:name="\.MainActivity")/,
        `$1\n            android:screenOrientation="${cfg.orientation}"`,
      );
    }
    writeFileSync(manifestPath, xml);
    console.log(`→ manifest: +${perms.length} permission(s)`);
  }

  // 7b. MainActivity.java — WebView permission bridge + pull-refresh + reload -
  const pkgPath = cfg.id.split('.').join('/');
  const javaDir = join(androidDir, 'app', 'src', 'main', 'java', pkgPath);
  mkdirSync(javaDir, { recursive: true });
  writeFileSync(join(javaDir, 'MainActivity.java'), mainActivityJava());
  console.log('→ MainActivity.java: WebView bridge written');

  // 7c. build.gradle — always add swiperefresh dep so the import resolves -----
  const gradlePath = join(androidDir, 'app', 'build.gradle');
  if (existsSync(gradlePath)) {
    let g = readFileSync(gradlePath, 'utf8');
    const dep = 'implementation "androidx.swiperefreshlayout:swiperefreshlayout:1.1.0"';
    if (!g.includes('swiperefreshlayout')) {
      g = g.replace(/dependencies\s*\{/, `dependencies {\n    ${dep}`);
      writeFileSync(gradlePath, g);
      console.log('→ build.gradle: +swiperefreshlayout');
    }
  }
}

function mainActivityJava() {
  const b = (v) => (v ? 'true' : 'false');
  return `package ${cfg.id};

import android.Manifest;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewTreeObserver;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageButton;

import androidx.core.app.ActivityCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final boolean ENABLE_PULL_REFRESH = ${b(cfg.pullRefresh)};
    private static final boolean ENABLE_RELOAD_BTN = ${b(cfg.showReload)};
    private static final boolean PERM_CAMERA = ${b(cfg.perms.camera)};
    private static final boolean PERM_MIC = ${b(cfg.perms.mic)};
    private static final boolean PERM_LOCATION = ${b(cfg.perms.location)};
    private static final boolean PERM_NOTIFICATIONS = ${b(cfg.perms.notifications)};

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final WebView webView = this.getBridge().getWebView();

        // Let the wrapped website use geolocation + camera/mic through the WebView.
        webView.getSettings().setGeolocationEnabled(true);
        webView.setWebChromeClient(new BridgeWebChromeClient(this.getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { request.grant(request.getResources()); }
                });
            }
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        requestEnabledPermissions();

        if (ENABLE_PULL_REFRESH) { setupPullToRefresh(webView); }
        if (ENABLE_RELOAD_BTN) { addReloadButton(webView); }
    }

    private void requestEnabledPermissions() {
        List<String> perms = new ArrayList<>();
        if (PERM_CAMERA) perms.add(Manifest.permission.CAMERA);
        if (PERM_MIC) perms.add(Manifest.permission.RECORD_AUDIO);
        if (PERM_LOCATION) {
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            perms.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (PERM_NOTIFICATIONS && Build.VERSION.SDK_INT >= 33) {
            perms.add("android.permission.POST_NOTIFICATIONS");
        }
        if (!perms.isEmpty()) {
            ActivityCompat.requestPermissions(this, perms.toArray(new String[0]), 100);
        }
    }

    private void setupPullToRefresh(final WebView webView) {
        final ViewGroup parent = (ViewGroup) webView.getParent();
        if (parent == null) return;
        final int index = parent.indexOfChild(webView);
        final ViewGroup.LayoutParams lp = webView.getLayoutParams();
        parent.removeView(webView);
        final SwipeRefreshLayout swipe = new SwipeRefreshLayout(this);
        swipe.addView(webView, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        parent.addView(swipe, index, lp);
        swipe.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override public void onRefresh() {
                webView.reload();
                new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                    @Override public void run() { swipe.setRefreshing(false); }
                }, 1200);
            }
        });
        // Only allow the pull gesture when the page is scrolled to the very top.
        webView.getViewTreeObserver().addOnScrollChangedListener(new ViewTreeObserver.OnScrollChangedListener() {
            @Override public void onScrollChanged() { swipe.setEnabled(webView.getScrollY() == 0); }
        });
    }

    private void addReloadButton(final WebView webView) {
        final ImageButton btn = new ImageButton(this);
        btn.setImageResource(android.R.drawable.ic_menu_rotate);
        btn.setBackgroundColor(0x66000000);
        btn.setColorFilter(0xFFFFFFFF);
        final FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(140, 140);
        lp.gravity = Gravity.BOTTOM | Gravity.END;
        lp.setMargins(0, 0, 48, 96);
        btn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { webView.reload(); }
        });
        final FrameLayout root = (FrameLayout) findViewById(android.R.id.content);
        root.addView(btn, lp);
    }
}
`;
}

function patchIos() {
  const plist = join(cfg.outDir, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(plist)) return;
  let xml = readFileSync(plist, 'utf8');
  const keys = [];
  if (cfg.perms.camera) keys.push(['NSCameraUsageDescription', `${cfg.name} needs the camera for this website.`]);
  if (cfg.perms.mic) keys.push(['NSMicrophoneUsageDescription', `${cfg.name} needs the microphone for this website.`]);
  if (cfg.perms.location) keys.push(['NSLocationWhenInUseUsageDescription', `${cfg.name} needs your location for this website.`]);
  const block = keys
    .filter(([k]) => !xml.includes(k))
    .map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`)
    .join('\n');
  if (block) {
    xml = xml.replace(/<dict>/, `<dict>\n${block}`);
    writeFileSync(plist, xml);
    console.log(`→ Info.plist: +${keys.length} usage description(s)`);
  }
}

// ---- 8. sync ---------------------------------------------------------------
run('npx --no-install cap sync');

console.log(`\n✔ scaffold complete → ${cfg.outDir}`);
if (wantAndroid) console.log('  Android project: _build/android (run gradlew assembleDebug)');
if (wantIos) console.log('  iOS project: _build/ios (build on macOS / Xcode)');

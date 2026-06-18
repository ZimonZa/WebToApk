#!/usr/bin/env node
/**
 * scaffold.mjs — materialize a Capacitor project from a config, ready to build.
 *
 * Used by the GitHub Actions Android/iOS workflows (and runnable locally).
 * It does NOT run gradle/xcode — the workflow does that after this script
 * has produced the native project.
 *
 * Config comes from environment variables:
 *   APP_URL       (required)  https URL of the website to wrap
 *   APP_NAME      (required)  display name, e.g. "Gen B"
 *   APP_ID        (required)  reverse-DNS package id, e.g. com.genb.app
 *   THEME_COLOR   (optional)  hex, default #111827
 *   ORIENTATION   (optional)  default | portrait | landscape  (default: default)
 *   ICON_PATH     (optional)  path to a source PNG (>=1024px square)
 *   ICON_URL      (optional)  URL to a source PNG (used if ICON_PATH unset)
 *   OUT_DIR       (optional)  output project dir (default: ./_build)
 *   PLATFORM      (optional)  android | ios | both (default: android)
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
if (existsSync(cfg.outDir)) rmSync(cfg.outDir, { recursive: true, force: true });
mkdirSync(cfg.outDir, { recursive: true });
cpSync(TEMPLATE, cfg.outDir, { recursive: true });

// ---- 2. write capacitor.config.ts from template ----------------------------
const replaceAll = (s) =>
  s.replaceAll('__APP_ID__', cfg.id)
    .replaceAll('__APP_NAME__', cfg.name)
    .replaceAll('__APP_URL__', cfg.url)
    .replaceAll('__THEME_COLOR__', cfg.theme);

const capTplPath = join(cfg.outDir, 'capacitor.config.template.ts');
writeFileSync(join(cfg.outDir, 'capacitor.config.ts'), replaceAll(readFileSync(capTplPath, 'utf8')));
rmSync(capTplPath, { force: true });

// substitute theme color into the loading shell too
const shellPath = join(cfg.outDir, 'www', 'index.html');
writeFileSync(shellPath, replaceAll(readFileSync(shellPath, 'utf8')));

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

// ---- 7. best-effort orientation lock (Android) -----------------------------
if (wantAndroid && cfg.orientation !== 'default') {
  const manifest = join(cfg.outDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (existsSync(manifest)) {
    let xml = readFileSync(manifest, 'utf8');
    if (!/android:screenOrientation/.test(xml)) {
      xml = xml.replace(
        /(<activity\b[^>]*android:name="\.MainActivity")/,
        `$1\n            android:screenOrientation="${cfg.orientation}"`,
      );
      writeFileSync(manifest, xml);
      console.log(`→ orientation locked to ${cfg.orientation}`);
    }
  }
}

// ---- 8. sync ---------------------------------------------------------------
run('npx --no-install cap sync');

console.log(`\n✔ scaffold complete → ${cfg.outDir}`);
console.log(wantAndroid ? '  Android project: _build/android (run gradlew assembleDebug)' : '');
console.log(wantIos ? '  iOS project: _build/ios (build on macOS / Xcode)' : '');

/**
 * WebToApk GUI server.
 *
 * Serves a form (public/) and turns "paste URL -> Build" into:
 *   1. upload icon to the builds repo via the GitHub Contents API (optional)
 *   2. dispatch the Android (or iOS) build workflow with the app config
 *   3. let the browser poll build status + grab the APK download link
 *
 * All heavy lifting (Capacitor + gradle) runs in GitHub Actions — this server
 * needs only Node. The GitHub token lives in gui/.env and is never sent to the
 * browser.
 */
import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __dirname = dirname(fileURLToPath(import.meta.url));

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
  PORT = 3000,
} = process.env;

const WORKFLOWS = { android: 'build-android.yml', ios: 'build-ios.yml' };
const GH = 'https://api.github.com';

const app = express();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB icon cap
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- GitHub REST helper -----------------------------------------------------
async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || res.statusText;
    const err = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function configError() {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return 'Server not configured. Copy gui/.env.example to gui/.env and set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.';
  }
  return null;
}

function validate({ url, appName, packageId, themeColor, orientation }) {
  if (!url || !/^https?:\/\/.+/i.test(url)) return 'Enter a valid http(s) URL.';
  if (!appName || !appName.trim()) return 'Enter an app name.';
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(packageId || '')) {
    return 'Package id must be reverse-DNS, e.g. com.company.app';
  }
  if (themeColor && !/^#[0-9a-fA-F]{6}$/.test(themeColor)) return 'Theme color must be hex like #111827.';
  if (orientation && !['default', 'portrait', 'landscape'].includes(orientation)) {
    return 'Bad orientation.';
  }
  return null;
}

// --- tell the UI whether the server is ready --------------------------------
app.get('/api/config', (_req, res) => {
  res.json({
    configured: !configError(),
    error: configError(),
    owner: GITHUB_OWNER || null,
    repo: GITHUB_REPO || null,
  });
});

// --- start a build ----------------------------------------------------------
app.post('/api/build', upload.single('icon'), async (req, res) => {
  const cfgErr = configError();
  if (cfgErr) return res.status(400).json({ error: cfgErr });

  const platform = req.body.platform === 'ios' ? 'ios' : 'android';
  const fields = {
    url: req.body.url?.trim(),
    appName: req.body.appName?.trim(),
    packageId: req.body.packageId?.trim().toLowerCase(),
    themeColor: (req.body.themeColor || '#111827').trim(),
    orientation: req.body.orientation || 'default',
  };
  const bad = validate(fields);
  if (bad) return res.status(400).json({ error: bad });

  const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // 1. upload icon (optional) to inputs/<buildId>/icon.png
    if (req.file) {
      await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/inputs/${buildId}/icon.png`, {
        method: 'PUT',
        body: {
          message: `webtoapk: icon for ${buildId}`,
          content: req.file.buffer.toString('base64'),
          branch: GITHUB_BRANCH,
        },
      });
    }

    // 2. dispatch the workflow
    const inputs = {
      url: fields.url,
      appName: fields.appName,
      packageId: fields.packageId,
      themeColor: fields.themeColor,
      buildId,
    };
    if (platform === 'android') inputs.orientation = fields.orientation;

    await gh(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOWS[platform]}/dispatches`,
      { method: 'POST', body: { ref: GITHUB_BRANCH, inputs } },
    );

    res.json({ buildId, platform, dispatchedAt: Date.now() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- poll build status ------------------------------------------------------
app.get('/api/status', async (req, res) => {
  const cfgErr = configError();
  if (cfgErr) return res.status(400).json({ error: cfgErr });

  const { buildId, platform = 'android' } = req.query;
  if (!buildId) return res.status(400).json({ error: 'buildId required' });

  try {
    // success path: a Release tagged build-<buildId> means the APK is ready
    try {
      const rel = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/build-${buildId}`);
      const asset = (rel.assets || []).find((a) => a.name.endsWith('.apk')) || rel.assets?.[0];
      if (asset) {
        return res.json({
          state: 'success',
          downloadUrl: asset.browser_download_url,
          releaseUrl: rel.html_url,
        });
      }
    } catch (e) {
      if (e.status !== 404) throw e; // 404 = not ready yet, keep polling
    }

    // otherwise report the latest run of this workflow for progress/UX
    const file = WORKFLOWS[platform] || WORKFLOWS.android;
    const runs = await gh(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${file}/runs?event=workflow_dispatch&per_page=5`,
    );
    const run = runs.workflow_runs?.[0];
    res.json({
      state: run ? (run.status === 'completed' ? run.conclusion : run.status) : 'pending',
      runUrl: run?.html_url || null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  WebToApk GUI → http://localhost:${PORT}`);
  if (configError()) console.log(`  ⚠ ${configError()}`);
  else console.log(`  repo: ${GITHUB_OWNER}/${GITHUB_REPO} (branch ${GITHUB_BRANCH})\n`);
});

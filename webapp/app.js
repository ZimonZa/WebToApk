// WebToApk — fully client-side builder. Talks to the GitHub REST API directly
// from the browser using a token the user pastes (kept only in localStorage).
const $ = (id) => document.getElementById(id);
const WORKFLOWS = { android: 'build-android.yml', ios: 'build-ios.yml' };
let platform = 'android';
let pollTimer = null;

// ---- persisted connection --------------------------------------------------
const LS = 'webtoapk_conn';
function loadConn() {
  try {
    const c = JSON.parse(localStorage.getItem(LS) || '{}');
    if (c.owner) $('owner').value = c.owner;
    if (c.repo) $('repo').value = c.repo;
    if (c.branch) $('branch').value = c.branch;
    if (c.token) $('token').value = c.token;
    if (c.owner && c.repo && c.token) $('connSaved').style.display = 'inline';
  } catch { /* ignore */ }
}
function conn() {
  return {
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: ($('branch').value.trim() || 'main'),
    token: $('token').value.trim(),
  };
}
$('saveConn').addEventListener('click', () => {
  const c = conn();
  if (!c.owner || !c.repo || !c.token) { alert('Fill owner, repo and token first.'); return; }
  localStorage.setItem(LS, JSON.stringify(c));
  $('connSaved').style.display = 'inline';
  setStatus('Connection saved. Now build an app below.', 'ok');
});
loadConn();

// ---- UI wiring -------------------------------------------------------------
$('themeColorPick').addEventListener('input', (e) => ($('themeColor').value = e.target.value));
$('themeColor').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('themeColorPick').value = e.target.value; });
$('platformSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  $('platformSeg').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); platform = b.dataset.p;
  $('iosNote').style.display = platform === 'ios' ? 'block' : 'none';
  $('buildBtn').textContent = platform === 'ios' ? 'Build iOS app' : 'Build app';
}));
$('url').addEventListener('blur', () => {
  if ($('packageId').value.trim()) return;
  try {
    const host = new URL($('url').value).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean).reverse();
    if (parts.length >= 2) $('packageId').value = (parts.join('.') + '.app').toLowerCase().replace(/[^a-z0-9.]/g, '');
  } catch { /* ignore */ }
});

function setStatus(text, kind) {
  $('status').classList.add('show');
  $('statusText').textContent = text;
  $('dot').className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
}

// ---- GitHub API helper -----------------------------------------------------
async function gh(c, path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null; // dispatch
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error((data && data.message) || res.statusText); e.status = res.status; throw e; }
  return data;
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});

function validate(c, f) {
  if (!c.owner || !c.repo || !c.token) return 'Connect GitHub first (step 1).';
  if (!/^https?:\/\/.+/i.test(f.url)) return 'Enter a valid http(s) URL.';
  if (!f.appName) return 'Enter an app name.';
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(f.packageId)) return 'Package id must be reverse-DNS, e.g. com.company.app';
  if (!/^#[0-9a-fA-F]{6}$/.test(f.themeColor)) return 'Theme color must be hex like #111827.';
  return null;
}

// ---- build -----------------------------------------------------------------
$('buildBtn').addEventListener('click', async () => {
  clearInterval(pollTimer);
  $('result').innerHTML = '';
  const c = conn();
  const f = {
    url: $('url').value.trim(), appName: $('appName').value.trim(),
    packageId: $('packageId').value.trim().toLowerCase(),
    themeColor: $('themeColor').value.trim(), orientation: $('orientation').value,
  };
  const bad = validate(c, f);
  if (bad) { setStatus(bad, 'err'); return; }

  $('buildBtn').disabled = true;
  const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    // 1. optional icon → commit to inputs/<buildId>/icon.png
    const iconFile = $('icon').files[0];
    if (iconFile) {
      setStatus('Uploading icon…');
      await gh(c, `/repos/${c.owner}/${c.repo}/contents/inputs/${buildId}/icon.png`, {
        method: 'PUT',
        body: { message: `webtoapk: icon ${buildId}`, content: await fileToBase64(iconFile), branch: c.branch },
      });
    }
    // 2. dispatch workflow
    setStatus('Dispatching build to GitHub Actions…');
    const inputs = { url: f.url, appName: f.appName, packageId: f.packageId, themeColor: f.themeColor, buildId };
    if (platform === 'android') inputs.orientation = f.orientation;
    await gh(c, `/repos/${c.owner}/${c.repo}/actions/workflows/${WORKFLOWS[platform]}/dispatches`, {
      method: 'POST', body: { ref: c.branch, inputs },
    });
    setStatus('Build queued — compiling in the cloud (~3–6 min)…');
    pollStatus(c, buildId);
  } catch (e) {
    setStatus(e.status === 401 ? 'Bad token (401). Check scopes/expiry.' : e.message, 'err');
    $('buildBtn').disabled = false;
  }
});

function pollStatus(c, buildId) {
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries++;
    if (tries > 120) { clearInterval(pollTimer); setStatus('Timed out — check the Actions tab.', 'err'); $('buildBtn').disabled = false; return; }
    try {
      // success: a Release tagged build-<buildId> means the artifact is ready
      try {
        const rel = await gh(c, `/repos/${c.owner}/${c.repo}/releases/tags/build-${buildId}`);
        const asset = (rel.assets || []).find((a) => a.name.endsWith('.apk')) || rel.assets?.[0];
        if (asset) {
          clearInterval(pollTimer);
          setStatus('Done! Your app is ready.', 'ok');
          $('result').innerHTML = `<a class="dl" href="${asset.browser_download_url}">⬇ Download ${asset.name}</a>
            <div style="margin-top:10px"><a class="link" href="${rel.html_url}" target="_blank">View release on GitHub</a></div>`;
          $('buildBtn').disabled = false;
          return;
        }
      } catch (e) { if (e.status !== 404) throw e; }
      // progress from latest run
      const file = WORKFLOWS[platform];
      const runs = await gh(c, `/repos/${c.owner}/${c.repo}/actions/workflows/${file}/runs?event=workflow_dispatch&per_page=1`);
      const run = runs.workflow_runs?.[0];
      const state = run ? (run.status === 'completed' ? run.conclusion : run.status) : 'queued';
      if (state === 'failure' || state === 'cancelled') {
        clearInterval(pollTimer);
        setStatus(`Build ${state}.`, 'err');
        if (run) $('result').innerHTML = `<a class="link" href="${run.html_url}" target="_blank">Open build logs</a>`;
        $('buildBtn').disabled = false;
        return;
      }
      setStatus(`${platform === 'ios' ? 'Building iOS app' : 'Building APK'}… (${state})`);
      if (run) $('result').innerHTML = `<a class="link" href="${run.html_url}" target="_blank">Watch live logs</a>`;
    } catch (e) {
      setStatus(e.message, 'err');
    }
  }, 5000);
}

// WebToApk — fully client-side builder + live preview.
// Talks to the GitHub REST API directly from the browser using a token the
// user pastes (kept only in localStorage). No backend, no server secret.
const $ = (id) => document.getElementById(id);
const WORKFLOWS = { android: 'build-android.yml', ios: 'build-ios.yml' };
let platform = 'android';
let pollTimer = null;
let iconDataUrl = null; // object URL of an uploaded icon, for the preview

// ---- persisted connection --------------------------------------------------
const LS = 'webtoapk_conn';
function loadConn() {
  try {
    const c = JSON.parse(localStorage.getItem(LS) || '{}');
    if (c.owner) $('owner').value = c.owner;
    if (c.repo) $('repo').value = c.repo;
    if (c.branch) $('branch').value = c.branch;
    if (c.token) $('token').value = c.token;
  } catch { /* ignore */ }
  refreshConnChip();
}
function conn() {
  return {
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: ($('branch').value.trim() || 'main'),
    token: $('token').value.trim(),
  };
}
function refreshConnChip() {
  const c = conn();
  const chip = $('connChip');
  if (c.owner && c.repo && c.token) {
    chip.classList.add('on');
    $('connChipText').textContent = `${c.owner}/${c.repo}`;
  } else {
    chip.classList.remove('on');
    $('connChipText').textContent = 'Not connected';
  }
}
$('connChip').addEventListener('click', () => $('owner').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('saveConn').addEventListener('click', () => {
  const c = conn();
  if (!c.owner || !c.repo || !c.token) { alert('Fill owner, repo and token first.'); return; }
  localStorage.setItem(LS, JSON.stringify(c));
  refreshConnChip();
  setStatus('Connection saved. Now build an app below.', 'ok');
});

// ---- UI wiring -------------------------------------------------------------
['owner', 'repo', 'branch', 'token'].forEach((id) => $(id).addEventListener('input', refreshConnChip));
$('themeColorPick').addEventListener('input', (e) => { $('themeColor').value = e.target.value; updatePreview(); });
$('themeColor').addEventListener('input', (e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('themeColorPick').value = e.target.value; updatePreview(); });
['appName', 'url'].forEach((id) => $(id).addEventListener('input', updatePreview));
['permCamera', 'permMic', 'permLocation', 'permNotifications', 'pullToRefresh', 'showReload'].forEach((id) =>
  $(id).addEventListener('change', updatePreview));

$('platformSeg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  $('platformSeg').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); platform = b.dataset.p;
  $('iosNote').style.display = platform === 'ios' ? 'block' : 'none';
  $('buildBtn').textContent = platform === 'ios' ? 'Build iOS app 🚀' : 'Build app 🚀';
}));

$('url').addEventListener('blur', () => {
  if ($('packageId').value.trim()) return;
  try {
    const host = new URL($('url').value).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean).reverse();
    if (parts.length >= 2) $('packageId').value = (parts.join('.') + '.app').toLowerCase().replace(/[^a-z0-9.]/g, '');
  } catch { /* ignore */ }
});

$('icon').addEventListener('change', () => {
  const f = $('icon').files[0];
  if (iconDataUrl) URL.revokeObjectURL(iconDataUrl);
  iconDataUrl = f ? URL.createObjectURL(f) : null;
  updatePreview();
});

// ---- live preview ----------------------------------------------------------
function updatePreview() {
  const name = $('appName').value.trim() || 'My App';
  const theme = /^#[0-9a-fA-F]{6}$/.test($('themeColor').value) ? $('themeColor').value : '#6366f1';
  const letter = (name[0] || 'A').toUpperCase();

  $('previewName').textContent = name;
  $('appbarName').textContent = name;

  // app bar + splash + status bar tinted with the theme color (like the real app)
  $('appbar').style.background = theme;
  $('splash').style.background = theme;
  $('screen') && ($('screen').style.background = theme);
  document.querySelector('.statusbar').style.background = theme;

  // icon: uploaded image, else generated (mirrors scaffold's default icon)
  const big = $('previewIcon'), mini = $('miniIcon');
  if (iconDataUrl) {
    big.style.backgroundImage = `url(${iconDataUrl})`; big.textContent = '';
    mini.style.backgroundImage = `url(${iconDataUrl})`; mini.style.backgroundSize = 'cover'; mini.textContent = '';
  } else {
    big.style.backgroundImage = ''; big.style.background = shade(theme, -18); big.textContent = letter;
    mini.style.backgroundImage = ''; mini.style.background = shade(theme, -18); mini.textContent = letter;
  }

  // toggles reflected in the phone
  $('pullHint').style.display = $('pullToRefresh').checked ? 'flex' : 'none';
  $('reloadFab').classList.toggle('on', $('showReload').checked);

  // permission badges
  const badges = [];
  if ($('permCamera').checked) badges.push('📷 Camera');
  if ($('permMic').checked) badges.push('🎙️ Mic');
  if ($('permLocation').checked) badges.push('📍 Location');
  if ($('permNotifications').checked) badges.push('🔔 Notifications');
  $('permBadges').innerHTML = badges.map((b) => `<span class="b">${b}</span>`).join('');
}

// darken/lighten a hex color by percent (for icon contrast on splash)
function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (c * pct) / 100)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// best-effort live site preview (many sites block embedding via X-Frame-Options)
$('loadPreview').addEventListener('click', () => {
  const url = $('url').value.trim();
  if (!/^https?:\/\/.+/i.test(url)) { alert('Enter a valid URL first.'); return; }
  const stage = $('stage');
  stage.querySelectorAll('iframe').forEach((f) => f.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  frame.src = url;
  stage.insertBefore(frame, $('reloadFab'));
  $('splash').style.display = 'none';
  const note = $('blockedNote');
  note.style.display = 'block';
  note.textContent = "If it stays blank, this site blocks embedding — the built app still loads it fine.";
  // let users get back to the branded splash
  clearTimeout(window._pv);
  window._pv = setTimeout(() => { note.parentElement.style.display = 'flex'; note.parentElement.style.zIndex = 1; }, 4000);
});

// clock
(function () { const d = new Date(); $('clock').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; })();

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
  if (res.status === 204) return null;
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
const strToBase64 = (s) => btoa(unescape(encodeURIComponent(s)));

function setStatus(text, kind) {
  $('status').classList.add('show');
  $('statusText').textContent = text;
  $('dot').className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
}

function collectConfig() {
  return {
    url: $('url').value.trim(),
    appName: $('appName').value.trim(),
    packageId: $('packageId').value.trim().toLowerCase(),
    themeColor: $('themeColor').value.trim(),
    orientation: $('orientation').value,
    permissions: {
      camera: $('permCamera').checked,
      microphone: $('permMic').checked,
      location: $('permLocation').checked,
      notifications: $('permNotifications').checked,
    },
    pullToRefresh: $('pullToRefresh').checked,
    showReload: $('showReload').checked,
    platform,
  };
}
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
  const f = collectConfig();
  const bad = validate(c, f);
  if (bad) { setStatus(bad, 'err'); return; }

  $('buildBtn').disabled = true;
  const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const plat = platform; // capture — must not change mid-build
  try {
    // 1. upload config.json (single source of truth — no 10-input limit)
    setStatus('Uploading build config…');
    await gh(c, `/repos/${c.owner}/${c.repo}/contents/inputs/${buildId}/config.json`, {
      method: 'PUT',
      body: { message: `webtoapk: config ${buildId}`, content: strToBase64(JSON.stringify(f, null, 2)), branch: c.branch },
    });
    // 2. optional icon
    const iconFile = $('icon').files[0];
    if (iconFile) {
      setStatus('Uploading icon…');
      await gh(c, `/repos/${c.owner}/${c.repo}/contents/inputs/${buildId}/icon.png`, {
        method: 'PUT',
        body: { message: `webtoapk: icon ${buildId}`, content: await fileToBase64(iconFile), branch: c.branch },
      });
    }
    // 3. dispatch — only buildId travels as an input
    setStatus('Dispatching build to GitHub Actions…');
    await gh(c, `/repos/${c.owner}/${c.repo}/actions/workflows/${WORKFLOWS[plat]}/dispatches`, {
      method: 'POST', body: { ref: c.branch, inputs: { buildId } },
    });
    setStatus('Build queued — compiling in the cloud (~3–6 min)…');
    pollStatus(c, buildId, plat);
  } catch (e) {
    setStatus(e.status === 401 ? 'Bad token (401). Check scopes/expiry.' : e.message, 'err');
    $('buildBtn').disabled = false;
  }
});

function pollStatus(c, buildId, plat) {
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
            <div style="margin-top:10px"><a href="${rel.html_url}" target="_blank">View release on GitHub</a></div>`;
          $('buildBtn').disabled = false;
          return;
        }
      } catch (e) { if (e.status !== 404) throw e; }

      // progress: match the run for THIS buildId by run-name (fixes wrong-run bug)
      const file = WORKFLOWS[plat];
      const runs = await gh(c, `/repos/${c.owner}/${c.repo}/actions/workflows/${file}/runs?event=workflow_dispatch&per_page=15`);
      const run = (runs.workflow_runs || []).find((r) => (r.name || '').includes(buildId));
      const state = run ? (run.status === 'completed' ? run.conclusion : run.status) : 'queued';
      if (run && run.status === 'completed' && state !== 'success') {
        clearInterval(pollTimer);
        setStatus(`Build ${state}.`, 'err');
        $('result').innerHTML = `<a href="${run.html_url}" target="_blank">Open build logs</a>`;
        $('buildBtn').disabled = false;
        return;
      }
      setStatus(`${plat === 'ios' ? 'Building iOS app' : 'Building APK'}… (${state})`);
      if (run) $('result').innerHTML = `<a href="${run.html_url}" target="_blank">Watch live logs</a>`;
    } catch (e) {
      setStatus(e.message, 'err');
    }
  }, 5000);
}

// init
loadConn();
updatePreview();

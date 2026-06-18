// WebToApk GUI front-end logic.
const $ = (id) => document.getElementById(id);
let platform = 'android';
let pollTimer = null;

// theme color picker <-> text sync
$('themeColorPick').addEventListener('input', (e) => ($('themeColor').value = e.target.value));
$('themeColor').addEventListener('input', (e) => {
  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) $('themeColorPick').value = e.target.value;
});

// platform toggle
$('platformSeg').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    $('platformSeg').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    platform = b.dataset.p;
    $('iosNote').style.display = platform === 'ios' ? 'block' : 'none';
    $('buildBtn').textContent = platform === 'ios' ? 'Build iOS app' : 'Build app';
  });
});

// auto-suggest a package id from the URL host
$('url').addEventListener('blur', () => {
  if ($('packageId').value.trim()) return;
  try {
    const host = new URL($('url').value).hostname.replace(/^www\./, '');
    const parts = host.split('.').filter(Boolean).reverse();
    if (parts.length >= 2) $('packageId').value = (parts.join('.') + '.app').toLowerCase().replace(/[^a-z0-9.]/g, '');
  } catch { /* ignore */ }
});

// warn if server has no GitHub config
fetch('/api/config').then((r) => r.json()).then((c) => {
  if (!c.configured) {
    const b = $('cfgBanner');
    b.style.display = 'block';
    b.textContent = c.error;
    $('buildBtn').disabled = true;
  }
}).catch(() => {});

function setStatus(text, kind) {
  $('status').classList.add('show');
  $('statusText').textContent = text;
  const dot = $('dot');
  dot.className = 'dot' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
}

$('buildBtn').addEventListener('click', async () => {
  clearInterval(pollTimer);
  $('result').innerHTML = '';
  const fd = new FormData();
  fd.append('url', $('url').value);
  fd.append('appName', $('appName').value);
  fd.append('packageId', $('packageId').value);
  fd.append('themeColor', $('themeColor').value);
  fd.append('orientation', $('orientation').value);
  fd.append('platform', platform);
  if ($('icon').files[0]) fd.append('icon', $('icon').files[0]);

  $('buildBtn').disabled = true;
  setStatus('Dispatching build to GitHub Actions…');

  try {
    const r = await fetch('/api/build', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Build failed to start');
    setStatus('Build queued — compiling in the cloud. This takes ~3–6 min.');
    pollStatus(data.buildId, data.platform);
  } catch (e) {
    setStatus(e.message, 'err');
    $('buildBtn').disabled = false;
  }
});

function pollStatus(buildId, plat) {
  let tries = 0;
  pollTimer = setInterval(async () => {
    tries++;
    if (tries > 120) { clearInterval(pollTimer); setStatus('Timed out — check the Actions tab.', 'err'); $('buildBtn').disabled = false; return; }
    try {
      const r = await fetch(`/api/status?buildId=${encodeURIComponent(buildId)}&platform=${plat}`);
      const s = await r.json();
      if (s.state === 'success' && s.downloadUrl) {
        clearInterval(pollTimer);
        setStatus('Done! Your app is ready.', 'ok');
        $('result').innerHTML = `<a class="dl" href="${s.downloadUrl}">⬇ Download APK</a>
          <div style="margin-top:10px"><a class="link" href="${s.releaseUrl}" target="_blank">View release on GitHub</a></div>`;
        $('buildBtn').disabled = false;
        return;
      }
      if (s.state === 'failure' || s.state === 'cancelled') {
        clearInterval(pollTimer);
        setStatus(`Build ${s.state}.`, 'err');
        if (s.runUrl) $('result').innerHTML = `<a class="link" href="${s.runUrl}" target="_blank">Open build logs</a>`;
        $('buildBtn').disabled = false;
        return;
      }
      const label = plat === 'ios' ? 'Building iOS app' : 'Building APK';
      setStatus(`${label}… (${s.state || 'queued'})`);
      if (s.runUrl) {
        $('result').innerHTML = `<a class="link" href="${s.runUrl}" target="_blank">Watch live logs</a>`;
      }
    } catch (e) {
      setStatus(e.message, 'err');
    }
  }, 5000);
}

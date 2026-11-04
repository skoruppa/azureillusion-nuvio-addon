export function configurePage(version) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" href="https://subs.azureillusion.ovh/branding/azureillusion-logo-v3.png">
<title>AzureIllusion Napisy - addon do Nuvio</title>
<style>
  :root {
    --bg: #070d18; --panel: rgba(11, 21, 39, 0.92); --field: #0a1424; --border: #1c3452;
    --cyan: #22d3ee; --cyan-glow: rgba(34, 211, 238, 0.28); --blue: #2563eb; --blue-dark: #1e3fae;
    --text: #e6edf7; --muted: #8fa3bd; --chip: #0f1d33; --error: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; flex-direction: column; color: var(--text); font-family: 'Inter', sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, rgba(37, 99, 235, 0.18), transparent 60%),
                radial-gradient(800px 500px at 90% 110%, rgba(34, 211, 238, 0.08), transparent 60%), var(--bg);
  }
  h1, .btn-main, .chip, .label { font-family: 'Lexend', sans-serif; }
  a { color: var(--cyan); text-decoration: none; }
  a:hover { color: #67e8f9; }
  .content { flex: 1; }
  .text-muted-azure { color: var(--muted) !important; }

  .logo { width: 112px; height: 112px; border-radius: 50%; object-fit: cover;
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.45), 0 0 36px var(--cyan-glow); }
  .chips { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .chip { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--chip);
    font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text); }
  h1 { font-weight: 800; font-size: clamp(2rem, 6vw, 3.2rem); letter-spacing: -0.01em; }

  .panel { background: var(--panel); border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 14px;
    box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.06), 0 0 40px rgba(34, 211, 238, 0.07), 0 20px 50px rgba(0, 0, 0, 0.45); }
  .label { font-size: .8rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; display: block; }

  .form-control { background: var(--field) !important; color: var(--text) !important; border: 1px solid var(--border) !important; border-radius: 10px; padding: .7rem .9rem; }
  .form-control:focus { border-color: var(--cyan) !important; box-shadow: 0 0 0 .2rem var(--cyan-glow) !important; }
  .form-control::placeholder { color: rgba(143, 163, 189, 0.6); }
  .input-group > .form-control { border-top-right-radius: 0; border-bottom-right-radius: 0; }

  .btn-icon { border: 1px solid var(--border); background: var(--chip); color: var(--cyan); border-radius: 0 10px 10px 0; padding: 0 16px; }
  .btn-icon:hover, .btn-icon:focus { border-color: var(--cyan); color: #67e8f9; background: var(--chip); box-shadow: 0 0 14px var(--cyan-glow); }

  .btn-main { display: flex; align-items: center; gap: 14px; width: 100%; padding: 12px 20px; border: 1px solid rgba(96, 165, 250, 0.45);
    border-radius: 10px; color: #fff; text-align: left; background: linear-gradient(135deg, var(--blue), var(--blue-dark));
    box-shadow: 0 8px 24px rgba(37, 99, 235, 0.3); transition: transform .15s ease, box-shadow .15s ease, filter .15s ease; }
  .btn-main:hover { color: #fff; filter: brightness(1.12); transform: translateY(-1px); box-shadow: 0 10px 30px rgba(37, 99, 235, 0.45); }
  .btn-main:disabled { opacity: .6; transform: none; }
  .btn-main i { font-size: 1.35rem; }
  .btn-main .title { display: block; font-weight: 700; font-size: 1.05rem; line-height: 1.2; }
  .btn-main .subtitle { display: block; font-family: 'Inter', sans-serif; font-size: .74rem; font-weight: 500; opacity: .75; }
  .btn-main.secondary { background: var(--chip); border-color: var(--border); box-shadow: none; }
  .btn-main.secondary:hover { border-color: var(--cyan); box-shadow: 0 0 18px var(--cyan-glow); }
  .btn-main.secondary i { color: var(--cyan); }

  .option { display: flex; gap: 12px; align-items: flex-start; margin-top: 18px; padding: 14px 16px; border: 1px solid var(--border);
    border-radius: 10px; background: var(--field); cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
  .option:hover { border-color: rgba(34, 211, 238, 0.5); }
  .option input { appearance: none; flex: 0 0 auto; width: 20px; height: 20px; margin-top: 2px; border: 1px solid var(--border);
    border-radius: 6px; background: var(--chip); display: grid; place-items: center; cursor: pointer; }
  .option input:checked { border-color: var(--cyan); background: rgba(34, 211, 238, 0.15); box-shadow: 0 0 12px var(--cyan-glow); }
  .option input:checked::after { content: ''; width: 10px; height: 6px; border: 2px solid var(--cyan); border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
  .option .title { font-family: 'Lexend', sans-serif; font-weight: 600; display: block; }
  .option .subtitle { display: block; font-size: .82rem; color: var(--muted); margin-top: 2px; }
  .notice { display: none; gap: 10px; align-items: flex-start; margin: -12px 0 20px; padding: 12px 14px; border-radius: 10px;
    border: 1px solid rgba(250, 204, 21, 0.45); background: rgba(250, 204, 21, 0.08); color: #fde68a; font-size: .86rem; }
  .notice.show { display: flex; }
  .notice i { font-size: 1.05rem; margin-top: 1px; }
  .split { position: relative; display: flex; }
  .split > .btn-main { border-top-right-radius: 0; border-bottom-right-radius: 0; }
  .split-toggle { flex: 0 0 auto; width: 56px; display: grid; place-items: center; color: #fff; border: 1px solid rgba(96, 165, 250, 0.45);
    border-left: 1px solid rgba(255, 255, 255, 0.18); border-radius: 0 10px 10px 0; background: linear-gradient(135deg, var(--blue-dark), #1a3591);
    box-shadow: 0 8px 24px rgba(37, 99, 235, 0.3); transition: filter .15s ease; }
  .split-toggle:hover { filter: brightness(1.15); }
  .split-toggle i { transition: transform .2s ease; }
  .split.open .split-toggle i { transform: rotate(180deg); }
  .split-menu { display: none; position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 20; padding: 6px;
    background: #0b1527; border: 1px solid rgba(34, 211, 238, 0.35); border-radius: 10px; box-shadow: 0 0 24px var(--cyan-glow), 0 16px 40px rgba(0, 0, 0, 0.5); }
  .split.open .split-menu { display: block; }
  .split-menu a { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; color: var(--text); }
  .split-menu a:hover { background: var(--chip); color: var(--text); }
  .split-menu a i { color: var(--cyan); font-size: 1.15rem; }
  .split-menu .title { font-family: 'Lexend', sans-serif; font-weight: 600; display: block; line-height: 1.2; }
  .split-menu .subtitle { display: block; font-size: .74rem; color: var(--muted); }
  .steps { border-top: 1px solid var(--border); margin-top: 28px; padding-top: 20px; font-size: .9rem; color: var(--muted); }
  .steps b { color: var(--text); font-weight: 600; }
  #installSection { display: none; }

  footer { background: rgba(5, 10, 19, 0.9); border-top: 1px solid var(--border); }
  .toast-notification { position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-140px); background: var(--panel); color: var(--text);
    padding: 12px 20px; border-radius: 10px; border: 1px solid var(--cyan); box-shadow: 0 0 24px var(--cyan-glow); z-index: 1000; transition: transform .3s ease; }
  .toast-notification.show { transform: translateX(-50%) translateY(0); }
  .toast-notification.error { border-color: var(--error); box-shadow: 0 0 24px rgba(248, 113, 113, 0.25); }
</style>
</head>
<body>
<div id="toast" class="toast-notification"><i class="bi bi-check-circle me-2" id="toast-icon"></i><span id="toast-message"></span></div>

<div class="content">
  <div class="container pt-5 px-3">
    <header class="text-center mb-5">
      <img class="logo" src="https://subs.azureillusion.ovh/branding/azureillusion-logo-v3.png" alt="AzureIllusion">
      <div class="chips mt-4">
        <span class="chip">Napisy</span><span class="chip">Anime</span><span class="chip">Nuvio · Stremio</span>
      </div>
      <h1 class="mt-3 mb-2">AzureIllusion Napisy</h1>
      <p class="text-muted-azure mb-0">
        Polskie napisy dla anime z <a href="https://subs.azureillusion.ovh" target="_blank">AzureIllusion</a>
        prosto w <a href="https://nuvio.tv" target="_blank">Nuvio</a> i <a href="https://www.stremio.com/" target="_blank">Stremio</a>
      </p>
    </header>

    <main class="row justify-content-center">
      <div class="col-12 col-md-10 col-lg-7">
        <div class="panel p-4 p-md-5">
          <form id="keyForm">
            <label for="apiKey" class="label">Klucz API AzureIllusion</label>
            <div class="input-group">
              <input id="apiKey" class="form-control" type="password" autocomplete="off" placeholder="Wklej swój klucz API" required>
              <button class="btn btn-icon" type="button" id="toggleKey" title="Pokaż / ukryj"><i class="bi bi-eye"></i></button>
            </div>
            <div class="small text-muted-azure mt-2">
              Klucz utworzysz po zalogowaniu w <a href="https://subs.azureillusion.ovh/account?tab=api" target="_blank">ustawieniach API na stronie AzureIllusion</a>. Najlepiej użyj osobnego klucza tylko do tego dodatku.
            </div>
            <button class="btn-main mt-4" type="submit" id="checkButton">
              <i class="bi bi-shield-check"></i>
              <span><span class="title">Sprawdź klucz</span><span class="subtitle">Weryfikacja w API AzureIllusion</span></span>
            </button>
          </form>

          <div id="installSection" class="mt-4">
            <label class="option mt-0 mb-4" for="embedFonts">
              <input type="checkbox" id="embedFonts">
              <span>
                <span class="title">Próbuj dodawać czcionki do plików ASS</span>
                <span class="subtitle">Dołącza do napisów czcionki grupy (tylko użyte znaki), żeby wyglądały jak u tłumaczy. Gdy się nie uda, dostaniesz zwykły plik.</span>
              </span>
            </label>
            <div class="notice" id="reinstallNotice" role="status">
              <i class="bi bi-exclamation-triangle"></i>
              <span>Zmiana tej opcji zmienia adres dodatku. Usuń dotychczasową wersję i zainstaluj dodatek ponownie z nowego adresu.</span>
            </div>
            <label for="manifestUrl" class="label">URL manifestu</label>
            <div class="input-group mb-3">
              <input id="manifestUrl" class="form-control" type="text" readonly>
              <button class="btn btn-icon" type="button" onclick="copyManifest()" title="Kopiuj"><i class="bi bi-clipboard"></i></button>
            </div>
            <div class="split" id="installSplit">
              <a class="btn-main" id="installNuvio">
                <i class="bi bi-download"></i>
                <span><span class="title">Zainstaluj w Nuvio</span><span class="subtitle">Otwiera Nuvio i dodaje addon</span></span>
              </a>
              <button class="split-toggle" type="button" id="splitToggle" aria-haspopup="true" aria-expanded="false" title="Inne aplikacje">
                <i class="bi bi-chevron-down"></i>
              </button>
              <div class="split-menu" role="menu">
                <a id="installStremio" role="menuitem">
                  <i class="bi bi-box-arrow-up-right"></i>
                  <span><span class="title">Zainstaluj w Stremio</span><span class="subtitle">Otwiera aplikację Stremio</span></span>
                </a>
              </div>
            </div>
            <button class="btn-main secondary mt-2" type="button" onclick="copyManifest()">
              <i class="bi bi-clipboard"></i>
              <span><span class="title">Kopiuj URL</span><span class="subtitle">Do wklejenia ręcznie w ustawieniach dodatków</span></span>
            </button>
            <div class="steps">
              <b>Nuvio:</b> kliknij „Zainstaluj w Nuvio” albo wklej URL w ustawieniach dodatków.<br>
              <b>Stremio:</b> kliknij „Zainstaluj w Stremio” albo wklej URL w wyszukiwarkę dodatków.
            </div>
          </div>
        </div>

        <div class="mt-4 text-center text-muted-azure">
          <small><i class="bi bi-info-circle me-1"></i>
            Klucz jest częścią adresu manifestu. Nie udostępniaj go innym - w razie wycieku unieważnij klucz w <a href="https://subs.azureillusion.ovh/account?tab=api" target="_blank">ustawieniach API AzureIllusion</a>.
          </small>
        </div>
      </div>
    </main>
  </div>
</div>

<footer class="py-3 mt-5">
  <div class="container text-center">
    <small class="text-muted-azure">
      AzureIllusion Napisy · addon do Nuvio v${version}
      <a href="https://github.com/skoruppa/azureillusion-nuvio-addon" target="_blank" class="ms-3" title="GitHub"><i class="bi bi-github fs-5"></i></a>
      <a href="https://ko-fi.com/skoruppa" target="_blank" class="ms-2" title="Postaw mi kawę"><i class="bi bi-cup-hot-fill fs-5"></i></a>
    </small>
  </div>
</footer>

<script>
  const keyInput = document.getElementById('apiKey');

  function showToast(message, isError) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').textContent = message;
    document.getElementById('toast-icon').className = 'bi me-2 ' + (isError ? 'bi-exclamation-triangle' : 'bi-check-circle');
    toast.classList.toggle('error', !!isError);
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  const fontsCheckbox = document.getElementById('embedFonts');
  let verifiedKey = null;

  function showInstall(key) {
    verifiedKey = key;
    const base = '/' + encodeURIComponent(key) + (fontsCheckbox.checked ? '/fonts' : '');
    const path = base + '/manifest.json';
    document.getElementById('manifestUrl').value = location.origin + path;
    document.getElementById('installNuvio').href = 'nuvio://' + location.host + path;
    document.getElementById('installStremio').href = 'stremio://' + location.host + path;
    document.getElementById('installSection').style.display = 'block';
    history.replaceState({}, '', base + '/configure');
  }

  // Set when the page was opened from an installed addon (/{key}/configure or /{key}/fonts/configure).
  let installedWithFonts = null;
  fontsCheckbox.addEventListener('change', () => {
    if (verifiedKey) showInstall(verifiedKey);
    const changed = installedWithFonts !== null && fontsCheckbox.checked !== installedWithFonts;
    document.getElementById('reinstallNotice').classList.toggle('show', changed);
  });
  keyInput.addEventListener('input', () => {
    verifiedKey = null;
    document.getElementById('installSection').style.display = 'none';
  });

  function copyManifest() {
    const field = document.getElementById('manifestUrl');
    navigator.clipboard.writeText(field.value)
      .then(() => showToast('Skopiowano URL manifestu do schowka'))
      .catch(() => { field.select(); showToast('Zaznaczono URL - skopiuj go ręcznie', true); });
  }

  const split = document.getElementById('installSplit');
  const splitToggle = document.getElementById('splitToggle');
  function setSplitOpen(open) {
    split.classList.toggle('open', open);
    splitToggle.setAttribute('aria-expanded', String(open));
  }
  splitToggle.addEventListener('click', (event) => { event.stopPropagation(); setSplitOpen(!split.classList.contains('open')); });
  document.addEventListener('click', (event) => { if (!split.contains(event.target)) setSplitOpen(false); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setSplitOpen(false); });

  document.getElementById('toggleKey').addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('keyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    const button = document.getElementById('checkButton');
    button.disabled = true;
    try {
      const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      const result = await response.json();
      if (result.ok) { showInstall(key); showToast('Klucz działa'); }
      else { document.getElementById('installSection').style.display = 'none'; showToast(result.message || 'Nie udało się sprawdzić klucza', true); }
    } catch {
      showToast('Błąd połączenia z dodatkiem', true);
    } finally {
      button.disabled = false;
    }
  });

  // /{key}/configure opened from the app: prefill the existing key.
  const segments = location.pathname.split('/').filter(Boolean);
  if (segments.at(-1) === 'configure' && (segments.length === 2 || (segments.length === 3 && segments[1] === 'fonts'))) {
    keyInput.value = decodeURIComponent(segments[0]);
    fontsCheckbox.checked = segments.length === 3;
    installedWithFonts = fontsCheckbox.checked;
    showInstall(keyInput.value);
  }
</script>
</body>
</html>`;
}

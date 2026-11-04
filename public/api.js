/* api.js — remplace la gestion locale des comptes par le serveur (profils.json, level.json).
   Chargé après le script principal : ses fonctions remplacent les anciennes du même nom. */

let SAVE_T = null, TFA = null;
let AX = { mode: "login", pending: null, pw: "", codes: null, acc: null };

async function api(url, body, method) {
  const opt = { method: method || (body ? "POST" : "GET"), credentials: "same-origin", headers: {} };
  if (body) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  try {
    const r = await fetch(url, opt);
    let j = {}; try { j = await r.json(); } catch (e) {}
    return { ...j, ok: r.ok && j.ok !== false, status: r.status };
  } catch (e) {
    return { ok: false, error: "Serveur injoignable. Lancez « node server.js » puis ouvrez http://localhost:3000" };
  }
}

/* ---------- Progression : envoyée au serveur (level.json) ---------- */
function persistAccounts() {}
function pushProgress() { if (ACCT) api("/api/progress", { progress: data }, "PUT"); }
function save() {
  if (!ACCT) return;
  ACCT.progress = data;
  clearTimeout(SAVE_T);
  SAVE_T = setTimeout(pushProgress, 500);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ACCT) { clearTimeout(SAVE_T); pushProgress(); }
});

/* ---------- Session ---------- */
function applyAccount(acc) {
  ACCT = acc;
  data = Object.assign(JSON.parse(JSON.stringify(DEF)), acc.progress || {});
  data.streak = Object.assign({}, DEF.streak, data.streak);
  data.boost = Object.assign({}, DEF.boost, data.boost);
  data.equip = Object.assign({}, DEF.equip, data.equip);
  data.owned = Object.assign({ sakura: true }, data.owned);
  ACCT.progress = data;
  LEAGUE.uid = acc.uid;
  document.body.classList.toggle("theme-or", data.equip.theme === "or");
  refresh(); renderAvatarBtn();
}
function loginAs(acc) {
  $("#auth").hidden = true;
  applyAccount(acc);
  toast("Bienvenue, " + acc.name + " !");
}
async function logout() {
  await api("/api/logout", {}, "POST");
  ACCT = null; data = JSON.parse(JSON.stringify(DEF));
  closeMenu(); closeSettings();
  document.body.classList.remove("theme-or");
  renderAvatarBtn(); refresh(); showAuth("login");
}
async function bootAuth() {
  const r = await api("/api/me");
  if (r.ok && r.account) loginAs(r.account); else showAuth("login");
  connectLeague();
}

/* ---------- Écrans de connexion ---------- */
function showAuth(mode) { AX.mode = mode || "login"; AX.pending = null; $("#auth").hidden = false; renderAuth(); }
function fld(label, name, type, extra) {
  return `<div class="field"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" ${extra || ""}></div>`;
}
function renderAuth() {
  const A = $("#authBody"), m = AX.mode;
  if (m === "codes") {
    A.innerHTML = `<h2 style="margin-top:0;font:700 1.3rem var(--display)">Vos codes de secours</h2>
      <p class="muted" style="font-size:14px">Ils remplacent un code 2FA ou réinitialisent le mot de passe. Chaque code ne sert qu'une fois. Notez-les : ils ne seront plus affichés.</p>
      <div class="codes">${AX.codes.map(c => `<span>${c}</span>`).join("")}</div>
      <button class="pbtn" id="codesOk" type="button">J'ai noté mes codes</button>`;
    $("#codesOk").onclick = () => { AX.codes = null; loginAs(AX.acc); };
    return;
  }
  const tabs = m === "reset"
    ? `<div class="tabsm"><button data-m="login" type="button">Retour à la connexion</button></div>`
    : `<div class="tabsm"><button data-m="login" type="button" aria-selected="${m === "login"}">Connexion</button><button data-m="signup" type="button" aria-selected="${m === "signup"}">Créer un compte</button></div>`;
  let form = "";
  if (m === "login" && !AX.pending) form = fld("Adresse e-mail", "email", "email", 'required autocomplete="email"') + fld("Mot de passe", "pw", "password", 'required autocomplete="current-password"') + `<p class="err" id="err"></p><button class="pbtn" type="submit">Se connecter</button><button class="link" type="button" data-m="reset">Mot de passe oublié ?</button>`;
  if (m === "login" && AX.pending) form = `<p class="muted" style="font-size:14px">Code à 6 chiffres de votre application, ou code de secours.</p>` + fld("Code 2FA ou code de secours", "otp", "text", 'required autocomplete="one-time-code"') + `<p class="err" id="err"></p><button class="pbtn" type="submit">Valider</button>`;
  if (m === "signup") form = fld("Pseudo", "name", "text", 'required maxlength="24"') + fld("Date de naissance", "birthdate", "date", "required") + fld("Adresse e-mail", "email", "email", 'required autocomplete="email"') + fld("Mot de passe (8 caractères minimum)", "pw", "password", 'required minlength="8" autocomplete="new-password"') + fld("Confirmez le mot de passe", "pw2", "password", 'required minlength="8" autocomplete="new-password"') + `<p class="err" id="err"></p><button class="pbtn" type="submit">Créer mon compte</button>`;
  if (m === "reset") form = `<p class="muted" style="font-size:14px">Aucun e-mail n'est envoyé : utilisez un code de secours reçu à la création du compte.</p>` + fld("Adresse e-mail", "email", "email", "required") + fld("Code de secours", "code", "text", "required") + fld("Nouveau mot de passe (8 caractères minimum)", "pw", "password", 'required minlength="8"') + `<p class="err" id="err"></p><button class="pbtn" type="submit">Réinitialiser</button>`;
  A.innerHTML = `<div class="brand" style="margin:0 0 14px"><h1 style="font-size:1.8rem;margin:0">Kana &amp; Kotoba</h1></div>${tabs}<form id="authForm">${form}</form>`;
  A.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { AX.mode = b.dataset.m; AX.pending = null; renderAuth(); });
  $("#authForm").onsubmit = handleAuth;
}
function setErr(msg) { const e = $("#err"); if (e) e.textContent = msg; }
async function handleAuth(e) {
  e.preventDefault(); const f = e.target;
  if (AX.mode === "login") {
    const body = AX.pending
      ? { email: AX.pending, password: AX.pw, otp: f.otp.value.trim() }
      : { email: f.email.value.trim(), password: f.pw.value };
    if (!AX.pending) AX.pw = f.pw.value;
    const r = await api("/api/login", body);
    if (r.needOtp) { AX.pending = body.email; return renderAuth(); }
    if (!r.ok) return setErr(r.error || "Connexion impossible.");
    AX.pending = null; AX.pw = "";
    return loginAs(r.account);
  }
  if (AX.mode === "signup") {
    if (f.pw.value !== f.pw2.value) return setErr("Les mots de passe ne correspondent pas.");
    const r = await api("/api/signup", { name: f.name.value.trim(), email: f.email.value.trim(), password: f.pw.value, birthdate: f.birthdate.value });
    if (!r.ok) return setErr(r.error || "Création impossible.");
    AX.codes = r.codes; AX.acc = r.account; AX.mode = "codes";
    return renderAuth();
  }
  if (AX.mode === "reset") {
    const r = await api("/api/reset", { email: f.email.value.trim(), code: f.code.value, password: f.pw.value });
    if (!r.ok) return setErr(r.error || "Code invalide ou déjà utilisé.");
    toast("Mot de passe réinitialisé"); AX.mode = "login"; renderAuth();
  }
}

/* ---------- Avatar ---------- */
function avatarChanged() {
  renderAvatarBtn();
  api("/api/profile", { avatar: ACCT.avatar }, "PUT");
  renderSettings("profile");
}
function bindAvatarDrop() {
  const d = $("#drop"), f = $("#file");
  d.onclick = () => f.click();
  d.ondragover = e => { e.preventDefault(); d.classList.add("over"); };
  d.ondragleave = () => d.classList.remove("over");
  d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); fileToAvatar(e.dataTransfer.files[0]); };
  f.onchange = () => fileToAvatar(f.files[0]);
}
function fileToAvatar(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Choisissez un fichier image");
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"), s = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
    ACCT.avatar = { src: c.toDataURL("image/jpeg", .85) };
    URL.revokeObjectURL(url); toast("Avatar mis à jour"); avatarChanged();
  };
  img.src = url;
}

/* ---------- Réglages ---------- */
function renderSettings(section) {
  const B = $("#modalBody"), acc = ACCT;
  if (!acc) return;
  B.innerHTML = `
    <div class="row2" style="border:0;padding-top:0"><h2 style="margin:0;font:700 1.3rem var(--display)">Paramètres</h2><button class="close" id="mClose" type="button" aria-label="Fermer">✕</button></div>
    <h3>Profil</h3>
    <div class="field"><label for="nm">Pseudo (visible dans la ligue)</label><input id="nm" value="${esc(acc.name)}" maxlength="24"></div>
    <button class="pbtn" id="saveName" type="button">Enregistrer le pseudo</button>
    <h3>Avatar</h3>
    <div class="drop" id="drop">Glissez une image ici, ou <u>choisissez un fichier</u><input type="file" id="file" accept="image/*" hidden></div>
    <div style="display:flex;gap:12px;align-items:center;margin:14px 0 8px">
      <div class="avatarbtn" style="width:64px;height:64px">${avatarHTML(acc.avatar, 64)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${AV_EMOJI.map(e => `<button class="emo" data-e="${e}" type="button">${e}</button>`).join("")}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${AV_BG.map(c => `<button class="swatch" data-bg="${c}" type="button" style="background:${c}"></button>`).join("")}<button class="link" id="rmPhoto" type="button" style="margin:0 0 0 6px">Retirer la photo</button></div>
    <h3>Préférences</h3>
    <div class="row2"><span>Sons</span><button class="chip-btn" id="sndT" type="button">${data.sound ? "Activés" : "Coupés"}</button></div>
    <div class="row2"><span>Décor</span><button class="chip-btn" id="thmT" type="button">${data.equip.theme === "or" ? "Aube dorée" : "Nuit de Kyoto"}</button></div>
    <h3 id="sec">Mot de passe</h3>
    <form id="pwForm"><div class="field"><label for="cur">Mot de passe actuel</label><input id="cur" type="password" required></div>
      <div class="field"><label for="nw">Nouveau (8 caractères minimum)</label><input id="nw" type="password" minlength="8" required></div>
      <button class="pbtn" type="submit">Changer le mot de passe</button></form>
    <h3>Double authentification (2FA)</h3>
    <div id="twofa"></div>
    <h3>Codes de secours</h3>
    <button class="link" id="regen" type="button">Générer de nouveaux codes</button>
    <div id="newCodes"></div>
    <div class="row2" style="margin-top:20px;border:0"><button class="link" id="logout2" type="button" style="color:var(--ko)">Se déconnecter</button></div>`;
  $("#mClose").onclick = closeSettings;
  $("#saveName").onclick = async () => {
    const v = $("#nm").value.trim(); if (!v) return;
    ACCT.name = v.slice(0, 24);
    const r = await api("/api/profile", { name: ACCT.name }, "PUT");
    toast(r.ok ? "Pseudo enregistré" : (r.error || "Erreur")); renderAvatarBtn();
  };
  bindAvatarDrop();
  B.querySelectorAll(".emo").forEach(b => b.onclick = () => { ACCT.avatar = { emoji: b.dataset.e, bg: (ACCT.avatar && ACCT.avatar.bg) || AV_BG[0] }; avatarChanged(); });
  B.querySelectorAll(".swatch").forEach(b => b.onclick = () => { ACCT.avatar = { emoji: (ACCT.avatar && ACCT.avatar.emoji) || "🌸", bg: b.dataset.bg }; avatarChanged(); });
  $("#rmPhoto").onclick = () => { ACCT.avatar = { emoji: "🌸", bg: AV_BG[0] }; avatarChanged(); };
  $("#sndT").onclick = () => { data.sound = !data.sound; save(); renderTop(); renderSettings("profile"); };
  $("#thmT").onclick = () => {
    if (!data.owned.or) return toast("Achetez « Aube dorée » dans la boutique");
    data.equip.theme = data.equip.theme === "or" ? "nuit" : "or";
    document.body.classList.toggle("theme-or", data.equip.theme === "or");
    save(); renderSettings("profile");
  };
  $("#pwForm").onsubmit = async e => {
    e.preventDefault();
    const r = await api("/api/password", { current: $("#cur").value, password: $("#nw").value });
    toast(r.ok ? "Mot de passe modifié" : (r.error || "Erreur"));
    if (r.ok) $("#pwForm").reset();
  };
  renderTwoFA();
  $("#regen").onclick = async () => {
    if (!confirm("Les anciens codes ne fonctionneront plus. Continuer ?")) return;
    const r = await api("/api/codes/regen", {});
    if (!r.ok) return toast(r.error || "Erreur");
    $("#newCodes").innerHTML = `<div class="codes">${r.codes.map(c => `<span>${c}</span>`).join("")}</div><p class="muted" style="font-size:13px">Notez-les maintenant, ils ne seront plus affichés.</p>`;
  };
  $("#logout2").onclick = logout;
  if (section === "security") $("#sec").scrollIntoView({ block: "start" });
}
function renderTwoFA() {
  const box = $("#twofa");
  if (ACCT.totp) {
    box.innerHTML = `<p class="muted" style="font-size:14px">Activée. Un code est demandé à chaque connexion.</p>
      <div class="field"><label for="offCode">Code actuel pour la désactiver</label><input id="offCode" inputmode="numeric" maxlength="6"></div>
      <button class="pbtn" id="offBtn" type="button" style="background:var(--ko);color:#fff;box-shadow:0 5px 0 #B34A4A">Désactiver la 2FA</button>`;
    $("#offBtn").onclick = async () => {
      const r = await api("/api/2fa/disable", { code: $("#offCode").value.trim() });
      if (!r.ok) return toast(r.error || "Code incorrect");
      ACCT.totp = false; toast("2FA désactivée"); renderSettings("security");
    };
    return;
  }
  if (!TFA) {
    box.innerHTML = `<p class="muted" style="font-size:14px">Un code à 6 chiffres, généré par Google Authenticator, Aegis ou Bitwarden, sera demandé à chaque connexion.</p>
      <button class="pbtn" id="startTotp" type="button">Activer la 2FA</button>`;
    $("#startTotp").onclick = async () => {
      const r = await api("/api/2fa/setup", {});
      if (!r.ok) return toast(r.error || "Erreur");
      TFA = r; renderSettings("security");
    };
    return;
  }
  box.innerHTML = `<p class="muted" style="font-size:14px">Ajoutez ce compte dans votre application avec cette clé :</p>
    <div class="codes" style="grid-template-columns:1fr;letter-spacing:2px">${TFA.secret}</div>
    <p class="muted" style="font-size:12px;word-break:break-all">${esc(TFA.uri)}</p>
    <div class="field"><label for="setCode">Code à 6 chiffres pour confirmer</label><input id="setCode" inputmode="numeric" maxlength="6"></div>
    <button class="pbtn" id="confirm2fa" type="button">Confirmer et activer</button>`;
  $("#confirm2fa").onclick = async () => {
    const r = await api("/api/2fa/enable", { code: $("#setCode").value.trim() });
    if (!r.ok) return toast(r.error || "Code incorrect");
    ACCT.totp = true; TFA = null; toast("2FA activée"); renderSettings("security");
  };
}

/* ---------- Ligue : classement lu depuis le serveur ---------- */
async function connectLeague() {
  const pull = async () => {
    const r = await api("/api/league");
    if (r.ok) { LEAGUE.rows = r.rows || []; LEAGUE.loaded = true; LEAGUE.mode = "online"; resolveClose(); }
    else { LEAGUE.mode = "offline"; }
    renderLeague();
  };
  await pull();
  setInterval(pull, 20000);
}
function syncLeague() {} // le serveur calcule le classement à partir de la progression

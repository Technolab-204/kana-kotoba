/* profil.js — onglet Profil, flamme de série, filtres de photo, onglet Modération. Chargé après chat.js. */

/* ---------- Flamme de série ---------- */
function flameLit() {
  if (!data.streak || !data.streak.n || !data.streak.last) return false;
  const y = new Date(); y.setDate(y.getDate() - 1);
  return data.streak.last === dayKey(new Date()) || data.streak.last === dayKey(y);
}
function flameSVG(on) {
  const c = on ? ["#FFE08A", "#F4A23C", "#E4553B"] : ["#C5CBE8", "#9AA3C7", "#7A84B0"];
  return `<svg class="flame-svg ${on ? "lit" : ""}" viewBox="0 0 24 30" width="18" height="22" aria-hidden="true">
    <defs><linearGradient id="fg${on ? 1 : 0}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c[0]}"/><stop offset=".5" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs>
    <path d="M12 1 C13 7 20 9 20 18 A8 8 0 0 1 4 18 C4 13 7 11 8 7 C9 10 10 11 11 11 C10 7 11 4 12 1Z" fill="url(#fg${on ? 1 : 0})"/>
    <path d="M12 14 C12.5 17 15 18 15 21 A3 3 0 0 1 9 21 C9 18 11 17 12 14Z" fill="#FFF4D0" opacity="${on ? .85 : 0}"/></svg>`;
}
let lastFlame = null;
function syncChrome() {
  const lit = flameLit();
  if (lit !== lastFlame) { $("#flame").innerHTML = flameSVG(lit); lastFlame = lit; }
  document.body.classList.toggle("is-mod", !!(ACCT && ACCT.mod));
}

/* ---------- Onglet Profil ---------- */
function renderProfil() {
  const B = $("#profilBody");
  if (!ACCT) { B.innerHTML = `<p class="muted">Connectez-vous pour voir votre profil.</p>`; return; }
  const t = TIERS[data.tier || 0];
  B.innerHTML = `
    <div class="pcard">
      <div class="pav">${avatarHTML(ACCT.avatar, 96)}</div>
      <div><h3 class="pname">${esc(ACCT.name)}</h3>
        <div class="muted" style="font-size:13px">${esc(ACCT.email)}</div>
        ${ACCT.mod ? `<span class="chip-mod">Modérateur</span>` : ""}</div>
    </div>
    <div class="pstats">
      <div><span class="flame-big">${flameSVG(flameLit())}</span><strong>${data.streak.n}</strong><span>jours de suite</span></div>
      <div><strong>${data.xp}</strong><span>XP totaux</span></div>
      <div><strong>${t.ico} ${t.name}</strong><span>ligue</span></div>
      <div><strong>${data.koban}</strong><span>koban</span></div>
    </div>
    <div class="pactions">
      <button class="pbtn" data-a="settings" type="button">Paramètres du profil</button>
      <button class="pbtn ghost" data-a="photo" type="button">Changer la photo (avec filtre)</button>
      <button class="pbtn ghost" data-a="security" type="button">Sécurité et 2FA</button>
      ${ACCT.mod ? `<button class="pbtn ghost" data-a="modo" type="button">Ouvrir la modération</button>` : ""}
      <button class="pbtn ghost" data-a="logout" type="button" style="color:var(--ko)">Se déconnecter</button>
    </div>`;
  B.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "settings") openSettings("profile");
    if (a === "security") openSettings("security");
    if (a === "photo") pickPhoto();
    if (a === "modo") { showView("modo"); renderModo(); }
    if (a === "logout") logout();
  });
}
function pickPhoto() {
  const f = document.createElement("input");
  f.type = "file"; f.accept = "image/*";
  f.onchange = () => fileToAvatar(f.files[0]);
  f.click();
}

/* ---------- Filtres de la photo de profil ---------- */
const PHOTO_FILTERS = [
  ["Aucun", "none"], ["Sépia", "sepia(.9)"], ["Noir & blanc", "grayscale(1)"],
  ["Sakura", "saturate(1.25) hue-rotate(-18deg) brightness(1.06)"],
  ["Vintage", "sepia(.4) contrast(1.15) brightness(.95)"],
  ["Nuit", "brightness(.8) contrast(1.2) hue-rotate(200deg)"],
  ["Pastel", "saturate(.7) brightness(1.12)"],
  ["Or", "sepia(.6) saturate(1.7) hue-rotate(-10deg)"]
];
let PHOTO = null;
function fileToAvatar(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Choisissez un fichier image");
  if (file.size > 8 * 1024 * 1024) return toast("Image trop lourde (8 Mo maximum)");
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => { PHOTO = { img, url, filter: "none" }; openPhotoSheet(); };
  img.onerror = () => toast("Image illisible");
  img.src = url;
}
function photoCanvas(filter) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d"), s = Math.min(PHOTO.img.width, PHOTO.img.height);
  x.filter = filter;
  x.drawImage(PHOTO.img, (PHOTO.img.width - s) / 2, (PHOTO.img.height - s) / 2, s, s, 0, 0, 128, 128);
  x.filter = "none";
  return c;
}
function openPhotoSheet() {
  const d = document.createElement("div");
  d.className = "modal sheet";
  d.innerHTML = `<div class="card2" style="text-align:center">
    <h2 style="margin:0 0 12px;font:700 1.2rem var(--display)">Photo de profil</h2>
    <div class="photo-prev" id="photoPrev"></div>
    <div class="chips-f">${PHOTO_FILTERS.map(([n, f], i) => `<button type="button" class="fchip ${i === 0 ? "on" : ""}" data-f="${f}">${n}</button>`).join("")}</div>
    <div class="row-btns" style="margin-top:16px"><button class="pbtn ghost" id="pCancel" type="button">Annuler</button>
      <button class="pbtn" id="pOk" type="button">Utiliser cette photo</button></div>
  </div>`;
  document.body.appendChild(d);
  const prev = d.querySelector("#photoPrev");
  prev.appendChild(photoCanvas("none"));
  d.querySelectorAll(".fchip").forEach(b => b.onclick = () => {
    PHOTO.filter = b.dataset.f;
    d.querySelectorAll(".fchip").forEach(x => x.classList.toggle("on", x === b));
    prev.replaceChildren(photoCanvas(PHOTO.filter));
  });
  const close = () => { URL.revokeObjectURL(PHOTO.url); d.remove(); PHOTO = null; };
  d.querySelector("#pCancel").onclick = close;
  d.querySelector("#pOk").onclick = () => {
    ACCT.avatar = { src: photoCanvas(PHOTO.filter).toDataURL("image/jpeg", .85) };
    close(); toast("Photo mise à jour"); avatarChanged();
  };
}

/* ---------- Onglet Modération (réservé aux modérateurs) ---------- */
async function renderModo() {
  const B = $("#modoBody");
  if (!ACCT || !ACCT.mod) { B.innerHTML = `<p class="muted">Réservé aux modérateurs.</p>`; return; }
  const r = await api("/api/mod/reports");
  if (!r.ok) { B.innerHTML = `<p class="err">${esc(r.error || "Erreur")}</p>`; return; }
  const open = r.reports.filter(x => x.status === "open").length;
  B.innerHTML = `<p class="muted">${open} signalement(s) à traiter</p>` + (r.reports.map(rep => `
    <div class="rep ${rep.status === "open" ? "" : "done"}">
      <div class="rhead"><span class="rtype">${esc(rep.type)}</span>
        <span class="muted">${new Date(rep.ts).toLocaleString("fr-FR")}</span>
        ${rep.status === "open" ? "" : `<span class="muted">· ${esc(rep.status)} par ${esc(rep.resolvedBy || "")}</span>`}</div>
      <div class="rmsg"><b>${esc(rep.authorName)}</b> : « ${esc(rep.msgText)} »</div>
      <div class="rmeta">Signalé par <b>${esc(rep.reporterName)}</b> — motif : ${esc(rep.reason || "non précisé")}</div>
      ${rep.status === "open" ? `<div class="ractions">
        <button type="button" data-r="${rep.id}" data-act="dismiss">Ignorer</button>
        <button type="button" data-r="${rep.id}" data-act="delete">Supprimer le message</button>
        <button type="button" data-r="${rep.id}" data-act="warn">Avertir l'auteur</button>
        <button type="button" data-r="${rep.id}" data-act="ban">Bannir 24 h</button></div>` : ""}
    </div>`).join("")) || `<p class="muted">Aucun signalement.</p>`;
  B.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
    const res = await api(`/api/mod/reports/${b.dataset.r}/resolve`, { action: b.dataset.act, hours: 24 });
    toast(res.ok ? "Signalement traité" : (res.error || "Erreur"));
    renderModo();
  });
}

/* ---------- Navigation et rafraîchissement ---------- */
document.querySelectorAll('nav.bottom button[data-view="profil"]').forEach(b => b.addEventListener("click", () => renderProfil()));
document.querySelectorAll('nav.bottom button[data-view="modo"]').forEach(b => b.addEventListener("click", () => renderModo()));
setInterval(syncChrome, 1000);
syncChrome();

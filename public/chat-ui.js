/* chat.js — chat communautaire côté client. Chargé après api.js. */

const REPORT_TYPES = ["Insulte ou harcèlement", "Contenu sexuel ou choquant", "Image ou lien interdit", "Spam", "Information personnelle", "Autre"];

function chatTime(ts) { return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }

function chatSkeleton() {
  $("#chatBody").innerHTML = `
    <div class="chat-rules">Chat ouvert dès 13 ans. Pas d'images, pas d'insultes. Pour les 13-17 ans : pas de liens ni de coordonnées. Vous pouvez signaler tout message avec ⚑.</div>
    <div class="chat-status" id="chatStatus"></div>
    <div class="chat-list" id="chatList"></div>
    <form class="chat-form" id="chatForm" autocomplete="off">
      <input id="chatText" maxlength="300" placeholder="Écrivez un message…">
      <button class="pbtn" type="submit" style="width:auto;padding:10px 18px">Envoyer</button>
    </form>
    <p class="err" id="chatErr"></p>`;
  $("#chatForm").onsubmit = async e => {
    e.preventDefault();
    const input = $("#chatText"), text = input.value.trim();
    if (!text) return;
    const r = await api("/api/chat", { text });
    if (!r.ok) { $("#chatErr").textContent = r.error || "Message refusé."; return; }
    input.value = ""; $("#chatErr").textContent = "";
    renderChat();
  };
}

async function renderChat() {
  if (!ACCT) { $("#chatBody").innerHTML = `<p class="muted">Connectez-vous pour accéder au chat.</p>`; return; }
  if (!$("#chatList")) chatSkeleton();
  const r = await api("/api/chat");
  if (!r.ok) { $("#chatErr").textContent = r.error || "Chat indisponible."; return; }

  let status = "";
  if (r.mod) status += `<span class="chip-mod">Modérateur</span> `;
  status += `Avertissements : ${(r.warnings || []).length}`;
  if (r.ban) status += ` · <b style="color:var(--ko)">Banni jusqu'au ${new Date(r.ban.until).toLocaleString("fr-FR")}</b>`;
  if (r.age >= 13 && r.age < 18) status += ` · Mode 13-17 ans`;
  $("#chatStatus").innerHTML = status;

  const input = $("#chatText"), btn = $("#chatForm button");
  const blocked = !!r.ban || r.age < 13;
  input.disabled = blocked; btn.disabled = blocked;
  input.placeholder = r.age < 13 ? "Chat réservé aux 13 ans et plus"
    : r.ban ? "Écriture impossible pendant un bannissement" : "Écrivez un message…";

  const list = $("#chatList");
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
  list.innerHTML = r.messages.map(m => {
    const own = m.uid === ACCT.uid;
    const report = !own && !m.deleted ? `<button type="button" class="rep-btn" data-act="report" data-id="${m.id}" title="Signaler">⚑</button>` : "";
    const mod = r.mod && !m.deleted ? `<span class="mod-tools">
        <button type="button" data-act="del" data-id="${m.id}" title="Supprimer">🗑</button>
        <button type="button" data-act="warn" data-uid="${m.uid}" title="Avertir">⚠</button>
        <button type="button" data-act="ban" data-uid="${m.uid}" title="Bannir">⛔</button></span>` : "";
    return `<div class="msg ${own ? "me" : ""}">
      <div class="mh"><b>${esc(m.name)}</b> <span class="muted">${chatTime(m.ts)}</span>
        <span class="mtools">${report}${mod}</span></div>
      <div class="mt ${m.deleted ? "del" : ""}">${esc(m.text)}</div>
    </div>`;
  }).join("") || `<p class="muted">Aucun message pour le moment.</p>`;
  if (atBottom) list.scrollTop = list.scrollHeight;

  list.querySelectorAll("[data-act]").forEach(b => b.onclick = () => chatAction(b.dataset.act, b.dataset.id || null, b.dataset.uid || null));
}

async function chatAction(act, id, uid) {
  if (act === "report") return openReport(id);
  if (act === "del") {
    const r = await api("/api/chat/" + id, null, "DELETE");
    toast(r.ok ? "Message supprimé" : (r.error || "Erreur"));
  } else if (act === "warn") {
    const reason = prompt("Motif de l'avertissement :");
    if (reason === null) return;
    const r = await api("/api/mod/warn", { uid, reason });
    toast(r.ok ? `Avertissement envoyé (total : ${r.warnings})` : (r.error || "Erreur"));
  } else if (act === "ban") {
    const hours = prompt("Durée du bannissement en heures (24 = un jour) :", "24");
    if (hours === null) return;
    const reason = prompt("Motif :", "Non-respect du règlement") || "";
    const r = await api("/api/mod/ban", { uid, hours: Number(hours), reason });
    toast(r.ok ? "Bannissement appliqué" : (r.error || "Erreur"));
  }
  renderChat();
}

// Fenêtre de signalement : le message et le motif partent vers la modération
function openReport(id) {
  const d = document.createElement("div");
  d.className = "modal sheet";
  d.innerHTML = `<div class="card2">
    <h2 style="margin:0 0 6px;font:700 1.2rem var(--display)">Signaler ce message</h2>
    <p class="muted" style="font-size:13px">Le message et votre motif seront transmis à l'équipe de modération.</p>
    <div class="field"><label for="rtype">Type de problème</label>
      <select id="rtype" class="sel">${REPORT_TYPES.map(t => `<option>${t}</option>`).join("")}</select></div>
    <div class="field"><label for="rreason">Motif (facultatif)</label>
      <textarea id="rreason" rows="3" maxlength="300" class="sel"></textarea></div>
    <div class="row-btns"><button class="pbtn ghost" id="rCancel" type="button">Annuler</button>
      <button class="pbtn" id="rSend" type="button">Envoyer le signalement</button></div>
  </div>`;
  document.body.appendChild(d);
  d.querySelector("#rCancel").onclick = () => d.remove();
  d.querySelector("#rSend").onclick = async () => {
    const r = await api(`/api/chat/${id}/report`, { type: d.querySelector("#rtype").value, reason: d.querySelector("#rreason").value });
    toast(r.ok ? "Signalement envoyé. Merci." : (r.error || "Erreur"));
    d.remove();
  };
}

// Chat : rafraîchissement à l'ouverture et toutes les 5 secondes
document.querySelectorAll('nav.bottom button[data-view="chat"]').forEach(b => b.addEventListener("click", () => renderChat()));
setInterval(() => { const v = $("#v-chat"); if (v && !v.hidden) renderChat(); }, 5000);

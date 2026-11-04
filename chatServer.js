// chat.js — chat communautaire : filtre, images interdites, protection des mineurs, modération.
// Les droits de modération ne se donnent que par la ligne de commande (voir server.js) :
//   node server.js mod grant  email@exemple.fr
// Aucune route HTTP ne permet de s'accorder ce droit.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "data", "chat.json");
const MAX_LEN = 300;
const COOLDOWN = 2000;
const AUTO_BAN_WARNINGS = 3;
const AUTO_BAN_HOURS = 24;

// Liste de départ : à compléter selon votre communauté.
// Le texte est normalisé (accents, leet speak) avant la comparaison.
const BAD = ["con", "connard", "connasse", "salope", "pute", "putain", "merde", "encule", "enculé", "nique", "fdp",
  "idiot", "imbecile", "debile", "cretin", "fuck", "shit", "bitch", "asshole", "sheet", "putain"];

let chat = read();
chat.reports = chat.reports || [];
chat.rseq = chat.rseq || 0;

// Messages chiffrés au repos (AES-256-GCM) avec la clé data/secret.key.
// Le fichier chat.json ne contient jamais le texte en clair.
const KEY = Buffer.from(fs.readFileSync(path.join(__dirname, "data", "secret.key"), "utf8").trim(), "hex");
function encText(t) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const e = Buffer.concat([c.update(t, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), e].map(b => b.toString("hex")).join(":");
}
function decText(s) {
  try {
    const [iv, tag, e] = s.split(":").map(x => Buffer.from(x, "hex"));
    const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(e), d.final()]).toString("utf8");
  } catch (err) { return "[message illisible]"; }
}
function textOf(m) { return m.enc ? decText(m.enc) : (m.text || ""); }
const LAST = {};

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch (e) { return { messages: [], bans: {}, warnings: {}, seq: 0 }; }
}
function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(chat, null, 2));
  fs.renameSync(tmp, FILE);
}

function ageOf(birth) {
  if (!birth) return 0;
  const b = new Date(birth), n = new Date();
  if (isNaN(b)) return 0;
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/4/g, "a").replace(/3/g, "e").replace(/[1!|]/g, "i").replace(/0/g, "o")
    .replace(/[5$]/g, "s").replace(/@/g, "a").replace(/[^a-z]+/g, " ");
}

// Renvoie null si le message est acceptable, sinon { msg, insult }.
function check(text, minor) {
  if (/!\[|data:image\/|https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp)\b/i.test(text))
    return { msg: "Les images ne sont pas autorisées dans le chat." };
  if (minor && /(https?:\/\/|www\.)/i.test(text))
    return { msg: "Les liens ne sont pas autorisés pour les moins de 18 ans." };
  if (minor && /\b0[1-9](?:[ .-]?\d{2}){4}\b|\+\d{8,}/.test(text))
    return { msg: "Ne partagez pas de numéro de téléphone." };
  if (minor && /@[a-z0-9.-]+\.[a-z]{2,}/i.test(text))
    return { msg: "Ne partagez pas d'adresse e-mail." };
  const words = normalize(text).split(/\s+/).filter(Boolean);
  const bad = words.some(w => BAD.includes(w) || (w.length >= 6 && BAD.some(b => b.length >= 5 && w.includes(b))));
  if (bad) return { msg: "Message refusé : langage inapproprié.", insult: true };
  return null;
}

function activeBan(uid) {
  const b = chat.bans[uid];
  if (b && b.until > Date.now()) return b;
  if (b) { delete chat.bans[uid]; save(); }
  return null;
}

function addWarning(uid, reason, by) {
  const list = (chat.warnings[uid] = chat.warnings[uid] || []);
  list.push({ reason, ts: Date.now(), by });
  if (list.length >= AUTO_BAN_WARNINGS && !activeBan(uid)) {
    chat.bans[uid] = { until: Date.now() + AUTO_BAN_HOURS * 3600e3, reason: AUTO_BAN_WARNINGS + " avertissements" };
  }
  save();
  return list.length;
}

function publicMsg(m) {
  return { id: m.id, uid: m.uid, name: m.name, ts: m.ts, deleted: m.deleted,
    text: m.deleted ? "[message supprimé par la modération]" : textOf(m) };
}

// Appelé par server.js. Renvoie true si la route a été traitée.
function handle(ctx) {
  const { req, res, p, body, acc, need, send, str, profils } = ctx;
  const m = req.method;

  if (m === "GET" && p === "/api/chat") {
    if (!need()) return true;
    send(res, 200, {
      ok: true, mod: !!acc.mod, age: ageOf(acc.birth), ban: activeBan(acc.uid),
      warnings: chat.warnings[acc.uid] || [],
      messages: chat.messages.slice(-80).map(publicMsg)
    });
    return true;
  }

  if (m === "POST" && p === "/api/chat") {
    if (!need()) return true;
    const ban = activeBan(acc.uid);
    if (ban) {
      send(res, 403, { ok: false, error: `Vous êtes banni du chat jusqu'au ${new Date(ban.until).toLocaleString("fr-FR")}.` });
      return true;
    }
    const age = ageOf(acc.birth);
    if (age < 13) { send(res, 403, { ok: false, error: "Le chat est réservé aux joueurs de 13 ans et plus." }); return true; }
    const minor = age < 18;
    const text = str(body.text).trim();
    if (!text) { send(res, 400, { ok: false, error: "Message vide." }); return true; }
    if (text.length > MAX_LEN) { send(res, 400, { ok: false, error: `Maximum ${MAX_LEN} caractères.` }); return true; }
    const now = Date.now();
    if (LAST[acc.uid] && now - LAST[acc.uid] < COOLDOWN) {
      send(res, 429, { ok: false, error: "Doucement : attendez quelques secondes." }); return true;
    }
    const verdict = check(text, minor);
    if (verdict) {
      let n = null;
      if (verdict.insult) n = addWarning(acc.uid, "Langage inapproprié", "filtre automatique");
      send(res, 400, { ok: false, error: verdict.msg, warnings: n });
      return true;
    }
    LAST[acc.uid] = now;
    const msg = { id: ++chat.seq, uid: acc.uid, name: acc.name, enc: encText(text), ts: now, deleted: false };
    chat.messages.push(msg);
    chat.messages = chat.messages.slice(-500);
    save();
    send(res, 200, { ok: true, message: publicMsg(msg) });
    return true;
  }

  // Signalement : ouvert à tous les joueurs, y compris aux modérateurs
  if (m === "POST" && /^\/api\/chat\/\d+\/report$/.test(p)) {
    if (!need()) return true;
    const id = Number(p.split("/")[3]);
    const msg = chat.messages.find(x => x.id === id);
    if (!msg || msg.deleted) { send(res, 404, { ok: false, error: "Message introuvable." }); return true; }
    if (msg.uid === acc.uid) { send(res, 400, { ok: false, error: "Vous ne pouvez pas signaler votre propre message." }); return true; }
    if (chat.reports.some(r => r.msgId === id && r.reporterUid === acc.uid && r.status === "open")) {
      send(res, 400, { ok: false, error: "Vous avez déjà signalé ce message." }); return true;
    }
    chat.rseq += 1;
    chat.reports.push({
      id: chat.rseq, msgId: id, msgEnc: msg.enc || encText(msg.text || ""), authorUid: msg.uid, authorName: msg.name,
      reporterUid: acc.uid, reporterName: acc.name,
      type: str(body.type).slice(0, 60) || "Autre", reason: str(body.reason).trim().slice(0, 300),
      ts: Date.now(), status: "open"
    });
    save();
    send(res, 200, { ok: true });
    return true;
  }

  // Actions de modération : réservées aux comptes avec le droit accordé par la ligne de commande
  const isMod = p.startsWith("/api/mod/") || (m === "DELETE" && p.startsWith("/api/chat/"));
  if (!isMod) return false;
  if (!need()) return true;
  if (!acc.mod) { send(res, 403, { ok: false, error: "Droits de modération requis." }); return true; }

  if (m === "GET" && p === "/api/mod/reports") {
    const list = chat.reports.slice()
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.ts - a.ts)
      .slice(0, 200);
    send(res, 200, { ok: true, reports: list.map(r => ({ ...r, msgText: r.msgEnc ? decText(r.msgEnc) : (r.msgText || "") })) });
    return true;
  }

  const rm = p.match(/^\/api\/mod\/reports\/(\d+)\/resolve$/);
  if (m === "POST" && rm) {
    const rep = chat.reports.find(r => r.id === Number(rm[1]));
    if (!rep) { send(res, 404, { ok: false, error: "Signalement introuvable." }); return true; }
    if (rep.status !== "open") { send(res, 400, { ok: false, error: "Signalement déjà traité." }); return true; }
    const action = str(body.action);
    if (!["dismiss", "delete", "warn", "ban"].includes(action)) { send(res, 400, { ok: false, error: "Action inconnue." }); return true; }
    const author = Object.values(profils).find(a => a.uid === rep.authorUid);
    if ((action === "warn" || action === "ban") && author && author.mod) {
      send(res, 400, { ok: false, error: "Impossible de sanctionner un modérateur : vous pouvez seulement ignorer ou supprimer ce message." });
      return true;
    }
    const msg = chat.messages.find(x => x.id === rep.msgId);
    if (action === "delete" && msg) msg.deleted = true;
    if (action === "warn" && author) addWarning(author.uid, rep.type + " (signalement)", acc.name);
    if (action === "ban" && author) {
      const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 365);
      chat.bans[author.uid] = { until: Date.now() + hours * 3600e3, reason: rep.type };
    }
    rep.status = action === "dismiss" ? "ignoré" : "traité";
    rep.action = action; rep.resolvedBy = acc.name; rep.resolvedTs = Date.now();
    save();
    send(res, 200, { ok: true });
    return true;
  }

  if (m === "DELETE" && p.startsWith("/api/chat/")) {
    const id = Number(p.split("/").pop());
    const msg = chat.messages.find(x => x.id === id);
    if (!msg) { send(res, 404, { ok: false, error: "Message introuvable." }); return true; }
    msg.deleted = true; save();
    send(res, 200, { ok: true });
    return true;
  }

  const target = Object.values(profils).find(a => a.uid === str(body.uid));
  if (!target) { send(res, 404, { ok: false, error: "Utilisateur introuvable." }); return true; }
  if (target.mod) { send(res, 400, { ok: false, error: "Impossible de sanctionner un modérateur." }); return true; }

  if (m === "POST" && p === "/api/mod/warn") {
    const n = addWarning(target.uid, str(body.reason).trim().slice(0, 200) || "Avertissement", acc.name);
    send(res, 200, { ok: true, warnings: n });
    return true;
  }
  if (m === "POST" && p === "/api/mod/ban") {
    const hours = Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 365);
    chat.bans[target.uid] = { until: Date.now() + hours * 3600e3, reason: str(body.reason).trim().slice(0, 200) || "Sanction de modération" };
    save();
    send(res, 200, { ok: true });
    return true;
  }
  if (m === "POST" && p === "/api/mod/unban") {
    delete chat.bans[target.uid]; save();
    send(res, 200, { ok: true });
    return true;
  }
  return false;
}

module.exports = { handle, ageOf };

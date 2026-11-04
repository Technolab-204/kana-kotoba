// Kana & Kotoba — serveur local. Aucune dépendance : Node.js 18+ suffit.
// Lancer : node server.js   puis ouvrir http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const PORT = process.env.PORT || 3000;
fs.mkdirSync(DATA, { recursive: true });

const F = {
  profils: path.join(DATA, "profils.json"),   // comptes : mots de passe hachés, 2FA chiffrée
  level: path.join(DATA, "level.json"),       // progression indexée par uid du compte
  sessions: path.join(DATA, "sessions.json"), // identifiants de session (cookies)
  key: path.join(DATA, "secret.key")          // clé de chiffrement locale : ne pas partager
};

function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return def; } }
function writeJSON(f, obj) { const tmp = f + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, f); }

const KEY = fs.existsSync(F.key)
  ? Buffer.from(fs.readFileSync(F.key, "utf8"), "hex")
  : (() => { const k = crypto.randomBytes(32); fs.writeFileSync(F.key, k.toString("hex")); return k; })();

let profils = readJSON(F.profils, {}); // { email: compte }
let level = readJSON(F.level, {});     // { uid: progression }
let sessions = readJSON(F.sessions, {}); // { sid: { uid, exp } }

const saveProfils = () => writeJSON(F.profils, profils);
const saveLevel = () => writeJSON(F.level, level);
const saveSessions = () => writeJSON(F.sessions, sessions);
const saveAll = () => { saveProfils(); };

// Droits de modération : uniquement par la ligne de commande, jamais par le web.
//   node server.js mod grant  email@exemple.fr
//   node server.js mod revoke email@exemple.fr
//   node server.js mod list
if (process.argv[2] === "mod") {
  const [, , , action, email] = process.argv;
  if (action === "list") {
    console.log(Object.values(profils).filter(a => a.mod).map(a => a.email).join("\n") || "Aucun modérateur.");
    process.exit(0);
  }
  const acc = profils[String(email || "").toLowerCase()];
  if (!acc) { console.log("Compte introuvable : " + email); process.exit(1); }
  if (action === "grant") { acc.mod = true; console.log("Modérateur accordé à " + acc.email); }
  else if (action === "revoke") { acc.mod = false; console.log("Droits retirés à " + acc.email); }
  else { console.log("Usage : node server.js mod grant|revoke|list <email>"); process.exit(1); }
  saveProfils();
  process.exit(0);
}
const chatModule = require("./chatServer");

/* ---------- Cryptographie ---------- */
// Mot de passe : scrypt avec sel aléatoire. Haché, donc irréversible, même pour vous.
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return "scrypt$" + salt.toString("hex") + "$" + crypto.scryptSync(pw, salt, 64).toString("hex");
}
function checkPw(pw, stored) {
  if (!stored) return false;
  const [, s, h] = stored.split("$");
  const calc = crypto.scryptSync(pw, Buffer.from(s, "hex"), 64);
  return crypto.timingSafeEqual(calc, Buffer.from(h, "hex"));
}
// Secret 2FA : chiffré en AES-256-GCM avec secret.key (réversible, car il faut le relire pour vérifier le code)
function enc(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const e = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), e].map(b => b.toString("hex")).join(":");
}
function dec(s) {
  const [iv, tag, e] = s.split(":").map(x => Buffer.from(x, "hex"));
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(e), d.final()]).toString("utf8");
}

/* ---------- TOTP (RFC 6238) ---------- */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf) {
  let bits = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = ""; for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function b32decode(s) {
  let bits = ""; for (const c of s.toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return String(n).padStart(6, "0");
}
function verifyTotp(secret, code) {
  const c = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some(d => totpAt(secret, c + d) === String(code));
}

/* ---------- Codes de secours ---------- */
const ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCodes(n = 8) {
  return Array.from({ length: n }, () => {
    let s = ""; for (const x of crypto.randomBytes(8)) s += ALPH[x % ALPH.length];
    return s.slice(0, 4) + "-" + s.slice(4);
  });
}
function hashedCodes(codes) { return codes.map(c => ({ h: hashPw(c.replace("-", "")), used: false })); }
function takeRecovery(acc, input) {
  const c = String(input || "").replace(/[\s-]/g, "").toUpperCase();
  for (const r of acc.recovery || []) if (!r.used && checkPw(c, r.h)) { r.used = true; return true; }
  return false;
}

/* ---------- Sessions (cookies HttpOnly) ---------- */
function getCookie(req, name) {
  const found = (req.headers.cookie || "").split(";").map(c => c.trim().split("=")).find(([k]) => k === name);
  return found ? decodeURIComponent(found[1] || "") : "";
}
function newSession(uid) {
  const sid = crypto.randomBytes(32).toString("hex");
  sessions[sid] = { uid, exp: Date.now() + 30 * 864e5 };
  saveSessions();
  return sid;
}
function sessionCookie(sid, maxAge) {
  return `kk_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function uidFrom(req) {
  const s = sessions[getCookie(req, "kk_sid")];
  return s && s.exp > Date.now() ? s.uid : null;
}
function accByUid(uid) { return uid ? Object.values(profils).find(a => a.uid === uid) || null : null; }
function pub(a) {
  return { uid: a.uid, email: a.email, name: a.name, avatar: a.avatar, totp: !!a.totp, mod: !!a.mod, progress: level[a.uid] || {} };
}

/* ---------- HTTP ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 2e6) { req.destroy(); reject(new Error("trop gros")); } });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
  });
}
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(obj));
}

async function api(req, res, p) {
  const body = req.method === "GET" ? {} : await readBody(req);
  const uid = uidFrom(req), acc = accByUid(uid);
  const need = () => { if (!acc) send(res, 401, { ok: false, error: "Connexion requise" }); return !!acc; };
  const str = v => String(v ?? "");

  if (req.method === "POST" && p === "/api/signup") {
    const name = str(body.name).trim().slice(0, 24), email = str(body.email).trim().toLowerCase(), pw = str(body.password);
    if (!name) return send(res, 400, { ok: false, error: "Indiquez un pseudo." });
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { ok: false, error: "Adresse e-mail invalide." });
    if (pw.length < 8) return send(res, 400, { ok: false, error: "Le mot de passe doit faire au moins 8 caractères." });
    const birth = str(body.birthdate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || isNaN(new Date(birth))) return send(res, 400, { ok: false, error: "Indiquez votre date de naissance." });
    if (profils[email]) return send(res, 409, { ok: false, error: "Un compte existe déjà avec cette adresse." });
    const codes = newCodes();
    const a = { uid: crypto.randomUUID(), email, name, birth, mod: false, avatar: { emoji: "🌸", bg: "#F4B6C6" }, pw: hashPw(pw), totp: null, recovery: hashedCodes(codes) };
    profils[email] = a; level[a.uid] = {};
    saveAll(); saveLevel();
    return send(res, 200, { ok: true, codes, account: pub(a) }, { "Set-Cookie": sessionCookie(newSession(a.uid), 30 * 86400) });
  }

  if (req.method === "POST" && p === "/api/login") {
    const email = str(body.email).trim().toLowerCase(), a = profils[email];
    if (!a || !checkPw(str(body.password), a.pw)) return send(res, 401, { ok: false, error: "E-mail ou mot de passe incorrect." });
    if (a.totp && !body.otp) return send(res, 200, { ok: false, needOtp: true });
    if (a.totp) {
      const code = str(body.otp).replace(/\s/g, "");
      const good = /^\d{6}$/.test(code) && verifyTotp(dec(a.totp), code);
      if (!good && !takeRecovery(a, code)) return send(res, 401, { ok: false, error: "Code incorrect." });
      saveProfils();
    }
    return send(res, 200, { ok: true, account: pub(a) }, { "Set-Cookie": sessionCookie(newSession(a.uid), 30 * 86400) });
  }

  if (req.method === "POST" && p === "/api/logout") {
    delete sessions[getCookie(req, "kk_sid")]; saveSessions();
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (req.method === "GET" && p === "/api/me") {
    if (!need()) return;
    return send(res, 200, { ok: true, account: pub(acc) });
  }

  if (req.method === "PUT" && p === "/api/progress") {
    if (!need()) return;
    const pr = body.progress;
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) return send(res, 400, { ok: false, error: "Progression invalide." });
    if (JSON.stringify(pr).length > 500000) return send(res, 413, { ok: false, error: "Progression trop volumineuse." });
    level[acc.uid] = pr; saveLevel();
    return send(res, 200, { ok: true });
  }

  if (req.method === "PUT" && p === "/api/profile") {
    if (!need()) return;
    if (body.name !== undefined) acc.name = str(body.name).trim().slice(0, 24) || acc.name;
    if (body.avatar !== undefined) {
      const av = body.avatar;
      if (av && av.src) {
        if (!str(av.src).startsWith("data:image/jpeg;base64,") || av.src.length > 300000) return send(res, 400, { ok: false, error: "Image invalide." });
        acc.avatar = { src: av.src };
      } else {
        acc.avatar = { emoji: str(av && av.emoji).slice(0, 8) || "🌸", bg: str(av && av.bg).slice(0, 12) || "#F4B6C6" };
      }
    }
    saveAll();
    return send(res, 200, { ok: true, account: pub(acc) });
  }

  if (req.method === "POST" && p === "/api/password") {
    if (!need()) return;
    if (!checkPw(str(body.current), acc.pw)) return send(res, 400, { ok: false, error: "Mot de passe actuel incorrect." });
    if (str(body.password).length < 8) return send(res, 400, { ok: false, error: "8 caractères minimum." });
    acc.pw = hashPw(str(body.password)); saveAll();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/2fa/setup") {
    if (!need()) return;
    const secret = b32encode(crypto.randomBytes(20));
    acc.pendingTotp = enc(secret); saveAll();
    const uri = `otpauth://totp/Kana%20%26%20Kotoba:${encodeURIComponent(acc.email)}?secret=${secret}&issuer=Kana%20%26%20Kotoba`;
    return send(res, 200, { ok: true, secret, uri });
  }

  if (req.method === "POST" && p === "/api/2fa/enable") {
    if (!need()) return;
    if (!acc.pendingTotp) return send(res, 400, { ok: false, error: "Lancez d'abord la configuration." });
    if (!verifyTotp(dec(acc.pendingTotp), str(body.code).replace(/\s/g, ""))) return send(res, 400, { ok: false, error: "Code incorrect." });
    acc.totp = acc.pendingTotp; delete acc.pendingTotp; saveAll();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/2fa/disable") {
    if (!need()) return;
    const code = str(body.code).replace(/\s/g, "");
    const good = acc.totp && (verifyTotp(dec(acc.totp), code) || takeRecovery(acc, code));
    if (!good) return send(res, 400, { ok: false, error: "Code incorrect." });
    acc.totp = null; saveAll();
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/codes/regen") {
    if (!need()) return;
    const codes = newCodes(); acc.recovery = hashedCodes(codes); saveAll();
    return send(res, 200, { ok: true, codes });
  }

  if (req.method === "POST" && p === "/api/reset") {
    const a = profils[str(body.email).trim().toLowerCase()];
    if (!a || str(body.password).length < 8 || !takeRecovery(a, body.code)) {
      return send(res, 400, { ok: false, error: "Code de secours invalide ou déjà utilisé." });
    }
    a.pw = hashPw(str(body.password)); saveAll();
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && p === "/api/league") {
    const rows = Object.values(profils).map(a => {
      const pr = level[a.uid] || {};
      return { id: a.uid, name: a.name, avatar: a.avatar, tier: pr.tier || 0, weekId: pr.weekId, weekXp: pr.weekXp || 0 };
    }).filter(r => r.weekId);
    return send(res, 200, { ok: true, rows });
  }

  if (chatModule.handle({ req, res, p, body, acc, need, send, str, profils })) return;
  return send(res, 404, { ok: false, error: "Route inconnue" });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
function serveStatic(res, p) {
  const file = path.normalize(path.join(PUB, p === "/" ? "/index.html" : p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Introuvable"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/")) return await api(req, res, u.pathname);
    return serveStatic(res, u.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { ok: false, error: "Erreur serveur" });
  }
}).listen(PORT, () => console.log(`Kana & Kotoba : http://localhost:${PORT}`));

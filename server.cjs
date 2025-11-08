// server.cjs — Cartenz Panel (SSE streaming + billing + trial limit + clean output + manage ssh)

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { spawn, exec } = require("child_process");
const { EventEmitter } = require("events");

// ===== Konfigurasi =====
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_ubah_dengan_ENV";
const PRICE_ADD = 5000; // harga per Add account untuk non-admin

const APP_DIR   = __dirname;
const DATA_FILE = path.join(APP_DIR, "users.json");
const PUBLIC_DIR= path.join(APP_DIR, "public");

// ===== users.json helper =====
function ensureUsers() {
  if (!fs.existsSync(DATA_FILE)) {
    const passhash = bcrypt.hashSync("ganti_password", 12);
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify([{ username: "admin", passhash, role: "admin", balance: 0, lastTrialDate: null }], null, 2)
    );
    console.log("[init] users.json dibuat. User: admin / ganti_password (segera ganti!)");
  }
}
function readUsers() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return []; }
}
function writeUsers(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)); }
function getUser(username) { return readUsers().find(u => u.username === username); }
function saveUser(u) {
  const arr = readUsers();
  const i = arr.findIndex(x => x.username === u.username);
  if (i >= 0) arr[i] = u; else arr.push(u);
  writeUsers(arr);
}

// ===== App =====
const app = express();
app.set("trust proxy", 1);
// header security (HSTS, CSP, dll)
app.use((req, res, next) => {
  // Paksa HTTPS ke depannya (browser akan mengingat 1 tahun)
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  // Upgrade semua http:// di halaman menjadi https://
  res.setHeader("Content-Security-Policy", "upgrade-insecure-requests");
  // Hardening header lain
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: "cartenz.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: true,         // <-- wajib true agar tidak ditandai “Not secure” di HTTPS
  },
}));
if (fs.existsSync(PUBLIC_DIR)) app.use(express.static(PUBLIC_DIR, { maxAge: 0 }));

// ===== Auth =====
function authRequired(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: "unauthorized" });
}
function adminRequired(req, res, next) {
  if (req.session?.user?.role === "admin") return next();
  return res.status(403).json({ error: "forbidden" });
}

app.post("/api/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const u = readUsers().find((x) => x.username === username);
  if (!u) return res.status(400).json({ error: "Invalid credentials" });
  if (!bcrypt.compareSync(password, u.passhash))
    return res.status(400).json({ error: "Invalid credentials" });
  req.session.user = { username: u.username, role: u.role || "admin" };
  res.json({ ok: true, user: { username: u.username, role: u.role || "admin", balance: u.balance || 0 } });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => {
  if (!req.session?.user) return res.json({ user: null });
  const u = getUser(req.session.user.username);
  res.json({ user: u ? { username: u.username, role: u.role || "admin", balance: u.balance || 0 } : null });
});
app.post("/api/change-password", authRequired, (req, res) => {
  const { oldPassword = "", newPassword = "" } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: "Password baru minimal 6 karakter" });
  const users = readUsers();
  const i = users.findIndex((x) => x.username === req.session.user.username);
  if (i < 0) return res.status(400).json({ error: "User tidak ditemukan" });
  if (!bcrypt.compareSync(oldPassword, users[i].passhash))
    return res.status(400).json({ error: "Password lama salah" });
  users[i].passhash = bcrypt.hashSync(newPassword, 12);
  writeUsers(users);
  res.json({ ok: true });
});

// ===== Shell helpers =====
const ANSI_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b[@-Z\\-_]|\r/g; // ESC seq + CR
const stripAnsi = (s = "") => s.replace(ANSI_REGEX, "");

// Baris2 yang tidak ingin ditampilkan (MOTD dsb)
const DROP_PATTERNS = [
  /^Host:/i, /^Kernel:/i, /^Uptime:/i, /^Packages:/i, /^Shell:/i, /^Resolution:/i,
  /^Terminal:/i, /^CPU:/i, /^GPU:/i, /^Memory:/i, /^Type 'menu' to display/i, /^Ping Host/i
];
// Baris “aman/berguna”
const KEEP_PATTERNS = [
  /^[-=━]{10,}$/,
  /^\s*SSH Account/i, /^\s*TRIAL SSH/i,
  /^\s*VMESS/i, /^\s*VLESS/i, /^\s*TROJAN/i, /^\s*SHADOWSOCKS/i,
  /^Username\s*:/i, /^Password\s*:/i, /^Expired\s*On\s*:/i, /^Expired\s*:/i,
  /^IP\s*:/i, /^Host\s*:/i,
  /^OpenSSH\s*:/i, /^Dropbear\s*:/i, /^SSH WS\s*:/i, /^SSH SSL WS\s*:/i,
  /^SSL\/TLS\s*:/i, /^UDPGW\s*:/i,
  /^Payload WSS/i, /^Payload WS/i, /^GET\s/i,
  /^Remarks\s*:/i, /^Port\s*:/i, /^Link\s*:/i
];
function shouldDrop(line) { return DROP_PATTERNS.some(re => re.test(line)); }
function shouldKeep(line) {
  if (shouldDrop(line)) return false;
  if (KEEP_PATTERNS.some(re => re.test(line))) return true;
  if (/^ERROR:\s*exit\s+\d+$/i.test(line)) return false;
  return /:/.test(line) && !/^\s+$/.test(line);
}

function sh(cmd, { timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        shell: "/bin/bash",
        timeout,
        maxBuffer: 5 * 1024 * 1024,
        env: {
          ...process.env,
          TERM: "dumb",
          LC_ALL: "C",
          COLUMNS: "120",
          LINES: "40",
          NONINTERACTIVE: "1",
        },
      },
      (err, stdout, stderr) => {
        const raw = `${stdout || ""}${stderr || ""}`;
        const cleaned = stripAnsi(raw).trim();
        if (err) return reject(new Error(cleaned || err.message));
        resolve(cleaned || "(no output)");
      }
    );
  });
}

// streaming: kirim tiap baris sudah difilter
function shStream(cmd, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", cmd], {
      env: { ...process.env, TERM: "dumb", LC_ALL: "C", COLUMNS: "120", LINES: "40", NONINTERACTIVE: "1" }
    });
    let bufOut = ""; let bufErr = "";
    const pushLines = (buf) => {
      const s = stripAnsi(buf);
      s.split(/\n/).forEach(line => {
        const l = line.trimEnd();
        if (l === "") return;
        if (shouldKeep(l)) onLine(l);
      });
    };
    child.stdout.on("data", (c)=> { bufOut += c.toString(); const parts = bufOut.split(/\n/); bufOut = parts.pop(); parts.forEach(pushLines); });
    child.stderr.on("data", (c)=> { bufErr += c.toString(); const parts = bufErr.split(/\n/); bufErr = parts.pop(); parts.forEach(pushLines); });
    child.on("error", (e)=> reject(e));
    child.on("close", () => {
      if (bufOut) pushLines(bufOut);
      if (bufErr) pushLines(bufErr);
      resolve();
    });
  });
}

function randPass(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function fileExists(p) { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }

// ===== Peta perintah =====
const TRIAL_MAP = {
  ssh: "/usr/bin/trial",
  vmess: "/usr/bin/trialvmess",
  vless: "/usr/bin/trialvless",
  trojan: "/usr/bin/trialtrojan",
  ss: "/usr/bin/trialssws",
};
const ADD_MAP = {
  vmess: { feed: (r, d) => `printf '%s\n%s\n' '${r}' '${d}' | /usr/bin/add-ws` },
  vless: { feed: (r, d) => `printf '%s\n%s\n' '${r}' '${d}' | /usr/bin/add-vless` },
  trojan:{ feed: (r, d) => `printf '%s\n%s\n' '${r}' '${d}' | /usr/bin/add-tr` },
  ss:    { feed: (r, d) => `printf '%s\n%s\n' '${r}' '${d}' | /usr/bin/add-ssws` },
};

// ===== Helper: tanggal lokal (Asia/Jakarta) =====
function todayJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD
}

// ====== Trial lock (anti spam / race) ======
const trialBusy = new Set(); // berisi username yang sedang proses trial

// ===== Endpoint lama (JSON) — DIBATASI TRIAL 1x/HARI =====
app.post("/api/trial/:kind", authRequired, async (req, res) => {
  try {
    const uname = req.session.user.username;
    const kind = String(req.params.kind || "").toLowerCase();
    const script = TRIAL_MAP[kind];
    if (!script) return res.status(400).json({ error: "Unsupported kind" });

    // lock
    if (trialBusy.has(uname)) return res.status(429).json({ error: "Trial sedang diproses" });
    trialBusy.add(uname);
    try {
      // reservasi trial di awal
      const today = todayJakarta();
      const uFresh = getUser(uname) || { username: uname, role: "user", balance: 0, lastTrialDate: null };
      if (uFresh.lastTrialDate === today) return res.status(429).json({ error: "Trial hari ini sudah digunakan" });

      uFresh.lastTrialDate = today;
      saveUser(uFresh);

      const out = await sh(script);
      return res.json({ output: out });
    } finally {
      trialBusy.delete(uname);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Add lama (JSON) — jaga saldo agar tak bypass SSE =====
async function handleAddSSH_json(req, res) {
  try {
    const username = (req.body.username || req.body.remarks || "").trim();
    const passwordRaw = (req.body.password || "").toString();
    const days = parseInt(req.body.days, 10) || 30;
    const password = passwordRaw || randPass();
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_\-]{1,31}$/.test(username))
      return res.status(400).json({ error: "username invalid" });
    if (days < 1 || days > 3650) return res.status(400).json({ error: "days out of range" });

    const sessUser = getUser(req.session.user.username);
    if (sessUser && (sessUser.role || "user") !== "admin") {
      if (Number(sessUser.balance || 0) < PRICE_ADD)
        return res.status(402).json({ error: "Saldo tidak cukup" });
    }

    const safePass = password.replace(/'/g, "'\\''");
    const cmd = `printf '%s\n%s\n%s\n' '${username}' '${safePass}' '${days}' | /usr/bin/usernew`;
    const out = await sh(cmd, { timeout: 180000 });

    if (sessUser && (sessUser.role || "user") !== "admin") {
      sessUser.balance = Math.max(0, Number(sessUser.balance || 0) - PRICE_ADD);
      saveUser(sessUser);
    }

    res.json({ output: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.post("/api/add/ssh", authRequired, handleAddSSH_json);

async function handleAddGeneric_json(req, res) {
  try {
    const kind = String(req.params.kind || "").toLowerCase();
    if (kind === "ssh") return handleAddSSH_json(req, res);
    const cfg = ADD_MAP[kind];
    if (!cfg) return res.status(400).json({ error: "Unsupported kind" });

    const remarks = (req.body.remarks || "").trim();
    const days = parseInt(req.body.days, 10) || 30;
    if (!remarks) return res.status(400).json({ error: "remarks is required" });
    if (days < 1 || days > 3650) return res.status(400).json({ error: "days out of range" });

    const sessUser = getUser(req.session.user.username);
    if (sessUser && (sessUser.role || "user") !== "admin") {
      if (Number(sessUser.balance || 0) < PRICE_ADD)
        return res.status(402).json({ error: "Saldo tidak cukup" });
    }

    const out = await sh(cfg.feed(remarks, days));

    if (sessUser && (sessUser.role || "user") !== "admin") {
      sessUser.balance = Math.max(0, Number(sessUser.balance || 0) - PRICE_ADD);
      saveUser(sessUser);
    }

    res.json({ output: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.post("/api/add/:kind", authRequired, handleAddGeneric_json);

// Alias SS lama
function wrap(method, route, handler) { app[method](route, authRequired, handler); }
wrap("post", "/api/add/ss", (req, res) => { req.params = { kind: "ss" }; return handleAddGeneric_json(req, res); });
wrap("get",  "/api/add/ss", (req, res) => { req.params = { kind: "ss" }; return handleAddGeneric_json(req, res); });
wrap("post", "/api/add/shadowsocks", (req, res) => { req.params = { kind: "ss" }; return handleAddGeneric_json(req, res); });
wrap("get",  "/api/add/shadowsocks", (req, res) => { req.params = { kind: "ss" }; return handleAddGeneric_json(req, res); });

// ===== SSE JOB REGISTRY (buffered) =====
const jobs = new Map(); // id -> {em: EventEmitter, done:boolean, buf:Array<{type,data}>}

function newJob() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const em = new EventEmitter();
  jobs.set(id, { em, done: false, buf: [] });
  return { id, em };
}
function finishJob(id) {
  const j = jobs.get(id);
  if (j) {
    j.done = true;
    j.em.emit("done", {});
    j.buf.push({ type: "done" });
    setTimeout(() => jobs.delete(id), 5 * 60 * 1000);
  }
}
function pushBuf(id, evt) {
  const j = jobs.get(id);
  if (j) j.buf.push(evt);
}
function emitLine(id, line) {
  const j = jobs.get(id);
  if (!j) return;
  j.em.emit("line", line);
  pushBuf(id, { type: "line", data: line });
}
function emitBalance(id, amount) {
  const j = jobs.get(id);
  if (!j) return;
  j.em.emit("balance", amount);
  pushBuf(id, { type: "balance", amount });
}

// ===== SSE STREAM ENDPOINT (flush buffer on subscribe) =====
app.get("/api/stream/job/:id", authRequired, (req, res) => {
  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).end("no such job");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const sendType = (type, extra = {}) => send({ type, ...extra });

  // 1) Flush semua event yang sempat terjadi sebelum subscribe
  for (const evt of job.buf) send(evt);

  // 2) Subscribe realtime
  const onLine = (s) => sendType("line", { data: s });
  const onBal  = (amt) => sendType("balance", { amount: amt });
  const onDone = () => sendType("done");

  job.em.on("line", onLine);
  job.em.on("balance", onBal);
  job.em.on("done", onDone);

  // 3) Heartbeat
  const hb = setInterval(() => res.write(": ping\n\n"), 15000);

  // 4) Jika job sudah selesai, pastikan 'done' terkirim (idempotent)
  if (job.done) sendType("done");

  req.on("close", () => {
    job.em.off("line", onLine);
    job.em.off("balance", onBal);
    job.em.off("done", onDone);
    clearInterval(hb);
  });
});


// ===== SSE: ADD (billing & clean output) =====
app.post("/api/sse/add/:kind", authRequired, async (req, res) => {
  const sessUname = req.session.user.username;
  const sessUser  = getUser(sessUname) || { username: sessUname, role: "user", balance: 0 };

  const kind = String(req.params.kind || "").toLowerCase();
  const { id } = newJob();
  res.json({ jobId: id });

  (async () => {
    try {
      const fresh = getUser(sessUname) || sessUser;
      if ((fresh.role || "user") !== "admin") {
        const saldo = Number(fresh.balance || 0);
        if (saldo < PRICE_ADD) {
          emitLine(id, `❌ Saldo tidak cukup (Rp ${saldo.toLocaleString("id-ID")}). Minimal Rp ${PRICE_ADD.toLocaleString("id-ID")}.`);
          finishJob(id);
          return;
        }
      }

      let cmd = "";
      if (kind === "ssh") {
        const body = req.body || {};
        const sshUser = (body.username || body.remarks || "").trim();
        const passwordRaw = (body.password || "").toString();
        const days = parseInt(body.days, 10) || 30;
        if (!/^[a-zA-Z0-9_][a-zA-Z0-9_\-]{1,31}$/.test(sshUser)) { emitLine(id, "username invalid"); finishJob(id); return; }
        if (days < 1 || days > 3650) { emitLine(id, "days out of range"); finishJob(id); return; }
        const pass = passwordRaw || randPass();
        const safePass = pass.replace(/'/g, "'\\''");
        cmd = `printf '%s\n%s\n%s\n' '${sshUser}' '${safePass}' '${days}' | /usr/bin/usernew`;
      } else {
        const cfg = ADD_MAP[kind];
        if (!cfg) { emitLine(id, "Unsupported kind"); finishJob(id); return; }
        const body = req.body || {};
        const remarks = (body.remarks || "").trim();
        const days = parseInt(body.days, 10) || 30;
        if (!remarks) { emitLine(id, "remarks is required"); finishJob(id); return; }
        if (days < 1 || days > 3650) { emitLine(id, "days out of range"); finishJob(id); return; }
        cmd = cfg.feed(remarks, days);
      }

      emitLine(id, "Menjalankan skrip …");
      await shStream(cmd, (line)=> emitLine(id, line));

      if ((fresh.role || "user") !== "admin") {
        let after = Number(fresh.balance || 0) - PRICE_ADD;
        if (after < 0) after = 0;
        fresh.balance = after;
        saveUser(fresh);
        emitBalance(id, after);
        emitLine(id, `💰 Saldo dipotong Rp ${PRICE_ADD.toLocaleString("id-ID")}. Sisa saldo: Rp ${after.toLocaleString("id-ID")}`);
      }

      finishJob(id);
    } catch (e) {
      emitLine(id, `ERROR: ${e.message}`);
      finishJob(id);
    }
  })();
});

// ===== SSE: TRIAL (limit 1x/hari dengan lock) =====
app.post("/api/sse/trial/:kind", authRequired, async (req, res) => {
  const sessUname = req.session.user.username;
  const kind = String(req.params.kind || "").toLowerCase();

  const { id } = newJob();
  res.json({ jobId: id });

  (async () => {
    const say = (s)=> emitLine(id, s);
    try {
      // lock
      if (trialBusy.has(sessUname)) { say("❗ Trial sedang diproses, tunggu sampai selesai."); finishJob(id); return; }
      trialBusy.add(sessUname);
      try {
        // reservasi di awal
        const today = todayJakarta();
        const uFresh = getUser(sessUname) || { username: sessUname, role: "user", balance: 0, lastTrialDate: null };
        if (uFresh.lastTrialDate === today) { say("❌ Trial hari ini sudah digunakan. Coba lagi besok."); finishJob(id); return; }

        uFresh.lastTrialDate = today;
        saveUser(uFresh);

        const script = TRIAL_MAP[kind];
        if (!script) { say("Unsupported kind"); finishJob(id); return; }

        say("Membuat trial …");
        await shStream(script, (line)=> say(line));

        say("✅ Trial berhasil. Anda hanya bisa membuat 1 trial per hari.");
        finishJob(id);
      } finally {
        trialBusy.delete(sessUname);
      }
    } catch (e) {
      say(`ERROR: ${e.message}`);
      finishJob(id);
    }
  })();
});

// ===== List Accounts =====
function parseXrayAccounts() {
  const result = { vmess: [], vless: [], trojan: [], ss: [] };
  let txt = "";
  try { txt = fs.readFileSync("/etc/xray/config.json", "utf8"); } catch { return result; }

  (txt.match(/^###\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/gm) || []).forEach(line => {
    const m = line.match(/^###\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/);
    if (m) result.vmess.push({ user: m[1], exp: m[2] });
  });
  (txt.match(/^#&\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/gm) || []).forEach(line => {
    const m = line.match(/^#&\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/);
    if (m) result.vless.push({ user: m[1], exp: m[2] });
  });
  (txt.match(/^#!\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/gm) || []).forEach(line => {
    const m = line.match(/^#!\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/);
    if (m) result.trojan.push({ user: m[1], exp: m[2] });
  });

  const vmessSet = new Set(result.vmess.map(x => x.user));
  (txt.match(/^###\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/gm) || []).forEach(line => {
    const m = line.match(/^###\s+(\S+)\s+(\d{4}-\d{2}-\d{2})/);
    if (m && !vmessSet.has(m[1])) result.ss.push({ user: m[1], exp: m[2] });
  });
  return result;
}

async function listSSHAccounts() {
  const cmd = `
    awk -F: '($3>=1000)&&($7=="/bin/false"||$7=="/usr/sbin/nologin"){print $1}' /etc/passwd | while read u; do
      exp=$(chage -l "$u" | awk -F": " "/Account expires/{print \\$2}");
      echo "$u|$exp";
    done
  `;
  const out = await sh(cmd).catch(()=> "");
  const rows = (out||"").split("\n").filter(Boolean);
  return rows.map(r => {
    const [user, exp] = r.split("|");
    return { user, exp: (exp || "").trim() };
  });
}

app.get("/api/accounts", authRequired, async (req, res) => {
  try {
    const ssh = await listSSHAccounts().catch(() => []);
    const xr = parseXrayAccounts();
    res.json({ ssh, vmess: xr.vmess, vless: xr.vless, trojan: xr.trojan, ss: xr.ss });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Delete Accounts =====
app.delete("/api/accounts/:kind/:name", authRequired, async (req, res) => {
  try {
    const kind = String(req.params.kind || "").toLowerCase();
    const name = String(req.params.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });

    if (kind === "ssh") {
      const out = await sh(`pkill -KILL -u '${name}' 2>/dev/null || true; userdel -f '${name}' && echo "deleted"`);
      return res.json({ ok: true, output: out });
    }

    const DEL = {
      vmess: "/usr/bin/del-ws",
      vless: "/usr/bin/del-vless",
      trojan: "/usr/bin/del-tr",
      ss: "/usr/bin/del-ssws",
      shadowsocks: "/usr/bin/del-ssws",
    }[kind];

    if (!DEL || !fileExists(DEL)) {
      return res
        .status(501)
        .json({ error: "delete-script not found", needed: DEL || "(unknown)" });
    }

    const out = await sh(`printf '%s\n' '${name}' | ${DEL}`);
    return res.json({ ok: true, output: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN =====
app.get("/api/admin/users", authRequired, adminRequired, (req, res) => {
  const users = readUsers().map(u => ({ username: u.username, role: u.role || "user", balance: u.balance || 0, lastTrialDate: u.lastTrialDate || null }));
  res.json({ users });
});
app.post("/api/admin/create-user", authRequired, adminRequired, (req, res) => {
  const { username="", password="", role="user", balance=0 } = req.body || {};
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_\-]{1,31}$/.test(username))
    return res.status(400).json({ error: "username invalid" });
  const users = readUsers();
  if (users.some(u => u.username === username)) return res.status(400).json({ error: "username exists" });
  const passhash = bcrypt.hashSync(password || "changeme123", 12);
  users.push({ username, passhash, role, balance: Number(balance)||0, lastTrialDate: null });
  writeUsers(users);
  res.json({ ok: true });
});
app.post("/api/admin/add-balance", authRequired, adminRequired, (req, res) => {
  const { username="", amount=0 } = req.body || {};
  const users = readUsers();
  const i = users.findIndex(u => u.username === username);
  if (i < 0) return res.status(404).json({ error: "user not found" });
  users[i].balance = Number(users[i].balance || 0) + Math.max(0, Number(amount)||0);
  writeUsers(users);
  res.json({ ok: true, balance: users[i].balance });
});

// ===== Health =====
app.get("/api/ping", (_req, res) => res.json({ ok: true }));

// ===== Start =====
ensureUsers();
app.listen(PORT, () => console.log(`[panel] listening on :${PORT}`));

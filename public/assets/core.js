/* core.js — helper bersama untuk semua halaman (notif fix kuat) */
(() => {
  // ===== Helper DOM & HTTP =====
  window.$  = (s) => document.querySelector(s);
  window.$$ = (s) => Array.from(document.querySelectorAll(s));

  window.esc = (s) => (s||"").toString().replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  async function api(url, opt={}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...opt
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
    return data;
  }
  window.api = api;

  // ===== UI: Toast + Banner (auto mount, super-kelihatan) =====
  function ensureNotifUI() {
    // style
    if (!document.getElementById("__notif_css")) {
      const css = `
      .toast-wrap{position:fixed;top:20px;right:20px;display:flex;flex-direction:column;gap:8px;z-index:99999}
      .toast{padding:10px 14px;border-radius:8px;min-width:220px;color:#fff;font-size:14px;
             box-shadow:0 4px 10px rgba(0,0,0,.3);animation:fadeIn .25s ease}
      .toast.ok{background:#166534}.toast.warn{background:#92400e}.toast.err{background:#991b1b}
      @keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
      .alert-banner{position:sticky;top:0;z-index:99998;margin:0 0 12px 0;padding:12px 16px;border-radius:10px;
        border:1px solid #334;background:#2a1f0a;color:#fff;display:none;font-weight:600}
      .alert-banner.show{display:block}
      .alert-banner.ok{background:#0f2a1c;border-color:#1d6d45}
      .alert-banner.warn{background:#3a2a0f;border-color:#6c5321}
      .alert-banner.err{background:#3a1f24;border-color:#6e3039}
      `;
      const s=document.createElement("style");
      s.id="__notif_css"; s.textContent=css; document.head.appendChild(s);
    }
    // containers
    if (!document.getElementById("__toast_wrap")) {
      const wrap=document.createElement("div");
      wrap.id="__toast_wrap"; wrap.className="toast-wrap";
      document.body.appendChild(wrap);
    }
    if (!document.getElementById("globalBanner")) {
      const banner=document.createElement("div");
      banner.id="globalBanner"; banner.className="alert-banner";
      document.body.prepend(banner);
    }
  }
  function domReady(cb){
    if (document.readyState === "complete" || document.readyState === "interactive") cb();
    else document.addEventListener("DOMContentLoaded", cb, { once:true });
  }
  domReady(ensureNotifUI);

  function _toast(msg,type="warn"){
    ensureNotifUI();
    const wrap = document.getElementById("__toast_wrap");
    const t=document.createElement("div");
    t.className="toast "+type; t.textContent=msg;
    wrap.appendChild(t);
    setTimeout(()=>{t.style.opacity="0";setTimeout(()=>t.remove(),300)},4000);
  }
  function _banner(msg,type="warn"){
    ensureNotifUI();
    const banner=document.getElementById("globalBanner");
    banner.className="alert-banner show "+type;
    banner.textContent=msg;
    clearTimeout(window.__bnrTimer);
    window.__bnrTimer=setTimeout(()=>{banner.classList.remove("show")},6500);
  }
  // expose
  window.notify = (msg,type)=>{ _toast(msg,type); };
  window.notifyBanner = (msg,type)=>{ _banner(msg,type); };

  // ===== Auth badge & guard =====
  async function ensureLoginAndFillBadge() {
    try {
      const { user } = await api("/api/me", { method: "GET" });
      if (!user) { location.href = "/index.html"; return null; }
      const who = $("#whoami");
      const sal = $("#saldo");
      if (who) who.textContent = `Login: ${user.username} (${user.role})`;
      if (sal) sal.textContent  = `Saldo: Rp ${Number(user.balance||0).toLocaleString("id-ID")}`;
      // menu admin hanya admin
      const adminBtn = $("#navAdmin");
      const manageBtn = $("#navManage");
      if (adminBtn) adminBtn.style.display = (user.role === "admin") ? "" : "none";
      if (manageBtn) manageBtn.style.display = (user.role === "admin") ? "" : "none";
      return user;
    } catch {
      location.href = "/index.html";
      return null;
    }
  }
  window.ensureLoginAndFillBadge = ensureLoginAndFillBadge;

  // ===== Output helpers =====
  function appendOut(outEl, txt) {
    if (!outEl) return;
    outEl.textContent += (outEl.textContent && !outEl.textContent.endsWith("\n") ? "\n" : "") + txt;
    outEl.scrollTop = outEl.scrollHeight;
  }
  window.appendOut = appendOut;

  function clearOut(outEl) { if (outEl) outEl.textContent = ""; }
  window.clearOut = clearOut;

  // ===== Deteksi & paksa-notif pada baris SSE =====
  function sniffAndNotify(line) {
    if (typeof line !== "string") return;
    const s = line.toLowerCase();
    // saldo
    if (s.includes("saldo tidak cukup")) {
      notify("Saldo tidak cukup — hubungi admin untuk top-up.", "warn");
      notifyBanner("Saldo tidak cukup. Silakan top-up via Telegram admin.", "warn");
      alert("Saldo tidak cukup. Silakan top-up via admin.");
    }
    // trial limit
    if (s.includes("trial hari ini sudah digunakan") || s.includes("limit 1×/hari") || s.includes("jatah harian")) {
      notify("Trial hari ini sudah digunakan. Coba lagi besok.", "warn");
      notifyBanner("Trial hari ini sudah digunakan (limit 1×/hari).", "warn");
      alert("Trial hari ini sudah digunakan. Coba lagi besok.");
    }
    // error umum
    if (s.startsWith("error:")) {
      notify(line, "err");
      notifyBanner(line, "err");
    }
  }

  // ===== SSE streamer =====
  async function streamJob({ startPath, body, outEl, onDone }) {
    clearOut(outEl);
    appendOut(outEl, `$ ${startPath.replace(/^\/api\/sse\//,'').replace(/\//g,' ')} ...`);
    let jobId = null;

    // Start job
    try {
      const start = await api(startPath, { method: "POST", body: JSON.stringify(body||{}) });
      jobId = start.jobId;
    } catch (e) {
      const msg = e?.message || "Request gagal";
      appendOut(outEl, "ERROR: " + msg);
      notify(msg, "err");
      notifyBanner(msg, "err");
      alert(msg);
      return;
    }

    // Buka SSE
    const es = new EventSource(`/api/stream/job/${encodeURIComponent(jobId)}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "line" || msg.type === "plain") {
          appendOut(outEl, msg.data || "");
          sniffAndNotify(msg.data);
        } else if (msg.type === "balance") {
          if ($("#saldo")) $("#saldo").textContent =
            `Saldo: Rp ${Number(msg.amount||0).toLocaleString("id-ID")}`;
        } else if (msg.type === "done") {
          if (onDone) onDone(msg);
          notify("Proses selesai ✅", "ok");
          es.close();
        }
      } catch {
        // fallback text
        appendOut(outEl, ev.data);
        sniffAndNotify(ev.data);
      }
    };
    es.onerror = () => { es.close(); };
  }
  window.streamJob = streamJob;

  // ===== Manage list =====
  async function loadAccounts(kind, tableBodyEl, refEl) {
    const map = { ssh: "ssh", vmess: "vmess", vless: "vless", trojan: "trojan", ss: "ss" };
    const data = await api("/api/accounts", { method: "GET" });
    const rows = data[map[kind]] || [];
    const tb = tableBodyEl;
    tb.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="muted" colspan="3">Tidak ada data</td>`;
      tb.appendChild(tr);
    } else {
      rows.forEach(r => {
        const name = r.username || r.user || "";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${esc(name)}</td><td>${esc(r.exp||"-")}</td>
          <td><button class="btn err" data-del="${name.replace(/"/g,'&quot;')}">Hapus</button></td>`;
        tb.appendChild(tr);
      });
    }
    if (refEl) refEl.textContent = "Refreshed " + new Date().toLocaleTimeString();
  }
  window.loadAccounts = loadAccounts;

  async function deleteAccount(kind, name) {
    return api(`/api/accounts/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
  window.deleteAccount = deleteAccount;

  // ===== Navbar logout =====
  const logoutBtn = $("#navLogout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      location.href = "/index.html";
    });
  }
})();


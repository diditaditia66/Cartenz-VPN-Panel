(()=>{

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  // output areas (home/add/trial)
  const out = $("#out"), outA = $("#outA"), outT = $("#outT");
  function log(outEl, s){ if(!outEl) return; outEl.textContent += (outEl.textContent && !outEl.textContent.endsWith("\n") ? "\n":"") + s; outEl.scrollTop = outEl.scrollHeight; }
  function clearOut(outEl){ if(outEl) outEl.textContent=""; }
  function copyOut(outEl){ if(outEl) navigator.clipboard.writeText(outEl.textContent||""); }

  // screens
  const screens = {
    login: $("#scr-login"), home: $("#scr-home"),
    add: $("#scr-add"), trial: $("#scr-trial"),
    manage: $("#scr-manage"), admin: $("#scr-admin")
  };
  function show(name){
    Object.values(screens).forEach(sc=>sc?.classList.remove("active"));
    screens[name]?.classList.add("active");
    window.scrollTo({top:0,behavior:"instant"});
  }

  // API helper
  async function api(url,opt={}){
    const res = await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opt});
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data.error||res.statusText||"Request failed");
    return data;
  }
  const esc = s => (s||"").replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const escAttr = s => (s||"").replace(/"/g,'&quot;');

  // state
  let CURRENT_USER = null;
  function setWhoAndUI(user){
    CURRENT_USER = user;
    $("#whoami").textContent = `Login: ${user.username} (${user.role})`;
    updateSaldoBadge(user.balance||0);
    const isAdmin = (user.role === "admin");
    $("#btnGoAdmin").style.display = isAdmin ? "" : "none";
    $("#btnGoManage").style.display = isAdmin ? "" : "none";
    const manageTile = $("#go-manage");
    if (manageTile) manageTile.style.display = isAdmin ? "" : "none";
  }
  function updateSaldoBadge(amount){
    const el = $("#saldo");
    if (!el) return;
    const n = Number(amount||0);
    el.textContent = `Saldo: Rp ${n.toLocaleString("id-ID")}`;
  }

  // ===== auth flow =====
  async function boot(){
    try{
      const m = await api("/api/me",{method:"GET"});
      if(m.user){ setWhoAndUI(m.user); show("home"); }
      else show("login");
    }catch{ show("login"); }
  }
  $("#btnLogin").onclick = async ()=>{
    $("#loginMsg").textContent="";
    try{
      const username = $("#lg-user").value.trim();
      const password = $("#lg-pass").value;
      const r = await api("/api/login",{method:"POST",body:JSON.stringify({username,password})});
      setWhoAndUI(r.user); show("home");
    }catch(e){ $("#loginMsg").textContent = "❌ " + e.message; }
  };
  $("#btnLogout").onclick = async ()=>{
    try{ await api("/api/logout",{method:"POST"}); show("login"); }
    catch(e){ alert(e.message); }
  };

  // ===== nav =====
  $("#go-add").onclick = ()=> show("add");
  $("#go-trial").onclick = ()=> show("trial");
  $("#go-manage").onclick = ()=> { show("manage"); refreshManage(); };
  $("#btnGoAdd").onclick = ()=> show("add");
  $("#btnGoTrial").onclick = ()=> show("trial");
  $("#btnGoManage").onclick = ()=> { show("manage"); refreshManage(); };
  $("#btnGoAdmin").onclick = ()=> { show("admin"); refreshUsers(); };

  $("#backHomeA").onclick = ()=> show("home");
  $("#backHomeT").onclick = ()=> show("home");
  $("#backHomeM").onclick = ()=> show("home");
  $("#backHomeAdmin").onclick = ()=> show("home");
  $("#btnToTrialFromAdd").onclick = ()=> show("trial");
  $("#btnToManageFromAdd").onclick = ()=> { show("manage"); refreshManage(); };
  $("#btnToAddFromTrial").onclick = ()=> show("add");
  $("#btnToManageFromTrial").onclick = ()=> { show("manage"); refreshManage(); };
  $("#btnToAddFromManage").onclick = ()=> show("add");
  $("#btnToTrialFromManage").onclick = ()=> show("trial");

  // terminal toolbar
  $("#btnCopy")?.addEventListener("click", ()=> copyOut(out));
  $("#btnClear")?.addEventListener("click", ()=> clearOut(out));
  $("#btnCopyA")?.addEventListener("click", ()=> copyOut(outA));
  $("#btnClearA")?.addEventListener("click", ()=> clearOut(outA));
  $("#btnCopyT")?.addEventListener("click", ()=> copyOut(outT));
  $("#btnClearT")?.addEventListener("click", ()=> clearOut(outT));

  // ====== SSE helper ======
  async function streamJob({startUrl, startBody, outEl, onDone}){
    // 1) minta job id
    const { id } = await api(startUrl, { method:"POST", body: JSON.stringify(startBody||{}) });
    // 2) buka SSE
    const es = new EventSource(`/api/stream/join/${id}`);
    return await new Promise((resolve)=>{
      const close = (ok)=>{ try{ es.close(); }catch(_){}; resolve(ok); if(onDone) onDone(ok); };
      es.onmessage = (ev)=> { log(outEl, ev.data); };
      es.addEventListener("payload", (ev)=>{
        try{
          const data = JSON.parse(ev.data||"{}");
          if (typeof data.balance !== "undefined") updateSaldoBadge(data.balance);
          if (typeof data.generatedPassword !== "undefined") {
            log(outEl, `Password (auto): ${data.generatedPassword}`);
          }
        }catch(_){}
      });
      es.addEventListener("end", (ev)=>{
        try{
          const {ok} = JSON.parse(ev.data||"{}");
          close(!!ok);
        }catch{ close(false); }
      });
      es.onerror = ()=> { close(false); };
    });
  }

  // ===== ADD screen =====
  let addKind = "ssh";
  function setAddKind(k){
    addKind = k;
    $$("#addTabs .tab").forEach(t=>t.classList.toggle("active", t.dataset.kind===k));
    if(k==="ssh"){ $("#add-ssh").classList.remove("hidden"); $("#add-generic").classList.add("hidden"); }
    else { $("#add-ssh").classList.add("hidden"); $("#add-generic").classList.remove("hidden"); $("#genTitle").textContent = "Add " + k.toUpperCase(); }
    validateAdd();
  }
  $$("#addTabs .tab").forEach(t=> t.onclick=()=> setAddKind(t.dataset.kind));
  function validateAdd(){
    const sshOk = $("#ssh_user").value.trim().length>0;
    $("#btnAddSSH").disabled = !sshOk;
    const genOk = $("#gen_remarks").value.trim().length>0;
    $("#btnAddGeneric").disabled = !genOk;
  }
  $("#ssh_user").oninput = validateAdd;
  $("#gen_remarks").oninput = validateAdd;

  $("#btnAddSSH").onclick = async ()=>{
    const username = $("#ssh_user").value.trim();
    const password = $("#ssh_pass").value; // boleh kosong (auto)
    const days = parseInt($("#ssh_days").value||"30",10);
    clearOut(outA);
    log(outA, `$ add ssh ${username} ${days}d ...`);
    try{
      await streamJob({
        startUrl: "/api/stream/add/start",
        startBody: { kind:"ssh", username, password, days },
        outEl: outA,
        onDone: ()=> refreshManageIfVisible(),
      });
    }catch(e){ log(outA, "ERROR: "+e.message); }
  };

  $("#btnAddGeneric").onclick = async ()=>{
    const remarks = $("#gen_remarks").value.trim();
    const days = parseInt($("#gen_days").value||"30",10);
    clearOut(outA);
    log(outA, `$ add ${addKind} ${remarks} ${days}d ...`);
    try{
      await streamJob({
        startUrl: "/api/stream/add/start",
        startBody: { kind:addKind, remarks, days },
        outEl: outA,
        onDone: ()=> refreshManageIfVisible(),
      });
    }catch(e){ log(outA, "ERROR: "+e.message); }
  };

  // ===== TRIAL screen =====
  let trialKind = "ssh";
  function setTrialKind(k){
    trialKind = k;
    $$("#trialTabs .tab").forEach(t=>t.classList.toggle("active", t.dataset.kind===k));
  }
  $$("#trialTabs .tab").forEach(t=> t.onclick=()=> setTrialKind(t.dataset.kind));
  $("#btnDoTrial").onclick = async ()=>{
    clearOut(outT);
    log(outT, `$ trial ${trialKind} ...`);
    try{
      await streamJob({
        startUrl: "/api/stream/trial/start",
        startBody: { kind: trialKind },
        outEl: outT,
        onDone: ()=> refreshManageIfVisible(),
      });
    }catch(e){ log(outT, "ERROR: "+e.message); }
  };

  // ===== MANAGE screen =====
  let manKind = "ssh";
  function setManKind(k){
    manKind = k;
    $$("#manTabs .tab").forEach(t=>t.classList.toggle("active", t.dataset.kind===k));
    refreshManage();
  }
  $$("#manTabs .tab").forEach(t=> t.onclick=()=> setManKind(t.dataset.kind));

  async function refreshManage(){
    try{
      const data = await api("/api/accounts",{method:"GET"});
      const map = {ssh:"ssh",vmess:"vmess",vless:"vless",trojan:"trojan",ss:"ss"};
      const rows = data[map[manKind]] || [];
      const tb = $("#tbl tbody"); tb.innerHTML="";
      if(!rows.length){
        const tr=document.createElement("tr"); tr.innerHTML=`<td class="muted" colspan="3">Tidak ada data</td>`;
        tb.appendChild(tr);
      }else{
        rows.forEach(r=>{
          const name = r.username || r.user || "";
          const tr=document.createElement("tr");
          tr.innerHTML = `<td>${esc(name)}</td><td>${esc(r.exp||"-")}</td>
            <td><button class="btn err" data-del="${escAttr(name)}">Hapus</button></td>`;
          tb.appendChild(tr);
        });
      }
      $("#refTime").textContent = "Refreshed " + new Date().toLocaleTimeString();
      tb.querySelectorAll("[data-del]").forEach(b=>{
        b.onclick = async ()=>{
          const name = b.dataset.del;
          if(!confirm(`Hapus ${manKind} ${name}?`)) return;
          try{
            const res = await api(`/api/accounts/${encodeURIComponent(manKind)}/${encodeURIComponent(name)}`,{method:"DELETE"});
            alert("OK: " + (res.output||"deleted"));
            refreshManage();
          }catch(e){ alert(e.message); }
        };
      });
    }catch(e){
      alert("Gagal load accounts: " + e.message);
    }
  }
  function refreshManageIfVisible(){ if(screens.manage.classList.contains("active")) refreshManage(); }

  // ===== ADMIN (tetap seperti sebelumnya, panggil /api/admin/* kalau kamu sudah punya) =====
  async function refreshUsers(){
    try{
      const r = await api("/api/admin/users",{method:"GET"});
      const tb = $("#adm_tbl_users tbody"); tb.innerHTML = "";
      (r.users||[]).forEach(u=>{
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${Number(u.balance||0).toLocaleString("id-ID")}</td><td>${esc(u.lastTrialDate||"-")}</td>`;
        tb.appendChild(tr);
      });
    }catch(e){
      const tb = $("#adm_tbl_users tbody");
      if (tb) tb.innerHTML = `<tr><td colspan="4" class="muted">Gagal memuat daftar user: ${esc(e.message)}</td></tr>`;
    }
  }

  // ===== GANTI PASSWORD (modal sederhana di index.html) =====
  const modalPwd = $("#modalPwd");
  const btnChangePwd = $("#btnChangePwd");
  const btnPwdClose = $("#pwdClose");
  const btnPwdCancel = $("#pwdCancel");
  const btnPwdSave = $("#pwdSave");
  const oldPwd = $("#oldPwd");
  const newPwd = $("#newPwd");
  const newPwd2 = $("#newPwd2");
  const pwdMsg = $("#pwdMsg");
  function openPwd(){ modalPwd?.classList.add("open"); oldPwd?.focus(); if(pwdMsg) pwdMsg.textContent=""; }
  function closePwd(){ modalPwd?.classList.remove("open"); if(oldPwd) oldPwd.value=""; if(newPwd) newPwd.value=""; if(newPwd2) newPwd2.value=""; if(pwdMsg) pwdMsg.textContent=""; }
  btnChangePwd?.addEventListener("click", openPwd);
  btnPwdClose?.addEventListener("click", closePwd);
  btnPwdCancel?.addEventListener("click", closePwd);
  btnPwdSave?.addEventListener("click", async ()=>{
    if(!oldPwd || !newPwd || !newPwd2) return;
    pwdMsg.textContent = "";
    const o = oldPwd.value, n1 = newPwd.value, n2 = newPwd2.value;
    if(!o) return pwdMsg.textContent = "❌ Password lama wajib diisi";
    if(n1.length < 6) return pwdMsg.textContent = "❌ Password baru minimal 6 karakter";
    if(n1 !== n2) return pwdMsg.textContent = "❌ Ulangi password baru tidak sama";
    try{
      await api("/api/change-password",{method:"POST",body:JSON.stringify({oldPassword:o,newPassword:n1})});
      pwdMsg.textContent = "✅ Password berhasil diganti";
      setTimeout(closePwd, 800);
    }catch(e){ pwdMsg.textContent = "❌ " + e.message; }
  });

  // bootstrap
  boot();
})();

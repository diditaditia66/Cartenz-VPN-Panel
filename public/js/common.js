const $ = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

async function api(url,opt={}){
  const res = await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json"},...opt});
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error||res.statusText||"Request failed"); return data;
}
function rupiah(n){ return "Rp " + Number(n||0).toLocaleString("id-ID"); }
function setWho(u){
  const who=$("#whoami"); if(who) who.textContent=`Login: ${u.username} (${u.role})`;
  const saldo=$("#saldo"); if(saldo) saldo.textContent=`Saldo: ${rupiah(u.balance||0)}`;
  const isAdmin = u.role==="admin";
  const btnAdmin=$("#btnGoAdmin"); if(btnAdmin) btnAdmin.style.display=isAdmin?"":"none";
  const btnManage=$("#btnGoManage"); if(btnManage) btnManage.style.display=isAdmin?"":"none";
  const tileManage=$("#tileManage"); if(tileManage) tileManage.style.display=isAdmin?"":"none";
}
async function requireAuth(){
  const m = await api("/api/me",{method:"GET"});
  if(!m.user) { location.href="/"; return null; }
  setWho(m.user); return m.user;
}
async function login(elUser, elPass, msgEl){
  try{
    const r=await api("/api/login",{method:"POST",body:JSON.stringify({username:elUser.value.trim(),password:elPass.value})});
    setWho(r.user); location.href="/";
  }catch(e){ if(msgEl) msgEl.textContent="❌ "+e.message; }
}
async function doLogout(){ try{ await api("/api/logout",{method:"POST"}); }catch{} location.href="/"; }

/* modal ganti password (opsional hadir di tiap page) */
(function(){
  const modal=$("#modalPwd"); if(!modal) return;
  const btnOpen=$("#btnChangePwd"), btnClose=$("#pwdClose"), btnCancel=$("#pwdCancel"), btnSave=$("#pwdSave");
  const oldPwd=$("#oldPwd"), newPwd=$("#newPwd"), newPwd2=$("#newPwd2"), msg=$("#pwdMsg");
  const open=()=>{ modal.classList.add("open"); msg.textContent=""; oldPwd.value=""; newPwd.value=""; newPwd2.value=""; oldPwd.focus(); };
  const close=()=>{ modal.classList.remove("open"); };
  if(btnOpen) btnOpen.onclick=open;
  if(btnClose) btnClose.onclick=close;
  if(btnCancel) btnCancel.onclick=close;
  if(btnSave) btnSave.onclick=async ()=>{
    msg.textContent=""; const o=oldPwd.value, n1=newPwd.value, n2=newPwd2.value;
    if(!o) return msg.textContent="❌ Password lama wajib diisi";
    if(n1.length<6) return msg.textContent="❌ Password baru minimal 6 karakter";
    if(n1!==n2) return msg.textContent="❌ Ulangi password baru tidak sama";
    try{ await api("/api/change-password",{method:"POST",body:JSON.stringify({oldPassword:o,newPassword:n1})});
      msg.textContent="✅ Password berhasil diganti"; setTimeout(close,800);
    }catch(e){ msg.textContent="❌ "+e.message; }
  };
})();
window.Cartenz={api,requireAuth,login,doLogout,rupiah,setWho};

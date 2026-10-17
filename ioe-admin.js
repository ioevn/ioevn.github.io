import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,collection,getDocs,getDoc,doc,updateDoc,Timestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id),app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);let records=[];
$('login').onclick=()=>signInWithPopup(auth,new GoogleAuthProvider()).catch(e=>alert(e.message));$('logout').onclick=()=>signOut(auth);
const date=t=>t?.toDate?.()?.toLocaleString('vi-VN')||'—';const valid=r=>r.premiumUntil?.toMillis?.()>Date.now();
function backup(){const lines=['IOE - SAO LUU TAI KHOAN','Thoi diem: '+new Date().toLocaleString('vi-VN'),'Tong ho so: '+records.length,'',...records.map(r=>['UID: '+r.id,'Email: '+(r.email||''),'Ten: '+(r.name||''),'Premium den: '+date(r.premiumUntil),'Ngay tao: '+date(r.createdAt),'---'].join('\n'))];const blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='IOE_Backup_'+new Date().toISOString().slice(0,10)+'.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
$('backup').onclick=backup;
function render(){const q=$('search').value.toLowerCase();$('rows').replaceChildren();for(const r of records.filter(r=>(r.email||'').toLowerCase().includes(q)||r.id.toLowerCase().includes(q))){const tr=document.createElement('tr');for(const value of [r.email||'',r.id.slice(0,6),valid(r)?'Premium':'Dùng thử / hết hạn',date(r.premiumUntil)]){const td=document.createElement('td');td.textContent=value;tr.append(td)}const td=document.createElement('td'),btn=document.createElement('button');btn.textContent='Gia hạn 30 ngày';btn.onclick=async()=>{if(!confirm('Đã kiểm tra tiền chuyển khoản? Gia hạn Premium 30 ngày cho '+r.email+'?'))return;try{const until=Math.max(Date.now(),r.premiumUntil?.toMillis?.()||0)+30*86400000;await updateDoc(doc(db,'ioe_users',r.id),{premiumUntil:Timestamp.fromMillis(until)});await load(false)}catch(e){alert(e.message)}};td.append(btn);tr.append(td);$('rows').append(tr)}$('summary').textContent=`Tổng: ${records.length} • Premium: ${records.filter(valid).length} • Chưa Premium: ${records.filter(r=>!valid(r)).length}`}
$('search').oninput=render;$('reload').onclick=()=>load(false);
async function load(auto){try{const snap=await getDocs(collection(db,'ioe_users'));records=snap.docs.map(d=>({id:d.id,...d.data()}));render();if(auto)backup()}catch(e){$('who').textContent='Lỗi tải dữ liệu: '+e.message}}
let authCheck=0;
onAuthStateChanged(auth, async u=>{
  const check=++authCheck;
  $('panel').hidden=true;
  $('login').hidden=!!u;
  $('logout').hidden=!u;
  records=[];
  if(!u){$('who').textContent='Chưa đăng nhập';return;}
  $('who').textContent='Đang kiểm tra quyền Admin…';
  try {
    const snap=await getDoc(doc(db,'admins',u.uid));
    if(check!==authCheck)return;
    const allowed=snap.exists() && snap.data().isAdmin===true;
    $('panel').hidden=!allowed;
    $('who').textContent=allowed?'Admin: '+(u.email||u.uid):'Tài khoản này không có quyền Admin';
    if(allowed)await load(true);
  } catch(e) {
    if(check!==authCheck)return;
    $('who').textContent='Không thể kiểm tra quyền Admin: '+e.message;
  }
});

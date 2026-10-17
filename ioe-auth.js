import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,serverTimestamp,runTransaction,deleteDoc} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id);
const configured=Boolean(firebaseConfig?.apiKey && firebaseConfig.apiKey!=='REPLACE_ME' && firebaseConfig?.projectId && firebaseConfig?.authDomain);
let auth,db,me=null,profile=null;
window.ioeAllowed=false;
// Online = tab trang thi dang mo va hien thi; sau 90 giay khong heartbeat se tinh offline.
let presenceTimer=null, presenceUid=null, presenceBusy=false;
async function pulsePresence(){
 if(!db||!me||document.visibilityState!=='visible'||presenceBusy)return;
 presenceBusy=true;
 const uid=me.uid;
 try{
  await setDoc(doc(db,'ioe_presence',uid),{
   uid, name:me.displayName||me.email||'Học viên',
   email:me.email||'', lastSeen:serverTimestamp()
  });
 }catch(e){console.warn('Không thể cập nhật trạng thái online:',e)}
 finally{presenceBusy=false;}
}
function stopPresence(){
 if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
 const uid=presenceUid;presenceUid=null;
 if(uid&&db)deleteDoc(doc(db,'ioe_presence',uid)).catch(()=>{});
}
function startPresence(uid){
 if(presenceUid!==uid)stopPresence();
 presenceUid=uid;
 pulsePresence();
 if(!presenceTimer)presenceTimer=setInterval(pulsePresence,30000);
}
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible')pulsePresence();
});

function status(message){$('ioeGateStatus').textContent=message||'';}
function show(message){$('ioeGate').classList.remove('ioe-hide');$('ioeGateText').textContent=message;}
const MAX_ATTEMPTS=5;
let usedAttempts=0;
let premiumActive=false;
function premiumEndMs(){const v=profile?.premiumUntil;return v?.toMillis?.() || (typeof v==='string'?Date.parse(v):0) || 0;}
function showPayment(){
 $('ioePayment').classList.remove('ioe-hide');
 $('ioePayEmail').textContent=me?.email||'';
 // Dung chinh xac 6 ky tu dau cua Firebase Auth UID.
 const memo=(me?.uid||'').slice(0,6);
 $('ioePayMemo').textContent=memo;
 $('ioePayQr').src='https://img.vietqr.io/image/970405-4603205297466-compact2.png?amount=50000&addInfo='+encodeURIComponent(memo)+'&accountName='+encodeURIComponent('VU THANH TUYEN');
 $('ioeGateTitle').textContent='Thanh toán Premium';
 $('ioeClosePayment').classList.remove('ioe-hide');
 $('ioeGate').classList.remove('ioe-hide');
}
function hidePayment(){$('ioePayment').classList.add('ioe-hide');$('ioeClosePayment').classList.add('ioe-hide');$('ioeGateTitle').textContent='Đăng nhập IOE lớp 6';}
window.ioeClosePayment=()=>{if(!me)return;hidePayment();$('ioeGate').classList.add('ioe-hide');if(window.ioeExamActive!==true && typeof window.ioeReturnToStart==='function')window.ioeReturnToStart();};
window.ioeCopyBank=()=>navigator.clipboard.writeText('4603205297466').then(()=>{$('ioePayNotice').textContent='Đã sao chép số tài khoản.';}).catch(()=>{$('ioePayNotice').textContent='Số tài khoản: 4603205297466';});
window.ioeCopyMemo=()=>navigator.clipboard.writeText($('ioePayMemo').textContent).then(()=>{$('ioePayNotice').textContent='Đã sao chép nội dung chuyển khoản.';}).catch(()=>{$('ioePayNotice').textContent='Hãy sao chép nội dung chuyển khoản hiển thị phía trên.';});
window.ioeCheckPayment=async()=>{if(!me||!db)return;status('Đang kiểm tra trạng thái Premium…');try{const snap=await getDoc(doc(db,'ioe_users',me.uid));if(snap.exists())profile=snap.data();refresh();if(!premiumActive)status('Chưa có Premium đang hoạt động. Vui lòng đợi quản trị viên xác nhận.');}catch(e){status('Không kiểm tra được Premium: '+e.message);}};
function refresh(){
 premiumActive=premiumEndMs()>Date.now();
 window.ioeAllowed=!!me && (premiumActive||usedAttempts<MAX_ATTEMPTS);
 const remain=Math.max(0,MAX_ATTEMPTS-usedAttempts);
 $('ioeIdentity').textContent=`${me.displayName||me.email||'Học viên'} • ${premiumActive?'Premium đến '+new Date(premiumEndMs()).toLocaleDateString('vi-VN'):'Còn '+remain+'/5 lượt miễn phí'}`;
 $('ioePremium').style.display=premiumActive?'none':'';
 $('ioeLogin').style.display='none';
 if(window.ioeAllowed){hidePayment();$('ioeGate').classList.add('ioe-hide');status('');}
 else{show('Tài khoản đã sử dụng hết 5 lượt thi miễn phí. Vui lòng gia hạn Premium để tiếp tục.');showPayment();status('');}
}
window.ioeClaimAttempt=async()=>{
 if(!me||!db)throw new Error('Bạn cần đăng nhập Google trước khi thi.');
 if(premiumEndMs()>Date.now()){premiumActive=true;return 'Premium';}
 const uid=me.uid;
 const ref=doc(db,'ioe_attempts',uid);
 const newCount=await runTransaction(db,async transaction=>{
  const snap=await transaction.get(ref);
  const count=snap.exists()?snap.data().count:0;
  if(!Number.isInteger(count)||count<0||count>=MAX_ATTEMPTS)throw new Error('Bạn đã sử dụng hết 5 lượt thi thử.');
  if(snap.exists())transaction.update(ref,{count:count+1});
  else transaction.set(ref,{count:1,uid:uid});
  return count+1;
 });
 usedAttempts=newCount;refresh();
 return MAX_ATTEMPTS-newCount;
};
window.ioeLogin=async()=>{
 if(!configured)return;
 $('ioeLogin').disabled=true;
 status('Đang mở cửa sổ đăng nhập Google…');
 try{await signInWithPopup(auth,new GoogleAuthProvider());status('Google đã xác thực. Đang kiểm tra hồ sơ Firestore…');}
 catch(e){if(e.code==='auth/popup-closed-by-user')status('Bạn đã đóng cửa sổ đăng nhập. Hãy thử lại.');else status(`Đăng nhập thất bại (${e.code||'unknown'}): ${e.message}`);}
 finally{$('ioeLogin').disabled=false;}
};
window.ioeLogout=async()=>{stopPresence();if(auth)await signOut(auth);};
window.ioeShowPayment=()=>{if(!me){show('Vui lòng đăng nhập Google để xem thông tin thanh toán.');return;}showPayment();show('Gia hạn Premium để tiếp tục luyện thi.');};
window.ioeSaveResult=async r=>{if(!db||!me||!window.ioeExamActive)return;try{await addDoc(collection(db,'ioe_results'),{...r,uid:me.uid,createdAt:serverTimestamp()});}catch(e){console.warn('Không thể lưu kết quả:',e);}};
if(!configured){show('Thiếu thông tin cấu hình Firebase trong firebase-config.js.');status('Hãy kiểm tra apiKey, authDomain và projectId.');$('ioeLogin').disabled=true;}
else{
 try{
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
   if(!user || (presenceUid && presenceUid!==user.uid))stopPresence();
   me=user;profile=null;window.ioeAllowed=false;
   if(user)startPresence(user.uid);
   if(!user){hidePayment();$('ioeIdentity').textContent='Chưa đăng nhập';$('ioeLogin').style.display='';$('ioeLogin').disabled=false;show('Đăng nhập Google để thi thử tối đa 5 lượt.');status('');return;}
   $('ioeIdentity').textContent=user.displayName||user.email||'Đã đăng nhập Google';
   show('Đã đăng nhập Google. Đang kiểm tra số lượt thi…');
   status('Đang kết nối Cloud Firestore…');
   try{
    const ref=doc(db,'ioe_users',user.uid);
    let snap=await getDoc(ref);
    if(!snap.exists()){
     await setDoc(ref,{email:user.email||'',name:user.displayName||'',createdAt:serverTimestamp(),premiumUntil:null});
     snap=await getDoc(ref);
    }
    profile=snap.data();
    const attemptsSnap=await getDoc(doc(db,'ioe_attempts',user.uid));
    usedAttempts=attemptsSnap.exists()?attemptsSnap.data().count:0;
    refresh();
   }catch(e){
    console.error('Firestore profile error:',e);
    window.ioeAllowed=false;
    $('ioeLogin').style.display='none';
    show('Google đã đăng nhập thành công nhưng chưa xác minh được quyền truy cập Firestore.');
    status(`Lỗi Firestore (${e.code||'unknown'}): ${e.message}. Kiểm tra Firestore Database và Security Rules cho ioe_users/{uid}.`);
   }
  },e=>{show('Không thể khôi phục phiên đăng nhập Firebase.');status(`${e.code||'auth'}: ${e.message}`);});
 }catch(e){show('Không khởi tạo được Firebase.');status(e.message);}
}

import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,serverTimestamp,runTransaction,deleteDoc,Timestamp,onSnapshot} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id);
const configured=Boolean(firebaseConfig?.apiKey && firebaseConfig.apiKey!=='REPLACE_ME' && firebaseConfig?.projectId && firebaseConfig?.authDomain);
let auth,db,me=null,profile=null;
window.ioeAllowed=false;
// Một phiên hoạt động cho mỗi UID, thuê khóa 90 giây, gia hạn mỗi 20 giây.
const SESSION_MS=90000;
const sessionId=crypto.randomUUID();
let sessionTimer=null,sessionOwned=false,sessionBusy=false,sessionUnsubscribe=null,displaced=false;
function sessionRef(uid){return doc(db,'ioe_sessions',uid);}
async function acquireSession(uid){
 const ref=sessionRef(uid);
 await runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  const now=Date.now();
  // Đăng nhập mới luôn chiếm phiên; transaction đảm bảo không ghi đè nửa chừng.
  tx.set(ref,{uid,sessionId,expiresAt:Timestamp.fromMillis(now+SESSION_MS),lastSeen:serverTimestamp()});
 });
 sessionOwned=true;
 watchSession(uid);
}
function watchSession(uid){
 if(sessionUnsubscribe){sessionUnsubscribe();sessionUnsubscribe=null;}
 sessionUnsubscribe=onSnapshot(sessionRef(uid),snap=>{
  if(!sessionOwned||!me||me.uid!==uid)return;
  if(!snap.exists()||snap.data().sessionId!==sessionId)void kickPreviousSession();
 },e=>console.warn('Không thể theo dõi phiên:',e));
}
async function kickPreviousSession(){
 if(displaced)return;
 displaced=true;
 sessionOwned=false;window.ioeAllowed=false;
 if(sessionTimer){clearInterval(sessionTimer);sessionTimer=null;}
 if(sessionUnsubscribe){sessionUnsubscribe();sessionUnsubscribe=null;}
 stopPresence();
 if(typeof window.ioeForceReturnToStart==='function')window.ioeForceReturnToStart();
 else if(typeof window.ioeReturnToStart==='function')window.ioeReturnToStart();
 try{if(auth)await signOut(auth);}catch(e){console.warn(e);}
 hidePayment();show('Tài khoản của bạn vừa được đăng nhập ở một nơi khác.');
 $('ioeGateTitle').textContent='Phiên đăng nhập đã kết thúc';
 $('ioeLogin').style.display='';status('');
}
async function renewSession(){
 if(!sessionOwned||!me||sessionBusy)return;
 sessionBusy=true;
 try{
  const uid=me.uid;
  await runTransaction(db,async tx=>{
   const ref=sessionRef(uid),snap=await tx.get(ref);
   if(!snap.exists()||snap.data().sessionId!==sessionId)throw new Error('Phiên đăng nhập đã được sử dụng ở nơi khác.');
   tx.update(ref,{expiresAt:Timestamp.fromMillis(Date.now()+SESSION_MS),lastSeen:serverTimestamp()});
  });
 }catch(e){
  await kickPreviousSession();
 }finally{sessionBusy=false;}
}
function startSessionHeartbeat(){if(sessionTimer)clearInterval(sessionTimer);sessionTimer=setInterval(renewSession,20000);}
async function releaseSession(uid){
 if(sessionTimer){clearInterval(sessionTimer);sessionTimer=null;}
 if(sessionUnsubscribe){sessionUnsubscribe();sessionUnsubscribe=null;}
 const wasOwned=sessionOwned;sessionOwned=false;
 if(!wasOwned||!db||!uid)return;
 try{await runTransaction(db,async tx=>{const ref=sessionRef(uid),snap=await tx.get(ref);if(snap.exists()&&snap.data().sessionId===sessionId)tx.update(ref,{expiresAt:Timestamp.fromMillis(Date.now()+5000),lastSeen:serverTimestamp()});});}catch(e){console.warn('Khóa phiên sẽ tự hết hạn:',e);}
}

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
function show(message){$('ioeGate').classList.remove('ioe-hide');$('ioeGateText').style.display='';$('ioeGateText').textContent=message;$('ioeGateUpgrade').classList.add('ioe-hide');}
const MAX_ATTEMPTS=5;
let usedAttempts=0;
let premiumActive=false;
let paymentDismissed=false;
let authCheckVersion=0;
const withTimeout=(promise,ms)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Kết nối Firestore quá thời gian chờ. Vui lòng kiểm tra mạng và tải lại trang.')),ms))]);
function premiumEndMs(){const v=profile?.premiumUntil;return v?.toMillis?.() || (typeof v==='string'?Date.parse(v):0) || 0;}
function showPayment(){
 paymentDismissed=false;
 $('ioeGateUpgrade').classList.add('ioe-hide');
 $('ioeGateText').style.display='none';
 $('ioeLogin').style.display='none';
 status('');
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
function hidePayment(){$('ioePayment').classList.add('ioe-hide');$('ioeGateTitle').textContent='Đăng nhập IOE lớp 6';$('ioeGateText').style.display='';}
window.ioeClosePayment=()=>{paymentDismissed=true;hidePayment();$('ioeGate').classList.add('ioe-hide');if(window.ioeExamActive!==true && typeof window.ioeReturnToStart==='function')window.ioeReturnToStart();};
window.ioeCopyBank=()=>navigator.clipboard.writeText('4603205297466').then(()=>{$('ioePayNotice').textContent='Đã sao chép số tài khoản.';}).catch(()=>{$('ioePayNotice').textContent='Số tài khoản: 4603205297466';});
window.ioeCopyMemo=()=>navigator.clipboard.writeText($('ioePayMemo').textContent).then(()=>{$('ioePayNotice').textContent='Đã sao chép nội dung chuyển khoản.';}).catch(()=>{$('ioePayNotice').textContent='Hãy sao chép nội dung chuyển khoản hiển thị phía trên.';});
window.ioeCheckPayment=async()=>{if(!me||!db)return;status('Đang kiểm tra trạng thái Premium…');try{const snap=await getDoc(doc(db,'ioe_users',me.uid));if(snap.exists())profile=snap.data();refresh();if(!premiumActive)status('Chưa có Premium đang hoạt động. Vui lòng đợi quản trị viên xác nhận.');}catch(e){status('Không kiểm tra được Premium: '+e.message);}};
function refresh(){
 premiumActive=premiumEndMs()>Date.now();
 window.ioeAllowed=!!me && sessionOwned && (premiumActive||usedAttempts<MAX_ATTEMPTS);
 const remain=Math.max(0,MAX_ATTEMPTS-usedAttempts);
 $('ioeIdentity').textContent=`${me.displayName||me.email||'Học viên'} • ${premiumActive?'Premium đến '+new Date(premiumEndMs()).toLocaleDateString('vi-VN'):'Còn '+remain+'/5 lượt miễn phí'}`;
 $('ioePremium').style.display=premiumActive?'none':'';
 $('ioePremiumBadge').classList.toggle('ioe-hide',!premiumActive);
 $('ioeWelcomePremium').classList.toggle('ioe-hide',!me||premiumActive);
 $('ioeGateUpgrade').classList.add('ioe-hide');
 $('ioeLogin').style.display='none';
 if(window.ioeAllowed){hidePayment();$('ioeGate').classList.add('ioe-hide');status('');}
 else if(!paymentDismissed){hidePayment();show('Bạn hãy nâng cấp Premium để tiếp tục thi.');$('ioeGateTitle').textContent='Nâng cấp Premium';$('ioeGateUpgrade').classList.remove('ioe-hide');status('');}
 else{hidePayment();$('ioeGate').classList.add('ioe-hide');}
}
window.ioeClaimAttempt=async()=>{
 if(!me||!db)throw new Error('Bạn cần đăng nhập Google trước khi thi.');
 if(!sessionOwned)throw new Error('Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.');
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
window.ioeLogout=async()=>{displaced=false;stopPresence();await releaseSession(me?.uid);if(auth)await signOut(auth);};
window.ioeShowPayment=()=>{if(!me){show('Vui lòng đăng nhập Google để xem thông tin thanh toán.');return;}showPayment();};
window.ioeSaveResult=async r=>{if(!db||!me||!window.ioeExamActive)return;try{await addDoc(collection(db,'ioe_results'),{...r,uid:me.uid,createdAt:serverTimestamp()});}catch(e){console.warn('Không thể lưu kết quả:',e);}};
if(!configured){show('Thiếu thông tin cấu hình Firebase trong firebase-config.js.');status('Hãy kiểm tra apiKey, authDomain và projectId.');$('ioeLogin').disabled=true;}
else{
 try{
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
   if(!user || (presenceUid && presenceUid!==user.uid)){stopPresence();if(sessionTimer)clearInterval(sessionTimer);sessionTimer=null;sessionOwned=false;}
   const checkVersion=++authCheckVersion;
   if(user)displaced=false;
   me=user;profile=null;window.ioeAllowed=false;paymentDismissed=false;
   $('ioePremiumBadge').classList.add('ioe-hide');
   $('ioeWelcomePremium').classList.add('ioe-hide');$('ioeGateUpgrade').classList.add('ioe-hide');

   if(!user){hidePayment();$('ioeIdentity').textContent='Chưa đăng nhập';$('ioeLogin').style.display='';$('ioeLogin').disabled=false;if(displaced){show('Tài khoản của bạn vừa được đăng nhập ở một nơi khác.');$('ioeGateTitle').textContent='Phiên đăng nhập đã kết thúc';}else{show('Đăng nhập Google để thi thử tối đa 5 lượt.');$('ioeGateTitle').textContent='Đăng nhập IOE lớp 6';}status('');return;}
   $('ioeIdentity').textContent=user.displayName||user.email||'Đã đăng nhập Google';
   show('Đã đăng nhập Google. Đang kiểm tra số lượt thi…');
   status('Đang xác minh phiên đăng nhập và Cloud Firestore…');
   try{
    await withTimeout(acquireSession(user.uid),12000);
    if(checkVersion!==authCheckVersion){await releaseSession(user.uid);return;}
    startSessionHeartbeat();startPresence(user.uid);
    const ref=doc(db,'ioe_users',user.uid);
    let snap=await withTimeout(getDoc(ref),12000);
    if(checkVersion!==authCheckVersion)return;
    if(!snap.exists()){
     await setDoc(ref,{email:user.email||'',name:user.displayName||'',createdAt:serverTimestamp(),premiumUntil:null});
     snap=await withTimeout(getDoc(ref),12000);
     if(checkVersion!==authCheckVersion)return;
    }
    profile=snap.data();
    const attemptsSnap=await withTimeout(getDoc(doc(db,'ioe_attempts',user.uid)),12000);
    if(checkVersion!==authCheckVersion)return;
    usedAttempts=attemptsSnap.exists()?attemptsSnap.data().count:0;
    refresh(); // Hết lượt => tự động đóng thông báo và hiện thanh toán.
   }catch(e){
    if(checkVersion!==authCheckVersion)return;
    console.error('Firestore profile/session error:',e);
    await releaseSession(user.uid);
    window.ioeAllowed=false;
    $('ioeLogin').style.display='none';
    show('Không thể kết nối để xác minh tài khoản. Vui lòng thử lại.');
    status('');
   }
  },e=>{show('Không thể khôi phục phiên đăng nhập Firebase.');status(`${e.code||'auth'}: ${e.message}`);});
 }catch(e){show('Không khởi tạo được Firebase.');status(e.message);}
}

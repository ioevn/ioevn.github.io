import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,serverTimestamp,runTransaction} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id);
const configured=Boolean(firebaseConfig?.apiKey && firebaseConfig.apiKey!=='REPLACE_ME' && firebaseConfig?.projectId && firebaseConfig?.authDomain);
let auth,db,me=null,profile=null;
window.ioeAllowed=false;
function status(message){$('ioeGateStatus').textContent=message||'';}
function show(message){$('ioeGate').classList.remove('ioe-hide');$('ioeGateText').textContent=message;}
const MAX_ATTEMPTS=5;
let usedAttempts=0;
function refresh(){
 window.ioeAllowed=!!me && usedAttempts<MAX_ATTEMPTS;
 const remain=Math.max(0,MAX_ATTEMPTS-usedAttempts);
 $('ioeIdentity').textContent=`${me.displayName||me.email||'Học viên'} • Còn ${remain}/5 lượt thi`;
 $('ioePremium').style.display='none';
 $('ioeLogin').style.display='none';
 if(window.ioeAllowed){$('ioeGate').classList.add('ioe-hide');status('');}
 else show('Tài khoản đã sử dụng hết 5 lượt thi thử.');
}
window.ioeClaimAttempt=async()=>{
 if(!me||!db)throw new Error('Bạn cần đăng nhập Google trước khi thi.');
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
window.ioeLogout=async()=>{if(auth)await signOut(auth);};
window.ioeShowPayment=()=>alert('Mỗi tài khoản được thi thử tối đa 5 lần.');
window.ioeSaveResult=async r=>{if(!db||!me||!window.ioeExamActive)return;try{await addDoc(collection(db,'ioe_results'),{...r,uid:me.uid,createdAt:serverTimestamp()});}catch(e){console.warn('Không thể lưu kết quả:',e);}};
if(!configured){show('Thiếu thông tin cấu hình Firebase trong firebase-config.js.');status('Hãy kiểm tra apiKey, authDomain và projectId.');$('ioeLogin').disabled=true;}
else{
 try{
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
   me=user;profile=null;window.ioeAllowed=false;
   if(!user){$('ioeIdentity').textContent='Chưa đăng nhập';$('ioeLogin').style.display='';$('ioeLogin').disabled=false;show('Đăng nhập Google để thi thử tối đa 5 lượt.');status('');return;}
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

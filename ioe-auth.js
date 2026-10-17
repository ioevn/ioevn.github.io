import {firebaseConfig} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id);
const configured=Boolean(firebaseConfig?.apiKey && firebaseConfig.apiKey!=='REPLACE_ME' && firebaseConfig?.projectId && firebaseConfig?.authDomain);
let auth,db,me=null,profile=null;
window.ioeAllowed=false;
function status(message){$('ioeGateStatus').textContent=message||'';}
function show(message){$('ioeGate').classList.remove('ioe-hide');$('ioeGateText').textContent=message;}
function refresh(){
 const now=Date.now();
 const end=profile?.premiumUntil?.toMillis?.()||0;
 const trial=profile?.createdAt?.toMillis?.()||0;
 const premium=end>now,trialValid=trial>0&&now<trial+5*86400000;
 window.ioeAllowed=premium||trialValid;
 $('ioeIdentity').textContent=`${me.displayName||me.email||'Học viên'} • ${premium?'Premium đến '+new Date(end).toLocaleDateString('vi-VN'):trialValid?'Dùng thử còn '+Math.ceil((trial+5*86400000-now)/86400000)+' ngày':'Hết hạn dùng thử'}`;
 $('ioePremium').style.display=premium?'none':'';
 $('ioeLogin').style.display='none';
 if(window.ioeAllowed){$('ioeGate').classList.add('ioe-hide');status('');}
 else show('Bạn đã hết thời gian dùng thử hoặc hồ sơ chưa có ngày bắt đầu hợp lệ. Vui lòng liên hệ quản trị viên.');
}
window.ioeLogin=async()=>{
 if(!configured)return;
 $('ioeLogin').disabled=true;
 status('Đang mở cửa sổ đăng nhập Google…');
 try{await signInWithPopup(auth,new GoogleAuthProvider());status('Google đã xác thực. Đang kiểm tra hồ sơ Firestore…');}
 catch(e){if(e.code==='auth/popup-closed-by-user')status('Bạn đã đóng cửa sổ đăng nhập. Hãy thử lại.');else status(`Đăng nhập thất bại (${e.code||'unknown'}): ${e.message}`);}
 finally{$('ioeLogin').disabled=false;}
};
window.ioeLogout=async()=>{if(auth)await signOut(auth);};
window.ioeShowPayment=()=>alert('Premium IOE: 50.000đ / 30 ngày. Liên hệ quản trị viên để nhận thông tin chuyển khoản. UID: '+(me?.uid||'Chưa đăng nhập'));
window.ioeSaveResult=async r=>{if(!db||!me||!window.ioeAllowed)return;try{await addDoc(collection(db,'ioe_results'),{...r,uid:me.uid,createdAt:serverTimestamp()});}catch(e){console.warn('Không thể lưu kết quả:',e);}};
if(!configured){show('Thiếu thông tin cấu hình Firebase trong firebase-config.js.');status('Hãy kiểm tra apiKey, authDomain và projectId.');$('ioeLogin').disabled=true;}
else{
 try{
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  onAuthStateChanged(auth,async user=>{
   me=user;profile=null;window.ioeAllowed=false;
   if(!user){$('ioeIdentity').textContent='Chưa đăng nhập';$('ioeLogin').style.display='';$('ioeLogin').disabled=false;show('Đăng nhập Google để dùng thử 5 ngày.');status('');return;}
   $('ioeIdentity').textContent=user.displayName||user.email||'Đã đăng nhập Google';
   show('Đã đăng nhập Google. Đang xác minh thời hạn dùng thử…');
   status('Đang kết nối Cloud Firestore…');
   try{
    const ref=doc(db,'ioe_users',user.uid);
    let snap=await getDoc(ref);
    if(!snap.exists()){
     await setDoc(ref,{email:user.email||'',name:user.displayName||'',createdAt:serverTimestamp(),premiumUntil:null});
     snap=await getDoc(ref);
    }
    profile=snap.data();
    if(!profile?.createdAt?.toMillis){throw new Error('Hồ sơ thiếu createdAt hợp lệ. Kiểm tra dữ liệu Firestore.');}
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

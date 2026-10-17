import {firebaseConfig,ADMIN_UID} from './firebase-config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,addDoc,collection,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const configured=firebaseConfig.apiKey!=='REPLACE_ME';
const gate=document.getElementById('ioeGate'),status=document.getElementById('ioeGateStatus');
let auth,db,me,profile;
window.ioeAllowed=false;
function show(msg){gate.classList.remove('ioe-hide');document.getElementById('ioeGateText').textContent=msg;}
function refresh(){const now=Date.now(),end=profile?.premiumUntil?.toMillis?.()||0,trial=profile?.createdAt?.toMillis?.()||now;
 const premium=end>now,trialValid=now<trial+5*86400000;window.ioeAllowed=premium||trialValid;
 document.getElementById('ioeIdentity').textContent=`${me.displayName||me.email} • ${premium?'Premium đến '+new Date(end).toLocaleDateString('vi-VN'):trialValid?'Dùng thử còn '+Math.ceil((trial+5*86400000-now)/86400000)+' ngày':'Hết hạn dùng thử'}`;
 document.getElementById('ioePremium').style.display=premium?'none':'';
 if(window.ioeAllowed){gate.classList.add('ioe-hide')}else show('Bạn đã hết thời gian dùng thử. Vui lòng nâng cấp Premium để tiếp tục thi.');
 document.getElementById('ioeLogin').style.display='none';}
window.ioeLogin=async()=>{if(!configured)return;try{await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){status.textContent=e.message}};
window.ioeLogout=()=>auth&&signOut(auth);
window.ioeShowPayment=()=>{alert('Premium IOE: 50.000đ / 30 ngày. Vui lòng liên hệ quản trị viên để nhận thông tin chuyển khoản. Sau khi xác nhận thanh toán, Admin sẽ kích hoạt tài khoản. UID của bạn: '+(me?.uid||'Chưa đăng nhập'));};
window.ioeSaveResult=async r=>{if(!db||!me||!window.ioeAllowed)return;try{await addDoc(collection(db,'ioe_results'),{...r,uid:me.uid,createdAt:serverTimestamp()})}catch(e){console.warn('Không thể lưu kết quả:',e)}};
if(!configured){status.textContent='Chưa cấu hình Firebase. Mở firebase-config.js để điền thông tin dự án.';document.getElementById('ioeLogin').disabled=true;}
else{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,async user=>{me=user;if(!user){window.ioeAllowed=false;document.getElementById('ioeIdentity').textContent='Chưa đăng nhập';document.getElementById('ioeLogin').style.display='';show('Đăng nhập Google để dùng thử 5 ngày.');return}
try{const ref=doc(db,'ioe_users',user.uid),snap=await getDoc(ref);if(!snap.exists()){await setDoc(ref,{email:user.email||'',name:user.displayName||'',createdAt:serverTimestamp(),premiumUntil:null});const retry=await getDoc(ref);profile=retry.data()}else profile=snap.data();refresh()}catch(e){window.ioeAllowed=false;show('Không thể xác minh quyền truy cập. Kiểm tra Firestore Rules và kết nối mạng. '+e.message)}})}

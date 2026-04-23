// 初始化 Supabase
// ⚠️ 請替換為你專案的真實 URL 與 Anon Key
const SUPABASE_URL = 'https://tnmbxhspwhsdsmtseagv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Zt6dxfV6KeV13_6y_REW_A_M0_uWKPq';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// ================= 1. 初始化與載入共用組件 =================
async function loadComponents() {
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    try {
      const res = await fetch('components/sidebar.html');
      if (res.ok) sidebarContainer.innerHTML = await res.text();
    } catch (e) { console.error('側邊欄載入失敗:', e); }
  }

  const topbarContainer = document.getElementById('topbar-container');
  if (topbarContainer) {
    try {
      const res = await fetch('components/topbar.html');
      if (res.ok) topbarContainer.innerHTML = await res.text();
    } catch (e) { console.error('頂部欄載入失敗:', e); }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadComponents();

  // 預設資料初始化
  if (!localStorage.getItem('myResumes')) {
    localStorage.setItem('myResumes', JSON.stringify([{
      id: Date.now().toString(),
      name: '林同學',
      edu: '資訊管理系',
      gender: '女',
      lang: '英文',
      exp: '1. 專案開發\n2. 系統分析',
      bio: '喜歡寫程式。'
    }]));
  }

  // 根據目前所在頁面執行對應邏輯
  if (document.getElementById('resume-grid-container')) renderResumes();
  if (document.getElementById('setup-resume-grid')) renderSetupResumes();
  if (document.getElementById('localVideo')) initCamera();
});

// ================= 2. 導覽邏輯 =================
function toggleMenu() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('active'); }
    function navTo(sectionId, title) {
      document.querySelectorAll('.section-container').forEach(el => el.classList.remove('active'));
      document.getElementById(sectionId).classList.add('active');
      document.getElementById('page-title').innerText = title;
      
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('overlay').classList.remove('active');

      if (sectionId === 'login-section' || sectionId === 'interview-section') {
        document.getElementById('top-bar').style.display = 'none';
      } else {
        document.getElementById('top-bar').style.display = 'flex';
      }
    }
    
function loginSuccess() { navTo('lobby-section', '大廳'); }

// ================= 3. 登入與註冊邏輯 =================
function openRegisterModal() { document.getElementById('register-modal-overlay').style.display = 'flex'; }
function closeRegisterModal() { document.getElementById('register-modal-overlay').style.display = 'none'; }

// 🌟 註冊：建立 Auth 帳號並同步寫入 Applicants 資料表
async function handleRegisterSubmit() {
  const name = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;

  if (!name || !username || !email || !pass) return alert("所有欄位皆為必填！");
  if (pass !== confirm) return alert("兩次輸入的密碼不一致！");

  // 1. 在 Supabase Auth 建立帳號
  const { data: authData, error: authError } = await _supabase.auth.signUp({
    email: email,
    password: pass
  });

  if (authError) return alert("註冊失敗：" + authError.message);

  // 2. 帳號建立成功後，將個資寫入 Applicants 資料表
  if (authData.user) {
    const { error: dbError } = await _supabase
      .from('applicants') // ⚠️ 請確認你的資料表名稱大小寫
      .insert([
        {
          applicant_id: authData.user.id, // 關聯 Auth 的 User ID
          username: username,
          name: name,
          email: email
        }
      ]);

    if (dbError) {
      console.error("個資儲存失敗:", dbError);
      return alert("帳號已建立，但個資寫入失敗：" + dbError.message);
    }
  }

  alert("註冊成功！請登入。");
  closeRegisterModal();
}

// 🌟 登入：先用帳號查信箱，再執行驗證
async function handleLogin() {
  const username = document.getElementById('username').value.trim(); // 你的 HTML 裡 id 為 username
  const pass = document.getElementById('password').value;
  
  if (!username || !pass) return alert("請輸入帳號跟密碼！");

  try {
    // 步驟 A：從 applicants 資料表找出該帳號對應的真實信箱
    const { data: userData, error: dbError } = await _supabase
      .from('applicants')
      .select('email')
      .eq('username', username)
      .single();

    if (dbError || !userData) {
      return alert("登入失敗：找不到此帳號，請檢查名稱是否正確。");
    }

    // 步驟 B：使用查到的信箱與密碼進行登入
    const { error: authError } = await _supabase.auth.signInWithPassword({
      email: userData.email,
      password: pass
    });

    if (authError) {
      alert("登入失敗：密碼錯誤！");
    } else {
      // 登入成功
      window.location.href = 'lobby.html';
    }
  } catch (err) {
    console.error("登入異常:", err);
    alert("系統連線發生問題。");
  }
}

function guestLogin() { 
  alert("您正以「訪客身分」登入！\n可以正常體驗系統與漢堡選單，但無法將履歷儲存至 Supabase 雲端資料庫喔。");
  
  // 直接跳轉到大廳頁面，大廳載入時會自動生成漢堡選單
  window.location.href = 'lobby.html'; 
}

async function logout() { 
  const { error } = await _supabase.auth.signOut();
  if (!error) {
    alert("已登出系統");
    window.location.href = 'index.html'; 
  }
}

// ================= 4. 履歷管理邏輯 =================
function renderResumes() {
  const container = document.getElementById('resume-grid-container');
  if (!container) return;
  const resumes = JSON.parse(localStorage.getItem('myResumes')) || [];
  container.innerHTML = '';
  
  resumes.forEach(res => {
    container.innerHTML += `
      <div class="resume-card glass-panel" style="width:320px; height:500px; padding: 40px 30px;">
        <h3>${res.name ? res.name + '的履歷' : '未命名履歷'}</h3>
        <button class="btn-glass" onclick="previewResume('${res.id}')">預覽</button>
        <button class="btn-glass" onclick="openResumeForm('${res.id}')">編輯</button>
        <button class="btn-glass" style="color: #ff4757; border-color: rgba(255, 71, 87, 0.3);" onclick="deleteResume('${res.id}')">刪除</button>
      </div>
    `;
  });
  
  container.innerHTML += `
    <div class="resume-card add-resume glass-panel" style="width:320px; height:500px;" onclick="openResumeForm()">⊕</div>
  `;
}

function openResumeForm(id = null) {
      document.getElementById('resume-form-overlay').style.display = 'flex';
      const title = document.getElementById('resume-modal-title');
      if (id) {
        title.innerText = '編輯履歷';
        const res = (JSON.parse(localStorage.getItem('myResumes')) || []).find(r => r.id === id);
        if (res) {
          document.getElementById('res-id').value = res.id;
          document.getElementById('res-name').value = res.name || '';
          document.getElementById('res-edu').value = res.edu || ''; // 讀取最高學歷
          document.getElementById('res-gender').value = res.gender || '';
          document.getElementById('res-lang').value = res.lang || '';
          document.getElementById('res-exp').value = res.exp || '';
          document.getElementById('res-bio').value = res.bio || '';
        }
      } else {
        title.innerText = '新增履歷';
        document.getElementById('res-id').value = '';
        document.getElementById('res-name').value = '';
        document.getElementById('res-edu').value = ''; // 清空最高學歷
        document.getElementById('res-gender').value = '';
        document.getElementById('res-lang').value = '';
        document.getElementById('res-exp').value = '';
        document.getElementById('res-bio').value = '';
      }
}

function saveResume() {
  const id = document.getElementById('res-id').value;
  const name = document.getElementById('res-name').value.trim();
  if (!name) return alert("姓名為必填欄位喔！");

  const newRes = {
    id: id || Date.now().toString(), name: name, edu: document.getElementById('res-edu').value,
    gender: document.getElementById('res-gender').value, lang: document.getElementById('res-lang').value,
    exp: document.getElementById('res-exp').value, bio: document.getElementById('res-bio').value
  };

  let resumes = JSON.parse(localStorage.getItem('myResumes')) || [];
  if (id) { const i = resumes.findIndex(r => r.id === id); if (i > -1) resumes[i] = newRes; } else { resumes.push(newRes); }
  localStorage.setItem('myResumes', JSON.stringify(resumes));
  
  document.getElementById('resume-form-overlay').style.display = 'none';
  if(document.getElementById('resume-grid-container')) renderResumes();
  if(document.getElementById('setup-step-2')?.classList.contains('active')) renderSetupResumes();
}

function deleteResume(id) {
  if (confirm("確定要刪除這份履歷嗎？刪除後無法恢復喔。")) {
    localStorage.setItem('myResumes', JSON.stringify((JSON.parse(localStorage.getItem('myResumes')) || []).filter(r => r.id !== id)));
    if(document.getElementById('resume-grid-container')) renderResumes();
    if(document.getElementById('setup-step-2')?.classList.contains('active')) renderSetupResumes();
  }
}

function previewResume(id) {
  const res = (JSON.parse(localStorage.getItem('myResumes')) || []).find(r => r.id === id);
  if (!res) return;
  document.getElementById('preview-content').innerHTML = `
    <div class="preview-item"><div class="preview-label">姓名 Name</div><div class="preview-value">${res.name || '-'}</div></div>
    <div style="display: flex; gap: 20px;">
      <div class="preview-item" style="flex: 1;"><div class="preview-label">最高學歷 Education</div><div class="preview-value">${res.edu || '-'}</div></div>
      <div class="preview-item" style="flex: 1;"><div class="preview-label">性別 Gender</div><div class="preview-value">${res.gender || '-'}</div></div>
    </div>
    <div class="preview-item"><div class="preview-label">語言能力 Languages</div><div class="preview-value">${res.lang || '-'}</div></div>
    <div class="preview-item"><div class="preview-label">工作與專案經歷 Experience</div><div class="preview-value">${res.exp || '-'}</div></div>
    <div class="preview-item" style="border: none;"><div class="preview-label">自傳與簡介 Autobiography</div><div class="preview-value">${res.bio || '-'}</div></div>
  `;
  document.getElementById('resume-preview-overlay').style.display = 'flex';
}
function closePreviewModal() { document.getElementById('resume-preview-overlay').style.display = 'none'; }
function closeResumeFormModal() { document.getElementById('resume-form-overlay').style.display = 'none'; }


// ================= 5. 面試設定流程 =================
let interviewState = { type: '', position: '', resumeId: null };

function goToSetupStep2() {
  const type = document.getElementById('setup-type').value;
  const position = document.getElementById('setup-position').value.trim();
  if (!position) return alert("請輸入您要應徵的面試職位！");
  
  interviewState.type = type;
  interviewState.position = position;

  document.getElementById('setup-step-1').classList.remove('active');
  document.getElementById('setup-step-2').classList.add('active');
  renderSetupResumes();
}

function goToSetupStep1() {
  document.getElementById('setup-step-2').classList.remove('active');
  document.getElementById('setup-step-1').classList.add('active');
}

function renderSetupResumes() {
  const container = document.getElementById('setup-resume-grid');
  if(!container) return;
  const resumes = JSON.parse(localStorage.getItem('myResumes')) || [];
  container.innerHTML = '';
  
  if (resumes.length === 0) container.innerHTML = `<p style="color: var(--text-sub); width: 100%; text-align: center;">您尚未建立任何履歷，請先新增一份履歷。</p>`;

  resumes.forEach(res => {
    const isSelected = interviewState.resumeId === res.id ? 'selected' : '';
    container.innerHTML += `
      <div class="resume-card glass-panel selectable-resume ${isSelected}" onclick="selectResumeForInterview('${res.id}')" style="width:280px; height:380px; padding:30px 20px;">
        <h3>${res.name ? res.name + '的履歷' : '未命名履歷'}</h3>
        <p style="color: var(--text-sub); margin-bottom: auto; text-align: center;">最高學歷: ${res.edu || '-'}<br>專長: ${res.lang || '-'}</p>
        <div style="color: var(--primary-green); font-weight: bold; margin-top: 15px;">
          ${isSelected ? '✔️ 已選擇' : '點擊選擇此履歷'}
        </div>
      </div>
    `;
  });
  container.innerHTML += `<div class="resume-card add-resume glass-panel" style="width:280px; height:380px;" onclick="openResumeForm()">⊕</div>`;
}

function selectResumeForInterview(id) {
  interviewState.resumeId = id;
  renderSetupResumes(); 
}

// ================= 6. 面試進行 =================
async function beginInterview() {
  if (!interviewState.resumeId) return alert("請先點擊選擇一份要使用的履歷！");
  window.location.href = 'interview.html';
}

async function initCamera() {
  const videoElement = document.getElementById('localVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if(videoElement) videoElement.srcObject = stream;
  } catch (err) { alert("記得要允許瀏覽器使用攝影機跟麥克風喔！"); }
}

function endInterview() {
  const v = document.getElementById('localVideo');
  if (v && v.srcObject) v.srcObject.getTracks().forEach(track => track.stop());
  window.location.href = 'result.html';
}
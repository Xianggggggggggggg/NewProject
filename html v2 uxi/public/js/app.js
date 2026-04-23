// ================= 0. Supabase 初始化 =================
const supabaseUrl = 'https://tnmbxhspwhsdsmtseagv.supabase.co'; 
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubWJ4aHNwd2hzZHNtdHNlYWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MTUxMTksImV4cCI6MjA5MTI5MTExOX0.l07PlK7R9-yMnND2pDjw02EFQBs7Vfc_H6VIPBjwbo0';

let supabaseClient;

try {
  if (!window.supabase) {
    throw new Error("找不到 Supabase SDK，請檢查 HTML 是否載入 CDN！");
  }
  // 建立唯一全域連線實例
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase 初始化成功！");
} catch (err) {
  console.error("❌ Supabase 初始化失敗：", err.message);
}

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

  // 預設資料初始化 (LocalStorage 備份用)
  if (!localStorage.getItem('myResumes')) {
    localStorage.setItem('myResumes', JSON.stringify([{
      id: Date.now().toString(),
      name: '範例履歷',
      edu: '資訊管理系',
      gender: '女',
      lang: '英文',
      exp: '1. 專案開發\n2. 系統分析',
      bio: '這是一個預設範例。'
    }]));
  }

  // 根據目前所在頁面執行對應邏輯
  if (document.getElementById('resume-grid-container')) renderResumes();
  if (document.getElementById('setup-resume-grid')) renderSetupResumes();
  if (document.getElementById('localVideo')) initCamera();
});

// ================= 2. 導覽邏輯 =================
function toggleMenu() { 
  document.getElementById('sidebar').classList.toggle('open'); 
  document.getElementById('overlay').classList.toggle('active'); 
}

function navTo(sectionId, title) {
  document.querySelectorAll('.section-container').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');
  
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.innerText = title;
  
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');

  // 隱藏/顯示 Top Bar
  const topBar = document.getElementById('top-bar');
  if (topBar) {
    topBar.style.display = (sectionId === 'login-section' || sectionId === 'interview-section') ? 'none' : 'flex';
  }
}

// ================= 3. 登入與註冊邏輯 =================
function openRegisterModal() { document.getElementById('register-modal-overlay').style.display = 'flex'; }
function closeRegisterModal() { document.getElementById('register-modal-overlay').style.display = 'none'; }

async function handleRegisterSubmit() {
  const name = document.getElementById('reg-name').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;

  if (!name || !username || !email || !pass) return alert("所有欄位皆為必填！");
  if (pass !== confirm) return alert("密碼輸入不一致！");

  // 1. 建立 Auth 帳號
  const { data: authData, error: authError } = await supabaseClient.auth.signUp({ email, password: pass });
  if (authError) return alert("註冊失敗：" + authError.message);

  // 2. 同步寫入 Applicants 資料表
  if (authData.user) {
    const { error: dbError } = await supabaseClient
      .from('applicants')
      .insert([{
          applicant_id: authData.user.id,
          username: username,
          name: name,
          email: email
      }]);

    if (dbError) return alert("帳號已建立，但個資寫入失敗：" + dbError.message);
  }

  alert("註冊成功！請登入。");
  closeRegisterModal();
}

async function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const pass = document.getElementById('password').value;
  
  if (!username || !pass) return alert("請輸入帳號跟密碼！");

  try {
    // 步驟 A：查信箱
    const { data: userData, error: dbError } = await supabaseClient
      .from('applicants')
      .select('email')
      .eq('username', username)
      .single();

    if (dbError || !userData) return alert("找不到此帳號，請檢查拼字。");

    // 步驟 B：執行登入
    const { error: authError } = await supabaseClient.auth.signInWithPassword({
      email: userData.email,
      password: pass
    });

    if (authError) {
      alert("登入失敗：密碼錯誤！");
    } else {
      window.location.href = 'lobby.html';
    }
  } catch (err) {
    console.error("登入異常:", err);
  }
}

function guestLogin() { 
  alert("以「訪客身分」登入，資料將僅儲存在瀏覽器中。");
  window.location.href = 'lobby.html'; 
}

async function logout() { 
  const { error } = await supabaseClient.auth.signOut();
  if (!error) window.location.href = 'index.html'; 
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
  container.innerHTML += `<div class="resume-card add-resume glass-panel" style="width:320px; height:500px;" onclick="openResumeForm()">⊕</div>`;
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
      document.getElementById('res-edu').value = res.edu || '';
      document.getElementById('res-gender').value = res.gender || '';
      document.getElementById('res-lang').value = res.lang || '';
      document.getElementById('res-exp').value = res.exp || '';
      document.getElementById('res-bio').value = res.bio || '';
    }
  } else {
    title.innerText = '新增履歷';
    document.getElementById('res-id').value = '';
    // 清空表單
    ['res-name', 'res-edu', 'res-gender', 'res-lang', 'res-exp', 'res-bio'].forEach(id => {
      document.getElementById(id).value = '';
    });
  }
}

function saveResume() {
  const id = document.getElementById('res-id').value;
  const name = document.getElementById('res-name').value.trim();
  if (!name) return alert("姓名為必填！");

  const newRes = {
    id: id || Date.now().toString(), 
    name: name, 
    edu: document.getElementById('res-edu').value,
    gender: document.getElementById('res-gender').value, 
    lang: document.getElementById('res-lang').value,
    exp: document.getElementById('res-exp').value, 
    bio: document.getElementById('res-bio').value
  };

  let resumes = JSON.parse(localStorage.getItem('myResumes')) || [];
  if (id) { 
    const i = resumes.findIndex(r => r.id === id); 
    if (i > -1) resumes[i] = newRes; 
  } else { 
    resumes.push(newRes); 
  }
  localStorage.setItem('myResumes', JSON.stringify(resumes));
  
  document.getElementById('resume-form-overlay').style.display = 'none';
  if(document.getElementById('resume-grid-container')) renderResumes();
  if(document.getElementById('setup-resume-grid')) renderSetupResumes();
}

function deleteResume(id) {
  if (confirm("確定要刪除這份履歷嗎？")) {
    const resumes = (JSON.parse(localStorage.getItem('myResumes')) || []).filter(r => r.id !== id);
    localStorage.setItem('myResumes', JSON.stringify(resumes));
    renderResumes();
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
    <div class="preview-item"><div class="preview-label">經歷 Experience</div><div class="preview-value">${res.exp || '-'}</div></div>
    <div class="preview-item" style="border: none;"><div class="preview-label">自傳 Autobiography</div><div class="preview-value">${res.bio || '-'}</div></div>
  `;
  document.getElementById('resume-preview-overlay').style.display = 'flex';
}
function closePreviewModal() { document.getElementById('resume-preview-overlay').style.display = 'none'; }
function closeResumeFormModal() { document.getElementById('resume-form-overlay').style.display = 'none'; }

// ================= 5. 面試設定流程 =================
let interviewState = { type: '', position: '', resumeId: null };

function goToSetupStep2() {
  const position = document.getElementById('setup-position').value.trim();
  if (!position) return alert("請輸入面試職位！");
  
  interviewState.type = document.getElementById('setup-type').value;
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
  
  if (resumes.length === 0) {
    container.innerHTML = `<p style="text-align: center; width: 100%;">尚未建立履歷。</p>`;
  }

  resumes.forEach(res => {
    const isSelected = interviewState.resumeId === res.id ? 'selected' : '';
    container.innerHTML += `
      <div class="resume-card glass-panel selectable-resume ${isSelected}" onclick="selectResumeForInterview('${res.id}')" style="width:280px; height:380px;">
        <h3>${res.name}</h3>
        <p>學歷: ${res.edu || '-'}</p>
        <div style="color: var(--primary-green); font-weight: bold; margin-top: 10px;">
          ${isSelected ? '✔️ 已選擇' : '點擊選擇'}
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

// ================= 6. 面試進行與資料庫寫入 =================

async function beginInterview() {
  if (!interviewState.resumeId) return alert("請先選擇履歷！");
  
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const userId = user ? user.id : null; 
    
    if (!userId) return alert("登入逾時，請重新登入");

    const { data, error } = await supabaseClient
      .from('interview_sessions')
      .insert([{
        applicant_id: userId, 
        // 🌟 註解掉下面這行，不要傳送這個 ID
        // resume_id: interviewState.resumeId, 
        status: '進行中',
        start_time: new Date().toISOString()
      }])
      .select();

    if (error) throw error; // 如果還是報錯，代表 resume_id 欄位在資料庫被設為「必填」
    
    const sessionId = data[0].session_id; 
    window.location.href = `interview.html?session_id=${sessionId}`;

  } catch (err) {
    console.error("建立面試失敗:", err.message);
    alert("建立失敗，原因：" + err.message);
  }
}

async function initCamera() {
  const videoElement = document.getElementById('localVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if(videoElement) videoElement.srcObject = stream;
  } catch (err) { alert("請允許使用攝影機與麥克風。"); }
}

async function uploadInterviewResult(sessionId, analysisData) {
  try {
    // 1. 更新場次狀態
    await supabaseClient
      .from('interview_sessions')
      .update({ status: '已結束', end_time: new Date().toISOString() })
      .eq('session_id', sessionId);

    // 2. 存入情緒日誌
    await supabaseClient
      .from('emotion_logs')
      .insert([{
        session_id: sessionId,
        timestamp_mark: "面試結束統計",
        emotion: (analysisData.emotion_joy > 0.5) ? "自信" : "緊張",
        focus_score: Math.round(analysisData.confidence_score || 0)
      }]);

    console.log('✅ 結果已上傳');
  } catch (err) {
    console.error('❌ 上傳失敗：', err.message);
  }
}

async function endInterview() {
  const v = document.getElementById('localVideo');
  if (v && v.srcObject) v.srcObject.getTracks().forEach(track => track.stop());

  const urlParams = new URLSearchParams(window.location.search);
  const currentSessionId = urlParams.get('session_id');

  if (currentSessionId && window.interviewSessionData) {
      await uploadInterviewResult(currentSessionId, window.interviewSessionData);
  }

  window.location.href = currentSessionId ? `result.html?session_id=${currentSessionId}` : 'result.html';
}
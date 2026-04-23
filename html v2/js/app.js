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

function handleRegisterSubmit() {
  const user = document.getElementById('reg-username').value;
  const pass = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  if (!user || !pass) return alert("請輸入帳號跟密碼！");
  if (pass !== confirm) return alert("兩次輸入的密碼不一致！");

  let usersDB = JSON.parse(localStorage.getItem('myAppUsers')) || {};
  if (usersDB[user]) return alert("這個帳號已經被註冊過囉！");
  
  usersDB[user] = pass;
  localStorage.setItem('myAppUsers', JSON.stringify(usersDB));
  alert("註冊成功！可以登入了。");
  closeRegisterModal();
}

function handleLogin() {
  const user = document.getElementById('username').value;
  const pass = document.getElementById('password').value;
  if (!user || !pass) return alert("請輸入帳號跟密碼！");

  let usersDB = JSON.parse(localStorage.getItem('myAppUsers')) || {};
  if (usersDB[user] && usersDB[user] === pass) {
    window.location.href = 'lobby.html';
  } else {
    alert("登入失敗：帳號或密碼錯誤！");
  }
}

function guestLogin() { window.location.href = 'lobby.html'; }
function logout() { alert("已登出系統"); window.location.href = 'index.html'; }

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
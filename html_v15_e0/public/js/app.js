// ================= 0. 後端 API 代理 =================
async function apiFetch(path, options = {}) {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('supabase_access_token') : null;
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  const init = {
    credentials: 'include',
    headers,
    ...options
  };

  if (options.body && typeof options.body === 'object') {
    init.body = JSON.stringify(options.body);
    init.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, init);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (err) {
    throw new Error(`API 回傳非 JSON：${text}`);
  }

  if (!response.ok) {
    throw new Error(payload.error || response.statusText || 'API request failed');
  }

  return payload;
}

const apiGet = (path) => apiFetch(path, { method: 'GET' });
const apiPost = (path, body) => apiFetch(path, { method: 'POST', body });
const apiPut = (path, body) => apiFetch(path, { method: 'PUT', body });
const apiDelete = (path) => apiFetch(path, { method: 'DELETE' });

async function getCurrentUser() {
  try {
    const result = await apiGet('/api/auth/user');
    return result.user || null;
  } catch (err) {
    console.error('取得目前使用者失敗:', err.message);
    return null;
  }
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
      checkLoginStateAndUpdateUI();
    } catch (e) { console.error('頂部欄載入失敗:', e); }
  }
}
// 🌟 新增這個檢查狀態的函式
function checkLoginStateAndUpdateUI() {
  const token = localStorage.getItem('supabase_access_token');
  // 假設你的 topbar 裡面有一個區塊的 id 叫做 auth-btn-area
  // 如果沒有，你可以直接在頁面右上角加一個按鈕
  
  const topbar = document.getElementById('top-bar'); 
  if (!topbar) return;

  // 我們可以直接在 topbar 裡面塞入一個登入/登出按鈕
  if (token) {
    // 已登入：顯示登出按鈕
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn-glass';
    logoutBtn.style.cssText = 'padding: 5px 15px; font-size: 14px; margin-left: auto;';
    logoutBtn.innerText = '登出';
    logoutBtn.onclick = () => {
      localStorage.removeItem('supabase_access_token');
      alert("已登出！");
      window.location.reload(); // 重新整理頁面
    };
    topbar.appendChild(logoutBtn);
  } else {
    // 未登入：顯示登入/註冊按鈕
    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn-green';
    loginBtn.style.cssText = 'padding: 5px 15px; font-size: 14px; margin-left: auto;';
    loginBtn.innerText = '登入 / 註冊';
    loginBtn.onclick = () => {
      window.location.href = 'index.html'; // 導向登入頁
    };
    topbar.appendChild(loginBtn);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadComponents();

  // 根據目前所在頁面執行對應邏輯
  if (document.getElementById('resume-grid-container')) renderResumes();
  if (document.getElementById('setup-resume-grid')) renderSetupResumes();
  if (document.getElementById('localVideo')) initCamera();
  if (document.getElementById('profile-username')) loadUserProfile();
  if (document.querySelector('.history-list')) loadHistory();
  if (document.getElementById('job-grid-container')) renderLobbyJobs();
  if (document.getElementById('job-detail-container')) renderJobDetail();

  // 綁定 Enter 鍵自動登入
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  
  if (usernameInput && passwordInput) {
    // 當在「帳號框」按下鍵盤時
    usernameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleLogin(); // 如果按下的是 Enter 鍵，就執行登入
    });
    
    // 當在「密碼框」按下鍵盤時
    passwordInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') handleLogin(); // 如果按下的是 Enter 鍵，就執行登入
    });
  }
  // 如果導向 setup.html，自動填寫應徵職位
  if (document.getElementById('setup-position')) {
    const prefill = localStorage.getItem('prefillPosition');
    if(prefill) {
      document.getElementById('setup-position').value = prefill;
      localStorage.removeItem('prefillPosition');
    }
  }
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

  if (!name || !username || !email || !pass) return alert('所有欄位皆為必填！');
  if (pass !== confirm) return alert('密碼輸入不一致！');

  try {
    const result = await apiPost('/api/auth/register', {
      name,
      username,
      email,
      password: pass
    });

    if (result.error) return alert('註冊失敗：' + result.error);

    alert('註冊成功！請登入。');
    closeRegisterModal();
  } catch (err) {
    alert('註冊失敗：' + err.message);
  }
}

async function handleLogin() {
  const username = document.getElementById('username').value.trim();
  const pass = document.getElementById('password').value;

  if (!username || !pass) return alert('請輸入帳號跟密碼！');

  try {
    const result = await apiPost('/api/auth/login', { username, password: pass });
    if (result.error) return alert('登入失敗：' + result.error);

    if (result.access_token) {
      localStorage.setItem('supabase_access_token', result.access_token);
      
      // 🌟 延遲登入檢查：判斷是不是按了「應徵」才被趕過來的？
      const pendingJobId = localStorage.getItem('pendingApplyJobId');
      if (pendingJobId) {
        localStorage.removeItem('pendingApplyJobId'); // 消耗掉紀錄
        window.location.href = `apply.html?jobId=${pendingJobId}`; // 送回他剛剛看的職缺
      } else {
        window.location.href = 'lobby.html'; // 正常登入去大廳
      }
    }
  } catch (err) {
    alert('登入異常：' + err.message);
  }
}

// 🌟 切換密碼明文/密文顯示
function togglePasswordVisibility() {
  const passInput = document.getElementById('password');
  // 切換 input 的 type 屬性
  if (passInput.type === 'password') {
    passInput.type = 'text'; // 顯示明文
  } else {
    passInput.type = 'password'; // 變回星號密文
  }
}

// 🌟 忘記密碼 (發送重設信件)
async function forgotPassword() {
  const email = prompt('請輸入您註冊時使用的電子信箱 (Email)：');
  if (!email) return;
  if (!email.includes('@')) return alert('請輸入有效的信箱格式！');

  try {
    const result = await apiPost('/api/auth/password-reset', {
      email,
      redirectTo: window.location.origin + '/profile.html'
    });

    if (result.error) {
      alert('發送失敗：' + result.error);
    } else {
      alert('密碼重設信件已成功發送！\n請前往您的信箱收信，並點擊信件內的連結來重設密碼。');
    }
  } catch (err) {
    alert('發送失敗：' + err.message);
  }
}

async function logout() {
  try {
    await apiPost('/api/auth/logout');
  } catch (err) {
    console.warn('登出時發生錯誤：', err.message);
  }

  localStorage.removeItem('supabase_access_token');
  localStorage.removeItem('supabase_refresh_token');
  window.location.href = 'lobby.html';
}

// ================= 4. 履歷管理邏輯 =================
// ================= 4. 履歷管理邏輯 (Supabase 雲端版) =================

// 🌟 讀取並渲染履歷清單
async function renderResumes() {
  const container = document.getElementById('resume-grid-container');
  if (!container) return;

  const user = await getCurrentUser();
  if (!user) {
    container.innerHTML = '<p style="text-align: center; width: 100%;">請先登入以查看履歷</p>';
    return;
  }

  try {
    const result = await apiGet('/api/resumes');
    const resumes = result.resumes || [];

    container.innerHTML = '';
    resumes.forEach(res => {
      container.innerHTML += `
        <div class="resume-card glass-panel" style="width:320px; height:500px; padding: 40px 30px;">
          <h3>${res.resume_name ? res.resume_name : '未命名履歷'}</h3>
          <button class="btn-glass" onclick="previewResume('${res.resume_id}')">預覽</button>
          <button class="btn-glass" onclick="openResumeForm('${res.resume_id}')">編輯</button>
          <button class="btn-glass" style="color: #ff4757; border-color: rgba(255, 71, 87, 0.3);" onclick="deleteResume('${res.resume_id}')">刪除</button>
        </div>
      `;
    });
    container.innerHTML += `<div class="resume-card add-resume glass-panel" style="width:320px; height:500px;" onclick="openResumeForm()">⊕</div>`;
  } catch (err) {
    console.error('讀取履歷失敗:', err);
    container.innerHTML = '<p style="text-align: center; width: 100%;">讀取履歷失敗，請稍後再試。</p>';
  }
}

// 🌟 打開表單 (新增或編輯)
async function openResumeForm(id = null) {
  document.getElementById('resume-form-overlay').style.display = 'flex';
  const title = document.getElementById('resume-modal-title');

  if (id) {
    title.innerText = '編輯履歷';
    try {
      const result = await apiGet(`/api/resume/${id}`);
      const res = result.resume;
      if (res) {
        document.getElementById('res-id').value = res.resume_id;
        document.getElementById('res-name').value = res.resume_name || '';
        document.getElementById('res-edu').value = res.education || '';
        document.getElementById('res-gender').value = res.gender || '';
        document.getElementById('res-lang').value = res.language_skills || '';
        document.getElementById('res-exp').value = res.work_experience || '';
        document.getElementById('res-bio').value = res.autobiography || '';
      }
    } catch (err) {
      console.error('載入履歷失敗:', err);
    }
  } else {
    title.innerText = '新增履歷';
    document.getElementById('res-id').value = '';
    ['res-name', 'res-edu', 'res-gender', 'res-lang', 'res-exp', 'res-bio'].forEach(elId => {
      document.getElementById(elId).value = '';
    });
  }
}

// 🌟 儲存履歷 (寫入後端代理)
async function saveResume() {
  const id = document.getElementById('res-id').value;
  const name = document.getElementById('res-name').value.trim();
  if (!name) return alert('請輸入「履歷自訂名稱」！');

  const user = await getCurrentUser();
  if (!user) return alert('請先登入！');

  const resumeData = {
    resume_name: name,
    education: document.getElementById('res-edu').value,
    gender: document.getElementById('res-gender').value,
    language_skills: document.getElementById('res-lang').value,
    work_experience: document.getElementById('res-exp').value,
    autobiography: document.getElementById('res-bio').value
  };

  try {
    if (id) {
      const result = await apiPut(`/api/resume/${id}`, resumeData);
      if (result.error) throw new Error(result.error);
    } else {
      const result = await apiPost('/api/resume', resumeData);
      if (result.error) throw new Error(result.error);
    }

    closeResumeFormModal();
    if (document.getElementById('resume-grid-container')) renderResumes();
    if (document.getElementById('setup-resume-grid')) renderSetupResumes();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
}

// 🌟 刪除履歷
async function deleteResume(id) {
  if (confirm('確定要從雲端刪除這份履歷嗎？刪除後無法恢復喔。')) {
    try {
      const result = await apiDelete(`/api/resume/${id}`);
      if (result.error) throw new Error(result.error);
      renderResumes();
      if (document.getElementById('setup-step-2')?.classList.contains('active')) renderSetupResumes();
    } catch (err) {
      alert('刪除失敗：' + err.message);
    }
  }
}

// 🌟 預覽履歷
async function previewResume(id) {
  try {
    const result = await apiGet(`/api/resume/${id}`);
    const res = result.resume;
    if (!res) return alert('讀取履歷失敗');

    const profileResult = await apiGet('/api/user/profile');
    const realName = profileResult.profile?.name || '未知姓名';

    document.getElementById('preview-content').innerHTML = `
      <div class="preview-item">
        <div class="preview-label">履歷自訂標籤</div>
        <div class="preview-value" style="font-weight: bold; color: var(--primary-green); font-size: 18px;">
          ${res.resume_name || '-'}
        </div>
      </div>
      <div class="preview-item">
        <div class="preview-label">姓名 Name</div>
        <div class="preview-value">${realName}</div>
      </div>
      <div style="display: flex; gap: 20px;">
        <div class="preview-item" style="flex: 1;"><div class="preview-label">最高學歷 Education</div><div class="preview-value">${res.education || '-'}</div></div>
        <div class="preview-item" style="flex: 1;"><div class="preview-label">性別 Gender</div><div class="preview-value">${res.gender || '-'}</div></div>
      </div>
      <div class="preview-item"><div class="preview-label">語言能力 Languages</div><div class="preview-value">${res.language_skills || '-'}</div></div>
      <div class="preview-item"><div class="preview-label">工作與專案經歷 Experience</div><div class="preview-value">${res.work_experience || '-'}</div></div>
      <div class="preview-item" style="border: none;"><div class="preview-label">自傳 Autobiography</div><div class="preview-value">${res.autobiography || '-'}</div></div>
    `;
    document.getElementById('resume-preview-overlay').style.display = 'flex';
  } catch (err) {
    alert('讀取履歷失敗：' + err.message);
  }
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

// 🌟 渲染面試設定頁面的履歷 (Step 2)
async function renderSetupResumes() {
  const container = document.getElementById('setup-resume-grid');
  if (!container) return;

  const user = await getCurrentUser();
  if (!user) return;

  try {
    const result = await apiGet('/api/resumes');
    const resumes = result.resumes || [];

    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.flexWrap = 'wrap';
    container.style.justifyContent = 'center';
    container.style.alignItems = 'stretch';
    container.style.gap = '30px';
    container.innerHTML = '';

    if (!resumes.length) {
      container.innerHTML = `<p style="text-align: center; width: 100%;">您尚未建立任何履歷，請先新增一份履歷。</p>`;
    } else {
      resumes.forEach(res => {
        const isSelected = interviewState.resumeId === res.resume_id ? 'selected' : '';
        container.innerHTML += `
          <div class="resume-card glass-panel selectable-resume ${isSelected}" onclick="selectResumeForInterview('${res.resume_id}')" style="width:260px; height:auto; min-height:220px; display: flex; flex-direction: column; align-items: center; padding: 20px 20px 15px 20px;">
            <h3 style="margin-top: 0; font-size: 20px;">${res.resume_name}</h3>
            <div style="display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: auto; margin-bottom: 15px;">
              <button class="btn-glass" style="width: 100%; padding: 10px 0; border-radius: 8px;" onclick="event.stopPropagation(); previewResume('${res.resume_id}')">預覽</button>
              <button class="btn-glass" style="width: 100%; padding: 10px 0; border-radius: 8px;" onclick="event.stopPropagation(); openResumeForm('${res.resume_id}')">編輯</button>
              <button class="btn-glass" style="width: 100%; padding: 10px 0; border-radius: 8px; color: #ff4757; border-color: rgba(255, 71, 87, 0.3);" onclick="event.stopPropagation(); deleteResume('${res.resume_id}')">刪除</button>
            </div>
            <div style="color: var(--primary-green); font-weight: bold; font-size: 14px;">
              ${isSelected ? '✔️ 已選擇' : '點擊選擇此履歷'}
            </div>
          </div>
        `;
      });
    }

    container.innerHTML += `
      <div class="resume-card add-resume glass-panel" onclick="openResumeForm()" style="width:260px; height:auto; min-height:220px; display:flex; justify-content:center; align-items:center; font-size: 60px; color: rgba(0,0,0,0.15); cursor:pointer;">
        ⊕
      </div>
    `;
  } catch (err) {
    console.error('讀取履歷失敗:', err);
    container.innerHTML = '<p style="text-align: center; width: 100%;">讀取履歷失敗，請稍後再試。</p>';
  }
}

function selectResumeForInterview(id) {
  interviewState.resumeId = id;
  renderSetupResumes();
}

// ================= 6. 面試進行與資料庫寫入 =================

// ====== 設定頁面 (app.js) 的修改 ======

// ================= 6. 面試進行與資料庫寫入 =================

async function beginInterview() {
  const typeValue = document.getElementById('setup-type').value;
  const positionValue = document.getElementById('setup-position').value;

  if (!positionValue.trim()) return alert('請先填寫「應徵職位」喔！');

  const resumeId = interviewState.resumeId;
  if (!resumeId) return alert('請選擇一份要投遞的履歷！');

  try {
    const result = await apiPost('/api/interview-sessions', {
      resume_id: resumeId,
      position: positionValue,
      type: typeValue
    });

    if (result.error) throw new Error(result.error);
    const sessionId = result.session_id;

    window.location.href = `interview.html?session_id=${sessionId}&resume_id=${resumeId}&position=${encodeURIComponent(positionValue)}&type=${encodeURIComponent(typeValue)}`;
  } catch (err) {
    console.error('建立面試失敗:', err.message);
    alert('建立失敗，原因：' + err.message);
  }
}

async function initCamera() {
  const videoElement = document.getElementById('localVideo');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (videoElement) videoElement.srcObject = stream;
  } catch (err) { alert("請允許使用攝影機與麥克風。"); }
}

async function uploadInterviewResult(sessionId, analysisData) {
  try {
    console.log("⏳ 準備同步資料至 Supabase...");

    // 🌟 1. 更細膩的情緒判定邏輯與防呆
    let finalEmotion = "未偵測到人臉";
    const hasValidData = (analysisData.emotion_anxiety > 0 || 
                          analysisData.emotion_joy > 0 || 
                          analysisData.emotion_neutral > 0);

    if (!hasValidData) {
      finalEmotion = "未偵測到人臉 (或鏡頭被遮蔽)";
    } else if (analysisData.emotion_anxiety > 0.25 || analysisData.blink_count > 25) {
      finalEmotion = "略顯緊張";
    } else if (analysisData.emotion_joy > 0.3) {
      finalEmotion = "自信開朗";
    } else if (analysisData.emotion_neutral > 0.5) {
      finalEmotion = "沉穩專業";
    } else {
      finalEmotion = "平穩"; 
    }

    // 🌟 2. 對應調整：動態生成 AI 評估回饋 & 強制覆蓋異常分數
    let finalFeedback = analysisData.ai_feedback;
    let finalConfidenceScore = analysisData.confidence_score || 0; // 👈 先把前端傳來的分數存起來

    if (!hasValidData) {
      // 沒臉的時候，強制覆蓋回饋內容
      finalFeedback = "系統於面試過程中無法有效偵測到人臉特徵。請確認視訊設備是否正常運作，且面試環境光線充足，避免背光或遮蔽物影響 AI 判讀。";
      
      // 🚨 新增：既然沒臉，專注度直接強制死當歸零！
      finalConfidenceScore = 0; 
    } else if (!finalFeedback) {
      finalFeedback = "面試表現平穩。"; 
    }

    // --- 透過後端 API 寫入資料庫 ---
    const result = await apiPost('/api/interview-result', {
      session_id: sessionId,
      finalEmotion,
      finalFeedback,
      finalConfidenceScore,
      analysisData
    });

    if (result.error) throw new Error(result.error);
    console.log(`✅ 結果已完整上傳！最終判定情緒為：【${finalEmotion}】，專注度分數：【${finalConfidenceScore}】`);

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

  //window.location.href = currentSessionId ? `result.html?session_id=${currentSessionId}` : 'result.html';
}
// ================= 7. 個人資料管理 (Profile) =================

// 🌟 1. 載入個人資料到畫面上
async function loadUserProfile() {
  try {
    const result = await apiGet('/api/user/profile');
    const profile = result.profile;
    if (!profile) {
      alert('請先登入！');
      window.location.href = 'index.html';
      return;
    }

    document.getElementById('profile-username').value = profile.username;
    document.getElementById('profile-name').value = profile.name;
    document.getElementById('profile-email-display').innerText = profile.email;
  } catch (err) {
    console.error('載入個人資料失敗:', err);
    alert('載入個人資料失敗，請稍後再試。');
  }
}

// 🌟 2. 儲存變更的「姓名」
async function updateUserProfile() {
  const newName = document.getElementById('profile-name').value.trim();
  if (!newName) return alert('姓名不能為空！');

  try {
    const result = await apiPut('/api/user/profile', { name: newName });
    if (result.error) {
      alert('更新失敗：' + result.error);
    } else {
      alert('基本資料已成功更新！');
    }
  } catch (err) {
    alert('更新失敗：' + err.message);
  }
}

// 🌟 3. 變更信箱 (Email)
async function updateUserEmail() {
  const newEmail = prompt('請輸入新的信箱 (Email)：');
  if (!newEmail) return;

  try {
    const result = await apiPut('/api/user/email', { email: newEmail });
    if (result.error) {
      alert('信箱更新失敗：' + result.error);
      return;
    }

    alert('信箱已更新成功！\n(請注意：下次請使用新信箱對應的帳號密碼登入)');
    loadUserProfile();
  } catch (err) {
    alert('信箱更新失敗：' + err.message);
  }
}

// 🌟 4. 變更登入密碼
async function updateUserPassword() {
  const newPassword = prompt("請輸入新的密碼 (至少 6 個字元)：");
  if (!newPassword) return; // 按取消或沒輸入
  if (newPassword.length < 6) return alert("密碼長度需至少 6 個字元！");

  try {
    const result = await apiPut('/api/user/password', { password: newPassword });
    if (result.error) {
      alert('密碼更新失敗：' + result.error);
    } else {
      alert('密碼已成功變更！下一次登入請使用新密碼。');
    }
  } catch (err) {
    alert('密碼更新失敗：' + err.message);
  }
}

// ================= 8. 歷史記錄管理 (History) =================

// 🌟 載入歷史面試記錄
async function loadHistory() {
  try {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('supabase_access_token') : null;
    console.log('📘 loadHistory 開始，supabase_access_token 是否存在：', !!token);

    const currentUser = await apiGet('/api/auth/user').catch(err => {
      console.warn('📘 /api/auth/user 取得使用者失敗：', err.message || err);
      return null;
    });
    console.log('📘 目前登入使用者：', currentUser);

    const result = await apiGet('/api/history');
    console.log('📘 /api/history 回傳結果：', result);
    const history = result.history || [];

    const historyList = document.querySelector('.history-list');
    if (!historyList) return;

    // 清空現有內容（保留標題等）
    const existingRows = historyList.querySelectorAll('.history-row');
    existingRows.forEach(row => row.remove());

    if (history.length === 0) {
      historyList.innerHTML += '<div class="history-row" style="justify-content: center; color: #666;">尚無面試記錄</div>';
      return;
    }

    // 動態生成歷史記錄
    history.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        <span>${item.date}</span>
        <span>${item.position}</span>
        <span class="score">${item.score}</span>
        <span class="icon-view" onclick="viewHistoryDetail('${item.session_id}')">📄</span>
      `;
      historyList.appendChild(row);
    });
  } catch (err) {
    console.error('載入歷史記錄失敗:', err);
    const historyList = document.querySelector('.history-list');
    if (historyList) {
      historyList.innerHTML = `<div class="history-row" style="justify-content: center; color: #c0392b;">載入歷史紀錄失敗：${err.message}</div>`;
    }
    alert('載入歷史記錄失敗，請稍後再試。');
  }
}

// 🌟 查看歷史記錄詳情
function viewHistoryDetail(sessionId) {
  // 跳轉到結果頁面，帶上 session_id 參數
  window.location.href = `result.html?session_id=${sessionId}`;
}


// ================= 9. 職缺大廳與應徵邏輯 (假資料版) =================

const mockJobsDB = {
  'job_001': { id: 'job_001', dept: '研發部', title: '前端工程師', salary: '月薪 45,000 - 60,000', desc: '1. 負責企業端網頁開發\n2. 串接 RESTful API', req: '熟悉 HTML/CSS/JavaScript\n具備 Vue 或 React 經驗', time: '09:00 - 18:00 (週休二日)', other: '零食櫃吃到飽、每年健康檢查' },
  'job_002': { id: 'job_002', dept: '行銷部', title: '社群企劃', salary: '月薪 35,000 - 45,000', desc: '1. 經營 FB/IG 粉絲團\n2. 廣告投放與成效追蹤', req: '具備基礎圖文編排能力\n對社群趨勢敏感', time: '10:00 - 19:00', other: '彈性上下班' },
  'job_003': { id: 'job_003', dept: '設計部', title: 'UI/UX 設計師', salary: '月薪 40,000 - 55,000', desc: '1. 規劃系統介面\n2. 繪製 Wireframe 與 Prototype', req: '精通 Figma\n具備設計系統概念', time: '09:30 - 18:30', other: '配備頂級人體工學椅' }
};

// 渲染大廳列表
function renderLobbyJobs() {
  const grid = document.getElementById('job-grid-container');
  if (!grid) return;
  grid.innerHTML = '';
  Object.values(mockJobsDB).forEach(job => {
    grid.innerHTML += `
      <div class="job-card glass-panel" onclick="window.location.href='apply.html?jobId=${job.id}'" style="padding: 25px; cursor: pointer; transition: 0.3s; position: relative;">
        <div style="position: absolute; top: 20px; right: 20px; font-size: 24px; color: #ccc;">🔖</div>
        <div style="font-size: 14px; color: var(--text-sub); margin-bottom: 5px;">${job.dept}</div>
        <div style="font-size: 22px; font-weight: bold; color: var(--text-main); margin-bottom: 15px;">${job.title}</div>
        <div style="font-size: 16px; color: #d9534f; font-weight: bold;">${job.salary}</div>
      </div>
    `;
  });
}

// 渲染詳細頁資料
function renderJobDetail() {
  const container = document.getElementById('job-detail-container');
  if (!container) return;

  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');
  const job = mockJobsDB[jobId];

  if (job) {
    document.getElementById('job-dept').innerText = job.dept;
    document.getElementById('job-title').innerText = job.title;
    document.getElementById('job-salary').innerText = job.salary;
    document.getElementById('job-desc').innerText = job.desc;
    document.getElementById('job-req').innerText = job.req;
    document.getElementById('job-time').innerText = job.time;
    document.getElementById('job-other').innerText = job.other;
  } else {
    alert("找不到此職缺！");
    window.location.href = 'lobby.html';
  }
}

// 處理應徵動作
function handleApplyAction() {
  const token = localStorage.getItem('supabase_access_token');
  const urlParams = new URLSearchParams(window.location.search);
  const jobId = urlParams.get('jobId');

  if (!token) {
    alert("💡 必須登入求職者帳號才能應徵喔！將為您導向登入頁面。");
    localStorage.setItem('pendingApplyJobId', jobId); // 記住他想應徵的職缺
    window.location.href = 'index.html'; // 把他踢回登入頁（假設 index.html 是登入頁）
  } else {
    // 已經登入了，直接幫他把職位名稱傳給 setup.html
    const job = mockJobsDB[jobId];
    if(job) localStorage.setItem('prefillPosition', job.title); 
    
    alert("🎉 您已登入！即將跳轉到面試設定流程...");
    window.location.href = 'setup.html'; // 跳轉到挑選履歷與設定面試的頁面
  }
}
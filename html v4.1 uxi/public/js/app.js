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

  // (已經將 LocalStorage 假資料初始化的程式碼刪除)

  // 根據目前所在頁面執行對應邏輯
  if (document.getElementById('resume-grid-container')) renderResumes();
  if (document.getElementById('setup-resume-grid')) renderSetupResumes();
  if (document.getElementById('localVideo')) initCamera();
  if (document.getElementById('profile-username')) loadUserProfile();
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
// ================= 4. 履歷管理邏輯 (Supabase 雲端版) =================

// 🌟 讀取並渲染履歷清單
async function renderResumes() {
  const container = document.getElementById('resume-grid-container');
  if (!container) return;

  // 取得當前登入使用者的 ID
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    container.innerHTML = '<p style="text-align: center; width: 100%;">請先登入以查看履歷</p>';
    return;
  }

  // 從資料庫撈取該使用者的履歷
  const { data: resumes, error } = await supabaseClient
    .from('resumes')
    .select('*')
    .eq('applicant_id', user.id);

  if (error) return console.error("讀取履歷失敗:", error);

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
}

// 🌟 打開表單 (新增或編輯)
async function openResumeForm(id = null) {
  document.getElementById('resume-form-overlay').style.display = 'flex';
  const title = document.getElementById('resume-modal-title');

  if (id) {
    title.innerText = '編輯履歷';
    // 從雲端抓取單筆履歷資料
    const { data: res, error } = await supabaseClient
      .from('resumes')
      .select('*')
      .eq('resume_id', id)
      .single();

    if (res && !error) {
      document.getElementById('res-id').value = res.resume_id;
      document.getElementById('res-name').value = res.resume_name || '';
      document.getElementById('res-edu').value = res.education || '';
      document.getElementById('res-gender').value = res.gender || '';
      document.getElementById('res-lang').value = res.language_skills || '';
      document.getElementById('res-exp').value = res.work_experience || '';
      document.getElementById('res-bio').value = res.autobiography || '';
    }
  } else {
    title.innerText = '新增履歷';
    document.getElementById('res-id').value = '';
    ['res-name', 'res-edu', 'res-gender', 'res-lang', 'res-exp', 'res-bio'].forEach(elId => {
      document.getElementById(elId).value = '';
    });
  }
}

// 🌟 儲存履歷 (寫入雲端資料庫)
async function saveResume() {
  const id = document.getElementById('res-id').value;
  const name = document.getElementById('res-name').value.trim();
  if (!name) return alert("履歷名稱(姓名)為必填！");

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("請先登入！");

  // 整理要寫入的資料，欄位名稱對應你的 Supabase 表格
  const resumeData = {
    applicant_id: user.id,
    resume_name: name,
    education: document.getElementById('res-edu').value,
    gender: document.getElementById('res-gender').value,
    language_skills: document.getElementById('res-lang').value,
    work_experience: document.getElementById('res-exp').value,
    autobiography: document.getElementById('res-bio').value
  };

  if (id) {
    // 編輯更新
    const { error } = await supabaseClient.from('resumes').update(resumeData).eq('resume_id', id);
    if (error) return alert("更新失敗：" + error.message);
  } else {
    // 全新建立
    const { error } = await supabaseClient.from('resumes').insert([resumeData]);
    if (error) return alert("新增失敗：" + error.message);
  }

  closeResumeFormModal();
  if (document.getElementById('resume-grid-container')) renderResumes();
  if (document.getElementById('setup-resume-grid')) renderSetupResumes();
}

// 🌟 刪除履歷
async function deleteResume(id) {
  if (confirm("確定要從雲端刪除這份履歷嗎？刪除後無法恢復喔。")) {
    const { error } = await supabaseClient.from('resumes').delete().eq('resume_id', id);
    if (error) return alert("刪除失敗：" + error.message);

    renderResumes();
    if (document.getElementById('setup-step-2')?.classList.contains('active')) renderSetupResumes();
  }
}

// 🌟 預覽履歷
async function previewResume(id) {
  const { data: res, error } = await supabaseClient.from('resumes').select('*').eq('resume_id', id).single();
  if (error || !res) return alert("讀取履歷失敗");

  document.getElementById('preview-content').innerHTML = `
    <div class="preview-item"><div class="preview-label">履歷名稱 Name</div><div class="preview-value">${res.resume_name || '-'}</div></div>
    <div style="display: flex; gap: 20px;">
      <div class="preview-item" style="flex: 1;"><div class="preview-label">最高學歷 Education</div><div class="preview-value">${res.education || '-'}</div></div>
      <div class="preview-item" style="flex: 1;"><div class="preview-label">性別 Gender</div><div class="preview-value">${res.gender || '-'}</div></div>
    </div>
    <div class="preview-item"><div class="preview-label">語言能力 Languages</div><div class="preview-value">${res.language_skills || '-'}</div></div>
    <div class="preview-item"><div class="preview-label">工作與專案經歷 Experience</div><div class="preview-value">${res.work_experience || '-'}</div></div>
    <div class="preview-item" style="border: none;"><div class="preview-label">自傳 Autobiography</div><div class="preview-value">${res.autobiography || '-'}</div></div>
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

async function renderSetupResumes() {
  const container = document.getElementById('setup-resume-grid');
  if (!container) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: resumes, error } = await supabaseClient
    .from('resumes')
    .select('*')
    .eq('applicant_id', user.id);

  container.innerHTML = '';

  if (!resumes || resumes.length === 0) {
    container.innerHTML = `<p style="text-align: center; width: 100%;">您尚未建立任何履歷，請先新增一份履歷。</p>`;
  } else {
    resumes.forEach(res => {
      // 這裡對應的變數要改成 res.resume_id 和 res.resume_name
      const isSelected = interviewState.resumeId === res.resume_id ? 'selected' : '';
      container.innerHTML += `
        <div class="resume-card glass-panel selectable-resume ${isSelected}" onclick="selectResumeForInterview('${res.resume_id}')" style="width:280px; height:380px;">
          <h3>${res.resume_name}</h3>
          <p>學歷: ${res.education || '-'}</p>
          <div style="color: var(--primary-green); font-weight: bold; margin-top: 10px;">
            ${isSelected ? '✔️ 已選擇' : '點擊選擇此履歷'}
          </div>
        </div>
      `;
    });
  }
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
    const position = interviewState.position || '未指定職位';
    window.location.href = `interview.html?session_id=${sessionId}&resume_id=${interviewState.resumeId}&position=${encodeURIComponent(position)}`;

  } catch (err) {
    console.error("建立面試失敗:", err.message);
    alert("建立失敗，原因：" + err.message);
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

    // 🌟 新增：更細膩、更像真人面試官的情緒判定邏輯
    let finalEmotion = "沉穩專業"; // 預設為多數人面試時的平靜狀態

    // 條件 1：如果有明顯的皺眉/失落，或是狂眨眼 -> 判定為緊張
    if (analysisData.emotion_anxiety > 0.25 || analysisData.blink_count > 25) {
      finalEmotion = "略顯緊張";
    }
    // 條件 2：如果笑容比例算高 -> 判定為自信開朗
    else if (analysisData.emotion_joy > 0.3) {
      finalEmotion = "自信開朗";
    }
    // 條件 3：都沒有特別誇張的表情，代表很專注在對答 -> 判定為沉穩
    else if (analysisData.emotion_neutral > 0.5) {
      finalEmotion = "沉穩專業";
    }

    // 1. 更新場次狀態 (Interview_Sessions)
    const { error: sessionError } = await supabaseClient
      .from('interview_sessions')
      .update({ status: '已結束', end_time: new Date().toISOString() })
      .eq('session_id', sessionId);

    if (sessionError) throw sessionError;

    // 2. 存入情緒日誌 (Emotion_Logs)
    const { error: logError } = await supabaseClient
      .from('emotion_logs')
      .insert([{
        session_id: sessionId,
        timestamp_mark: "面試結束統計",
        emotion: finalEmotion, // 👈 換成這組聰明的判斷結果
        focus_score: Math.round(analysisData.confidence_score || 0)
      }]);

    if (logError) throw logError;

    // 3. 寫入綜合評估報告 (Evaluation_Reports)
    const { error: reportError } = await supabaseClient
      .from('evaluation_reports')
      .insert([{
        session_id: sessionId,
        confidence_score: analysisData.confidence_score,
        blink_count: analysisData.blink_count,
        happy_ratio: analysisData.emotion_joy,
        neutral_ratio: analysisData.emotion_neutral,
        sad_ratio: analysisData.emotion_anxiety,
        ai_feedback: analysisData.ai_feedback || "面試表現平穩。"
      }]);

    if (reportError) throw reportError;

    console.log(`✅ 結果已完整上傳！最終判定情緒為：【${finalEmotion}】`);

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
// ================= 7. 個人資料管理 (Profile) =================

// 🌟 1. 載入個人資料到畫面上
async function loadUserProfile() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert("請先登入！");
    window.location.href = 'index.html';
    return;
  }

  // 從 applicants 表格抓取使用者的名字與帳號
  const { data, error } = await supabaseClient
    .from('applicants')
    .select('username, name, email')
    .eq('applicant_id', user.id)
    .single();

  if (error) {
    console.error("載入個人資料失敗:", error);
    return;
  }

  // 將資料填入 HTML
  document.getElementById('profile-username').value = data.username;
  document.getElementById('profile-name').value = data.name;
  document.getElementById('profile-email-display').innerText = data.email;
}

// 🌟 2. 儲存變更的「姓名」
async function updateUserProfile() {
  const newName = document.getElementById('profile-name').value.trim();
  if (!newName) return alert("姓名不能為空！");

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // 更新 applicants 表格中的 name 欄位
  const { error } = await supabaseClient
    .from('applicants')
    .update({ name: newName })
    .eq('applicant_id', user.id);

  if (error) {
    alert("更新失敗：" + error.message);
  } else {
    alert("基本資料已成功更新！");
  }
}

// 🌟 3. 變更信箱 (Email)
async function updateUserEmail() {
  const newEmail = prompt("請輸入新的信箱 (Email)：");
  if (!newEmail) return;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  // 步驟 A：更新 Supabase Auth 系統的登入信箱
  const { data, error } = await supabaseClient.auth.updateUser({ email: newEmail });

  if (error) {
    alert("信箱更新失敗：" + error.message);
    return;
  }

  // 步驟 B：同步更新 applicants 表格中的 email 欄位
  const { error: dbError } = await supabaseClient
    .from('applicants')
    .update({ email: newEmail })
    .eq('applicant_id', user.id);

  if (dbError) console.error("資料庫信箱同步失敗", dbError);

  alert("信箱已更新成功！\n(請注意：下次請使用新信箱對應的帳號密碼登入)");
  loadUserProfile(); // 重新整理畫面上的 Email
}

// 🌟 4. 變更登入密碼
async function updateUserPassword() {
  const newPassword = prompt("請輸入新的密碼 (至少 6 個字元)：");
  if (!newPassword) return; // 按取消或沒輸入
  if (newPassword.length < 6) return alert("密碼長度需至少 6 個字元！");

  // 更新 Supabase Auth 系統的密碼
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

  if (error) {
    alert("密碼更新失敗：" + error.message);
  } else {
    alert("密碼已成功變更！下一次登入請使用新密碼。");
  }
}
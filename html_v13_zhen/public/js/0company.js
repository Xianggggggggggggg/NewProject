// 初始化 Supabase
const supabaseUrl = 'https://tnmbxhspwhsdsmtseagv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRubWJ4aHNwd2hzZHNtdHNlYWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MTUxMTksImV4cCI6MjA5MTI5MTExOX0.l07PlK7R9-yMnND2pDjw02EFQBs7Vfc_H6VIPBjwbo0';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 🌟 企業端專屬：載入組件
async function loadCompanyComponents() {
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    try {
      // 👇 修正 1：加上 ../ 退回上一層，並指向 0sidebar.html
      const res = await fetch('../components/0sidebar.html');
      if (res.ok) sidebarContainer.innerHTML = await res.text();
    } catch (e) { console.error('側邊欄載入失敗:', e); }
  }

  const topbarContainer = document.getElementById('topbar-container');
  if (topbarContainer) {
    try {
      // 👇 修正 2：加上 ../ 退回上一層，並指向 0topbar.html
      const res = await fetch('../components/0topbar.html');
      if (res.ok) topbarContainer.innerHTML = await res.text();
    } catch (e) { console.error('頂部欄載入失敗:', e); }
  }
}

function toggleMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');

  // 防呆檢查：如果找不到這兩個東西，就跳出警告並停止執行
  if (!sidebar || !overlay) {
    console.error("找不到側邊欄或遮罩元素！");
    alert("側邊欄尚未載入或載入失敗！\n請確認 0sidebar.html 結構正確，並使用伺服器 (localhost) 開啟網頁。");
    return;
  }

  // 如果都有找到，才執行展開動作
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
}

function navTo(sectionId, title) {
  document.querySelectorAll('.section-container').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');

  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.innerText = title;

  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');


}

// ================= 4.職缺管理彈窗邏輯 =================

// 🌟 打開彈窗 (如果傳入 id 代表是編輯，沒傳代表是新增)
function openJobModal(jobId = null) {
  const overlay = document.getElementById('job-modal-overlay');
  if (!overlay) return;
  
  overlay.style.display = 'flex';
  
  if (jobId) {
    document.getElementById('job-modal-title').innerText = '編輯職缺';
    // 💡 未來這裡可以寫：從 Supabase 抓取資料填入 Input
    // 暫時先用 alert 模擬
    console.log("正在編輯職缺：" + jobId);
  } else {
    document.getElementById('job-modal-title').innerText = '新增職缺';
    // 清空所有輸入框
    document.getElementById('job-id').value = '';
    document.getElementById('job-dept').value = '';
    document.getElementById('job-title').value = '';
    document.getElementById('job-desc').value = '';
    document.getElementById('job-req').value = '';
    document.getElementById('job-status').value = '開啟';
  }
}

// 🌟 關閉彈窗
function closeJobModal() {
  const overlay = document.getElementById('job-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// 🌟 儲存職缺 (未來串接資料庫用)
async function saveJob() {
  const jobData = {
    department: document.getElementById('job-dept').value,
    job_title: document.getElementById('job-title').value,
    headcount: parseInt(document.getElementById('job-count').value) || 0,
    salary: document.getElementById('job-salary').value,
    job_description: document.getElementById('job-desc').value,
    requirements: document.getElementById('job-req').value,
    work_schedule: document.getElementById('job-time').value,
    benefits: document.getElementById('job-other').value,
    status: document.getElementById('job-status').value
  };

  try {
    // 🌟 根據你的文件，這裡使用大寫開頭的 'Jobs' 
    const { data, error } = await _supabase
      .from('jobs') 
      .insert([jobData]);

    if (error) {
      console.error("寫入失敗：", error.message);
      // 如果仍報錯「Could not find the table」，請檢查 Supabase 後台 Table Editor 
      // 顯示的確實是 Jobs 還是被自動轉成了全小寫的 jobs。
      alert("失敗：" + error.message);
    } else {
      alert("✅ 成功！");
      closeJobModal();
    }
  } catch (err) {
    console.error("發生錯誤：", err);
  }
}

// 🌟 刪除職缺
async function deleteJob(jobId) {
  if (confirm("確定要刪除這個職缺嗎？刪除後無法復原喔！")) {
    alert("已刪除職缺：" + jobId);
    // 💡 未來這裡寫：呼叫 Supabase 執行 delete
  }
}
// ================= 5.應徵者狀態清單彈窗 =================

function openApplicantListModal(jobId) {
  const overlay = document.getElementById('applicant-list-overlay');
  if (!overlay) return;

  // 定義所有可選的狀態選項與對應的顏色 class
  const statusOptions = [
    { text: "已投遞履歷", value: "status-1" },
    { text: "等待應徵者面試", value: "status-2" },
    { text: "等待HR確認", value: "status-3" },
    { text: "已錄取", value: "status-4" },
    { text: "未錄取", value: "status-5" }
  ];

  // 💡 模擬從資料庫抓取該職缺的應徵者資料 (我多加了幾筆讓清單看起來更長)
  const mockApplicants = [
    { name: "陳阿奇", status: "已投遞履歷", class: "status-1" },
    { name: "林小明", status: "等待應徵者面試", class: "status-2" },
    { name: "王大錘", status: "等待HR確認", class: "status-3" },
    { name: "張美麗", status: "已錄取", class: "status-4" },
    { name: "李阿星", status: "未錄取", class: "status-5" },
    { name: "陳測試", status: "已投遞履歷", class: "status-1" },
    { name: "吳面試", status: "已投遞履歷", class: "status-1" }
  ];

  const content = document.getElementById('applicant-list-content');
  content.innerHTML = ''; // 清空舊資料

  // 渲染每一筆應徵者資料
  mockApplicants.forEach(app => {
    const avatarChar = app.name.slice(-1); // 預設大頭貼
    
    // 組合下拉選單 (<select>) 的選項 (<option>)
    let optionsHtml = '';
    statusOptions.forEach(opt => {
      const isSelected = (opt.text === app.status) ? 'selected' : '';
      optionsHtml += `<option value="${opt.value}" ${isSelected}>${opt.text}</option>`;
    });
    
    content.innerHTML += `
      <div class="applicant-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #fff; border: 1px solid rgba(0,0,0,0.05); border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
        <div class="applicant-info" style="display: flex; align-items: center; gap: 15px;">
          <div class="applicant-avatar" style="width: 45px; height: 45px; background: var(--primary-green); color: white; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-weight: bold; font-size: 18px;">${avatarChar}</div>
          <div style="font-size: 18px; font-weight: bold; color: var(--text-main);">${app.name}</div>
        </div>
        
        <select class="status-select ${app.class}" onchange="changeStatusColor(this)">
          ${optionsHtml}
        </select>
      </div>
    `;
  });

  // 顯示彈窗
  overlay.style.display = 'flex';
}

function closeApplicantListModal() {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'none';
}

// 🌟 核心魔法：當選擇不同的狀態時，即時替換按鈕顏色
function changeStatusColor(selectElement) {
  // 1. 先把舊的顏色 class 全部移除
  selectElement.classList.remove('status-1', 'status-2', 'status-3', 'status-4', 'status-5');
  // 2. 把目前選中的選項的 value (例如 'status-4') 加進 class 裡，讓他變色！
  selectElement.classList.add(selectElement.value);
  
  // 💡 未來這裡可以加入一段程式碼，把新狀態同步更新到 Supabase 資料庫！
  console.log("狀態已更改為：" + selectElement.value);
}

function closeApplicantListModal() {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'none';
}


// ================= 6. 求職者管理頁面 (0applicant.html) 邏輯 =================

// 🌟 渲染依部門分組的應徵者列表
function renderGroupedApplicants() {
  const container = document.getElementById('grouped-applicant-list');
  if (!container) return;

  // 💡 模擬資料：以「部門」為 key，裡面放該部門的應徵者陣列
  const applicantsData = {
    "研發部": [
      { id: "app_001", name: "陳阿明", status: "已投遞履歷", class: "status-1", job: "前端工程師" },
      { id: "app_002", name: "林小明", status: "等待應徵者面試", class: "status-2", job: "後端工程師" }
    ],
    "行銷部": [
      { id: "app_003", name: "王大錘", status: "等待HR確認", class: "status-3", job: "社群企劃" },
      { id: "app_004", name: "張美麗", status: "已錄取", class: "status-4", job: "行銷經理" }
    ]
  };

  const statusOptions = [
    { text: "已投遞履歷", value: "status-1" },
    { text: "等待應徵者面試", value: "status-2" },
    { text: "等待HR確認", value: "status-3" },
    { text: "已錄取", value: "status-4" },
    { text: "未錄取", value: "status-5" }
  ];

  container.innerHTML = ''; // 清空內容

  // 跑迴圈把每個部門與其應徵者印出來
  for (const [dept, applicants] of Object.entries(applicantsData)) {
    let listHtml = '';

    applicants.forEach(app => {
      const avatarChar = app.name.slice(-1);
      
      // 產生下拉選單選項
      let optionsHtml = '';
      statusOptions.forEach(opt => {
        const isSelected = (opt.text === app.status) ? 'selected' : '';
        optionsHtml += `<option value="${opt.value}" ${isSelected}>${opt.text}</option>`;
      });

      // 產生單一應徵者的列 (加入放大鏡按鈕)
      listHtml += `
        <div class="applicant-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #fff; border: 1px solid rgba(0,0,0,0.05); border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
          
          <div class="applicant-info" style="display: flex; align-items: center; gap: 15px; flex: 1;">
            <div class="applicant-avatar" style="width: 45px; height: 45px; background: var(--primary-green); color: white; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-weight: bold; font-size: 18px;">${avatarChar}</div>
            <div>
              <div style="font-size: 18px; font-weight: bold; color: var(--text-main);">${app.name}</div>
              <div style="font-size: 14px; color: var(--text-sub); margin-top: 5px;">應徵職位：${app.job}</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 20px;">
            <select class="status-select ${app.class}" onchange="changeStatusColor(this)">
              ${optionsHtml}
            </select>
            <button class="btn-search-detail" onclick="openApplicantDetailModal('${app.id}', '${app.name}')">🔍</button>
          </div>

        </div>
      `;
    });

    // 將該部門的標題與列表塞入大容器中
    container.innerHTML += `
      <div class="dept-group">
        <div class="dept-title">${dept}</div>
        <div class="dept-list-container">
          ${listHtml}
        </div>
      </div>
    `;
  }
}

// 🌟 點擊放大鏡：打開應徵者詳細資料
function openApplicantDetailModal(id, name) {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (!overlay) return;

  document.getElementById('detail-modal-title').innerText = `${name} - 詳細資料`;

  // 💡 模擬從 Supabase 撈出的履歷資料
  document.getElementById('detail-resume-content').innerHTML = `
    <div class="preview-item"><div class="preview-label">最高學歷</div><div class="preview-value">國立台灣大學 資訊工程學系</div></div>
    <div class="preview-item"><div class="preview-label">語言能力</div><div class="preview-value">多益 850, 日文 N3</div></div>
    <div class="preview-item" style="border:none;"><div class="preview-label">工作經歷</div><div class="preview-value">1. OO科技 前端實習生 (1年)\n2. 獨立開發 Vue.js 專案</div></div>
  `;

  // 💡 模擬從 Supabase 撈出的 AI 面試報告
  document.getElementById('detail-ai-content').innerHTML = `
    <div class="preview-item">
      <div class="preview-label">面試分數</div>
      <div class="preview-value" style="color: var(--primary-green); font-size: 28px; font-weight: bold;">88 分</div>
    </div>
    <div class="preview-item" style="border:none;">
      <div class="preview-label">AI 綜合評估</div>
      <div class="preview-value">該求職者在面試過程中表現沉穩，對前端框架的理解深入，且能清晰表達專案架構。情緒穩定度高，建議可安排主管進行二次面試。</div>
    </div>
  `;

  overlay.style.display = 'flex';
}

function closeApplicantDetailModal() {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}
// ================= 7. 公司資訊管理 (0profile.html) 邏輯 =================

// 🌟 讀取公司資訊 (固定抓取 id=1 的資料)
async function loadCompanyProfile() {
  try {
    const { data, error } = await _supabase
      .from('Company_Profile') // ⚠️ 如果報錯找不到，請改為小寫 'company_profile'
      .select('*')
      .eq('id', 1)
      .single();

    if (error) {
      console.error("讀取公司資訊失敗:", error.message);
      return;
    }

    if (data) {
      document.getElementById('profile-name').value = data.company_name || '';
      document.getElementById('profile-industry').value = data.industry || '';
      document.getElementById('profile-email').value = data.contact_email || '';
      document.getElementById('profile-info').value = data.company_info || '';
    }
  } catch (err) {
    console.error("發生錯誤:", err);
  }
}

// 🌟 儲存公司資訊修改
async function saveCompanyProfile() {
  const updatedData = {
    company_name: document.getElementById('profile-name').value,
    industry: document.getElementById('profile-industry').value,
    contact_email: document.getElementById('profile-email').value,
    company_info: document.getElementById('profile-info').value,
    updated_at: new Date().toISOString() // 更新最後修改時間
  };

  if (!updatedData.company_name) return alert("公司名稱不能為空！");

  try {
    const { error } = await _supabase
      .from('Company_Profile') // ⚠️ 依資料庫實際大小寫而定
      .update(updatedData)
      .eq('id', 1);

    if (error) {
      alert("儲存失敗：" + error.message);
    } else {
      alert("✅ 公司資訊已成功更新！");
    }
  } catch (err) {
    console.error("更新發生錯誤:", err);
  }
}

// 修改載入偵測
window.addEventListener('DOMContentLoaded', () => {
  loadCompanyComponents();
  
  // 如果在 0profile.html 頁面，自動載入資料
  if (document.getElementById('profile-name')) {
    loadCompanyProfile();
  }
  
  // 原有的其他頁面偵測...
  if (document.getElementById('job-list-container')) fetchJobs();
  if (document.getElementById('grouped-applicant-list')) renderGroupedApplicants();
});

window.addEventListener('DOMContentLoaded', () => {
  loadCompanyComponents();
  
  // 偵測如果畫面上有這個容器，就執行渲染應徵者列表
  if (document.getElementById('grouped-applicant-list')) {
    renderGroupedApplicants();
  }
});


async function handleCompanyLogin() {
    // 這裡撰寫專屬於企業帳號的登入邏輯
}
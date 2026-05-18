// 📁 檔案位置：public/js/0company.js
// 🌟 100% 抽離 CSS 與 HTML 模板，純粹處理資料流與前端互動邏輯

// 💰 薪水自動格式化神器 (企業端用)
function formatSalaryText(text) {
  if (!text) return '面議';
  if (text.includes('面議')) return text;
  let cleanText = text.replace(/\$/g, '').replace(/,/g, '');
  cleanText = cleanText.replace(/\s*[-~]\s*/g, ' - ');
  return cleanText.replace(/\d+/g, (match) => {
    return '$' + parseInt(match, 10).toLocaleString('en-US');
  });
}

// ================= 1. 載入組件與導覽邏輯 =================
async function loadCompanyComponents() {
  const sidebarContainer = document.getElementById('sidebar-container');
  if (sidebarContainer) {
    try {
      const res = await fetch('../components/0sidebar.html');
      if (res.ok) sidebarContainer.innerHTML = await res.text();
    } catch (e) { console.error('側邊欄載入失敗:', e); }
  }

  const topbarContainer = document.getElementById('topbar-container');
  if (topbarContainer) {
    try {
      const res = await fetch('../components/0topbar.html');
      if (res.ok) topbarContainer.innerHTML = await res.text();
    } catch (e) { console.error('頂部欄載入失敗:', e); }
  }
}

function toggleMenu() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (!sidebar || !overlay) return;
  
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


// ================= 2. 職缺管理彈窗與 CRUD 邏輯 (0job.html) =================

function openJobModal(job = null) { 
  const overlay = document.getElementById('job-modal-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex'; 
  
  if (job && job.job_id) {
    // ✏️【編輯模式】：把傳進來的資料填入格子里
    document.getElementById('job-modal-title').innerText = '編輯職缺';
    document.getElementById('job-id').value = job.job_id; // 把 ID 藏在隱藏欄位裡
    document.getElementById('job-dept').value = job.department || '';
    document.getElementById('job-title').value = job.job_title || '';
    document.getElementById('job-count').value = job.headcount || 1;
    document.getElementById('job-salary').value = job.salary || '';
    document.getElementById('job-desc').value = job.job_description || '';
    document.getElementById('job-req').value = job.requirements || '';
    document.getElementById('job-time').value = job.work_schedule || '';
    document.getElementById('job-other').value = job.benefits || '';
    document.getElementById('job-status').value = job.status || '開啟';
  } else {
    // ➕【新增模式】：把所有格子清空
    document.getElementById('job-modal-title').innerText = '新增職缺';
    document.getElementById('job-id').value = ''; 
    document.getElementById('job-dept').value = '';
    document.getElementById('job-title').value = '';
    document.getElementById('job-count').value = '';
    document.getElementById('job-salary').value = '';
    document.getElementById('job-desc').value = '';
    document.getElementById('job-req').value = '';
    document.getElementById('job-time').value = '';
    document.getElementById('job-other').value = '';
    document.getElementById('job-status').value = '開啟';
  }
}

function closeJobModal() {
  const overlay = document.getElementById('job-modal-overlay');
  if (overlay) overlay.style.display = 'none';
}

// 🌟 從後端讀取並顯示在畫面上 (完全沒有 HTML 字串)
async function fetchJobs() {
  const listBody = document.getElementById('job-list-body');
  const template = document.getElementById('job-template');
  if (!listBody || !template) return;

  try {
    const response = await fetch('/api/company/jobs');
    const result = await response.json();

    if (result.success) {
      listBody.innerHTML = ''; 

      result.data.forEach(job => {
        const clone = template.content.cloneNode(true);
        clone.querySelector('.js-dept').textContent = job.department || '未指定';
        clone.querySelector('.js-title').textContent = job.job_title || '未指定';
        
        const countBadge = clone.querySelector('.js-count');
        countBadge.textContent = job.headcount || 1; 
        countBadge.addEventListener('click', () => {
            openApplicantListModal(job.job_id); 
        });

        // 🎯 新增：綁定編輯按鈕，把「整筆工作資料」傳給彈窗
        const editBtn = clone.querySelector('.js-edit-btn');
        if(editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openJobModal(job); // 傳入 job 物件
            });
        }

        const deleteBtn = clone.querySelector('.js-delete-btn');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteJob(job.job_id); 
        });

        listBody.appendChild(clone);
      });
    }
  } catch (err) {
    console.error("抓取職缺列表失敗:", err);
  }
}

// 🌟 儲存新職缺
// 💰 薪水自動格式化工具（自動加上 $ 符號與千分位逗號）
function formatSalaryText(text) {
  if (!text) return '面議';
  if (text.includes('面議')) return text; // 如果原本就輸入面議，保持原樣

  // 1. 先清除使用者不小心重複輸入的 $ 或 , 符號，還原成純數字
  let cleanText = text.replace(/\$/g, '').replace(/,/g, '');
  
  // 2. 讓中間的減號或波浪號前後自動加上空格，確保排版美觀
  cleanText = cleanText.replace(/\s*[-~]\s*/g, ' - ');
  
  // 3. 找出裡面的所有數字，自動轉換成 $XX,XXX 的格式
  return cleanText.replace(/\d+/g, (match) => {
    return '$' + parseInt(match, 10).toLocaleString('en-US');
  });
}

// 🌟 完整的職缺儲存邏輯
async function saveJob() {
  const jobId = document.getElementById('job-id').value; // 抓取隱藏的 ID
  
  const jobData = {
    department: document.getElementById('job-dept').value,
    job_title: document.getElementById('job-title').value,
    headcount: parseInt(document.getElementById('job-count').value) || 1,
    
    // 🎯 關鍵修改點：在存進資料庫前，先把薪水欄位丟進格式化工具處理
    salary: formatSalaryText(document.getElementById('job-salary').value),
    
    job_description: document.getElementById('job-desc').value,
    requirements: document.getElementById('job-req').value,
    work_schedule: document.getElementById('job-time').value,
    benefits: document.getElementById('job-other').value,
    status: document.getElementById('job-status').value
  };

  if (!jobData.job_title) return alert("職缺名稱不能為空！");

  try {
    let response;
    
    // 🎯 判斷邏輯：如果有 ID 代表是舊資料要更新，沒有 ID 代表是新資料要新增
    if (jobId) {
      // ✏️ 編輯模式 (PUT)
      response = await fetch(`/api/company/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
    } else {
      // ➕ 新增模式 (POST)
      response = await fetch('/api/company/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
    }

    const result = await response.json();

    if (result.success) {
      alert(result.message); 
      closeJobModal();
      await fetchJobs(); // 瞬間刷新畫面！
    } else {
      alert("儲存失敗：" + result.error);
    }
  } catch (err) {
    console.error("連線後端錯誤：", err);
    alert("連線到伺服器失敗，請檢查後端是否啟動。");
  }
}

// 🌟 真實呼叫後端 API 刪除職缺
async function deleteJob(jobId) {
  if (!jobId) return alert("❌ 找不到職缺 ID，無法刪除！");

  if (confirm("確定要刪除這個職缺嗎？刪除後無法復原喔！")) {
    try {
      const response = await fetch(`/api/company/jobs/${jobId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`伺服器尚未準備好 (狀態碼: ${response.status})`);
      }

      const result = await response.json();

      if (result.success) {
        alert(result.message);
        await fetchJobs(); // 🎯 刪除成功後，瞬間刷新畫面！
      } else {
        alert("刪除失敗：" + result.error);
      }
    } catch (err) {
      console.error("連線後端錯誤：", err);
      alert("無法連線到刪除功能！請確認伺服器有重新啟動。\n錯誤訊息：" + err.message);
    }
  }
}


// ================= 3. 公司資訊管理邏輯 (0profile.html) =================

async function loadCompanyProfile() {
  try {
    const response = await fetch('/api/company/profile');
    const result = await response.json();
    if (result.success && result.data) {
      const data = result.data;
      document.getElementById('profile-name').value = data.company_name || '';
      document.getElementById('profile-industry').value = data.industry || '';
      document.getElementById('profile-email').value = data.contact_email || '';
      document.getElementById('profile-info').value = data.company_info || '';
    }
  } catch (err) {
    console.error("讀取公司資訊失敗:", err);
  }
}

async function saveCompanyProfile() {
  const profileData = {
    company_name: document.getElementById('profile-name').value,
    industry: document.getElementById('profile-industry').value,
    contact_email: document.getElementById('profile-email').value,
    company_info: document.getElementById('profile-info').value
  };

  if (!profileData.company_name) return alert("公司名稱不能為空！");

  try {
    const response = await fetch('/api/company/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData)
    });
    const result = await response.json();
    if (result.success) alert(result.message);
  } catch (err) {
    console.error("更新公司資訊失敗:", err);
  }
}


// ================= 4. 應徵者狀態清單彈窗與管理預留區 =================

function openApplicantListModal(jobId) {
  // 這裡未來如果也要做到完全無 HTML，可以比照職缺列表新增 template
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeApplicantListModal() {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'none';
}

function openApplicantDetailModal(id, name) {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function closeApplicantDetailModal() {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}

function changeStatusColor(selectElement) {
  selectElement.classList.remove('status-1', 'status-2', 'status-3', 'status-4', 'status-5');
  selectElement.classList.add(selectElement.value);
}

// ================= 5. 頁面載入自動初始化偵測 =================

window.addEventListener('DOMContentLoaded', () => {
  // 自動載入頂部欄與側邊欄組件
  loadCompanyComponents();
  
  // 偵測：如果人在 0job.html 頁面，自動加載數據列表
  if (document.getElementById('job-list-container')) {
    fetchJobs();
  }
  
  // 偵測：如果人在 0profile.html 頁面，自動撈取公司資訊
  if (document.getElementById('profile-name')) {
    loadCompanyProfile();
  }
});

// 預留企業端帳號登入接口
async function handleCompanyLogin() {
  console.log("企業端登入處理中...");
}
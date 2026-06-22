// 📁 檔案位置：public/js/0company.js
// 🌟 完整企業端邏輯整合版 (包含職缺、求職者、公司資訊管理)

// ================= 1. 共用工具與導覽列 =================
window.formatSalaryText = function (text) {
  if (!text) return '面議';
  if (text.includes('面議')) return text;
  let cleanText = text.replace(/\$/g, '').replace(/,/g, '');
  cleanText = cleanText.replace(/\s*[-~]\s*/g, ' - ');
  return cleanText.replace(/\d+/g, (match) => {
    return '$' + parseInt(match, 10).toLocaleString('en-US');
  });
};

window.loadCompanyComponents = async function () {
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
};

window.toggleMenu = function () {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
};

window.navTo = function (sectionId, title) {
  document.querySelectorAll('.section-container').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(sectionId);
  if (target) target.classList.add('active');

  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.innerText = title;

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
};


// ================= 2. 職缺管理 (0job.html) =================
window.openJobModal = function (job = null) {
  // 1. 切換畫面：隱藏列表區塊，顯示表單區塊
  const listSection = document.getElementById('job-list-section');
  const formSection = document.getElementById('job-form-section');

  if (listSection) listSection.style.display = 'none';
  if (formSection) formSection.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' }); // 自動滾動到最上方

  // 2. 帶入資料或清空欄位
  if (job && job.job_id) {
    document.getElementById('job-page-title').innerText = '編輯職缺';
    document.getElementById('job-id').value = job.job_id;
    document.getElementById('job-dept').value = job.department || '';
    document.getElementById('job-title').value = job.job_title || '';
    document.getElementById('job-count').value = job.headcount || 1;
    document.getElementById('job-salary').value = job.salary || '';
    document.getElementById('job-desc').value = job.job_description || '';
    document.getElementById('job-req').value = job.requirements || '';
    document.getElementById('job-status').value = job.status || '開啟';

    // 🔽 新增的進階欄位 (請確認您的資料庫欄位名稱，這裡先假設名稱)
    document.getElementById('job-type').value = job.job_type || '全職';
    document.getElementById('job-address').value = job.address || '';
    document.getElementById('job-manage').value = job.manage_resp || '不需負擔管理責任';
    document.getElementById('job-travel').value = job.travel_req || '無需出差外派';
    document.getElementById('job-leave').value = job.leave_system || '依公司規定';
    document.getElementById('job-startdate').value = job.start_date || '不限';
    document.getElementById('job-edu').value = job.edu_req || '不拘';

    // 🔽 處理「上班時段」拆解 (將 "日班 (09:00~18:00)" 拆回班別與時間)
    let shiftVal = '日班';
    let rangeVal = '';
    if (job.work_schedule) {
      if (job.work_schedule.includes('(')) {
        const parts = job.work_schedule.split('(');
        shiftVal = parts[0].trim();
        rangeVal = parts[1].replace(')', '').trim();
      } else {
        shiftVal = job.work_schedule.trim();
      }
    }
    document.getElementById('job-time-shift').value = shiftVal;
    document.getElementById('job-time-range').value = rangeVal;

    // 🔽 處理「福利標籤」與「自訂說明文字」
    document.querySelectorAll('.welfare-cb').forEach(cb => cb.checked = false); // 先清空所有打勾
    if (job.benefits) {
      // 若資料庫內的字串包含該標籤，就將 checkbox 設為打勾
      document.querySelectorAll('.welfare-cb').forEach(cb => {
        if (job.benefits.includes(cb.value)) {
          cb.checked = true;
        }
      });
      // 將【其他說明】底下的文字抽出來，放回自訂的 textarea
      let customText = job.benefits;
      if (customText.includes('【其他說明】')) {
        customText = customText.split('【其他說明】')[1].trim();
      } else if (customText.includes('【法定與常見福利】')) {
        customText = ''; // 如果只有勾選標籤，沒有填寫自訂文字，就留空
      }
      document.getElementById('job-other').value = customText;
    } else {
      document.getElementById('job-other').value = '';
    }

  } else {
    // ===== 新增職缺：清空並還原所有欄位預設值 =====
    document.getElementById('job-page-title').innerText = '新增職缺';
    document.getElementById('job-id').value = '';
    document.getElementById('job-dept').value = '';
    document.getElementById('job-title').value = '';
    document.getElementById('job-count').value = '';
    document.getElementById('job-salary').value = '';
    document.getElementById('job-desc').value = '';
    document.getElementById('job-req').value = '';
    document.getElementById('job-status').value = '開啟';

    // 清空或重置進階欄位
    document.getElementById('job-type').value = '全職';
    document.getElementById('job-address').value = '';
    document.getElementById('job-manage').value = '不需負擔管理責任';
    document.getElementById('job-travel').value = '無需出差外派';
    document.getElementById('job-leave').value = '依公司規定';
    document.getElementById('job-startdate').value = '不限';
    document.getElementById('job-edu').value = '不拘';

    // 清空時間與班別
    document.getElementById('job-time-shift').value = '日班';
    document.getElementById('job-time-range').value = '';

    // 清空福利標籤與其他說明
    document.querySelectorAll('.welfare-cb').forEach(cb => cb.checked = false);
    document.getElementById('job-other').value = '';
  }
};

// 新增這段：關閉表單並返回列表
window.closeJobForm = function () {
  const listSection = document.getElementById('job-list-section');
  const formSection = document.getElementById('job-form-section');

  if (formSection) formSection.style.display = 'none';
  if (listSection) listSection.style.display = 'flex'; // 恢復彈性盒子排版
};

window.fetchJobs = async function () {
  const listBody = document.getElementById('job-list-body');
  const template = document.getElementById('job-template');
  if (!listBody || !template) return;

  try {
    const response = await fetch('/api/company/jobs');
    const result = await response.json();

    if (result.success) {
      listBody.replaceChildren(); // 乾淨清空畫面

      result.data.forEach(job => {
        const clone = template.content.cloneNode(true);
        clone.querySelector('.js-dept').textContent = job.department || '未指定';
        clone.querySelector('.js-title').textContent = job.job_title || '未指定';

        const countBadge = clone.querySelector('.js-count');
        countBadge.textContent = job.headcount || 1;
        countBadge.addEventListener('click', () => {
          window.openApplicantListModal(job.job_id);
        });

        const editBtn = clone.querySelector('.js-edit-btn');
        if (editBtn) {
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.openJobModal(job);
          });
        }

        const deleteBtn = clone.querySelector('.js-delete-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.deleteJob(job.job_id);
          });
        }

        listBody.appendChild(clone);
      });
    }
  } catch (err) {
    console.error("抓取職缺列表失敗:", err);
  }
};

window.saveJob = async function () {
  const jobId = document.getElementById('job-id').value;

  // 💡 1. 班別跟時間組合
  // 1. 分別抓取「班別下拉選單」和「時間輸入框」
  const shift = getVal('job-time-shift');
  const timeRange = getVal('job-time-range');
  // 2. 如果有填時間，就組合成 "日班 (09:00~18:00)"；沒填就只送出 "日班"
  const combinedTime = timeRange ? `${shift} (${timeRange})` : shift;

  // 📍 【處理福利制度】
  // 1. 蒐集所有被打勾的福利標籤
  const checkedWelfareBoxes = document.querySelectorAll('.welfare-cb:checked');
  const welfareTags = Array.from(checkedWelfareBoxes).map(cb => cb.value);

  // 2. 抓取文字框的自訂說明
  const customWelfare = getVal('job-other').trim();

  // 3. 把它們像疊積木一樣組合成一大段包含換行的字串
  let finalBenefits = '';
  if (welfareTags.length > 0) {
    finalBenefits += `【法定與常見福利】${welfareTags.join('、')}\n`;
  }
  if (customWelfare) {
    finalBenefits += `【其他說明】\n${customWelfare}`;
  }

  // 💡 4. 取得當下時間的 ISO 字串 (給最後更新時間用)
  const currentTime = new Date().toISOString();

  const jobData = {
    department: document.getElementById('job-dept').value,
    job_title: document.getElementById('job-title').value,
    headcount: parseInt(document.getElementById('job-count').value) || 1,
    salary: window.formatSalaryText(document.getElementById('job-salary').value),
    job_description: document.getElementById('job-desc').value,
    requirements: document.getElementById('job-req').value,
    work_schedule: combinedTime,
    benefits: finalBenefits,
    benefits: document.getElementById('job-other').value,
    status: document.getElementById('job-status').value,

    job_type: document.getElementById('job-type').value,
    address: document.getElementById('job-address').value,
    manage_resp: document.getElementById('job-manage').value,
    travel_req: document.getElementById('job-travel').value,
    leave_system: document.getElementById('job-leave').value,
    start_date: document.getElementById('job-startdate').value,
    updated_at: currentTime
  };

  if (!jobData.job_title) return alert("職缺名稱不能為空！");

  try {
    let response;
    if (jobId) {
      response = await fetch(`/api/company/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
    } else {
      response = await fetch('/api/company/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobData)
      });
    }

    const result = await response.json();
    if (result.success) {
      alert(result.message);
      window.closeJobModal();
      await window.fetchJobs(); // 瞬間刷新職缺列表
    } else {
      alert("儲存失敗：" + result.error);
    }
  } catch (err) {
    console.error("連線錯誤：", err);
    alert("連線伺服器失敗。");
  }
};

window.deleteJob = async function (jobId) {
  if (!jobId) return;
  if (confirm("確定要刪除這個職缺嗎？刪除後無法復原喔！")) {
    try {
      const response = await fetch(`/api/company/jobs/${jobId}`, { method: 'DELETE' });
      const result = await response.json();
      if (result.success) {
        alert(result.message);
        await window.fetchJobs();
      } else {
        alert("刪除失敗：" + result.error);
      }
    } catch (err) {
      console.error("連線錯誤：", err);
    }
  }
};

window.openApplicantListModal = function (jobId) {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'flex';
};

window.closeApplicantListModal = function () {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'none';
};


// ================= 3. 公司資訊管理 (0profile.html) =================
window.loadCompanyProfile = async function () {
  try {
    const response = await fetch('/api/company/profile');
    const result = await response.json();
    if (result.success && result.data) {
      document.getElementById('profile-name').value = result.data.company_name || '';
      document.getElementById('profile-industry').value = result.data.industry || '';
      document.getElementById('profile-email').value = result.data.contact_email || '';
      document.getElementById('profile-info').value = result.data.company_info || '';
    }
  } catch (err) { console.error("讀取失敗:", err); }
};

window.saveCompanyProfile = async function () {
  // 取得當下時間
  const currentTime = new Date().toISOString();

  const profileData = {
    company_name: document.getElementById('profile-name').value,
    industry: document.getElementById('profile-industry').value,
    contact_email: document.getElementById('profile-email').value,
    company_info: document.getElementById('profile-info').value,
    updated_at: currentTime // 🌟 順手幫公司資訊也加上最後更新時間
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
  } catch (err) { console.error("更新失敗:", err); }
};

// ================= 4. 求職者管理 (0applicant.html) =================
// 全域存儲：應徵者資料映射 (sessionId -> 應徵者完整資料)
window.applicantDataMap = {};

window.openApplicantDetailModal = async function (sessionId) {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (!overlay) return;

  overlay.style.display = 'flex';

  // 載入履歷信息
  const resumeContainer = document.getElementById('detail-resume-content');
  if (resumeContainer) {
    resumeContainer.innerHTML = '<p>載入履歷中...</p>';

    try {
      // 1. 從全域映射取得應徵者的基本信息
      const applicantData = window.applicantDataMap[sessionId];

      // 2. 從後端資料庫取得詳細的履歷信息
      const response = await fetch(`/api/resume?session_id=${sessionId}`);
      if (!response.ok) throw new Error('無法取得履歷資訊');

      const resumeData = await response.json();

      // 構建履歷 HTML - 優先使用應徵者列表中的真實數據
      let resumeHtml = `<p><strong>姓名：</strong>${applicantData?.name || resumeData.name || '未知'}</p>`;
      resumeHtml += `<p><strong>應徵職位：</strong>${applicantData?.job_title || resumeData.apply_role || '未指定'}</p>`;
      resumeHtml += `<p><strong>部門：</strong>${applicantData?.department || '未指定'}</p>`;
      resumeHtml += `<p><strong>學歷：</strong>${resumeData.education || '未提供'}</p>`;
      resumeHtml += `<p><strong>面試日期：</strong>${resumeData.interview_date || '--'}</p>`;

      resumeContainer.innerHTML = resumeHtml;
    } catch (error) {
      console.error('履歷載入失敗:', error);
      resumeContainer.innerHTML = '<p style="color:red;">履歷載入失敗，請稍後重試</p>';
    }
  }

  // 加載面試報告
  const iframe = document.getElementById('hr-report-iframe');
  const btn = document.getElementById('hr-report-btn');
  const noMsg = document.getElementById('no-report-msg');

  if (sessionId) {
    // 1. 如果有面試紀錄，就把 hr_report.html 網址塞進去
    const reportUrl = `../hr_report.html?session_id=${sessionId}`;

    iframe.src = reportUrl;
    iframe.style.display = 'block'; // 顯示內嵌視窗

    btn.style.display = 'inline-block'; // 顯示新開視窗按鈕
    btn.onclick = (e) => {
      e.preventDefault();
      window.open(reportUrl, '_blank');
    };

    noMsg.style.display = 'none'; // 隱藏「沒有報告」的文字
  } else {
    // 2. 如果他還沒面試
    iframe.style.display = 'none';
    btn.style.display = 'none';
    noMsg.style.display = 'block';
  }
};

window.closeApplicantDetailModal = function () {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.changeStatusColor = function (selectElement) {
  // 把所有可能的顏色標籤包含 status-empty 都清掉
  selectElement.classList.remove('status-1', 'status-2', 'status-3', 'status-4', 'status-5', 'status-empty');

  // 重新套用顏色
  if (selectElement.value === '') {
    selectElement.classList.add('status-empty');
  } else {
    selectElement.classList.add(selectElement.value);
  }
};

window.fetchApplicants = async function () {
  try {
    const response = await fetch('/api/company/applicants');
    const result = await response.json();
    if (result.success) {
      window.renderGroupedApplicants(result.data);
    } else {
      const container = document.getElementById('grouped-applicant-list');
      if (container) container.textContent = '載入失敗，請稍後再試。';
    }
  } catch (error) { console.error('連線錯誤:', error); }
};

window.renderGroupedApplicants = function (data) {
  const container = document.getElementById('grouped-applicant-list');
  if (!container) return;

  container.replaceChildren();

  if (data.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'loading-text';
    emptyDiv.textContent = '目前尚無應徵者紀錄。';
    container.appendChild(emptyDiv);
    return;
  }

  const groupedData = data.reduce((acc, curr) => {
    const dept = curr.department;
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(curr);
    return acc;
  }, {});

  const template = document.getElementById('applicant-row-template');

  for (const [deptName, applicants] of Object.entries(groupedData)) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'dept-group';

    const title = document.createElement('div');
    title.className = 'dept-title';
    title.textContent = deptName;
    groupDiv.appendChild(title);

    const listContainer = document.createElement('div');
    listContainer.className = 'dept-list-container';

    applicants.forEach(app => {
      const clone = template.content.cloneNode(true);

      // 將應徵者資料存儲到全域映射，以便 Modal 打開時使用
      window.applicantDataMap[app.session_id] = app;

      const nameText = app.name || '未知';
      clone.querySelector('.applicant-avatar').textContent = nameText.charAt(0); // 抓名字第一個字塞進大頭貼
      clone.querySelector('.applicant-name').textContent = nameText;
      clone.querySelector('.applicant-job').textContent = `應徵職缺：${app.job_title}`;

      const selectStatus = clone.querySelector('.status-select');
      selectStatus.dataset.id = app.session_id;

      // 🌟 1. 防呆機制：先抓出 HTML 裡所有合法的 value ('status-1' ~ 'status-5')
      const validValues = Array.from(selectStatus.options).map(opt => opt.value);
      // 🌟 2. 判斷資料：如果資料庫回傳的狀態是 null, 字串的 "null", 或不在合法清單內
      // 統一強制轉成空字串 ''，這樣才能精準對應到我們新增的預設選項
      let currentStatus = app.status;
      if (!validValues.includes(currentStatus)) {
        currentStatus = '';
      }
      // 3. 檢查有沒有 value="" 的選項，沒有就生一個
      let defaultOption = selectStatus.querySelector('option[value=""]');
      if (!defaultOption) {
        defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '尚未點選狀態';
        // 🚨 這裡絕對不加 disabled，避免某些瀏覽器把字吃掉
        selectStatus.insertBefore(defaultOption, selectStatus.firstChild);
      }
      // 4. 正式設定顯示的值
      selectStatus.value = currentStatus;
      // 5. 更新對應的顏色 CSS
      selectStatus.className = 'status-select';
      if (currentStatus === '') {
        selectStatus.classList.add('status-empty');
      } else {
        selectStatus.classList.add(currentStatus);
      }

      const btnReport = clone.querySelector('.btn-report');
      btnReport.dataset.id = app.session_id;
      if (!app.hasReport) {
        btnReport.disabled = true;
        btnReport.title = '面試尚未完成，無報告';
      }

      listContainer.appendChild(clone);
    });

    groupDiv.appendChild(listContainer);
    container.appendChild(groupDiv);
  }
};

window.updateApplicantStatus = async function (sessionId, newStatus) {
  try {
    const response = await fetch(`/api/company/applicants/${sessionId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const result = await response.json();
    if (!result.success) alert('狀態更新失敗');
  } catch (error) { console.error('更新錯誤:', error); }
};


// ================= 5. 系統啟動 =================
window.addEventListener('DOMContentLoaded', () => {
  window.loadCompanyComponents();

  // 📍 偵測：如果人在「職缺管理頁」
  if (document.getElementById('job-list-container')) {
    window.fetchJobs();
  }

  // 📍 偵測：如果人在「公司資訊頁」
  if (document.getElementById('profile-name')) {
    window.loadCompanyProfile();
  }

  // 📍 偵測：如果人在「求職者管理頁」
  const applicantListContainer = document.getElementById('grouped-applicant-list');
  if (applicantListContainer) {
    window.fetchApplicants();

    // 事件委派：狀態下拉選單
    applicantListContainer.addEventListener('change', (e) => {
      if (e.target.classList.contains('status-select')) {
        const sessionId = e.target.dataset.id;
        window.changeStatusColor(e.target);
        window.updateApplicantStatus(sessionId, e.target.value);
      }
    });

    // 事件委派：查看報告按鈕
    applicantListContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-report')) {
        const sessionId = e.target.dataset.id;
        window.openApplicantDetailModal(sessionId);
      }
    });
  }

  // 求職者管理的 Modal 關閉綁定
  const btnCloseApplicantModal = document.getElementById('btn-close-applicant-modal');
  if (btnCloseApplicantModal) {
    btnCloseApplicantModal.addEventListener('click', window.closeApplicantDetailModal);
  }
});
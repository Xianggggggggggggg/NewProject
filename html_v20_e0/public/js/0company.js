// 📁 檔案位置：public/js/0company.js
// 🌟 完整企業端邏輯整合版 (包含職缺、求職者、公司資訊管理)

// ================= 1. 共用工具與導覽列 =================
window.formatSalaryText = function(text) {
  if (!text) return '面議';
  if (text.includes('面議')) return text;
  let cleanText = text.replace(/\$/g, '').replace(/,/g, '');
  cleanText = cleanText.replace(/\s*[-~]\s*/g, ' - ');
  return cleanText.replace(/\d+/g, (match) => {
    return '$' + parseInt(match, 10).toLocaleString('en-US');
  });
};

window.loadCompanyComponents = async function() {
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

window.toggleMenu = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('active');
};

window.navTo = function(sectionId, title) {
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
window.openJobModal = function(job = null) {
  const overlay = document.getElementById('job-modal-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  if (job && job.job_id) {
    document.getElementById('job-modal-title').innerText = '編輯職缺';
    document.getElementById('job-id').value = job.job_id;
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
};

window.closeJobModal = function() {
  const overlay = document.getElementById('job-modal-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.fetchJobs = async function() {
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

window.saveJob = async function() {
  const jobId = document.getElementById('job-id').value;
  const jobData = {
    department: document.getElementById('job-dept').value,
    job_title: document.getElementById('job-title').value,
    headcount: parseInt(document.getElementById('job-count').value) || 1,
    salary: window.formatSalaryText(document.getElementById('job-salary').value),
    job_description: document.getElementById('job-desc').value,
    requirements: document.getElementById('job-req').value,
    work_schedule: document.getElementById('job-time').value,
    benefits: document.getElementById('job-other').value,
    status: document.getElementById('job-status').value
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

window.deleteJob = async function(jobId) {
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

window.openApplicantListModal = function(jobId) {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'flex';
};

window.closeApplicantListModal = function() {
  const overlay = document.getElementById('applicant-list-overlay');
  if (overlay) overlay.style.display = 'none';
};


// ================= 3. 公司資訊管理 (0profile.html) =================
window.loadCompanyProfile = async function() {
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

window.saveCompanyProfile = async function() {
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
  } catch (err) { console.error("更新失敗:", err); }
};


// ================= 4. 求職者管理 (0applicant.html) =================
window.closeApplicantDetailModal = function() {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.changeStatusColor = function(selectElement) {
  selectElement.classList.remove('status-1', 'status-2', 'status-3', 'status-4', 'status-5');
  selectElement.classList.add(selectElement.value);
};

window.fetchApplicants = async function() {
  try {
    const response = await fetch('/api/company/applicants');
    const result = await response.json();
    if (result.success) {
      window.renderGroupedApplicants(result.data);
    } else {
      const container = document.getElementById('grouped-applicant-list');
      if(container) container.textContent = '載入失敗，請稍後再試。';
    }
  } catch (error) { console.error('連線錯誤:', error); }
};

window.renderGroupedApplicants = function(data) {
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

      clone.querySelector('.applicant-name').textContent = app.name;
      clone.querySelector('.applicant-job').textContent = `應徵職缺：${app.job_title}`;

      const selectStatus = clone.querySelector('.status-select');
      selectStatus.dataset.id = app.session_id;
      selectStatus.value = app.status;
      selectStatus.classList.add(app.status);

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

window.updateApplicantStatus = async function(sessionId, newStatus) {
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
        window.location.href = `../result.html?session_id=${sessionId}`;
      }
    });
  }

  // 求職者管理的 Modal 關閉綁定
  const btnCloseApplicantModal = document.getElementById('btn-close-applicant-modal');
  if (btnCloseApplicantModal) {
    btnCloseApplicantModal.addEventListener('click', window.closeApplicantDetailModal);
  }
});
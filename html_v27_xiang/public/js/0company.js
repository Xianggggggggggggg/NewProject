// 📁 檔案位置：public/js/0company.js
// 🌟 完整企業端邏輯整合版 (包含職缺、求職者、公司資訊管理、HR 訊息中心)

// ================= 0. 自訂工具 =================
window.getVal = function (id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
};

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
  const listSection = document.getElementById('job-list-section');
  const formSection = document.getElementById('job-form-section');

  if (listSection) listSection.style.display = 'none';
  if (formSection) formSection.style.display = 'block';

  window.scrollTo({ top: 0, behavior: 'smooth' }); 

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

    document.getElementById('job-type').value = job.job_type || '全職';
    document.getElementById('job-address').value = job.address || '';
    document.getElementById('job-manage').value = job.manage_resp || '不需負擔管理責任';
    document.getElementById('job-travel').value = job.travel_req || '無需出差外派';
    document.getElementById('job-leave').value = job.leave_system || '依公司規定';
    document.getElementById('job-startdate').value = job.start_date || '不限';
    document.getElementById('job-edu').value = job.edu_req || '不拘';

    document.getElementById('job-exp').value = job.exp_req || '';
    document.getElementById('job-major').value = job.major_req || '';
    document.getElementById('job-lang').value = job.lang_req || '';
    document.getElementById('job-tools').value = job.tools_req || '';
    document.getElementById('job-skills').value = job.skills_req || '';

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

    document.querySelectorAll('.welfare-cb').forEach(cb => cb.checked = false); 
    if (job.benefits) {
      document.querySelectorAll('.welfare-cb').forEach(cb => {
        if (job.benefits.includes(cb.value)) cb.checked = true;
      });
      let customText = job.benefits;
      if (customText.includes('【其他說明】')) {
        customText = customText.split('【其他說明】')[1].trim();
      } else if (customText.includes('【法定與常見福利】')) {
        customText = ''; 
      }
      document.getElementById('job-other').value = customText;
    } else {
      document.getElementById('job-other').value = '';
    }

  } else {
    document.getElementById('job-page-title').innerText = '新增職缺';
    document.getElementById('job-id').value = '';
    document.getElementById('job-dept').value = '';
    document.getElementById('job-title').value = '';
    document.getElementById('job-count').value = '';
    document.getElementById('job-salary').value = '';
    document.getElementById('job-desc').value = '';
    document.getElementById('job-req').value = '';
    document.getElementById('job-status').value = '開啟';

    document.getElementById('job-exp').value = '';
    document.getElementById('job-major').value = '';
    document.getElementById('job-lang').value = '';
    document.getElementById('job-tools').value = '';
    document.getElementById('job-skills').value = '';

    document.getElementById('job-type').value = '全職';
    document.getElementById('job-address').value = '';
    document.getElementById('job-manage').value = '不需負擔管理責任';
    document.getElementById('job-travel').value = '無需出差外派';
    document.getElementById('job-leave').value = '依公司規定';
    document.getElementById('job-startdate').value = '不限';
    document.getElementById('job-edu').value = '不拘';

    document.getElementById('job-time-shift').value = '日班';
    document.getElementById('job-time-range').value = '';

    document.querySelectorAll('.welfare-cb').forEach(cb => cb.checked = false);
    document.getElementById('job-other').value = '';
  }
};

window.closeJobForm = function () {
  const listSection = document.getElementById('job-list-section');
  const formSection = document.getElementById('job-form-section');

  if (formSection) formSection.style.display = 'none';
  if (listSection) listSection.style.display = 'flex'; 
};

window.fetchJobs = async function () {
  const listBody = document.getElementById('job-list-body');
  const template = document.getElementById('job-template');
  if (!listBody || !template) return;

  try {
    const response = await fetch('/api/company/jobs');
    const result = await response.json();

    if (result.success) {
      listBody.replaceChildren(); 

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

  const shift = window.getVal('job-time-shift');
  const timeRange = window.getVal('job-time-range');
  const combinedTime = timeRange ? `${shift} (${timeRange})` : shift;

  const checkedWelfareBoxes = document.querySelectorAll('.welfare-cb:checked');
  const welfareTags = Array.from(checkedWelfareBoxes).map(cb => cb.value);
  const customWelfare = window.getVal('job-other').trim();

  let finalBenefits = '';
  if (welfareTags.length > 0) {
    finalBenefits += `【法定與常見福利】${welfareTags.join('、')}\n`;
  }
  if (customWelfare) {
    finalBenefits += `【其他說明】\n${customWelfare}`;
  }

  const currentTime = new Date().toISOString();

  const jobData = {
    department: document.getElementById('job-dept').value,
    job_title: document.getElementById('job-title').value,
    headcount: parseInt(document.getElementById('job-count').value) || 1,
    salary: window.formatSalaryText(document.getElementById('job-salary').value),
    job_description: document.getElementById('job-desc').value,
    status: document.getElementById('job-status').value,

    requirements: window.getVal('job-req').trim(),
    exp_req: window.getVal('job-exp').trim(),
    major_req: window.getVal('job-major').trim(),
    lang_req: window.getVal('job-lang').trim(),
    tools_req: window.getVal('job-tools').trim(),
    skills_req: window.getVal('job-skills').trim(),

    work_schedule: combinedTime,
    benefits: finalBenefits, 

    job_type: document.getElementById('job-type').value,
    address: document.getElementById('job-address').value,
    manage_resp: document.getElementById('job-manage').value,
    travel_req: document.getElementById('job-travel').value,
    leave_system: document.getElementById('job-leave').value,
    start_date: document.getElementById('job-startdate').value,
    edu_req: document.getElementById('job-edu').value,
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
      window.closeJobForm(); 
      await window.fetchJobs(); 
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
  const currentTime = new Date().toISOString();
  const profileData = {
    company_name: document.getElementById('profile-name').value,
    industry: document.getElementById('profile-industry').value,
    contact_email: document.getElementById('profile-email').value,
    company_info: document.getElementById('profile-info').value,
    updated_at: currentTime 
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
window.applicantDataMap = {};

window.openApplicantDetailModal = async function (sessionId) {
  const overlay = document.getElementById('applicant-detail-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  const resumeContainer = document.getElementById('detail-resume-content');
  if (resumeContainer) {
    resumeContainer.innerHTML = '<p>載入履歷中...</p>';
    try {
      const applicantData = window.applicantDataMap[sessionId];
      const response = await fetch(`/api/resume?session_id=${sessionId}`);
      if (!response.ok) throw new Error('無法取得履歷資訊');
      const resumeData = await response.json();

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

  const iframe = document.getElementById('hr-report-iframe');
  const btn = document.getElementById('hr-report-btn');
  const noMsg = document.getElementById('no-report-msg');

  if (sessionId && iframe && btn && noMsg) {
    const reportUrl = `../hr_report.html?session_id=${sessionId}`;
    iframe.src = reportUrl;
    iframe.style.display = 'block'; 
    btn.style.display = 'inline-block'; 
    btn.onclick = (e) => {
      e.preventDefault();
      window.open(reportUrl, '_blank');
    };
    noMsg.style.display = 'none'; 
  } else if (iframe && btn && noMsg) {
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
  selectElement.classList.remove('status-1', 'status-2', 'status-3', 'status-4', 'status-5', 'status-empty');
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
      window.applicantDataMap[app.session_id] = app;

      const nameText = app.name || '未知';
      const avatar = clone.querySelector('.applicant-avatar');
      if(avatar) avatar.textContent = nameText.charAt(0); 
      
      clone.querySelector('.applicant-name').textContent = nameText;
      clone.querySelector('.applicant-job').textContent = `應徵職缺：${app.job_title}`;

      const selectStatus = clone.querySelector('.status-select');
      selectStatus.dataset.id = app.session_id;

      const validValues = Array.from(selectStatus.options).map(opt => opt.value);
      let currentStatus = app.status;
      if (!validValues.includes(currentStatus)) currentStatus = '';
      
      let defaultOption = selectStatus.querySelector('option[value=""]');
      if (!defaultOption) {
        defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '尚未點選狀態';
        selectStatus.insertBefore(defaultOption, selectStatus.firstChild);
      }
      
      selectStatus.value = currentStatus;
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

  if (document.getElementById('job-list-container')) {
    window.fetchJobs();
  }

  if (document.getElementById('profile-name')) {
    window.loadCompanyProfile();
  }

  const applicantListContainer = document.getElementById('grouped-applicant-list');
  if (applicantListContainer) {
    window.fetchApplicants();

    applicantListContainer.addEventListener('change', (e) => {
      if (e.target.classList.contains('status-select')) {
        const sessionId = e.target.dataset.id;
        window.changeStatusColor(e.target);
        window.updateApplicantStatus(sessionId, e.target.value);
      }
    });

    applicantListContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-report')) {
        const sessionId = e.target.dataset.id;
        window.openApplicantDetailModal(sessionId);
      }
    });
  }

  const btnCloseApplicantModal = document.getElementById('btn-close-applicant-modal');
  if (btnCloseApplicantModal) {
    btnCloseApplicantModal.addEventListener('click', window.closeApplicantDetailModal);
  }

  // 🌟 你的聊天室邏輯完整放在這裡 🌟
  const chatContactList = document.getElementById('hr-contact-list');
  if (chatContactList) {
    let currentChatApplicantId = null;

    // 1. 載入左側聯絡人
    async function loadContacts() {
      try {
        const res = await fetch('/api/company/chat/contacts');
        const result = await res.json();
        if (result.success && result.data.length > 0) {
          chatContactList.innerHTML = ''; 
          result.data.forEach(user => {
            const div = document.createElement('div');
            // 簡單的聯絡人樣式
            div.style.padding = '15px';
            div.style.borderBottom = '1px solid #eee';
            div.style.cursor = 'pointer';
            div.style.fontWeight = 'bold';
            div.textContent = `👤 ${user.name}`;
            
            // 點擊後打開該人員的聊天室
            div.onclick = () => {
              currentChatApplicantId = user.applicant_id;
              document.getElementById('hr-chat-title').textContent = `與 ${user.name} 對話中`;
              document.getElementById('hr-chat-input').disabled = false;
              document.getElementById('hr-chat-send').disabled = false;
              loadMessages();
            };
            chatContactList.appendChild(div);
          });
        } else {
          chatContactList.innerHTML = '<div class="empty-state">尚無聯絡人</div>';
        }
      } catch (e) { console.error('載入聯絡人失敗', e); }
    }

    // 2. 載入右側對話紀錄
    async function loadMessages() {
      if (!currentChatApplicantId) return;
      const messageBox = document.getElementById('hr-chat-messages');
      messageBox.innerHTML = '<div class="empty-state">載入訊息中...</div>';
      
      try {
        const res = await fetch(`/api/company/chat/${currentChatApplicantId}`);
        const result = await res.json();
        if (result.success) {
          messageBox.innerHTML = '';
          if (result.data.length === 0) {
            messageBox.innerHTML = '<div class="empty-state">尚無對話紀錄。</div>';
            return;
          }
          result.data.forEach(msg => {
            const msgDiv = document.createElement('div');
            const isCompany = msg.sender_role === 'company';
            
            // 判斷是公司傳的 (靠右, 綠色) 還是求職者傳的 (靠左, 灰色)
            msgDiv.style.textAlign = isCompany ? 'right' : 'left';
            msgDiv.style.margin = '10px 0';
            
            const bubble = document.createElement('span');
            bubble.textContent = msg.content;
            bubble.style.display = 'inline-block';
            bubble.style.padding = '10px 15px';
            bubble.style.borderRadius = '15px';
            bubble.style.backgroundColor = isCompany ? '#E8F5E9' : '#F5F5F5';
            bubble.style.color = isCompany ? '#2E7D32' : '#333';
            bubble.style.maxWidth = '70%';
            bubble.style.wordBreak = 'break-word';

            msgDiv.appendChild(bubble);
            messageBox.appendChild(msgDiv);
          });
          // 自動捲動到最新訊息
          messageBox.scrollTop = messageBox.scrollHeight;
        }
      } catch (e) { console.error('載入訊息失敗', e); }
    }

    // 3. HR 手動傳送訊息功能
    const sendBtn = document.getElementById('hr-chat-send');
    const inputField = document.getElementById('hr-chat-input');

    async function sendMessage() {
      const text = inputField.value.trim();
      if (!text || !currentChatApplicantId) return;

      inputField.value = ''; // 清空輸入框
      inputField.disabled = true;
      sendBtn.disabled = true;

      try {
        const res = await fetch(`/api/company/chat/${currentChatApplicantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text })
        });
        const result = await res.json();
        if (result.success) await loadMessages(); // 傳送成功後重新載入對話
      } catch (e) {
        console.error('傳送失敗', e);
      } finally {
        inputField.disabled = false;
        sendBtn.disabled = false;
        inputField.focus();
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage(); // 支援按 Enter 傳送
    });

    // 剛進網頁時，載入左側名單
    loadContacts();
  }
});
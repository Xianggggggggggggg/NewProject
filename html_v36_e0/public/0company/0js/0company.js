// 📁 檔案位置：public/js/0company.js
// 🌟 完整企業端邏輯整合版 (包含職缺、求職者、公司資訊管理、HR 訊息中心)

// ================= 0. 自訂工具 =================
window.getVal = function (id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
};

// 🌟 新增：關閉所有 Modal，避免多個彈窗疊在一起造成顯示錯亂
window.closeAllModals = function () {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.style.display = 'none';
  });
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
  window.closeAllModals();
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
  window.closeAllModals();
  const overlay = document.getElementById('applicant-detail-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  const resumeContainer = document.getElementById('detail-resume-content');
  if (resumeContainer) {
    resumeContainer.innerHTML = '<p>載入履歷中...</p>';
    try {
      const applicantData = window.applicantDataMap[sessionId] || {};

      const response = await fetch(`/api/resume?session_id=${sessionId}`);
      if (!response.ok) throw new Error('無法取得履歷資訊');

      const resumeData = await response.json();

      const applicantName = applicantData.name || resumeData.name || '未知應徵者';
      const titleEl = document.querySelector('.modal-main-title');
      if (titleEl) {
        titleEl.textContent = `${applicantName} - 詳細資料`;
      }

      resumeContainer.innerHTML = `
        <div class="preview-item">
          <div class="preview-label">最高學歷</div>
          <div class="preview-value">${resumeData.education || '未提供'}</div>
        </div>
        <div class="preview-item">
          <div class="preview-label">語言能力</div>
          <div class="preview-value">${resumeData.language_skills || '未提供'}</div>
        </div>
        <div class="preview-item">
          <div class="preview-label">工作經歷</div>
          <div class="preview-value">${resumeData.work_experience || '目前無相關經歷紀錄'}</div>
        </div>
        <div class="preview-item">
          <div class="preview-label">自傳</div>
          <div class="preview-value">${resumeData.autobiography || '未提供自傳'}</div>
        </div>
      `;
    } catch (error) {
      console.error('履歷載入失敗:', error);
      resumeContainer.innerHTML = '<p style="color:red; padding: 15px;">履歷載入失敗，請稍後重試</p>';
    }
  }

  const iframe = document.getElementById('hr-report-iframe');
  const btn = document.getElementById('hr-report-btn');
  const noMsg = document.getElementById('no-report-msg');

  if (sessionId && iframe && btn && noMsg) {
    const reportUrl = `../user/hr_report.html?session_id=${sessionId}`;
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

// 🚀 核心升級：全新雙重分組與折疊邏輯 (修復分數重複問題)
let globalGroupedData = {};

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

  globalGroupedData = {};
  data.forEach(app => {
    const job = app.job_title || '未指定職缺';
    const name = app.name || '未知應徵者';
    if (!globalGroupedData[job]) globalGroupedData[job] = {};
    if (!globalGroupedData[job][name]) globalGroupedData[job][name] = [];
    globalGroupedData[job][name].push(app);
  });

  const template = document.getElementById('applicant-row-template');

  for (const [jobTitle, persons] of Object.entries(globalGroupedData)) {
    const uniquePersonCount = Object.keys(persons).length;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'job-group-container';

    // 這裡加上了跟其他按鈕一樣的 btn-action UI
    groupDiv.innerHTML = `
      <div class="job-group-header">
        <div class="job-group-title">
          🎯 ${jobTitle}
          <span class="job-count-badge">共 ${uniquePersonCount} 人</span>
        </div>
        <div class="job-avg-section" style="display: flex; align-items: center; gap: 10px;">
          <span class="avg-score-display" id="avg-${jobTitle}" style="font-weight: bold; color: #e67e22; margin-right: 10px;"></span>
          <button class="btn-action btn-secondary" onclick="calculateJobAverage('${jobTitle}')" style="padding: 8px 15px; font-size: 14px; border-radius: 6px; white-space: nowrap; height: 38px; display: flex; align-items: center; justify-content: center;">
            🔄 重整平均合適度
          </button>
          <button class="btn-action btn-primary" onclick="generateComparisonReport('${jobTitle}')" style="padding: 8px 15px; font-size: 14px; border-radius: 6px; white-space: nowrap; height: 38px; display: flex; align-items: center; justify-content: center;">
            📊 產生/檢視職缺綜合對比大報告
          </button>
        </div>
      </div>
      <div class="job-group-body" id="body-${jobTitle}"></div>
    `;

    container.appendChild(groupDiv);
    const bodyContainer = groupDiv.querySelector(`#body-${jobTitle}`);

    for (const [personName, sessions] of Object.entries(persons)) {
      const personDiv = document.createElement('div');
      personDiv.className = 'person-group';

      const hintText = sessions.length > 1 ? '▼ 點擊展開各次紀錄' : '▼ 點擊展開紀錄';
      personDiv.innerHTML = `
        <div class="person-header" onclick="this.nextElementSibling.classList.toggle('open')">
          <div class="person-name-box">
            👤 ${personName} 
            <span class="person-count-badge">來面試了 ${sessions.length} 次</span>
          </div>
          <div class="person-hint">${hintText}</div>
        </div>
        <div class="person-sessions"></div>
      `;

      const sessionsContainer = personDiv.querySelector('.person-sessions');

      sessions.forEach((app, index) => {
        window.applicantDataMap[app.session_id] = app;

        const clone = template.content.cloneNode(true);
        const avatar = clone.querySelector('.applicant-avatar');
        if (avatar) avatar.textContent = personName.charAt(0);

        const nthText = sessions.length > 1 ? ` (第 ${sessions.length - index} 次面試)` : '';
        clone.querySelector('.applicant-name').textContent = personName + nthText;

        const jobDiv = clone.querySelector('.applicant-job');
        if (jobDiv) jobDiv.style.display = 'none';

        const selectStatus = clone.querySelector('.status-select');
        if (selectStatus) {
          selectStatus.dataset.id = app.session_id;
          let currentStatus = app.status;
          const validValues = Array.from(selectStatus.options).map(opt => opt.value);
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
          if (currentStatus === '') selectStatus.classList.add('status-empty');
          else selectStatus.classList.add(currentStatus);
        }

        // 💡 修改重點：不再 createElement！直接抓 HTML 裡面的 span 來填入資料！
        const profVal = clone.querySelector('.prof-val');
        const suitVal = clone.querySelector('.suit-val');

        const safeProfScore = (app.profScore !== undefined && app.profScore !== 'N/A' && app.profScore !== null) ? app.profScore : '尚未評估';
        const isEvaluated = (app.suitability !== undefined && app.suitability !== 'N/A' && app.suitability !== null);
        const suitScore = isEvaluated ? Number(app.suitability) : 0;

        if (profVal) {
          profVal.innerText = safeProfScore !== '尚未評估' ? `${safeProfScore} 分` : '尚未評估';
          profVal.style.color = safeProfScore !== '尚未評估' ? '#333' : '#999';
          profVal.style.fontWeight = safeProfScore !== '尚未評估' ? 'bold' : 'normal';
        }

        if (suitVal) {
          if (!isEvaluated || isNaN(suitScore)) {
            suitVal.innerText = '尚未評估';
            suitVal.style.color = '#999';
          } else {
            suitVal.innerText = `${suitScore}%`;
            if (suitScore >= 80) suitVal.classList.add('score-high');
            else if (suitScore >= 60) suitVal.classList.add('score-mid');
            else suitVal.classList.add('score-low');
          }
        }

        const btnReport = clone.querySelector('.btn-report');
        if (btnReport) {
          btnReport.dataset.id = app.session_id;
          const isCompleted = app.status === '已完成' || app.status === 'completed';
          if (!isCompleted || !app.hasReport) {
            btnReport.disabled = true;
            btnReport.title = '面試尚未完成，無報告';
            btnReport.style.opacity = '0.3';
            btnReport.style.cursor = 'not-allowed';
            btnReport.setAttribute('onclick', `alert('⏳ 該名應徵者尚未完成面試，目前沒有對話紀錄與 AI 報告可以查看喔！'); return false;`);
          } else {
            btnReport.disabled = false;
            btnReport.title = '查看詳細報告';
            btnReport.style.opacity = '1';
            btnReport.style.cursor = 'pointer';
            btnReport.removeAttribute('onclick');
          }
        }

        sessionsContainer.appendChild(clone);
      });
      bodyContainer.appendChild(personDiv);
    }
  }
};

// 🌟 需求 2：平均合適度計算也改成「每人只取最近一筆」，
// 若最近一筆沒有評分，該應徵者不計入平均（不再往回找舊的分數）
window.calculateJobAverage = function (jobTitle) {
  const persons = globalGroupedData[jobTitle];
  let total = 0;
  let count = 0;

  for (const personName in persons) {
    const latestSession = persons[personName][0]; // 陣列已依 start_time 新到舊排序
    const latestScore = Number(latestSession.suitability);
    if (!isNaN(latestScore) && latestSession.suitability !== 'N/A' && latestSession.suitability !== null && latestSession.suitability !== undefined) {
      total += latestScore;
      count++;
    }
  }

  const display = document.getElementById(`avg-${jobTitle}`);
  if (!display) return;

  if (count === 0) {
    display.innerText = '尚無報告可計算';
    display.className = 'avg-score-display score-none';
  } else {
    display.innerText = `平均合適度：${Math.round(total / count)}%`;
    display.className = 'avg-score-display score-mid';
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

// ================= 4.5 職缺綜合對比大報告 (新增) =================

window.openJobComparisonReport = async function (jobId, jobTitle) {
  window.closeAllModals();
  const overlay = document.getElementById('job-comparison-overlay');
  const content = document.getElementById('job-comparison-content');
  const titleEl = document.getElementById('job-comparison-title');
  if (!overlay || !content) return;

  if (titleEl) titleEl.textContent = `📊 ${jobTitle || ''} - 綜合對比分析報告`;
  overlay.style.display = 'flex';
  content.innerHTML = '<p style="text-align:center; padding:30px; color:#888;">查詢是否已有報告...</p>';

  try {
    const res = await fetch(`/api/company/jobs/${jobId}/comparison-report`);
    const result = await res.json();

    if (result.success && result.exists) {
      window.renderJobComparisonReport(result.report, result.updated_at, result.applicant_count, jobId);
    } else {
      content.innerHTML = `
        <p style="text-align:center; color:#888; padding:20px;">尚未生成過此職缺的綜合報告。</p>
        <button class="btn-green" style="width:100%;" onclick="window.generateJobComparisonReport('${jobId}')">🧠 立即生成報告</button>
      `;
    }
  } catch (err) {
    content.innerHTML = `<p style="color:red; text-align:center; padding:20px;">讀取失敗：${err.message}</p>`;
  }
};

window.generateJobComparisonReport = async function (jobId) {
  const content = document.getElementById('job-comparison-content');
  if (!content) return;
  content.innerHTML = '<p style="text-align:center; padding:30px; color:#1D9E75;">🧠 AI 正在交叉分析所有應徵者資料，約需 10~20 秒...</p>';

  try {
    const res = await fetch(`/api/company/jobs/${jobId}/comparison-report`, { method: 'POST' });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '生成失敗');
    window.renderJobComparisonReport(result.report, new Date().toISOString(), result.applicant_count, jobId);
  } catch (err) {
    content.innerHTML = `<p style="color:red; text-align:center; padding:20px;">生成失敗：${err.message}</p>`;
  }
};

window.renderJobComparisonReport = function (report, updatedAt, applicantCount, jobId) {
  const content = document.getElementById('job-comparison-content');
  if (!content) return;

  const rankingHtml = (report.ranking || []).map((r, i) => `
    <div class="ranking-row">
      <span class="ranking-num">#${i + 1}</span>
      <span class="ranking-name">${r.name}</span>
      <span class="ranking-score">${r.overall_score ?? '--'} 分</span>
      <span class="ranking-reason">${r.reason || ''}</span>
    </div>
  `).join('');

  content.innerHTML = `
    <div style="font-size:12px; color:#999; margin-bottom:15px;">
      最後更新：${updatedAt ? new Date(updatedAt).toLocaleString() : '--'}｜樣本人數：${applicantCount ?? '--'} 人
    </div>
    <h3 style="color:var(--primary-green);">整體總評</h3>
    <p>${report.job_overview || ''}</p>

    <h3 style="color:var(--primary-green); margin-top:20px;">人選排名</h3>
    <div class="ranking-list">${rankingHtml || '<p style="color:#888;">無排名資料</p>'}</div>

    <h3 style="color:var(--primary-green); margin-top:20px;">最推薦人選</h3>
    <p>${report.top_recommendation || '--'}</p>

    <div style="display:flex; gap:20px; margin-top:20px;">
      <div style="flex:1;">
        <h4 class="hl-title">共同優勢</h4>
        <ul>${(report.common_strengths || []).map(s => `<li>${s}</li>`).join('')}</ul>
      </div>
      <div style="flex:1;">
        <h4 class="wn-title">共同待加強</h4>
        <ul>${(report.common_gaps || []).map(s => `<li>${s}</li>`).join('')}</ul>
      </div>
    </div>

    <button class="btn-glass" style="width:100%; margin-top:20px;" onclick="window.generateJobComparisonReport('${jobId}')">🔄 重新生成最新報告</button>
  `;
};

window.closeJobComparisonModal = function () {
  const overlay = document.getElementById('job-comparison-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.closeGroupReportModal = function () {
  const overlay = document.getElementById('group-report-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.insertRoomManageReportButtons = function () {
  const container = document.getElementById('sessions-container');
  if (!container) return;

  container.querySelectorAll('.action-group').forEach(group => {
    const existingCustom = group.querySelector('.btn-group-report');
    const existingLegacy = Array.from(group.querySelectorAll('button')).find(btn => {
      const text = (btn.textContent || '').trim();
      const onclick = btn.getAttribute('onclick') || '';
      return text.includes('查看團面報告') || /generateGroupReport\(/.test(onclick);
    });

    if (existingLegacy) {
      if (existingLegacy !== existingCustom) {
        existingLegacy.remove();
      }
    }

    if (existingCustom) return;

    const markerBtn = group.querySelector('button[onclick*="deleteRoom("]') || group.querySelector('button[onclick*="openEditModal("]') || group.querySelector('button[onclick*="enterRoom("]');
    if (!markerBtn) return;

    const onclick = markerBtn.getAttribute('onclick') || '';
    const roomMatch = onclick.match(/\('([^']+)'/);
    const roomId = roomMatch ? roomMatch[1] : null;
    if (!roomId) return;
    const styleSourceBtn = editBtn || deleteBtn || markerBtn;

    const reportBtn = document.createElement('button');
    reportBtn.type = 'button';
    reportBtn.className = styleSourceBtn.className;
    reportBtn.classList.add('btn-group-report'); // 保留識別用 class，供查找/去重使用
    reportBtn.textContent = '📊 查看團面報告';
    reportBtn.addEventListener('click', () => window.openCompanyGroupReportModal(roomId));

    if (deleteBtn) {
      group.insertBefore(reportBtn, deleteBtn);
    } else {
      group.appendChild(reportBtn);
    }
  });
};

window.watchRoomManageReportButtons = function () {
  const container = document.getElementById('sessions-container');
  if (!container) return;
  window.insertRoomManageReportButtons();

  const observer = new MutationObserver(() => {
    window.insertRoomManageReportButtons();
  });
  observer.observe(container, { childList: true, subtree: true });
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
        const newStatus = e.target.value;
        window.changeStatusColor(e.target);

        // 🌟 攔截！如果選了「等待應徵者面試」(status-2)
        if (newStatus === 'status-2') {
          // 1. 抓出這個 session_id 對應的完整資料
          const appData = window.applicantDataMap[sessionId];
          // 2. 抽出職缺名稱 (如果找不到就給預設值)
          const jobTitle = appData ? appData.job_title : '未指定職缺';

          // 3. 把 session_id 跟 job 兩個參數一起透過網址帶過去！
          window.location.href = `0setup.html?session_id=${sessionId}&job=${encodeURIComponent(jobTitle)}`;
        } else {
          window.updateApplicantStatus(sessionId, newStatus);
        }
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

  const btnCloseJobComparisonModal = document.getElementById('btn-close-job-comparison-modal');
  if (btnCloseJobComparisonModal) {
    btnCloseJobComparisonModal.addEventListener('click', window.closeJobComparisonModal);
  }

  // 🌟 你的聊天室邏輯完整放在這裡 🌟
  const chatContactList = document.getElementById('hr-contact-list');
  if (chatContactList) {
    let currentChatApplicantId = null;

    async function loadContacts() {
      try {
        const res = await fetch('/api/company/chat/contacts');
        const result = await res.json();
        if (result.success && result.data.length > 0) {
          chatContactList.innerHTML = '';
          result.data.forEach(user => {
            const div = document.createElement('div');
            div.style.padding = '15px';
            div.style.borderBottom = '1px solid #eee';
            div.style.cursor = 'pointer';
            div.style.fontWeight = 'bold';
            div.textContent = `👤 ${user.name}`;

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
          messageBox.scrollTop = messageBox.scrollHeight;
        }
      } catch (e) { console.error('載入訊息失敗', e); }
    }

    const sendBtn = document.getElementById('hr-chat-send');
    const inputField = document.getElementById('hr-chat-input');

    async function sendMessage() {
      const text = inputField.value.trim();
      if (!text || !currentChatApplicantId) return;

      inputField.value = '';
      inputField.disabled = true;
      sendBtn.disabled = true;

      try {
        const res = await fetch(`/api/company/chat/${currentChatApplicantId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text })
        });
        const result = await res.json();
        if (result.success) await loadMessages();
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
      if (e.key === 'Enter') sendMessage();
    });

    loadContacts();
  }
});
// ==========================================
// 👥 團體面試專屬報告邏輯
// ==========================================

// 1. 關閉 Modal
window.closeGroupReportModal = function() {
    const overlay = document.getElementById('group-report-overlay');
    if (overlay) overlay.style.display = 'none';
};

function renderQASnippets(qaList) {
    const list = Array.isArray(qaList) ? qaList : [];
    if (list.length === 0) {
        return '<div style="text-align:center; padding: 20px; color:#888;">無逐題問答紀錄</div>';
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 12px;">';

    list.forEach((item, index) => {
        const score = Number(item.score ?? 0);
        const question = item.question || item.prompt || '無題目';
        const feedback = item.feedback || item.answer || item.analysis || '無具體建議';

        const badgeBg = score >= 7 ? '#e8f5e9' : score >= 4 ? '#fff3e0' : '#fce4ec';
        const badgeColor = score >= 7 ? '#2e7d32' : score >= 4 ? '#ef6c00' : '#c62828';

        html += `
            <div class="accordion-item" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.02);">
                <div class="accordion-header" onclick="toggleAccordion(this)" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; cursor: pointer; background: #fff;">
                    <div style="display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0; padding-right: 10px;">
                        <span style="font-weight: bold; color: #555; font-size: 15px; min-width: 28px;">Q${index + 1}</span>
                        <span style="color: #2c3e50; font-size: 14px; font-weight: 500; line-height: 1.5; word-break: break-word;">${question}</span>
                    </div>

                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: bold;">
                            ${score}/10
                        </span>
                        <span class="arrow-icon" style="font-size: 12px; color: #888; transition: transform 0.3s;">▼</span>
                    </div>
                </div>

                <div class="accordion-body" style="display: none; padding: 0 18px 18px 52px; color: #555; font-size: 14px; line-height: 1.7; border-top: 1px solid #f4f7f8; background: #fafafa;">
                    <div style="padding-top: 14px;">
                        <strong style="color:#2c3e50;">評語：</strong>
                        <div style="margin-top: 6px;">${feedback}</div>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

function toggleAccordion(headerElement) {
    const body = headerElement.nextElementSibling;
    const arrow = headerElement.querySelector('.arrow-icon');

    if (body.style.display === 'none' || !body.style.display) {
        body.style.display = 'block';
        arrow.style.transform = 'rotate(180deg)';
        headerElement.style.background = '#f9fbf9';
    } else {
        body.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
        headerElement.style.background = '#fff';
    }
}

window.renderGroupReportModal = async function (roomId) {
  const overlay = document.getElementById('group-report-overlay');
  const content = document.getElementById('group-report-content');
  if (!overlay || !content) return alert('找不到報告視窗元件！');

  overlay.style.display = 'flex';
  content.innerHTML = '<div style="padding: 50px 20px; text-align: center; color: #666; font-size: 16px;">⏳ 正在請 AI 顧問分析同場團面表現，請稍候...<br>(約需 10~15 秒)</div>';

  try {
    const res = await fetch(`/api/company/group-rooms/${roomId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();

    if (!result.success) {
      content.innerHTML = `<div style="color:#e74c3c; padding:20px; background:#fdf2f2; border-radius:8px; margin:10px;">產生失敗：${result.error}</div>`;
      return;
    }

    const report = result.report || {};
    const candidates = Array.isArray(report.candidates) && report.candidates.length > 0
      ? report.candidates
      : (Array.isArray(report.ranking) ? report.ranking.map((r, idx) => ({
          name: r.name || `候選人 ${idx + 1}`,
          overall_score: Number(r.overall_score) || 0,
          score_breakdown: {
            professionalism: { score: 0, reason: '無具體評分依據' },
            communication: { score: 0, reason: '無具體評分依據' },
            teamwork: { score: 0, reason: '無具體評分依據' },
            logic: { score: 0, reason: '無具體評分依據' }
          },
          highlights: [r.reason || '無亮點描述'],
          concerns: ['未提供明確疑慮'],
          transcript_snippet: '',
          emotion: null
        })) : []);
    const dimLabels = { professionalism: '專業能力', communication: '溝通表達', teamwork: '團隊合作', logic: '邏輯思維' };

    const chartHtml = `
      <div style="background:#fff; border:1px solid #eee; border-radius:10px; padding:15px; margin-bottom:20px;">
        <h3 style="margin:0 0 10px 0; color:#2C3E50; font-size:16px;">📈 應徵者能力對比折線圖</h3>
        <canvas id="groupCompareChart" height="90"></canvas>
      </div>
    `;

    const candidatesHtml = candidates.length > 0 ? candidates.map((c) => {
      const bd = c.score_breakdown || {};
      const breakdownRows = Object.keys(dimLabels).map(key => {
        const item = bd[key] || {};
        return `
          <div style="display:flex; gap:15px; padding:10px 0; border-bottom:1px dashed #eee; align-items: flex-start;">
            <div style="width:70px; font-weight:bold; color:#555; font-size:13px; margin-top:2px;">${dimLabels[key]}</div>
            <div style="width:50px; font-weight:bold; color:#1D9E75; font-size:14px; margin-top:1px;">${item.score ?? '--'} 分</div>
            <div style="flex:1; color:#444; font-size:13px; line-height:1.6; text-align: justify;">${item.reason || '無評分依據'}</div>
          </div>
        `;
      }).join('');

      const emo = c.emotion;
      const emoHtml = emo ? `
        <div style="display:flex; gap:15px; margin-top:10px;">
          <div style="flex:1; background:#f0fbf6; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-size:12px; color:#888;">正向情緒</div>
            <div style="font-size:18px; font-weight:bold; color:#1D9E75;">${Math.round((emo.happy_ratio||0)*100)}%</div>
          </div>
          <div style="flex:1; background:#f4f4f4; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-size:12px; color:#888;">中性情緒</div>
            <div style="font-size:18px; font-weight:bold; color:#666;">${Math.round((emo.neutral_ratio||0)*100)}%</div>
          </div>
          <div style="flex:1; background:#fff4e8; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-size:12px; color:#888;">焦慮情緒</div>
            <div style="font-size:18px; font-weight:bold; color:#e67e22;">${Math.round((emo.sad_ratio||0)*100)}%</div>
          </div>
          <div style="flex:1; background:#f0f4ff; border-radius:8px; padding:10px; text-align:center;">
            <div style="font-size:12px; color:#888;">專注度</div>
            <div style="font-size:18px; font-weight:bold; color:#3498db;">${emo.confidence_score ?? '--'}</div>
          </div>
        </div>
      ` : `<div style="margin-top:10px; color:#999; font-size:13px;">尚無此應徵者的表情偵測資料（可能面試時未啟用鏡頭分析，或該場次早於功能上線）</div>`;

      const transcriptHtml = function renderCandidateDialogue(transcriptSnippet, candidateName) {
        if (!transcriptSnippet) return '<div style="text-align:center; color:#999; padding: 10px;">無對話紀錄</div>';

        const blocks = transcriptSnippet.split(/\n\n|\r\n\r\n/).map(b => b.trim()).filter(Boolean);
        let dialogHtml = '<div style="display: flex; flex-direction: column; gap: 12px; padding: 10px 5px;">';

        for (const block of blocks) {
          const speakerName = block.split(/：|:/)[0] || '';
          const isInterviewer = /(面試官|HR|主管|系統)/i.test(speakerName);

          if (isInterviewer) {
            dialogHtml += `
              <div style="display: flex; justify-content: flex-start;">
                <div style="max-width: 80%; background-color: #f1f3f4; color: #333; padding: 10px 15px; border-radius: 16px 16px 16px 4px; font-size: 14px; line-height: 1.6; box-shadow: 0 1px 3px rgba(0,0,0,0.08); white-space: pre-wrap;">
                  🗣️ ${block}
                </div>
              </div>`;
          } else {
            dialogHtml += `
              <div style="display: flex; justify-content: flex-end;">
                <div style="max-width: 80%; background-color: #e8f5e9; color: #1D9E75; border: 1px solid #c8e6c9; padding: 10px 15px; border-radius: 16px 16px 4px 16px; font-size: 14px; line-height: 1.6; box-shadow: 0 1px 3px rgba(0,0,0,0.08); white-space: pre-wrap;">
                  ${block}
                </div>
              </div>`;
          }
        }

        dialogHtml += '</div>';
        return dialogHtml;
      }(c.transcript_snippet || '', c.name);

      const qaArray = Array.isArray(c.qa) ? c.qa : [];
      const qaContentHtml = qaArray.length > 0 ? renderQASnippets(qaArray) : '<div style="padding: 10px 0; color: #8a8a8a; font-size: 13px;">目前尚無逐題問答評估資料</div>';

      const qaCardHtml = `
            <div style="background: #fff; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0;">
                <h4 style="margin:0 0 10px 0; color:#2C3E50; font-size:15px; border-bottom: 2px solid #f0f0f0; padding-bottom: 8px;">🧩 逐題問答評估</h4>
                ${qaContentHtml}
            </div>`;

      return `
        <div style="background:#fff; border:1px solid #eee; border-radius:10px; margin-bottom:15px; overflow:hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
          <div onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display==='none' ? 'block':'none';"
               style="cursor:pointer; padding:14px 18px; background:#f9fbf9; display:flex; justify-content:space-between; align-items:center; transition: 0.2s;">
            <div style="font-weight:bold; color:#2C3E50; font-size:15px;">👤 ${c.name}</div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="background:#1D9E75; color:#fff; padding:4px 12px; border-radius:12px; font-size:13px; font-weight:bold;">綜合評分 ${c.overall_score ?? '--'} 分</span>
              <span style="color:#999; font-size:12px;">▼ 點擊展開詳細資訊</span>
            </div>
          </div>
          
          <div style="display:none; padding:20px; background:#fafafa; border-top: 1px solid #eee; text-align: left;">
            <div style="background: #fff; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 15px;">
                <h4 style="margin:0 0 10px 0; color:#2C3E50; font-size:15px; border-bottom: 2px solid #f0f0f0; padding-bottom: 8px;">📋 評分依據</h4>
                ${breakdownRows}
            </div>

            <div style="background: #fff; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; margin-bottom: 15px;">
                <h4 style="margin:0 0 10px 0; color:#2C3E50; font-size:15px; border-bottom: 2px solid #f0f0f0; padding-bottom: 8px;">👁️ 表情偵測分析</h4>
                ${emoHtml}
            </div>

            <div style="display:flex; gap:15px; margin-bottom: 15px;">
              <div style="flex:1; background: #f4fbf7; padding: 15px; border-radius: 8px; border: 1px solid #d4efdf;">
                <div style="color:#27ae60; font-size:14px; font-weight:bold; margin-bottom: 10px; display: flex; align-items: center; gap: 5px;">👍 亮點</div>
                <ul style="margin:0; padding-left:20px; font-size:13px; color:#444; line-height: 1.6;">
                  ${(c.highlights || []).map(h => `<li style="margin-bottom: 4px;">${h}</li>`).join('') || '<li>無特別亮點</li>'}
                </ul>
              </div>
              <div style="flex:1; background: #fdf2f2; padding: 15px; border-radius: 8px; border: 1px solid #fadbd8;">
                <div style="color:#c0392b; font-size:14px; font-weight:bold; margin-bottom: 10px; display: flex; align-items: center; gap: 5px;">⚠️ 疑慮</div>
                <ul style="margin:0; padding-left:20px; font-size:13px; color:#444; line-height: 1.6;">
                  ${(c.concerns || []).map(x => `<li style="margin-bottom: 4px;">${x}</li>`).join('') || '<li>無明顯疑慮</li>'}
                </ul>
              </div>
            </div>

            ${qaCardHtml}
          </div>
        </div>
      `;
    }).join('') : '<div style="padding: 20px; color: #666; background: #fff; border:1px solid #eee; border-radius:10px;">目前尚無可顯示的候選人資料，請確認該場次是否已有對話紀錄與評分結果。</div>';

    content.innerHTML = `
      <div style="padding: 10px 20px 20px 20px; line-height: 1.6; max-height: 75vh; overflow-y: auto; background-color: #fcfcfc;">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
          <span style="background:#e8f5e9; color:#1D9E75; padding:6px 15px; border-radius:20px; font-size:14px; font-weight:bold; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">👥 同場對比總人數：${result.applicant_count} 人</span>
        </div>

        <h3 style="color:#2C3E50; border-bottom:2px solid #f0f0f0; padding-bottom:8px; font-size: 16px;">👤 逐位應徵者詳細分析（含評分依據與專屬逐字稿）</h3>
        ${candidatesHtml}

        ${chartHtml}

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-top: 15px;">
          <div style="background: #fff3e0; padding: 12px; border-radius: 8px; border-left: 4px solid #ff9800;">
            <div style="color:#e65100; font-weight:bold; font-size: 14px;">🗣️ 最佳溝通者</div>
            <div style="font-size: 13px; color: #555; margin-top:5px;">${report.best_communicator || '無'}</div>
          </div>
          <div style="background: #e3f2fd; padding: 12px; border-radius: 8px; border-left: 4px solid #2196f3;">
            <div style="color:#1565c0; font-weight:bold; font-size: 14px;">💻 專業最突出</div>
            <div style="font-size: 13px; color: #555; margin-top:5px;">${report.standout_performer || '無'}</div>
          </div>
        </div>

        <div style="background: #ffebee; padding: 15px; border-radius: 8px; border: 1px solid #ffcdd2; margin-top: 20px;">
          <h3 style="color:#c62828; margin: 0 0 8px 0; font-size: 15px;">💡 HR 招募後續建議</h3>
          <p style="color:#b71c1c; font-size: 14px; margin: 0; line-height: 1.6;">${report.hr_recommendation || '目前無特別建議'}</p>
        </div>
      </div>
    `;

    if (window.Chart && candidates.length > 0) {
      const ctx = document.getElementById('groupCompareChart');
      const dimKeys = Object.keys(dimLabels);
      const colors = ['#1D9E75', '#3498db', '#e67e22', '#9b59b6', '#e74c3c', '#16a085'];
      const datasets = candidates.map((c, i) => ({
        label: c.name,
        data: dimKeys.map(k => (c.score_breakdown?.[k]?.score) ?? null),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length],
        tension: 0.3,
        fill: false
      }));
      new Chart(ctx, {
        type: 'line',
        data: { labels: Object.values(dimLabels), datasets },
        options: { responsive: true, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: 'bottom' } } }
      });
    }

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="color:#e74c3c; padding:20px; text-align:center;">連線失敗或發生不可預期的錯誤，請稍後再試。</div>`;
  }
};

window.generateGroupReport = window.renderGroupReportModal;
window.openCompanyGroupReportModal = window.renderGroupReportModal;
// ==========================================
// 📊 職缺綜合對比大報告功能
// ==========================================
window.closeJobComparisonModal = function () {
  const overlay = document.getElementById('job-comparison-overlay');
  if (overlay) overlay.style.display = 'none';
};

window.generateComparisonReport = async function (jobTitle) {
  const overlay = document.getElementById('job-comparison-overlay');
  const content = document.getElementById('job-comparison-content');

  if (!overlay || !content) {
    alert('找不到彈出視窗元件，請確認 HTML 結構是否正確。');
    return;
  }

  // 1. 打開 Modal，並顯示載入中
  overlay.style.display = 'flex';
  content.innerHTML = '<div style="padding: 40px 20px; text-align: center; font-size: 16px; color: #666;">⏳ 正在請 AI 顧問分析全體應徵者資料，請稍候... <br>(視人數多寡，約需 10-20 秒)</div>';

  try {
    // 2. 從前端資料庫抓出這個職缺的 ID (給後端 API 使用)
    const persons = globalGroupedData[jobTitle];
    let jobId = null;
    for (let pName in persons) {
      if (persons[pName] && persons[pName][0] && persons[pName][0].job_id) {
        jobId = persons[pName][0].job_id;
        break;
      }
    }

    if (!jobId) {
      content.innerHTML = '<div style="color:red; padding:20px;">找不到該職缺的 ID，無法生成報告。</div>';
      return;
    }

    // 3. 呼叫後端 API
    const res = await fetch(`/api/company/jobs/${jobId}/comparison-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();

    if (!result.success) {
      content.innerHTML = `<div style="color:#e74c3c; padding:20px; background:#fdf2f2; border-radius:8px; margin:10px;">產生失敗：${result.error}</div>`;
      return;
    }

    const report = result.report;

    // 4. 渲染排名 HTML
    let rankingHtml = '';
    if (report.ranking && report.ranking.length > 0) {
      rankingHtml = report.ranking.map((r, i) => `
              <div style="margin-bottom: 12px; padding: 12px 15px; background: #f9fbf9; border-left: 4px solid #1D9E75; border-radius: 6px;">
                  <strong style="color: #2C3E50; font-size: 15px;">第 ${i + 1} 名：${r.name} (合適度: <span style="color:#1D9E75;">${r.overall_score}%</span>)</strong>
                  <p style="margin: 5px 0 0 0; color: #555; font-size: 14px; line-height: 1.5;">${r.reason}</p>
              </div>
          `).join('');
    } else {
      rankingHtml = '<p style="color:#888;">尚無排名資料</p>';
    }

    // 5. 渲染精美的報告畫面
    content.innerHTML = `
          <div style="padding: 10px 20px 20px 20px; line-height: 1.6; max-height: 65vh; overflow-y: auto;">
              <div style="margin-bottom: 20px; text-align: center;">
                  <span style="background:#e8f5e9; color:#1D9E75; padding:6px 15px; border-radius:20px; font-size:14px; font-weight:bold;">分析對象共計：${result.applicant_count} 人</span>
              </div>
              
              <h3 style="color:#2C3E50; border-bottom:2px solid #f0f0f0; padding-bottom:8px;">🌟 職缺總評</h3>
              <p style="color:#444; font-size: 15px;">${report.job_overview || '無總評'}</p>

              <h3 style="color:#2C3E50; border-bottom:2px solid #f0f0f0; padding-bottom:8px; margin-top:25px;">🏆 推薦排名</h3>
              ${rankingHtml}

              <h3 style="color:#2C3E50; border-bottom:2px solid #f0f0f0; padding-bottom:8px; margin-top:25px;">💡 顧問首選推薦</h3>
              <p style="color:#e67e22; font-weight:bold; font-size: 15px; padding: 10px; background: #fff5e6; border-radius: 6px;">${report.top_recommendation || '目前無特別推薦人選'}</p>

              <div style="display: flex; gap: 20px; margin-top: 25px;">
                  <div style="flex: 1; background: #f4f7f8; padding: 15px; border-radius: 8px;">
                      <h4 style="color:#2C3E50; margin-top:0;">💪 應徵者普遍優勢</h4>
                      <ul style="color:#444; padding-left: 20px; margin-bottom: 0;">
                          ${(report.common_strengths || []).map(s => `<li>${s}</li>`).join('') || '<li>無明顯共同優勢</li>'}
                      </ul>
                  </div>
                  <div style="flex: 1; background: #fdf2f2; padding: 15px; border-radius: 8px;">
                      <h4 style="color:#2C3E50; margin-top:0;">⚠️ 應徵者普遍待加強</h4>
                      <ul style="color:#444; padding-left: 20px; margin-bottom: 0;">
                          ${(report.common_gaps || []).map(g => `<li>${g}</li>`).join('') || '<li>無明顯共同缺失</li>'}
                      </ul>
                  </div>
              </div>
          </div>
      `;

  } catch (err) {
    console.error(err);
    content.innerHTML = `<div style="color:#e74c3c; padding:20px; text-align:center;">連線失敗或發生不可預期的錯誤，請稍後再試。</div>`;
  }
};
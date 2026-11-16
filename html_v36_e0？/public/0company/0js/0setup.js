// ==========================================
// 📅 0setup.html 真實資料庫連線邏輯
// ==========================================

let currentSelectedMode = 'single';
let currentSelectedRoom = null;
let currentGroupRooms = []; // 存放從後端抓來的真實房間資料

// 1. 切換單人/多人模式的 UI 變化
window.selectInterviewMode = function(mode) {
    currentSelectedMode = mode;
    document.getElementById('mode-single').classList.remove('selected');
    document.getElementById('mode-group').classList.remove('selected');
    document.getElementById(`mode-${mode}`).classList.add('selected');

    const singlePicker = document.getElementById('single-time-picker');
    const groupPicker = document.getElementById('group-session-picker');
    
    if (singlePicker && groupPicker) {
        if (mode === 'single') {
            singlePicker.style.display = 'block';
            groupPicker.style.display = 'none';
        } else {
            singlePicker.style.display = 'none';
            groupPicker.style.display = 'flex';
            fetchGroupRooms(); // 🌟 切換到多人時，去資料庫抓房間
        }
    }
};

// 2. 去資料庫抓取所有團面房間
window.fetchGroupRooms = async function() {
    const container = document.getElementById('mock-sessions-container');
    if (!container) return;
    container.innerHTML = '<div style="color: #888;">載入場次中...</div>';

    try {
        const response = await fetch('/api/company/group-rooms');
        const result = await response.json();
        if (result.success) {
            currentGroupRooms = result.data;
            renderGroupRooms();
        } else {
            container.innerHTML = `<div style="color: red;">載入失敗: ${result.error}</div>`;
        }
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div style="color: red;">連線錯誤</div>';
    }
};

// 3. 將真實房間資料渲染到畫面上
window.renderGroupRooms = function() {
    const container = document.getElementById('mock-sessions-container');
    if (!container) return;
    container.innerHTML = '';
    
    currentGroupRooms.forEach(room => {
        // 🌟 防呆機制：如果後端回傳 null 或 undefined，一律視為 0
        const currentCount = room.current_count || 0; 
        const maxCapacity = room.max_capacity || 6;
        const isFull = currentCount >= maxCapacity;
        
        const box = document.createElement('div');
        box.className = `session-box ${isFull ? '' : 'selectable-room'}`;
        
        if (isFull) {
            box.style.opacity = '0.5';
            box.style.cursor = 'not-allowed';
            box.title = '此場次人數已滿';
        } else {
            if (currentSelectedRoom === room.room_id) box.classList.add('selected');
            box.onclick = () => selectRoom(box, room.room_id);
        }

        // 🌟 從剛剛後端關聯的資料中抽出職缺名稱
        const jobTitle = room.jobs?.job_title || '未指定職缺';

        // 🌟 轉換時間為 2026年X月X日 HH:mm 格式
        const d = new Date(room.start_time);
        const fmtTime = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

        // 🌟 全新排版：上方左右分散，下方放時間
        box.innerHTML = `
            <div style="display: flex; justify-content: space-between; width: 100%; align-items: flex-start; margin-bottom: 15px;">
                <span style="color: var(--primary-green); font-weight: bold; font-size: 18px; line-height: 1.3;">${jobTitle}</span>
                <span class="session-count" style="${isFull ? 'color: red;' : ''}">${currentCount}/${maxCapacity}</span>
            </div>
            <div class="session-time" style="margin-top: auto; color: #666; font-size: 15px;">${fmtTime}</div>
        `;
        container.appendChild(box);
    });
};

// 4. 點擊選擇某個多人房間
window.selectRoom = function(element, roomId) {
    currentSelectedRoom = roomId;
    document.querySelectorAll('.session-box').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
};

// 5. 新增團面房間 (呼叫 API 建立新房間)
window.createNewGroupRoom = function() {
    // 打開 Modal 彈窗
    document.getElementById('add-group-room-overlay').style.display = 'flex';
    
    // 🌟 抓取頁面上方已經讀取到的職缺名稱，塞入彈窗的唯讀框框中
    const currentJobTitle = document.getElementById('display-job-title').value;
    document.getElementById('new-room-job-title').value = currentJobTitle;
    
    // 把時間預設為今天的日期，方便 HR 操作
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('new-room-date').value = today;
    document.getElementById('new-room-time').value = '14:00';
    document.getElementById('new-room-capacity').value = 6;
};

// 6. 將 HTML 裡的十字按鈕綁定到建立房間函數
window.submitNewGroupRoom = async function() {
    const dateVal = document.getElementById('new-room-date').value;
    const timeVal = document.getElementById('new-room-time').value;
    const capacityVal = document.getElementById('new-room-capacity').value;

    if (!dateVal || !timeVal || !capacityVal) {
        return alert('請完整填寫面試日期、時間與容納人數！');
    }

    const scheduledTime = new Date(`${dateVal}T${timeVal}`).toISOString();
    const maxCapacity = parseInt(capacityVal, 10);

    // 🌟 關鍵新增：抓出網址上的 session_id，讓後端知道是哪個應徵者要建房間
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');

    try {
        const response = await fetch('/api/company/group-rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                start_time: scheduledTime, 
                max_capacity: maxCapacity,
                session_id: sessionId // 🌟 把 ID 一起傳給後端
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert('✅ 新的團體面試場次建立成功！');
            document.getElementById('add-group-room-overlay').style.display = 'none';
            fetchGroupRooms(); 
        } else {
            alert('建立失敗：' + result.error);
        }
    } catch (error) {
        console.error('建立場次失敗:', error);
        alert('系統連線錯誤，請檢查網路狀態或時間格式。');
    }
};

// 7. 正式將設定送出到資料庫
window.confirmSetupAndNotify = async function() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    if (!sessionId) return alert('找不到應徵者 ID！');

    let requestBody = { status: 'status-2' };

    if (currentSelectedMode === 'single') {
        const dateVal = document.getElementById('single-date').value;
        const timeVal = document.getElementById('single-time').value;
        if (!dateVal || !timeVal) return alert('請完整選擇單人面試的日期與時間！');
        
        requestBody.scheduled_time = new Date(`${dateVal}T${timeVal}`).toISOString();
    } else {
        if (!currentSelectedRoom) return alert('請選擇一個多人面試場次！');
        
        // 多人模式：將求職者綁定到指定的房間
        requestBody.room_id = currentSelectedRoom;
        
        // 為了讓求職者的倒數計時器也能拿到時間，我們把該房間的時間也順便寫進 start_time
        const targetRoom = currentGroupRooms.find(r => r.room_id === currentSelectedRoom);
        if (targetRoom) requestBody.scheduled_time = targetRoom.start_time;
    }

    // 發送真實 API 請求
    try {
        const response = await fetch(`/api/company/applicants/${sessionId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        const result = await response.json();
        if (result.success) {
            alert('✅ 面試時間與場次已設定成功，並發送通知！');
            window.location.href = '0applicant.html'; 
        } else {
            alert('設定失敗：' + result.error);
        }
    } catch (error) {
        console.error(error);
        alert('系統連線錯誤');
    }
};

// 8.抓職位資訊
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const jobTitle = urlParams.get('job');
    
    const displayEl = document.getElementById('display-job-title');
    if (displayEl) {
        // 如果網址有帶職缺名稱就顯示，沒有就顯示未指定
        displayEl.value = jobTitle ? jobTitle : '未指定職缺';
    }
});
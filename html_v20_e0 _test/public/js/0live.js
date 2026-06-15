let localStream;
let peerConnection;
let ws;
let targetSessionId = null;

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// 1. 頁面載入時的判斷邏輯
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('session_id');

    if (!targetSessionId) {
        // 沒有房號 ➔ 顯示視圖一 (去 Supabase 抓正在面試的清單)
        document.getElementById('room-selection-view').style.display = 'block';
        document.getElementById('video-room-view').style.display = 'none';
        fetchActiveSessions();
    } else {
        // 有房號 ➔ 顯示視圖二 (準備連線視訊)
        document.getElementById('room-selection-view').style.display = 'none';
        document.getElementById('video-room-view').style.display = 'block';
        document.getElementById('current-room-title').innerText = `目前潛入房間 ID：${targetSessionId}`;
        setupWebSocket();
    }
});

// 2. 去 Supabase 撈取「進行中」的面試
// ==========================================
// 打開 public/js/0live.js，完全替換掉 fetchActiveSessions 函數
// ==========================================

async function fetchActiveSessions() {
    const listContainer = document.getElementById('active-sessions-list');
    
    try {
        // 🌟 核心修正：不再直接呼叫 supabase，而是向我們自己的後端 API 請求資料
        const response = await fetch('http://localhost:3001/api/company/active-sessions');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || "後端 API 回傳失敗狀態");
        }

        const data = result.data; // 拿出後端幫我們抓好的資料

        if (!data || data.length === 0) {
            listContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">目前沒有正在進行中的面試。</div>';
            return;
        }

        listContainer.innerHTML = ''; // 清空載入中文字
        
        data.forEach(session => {
            // 🛡️ 防呆機制：處理名字
            let applicantName = '未知應徵者';
            if (session.applicants && session.applicants.name) {
                applicantName = session.applicants.name;
            } else if (session.applicant_id) {
                applicantName = `求職者 (${session.applicant_id.substring(0, 5)}...)`;
            }
            
            // 建立卡片
            const card = document.createElement('div');
            card.className = 'room-card';
            card.style.marginBottom = '15px';
            
            card.innerHTML = `
                <div>
                    <strong style="color: var(--primary-green); font-size: 18px;">${applicantName}</strong> 
                    <span style="display: inline-block; padding: 2px 8px; background: #e8f5e9; color: #2e7d32; border-radius: 12px; font-size: 12px; margin-left: 10px;">
                        ${session.status}
                    </span>
                    <div style="font-size: 12px; color: #666; margin-top: 8px; font-family: monospace;">
                        房號: ${session.session_id}
                    </div>
                </div>
                <button class="btn-green" onclick="window.location.href='0live.html?session_id=${session.session_id}'" style="padding: 8px 15px; font-size: 14px;">
                    潛入戰情室 ➔
                </button>
            `;
            listContainer.appendChild(card);
        });

    } catch (err) {
        console.error("讀取清單失敗:", err);
        listContainer.innerHTML = `
            <div style="color: #ff4c4c; text-align: center; background: rgba(255,0,0,0.1); padding: 15px; border-radius: 8px;">
                讀取清單失敗，請確認後端伺服器是否正常運行。<br>
                <small style="color: #888;">錯誤原因: ${err.message}</small>
            </div>`;
    }
}

// 3. 設定 WebSocket 連線
function setupWebSocket() {
    const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? 'ws://localhost:3001' : `wss://${window.location.host}`;
    ws = new WebSocket(backendUrl);

    ws.onopen = () => {
        // 連線成功後，馬上跟後端報備自己的房號
        ws.send(JSON.stringify({ type: 'hr_join_room', sessionId: targetSessionId }));
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'webrtc_answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
        if (data.type === 'webrtc_ice_candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    };
}

// 4. HR 按下「確認潛入並開啟鏡頭」
async function startHumanInterview() {
    document.getElementById('startCallBtn').disabled = true;
    document.getElementById('startCallBtn').innerText = "連線中...";

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localHrVideo').srcObject = localStream;

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        document.getElementById('remoteUserVideo').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // 🌟 核心：發送的所有訊號都要夾帶 sessionId
            ws.send(JSON.stringify({ 
                type: 'webrtc_ice_candidate', 
                candidate: event.candidate,
                sessionId: targetSessionId 
            }));
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // 🌟 核心：發送的所有訊號都要夾帶 sessionId
    ws.send(JSON.stringify({ type: 'human_hr_joined', sessionId: targetSessionId })); 
    ws.send(JSON.stringify({ type: 'webrtc_offer', offer: offer, sessionId: targetSessionId }));
}
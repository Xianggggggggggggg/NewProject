let localStream;
let ws;
let targetSessionId = null;
let myPeer = null;
let myPeerId = null;

// 音效與動畫全域變數
window.audioAnimationQueue = [];
window.audioContext = null;
let activeSources = [];
let nextPlayTime = 0;

// ==========================================
// 1. 頁面載入與初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    targetSessionId = urlParams.get('session_id');

    if (!targetSessionId) {
        document.getElementById('room-selection-view').style.display = 'block';
        document.getElementById('video-room-view').style.display = 'none';
        fetchActiveSessions();
    } else {
        document.getElementById('room-selection-view').style.display = 'none';
        document.getElementById('video-room-view').style.display = 'block';
        document.getElementById('current-room-title').innerText = `目前潛入團面房間 ID：${targetSessionId}`;
        
        // 🌟 初始化 PeerJS
        initPeerJS();
        setupWebSocket();
    }
});

// ==========================================
// 2. PeerJS 初始化
// ==========================================
function initPeerJS() {
    // 把原本空空的 new Peer() 換成這樣：
    myPeer = new Peer({
    config: {
        'iceServers': [
        { url: 'stun:stun.l.google.com:19302' },
        { url: 'stun:stun1.l.google.com:19302' }
        ]
    }
    });

    myPeer.on('open', id => {
        myPeerId = id;
        console.log("👑 [HR 戰情室] PeerJS 初始化成功！您的 ID:", id);
    });

    // 接聽來自求職者的連線
    myPeer.on('call', call => {
        if (localStream) call.answer(localStream);
        
        call.on('stream', remoteStream => {
            console.log("🎥 收到求職者畫面！Peer ID:", call.peer);
            
            // 🌟 關鍵：動態產生 video 標籤，才能容納多個應徵者
            let video = document.getElementById(`applicant_${call.peer}`);
            if (!video) {
                video = document.createElement('video');
                video.id = `applicant_${call.peer}`;
                video.autoplay = true;
                video.playsInline = true;
                // 這裡請替換成你 HR 介面下方用來放應徵者的容器 ID
                const grid = document.getElementById('video-grid');
                if (grid) grid.appendChild(video);
            }
            video.srcObject = remoteStream;
        });
        call.on('close', () => {
            const videoToRemove = document.getElementById(`applicant_${call.peer}`);
            if (videoToRemove) {
                videoToRemove.remove();
                console.log(`👋 應徵者 ${call.peer} 已離開，移除畫面。`);
            }
        });
    });
}

// ==========================================
// 3. 去 Supabase 撈取「進行中」的面試 (維持原樣)
// ==========================================
async function fetchActiveSessions() {
    const listContainer = document.getElementById('active-sessions-list');
    try {
        const response = await fetch('/api/company/active-sessions');
        const result = await response.json();
        if (!result.success) throw new Error(result.message);

        const data = result.data;
        if (!data || data.length === 0) {
            listContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">目前沒有正在進行中的面試。</div>';
            return;
        }

        listContainer.innerHTML = ''; 
        data.forEach(session => {
            let applicantName = session.applicants?.name || `求職者 (${session.applicant_id?.substring(0, 5)}...)` || '未知應徵者';
            const card = document.createElement('div');
            card.className = 'room-card';
            card.style.marginBottom = '15px';
            card.innerHTML = `
                <div>
                    <strong style="color: var(--primary-green); font-size: 18px;">${applicantName}</strong> 
                    <span style="display: inline-block; padding: 2px 8px; background: #e8f5e9; color: #2e7d32; border-radius: 12px; font-size: 12px; margin-left: 10px;">
                        ${session.status}
                    </span>
                    <div style="font-size: 12px; color: #666; margin-top: 8px; font-family: monospace;">房號: ${session.session_id}</div>
                </div>
                <button class="btn-green" onclick="window.location.href='0live_group.html?session_id=${session.session_id}'" style="padding: 8px 15px; font-size: 14px;">
                    潛入團面戰情室 ➔
                </button>
            `;
            listContainer.appendChild(card);
        });
    } catch (err) {
        console.error("讀取清單失敗:", err);
    }
}

// ==========================================
// 4. WebSocket 設定
// ==========================================
function setupWebSocket() {
    const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? 'ws://localhost:3001/ws/group' : `wss://${window.location.host}/ws/group`;
    ws = new WebSocket(backendUrl);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hr_join_room', sessionId: targetSessionId }));
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.customType === 'user_transcript') appendTranscript('user', data.text);
        if (data.customType === 'ai_transcript_final') appendTranscript('ai', data.text, data.ai_role || 'MANAGER');

        if (data.type === 'user_joined_group') {
        console.log("👥 偵測到新應徵者加入！HR 重新發送座標...");
        
        // 如果 HR 已經開好鏡頭了，就重新發送一次身分給遲到的人
        if (myPeerId && localStream) {
            ws.send(JSON.stringify({ 
                type: 'hr_joined_group', 
                sessionId: targetSessionId,
                peerId: myPeerId 
            }));
        }
    }
    };
}

// ==========================================
// 🚀 5. HR 開啟鏡頭並空降 (關鍵改動！)
// ==========================================
async function startHumanInterview() {
    try {
        if (!myPeerId) {
            alert("PeerJS 尚未連線完成，請稍等兩秒再試！");
            return;
        }

        document.getElementById('startCallBtn').disabled = true;
        document.getElementById('startCallBtn').innerText = "連線中...";

        // 啟動相機
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream.getAudioTracks()[0].enabled = false; // 預設關閉麥克風防干擾
        document.getElementById('localHrVideo').srcObject = localStream;

        // 🌟 超級關鍵：透過 WebSocket 廣播你的 Peer ID 給所有求職者！
        ws.send(JSON.stringify({ 
            type: 'hr_joined_group', 
            sessionId: targetSessionId,
            peerId: myPeerId // 把 Peer ID 霸氣送出去！
        })); 

        document.getElementById('startCallBtn').innerText = "✅ 已成功潛入";
        document.getElementById('startCallBtn').style.background = "#27ae60";

    } catch (error) {
        console.error("連線發生錯誤:", error);
        alert("無法連線！原因：" + error.message);
        document.getElementById('startCallBtn').disabled = false;
        document.getElementById('startCallBtn').innerText = "🚀 重新連線";
    }
}
// ==========================================
// 6. HR 設備控制 (開關麥克風/鏡頭)
// ==========================================
function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    const btn = document.getElementById('toggleCamBtn');
    
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        btn.innerText = videoTrack.enabled ? "📹 關閉鏡頭" : "📹 開啟鏡頭";
        btn.style.background = videoTrack.enabled ? "#2c3e50" : "#7f8c8d";
    }
}

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    const btn = document.getElementById('toggleMicBtn');
    
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        
        if (audioTrack.enabled) {
            btn.innerText = "🔇 關閉麥克風";
            btn.style.background = "#27ae60"; 
            // 🌟 麥克風打開時，啟動語音轉文字
            if (hrRecognition) {
                try { hrRecognition.start(); } catch(e) {}
                console.log("🎤 麥克風與語音辨識已開啟");
            }
        } else {
            btn.innerText = "🎙️ 開啟麥克風";
            btn.style.background = "#c0392b"; 
            // 🌟 麥克風關閉時，停止語音轉文字
            if (hrRecognition) {
                try { hrRecognition.stop(); } catch(e) {}
                console.log("🔇 麥克風與語音辨識已暫停");
            }
        }
    }
}

function appendTranscript(role, text, ai_role = 'HR') {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');
    if (!box) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = role === 'ai' ? 'ai-msg' : 'user-msg';
    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";

    if (role === 'ai') {
        if (ai_role === '真人HR') {
            msgDiv.style.backgroundColor = "#fff3e0";
            msgDiv.style.color = "#d35400";
            msgDiv.style.border = "1px solid #ffe0b2";
            msgDiv.innerText = '🕵️ 真人面試官：\n' + text;
        } else if (ai_role === 'HR') {
            msgDiv.style.backgroundColor = "#f0f0f0";
            msgDiv.style.color = "#333";
            msgDiv.innerText = '👩‍💼 人資 (HR)：\n' + text;
        } else {
            msgDiv.style.backgroundColor = "#ffebee";
            msgDiv.style.color = "#c62828";
            msgDiv.innerText = '👨‍💻 部門主管：\n' + text;
        }
        msgDiv.style.textAlign = "left";
    } else {
        msgDiv.style.backgroundColor = "#e8f0fe";
        msgDiv.style.color = "#1a73e8";
        msgDiv.style.textAlign = "right";
        msgDiv.innerText = '👤 應徵者：\n' + text;
    }
    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

// ==========================================
// 🌟 戰情室專屬：語音轉文字引擎
// ==========================================
let hrRecognition = null;

if ('webkitSpeechRecognition' in window) {
    hrRecognition = new webkitSpeechRecognition();
    hrRecognition.continuous = true;
    hrRecognition.interimResults = false;
    hrRecognition.lang = 'zh-TW';

    hrRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript.trim();
                if (text && ws && ws.readyState === WebSocket.OPEN) {
                    // 將文字傳給後端廣播
                    ws.send(JSON.stringify({ type: 'hr_human_speech', text: text, sessionId: targetSessionId }));
                }
            }
        }
    };
    
    // 確保麥克風沒關時，聽寫員不小心睡著要叫醒他
    hrRecognition.onend = () => {
        const btn = document.getElementById('toggleMicBtn');
        // 依照你原本的 UI，如果是開啟狀態，按鈕應該是顯示 "🔇 關閉麥克風"
        if (btn && btn.innerText.includes('關閉麥克風') && hrRecognition) {
            try { hrRecognition.start(); } catch(e){}
        }
    };
}
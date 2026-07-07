let localStream;
let peerConnection;
let ws;
let targetSessionId = null;
let iceCandidateQueue = []; // 新增：路徑排隊區

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// 🌟 音效與動畫全域變數 (戰情室專用)
window.audioAnimationQueue = [];
window.audioContext = null;
let activeSources = [];

let nextPlayTime = 0;

// 🌟 新增：戰情室專用的瞬間閉嘴之術
window.isAIPaused = false;
function stopAllAudio() {
    activeSources.forEach(source => { try { source.stop(); } catch (e) { } });
    activeSources = [];
    window.audioAnimationQueue = []; // 清空對嘴動畫
    if (window.audioContext) nextPlayTime = window.audioContext.currentTime;

    const talkTech = document.getElementById('talkVideo_Tech');
    const talkHR = document.getElementById('talkVideo_HR');
    if (talkTech) talkTech.classList.remove('active');
    if (talkHR) talkHR.classList.remove('active');
}

// ==========================================
// 1. 頁面載入時的判斷邏輯
// ==========================================
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

// ==========================================
// 2. 去 Supabase 撈取「進行中」的面試
// ==========================================
async function fetchActiveSessions() {
    const listContainer = document.getElementById('active-sessions-list');
    
    try {
        const response = await fetch('/api/company/active-sessions');
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message || "後端 API 回傳失敗狀態");
        }

        const data = result.data;

        if (!data || data.length === 0) {
            listContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">目前沒有正在進行中的面試。</div>';
            return;
        }

        listContainer.innerHTML = ''; 
        
        data.forEach(session => {
            let applicantName = '未知應徵者';
            if (session.applicants && session.applicants.name) {
                applicantName = session.applicants.name;
            } else if (session.applicant_id) {
                applicantName = `求職者 (${session.applicant_id.substring(0, 5)}...)`;
            }
            
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

// ==========================================
// 3. 設定 WebSocket 連線與廣播接收
// ==========================================
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
        
        // 📡 接收 WebRTC 視訊連線訊號
     if (data.type === 'webrtc_answer') {
         await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));

         // 🌟 門打開後，把排隊的封包放進去
         iceCandidateQueue.forEach(c => peerConnection.addIceCandidate(c));
         iceCandidateQueue = [];
     }

     if (data.type === 'webrtc_ice_candidate') {
         if (peerConnection) {
             // 🌟 如果門還沒開，先排隊
             if (peerConnection.remoteDescription) {
                 await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
             } else {
                 iceCandidateQueue.push(new RTCIceCandidate(data.candidate));
             }
         }
     }

        // 🌟 接收廣播來的文字紀錄
        if (data.customType === 'user_transcript') {
            appendTranscript('user', data.text);
        }
        if (data.customType === 'ai_transcript_final') {
            const finalRole = data.ai_role || 'MANAGER';
            appendTranscript('ai', data.text, finalRole);
        }

        if (data.customType === 'kill_ai_audio') {
            window.isAIPaused = true;
            stopAllAudio(); // 讓戰情室的 AI 也瞬間閉嘴
        }
        if (data.customType === 'resume_ai_audio') {
            window.isAIPaused = false;
        }

        // 🌟 接收廣播來的 AI 聲音，並觸發戰情室的影片動嘴巴！
        if (data.serverContent?.modelTurn?.parts) {
            let roleStr = data.ai_role || 'MANAGER';
            let targetId = roleStr.includes('HR') ? 'aiModel_HR' : 'aiModel_Tech';

            for (const part of data.serverContent.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                    playAudio(part.inlineData.data, targetId); 
                }
            }
        }
    };
}

// ==========================================
// 4. HR 按下「確認潛入並開啟鏡頭」
// ==========================================
async function startHumanInterview() {
    document.getElementById('startCallBtn').disabled = true;
    document.getElementById('startCallBtn').innerText = "連線中...";
    document.getElementById('interventionBtn').style.display = 'inline-block';
    document.getElementById('toggleCamBtn').style.display = 'inline-block';
    document.getElementById('toggleMicBtn').style.display = 'inline-block';
    // 啟動音效大腦 (瀏覽器規定必須在按鈕點擊時啟動)
    if (!window.audioContext) {
        window.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (window.audioContext.state === 'suspended') await window.audioContext.resume();

    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // 🌟 預設關閉麥克風，避免一進包廂就收到雜音
    localStream.getAudioTracks()[0].enabled = false;
    isMicOn = false;
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
        micBtn.innerText = "🔇 開啟麥克風";
        micBtn.style.background = "#c0392b";
    }
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
            // 發送的所有訊號都要夾帶 sessionId
            ws.send(JSON.stringify({ 
                type: 'webrtc_ice_candidate', 
                candidate: event.candidate,
                sessionId: targetSessionId 
            }));
        }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // 發送潛入通知與視訊邀請
    ws.send(JSON.stringify({ type: 'human_hr_joined', sessionId: targetSessionId })); 
    ws.send(JSON.stringify({ type: 'webrtc_offer', offer: offer, sessionId: targetSessionId }));
}

// ==========================================
// 🌟 5. 戰情室專屬：對話紀錄渲染器
// ==========================================
function appendTranscript(role, text, ai_role = 'HR') {
    if (!text.trim()) return;
    const box = document.getElementById('transcriptBox');
    if (!box) return;

    if (box.innerHTML.includes('等待面試對話開始')) {
        box.innerHTML = '<h3 style="margin-top:0; border-bottom: 1px solid #ccc; padding-bottom: 10px;">即時對話監聽紀錄</h3>';
    }

    const msgDiv = document.createElement('div');
    msgDiv.style.margin = "10px 0";
    msgDiv.style.padding = "10px";
    msgDiv.style.borderRadius = "8px";
    msgDiv.style.fontSize = "15px";
    msgDiv.style.lineHeight = "1.5";

    if (role === 'ai') {
        // 🌟 新增：戰情室也套用真人面試官專屬樣式！
        if (ai_role === '真人HR') {
            msgDiv.style.backgroundColor = "#fff3e0"; 
            msgDiv.style.color = "#d35400";
            msgDiv.style.border = "1px solid #ffe0b2";
            msgDiv.innerText = '🕵️ 真人面試官：\n' + text;
        } else if (ai_role.includes('HR')) {
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
// 🌟 6. AI 動態對嘴與音效引擎 (戰情室上帝視角版)
// ==========================================
async function playAudio(base64Data, targetId) {
    try {
        if (!targetId) targetId = 'aiModel_Tech';

        if (!window.audioContext) {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (window.audioContext.state === 'suspended') await window.audioContext.resume();

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
        const int16Array = new Int16Array(bytes.buffer);
        
        const audioBuffer = window.audioContext.createBuffer(1, int16Array.length, 24000);
        audioBuffer.getChannelData(0).set(Array.from(int16Array).map(v => v / 32768.0));

        const source = window.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(window.audioContext.destination);
        activeSources.push(source);

        const now = window.audioContext.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;

        window.audioAnimationQueue.push({
            targetId: targetId,
            startTime: nextPlayTime,
            endTime: nextPlayTime + audioBuffer.duration
        });

        source.start(nextPlayTime);
        nextPlayTime += audioBuffer.duration;
    } catch (err) {
        console.error("❌ playAudio 發生錯誤:", err);
    }
}

function initGlobalAnimationLoop() {
    const runGlobalLoop = () => {
        const ctx = window.audioContext || null;
        const now = ctx ? ctx.currentTime : 0;
        
        const activeTurn = window.audioAnimationQueue.find(item => now >= item.startTime && now <= item.endTime);
        const activeTargetId = activeTurn ? activeTurn.targetId : null;

        window.audioAnimationQueue = window.audioAnimationQueue.filter(item => now <= item.endTime);

        const talkVideoTech = document.getElementById('talkVideo_Tech');
        const talkVideoHR = document.getElementById('talkVideo_HR');

        if (talkVideoTech && talkVideoHR) {
            if (activeTargetId === 'aiModel_Tech') {
                if (!talkVideoTech.classList.contains('active')) {
                    talkVideoTech.currentTime = 0; 
                    talkVideoTech.play().catch(e => {});
                    talkVideoTech.classList.add('active'); 
                }
                talkVideoHR.classList.remove('active'); 
            } else if (activeTargetId === 'aiModel_HR') {
                if (!talkVideoHR.classList.contains('active')) {
                    talkVideoHR.currentTime = 0;
                    talkVideoHR.play().catch(e => {});
                    talkVideoHR.classList.add('active'); 
                }
                talkVideoTech.classList.remove('active'); 
            } else {
                talkVideoTech.classList.remove('active');
                talkVideoHR.classList.remove('active');
            }
        }
        requestAnimationFrame(runGlobalLoop);
    };
    requestAnimationFrame(runGlobalLoop);
}

// ==========================================
// 🌟 7. 真人插話控制邏輯
// ==========================================
let isIntervening = false;
function toggleIntervention() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert("系統尚未與後端連線！");
        return;
    }
    
    const btn = document.getElementById('interventionBtn');
    isIntervening = !isIntervening; // 切換狀態
    
    if (isIntervening) {
        // 切換為「恢復」狀態
        btn.innerText = "▶️ 恢復 AI 面試";
        btn.style.background = "#1D9E75";
        ws.send(JSON.stringify({ type: 'pause_ai', sessionId: targetSessionId }));
        console.log("已發送暫停 AI 指令");
    } else {
        // 切換為「暫停」狀態
        btn.innerText = "✋ 暫停 AI (我要插話)";
        btn.style.background = "#e67e22";
        ws.send(JSON.stringify({ type: 'resume_ai', sessionId: targetSessionId }));
        console.log("已發送恢復 AI 指令");
    }
}

// ==========================================
// 🌟 8. 鏡頭與麥克風控制邏輯
// ==========================================
let isCamOn = true;
let isMicOn = true;

function toggleCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0]; // 抓取影像軌道
    if (videoTrack) {
        isCamOn = !isCamOn;
        videoTrack.enabled = isCamOn; // 切換影像開關
        
        const btn = document.getElementById('toggleCamBtn');
        if (isCamOn) {
            btn.innerText = "📹 關閉鏡頭";
            btn.style.background = "#2c3e50";
        } else {
            btn.innerText = "🚫 開啟鏡頭";
            btn.style.background = "#c0392b"; // 變成紅色警告
        }
    }
}

// ==========================================
// 🌟 戰情室專屬：語音轉文字引擎與麥克風控制
// ==========================================
let hrRecognition = null;

// 初始化 Google 語音辨識
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
                    // 🌟 你講完話，立刻把文字傳給後端廣播到對話框！
                    ws.send(JSON.stringify({ type: 'hr_human_speech', text: text, sessionId: targetSessionId }));
                }
            }
        }
    };
}

function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isMicOn = !isMicOn;
        audioTrack.enabled = isMicOn; // 切換 WebRTC 實體麥克風
        
        const btn = document.getElementById('toggleMicBtn');
        if (isMicOn) {
            btn.innerText = "🎤 關閉麥克風";
            btn.style.background = "#2c3e50";
            if (hrRecognition) hrRecognition.start(); // 🌟 麥克風打開時，開始將 HR 語音轉文字
        } else {
            btn.innerText = "🔇 開啟麥克風";
            btn.style.background = "#c0392b";
            if (hrRecognition) hrRecognition.stop();  // 🌟 麥克風關閉時，停止轉文字
        }
    }
}
// 啟動戰情室動畫迴圈
initGlobalAnimationLoop();
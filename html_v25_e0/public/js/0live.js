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
    try {
        document.getElementById('startCallBtn').disabled = true;
        document.getElementById('startCallBtn').innerText = "連線中...";

        // 啟動音效大腦 (瀏覽器規定必須在按鈕點擊時啟動)
        if (!window.audioContext) {
            window.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        }
        if (window.audioContext.state === 'suspended') await window.audioContext.resume();

        // 請求相機與麥克風權限
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        // 預設關閉麥克風防干擾
        localStream.getAudioTracks()[0].enabled = false;
        isMicOn = false;
        
        document.getElementById('localHrVideo').srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        peerConnection.ontrack = (event) => {
            document.getElementById('remoteUserVideo').srcObject = event.streams[0];
            // 🌟 啟動聲控雷達！
            startAutoVoiceDetection(localStream, event.streams[0]);
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
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
        
    } catch (error) {
        // 🛑 如果相機壞掉或有任何錯誤，會直接彈出視窗告訴你，絕對不會卡死！
        console.error("連線發生錯誤:", error);
        alert("無法連線！原因：" + error.message);
        document.getElementById('startCallBtn').disabled = false;
        document.getElementById('startCallBtn').innerText = "🚀 重新連線";
    }
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
// 🌟 黑科技：全自動聲控雷達 (雙向監聽 VAD)
// ==========================================
let autoPauseActive = false;
let silenceTimer = null;
let audioContextVAD = null;
let hrAnalyser = null;
let userAnalyser = null;
let hrDataArray = null;
let userDataArray = null;

function startAutoVoiceDetection(localStream, remoteStream) {
    audioContextVAD = new (window.AudioContext || window.webkitAudioContext)();

    try {
        // 1. 監聽 HR 的麥克風
        const hrSource = audioContextVAD.createMediaStreamSource(localStream);
        hrAnalyser = audioContextVAD.createAnalyser();
        hrAnalyser.fftSize = 256;
        hrSource.connect(hrAnalyser);
        hrDataArray = new Uint8Array(hrAnalyser.frequencyBinCount);

        // 2. 監聽應徵者的聲音
        const userSource = audioContextVAD.createMediaStreamSource(remoteStream);
        userAnalyser = audioContextVAD.createAnalyser();
        userAnalyser.fftSize = 256;
        userSource.connect(userAnalyser);
        userDataArray = new Uint8Array(userAnalyser.frequencyBinCount);

        checkVolumeLoop();
        console.log("📡 [VAD] 全自動聲控雷達已啟動！");
    } catch (e) {
        console.error("VAD 啟動失敗:", e);
    }
}

function checkVolumeLoop() {
    requestAnimationFrame(checkVolumeLoop);

    hrAnalyser.getByteFrequencyData(hrDataArray);
    userAnalyser.getByteFrequencyData(userDataArray);

    // 計算 HR 與應徵者的即時音量
    let hrSum = 0; for(let i=0; i<hrDataArray.length; i++) hrSum += hrDataArray[i];
    let hrAvg = hrSum / hrDataArray.length;

    let userSum = 0; for(let i=0; i<userDataArray.length; i++) userSum += userDataArray[i];
    let userAvg = userSum / userDataArray.length;

    const THRESHOLD = 12; // 🌟 敏感度 (數字越小越敏感，覺得難觸發可以改小)

    if (hrAvg > THRESHOLD) {
        // HR 一講話，立刻砸停 AI！
        if (!autoPauseActive) {
            autoPauseActive = true;
            console.log("🎤 [VAD] 偵測到 HR 講話，自動暫停 AI！");
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'pause_ai', sessionId: targetSessionId }));
            }
            const title = document.getElementById('current-room-title');
            if(title) {
                title.innerText = "⚠️ 真人對話中 (AI 已自動暫停)";
                title.style.color = "#e67e22";
            }
        }
        resetSilenceTimer(); // 只要有講話，就重新計時
    } else if (userAvg > THRESHOLD) {
        // 應徵者講話時，重置計時器 (保護應徵者講話不被 AI 打斷)
        if (autoPauseActive) {
            resetSilenceTimer();
        }
    }
}

function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    
    // 設定「安靜幾秒後」AI 自動接手 (預設 4 秒)
    silenceTimer = setTimeout(() => {
        if (autoPauseActive) {
            autoPauseActive = false;
            console.log("🤫 [VAD] 雙方安靜 4 秒，AI 自動恢復！");
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resume_ai', sessionId: targetSessionId }));
            }
            const title = document.getElementById('current-room-title');
            if(title) {
                title.innerText = `目前潛入房間 ID：${targetSessionId}`;
                title.style.color = "var(--text-main)";
            }
        }
    }, 4000); // 4000毫秒 = 4秒
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

// ==========================================
// 🌟 純粹的麥克風硬體開關 (不綁定任何 AI 指令)
// ==========================================
function toggleMic() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        isMicOn = !isMicOn;
        audioTrack.enabled = isMicOn; // 純粹地切換 WebRTC 實體麥克風
        
        const btn = document.getElementById('toggleMicBtn');
        if (isMicOn) {
            btn.innerText = "🎤 關閉麥克風";
            btn.style.background = "#2c3e50"; // 深藍色
            
            // 麥克風打開時，啟動語音轉文字 (給對話框用的)
            if (hrRecognition) hrRecognition.start(); 
            console.log("🎤 麥克風已開啟 (聲控雷達開始監聽您的聲音)");
        } else {
            btn.innerText = "🔇 開啟麥克風";
            btn.style.background = "#c0392b"; // 紅色
            
            // 麥克風關閉時，停止語音轉文字
            if (hrRecognition) hrRecognition.stop();  
            console.log("🔇 麥克風已靜音 (聲控雷達聽不到您的聲音)");
        }
    }
}
// 啟動戰情室動畫迴圈
initGlobalAnimationLoop();
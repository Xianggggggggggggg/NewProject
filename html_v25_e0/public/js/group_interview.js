// ==========================================
// 1. 全域變數與初始化
// ==========================================
const urlParams = new URLSearchParams(window.location.search);
const TARGET_SESSION_ID = urlParams.get('session_id') || 'group_test_123'; // 如果網址沒帶房號，給個預設值防呆

const peers = {}; 
let myStream = null;
let windowHrPeerId = null; // 專門用來記錄真人考官的 Peer ID

// 自動辨識 WebSocket 網址
const backendUrl = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
    ? 'ws://localhost:3001' : `wss://${window.location.host}`;
const ws = new WebSocket(backendUrl);

// 初始化 PeerJS
const myPeer = new Peer();

// ==========================================
// 2. PeerJS 連線與報到
// ==========================================
myPeer.on('open', id => {
    document.getElementById('status-text').innerText = `✅ 連線成功 (您的 ID: ${id})`;
    
    // 向後端總機報到
    const joinMsg = JSON.stringify({ type: 'join_group_room', sessionId: TARGET_SESSION_ID, peerId: id });
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(joinMsg);
    } else {
        ws.onopen = () => ws.send(joinMsg);
    }
});

// ==========================================
// 3. 啟動攝影機與接收總機廣播
// ==========================================
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        myStream = stream;
        
        // 放上自己的畫面
        const myVideo = document.createElement('video');
        myVideo.muted = true; 
        addVideoStream(myVideo, stream, 'my-video');

        // 🌟 【接聽來電】：其他人連線過來時 (包含真人考官與其他應徵者)
        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            video.id = `video_${call.peer}`;
            
            call.on('stream', userVideoStream => {
                // 🛑 關鍵判斷：打來的人是不是真人考官？
                if (call.peer === windowHrPeerId) {
                    switchToHumanHR(userVideoStream);
                } else {
                    addVideoStream(video, userVideoStream);
                }
            });
            call.on('close', () => {
                if (call.peer === windowHrPeerId) {
                    revertToPlaceholderHR();
                } else {
                    video.remove();
                }
            });
            peers[call.peer] = call;
        });

        // 🌟 監聽後端 WebSocket 廣播
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            // 🟢 A. 戰情室廣播：真人考官（HR）進房了！
            if (data.type === 'hr_joined_group') {
                console.log("🚨 [系統] 真人考官進場廣播！ID:", data.peerId);
                windowHrPeerId = data.peerId; // 記錄考官 Peer ID
                
                // 主動撥打給考官
                const call = myPeer.call(data.peerId, stream);
                call.on('stream', hrStream => {
                    switchToHumanHR(hrStream);
                });
                peers[data.peerId] = call;
            }

            // 🟢 B. 有新人進房：打給他！(一般的應徵者)
            if (data.type === 'user_joined_group') {
                connectToNewUser(data.newPeerId, stream);
            }
            
            // 🟢 C. 有人離開：刪除畫面 (包含考官退場處理)
            if (data.type === 'user_left_group') {
                if (peers[data.peerId]) {
                    peers[data.peerId].close();
                    delete peers[data.peerId];
                }
                
                // 如果走的人是真人考官，還原第三席座位
                if (data.peerId === windowHrPeerId) {
                    revertToPlaceholderHR();
                } else {
                    const videoToRemoval = document.getElementById(`video_${data.peerId}`);
                    if (videoToRemoval) videoToRemoval.remove();
                }
            }

            // ==========================================
            // 🚨 這裡保留放「接收 AI 音訊」與「麥克風接力棒」的邏輯！
            // ==========================================
        };
    })
    .catch(err => {
        console.error("相機啟動失敗:", err);
        document.getElementById('status-text').innerText = "❌ 找不到相機或麥克風";
        document.getElementById('status-text').style.color = "red";
    });

// ==========================================
// 4. 背景連線與 DOM 控制函數
// ==========================================
function connectToNewUser(peerId, stream) {
    const call = myPeer.call(peerId, stream);
    const video = document.createElement('video');
    video.id = `video_${peerId}`;
    
    call.on('stream', userVideoStream => {
        // 確保在建立新連線時，如果對方是考官就走考官座席，否則去九宮格
        if (peerId === windowHrPeerId) {
            switchToHumanHR(userVideoStream);
        } else {
            addVideoStream(video, userVideoStream);
        }
    });
    call.on('close', () => {
        if (peerId === windowHrPeerId) {
            revertToPlaceholderHR();
        } else {
            video.remove();
        }
    });
    peers[peerId] = call;
}

function addVideoStream(video, stream, elementId = '') {
    video.srcObject = stream;
    if (elementId) video.id = elementId;
    video.addEventListener('loadedmetadata', () => video.play());
    
    const grid = document.getElementById('video-grid');
    if (grid) grid.append(video);
}

// ==========================================
// 👑 真人考官狀態切換函數 (三劍客第三席控制)
// ==========================================

// 1. 考官來臨：點亮第三席，隱藏文字
function switchToHumanHR(stream) {
    console.log("🎥 正在將真人考官串流接入第三席...");
    
    // 隱藏「等待中...」提示
    const placeholder = document.getElementById('hr-waiting-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    // 顯示真人視訊畫面
    const humanVideo = document.getElementById('humanHrVideo');
    if (humanVideo) {
        humanVideo.srcObject = stream;
        humanVideo.style.opacity = '1';
        humanVideo.play().catch(err => console.warn("考官視訊播放失敗:", err));
    }

    // 升級標籤
    const hrLabel = document.getElementById('hr-label');
    if (hrLabel) {
        hrLabel.innerText = "👑 真人考官";
        hrLabel.style.background = "linear-gradient(45deg, #ff9800, #f39c12)";
        hrLabel.style.boxShadow = "0 2px 10px rgba(255, 152, 0, 0.5)";
    }

    // 在右側即時對話噴出系統提示
    const box = document.getElementById('transcriptBox');
    if (box) {
        // 避免重複噴提示，先檢查有沒有噴過
        if (!document.getElementById('human-join-alert')) {
            const alertDiv = document.createElement('div');
            alertDiv.id = 'human-join-alert';
            alertDiv.className = 'ai-msg';
            alertDiv.style.borderLeft = '4px solid #ff9800';
            alertDiv.style.backgroundColor = '#fff3e0';
            alertDiv.innerHTML = `<b>📢 系統提示：</b>真人面試官已加入會議，AI 與真人協同面試正式開始！`;
            box.appendChild(alertDiv);
            box.scrollTop = box.scrollHeight;
        }
    }
}

// 2. 考官退場：還原預設待命狀態
function revertToPlaceholderHR() {
    console.log("🚪 真人考官已離席，還原第三席狀態...");
    windowHrPeerId = null;

    // 隱藏真人視訊
    const humanVideo = document.getElementById('humanHrVideo');
    if (humanVideo) {
        humanVideo.style.opacity = '0';
        humanVideo.srcObject = null;
    }

    // 重新顯示「等待中...」
    const placeholder = document.getElementById('hr-waiting-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    // 還原標籤
    const hrLabel = document.getElementById('hr-label');
    if (hrLabel) {
        hrLabel.innerText = "👤 真人面試官";
        hrLabel.style.background = "rgba(45, 52, 54, 0.8)";
        hrLabel.style.boxShadow = "none";
    }

    // 移除提示訊息
    const alertDiv = document.getElementById('human-join-alert');
    if (alertDiv) alertDiv.remove();
}
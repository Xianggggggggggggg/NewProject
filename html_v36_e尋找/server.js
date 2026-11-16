require('dotenv').config();
const express = require('express');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);

// 1. 設定靜態檔案與 JSON 解析 (對應 public 資料夾)
app.use(express.static('public', { index: 'user/lobby.html' }));
app.use(express.json());

// 2. 掛載 API 路由
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);
const companyApiRoutes = require('./routes/company_api');
app.use('/api/company', companyApiRoutes);

// 3. 匯入單人與多人的 WebSocket 模組
const setupWebSocket = require('./services/websocket');
const setupGroupWebSocket = require('./services/group_websocket');

// 建立兩個獨立的 WebSocket Server，並使用 { noServer: true } 讓 HTTP Server 自行處理 upgrade 事件
const wssSingle = setupWebSocket({ noServer: true });
const wssGroup = setupGroupWebSocket({ noServer: true });

// 監聽 HTTP Server 的 upgrade 事件，根據連線 URL 分流
server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/ws/group') {
        // 多人團體面試
        wssGroup.handleUpgrade(request, socket, head, (ws) => {
            wssGroup.emit('connection', ws, request);
        });
    } else if (pathname === '/ws/single' || pathname === '/') {
        // 單人面試 (包含預設根目錄，確保舊版前端完全不影響)
        wssSingle.handleUpgrade(request, socket, head, (ws) => {
            wssSingle.emit('connection', ws, request);
        });
    } else {
        // 無效路徑拒絕連線
        socket.destroy();
    }
});

// 4. 啟動伺服器
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3001;
const fallbackPort = DEFAULT_PORT + 1;

function startServer(port) {
    try {
        server.listen(port, () => {
            console.log(`🚀 伺服器啟動: http://localhost:${port}`);
            console.log(`📡 單人面試 WebSocket 路徑: ws://localhost:${port}/ws/single`);
            console.log(`👥 多人面試 WebSocket 路徑: ws://localhost:${port}/ws/group`);
        });
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            if (port === DEFAULT_PORT) {
                console.warn(`⚠️ 埠 ${port} 已被佔用，嘗試使用 ${fallbackPort}`);
                startServer(fallbackPort);
            } else {
                console.error(`❌ 埠 ${port} 也已被佔用，請手動指定其他埠`);
                process.exit(1);
            }
        } else {
            console.error('❌ 伺服器啟動失敗:', err);
            process.exit(1);
        }
    }
}

startServer(DEFAULT_PORT);
require('dotenv').config();
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

// 1. 設定靜態檔案與 JSON 解析 (對應你的 public 資料夾)
// 👇 加入 { index: 'lobby.html' } 參數，指定大廳為預設首頁
app.use(express.static('public', { index: 'user/lobby.html' }));
app.use(express.json());

// 2. 掛載 API 路由 (報告產出)
// 這樣設定後，前端呼叫就會自動加上 /api，例如 /api/transcript
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);
const companyApiRoutes = require('./routes/company_api');
app.use('/api/company', companyApiRoutes);

// 3. 啟動 WebSocket 服務 (AI 面試連線)
const setupWebSocket = require('./services/websocket');
setupWebSocket(server);

// 4. 啟動伺服器
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3001;
const fallbackPort = DEFAULT_PORT + 1;

function startServer(port) {
    try {
        server.listen(port, () => {
            console.log(`🚀 伺服器啟動: http://localhost:${port}`);
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
require('dotenv').config();
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);

// 1. 設定靜態檔案與 JSON 解析 (對應你的 public 資料夾)
app.use(express.static('public'));
app.use(express.json());

// 2. 掛載 API 路由 (報告產出)
// 這樣設定後，前端呼叫就會自動加上 /api，例如 /api/transcript
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// 3. 啟動 WebSocket 服務 (AI 面試連線)
const setupWebSocket = require('./services/websocket');
setupWebSocket(server);

// 4. 啟動伺服器
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 伺服器啟動: http://localhost:${PORT}`);
});
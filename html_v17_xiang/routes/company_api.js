// 📁 routes/company_api.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// 🌟 核心修復：為企業端建立「絕對隔離」的上帝模式客戶端！
// 加入 auth 設定，強制它永遠不記住登入狀態，確保不受求職者登入的影響
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: { persistSession: false, autoRefreshToken: false }
    }
);

// 1. [新增職缺]
router.post('/jobs', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').insert([req.body]);
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功發佈！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. [讀取職缺列表]
router.get('/jobs', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. [讀取公司資訊] (固定讀取 id=1)
router.get('/profile', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('company_profile').select('*').eq('id', 1).single();
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. [更新公司資訊]
router.put('/profile', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('company_profile').update(req.body).eq('id', 1);
        if (error) throw error;
        res.json({ success: true, message: "公司資訊更新成功！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. [刪除職缺] API
router.delete('/jobs/:id', async (req, res) => {
    const jobId = req.params.id; 
    try {
        const { error } = await supabaseAdmin
            .from('jobs')
            .delete()
            .eq('job_id', jobId); 

        if (error) throw error;
        res.json({ success: true, message: "✅ 職缺已成功刪除！" });
    } catch (err) {
        console.error('❌ 刪除職缺失敗:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. [更新職缺] API
router.put('/jobs/:id', async (req, res) => {
    const jobId = req.params.id; 
    const updatedData = req.body; 
    
    try {
        const { error } = await supabaseAdmin
            .from('jobs')
            .update(updatedData)
            .eq('job_id', jobId); 

        if (error) throw error;
        res.json({ success: true, message: "✅ 職缺已成功更新！" });
    } catch (err) {
        console.error('❌ 更新職缺失敗:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
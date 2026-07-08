// 📁 routes/company_api.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// 🌟 建立企業端上帝模式客戶端
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: { persistSession: false, autoRefreshToken: false }
    }
);

router.post('/jobs', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').insert([req.body]);
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功發佈！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/jobs', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.from('jobs').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/jobs/:id', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').delete().eq('job_id', req.params.id); 
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功刪除！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/jobs/:id', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('jobs').update(req.body).eq('job_id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: "職缺已成功更新！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/profile', async (req, res) => {
    try {
        const { error } = await supabaseAdmin.from('company_profile').update(req.body).eq('id', 1);
        if (error) throw error;
        res.json({ success: true, message: "公司資訊更新成功！" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 🚀 求職者管理專用 API
// ==========================================

// ==========================================
// 🚀 求職者管理專用 API
// ==========================================

// 🌟 抓取「進行中」的面試名單 (戰情室大廳專用)
router.get('/active-sessions', async (req, res) => {
    try {
        // 從資料庫找出所有狀態為「進行中」的房間，順便把應徵者名字也撈出來
        const { data, error } = await supabaseAdmin
            .from('interview_sessions')
            .select('*, applicants(name)') 
            .eq('status', '進行中'); 

        if (error) throw error;
        
        res.json({ success: true, data: data });
    } catch (err) {
        console.error('撈取進行中名單失敗:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 👇 下面接著你原本的 router.get('/applicants', ...)

router.get('/applicants', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('interview_sessions')
            .select(`
                session_id,
                status,
                start_time,
                applicants ( name, email ),
                jobs ( department, job_title ),
                evaluation_reports ( report_id )
            `)
            .order('start_time', { ascending: false });

        if (error) throw error;

        // 🌟 關鍵修復：先過濾 (filter) 掉沒有職缺、沒有部門的髒資料，再進行 map 整理
        const formattedData = data
            .filter(session => session.jobs && session.jobs.department) 
            .map(session => ({
                session_id: session.session_id,
                department: session.jobs.department,
                name: session.applicants?.name || '未知應徵者',
                job_title: session.jobs.job_title,
                status: session.status || 'status-2', 
                hasReport: !!session.evaluation_reports
            }));

        res.json({ success: true, data: formattedData });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/applicants/:session_id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) return res.status(400).json({ success: false, error: '缺少狀態參數' });

        const { error } = await supabaseAdmin
            .from('interview_sessions')
            .update({ status })
            .eq('session_id', req.params.session_id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
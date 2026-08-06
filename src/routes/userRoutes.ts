import { Router } from 'express';
import { UserController } from '../controllers/userController';
import pool from '../config/db'; // 

const router = Router();

// User Routes
router.post('/register', UserController.registerUser);
router.post('/login', UserController.loginUser);
router.get('/profile/:userId', UserController.getUserProfile);

// ==========================================
// 🛡️ ADMIN: Withdrawals 
// ==========================================
router.get('/admin/withdrawals/:secret', async (req, res) => {
    try {
        if (req.params.secret !== "susanth_secret_777") {
            return res.status(401).json({ error: "Unauthorized access!" });
        }
        
        const result = await pool.query('SELECT * FROM withdrawals ORDER BY created_at DESC');
        res.status(200).json({ status: 'success', data: result.rows });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router; // 
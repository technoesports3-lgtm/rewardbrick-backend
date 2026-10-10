import { Router } from 'express';
import path from 'path';
import { AdminController } from '../controllers/adminController';
import { adminLogin, adminLogout, requireAdminSession } from '../middlewares/adminAuth';

const router = Router();
const adminDirectory = path.resolve(__dirname, '../../admin');

router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});
router.get('/', (_req, res) => res.sendFile(path.join(adminDirectory, 'index.html')));
router.get('/admin.css', (_req, res) => res.sendFile(path.join(adminDirectory, 'admin.css')));
router.get('/admin.js', (_req, res) => res.sendFile(path.join(adminDirectory, 'admin.js')));

router.post('/api/login', adminLogin);
router.post('/api/logout', requireAdminSession, adminLogout);
router.get('/api/session', requireAdminSession, AdminController.getSession);
router.use('/api', requireAdminSession);

router.get('/api/dashboard', AdminController.getDashboard);
router.get('/api/users', AdminController.listUsers);
router.patch('/api/users/:userId/status', AdminController.setUserStatus);
router.post('/api/users/:userId/coins', AdminController.adjustUserCoins);
router.get('/api/withdrawals', AdminController.listWithdrawals);
router.patch('/api/withdrawals/:withdrawalId', AdminController.updateWithdrawal);
router.get('/api/tasks', AdminController.listTasks);
router.post('/api/tasks', AdminController.saveTask);
router.put('/api/tasks/:taskId', AdminController.saveTask);
router.get('/api/tasks/legacy', AdminController.listLegacyTasks);
router.patch('/api/tasks/legacy/:taskId', AdminController.updateLegacyTask);
router.get('/api/providers', AdminController.listProviders);
router.put('/api/providers/:providerName', AdminController.updateProvider);
router.get('/api/audit-log', AdminController.listAuditLog);

export default router;

import { Router } from 'express';
import { UserController } from '../controllers/userController';

const router = Router();

router.post('/register', UserController.registerUser);
router.post('/login', UserController.loginUser);
router.get('/profile/:userId', UserController.getUserProfile);
router.get('/stats/:userId', UserController.getUserStats);
router.get('/leaderboard', UserController.getLeaderboard);
router.post('/daily-bonus', UserController.claimDailyBonus);
router.post('/google-register', UserController.googleRegister);
router.post('/withdraw', UserController.requestWithdrawal);
router.get('/withdrawals/history/:userId', UserController.getWithdrawalHistory);
router.get('/wallet/transaction-history/:userId', UserController.getTransactionHistory);
router.get('/wallet/balance/:userId', UserController.getWalletBalance);

export default router;
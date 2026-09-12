import { Router } from 'express';
import { UserController } from '../controllers/userController';

const router = Router();

router.get('/balance/:userId', UserController.getWalletBalance);
router.get('/transaction-history/:userId', UserController.getTransactionHistory);

export default router;

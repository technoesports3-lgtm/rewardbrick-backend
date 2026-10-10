import { Router } from 'express';
import { UserController } from '../controllers/userController';
import { activeUserGuard } from '../middlewares/activeUserGuard';

const router = Router();

router.use(activeUserGuard);
router.get('/balance/:userId', UserController.getWalletBalance);
router.get('/transaction-history/:userId', UserController.getTransactionHistory);

export default router;

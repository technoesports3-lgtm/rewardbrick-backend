import { Router } from 'express';
import { UserController } from '../controllers/userController';

const router = Router();

router.get('/history/:userId', UserController.getWithdrawalHistory);

router.patch('/:withdrawalId/status', (req, res, next) => {
	const adminKey = process.env.ADMIN_API_KEY;
	if (!adminKey || req.header('x-admin-key') !== adminKey) {
		return res.status(401).json({ status: 'error', message: 'Admin authorization required' });
	}
	next();
}, UserController.updateWithdrawalStatus);

export default router;

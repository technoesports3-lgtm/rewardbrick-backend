import { Router } from 'express';
import { UserController } from '../controllers/userController';

const router = Router();

router.post('/register', UserController.registerUser);
router.post('/login', UserController.loginUser);
router.get('/profile/:userId', UserController.getUserProfile);
router.post('/daily-bonus', UserController.claimDailyBonus);
router.post('/google-register', UserController.googleRegister);

export default router;
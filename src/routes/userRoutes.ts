import { Router } from 'express';
import { UserController } from '../controllers/userController';

const router = Router();
router.post('/register', UserController.registerUser);
router.post('/login', UserController.loginUser);
router.get('/profile/:userId', UserController.getUserProfile);
export default router;
import { Router } from 'express';
import { AdminController } from '../controllers/adminController';

const router = Router();

router.get('/banners', AdminController.getPublicBanners);

export default router;

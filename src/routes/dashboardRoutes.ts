import { Router } from 'express';
import { AdminController } from '../controllers/adminController';

const router = Router();

router.get('/banners', AdminController.getPublicBanners);
router.get('/affiliate-posts', AdminController.getPublicAffiliatePosts);
router.get('/redeem-cards', AdminController.getPublicRedeemCards);
router.get('/app-content', AdminController.getPublicAppContent);

export default router;

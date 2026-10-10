import { Router } from 'express';
import { TaskController } from '../controllers/taskController';
import { activeUserGuard } from '../middlewares/activeUserGuard';

const router = Router();

router.get('/list', activeUserGuard, TaskController.listHomeOffers);
router.get('/postback', TaskController.handlePostback);

export default router;
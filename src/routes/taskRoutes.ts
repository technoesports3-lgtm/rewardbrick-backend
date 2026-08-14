import { Router } from 'express';
import { TaskController } from '../controllers/taskController';

const router = Router();

router.get('/list', TaskController.listHomeOffers);
router.get('/postback', TaskController.handlePostback);

export default router;
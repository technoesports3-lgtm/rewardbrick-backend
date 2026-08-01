import { Router } from 'express';
import { TaskController } from '../controllers/taskController';

const router = Router();

router.get('/list', TaskController.listTasks);
router.get('/postback', TaskController.handlePostback);

export default router;
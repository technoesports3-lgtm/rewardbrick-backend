import { Request, Response } from 'express';
import { TaskModel } from '../models/taskModel';
import { UserModel } from '../models/userModel';

export const TaskController = {
    listTasks: async (req: Request, res: Response) => {
        try {
            const tasks = await TaskModel.getAllTasks();
            res.status(200).json({ status: 'success', data: tasks });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    },
    handlePostback: async (req: Request, res: Response) => {
        try {
            const { user_id, task_id, amount, secret_key } = req.query;
            if (secret_key !== process.env.OFFERWALL_SECRET) {
                return res.status(401).send('Unauthorized');
            }
            await UserModel.addCoins(user_id as string, Number(amount), 'task', 'Offerwall Completion');
            await TaskModel.recordTaskCompletion(user_id as string, task_id as string, Number(amount), req.query);
            res.status(200).send('OK');
        } catch (error: any) {
            res.status(500).send('Error');
        }
    }
};
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
    // AdMantum & General Postback Logic
    handlePostback: async (req: Request, res: Response) => {
        try {
            // AdMantum usually sends these parameters
            const { subid, amount, signature, offer_id } = req.query; 

            // 🛡️ SECURITY CHECK:
            // Secret key matches our config
            const secret_key = req.query.secret_key;
            if (secret_key !== "susanth_secret_777") {
                console.log("Unauthorized Postback Attempt!");
                return res.status(401).send('0'); // 0 means fail for offerwalls
            }

            // 1. User ID (subid) 
            // AdMantum  (Amount * 100 or as per your logic)
            const rewardAmount = Math.floor(Number(amount));

            await UserModel.addCoins(
                subid as string, 
                rewardAmount, 
                'task', 
                `OfferWall Task: ${offer_id || 'AdMantum'}`
            );

            console.log(`[MONEY] Credited ${rewardAmount} to User ${subid}`);
            res.status(200).send('1'); // '1' means Success for AdMantum

        } catch (error: any) {
            console.error('Postback Error:', error.message);
            res.status(500).send('0');
        }
    }
};
import { Request, Response } from 'express';
import pool from '../config/db'; // ✅ ఇది మిస్ అయింది, ఇప్పుడు యాడ్ చేశాను
import { TaskModel } from '../models/taskModel';
import { UserModel } from '../models/userModel';

export const TaskController = {
    // 1. హోమ్ పేజీ కోసం అన్ని కేటగిరీల ఆఫర్లని పంపే ఫంక్షన్
    listHomeOffers: async (req: Request, res: Response) => {
        try {
            // In-House / Direct Offers (PhonePe, Amazon, VZY, etc.)
            const tasks = await pool.query('SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC', ['active']);

            // Real Survey & Game Links Structure
            const responseData = {
                categories: [
                    { name: "Survey Earnings", icon: "survey", type: "cpx_survey" },
                    { name: "Prime Surveys", icon: "prime", type: "bitlabs_survey" },
                    { name: "Playtime", icon: "playtime", type: "playtime_ads" },
                    { name: "Games", icon: "games", type: "gamezop" }
                ],
                featured_banners: [
                    { id: 1, title: "PLAY & WIN", image_url: "https://img.freepik.com/free-vector/play-win-banner-with-truck-background_1308-125633.jpg", action_type: "game" },
                    { id: 2, title: "FUSION BLOCK", image_url: "https://via.placeholder.com/350x150", action_type: "offer" }
                ],
                offers: tasks.rows
            };

            res.status(200).json({ status: 'success', data: responseData });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    },

    // 2. AdMantum & General Postback Logic
    handlePostback: async (req: Request, res: Response) => {
        try {
            const { subid, amount, secret_key, offer_id } = req.query; 

            // 🛡️ SECURITY CHECK
            if (secret_key !== "susanth_secret_777") {
                console.log("Unauthorized Postback Attempt!");
                return res.status(401).send('0');
            }

            const rewardAmount = Math.floor(Number(amount));

            await UserModel.addCoins(
                subid as string, 
                rewardAmount, 
                'task', 
                `OfferWall Task: ${offer_id || 'AdMantum'}`
            );

            console.log(`[MONEY] Credited ${rewardAmount} to User ${subid}`);
            res.status(200).send('1');

        } catch (error: any) {
            console.error('Postback Error:', error.message);
            res.status(500).send('0');
        }
    }
};
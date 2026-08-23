import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../config/db';
import { TaskModel } from '../models/taskModel';

const defaultProviderUrls = {
    cpx_research: 'https://offers.cpx-research.com/index.php?app_id=52007&ext_user_id={userId}',
    admantum: 'https://offers.admantum.com/track?user_id={userId}',
    gamezop: 'https://pwa.gamezop.com/g/RewardBrick'
};

const buildProviderLink = (providerName: string, userId?: string) => {
    const normalized = String(providerName || '').toLowerCase();
    const template = defaultProviderUrls[normalized as keyof typeof defaultProviderUrls];

    if (!template) {
        return null;
    }

    if (template.includes('{userId}')) {
        if (userId) {
            return template.replace(/\{userId\}/gi, encodeURIComponent(String(userId)));
        }

        return template;
    }

    return template;
};

export const TaskController = {
    getHomeContent: async (req: Request, res: Response) => {
        try {
            const tasks = await TaskModel.getAllTasks();
            const providerConfigs = await TaskModel.getProviderConfigs();
            const providerMap = providerConfigs.reduce((acc: Record<string, any>, provider: any) => {
                acc[provider.provider_name] = provider;
                return acc;
            }, {});

            const userId = req.query.userId ? String(req.query.userId) : '{userId}';
            const surveyUrl = providerMap.cpx_research?.base_url || defaultProviderUrls.cpx_research;
            const gameUrl = providerMap.gamezop?.base_url || defaultProviderUrls.gamezop;

            const responseData = {
                categories: [
                    { name: 'Survey Earnings', icon: 'survey', type: 'survey', provider_name: 'cpx_research', link_url: surveyUrl.includes('{userId}') ? surveyUrl.replace(/\{userId\}/gi, userId === '{userId}' ? '{userId}' : userId) : surveyUrl },
                    { name: 'Prime Surveys', icon: 'prime', type: 'survey', provider_name: 'admantum', link_url: (providerMap.admantum?.base_url || defaultProviderUrls.admantum).includes('{userId}') ? (providerMap.admantum?.base_url || defaultProviderUrls.admantum).replace(/\{userId\}/gi, userId === '{userId}' ? '{userId}' : userId) : (providerMap.admantum?.base_url || defaultProviderUrls.admantum) },
                    { name: 'Games', icon: 'games', type: 'game', provider_name: 'gamezop', link_url: gameUrl }
                ],
                featured_banners: [
                    { id: 1, title: 'PLAY & WIN', image_url: 'https://img.freepik.com/free-vector/play-win-banner-with-truck-background_1308-125633.jpg', action_type: 'game' },
                    { id: 2, title: 'FUSION BLOCK', image_url: 'https://via.placeholder.com/350x150', action_type: 'offer' }
                ],
                provider_links: {
                    cpx_research: buildProviderLink('cpx_research', userId === '{userId}' ? undefined : userId),
                    admantum: buildProviderLink('admantum', userId === '{userId}' ? undefined : userId),
                    gamezop: buildProviderLink('gamezop', userId === '{userId}' ? undefined : userId)
                },
                offers: tasks.map((task: any) => {
                    const taskType = String(task.task_type || task.provider_name || 'direct').toLowerCase();
                    const providerName = task.provider_name ? String(task.provider_name).toLowerCase() : null;
                    const providerLink = providerName ? buildProviderLink(providerName, userId === '{userId}' ? undefined : userId) : null;

                    return {
                        ...task,
                        task_type: task.task_type || (providerName ? 'external' : 'direct'),
                        provider_name: providerName || 'internal',
                        link_url: providerLink || task.link_url || null
                    };
                })
            };

            res.status(200).json({ status: 'success', data: responseData });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    },

    listHomeOffers: async (req: Request, res: Response) => {
        return TaskController.getHomeContent(req, res);
    },

    handlePostback: async (req: Request, res: Response) => {
        let client: PoolClient | undefined;

        try {
            const { amount, subid, secret_key, task_id, offer_id } = req.query;
            const targetUserId = typeof subid === 'string' ? subid.trim() : '';
            const rawAmount = typeof amount === 'string' ? amount : '';

            console.log('Incoming Postback:', { subid: targetUserId, amount: rawAmount });

            if (typeof secret_key !== 'string' || secret_key !== 'susanth_secret_777') {
                return res.status(401).send('0');
            }

            if (!targetUserId) {
                return res.status(400).send('0');
            }

            const rewardAmount = Math.round(parseFloat(rawAmount));
            if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
                return res.status(400).send('0');
            }

            client = await pool.connect();
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE',
                [targetUserId]
            );

            if (userResult.rowCount === 0) {
                console.warn('User Not Found:', targetUserId);
                await client.query('ROLLBACK');
                return res.status(404).send('0');
            }

            const updateResult = await client.query(
                'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE user_id = $2 RETURNING wallet_balance',
                [rewardAmount, targetUserId]
            );
            const newBalance = updateResult.rows[0].wallet_balance;
            const source = `Offerwall - ${offer_id || task_id || 'postback'}`;

            await client.query(
                'INSERT INTO transactions (user_id, amount, transaction_type, source, balance_after) VALUES ($1, $2, $3, $4, $5)',
                [targetUserId, rewardAmount, 'task', source, newBalance]
            );
            await client.query(
                'INSERT INTO activity_logs (user_id, activity_type) VALUES ($1, $2)',
                [targetUserId, 'offerwall_completion']
            );

            await client.query('COMMIT');
            console.log('Success:', { userId: targetUserId, amount: rewardAmount, newBalance });
            return res.status(200).send('1');
        } catch (error: any) {
            if (client) {
                await client.query('ROLLBACK').catch((rollbackError: Error) => {
                    console.error('Postback Rollback Error:', rollbackError.message);
                });
            }
            console.error('Postback Error:', error.message);
            return res.status(500).send('0');
        } finally {
            client?.release();
        }
    }
};
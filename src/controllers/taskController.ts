import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../config/db';
import { TaskModel } from '../models/taskModel';
import { AdMobSsvVerificationError, verifyAdMobSsvCallback } from '../services/admobSsv';

const USER_REWARD_SHARE = 0.25;
const ADMANTUM_GROSS_REWARD_COINS = 400;

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
            const [tasks, providerConfigs, managedTasks] = await Promise.all([
                TaskModel.getAllTasks(),
                TaskModel.getProviderConfigs(),
                TaskModel.getManagedTasks(),
            ]);
            const providerMap = providerConfigs.reduce((acc: Record<string, any>, provider: any) => {
                acc[provider.provider_name] = provider;
                return acc;
            }, {});

            const userId = req.query.userId ? String(req.query.userId) : '{userId}';
            const surveyUrl = providerMap.cpx_research?.base_url || defaultProviderUrls.cpx_research;
            const gameUrl = providerMap.gamezop?.base_url || defaultProviderUrls.gamezop;
            const userRewardForProvider = (providerName: string): number => {
                const configuredGross = providerMap[providerName]?.reward_coins;
                const grossCoins = configuredGross !== null && configuredGross !== undefined
                    ? Number(configuredGross)
                    : providerName === 'admantum'
                        ? ADMANTUM_GROSS_REWARD_COINS
                        : null;
                return grossCoins !== null && Number.isSafeInteger(grossCoins)
                    ? Math.floor(grossCoins * USER_REWARD_SHARE)
                    : 0;
            };

            const responseData = {
                categories: [
                    { name: 'Survey Earnings', icon: 'survey', type: 'survey', provider_name: 'cpx_research', link_url: surveyUrl.includes('{userId}') ? surveyUrl.replace(/\{userId\}/gi, userId === '{userId}' ? '{userId}' : userId) : surveyUrl },
                    { name: 'Prime Surveys', icon: 'prime', type: 'survey', provider_name: 'admantum', link_url: (providerMap.admantum?.base_url || defaultProviderUrls.admantum).includes('{userId}') ? (providerMap.admantum?.base_url || defaultProviderUrls.admantum).replace(/\{userId\}/gi, userId === '{userId}' ? '{userId}' : userId) : (providerMap.admantum?.base_url || defaultProviderUrls.admantum) },
                    { name: 'Games', icon: 'games', type: 'game', provider_name: 'gamezop', link_url: gameUrl }
                ],
                provider_links: {
                    cpx_research: buildProviderLink('cpx_research', userId === '{userId}' ? undefined : userId),
                    admantum: buildProviderLink('admantum', userId === '{userId}' ? undefined : userId),
                    gamezop: buildProviderLink('gamezop', userId === '{userId}' ? undefined : userId)
                },
                offers: [
                    ...tasks.map((task: any) => {
                        const taskType = String(task.task_type || task.provider_name || 'direct').toLowerCase();
                        const providerName = task.provider_name ? String(task.provider_name).toLowerCase() : null;
                        const providerLink = providerName
                            ? buildProviderLink(providerName, userId === '{userId}' ? undefined : userId)
                            : null;

                        return {
                            ...task,
                            offer_virtual_currency: providerName && providerName !== 'internal'
                                ? userRewardForProvider(providerName)
                                : task.reward_coins ??
                                    task.reward_amount ??
                                    task.offer_virtual_currency ??
                                    task.coins ??
                                    task.payout ??
                                    0,
                            task_type: task.task_type || (providerName ? 'external' : 'direct'),
                            provider_name: providerName || 'internal',
                            link_url: providerLink || task.link_url || null
                        };
                    }),
                    ...managedTasks.map((task: any) => ({
                        id: task.id,
                        offer_title: task.title,
                        offer_description: task.description,
                        offer_type: task.provider_name,
                        offer_virtual_currency:
                            userRewardForProvider(String(task.provider_name).toLowerCase()),
                        offer_image: task.image_url,
                        offer_link: task.offer_url,
                        open_in: task.open_in || 'auto',
                        task_type: 'external',
                        provider_name: task.provider_name,
                        source: 'admin_managed',
                    })),
                ]
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
            const providerSecret = typeof secret_key === 'string' ? secret_key : '';

            if (!providerSecret) {
                return res.status(401).send('0');
            }

            const provider = await TaskModel.getProviderBySecret(providerSecret);
            if (!provider) {
                return res.status(401).send('0');
            }
            const providerName = String(provider.provider_name);

            if (!targetUserId) {
                return res.status(400).send('0');
            }

            const providerPayout = Number(rawAmount);
            if (!Number.isFinite(providerPayout) || providerPayout <= 0) {
                return res.status(400).send('0');
            }

            const grossRewardCoins = provider.reward_coins !== null && provider.reward_coins !== undefined
                ? Number(provider.reward_coins)
                : providerName.toLowerCase() === 'admantum'
                    ? ADMANTUM_GROSS_REWARD_COINS
                    : null;
            const rewardAmount = grossRewardCoins === null
                ? 0
                : Math.floor(grossRewardCoins * USER_REWARD_SHARE);
            if (grossRewardCoins === null ||
                !Number.isSafeInteger(grossRewardCoins) ||
                !Number.isSafeInteger(rewardAmount) ||
                rewardAmount <= 0) {
                return res.status(400).send('0');
            }

            client = await pool.connect();
            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT user_id, is_active FROM users WHERE user_id = $1 FOR UPDATE',
                [targetUserId]
            );

            if (userResult.rowCount === 0) {
                console.warn('User Not Found:', targetUserId);
                await client.query('ROLLBACK');
                return res.status(404).send('0');
            }
            if (!userResult.rows[0].is_active) {
                await client.query('ROLLBACK');
                return res.status(403).send('0');
            }

            const transactionIdValue = req.query.transaction_id ??
                req.query.transactionId ??
                req.query.txid ??
                req.query.event_id;
            const transactionId = typeof transactionIdValue === 'string'
                ? transactionIdValue.trim()
                : '';
            if (transactionId) {
                const eventResult = await client.query(
                    `INSERT INTO provider_postback_events (provider_name, transaction_id)
                     VALUES ($1, $2)
                     ON CONFLICT (provider_name, transaction_id) DO NOTHING
                     RETURNING id`,
                    [providerName, transactionId]
                );
                if (eventResult.rowCount === 0) {
                    await client.query('COMMIT');
                    return res.status(200).send('1');
                }
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
            console.log('Postback credited:', {
                userId: targetUserId,
                provider: providerName,
                coins: rewardAmount,
                newBalance,
            });
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
    },

    handleAdMobSsv: async (req: Request, res: Response) => {
        const expectedAdUnitId = process.env.ADMOB_REWARDED_AD_UNIT_ID;
        if (!expectedAdUnitId) {
            return res.status(503).send('SSV is not configured.');
        }

        let callback: URLSearchParams;
        try {
            callback = await verifyAdMobSsvCallback(req.originalUrl);
        } catch (error) {
            if (error instanceof AdMobSsvVerificationError) {
                return res.status(401).send('Invalid AdMob callback.');
            }
            console.error('AdMob SSV key verification failed:', error);
            return res.status(503).send('Unable to verify AdMob callback.');
        }

        const adUnitId = callback.get('ad_unit') ?? '';
        const userId = callback.get('user_id') ?? '';
        const sessionId = callback.get('custom_data') ?? '';
        const transactionId = callback.get('transaction_id') ?? '';
        const rawTimestamp = Number(callback.get('timestamp'));
        const timestamp = rawTimestamp >= 100_000_000_000_000
            ? Math.floor(rawTimestamp / 1000)
            : rawTimestamp;
        const callbackTime = new Date(timestamp);
        if (adUnitId !== expectedAdUnitId ||
            !userId ||
            !sessionId ||
            !transactionId ||
            !Number.isSafeInteger(timestamp) ||
            Number.isNaN(callbackTime.getTime()) ||
            callbackTime.getTime() > Date.now() + 5 * 60 * 1000 ||
            Date.now() - callbackTime.getTime() > 24 * 60 * 60 * 1000 ||
            callback.get('reward_amount') !== '1' ||
            callback.get('reward_item') !== 'daily_bonus_ad') {
            return res.status(400).send('Invalid AdMob reward callback.');
        }

        let client: PoolClient | undefined;
        try {
            client = await pool.connect();
            await client.query('BEGIN');

            const duplicate = await client.query(
                'SELECT transaction_id FROM daily_bonus_ad_events WHERE transaction_id = $1',
                [transactionId]
            );
            if (duplicate.rowCount) {
                await client.query('COMMIT');
                return res.status(200).send('OK');
            }

            const sessionOwner = await client.query(
                `SELECT user_id FROM daily_bonus_sessions WHERE id = $1`,
                [sessionId]
            );
            if (sessionOwner.rowCount === 0 || sessionOwner.rows[0].user_id !== userId) {
                await client.query('ROLLBACK');
                return res.status(400).send('Unknown or expired reward session.');
            }

            const userResult = await client.query(
                'SELECT is_active FROM users WHERE user_id = $1 FOR UPDATE',
                [userId]
            );
            if (!userResult.rows[0]?.is_active) {
                await client.query('ROLLBACK');
                return res.status(403).send('User is not eligible.');
            }

            const sessionResult = await client.query(
                `SELECT verified_ads, status, created_at
                 FROM daily_bonus_sessions WHERE id = $1 FOR UPDATE`,
                [sessionId]
            );
            if (sessionResult.rows[0].status !== 'pending') {
                await client.query('COMMIT');
                return res.status(200).send('OK');
            }
            if (new Date(sessionResult.rows[0].created_at).getTime() <
                Date.now() - 24 * 60 * 60 * 1000) {
                await client.query(
                    `UPDATE daily_bonus_sessions
                     SET status = 'expired', updated_at = NOW()
                     WHERE id = $1`,
                    [sessionId]
                );
                await client.query('COMMIT');
                return res.status(200).send('OK');
            }

            const recentClaim = await client.query(
                `SELECT id FROM activity_logs
                 WHERE user_id = $1 AND activity_type = 'daily_bonus'
                   AND created_at > NOW() - INTERVAL '24 hours'
                 LIMIT 1`,
                [userId]
            );
            if (recentClaim.rowCount) {
                await client.query(
                    `UPDATE daily_bonus_sessions
                     SET status = 'expired', updated_at = NOW()
                     WHERE id = $1`,
                    [sessionId]
                );
                await client.query('COMMIT');
                return res.status(200).send('OK');
            }

            const eventResult = await client.query(
                `INSERT INTO daily_bonus_ad_events (transaction_id, session_id)
                 VALUES ($1, $2)
                 ON CONFLICT (transaction_id) DO NOTHING
                 RETURNING transaction_id`,
                [transactionId, sessionId]
            );
            if (eventResult.rowCount === 0) {
                await client.query('COMMIT');
                return res.status(200).send('OK');
            }
            const updatedSession = await client.query(
                `UPDATE daily_bonus_sessions
                 SET verified_ads = verified_ads + 1, updated_at = NOW()
                 WHERE id = $1 RETURNING verified_ads`,
                [sessionId]
            );

            if (Number(updatedSession.rows[0].verified_ads) >= 3) {
                const balanceResult = await client.query(
                    `UPDATE users SET wallet_balance = wallet_balance + 5
                     WHERE user_id = $1 RETURNING wallet_balance`,
                    [userId]
                );
                await client.query(
                    `INSERT INTO transactions
                        (user_id, amount, transaction_type, source, balance_after)
                     VALUES ($1, 5, 'daily_bonus', 'Daily bonus (3 verified ads)', $2)`,
                    [userId, balanceResult.rows[0].wallet_balance]
                );
                await client.query(
                    `INSERT INTO activity_logs (user_id, activity_type)
                     VALUES ($1, 'daily_bonus')`,
                    [userId]
                );
                await client.query(
                    `UPDATE daily_bonus_sessions
                     SET status = 'claimed', updated_at = NOW()
                     WHERE id = $1`,
                    [sessionId]
                );
            }

            await client.query('COMMIT');
            return res.status(200).send('OK');
        } catch (error) {
            if (client) {
                await client.query('ROLLBACK').catch((rollbackError: Error) => {
                    console.error('AdMob SSV rollback failed:', rollbackError.message);
                });
            }
            console.error('AdMob SSV reward processing failed:', error);
            return res.status(500).send('Reward callback processing failed.');
        } finally {
            client?.release();
        }
    }
};
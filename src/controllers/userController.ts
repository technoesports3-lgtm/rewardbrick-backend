import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/userModel';
import pool from '../config/db';
import { randomUUID } from 'crypto';

const toNumber = (value: any): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
};

const rankedEarningsQuery = `
    WITH user_earnings AS (
        SELECT u.user_id,
               u.full_name,
               COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS coins_earned
        FROM users u
        LEFT JOIN transactions t ON t.user_id = u.user_id
        WHERE u.is_active = TRUE
        GROUP BY u.user_id, u.full_name
    ),
    ranked_users AS (
        SELECT user_id,
               full_name,
               coins_earned,
               ROW_NUMBER() OVER (ORDER BY coins_earned DESC, user_id ASC) AS rank
        FROM user_earnings
    )
`;

export const UserController = {
    registerUser: async (req: Request, res: Response) => {
        try {
            const { email, full_name, password } = req.body;

            if (!email || !full_name || !password) {
                return res.status(400).json({ status: 'error', message: 'All fields are required!' });
            }
            if (password.length < 6) {
                return res.status(400).json({ status: 'error', message: 'Password must be 6+ characters!' });
            }

            const existingUser = await UserModel.findByEmail(email);
            if (existingUser) {
                return res.status(400).json({ status: 'error', message: 'An account already exists with this email.' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const referralCode = 'RB' + Math.floor(100000 + Math.random() * 900000);

            const newUser = await UserModel.createUser(email, full_name, referralCode, hashedPassword);
            return res.status(201).json({ status: 'success', user: newUser });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    },

    loginUser: async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ status: 'error', message: 'Email and Password are required!' });
            }

            const user = await UserModel.findByEmail(email);
            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found!' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ status: 'error', message: 'Invalid Credentials!' });
            }

            if (user.is_active === false) {
                return res.status(403).json({
                    status: 'error',
                    message: 'This account is currently suspended. Please contact support.',
                });
            }

            return res.status(200).json({ status: 'success', user });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: 'Server Login Error' });
        }
    },

    getUserProfile: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const result = await pool.query(
                `SELECT u.user_id, u.email, u.full_name, u.wallet_balance,
                        u.referral_code, u.created_at,
                        COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS coins_earned,
                        COALESCE(SUM(ABS(t.amount)) FILTER (WHERE t.amount < 0), 0) AS coins_redeemed,
                        COUNT(*) FILTER (
                            WHERE t.transaction_type IN ('task', 'offerwall_completion')
                               OR t.source ILIKE '%offer%'
                        ) AS offers_completed
                 FROM users u
                 LEFT JOIN transactions t ON t.user_id = u.user_id
                 WHERE u.user_id = $1
                 GROUP BY u.user_id`,
                [userId]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const profile = result.rows[0];
            const stats = {
                coins_earned: toNumber(profile.coins_earned),
                coins_redeemed: toNumber(profile.coins_redeemed),
                offers_completed: toNumber(profile.offers_completed),
            };
            const user = {
                user_id: profile.user_id,
                email: profile.email,
                full_name: profile.full_name,
                wallet_balance: profile.wallet_balance,
                referral_code: profile.referral_code,
                created_at: profile.created_at,
            };
            return res.status(200).json({ status: 'success', user, stats });
        } catch (e: any) {
            return res.status(500).json({ error: e.message });
        }
    },

    getUserStats: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }

            const earningsResult = await pool.query(
                `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS coins_earned,
                        COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS coins_redeemed
                 FROM transactions WHERE user_id = $1`,
                [userId]
            );

            const offersResult = await pool.query(
                `SELECT COUNT(*) AS offers_completed
                 FROM transactions
                 WHERE user_id = $1 AND (transaction_type IN ('task', 'offerwall_completion') OR source ILIKE '%offer%')`,
                [userId]
            );

            const stats = {
                coins_earned: toNumber(earningsResult.rows[0]?.coins_earned ?? 0),
                coins_redeemed: toNumber(earningsResult.rows[0]?.coins_redeemed ?? 0),
                offers_completed: toNumber(offersResult.rows[0]?.offers_completed ?? 0),
                member_since: user.created_at || user.createdAt || null,
                total_earned: toNumber(earningsResult.rows[0]?.coins_earned ?? 0),
                total_redeemed: toNumber(earningsResult.rows[0]?.coins_redeemed ?? 0),
            };

            return res.status(200).json({ status: 'success', stats });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    getLeaderboard: async (req: Request, res: Response) => {
        const rawLimit = req.query.limit ?? '50';
        const rawOffset = req.query.offset ?? '0';
        const userId = req.query.userId;
        const limit = Number(rawLimit);
        const offset = Number(rawOffset);

        if (
            (typeof userId !== 'undefined' && typeof userId !== 'string') ||
            (typeof userId === 'string' && userId.trim() === '') ||
            (typeof rawLimit !== 'string' && typeof rawLimit !== 'number') ||
            (typeof rawOffset !== 'string' && typeof rawOffset !== 'number') ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            !Number.isInteger(offset) ||
            offset < 0
        ) {
            return res.status(400).json({
                status: 'error',
                message: 'A valid userId, limit (1-100), and non-negative offset are required.',
            });
        }

        try {
            const [leaderboardResult, countResult, currentUserResult] = await Promise.all([
                pool.query(
                    `${rankedEarningsQuery}
                     SELECT user_id, full_name, coins_earned, rank
                     FROM ranked_users
                     ORDER BY rank
                     LIMIT $1 OFFSET $2`,
                    [limit, offset]
                ),
                pool.query('SELECT COUNT(*) AS total_users FROM users'),
                typeof userId === 'string'
                    ? pool.query(
                        `${rankedEarningsQuery}
                         SELECT rank, coins_earned
                         FROM ranked_users
                         WHERE user_id = $1`,
                        [userId]
                    )
                    : Promise.resolve({ rows: [] }),
            ]);

            const totalUsers = Number(countResult.rows[0]?.total_users ?? 0);
            const currentUser = currentUserResult.rows[0];
            const entries = leaderboardResult.rows.map((entry) => ({
                rank: Number(entry.rank),
                name: String(entry.full_name ?? '').trim() || 'Member',
                coins_earned: Number(entry.coins_earned),
                is_current_user: typeof userId === 'string' && entry.user_id === userId,
            }));

            return res.status(200).json({
                status: 'success',
                entries,
                current_user_rank: currentUser ? Number(currentUser.rank) : null,
                current_user_coins: currentUser ? Number(currentUser.coins_earned) : null,
                total_users: totalUsers,
                has_more: offset + entries.length < totalUsers,
            });
        } catch (e: any) {
            console.error(
                'Leaderboard query failed:',
                e instanceof Error ? e.message : 'Unknown error'
            );
            return res.status(500).json({
                status: 'error',
                message: 'Unable to load leaderboard.',
            });
        }
    },

    getWalletBalance: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const user = await UserModel.findById(userId);
            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }

            const balance = toNumber(user.wallet_balance ?? 0);
            const earned = await pool.query(
                `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_earned
                 FROM transactions WHERE user_id = $1`,
                [userId]
            );
            const redeemed = await pool.query(
                `SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS total_redeemed
                 FROM transactions WHERE user_id = $1`,
                [userId]
            );
            const pending = await pool.query(
                `SELECT COALESCE(SUM(amount_coins), 0) AS pending_withdrawals
                 FROM withdrawals WHERE user_id = $1 AND status = 'pending'`,
                [userId]
            );

            return res.status(200).json({
                status: 'success',
                balance,
                total_earned: toNumber(earned.rows[0]?.total_earned ?? 0),
                total_redeemed: toNumber(redeemed.rows[0]?.total_redeemed ?? 0),
                pending_withdrawals: toNumber(pending.rows[0]?.pending_withdrawals ?? 0),
            });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    googleRegister: async (req: Request, res: Response) => {
        try {
            const { name, email } = req.body;

            let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

            if (user.rows.length === 0) {
                const refCode = 'RB' + Math.floor(Math.random() * 900000);
                const newUser = await pool.query(
                    'INSERT INTO users (full_name, email, referral_code) VALUES ($1, $2, $3) RETURNING *',
                    [name, email, refCode]
                );
                user = newUser;
            }

            if (user.rows[0].is_active === false) {
                return res.status(403).json({
                    status: 'error',
                    message: 'This account is currently suspended. Please contact support.',
                });
            }

            return res.status(200).json({ status: 'success', user: user.rows[0] });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    getTransactionHistory: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const result = await pool.query(
                `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
                [userId]
            );

            return res.status(200).json({ status: 'success', transactions: result.rows });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    getWalletActivity: async (req: Request, res: Response) => {
        const userId = req.params.userId as string;
        const limit = Number(req.query.limit ?? 30);
        const offset = Number(req.query.offset ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
            !Number.isInteger(offset) || offset < 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Provide a limit from 1 to 50 and a non-negative offset.',
            });
        }

        try {
            const result = await pool.query(
                `SELECT activity_type, activity_id, created_at, amount_coins,
                        title, status, voucher_reference
                 FROM (
                    SELECT 'transaction'::TEXT AS activity_type,
                           t.id::TEXT AS activity_id,
                           t.created_at,
                           t.amount::NUMERIC AS amount_coins,
                           COALESCE(NULLIF(t.source, ''), t.transaction_type) AS title,
                           t.transaction_type AS status,
                           NULL::TEXT AS voucher_reference
                    FROM transactions t
                    WHERE t.user_id = $1
                    UNION ALL
                    SELECT 'withdrawal'::TEXT AS activity_type,
                           w.id::TEXT AS activity_id,
                           w.created_at,
                           -w.amount_coins::NUMERIC AS amount_coins,
                           COALESCE(rc.title, w.method) || ' redemption' AS title,
                           w.status,
                           w.voucher_reference
                    FROM withdrawals w
                    LEFT JOIN redeem_cards rc ON rc.id = w.redeem_card_id
                    WHERE w.user_id = $1
                 ) AS wallet_activity
                 ORDER BY created_at DESC, activity_type ASC, activity_id DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit + 1, offset]
            );
            const hasMore = result.rows.length > limit;
            return res.status(200).json({
                status: 'success',
                activity: result.rows.slice(0, limit),
                has_more: hasMore,
            });
        } catch (error) {
            console.error('Wallet activity could not be loaded:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Could not load wallet activity.',
            });
        }
    },

    getWithdrawalHistory: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const result = await pool.query(
                `SELECT w.*, rc.title AS card_title, rc.denomination_inr
                 FROM withdrawals w
                 LEFT JOIN redeem_cards rc ON rc.id = w.redeem_card_id
                 WHERE w.user_id = $1 ORDER BY w.created_at DESC LIMIT 20`,
                [userId]
            );

            return res.status(200).json({ status: 'success', withdrawals: result.rows });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    requestRedemption: async (req: Request, res: Response) => {
        const client = await pool.connect();
        try {
            const { user_id, userId, redeem_card_id } = req.body;
            const targetUserId = String(user_id || userId || '');
            const cardId = Number(redeem_card_id);

            if (!targetUserId || !Number.isSafeInteger(cardId) || cardId < 1) {
                return res.status(400).json({ status: 'error', message: 'A user and valid redemption card are required.' });
            }

            await client.query('BEGIN');

            const cardResult = await client.query(
                `SELECT id, title, denomination_inr, coins_required, minimum_coins
                 FROM redeem_cards WHERE id = $1 AND is_active = TRUE FOR SHARE`,
                [cardId]
            );
            if (cardResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'This redemption card is no longer available.' });
            }
            const card = cardResult.rows[0];
            const targetAmount = toNumber(card.coins_required);

            const userResult = await client.query(
                'SELECT wallet_balance FROM users WHERE user_id = $1 FOR UPDATE',
                [targetUserId]
            );
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }

            const currentBalance = toNumber(userResult.rows[0].wallet_balance ?? 0);
            if (currentBalance < toNumber(card.minimum_coins)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    status: 'error',
                    message: `This card requires at least ${card.minimum_coins} coins in your wallet.`,
                });
            }
            if (currentBalance < targetAmount) {
                await client.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });
            }

            const updateResult = await client.query(
                'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE user_id = $2 RETURNING wallet_balance',
                [targetAmount, targetUserId]
            );
            const newBalance = toNumber(updateResult.rows[0]?.wallet_balance ?? 0);

            const withdrawalResult = await client.query(
                `INSERT INTO withdrawals
                    (user_id, amount_coins, method, redeem_card_id, status)
                 VALUES ($1, $2, 'gift_card', $3, 'pending') RETURNING *`,
                [targetUserId, targetAmount, cardId]
            );

            await client.query(
                'INSERT INTO transactions (user_id, amount, transaction_type, source, balance_after) VALUES ($1, $2, $3, $4, $5)',
                [targetUserId, -targetAmount, 'withdrawal', `Gift card redemption: ${card.title}`, newBalance]
            );

            await client.query('COMMIT');

            return res.status(200).json({
                status: 'success',
                message: 'Redemption request submitted. The admin will send your voucher after review.',
                withdrawal: withdrawalResult.rows[0],
                new_balance: newBalance,
            });
        } catch (e: any) {
            await client.query('ROLLBACK').catch(() => undefined);
            return res.status(500).json({ status: 'error', message: e.message });
        } finally {
            client.release();
        }
    },

    updateWithdrawalStatus: async (req: Request, res: Response) => {
        const client = await pool.connect();
        try {
            const withdrawalId = Number(req.params.withdrawalId);
            const { status } = req.body;
            const voucherReference = typeof req.body?.voucher_reference === 'string'
                ? req.body.voucher_reference.trim()
                : '';

            if (!Number.isInteger(withdrawalId) || !['completed', 'failed'].includes(status) ||
                (status === 'completed' && (voucherReference.length < 4 || voucherReference.length > 500))) {
                return res.status(400).json({
                    status: 'error',
                    message: 'A valid withdrawal ID and status are required; voucher code/reference is required to complete a redemption.',
                });
            }

            await client.query('BEGIN');
            const withdrawalResult = await client.query(
                'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
                [withdrawalId]
            );
            if (withdrawalResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Withdrawal not found' });
            }

            const withdrawal = withdrawalResult.rows[0];
            if (withdrawal.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    status: 'error',
                    message: `Withdrawal is already ${withdrawal.status}`,
                });
            }

            if (status === 'failed') {
                const userResult = await client.query(
                    `UPDATE users SET wallet_balance = wallet_balance + $1
                     WHERE user_id = $2 RETURNING wallet_balance`,
                    [withdrawal.amount_coins, withdrawal.user_id]
                );
                if (userResult.rows.length === 0) {
                    throw new Error('User for withdrawal not found');
                }

                await client.query(
                    `INSERT INTO transactions
                        (user_id, amount, transaction_type, source, balance_after)
                     VALUES ($1, $2, 'withdrawal_refund', 'Failed Withdrawal Refund', $3)`,
                    [withdrawal.user_id, withdrawal.amount_coins, userResult.rows[0].wallet_balance]
                );
            }

            const updatedResult = await client.query(
                `UPDATE withdrawals
                 SET status = $1,
                     voucher_reference = CASE WHEN $1 = 'completed' THEN $2 ELSE voucher_reference END,
                     completed_at = NOW()
                 WHERE id = $3 RETURNING *`,
                [status, voucherReference, withdrawalId]
            );
            await client.query('COMMIT');

            return res.status(200).json({
                status: 'success',
                withdrawal: updatedResult.rows[0],
            });
        } catch (e: any) {
            await client.query('ROLLBACK').catch(() => undefined);
            return res.status(500).json({ status: 'error', message: e.message });
        } finally {
            client.release();
        }
    },

    startDailyBonusSession: async (req: Request, res: Response) => {
        const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
        if (!userId) return res.status(400).json({ status: 'error', message: 'User ID required.' });
        if (!process.env.ADMOB_REWARDED_AD_UNIT_ID) {
            return res.status(503).json({
                status: 'error',
                message: 'Server-verified daily rewards are not configured.',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const userResult = await client.query(
                'SELECT user_id FROM users WHERE user_id = $1 AND is_active = TRUE FOR UPDATE',
                [userId]
            );
            if (userResult.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'User not found.' });
            }

            const lastClaim = await client.query(
                `SELECT created_at FROM activity_logs
                 WHERE user_id = $1 AND activity_type = 'daily_bonus'
                   AND created_at > NOW() - INTERVAL '24 hours'
                 ORDER BY created_at DESC LIMIT 1`,
                [userId]
            );
            if (lastClaim.rowCount) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    status: 'error',
                    message: 'Come back tomorrow for your next bonus.',
                });
            }

            await client.query(
                `UPDATE daily_bonus_sessions SET status = 'expired', updated_at = NOW()
                 WHERE user_id = $1 AND status = 'pending'
                   AND created_at <= NOW() - INTERVAL '24 hours'`,
                [userId]
            );
            const pendingSession = await client.query(
                `SELECT id, verified_ads FROM daily_bonus_sessions
                 WHERE user_id = $1 AND status = 'pending'
                   AND created_at > NOW() - INTERVAL '24 hours'
                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
                [userId]
            );
            if (pendingSession.rowCount) {
                await client.query('COMMIT');
                return res.status(200).json({
                    status: 'success',
                    session_id: pendingSession.rows[0].id,
                    verified_ads: Number(pendingSession.rows[0].verified_ads),
                    required_ads: 3,
                    reward_coins: 5,
                });
            }

            const sessionId = randomUUID();
            const insertedSession = await client.query(
                `INSERT INTO daily_bonus_sessions (id, user_id, reward_day)
                 VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC')::DATE)
                 ON CONFLICT (user_id, reward_day) DO NOTHING
                 RETURNING id, verified_ads, status`,
                [sessionId, userId]
            );
            const session = insertedSession.rowCount
                ? insertedSession.rows[0]
                : (await client.query(
                    `SELECT id, verified_ads, status FROM daily_bonus_sessions
                     WHERE user_id = $1
                       AND reward_day = (NOW() AT TIME ZONE 'UTC')::DATE
                     FOR UPDATE`,
                    [userId]
                )).rows[0];
            if (!session || session.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    status: 'error',
                    message: 'Come back tomorrow for your next bonus.',
                });
            }
            await client.query('COMMIT');
            return res.status(200).json({
                status: 'success',
                session_id: session.id,
                verified_ads: Number(session.verified_ads),
                required_ads: 3,
                reward_coins: 5,
            });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Daily bonus session rollback failed:', rollbackError.message);
            });
            console.error('Daily bonus session could not be started:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Could not start the daily bonus. Please try again.',
            });
        } finally {
            client.release();
        }
    },

    getDailyBonusSession: async (req: Request, res: Response) => {
        const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : '';
        const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
        if (!sessionId || !userId) {
            return res.status(400).json({ status: 'error', message: 'A valid session and user are required.' });
        }

        try {
            const result = await pool.query(
                `SELECT verified_ads, status FROM daily_bonus_sessions
                 WHERE id = $1 AND user_id = $2`,
                [sessionId, userId]
            );
            if (result.rowCount === 0) {
                return res.status(404).json({ status: 'error', message: 'Daily bonus session not found.' });
            }
            return res.status(200).json({
                status: 'success',
                verified_ads: Number(result.rows[0].verified_ads),
                required_ads: 3,
                claimed: result.rows[0].status === 'claimed',
            });
        } catch (error) {
            console.error('Daily bonus session status could not be loaded:', error);
            return res.status(500).json({
                status: 'error',
                message: 'Could not check the daily bonus status.',
            });
        }
    }
};
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/userModel';
import pool from '../config/db';

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
            const { email, full_name, device_id, password } = req.body;

            if (!email || !full_name || !password || !device_id) {
                return res.status(400).json({ status: 'error', message: 'All fields are required!' });
            }
            if (password.length < 6) {
                return res.status(400).json({ status: 'error', message: 'Password must be 6+ characters!' });
            }

            const existingUser = await UserModel.findByEmailOrDevice(email, device_id);
            if (existingUser) {
                return res.status(400).json({ status: 'error', message: 'User already exists with this Email or Device!' });
            }

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const referralCode = 'RB' + Math.floor(100000 + Math.random() * 900000);

            const newUser = await UserModel.createUser(email, full_name, device_id, referralCode, hashedPassword);
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

            const user = await UserModel.findByEmailOrDevice(email, '');
            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found!' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ status: 'error', message: 'Invalid Credentials!' });
            }

            return res.status(200).json({ status: 'success', user });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: 'Server Login Error' });
        }
    },

    getUserProfile: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const user = await UserModel.findById(userId);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            return res.status(200).json({ status: 'success', user });
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
                 WHERE user_id = $1 AND (transaction_type IN ('task', 'offerwall_completion', 'daily_bonus') OR source ILIKE '%offer%')`,
                [userId]
            );

            const stats = {
                coins_earned: toNumber(earningsResult.rows[0]?.coins_earned ?? 0),
                coins_redeemed: toNumber(earningsResult.rows[0]?.coins_redeemed ?? 0),
                offers_completed: toNumber(offersResult.rows[0]?.offers_completed ?? 0),
                offers_tried: toNumber(offersResult.rows[0]?.offers_completed ?? 0),
                referrals: 0,
                member_since: user.created_at || user.createdAt || null,
                streak_days: 1,
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
                name: String(entry.full_name ?? '').trim() || 'Player',
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
            const { name, email, device_id } = req.body;

            const userByDevice = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
            if (userByDevice.rows.length > 0 && userByDevice.rows[0].email !== email) {
                return res.status(403).json({ status: 'error', message: 'Only one account per device is allowed!' });
            }

            let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

            if (user.rows.length === 0) {
                const refCode = 'RB' + Math.floor(Math.random() * 900000);
                const newUser = await pool.query(
                    'INSERT INTO users (full_name, email, device_id, referral_code) VALUES ($1, $2, $3, $4) RETURNING *',
                    [name, email, device_id, refCode]
                );
                user = newUser;
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

    getWithdrawalHistory: async (req: Request, res: Response) => {
        try {
            const userId = req.params.userId as string;
            const result = await pool.query(
                `SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
                [userId]
            );

            return res.status(200).json({ status: 'success', withdrawals: result.rows });
        } catch (e: any) {
            return res.status(500).json({ status: 'error', message: e.message });
        }
    },

    requestWithdrawal: async (req: Request, res: Response) => {
        const client = await pool.connect();
        try {
            const { user_id, userId, amount_coins, upi_id, method } = req.body;
            const targetUserId = String(user_id || userId || '');
            const targetAmount = toNumber(amount_coins ?? 0);
            const upi = String(upi_id || '').trim();
            const selectedMethod = String(method || 'upi');

            if (!targetUserId) {
                return res.status(400).json({ status: 'error', message: 'User ID required' });
            }
            if (targetAmount < 50) {
                return res.status(400).json({ status: 'error', message: 'Minimum withdrawal is 50 coins' });
            }
            if (selectedMethod === 'upi' && !upi) {
                return res.status(400).json({ status: 'error', message: 'UPI ID is required' });
            }

            await client.query('BEGIN');

            const userResult = await client.query(
                'SELECT wallet_balance FROM users WHERE user_id = $1 FOR UPDATE',
                [targetUserId]
            );
            if (userResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }

            const currentBalance = toNumber(userResult.rows[0].wallet_balance ?? 0);
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
                `INSERT INTO withdrawals (user_id, amount_coins, method, upi_id, status)
                 VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
                [targetUserId, targetAmount, selectedMethod, upi || null]
            );

            await client.query(
                'INSERT INTO transactions (user_id, amount, transaction_type, source, balance_after) VALUES ($1, $2, $3, $4, $5)',
                [targetUserId, -targetAmount, 'withdrawal', 'Withdrawal Request', newBalance]
            );

            await client.query('COMMIT');

            return res.status(200).json({
                status: 'success',
                message: 'Withdrawal request submitted successfully',
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

            if (!Number.isInteger(withdrawalId) || !['completed', 'failed'].includes(status)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'A valid withdrawal ID and completed or failed status are required',
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
                `UPDATE withdrawals SET status = $1, completed_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [status, withdrawalId]
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

    claimDailyBonus: async (req: Request, res: Response) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID required' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const lastClaimQuery = `
                SELECT created_at FROM activity_logs
                WHERE user_id = $1 AND activity_type = 'daily_bonus'
                ORDER BY created_at DESC LIMIT 1;
            `;
            const lastClaimRes = await client.query(lastClaimQuery, [userId]);

            if (lastClaimRes.rows.length > 0) {
                const lastClaimTime = new Date(lastClaimRes.rows[0].created_at).getTime();
                const currentTime = new Date().getTime();
                const hoursPassed = (currentTime - lastClaimTime) / (1000 * 60 * 60);

                if (hoursPassed < 24) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: 'Come back tomorrow for your next bonus!' });
                }
            }

            const updateRes = await client.query(
                'UPDATE users SET wallet_balance = wallet_balance + 100 WHERE user_id = $1 RETURNING wallet_balance',
                [userId]
            );
            const newBalance = updateRes.rows[0].wallet_balance;

            await client.query(
                'INSERT INTO transactions (user_id, amount, transaction_type, source, balance_after) VALUES ($1, $2, $3, $4, $5)',
                [userId, 100, 'daily_bonus', 'System Reward', newBalance]
            );
            await client.query(
                'INSERT INTO activity_logs (user_id, activity_type) VALUES ($1, $2)',
                [userId, 'daily_bonus']
            );

            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', message: '100 Coins Claimed!', newBalance });
        } catch (e: any) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: e.message });
        } finally {
            client.release();
        }
    }
};
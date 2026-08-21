import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/userModel';
import pool from '../config/db';

export const UserController = {
    registerUser: async (req: Request, res: Response) => {
        try {
            const { email, full_name, device_id, password } = req.body;

            // 🛡️ STRICT VALIDATION
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

            // Secure Hashing
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

            const user = await UserModel.findByEmailOrDevice(email, "");
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
                return res.status(404).json({ error: "User not found" });
            }
            res.status(200).json({ status: 'success', user });
        } catch (e: any) { 
            res.status(500).json({ error: e.message }); 
        }
    },
    googleRegister: async (req: Request, res: Response) => {
    try {
        const { name, email, device_id } = req.body;

        // 1. Check if device is already used by another email
        const userByDevice = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        if (userByDevice.rows.length > 0 && userByDevice.rows[0].email !== email) {
            return res.status(403).json({ status: 'error', message: 'Only one account per device is allowed!' });
        }

        // 2. Check if user already exists
        let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            // New user - Create account
            const refCode = 'RB' + Math.floor(Math.random() * 900000);
            const newUser = await pool.query(
                'INSERT INTO users (full_name, email, device_id, referral_code) VALUES ($1, $2, $3, $4) RETURNING *',
                [name, email, device_id, refCode]
            );
            user = newUser;
        }

        res.status(200).json({ status: 'success', user: user.rows[0] });
    } catch (e: any) {
        res.status(500).json({ status: 'error', message: e.message });
    }
},     

    claimDailyBonus: async (req: Request, res: Response) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID required" });

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
                    return res.status(400).json({ error: "Come back tomorrow for your next bonus!" });
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
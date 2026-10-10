import { NextFunction, Request, Response } from 'express';
import pool from '../config/db';

export const activeUserGuard = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const userIdValue = req.params.userId ?? req.body?.userId ?? req.body?.user_id ?? req.query.userId;
    const userId = typeof userIdValue === 'string' ? userIdValue.trim() : '';
    if (!userId) {
        next();
        return;
    }

    try {
        const result = await pool.query(
            'SELECT is_active FROM users WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length > 0 && !result.rows[0].is_active) {
            res.status(403).json({ status: 'error', message: 'This account is currently suspended.' });
            return;
        }
        next();
    } catch (error) {
        console.error('Active user check failed:', error);
        res.status(500).json({ status: 'error', message: 'Could not verify account status.' });
    }
};

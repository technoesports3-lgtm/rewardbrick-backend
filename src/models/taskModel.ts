import pool from '../config/db';

export const TaskModel = {
    getAllTasks: async () => {
        const res = await pool.query('SELECT * FROM tasks WHERE status = $1', ['active']);
        return res.rows;
    },
    recordTaskCompletion: async (userId: string, taskId: string, coins: number, meta: any) => {
        const query = `INSERT INTO user_tasks (user_id, task_id, status, rewarded_coins, postback_meta) VALUES ($1, $2, 'completed', $3, $4) RETURNING *;`;
        const res = await pool.query(query, [userId, taskId, coins, meta]);
        return res.rows[0];
    }
};
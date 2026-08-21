import pool from '../config/db';

export const TaskModel = {
    getAllTasks: async () => {
        const res = await pool.query('SELECT * FROM tasks WHERE status = $1 ORDER BY created_at DESC', ['active']);
        return res.rows;
    },
    getProviderConfigs: async () => {
        const res = await pool.query(
            'SELECT provider_name, base_url, secret_key FROM provider_configs ORDER BY provider_name ASC'
        );
        return res.rows;
    },
    getProviderConfig: async (providerName: string) => {
        const res = await pool.query(
            'SELECT provider_name, base_url, secret_key FROM provider_configs WHERE provider_name = $1',
            [providerName]
        );
        return res.rows[0] ?? null;
    },
    recordTaskCompletion: async (userId: string, taskId: string, coins: number, meta: any) => {
        const query = `INSERT INTO user_tasks (user_id, task_id, status, rewarded_coins, postback_meta) VALUES ($1, $2, 'completed', $3, $4) RETURNING *;`;
        const res = await pool.query(query, [userId, taskId, coins, meta]);
        return res.rows[0];
    }
};
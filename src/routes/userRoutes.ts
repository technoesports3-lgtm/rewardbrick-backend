import pool from '../config/db';

export const UserModel = {
    // ఇమెయిల్ లేదా డివైజ్ ఐడి తో యూజర్ ని వెతకడం
    findByEmailOrDevice: async (email: string, device_id: string) => {
        const query = 'SELECT * FROM users WHERE email = $1 OR device_id = $2';
        const result = await pool.query(query, [email, device_id]);
        return result.rows[0];
    },

    // కొత్త యూజర్ ని క్రియేట్ చేయడం (Password Hash తో సహా)
    createUser: async (email: string, full_name: string, device_id: string, referral_code: string, passwordHash: string) => {
        const query = `
            INSERT INTO users (email, full_name, device_id, referral_code, password)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING user_id, email, full_name, wallet_balance, referral_code;
        `;
        const result = await pool.query(query, [email, full_name, device_id, referral_code, passwordHash]);
        return result.rows[0];
    },

    // కాయిన్స్ యాడ్ చేసే అటామిక్ లాజిక్ (Double-Entry Ledger)
    addCoins: async (userId: string, amount: number, type: string, source: string) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const updateRes = await client.query(
                'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE user_id = $2 RETURNING wallet_balance',
                [amount, userId]
            );
            const newBalance = updateRes.rows[0].wallet_balance;
            await client.query(
                'INSERT INTO transactions (user_id, amount, transaction_type, source, balance_after) VALUES ($1, $2, $3, $4, $5)',
                [userId, amount, type, source, newBalance]
              );
            await client.query('COMMIT');
            return { success: true, newBalance };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally { client.release(); }
    },
    findById: async (userId: string) => {
        const res = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        return res.rows[0];
    }
};
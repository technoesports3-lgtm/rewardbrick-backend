import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

console.log("[DEBUG] Database URL loaded:", process.env.DATABASE_URL ? "YES" : "NO");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const ensureProviderSchema = async () => {
    await pool.query(`
        ALTER TABLE tasks
            ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'direct',
            ADD COLUMN IF NOT EXISTS provider_name TEXT DEFAULT 'internal';
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS provider_configs (
            id SERIAL PRIMARY KEY,
            provider_name TEXT NOT NULL UNIQUE,
            base_url TEXT NOT NULL,
            secret_key TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        INSERT INTO provider_configs (provider_name, base_url, secret_key)
        VALUES
            ('cpx_research', 'https://offers.cpx-research.com/index.php?app_id=52007&ext_user_id={userId}', 'cpx_secret_777'),
            ('admantum', 'https://offers.admantum.com/track?user_id={userId}', 'admantum_secret_777'),
            ('gamezop', 'https://pwa.gamezop.com/g/RewardBrick', 'gamezop_secret_777')
        ON CONFLICT (provider_name) DO NOTHING;
    `);
};

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('[DATABASE] Connection Error ❌:', err.message);
    } else {
        console.log('[DATABASE] Successfully connected to PostgreSQL Database! 🧱');
        console.log('[DATABASE] Server Time:', res.rows[0].now);
    }
});

ensureProviderSchema().catch((error: Error) => {
    console.error('[DATABASE] Provider schema initialization failed:', error.message);
});

export default pool;
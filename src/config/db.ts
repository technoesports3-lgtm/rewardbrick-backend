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
            ADD COLUMN IF NOT EXISTS provider_name TEXT DEFAULT 'internal',
            ADD COLUMN IF NOT EXISTS reward_coins INTEGER;
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
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount NUMERIC(12,2) NOT NULL DEFAULT 0,
            transaction_type TEXT NOT NULL DEFAULT 'credit',
            source TEXT,
            balance_after NUMERIC(12,2) DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS withdrawals (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            amount_coins NUMERIC(12,2) NOT NULL DEFAULT 0,
            method TEXT NOT NULL DEFAULT 'upi',
            upi_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            activity_type TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await pool.query(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
        ALTER TABLE provider_configs
            ADD COLUMN IF NOT EXISTS reward_coins INTEGER;
        UPDATE provider_configs
        SET reward_coins = 4000
        WHERE provider_name = 'admantum' AND reward_coins IS NULL;
        CREATE TABLE IF NOT EXISTS admin_managed_tasks (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            provider_name TEXT NOT NULL DEFAULT 'custom',
            offer_url TEXT NOT NULL,
            image_url TEXT NOT NULL DEFAULT '',
            reward_coins INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id BIGSERIAL PRIMARY KEY,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS dashboard_banners (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            icon_name TEXT NOT NULL DEFAULT 'celebration',
            accent_color TEXT NOT NULL DEFAULT '#087D74',
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS dashboard_banner_seed (
            id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
            seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    const bannerSeed = await pool.query(
        `INSERT INTO dashboard_banner_seed DEFAULT VALUES
         ON CONFLICT DO NOTHING RETURNING id`
    );
    if (bannerSeed.rowCount) {
        await pool.query(`
            INSERT INTO dashboard_banners
                (title, subtitle, icon_name, accent_color, sort_order, is_active)
            SELECT defaults.title, defaults.subtitle, defaults.icon_name,
                   defaults.accent_color, defaults.sort_order, TRUE
            FROM (VALUES
                ('REFERRAL CONTEST', 'Invite friends and unlock bonus coins.', 'people', '#00796B', 0),
                ('REFERRAL CONTEST', 'Your network could be your next reward.', 'trophy', '#AD1457', 1),
                ('REFERRAL CONTEST', 'Share. Earn. Repeat.', 'share', '#EF6C00', 2)
            ) AS defaults(title, subtitle, icon_name, accent_color, sort_order)
            WHERE NOT EXISTS (SELECT 1 FROM dashboard_banners)
        `);
    }

    await pool.query(`
        INSERT INTO provider_configs (provider_name, base_url, secret_key)
        VALUES
            ('cpx_research', 'https://offers.cpx-research.com/index.php?app_id=52007&ext_user_id={userId}', ''),
            ('admantum', 'https://offers.admantum.com/track?user_id={userId}', ''),
            ('gamezop', 'https://pwa.gamezop.com/g/RewardBrick', '')
        ON CONFLICT (provider_name) DO NOTHING;
    `);

    await pool.query(
        `UPDATE provider_configs SET secret_key = ''
         WHERE secret_key IN ('cpx_secret_777', 'cpx_research_secret_777', 'admantum_secret_777')`
    );

    const providerSecrets = [
        ['cpx_research', process.env.CPX_RESEARCH_POSTBACK_SECRET],
        ['admantum', process.env.ADMANTUM_POSTBACK_SECRET],
    ] as const;
    for (const [providerName, secret] of providerSecrets) {
        if (secret) {
            await pool.query(
                `UPDATE provider_configs SET secret_key = $1
                 WHERE provider_name = $2 AND secret_key = ''`,
                [secret, providerName]
            );
        }
    }
};

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('[DATABASE] Connection Error ❌:', err.message);
    } else {
        console.log('[DATABASE] Successfully connected to PostgreSQL Database! 🧱');
        console.log('[DATABASE] Server Time:', res.rows[0].now);
    }
});

export const databaseReady = ensureProviderSchema();
databaseReady.catch((error: Error) => {
    console.error('[DATABASE] Provider schema initialization failed:', error.message);
});

export default pool;
import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import pool from '../config/db';

const toNumber = (value: unknown): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const audit = async (
    client: PoolClient,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>
) => {
    await client.query(
        `INSERT INTO admin_audit_log (action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4)`,
        [action, targetType, targetId, JSON.stringify(details)]
    );
};

const validPage = (request: Request): { limit: number; offset: number } | null => {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 25);
    if (!Number.isInteger(page) || page < 1 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return null;
    }
    return { limit, offset: (page - 1) * limit };
};

const validWebUrl = (value: unknown): value is string => {
    if (typeof value !== 'string') return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
};

const validOptionalWebUrl = (value: unknown): value is string =>
    value === '' || value == null || validWebUrl(value);

const getLegacyTaskColumns = async (): Promise<{
    id: string;
    title: string | null;
    provider: string | null;
    link: string | null;
    image: string | null;
    status: string | null;
    reward: string | null;
} | null> => {
    const result = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'tasks'`
    );
    const columns = new Set<string>(result.rows.map((row) => String(row.column_name)));
    const choose = (options: string[]) => options.find((column) => columns.has(column)) ?? null;
    const id = choose(['id', 'task_id', 'offer_id']);
    if (!id) return null;
    return {
        id,
        title: choose(['title', 'task_name', 'offer_title', 'name']),
        provider: choose(['provider_name', 'task_type', 'provider']),
        link: choose(['offer_url', 'offer_link', 'link_url', 'target_url']),
        image: choose(['image_url', 'offer_image', 'icon_url']),
        status: choose(['status', 'is_active']),
        reward: choose(['reward_coins', 'reward_amount', 'coins', 'payout']),
    };
};

const columnExpression = (column: string | null, fallback: string): string =>
    column ? `"${column}"::TEXT` : fallback;

const getUserColumns = async (): Promise<Set<string>> => {
    const result = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'users'`
    );
    return new Set<string>(result.rows.map((row) => String(row.column_name)));
};

const quoteColumn = (column: string): string => `"${column.replace(/"/g, '""')}"`;
const bannerIcons = new Set(['people', 'trophy', 'share', 'celebration', 'wallet', 'gift', 'star']);
const appContentKeys = new Set(['terms', 'about', 'support_email', 'store_url']);

export const AdminController = {
    getSession: (_req: Request, res: Response) =>
        res.status(200).json({ status: 'success', authenticated: true }),

    getDashboard: async (_req: Request, res: Response) => {
        try {
            const [users, balances, withdrawals, tasks, earnings] = await Promise.all([
                pool.query(
                    `SELECT COUNT(*) AS total,
                            COUNT(*) FILTER (WHERE is_active) AS active
                     FROM users`
                ),
                pool.query(
                    `SELECT COALESCE(SUM(wallet_balance), 0) AS outstanding_coins
                     FROM users`
                ),
                pool.query(
                    `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                            COUNT(*) FILTER (WHERE status = 'completed') AS completed
                     FROM withdrawals`
                ),
                pool.query(
                    `SELECT COUNT(*) FILTER (WHERE is_active) AS active,
                            COUNT(*) AS total
                     FROM admin_managed_tasks`
                ),
                pool.query(
                    `SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS credits,
                            COALESCE(SUM(ABS(amount)) FILTER (WHERE amount < 0), 0) AS debits
                     FROM transactions`
                ),
            ]);

            return res.status(200).json({
                status: 'success',
                stats: {
                    total_users: toNumber(users.rows[0]?.total),
                    active_users: toNumber(users.rows[0]?.active),
                    outstanding_coins: toNumber(balances.rows[0]?.outstanding_coins),
                    pending_withdrawals: toNumber(withdrawals.rows[0]?.pending),
                    completed_withdrawals: toNumber(withdrawals.rows[0]?.completed),
                    active_managed_tasks: toNumber(tasks.rows[0]?.active),
                    total_managed_tasks: toNumber(tasks.rows[0]?.total),
                    lifetime_credits: toNumber(earnings.rows[0]?.credits),
                    lifetime_debits: toNumber(earnings.rows[0]?.debits),
                },
            });
        } catch (error) {
            console.error('Admin dashboard query failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load dashboard.' });
        }
    },

    listBanners: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, subtitle, icon_name, accent_color, sort_order,
                        image_url, target_url, is_active, updated_at
                 FROM dashboard_banners ORDER BY sort_order, id`
            );
            return res.status(200).json({ status: 'success', banners: result.rows });
        } catch (error) {
            console.error('Admin banner list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load dashboard cards.' });
        }
    },

    getPublicBanners: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, subtitle, icon_name, accent_color, image_url,
                        target_url, sort_order
                 FROM dashboard_banners
                 WHERE is_active = TRUE
                 ORDER BY sort_order, id`
            );
            return res.status(200).json({ status: 'success', banners: result.rows });
        } catch (error) {
            console.error('Public dashboard banner list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load dashboard cards.' });
        }
    },

    saveBanner: async (req: Request, res: Response) => {
        const bannerId = req.params.bannerId ? Number(req.params.bannerId) : null;
        const { title, subtitle, icon_name, accent_color, image_url, target_url, sort_order, is_active } = req.body ?? {};
        const safeTitle = typeof title === 'string' ? title.trim() : '';
        const safeSubtitle = typeof subtitle === 'string' ? subtitle.trim() : '';
        const safeIcon = typeof icon_name === 'string' ? icon_name : '';
        const safeColor = typeof accent_color === 'string' ? accent_color.toUpperCase() : '';
        const safeImageUrl = image_url == null ? '' : image_url;
        const safeTargetUrl = target_url == null ? '' : target_url;

        if ((bannerId !== null && (!Number.isSafeInteger(bannerId) || bannerId < 1)) ||
            safeTitle.length < 2 || safeTitle.length > 60 ||
            safeSubtitle.length > 140 ||
            !bannerIcons.has(safeIcon) ||
            !/^#[0-9A-F]{6}$/.test(safeColor) ||
            !validOptionalWebUrl(safeImageUrl) ||
            !validOptionalWebUrl(safeTargetUrl) ||
            !Number.isSafeInteger(sort_order) || sort_order < 0 || sort_order > 10000 ||
            typeof is_active !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'Check card title, subtitle, HTTPS image/link URLs, supported icon, color, order, and active status.',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (is_active) {
                const existingActive = await client.query(
                    `SELECT id FROM dashboard_banners
                     WHERE is_active = TRUE AND ($1::INTEGER IS NULL OR id <> $1)
                     LIMIT 1 FOR UPDATE`,
                    [bannerId]
                );
                if (existingActive.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        status: 'error',
                        message: 'Only one dashboard ad poster can be active at a time.',
                    });
                }
            }
            const saved = bannerId === null
                ? await client.query(
                    `INSERT INTO dashboard_banners
                        (title, subtitle, icon_name, accent_color, image_url, target_url,
                         sort_order, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
                    [safeTitle, safeSubtitle, safeIcon, safeColor, safeImageUrl, safeTargetUrl,
                        sort_order, is_active]
                )
                : await client.query(
                    `UPDATE dashboard_banners
                     SET title = $1, subtitle = $2, icon_name = $3, accent_color = $4,
                         image_url = $5, target_url = $6, sort_order = $7,
                         is_active = $8, updated_at = NOW()
                     WHERE id = $9 RETURNING *`,
                    [safeTitle, safeSubtitle, safeIcon, safeColor, safeImageUrl, safeTargetUrl,
                        sort_order, is_active, bannerId]
                );
            if (saved.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Dashboard card not found.' });
            }
            await audit(client, bannerId === null ? 'banner_created' : 'banner_updated', 'dashboard_banner',
                String(saved.rows[0].id), {
                    title: safeTitle,
                    sort_order,
                    is_active,
                });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', banner: saved.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin banner save rollback failed:', rollbackError.message);
            });
            console.error('Admin banner save failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not save dashboard card.' });
        } finally {
            client.release();
        }
    },

    listAffiliatePosts: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, message, image_url, destination_url, sort_order,
                        is_active, created_at, updated_at
                 FROM affiliate_posts ORDER BY sort_order, id`
            );
            return res.status(200).json({ status: 'success', posts: result.rows });
        } catch (error) {
            console.error('Admin affiliate post list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load affiliate posts.' });
        }
    },

    saveAffiliatePost: async (req: Request, res: Response) => {
        const postId = req.params.postId ? Number(req.params.postId) : null;
        const { title, message, image_url, destination_url, sort_order, is_active } = req.body ?? {};
        const safeTitle = typeof title === 'string' ? title.trim() : '';
        const safeMessage = typeof message === 'string' ? message.trim() : '';
        const safeImageUrl = image_url == null ? '' : image_url;
        if ((postId !== null && (!Number.isSafeInteger(postId) || postId < 1)) ||
            safeTitle.length < 2 || safeTitle.length > 120 ||
            safeMessage.length > 2000 ||
            !validOptionalWebUrl(safeImageUrl) ||
            !validWebUrl(destination_url) ||
            !Number.isSafeInteger(sort_order) || sort_order < 0 || sort_order > 10000 ||
            typeof is_active !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'Check the title, message, HTTPS image and destination URLs, order, and active status.',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const saved = postId === null
                ? await client.query(
                    `INSERT INTO affiliate_posts
                        (title, message, image_url, destination_url, sort_order, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                    [safeTitle, safeMessage, safeImageUrl, destination_url, sort_order, is_active]
                )
                : await client.query(
                    `UPDATE affiliate_posts
                     SET title = $1, message = $2, image_url = $3, destination_url = $4,
                         sort_order = $5, is_active = $6, updated_at = NOW()
                     WHERE id = $7 RETURNING *`,
                    [safeTitle, safeMessage, safeImageUrl, destination_url, sort_order, is_active, postId]
                );
            if (saved.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Affiliate post not found.' });
            }
            await audit(client, postId === null ? 'affiliate_post_created' : 'affiliate_post_updated',
                'affiliate_post', String(saved.rows[0].id), {
                    title: safeTitle,
                    sort_order,
                    is_active,
                });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', post: saved.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin affiliate post save rollback failed:', rollbackError.message);
            });
            console.error('Admin affiliate post save failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not save affiliate post.' });
        } finally {
            client.release();
        }
    },

    deleteAffiliatePost: async (req: Request, res: Response) => {
        const postId = Number(req.params.postId);
        if (!Number.isSafeInteger(postId) || postId < 1) {
            return res.status(400).json({ status: 'error', message: 'A valid affiliate post ID is required.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const removed = await client.query(
                'DELETE FROM affiliate_posts WHERE id = $1 RETURNING id, title',
                [postId]
            );
            if (removed.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Affiliate post not found.' });
            }
            await audit(client, 'affiliate_post_deleted', 'affiliate_post', String(postId), {
                title: removed.rows[0].title,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success' });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin affiliate post delete rollback failed:', rollbackError.message);
            });
            console.error('Admin affiliate post delete failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not delete affiliate post.' });
        } finally {
            client.release();
        }
    },

    getPublicAffiliatePosts: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, message, image_url, destination_url
                 FROM affiliate_posts
                 WHERE is_active = TRUE
                 ORDER BY sort_order, id`
            );
            return res.status(200).json({ status: 'success', posts: result.rows });
        } catch (error) {
            console.error('Public affiliate post list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load affiliate posts.' });
        }
    },

    listRedeemCards: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, denomination_inr, coins_required, minimum_coins,
                        sort_order, is_active, updated_at
                 FROM redeem_cards ORDER BY sort_order, title, denomination_inr`
            );
            return res.status(200).json({ status: 'success', cards: result.rows });
        } catch (error) {
            console.error('Admin redemption card list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load redemption cards.' });
        }
    },

    saveRedeemCard: async (req: Request, res: Response) => {
        const cardId = req.params.cardId ? Number(req.params.cardId) : null;
        const { title, denomination_inr, minimum_coins, sort_order, is_active } = req.body ?? {};
        const safeTitle = typeof title === 'string' ? title.trim() : '';
        const coinsRequired = Number(denomination_inr) * 10;
        const safeMinimum = minimum_coins;
        const gameVoucher = /free\s*fire|pubg/i.test(safeTitle);
        if ((cardId !== null && (!Number.isSafeInteger(cardId) || cardId < 1)) ||
            safeTitle.length < 2 || safeTitle.length > 80 ||
            !Number.isSafeInteger(denomination_inr) || denomination_inr < (gameVoucher ? 25 : 100) || denomination_inr > 10000 ||
            !Number.isSafeInteger(coinsRequired) ||
            !Number.isSafeInteger(safeMinimum) || safeMinimum < 250 || safeMinimum > 100000 ||
            !Number.isSafeInteger(sort_order) || sort_order < 0 || sort_order > 10000 ||
            typeof is_active !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'Check the card name, denomination (₹25–₹10,000), minimum coins, order, and active status.',
            });
        }
        const minimumAllowed = gameVoucher ? 250 : 1000;
        if (safeMinimum < Math.max(coinsRequired, minimumAllowed)) {
            return res.status(400).json({
                status: 'error',
                message: gameVoucher
                    ? 'Free Fire and PUBG vouchers require at least 250 coins and cannot be priced below their denomination.'
                    : 'Standard vouchers require at least 1,000 coins and cannot be priced below their denomination.',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const saved = cardId === null
                ? await client.query(
                    `INSERT INTO redeem_cards
                        (title, denomination_inr, coins_required, minimum_coins, sort_order, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                    [safeTitle, denomination_inr, coinsRequired, safeMinimum, sort_order, is_active]
                )
                : await client.query(
                    `UPDATE redeem_cards
                     SET title = $1, denomination_inr = $2, coins_required = $3,
                         minimum_coins = $4, sort_order = $5, is_active = $6, updated_at = NOW()
                     WHERE id = $7 RETURNING *`,
                    [safeTitle, denomination_inr, coinsRequired, safeMinimum, sort_order, is_active, cardId]
                );
            if (saved.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Redemption card not found.' });
            }
            await audit(client, cardId === null ? 'redeem_card_created' : 'redeem_card_updated',
                'redeem_card', String(saved.rows[0].id), {
                    title: safeTitle,
                    denomination_inr,
                    coins_required: coinsRequired,
                    minimum_coins: safeMinimum,
                    is_active,
                });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', card: saved.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin redemption card save rollback failed:', rollbackError.message);
            });
            console.error('Admin redemption card save failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not save redemption card. Check for a duplicate denomination.' });
        } finally {
            client.release();
        }
    },

    deleteRedeemCard: async (req: Request, res: Response) => {
        const cardId = Number(req.params.cardId);
        if (!Number.isSafeInteger(cardId) || cardId < 1) {
            return res.status(400).json({ status: 'error', message: 'A valid redemption card ID is required.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const removed = await client.query(
                `UPDATE redeem_cards SET is_active = FALSE, updated_at = NOW()
                 WHERE id = $1 RETURNING id, title`,
                [cardId]
            );
            if (removed.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Redemption card not found.' });
            }
            await audit(client, 'redeem_card_disabled', 'redeem_card', String(cardId), {
                title: removed.rows[0].title,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success' });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin redemption card disable rollback failed:', rollbackError.message);
            });
            console.error('Admin redemption card disable failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not disable redemption card.' });
        } finally {
            client.release();
        }
    },

    getPublicRedeemCards: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, denomination_inr, coins_required, minimum_coins
                 FROM redeem_cards WHERE is_active = TRUE
                 ORDER BY sort_order, title, denomination_inr`
            );
            return res.status(200).json({ status: 'success', cards: result.rows });
        } catch (error) {
            console.error('Public redemption card list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load redemption cards.' });
        }
    },

    listAppContent: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                'SELECT content_key, content, updated_at FROM app_content ORDER BY content_key'
            );
            return res.status(200).json({ status: 'success', content: result.rows });
        } catch (error) {
            console.error('Admin app content list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load app information.' });
        }
    },

    saveAppContent: async (req: Request, res: Response) => {
        const contentKey = String(req.params.contentKey || '');
        const content = typeof req.body?.content === 'string' ? req.body.content.trim() : null;
        if (!appContentKeys.has(contentKey) || content === null || content.length > 20000) {
            return res.status(400).json({ status: 'error', message: 'Choose a supported content section and provide text within 20,000 characters.' });
        }
        if (contentKey === 'support_email' && content !== '' &&
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) {
            return res.status(400).json({ status: 'error', message: 'Enter a valid support email address or leave it blank.' });
        }
        if (contentKey === 'store_url' && content !== '' && !validWebUrl(content)) {
            return res.status(400).json({ status: 'error', message: 'The app store link must use HTTPS or be left blank.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO app_content (content_key, content)
                 VALUES ($1, $2)
                 ON CONFLICT (content_key) DO UPDATE
                 SET content = EXCLUDED.content, updated_at = NOW()`,
                [contentKey, content]
            );
            await audit(client, 'app_content_updated', 'app_content', contentKey, {
                character_count: content.length,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', content_key: contentKey });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin app content save rollback failed:', rollbackError.message);
            });
            console.error('Admin app content save failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not save app information.' });
        } finally {
            client.release();
        }
    },

    getPublicAppContent: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT content_key, content
                 FROM app_content
                 WHERE content_key = ANY($1::TEXT[])`,
                [['terms', 'about', 'support_email', 'store_url']]
            );
            const content = Object.fromEntries(
                result.rows.map((row) => [String(row.content_key), String(row.content)])
            );
            return res.status(200).json({ status: 'success', content });
        } catch (error) {
            console.error('Public app content list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load app information.' });
        }
    },

    deleteBanner: async (req: Request, res: Response) => {
        const bannerId = Number(req.params.bannerId);
        if (!Number.isSafeInteger(bannerId) || bannerId < 1) {
            return res.status(400).json({ status: 'error', message: 'A valid card ID is required.' });
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const removed = await client.query(
                'DELETE FROM dashboard_banners WHERE id = $1 RETURNING id, title',
                [bannerId]
            );
            if (removed.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Dashboard card not found.' });
            }
            await audit(client, 'banner_deleted', 'dashboard_banner', String(bannerId), {
                title: removed.rows[0].title,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success' });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin banner delete rollback failed:', rollbackError.message);
            });
            console.error('Admin banner delete failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not delete dashboard card.' });
        } finally {
            client.release();
        }
    },

    listUsers: async (req: Request, res: Response) => {
        const page = validPage(req);
        const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
        const status = typeof req.query.status === 'string' ? req.query.status : 'all';
        if (!page || !['all', 'active', 'suspended'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid user filters.' });
        }

        try {
            const columns = await getUserColumns();
            const userId = ['user_id', 'id', 'uid'].find((column) => columns.has(column));
            if (!userId) {
                return res.status(503).json({
                    status: 'error',
                    message: 'Users cannot be displayed: the database users table is missing user_id (or id).',
                });
            }

            const name = ['full_name', 'name', 'display_name'].find((column) => columns.has(column));
            const email = ['email', 'email_address'].find((column) => columns.has(column));
            const balance = ['wallet_balance', 'balance', 'coins'].find((column) => columns.has(column));
            const createdAt = ['created_at', 'createdAt', 'joined_at'].find((column) => columns.has(column));
            const active = columns.has('is_active') ? 'is_active' : null;
            if (status !== 'all' && !active) {
                return res.status(503).json({
                    status: 'error',
                    message: 'User status is not available: the users table is missing is_active.',
                });
            }

            const searchColumns = [userId, name, email].filter((column): column is string => column !== undefined);
            const searchClause = query
                ? `(${searchColumns.map((column) => `${quoteColumn(column)}::TEXT ILIKE '%' || $1 || '%'`).join(' OR ')})`
                : 'TRUE';
            const statusClause = !active || status === 'all'
                ? 'TRUE'
                : status === 'active'
                    ? `${quoteColumn(active)} = TRUE`
                    : `${quoteColumn(active)} = FALSE`;
            const orderColumn = createdAt ?? userId;

            const [result, count] = await Promise.all([
                pool.query(
                    `SELECT ${quoteColumn(userId)}::TEXT AS user_id,
                            ${columnExpression(name ?? null, "''")} AS full_name,
                            ${columnExpression(email ?? null, "''")} AS email,
                            ${columnExpression(balance ?? null, '0')} AS wallet_balance,
                            ${active ? quoteColumn(active) : 'TRUE'} AS is_active,
                            ${createdAt ? quoteColumn(createdAt) : 'NULL'} AS created_at
                     FROM users
                     WHERE ${searchClause} AND ${statusClause}
                     ORDER BY ${quoteColumn(orderColumn)} DESC
                     LIMIT $2 OFFSET $3`,
                    [query, page.limit, page.offset]
                ),
                pool.query(
                    `SELECT COUNT(*) AS total FROM users
                     WHERE ${searchClause} AND ${statusClause}`,
                    [query]
                ),
            ]);
            return res.status(200).json({
                status: 'success',
                users: result.rows,
                total: toNumber(count.rows[0]?.total),
                page: Number(req.query.page ?? 1),
                limit: page.limit,
            });
        } catch (error) {
            console.error('Admin user search failed:', error);
            return res.status(500).json({
                status: 'error',
                message: error instanceof Error
                    ? `Could not load users: ${error.message}`
                    : 'Could not load users because of a database error.',
            });
        }
    },

    setUserStatus: async (req: Request, res: Response) => {
        const userId = String(req.params.userId || '').trim();
        const isActive = req.body?.is_active;
        if (!userId || typeof isActive !== 'boolean') {
            return res.status(400).json({ status: 'error', message: 'A user ID and boolean is_active are required.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(
                'UPDATE users SET is_active = $1 WHERE user_id = $2 RETURNING user_id, is_active',
                [isActive, userId]
            );
            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'User not found.' });
            }
            await audit(client, isActive ? 'user_activated' : 'user_suspended', 'user', userId, {
                is_active: isActive,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', user: result.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin user status rollback failed:', rollbackError.message);
            });
            console.error('Admin user status update failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not update user status.' });
        } finally {
            client.release();
        }
    },

    adjustUserCoins: async (req: Request, res: Response) => {
        const userId = String(req.params.userId || '').trim();
        const amount = req.body?.amount;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
        if (!userId || !Number.isSafeInteger(amount) || amount === 0 ||
            Math.abs(amount) > 1_000_000 || reason.length < 5 || reason.length > 300) {
            return res.status(400).json({
                status: 'error',
                message: 'Provide a non-zero whole-coin amount (maximum 1,000,000) and a reason (5-300 characters).',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const user = await client.query(
                `UPDATE users SET wallet_balance = wallet_balance + $1
                 WHERE user_id = $2 AND wallet_balance + $1 >= 0
                 RETURNING wallet_balance`,
                [amount, userId]
            );
            if (user.rowCount === 0) {
                const exists = await client.query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
                await client.query('ROLLBACK');
                return exists.rowCount
                    ? res.status(400).json({ status: 'error', message: 'Adjustment would make the balance negative.' })
                    : res.status(404).json({ status: 'error', message: 'User not found.' });
            }

            const balance = toNumber(user.rows[0].wallet_balance);
            await client.query(
                `INSERT INTO transactions
                    (user_id, amount, transaction_type, source, balance_after)
                 VALUES ($1, $2, 'admin_adjustment', $3, $4)`,
                [userId, amount, `Admin adjustment: ${reason}`, balance]
            );
            await audit(client, 'coin_adjustment', 'user', userId, { amount, reason, balance_after: balance });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', balance });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin coin adjustment rollback failed:', rollbackError.message);
            });
            console.error('Admin coin adjustment failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not adjust user coins.' });
        } finally {
            client.release();
        }
    },

    listWithdrawals: async (req: Request, res: Response) => {
        const page = validPage(req);
        const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
        if (!page || !['all', 'pending', 'completed', 'failed'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid withdrawal filters.' });
        }
        try {
            const [result, count] = await Promise.all([
                pool.query(
                    `SELECT w.id, w.user_id, u.full_name, u.email, w.amount_coins,
                            w.method, w.upi_id, w.redeem_card_id, rc.title AS card_title,
                            rc.denomination_inr, w.voucher_reference, w.status,
                            w.created_at, w.completed_at
                     FROM withdrawals w
                     LEFT JOIN users u ON u.user_id = w.user_id
                     LEFT JOIN redeem_cards rc ON rc.id = w.redeem_card_id
                     WHERE ($1 = 'all' OR w.status = $1)
                     ORDER BY w.created_at DESC
                     LIMIT $2 OFFSET $3`,
                    [status, page.limit, page.offset]
                ),
                pool.query(
                    `SELECT COUNT(*) AS total FROM withdrawals
                     WHERE ($1 = 'all' OR status = $1)`,
                    [status]
                ),
            ]);
            return res.status(200).json({
                status: 'success',
                withdrawals: result.rows,
                total: toNumber(count.rows[0]?.total),
            });
        } catch (error) {
            console.error('Admin withdrawal list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load withdrawals.' });
        }
    },

    updateWithdrawal: async (req: Request, res: Response) => {
        const withdrawalId = Number(req.params.withdrawalId);
        const nextStatus = req.body?.status;
        const voucherReference = typeof req.body?.voucher_reference === 'string'
            ? req.body.voucher_reference.trim()
            : '';
        if (!Number.isSafeInteger(withdrawalId) || withdrawalId < 1 ||
            !['completed', 'failed'].includes(nextStatus) ||
            (nextStatus === 'completed' && (voucherReference.length < 4 || voucherReference.length > 500))) {
            return res.status(400).json({
                status: 'error',
                message: 'Valid withdrawal ID and status are required; provide the voucher code/reference before completing a redemption.',
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const found = await client.query(
                'SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE',
                [withdrawalId]
            );
            if (found.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Withdrawal not found.' });
            }
            const withdrawal = found.rows[0];
            if (withdrawal.status !== 'pending') {
                await client.query('ROLLBACK');
                return res.status(409).json({ status: 'error', message: `Withdrawal is already ${withdrawal.status}.` });
            }

            if (nextStatus === 'failed') {
                const user = await client.query(
                    `UPDATE users SET wallet_balance = wallet_balance + $1
                     WHERE user_id = $2 RETURNING wallet_balance`,
                    [withdrawal.amount_coins, withdrawal.user_id]
                );
                if (user.rowCount === 0) throw new Error('Withdrawal user does not exist.');
                await client.query(
                    `INSERT INTO transactions
                        (user_id, amount, transaction_type, source, balance_after)
                     VALUES ($1, $2, 'withdrawal_refund', 'Failed Withdrawal Refund', $3)`,
                    [withdrawal.user_id, withdrawal.amount_coins, user.rows[0].wallet_balance]
                );
            }

            const updated = await client.query(
                `UPDATE withdrawals
                 SET status = $1, voucher_reference = CASE WHEN $1 = 'completed' THEN $2 ELSE voucher_reference END,
                     completed_at = NOW()
                 WHERE id = $3 RETURNING id, status, user_id, amount_coins, voucher_reference`,
                [nextStatus, voucherReference, withdrawalId]
            );
            await audit(client, `withdrawal_${nextStatus}`, 'withdrawal', String(withdrawalId), {
                user_id: withdrawal.user_id,
                amount_coins: toNumber(withdrawal.amount_coins),
                voucher_reference_recorded: nextStatus === 'completed',
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', withdrawal: updated.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin withdrawal rollback failed:', rollbackError.message);
            });
            console.error('Admin withdrawal update failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not update withdrawal.' });
        } finally {
            client.release();
        }
    },

    listTasks: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT id, title, description, provider_name, offer_url, image_url,
                        reward_coins, is_active, created_at, updated_at
                 FROM admin_managed_tasks
                 ORDER BY created_at DESC`
            );
            return res.status(200).json({ status: 'success', tasks: result.rows });
        } catch (error) {
            console.error('Admin task list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load managed tasks.' });
        }
    },

    listLegacyTasks: async (_req: Request, res: Response) => {
        try {
            const columns = await getLegacyTaskColumns();
            if (!columns) {
                return res.status(200).json({
                    status: 'success',
                    tasks: [],
                    editable: false,
                    message: 'The existing tasks table has no supported task identifier.',
                });
            }
            const result = await pool.query(
                `SELECT "${columns.id}"::TEXT AS id,
                        ${columnExpression(columns.title, "''")} AS title,
                        ${columnExpression(columns.provider, "''")} AS provider,
                        ${columnExpression(columns.link, "''")} AS offer_url,
                        ${columnExpression(columns.image, "''")} AS image_url,
                        ${columnExpression(columns.status, "''")} AS task_status,
                        ${columnExpression(columns.reward, 'NULL')} AS reward_coins
                 FROM tasks
                 ORDER BY "${columns.id}"
                 LIMIT 200`,
            );
            return res.status(200).json({
                status: 'success',
                tasks: result.rows.map((task) => ({
                    ...task,
                    title: String(task.title || '').trim() || `Existing task ${task.id}`,
                    is_active: columns.status
                        ? columns.status === 'is_active'
                            ? String(task.task_status).toLowerCase() === 'true'
                            : String(task.task_status).toLowerCase() === 'active'
                        : null,
                    can_toggle: columns.status !== null,
                    can_edit_reward: columns.reward !== null,
                    reward_coins: task.reward_coins == null ? 0 : toNumber(task.reward_coins),
                })),
                editable: true,
            });
        } catch (error) {
            console.error('Admin legacy task list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load existing tasks.' });
        }
    },

    updateLegacyTask: async (req: Request, res: Response) => {
        const taskId = String(req.params.taskId || '').trim();
        const { is_active: isActive, reward_coins: rewardCoins } = req.body ?? {};
        if (!taskId || taskId.length > 120 ||
            (isActive === undefined && rewardCoins === undefined) ||
            (isActive !== undefined && typeof isActive !== 'boolean') ||
            (rewardCoins !== undefined &&
                (!Number.isSafeInteger(rewardCoins) || rewardCoins < 0 || rewardCoins > 1_000_000))) {
            return res.status(400).json({ status: 'error', message: 'Provide an active status and/or whole-coin reward.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const columns = await getLegacyTaskColumns();
            if (!columns || (isActive !== undefined && !columns.status) ||
                (rewardCoins !== undefined && !columns.reward)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'This task does not support the requested edit.' });
            }

            const updates: string[] = [];
            const values: unknown[] = [];
            if (isActive !== undefined && columns.status) {
                values.push(columns.status === 'is_active' ? isActive : isActive ? 'active' : 'inactive');
                updates.push(`"${columns.status}" = $${values.length}`);
            }
            if (rewardCoins !== undefined && columns.reward) {
                values.push(rewardCoins);
                updates.push(`"${columns.reward}" = $${values.length}`);
            }
            values.push(taskId);
            const result = await client.query(
                `UPDATE tasks SET ${updates.join(', ')}
                 WHERE "${columns.id}"::TEXT = $${values.length}
                 RETURNING "${columns.id}"::TEXT AS id`,
                values
            );
            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Task not found.' });
            }
            await audit(client, 'legacy_task_updated', 'task', taskId, {
                ...(isActive === undefined ? {} : { is_active: isActive }),
                ...(rewardCoins === undefined ? {} : { reward_coins: rewardCoins }),
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success' });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin legacy task update rollback failed:', rollbackError.message);
            });
            console.error('Admin legacy task update failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not update task.' });
        } finally {
            client.release();
        }
    },

    saveTask: async (req: Request, res: Response) => {
        const id = req.params.taskId ? Number(req.params.taskId) : null;
        const { title, description, provider_name, offer_url, image_url, reward_coins, is_active } = req.body ?? {};
        const safeTitle = typeof title === 'string' ? title.trim() : '';
        const safeDescription = typeof description === 'string' ? description.trim() : '';
        const safeProvider = typeof provider_name === 'string' ? provider_name.trim() : '';
        const safeImageUrl = image_url === '' || image_url == null ? '' : image_url;
        const safeActive = is_active === undefined ? true : is_active;

        if ((id !== null && (!Number.isSafeInteger(id) || id < 1)) ||
            safeTitle.length < 2 || safeTitle.length > 120 ||
            safeDescription.length > 1000 ||
            safeProvider.length < 2 || safeProvider.length > 40 ||
            !validWebUrl(offer_url) ||
            (safeImageUrl !== '' && !validWebUrl(safeImageUrl)) ||
            !Number.isSafeInteger(reward_coins) || reward_coins < 0 || reward_coins > 1_000_000 ||
            typeof safeActive !== 'boolean') {
            return res.status(400).json({ status: 'error', message: 'Check task title, HTTPS URLs, provider, reward, and active status.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const provider = await client.query(
                'SELECT 1 FROM provider_configs WHERE provider_name = $1',
                [safeProvider]
            );
            if (provider.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ status: 'error', message: 'Choose a provider configured in provider settings.' });
            }

            const saved = id === null
                ? await client.query(
                    `INSERT INTO admin_managed_tasks
                        (title, description, provider_name, offer_url, image_url, reward_coins, is_active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                    [safeTitle, safeDescription, safeProvider, offer_url, safeImageUrl, reward_coins, safeActive]
                )
                : await client.query(
                    `UPDATE admin_managed_tasks
                     SET title = $1, description = $2, provider_name = $3,
                         offer_url = $4, image_url = $5, reward_coins = $6,
                         is_active = $7, updated_at = NOW()
                     WHERE id = $8 RETURNING *`,
                    [safeTitle, safeDescription, safeProvider, offer_url, safeImageUrl, reward_coins, safeActive, id]
                );

            if (saved.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Task not found.' });
            }
            await audit(client, id === null ? 'task_created' : 'task_updated', 'task', String(saved.rows[0].id), {
                title: safeTitle,
                provider_name: safeProvider,
                reward_coins,
                is_active: safeActive,
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', task: saved.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin task save rollback failed:', rollbackError.message);
            });
            console.error('Admin task save failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not save task.' });
        } finally {
            client.release();
        }
    },

    listProviders: async (_req: Request, res: Response) => {
        try {
            const result = await pool.query(
                `SELECT provider_name, base_url, reward_coins,
                        (secret_key <> '') AS secret_configured
                 FROM provider_configs ORDER BY provider_name`
            );
            return res.status(200).json({ status: 'success', providers: result.rows });
        } catch (error) {
            console.error('Admin provider list failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load provider settings.' });
        }
    },

    updateProvider: async (req: Request, res: Response) => {
        const providerName = String(req.params.providerName || '').trim();
        const { base_url, reward_coins, secret_key } = req.body ?? {};
        if (!providerName || !validWebUrl(base_url) ||
            (reward_coins !== null &&
                (!Number.isSafeInteger(reward_coins) || reward_coins < 0 || reward_coins > 1_000_000)) ||
            (secret_key !== undefined &&
                (typeof secret_key !== 'string' || secret_key.length < 12 || secret_key.length > 500))) {
            return res.status(400).json({ status: 'error', message: 'Provide an HTTPS URL, whole-coin reward and a valid optional secret.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const updated = await client.query(
                `UPDATE provider_configs
                 SET base_url = $1,
                     reward_coins = $2,
                     secret_key = CASE WHEN $3::TEXT IS NULL THEN secret_key ELSE $3 END,
                     updated_at = NOW()
                 WHERE provider_name = $4
                 RETURNING provider_name, base_url, reward_coins, (secret_key <> '') AS secret_configured`,
                [base_url, reward_coins, secret_key === undefined || secret_key === '' ? null : secret_key, providerName]
            );
            if (updated.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ status: 'error', message: 'Provider not found.' });
            }
            await audit(client, 'provider_updated', 'provider', providerName, {
                base_url,
                reward_coins,
                secret_changed: Boolean(secret_key),
            });
            await client.query('COMMIT');
            return res.status(200).json({ status: 'success', provider: updated.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK').catch((rollbackError: Error) => {
                console.error('Admin provider update rollback failed:', rollbackError.message);
            });
            console.error('Admin provider update failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not update provider settings.' });
        } finally {
            client.release();
        }
    },

    listAuditLog: async (req: Request, res: Response) => {
        const page = validPage(req);
        if (!page) return res.status(400).json({ status: 'error', message: 'Invalid page.' });
        try {
            const result = await pool.query(
                `SELECT id, action, target_type, target_id, details, created_at
                 FROM admin_audit_log
                 ORDER BY created_at DESC
                 LIMIT $1 OFFSET $2`,
                [page.limit, page.offset]
            );
            return res.status(200).json({ status: 'success', events: result.rows });
        } catch (error) {
            console.error('Admin audit log query failed:', error);
            return res.status(500).json({ status: 'error', message: 'Could not load audit log.' });
        }
    },
};

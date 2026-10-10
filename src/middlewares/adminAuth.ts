import { randomBytes, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const SESSION_COOKIE = 'rewardbrick_admin_session';
const SESSION_DURATION_MS = 30 * 60 * 1000;
const sessions = new Map<string, number>();
const loginAttempts = new Map<string, {
    count: number;
    blockedUntil: number;
    lastAttempt: number;
}>();

const readCookie = (request: Request, name: string): string | null => {
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) {
            try {
                return decodeURIComponent(value.join('='));
            } catch {
                return null;
            }
        }
    }
    return null;
};

const secureCookie = (): string => process.env.NODE_ENV === 'production' ? '; Secure' : '';

export const adminLogin = (req: Request, res: Response): Response => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    for (const [token, expiry] of sessions) {
        if (expiry <= now) sessions.delete(token);
    }
    for (const [attemptIp, value] of loginAttempts) {
        if (now - value.lastAttempt > 15 * 60 * 1000) loginAttempts.delete(attemptIp);
    }
    if (loginAttempts.size > 10_000) {
        return res.status(503).json({ status: 'error', message: 'Admin login is temporarily unavailable.' });
    }

    let attempt = loginAttempts.get(ip);
    if (attempt && attempt.blockedUntil !== 0 && attempt.blockedUntil <= now) {
        loginAttempts.delete(ip);
        attempt = undefined;
    }
    if (attempt && attempt.blockedUntil > now) {
        return res.status(429).json({
            status: 'error',
            message: 'Too many login attempts. Wait 15 minutes and try again.',
        });
    }

    const configuredPassword = process.env.ADMIN_PANEL_PASSWORD;
    const suppliedPassword = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!configuredPassword || configuredPassword.length < 20) {
        console.error('ADMIN_PANEL_PASSWORD is missing or shorter than 20 characters.');
        return res.status(503).json({
            status: 'error',
            message: 'Admin panel requires an ADMIN_PANEL_PASSWORD with at least 20 characters.',
        });
    }

    const expected = Buffer.from(configuredPassword);
    const actual = Buffer.from(suppliedPassword);
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!valid) {
        const failedCount = (attempt?.count ?? 0) + 1;
        loginAttempts.set(ip, {
            count: failedCount,
            blockedUntil: failedCount >= 5 ? now + 15 * 60 * 1000 : 0,
            lastAttempt: now,
        });
        return res.status(401).json({ status: 'error', message: 'Invalid admin password.' });
    }

    loginAttempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, now + SESSION_DURATION_MS);
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=1800${secureCookie()}`
    );
    return res.status(200).json({ status: 'success' });
};

export const adminLogout = (req: Request, res: Response): Response => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) sessions.delete(token);
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0${secureCookie()}`
    );
    return res.status(200).json({ status: 'success' });
};

export const requireAdminSession = (req: Request, res: Response, next: NextFunction): void => {
    const token = readCookie(req, SESSION_COOKIE);
    const expiresAt = token ? sessions.get(token) : undefined;
    if (!token || !expiresAt || expiresAt <= Date.now()) {
        if (token) sessions.delete(token);
        res.status(401).json({ status: 'error', message: 'Admin login required.' });
        return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        req.header('x-admin-request') !== 'true') {
        res.status(403).json({ status: 'error', message: 'Invalid admin request.' });
        return;
    }

    sessions.set(token, Date.now() + SESSION_DURATION_MS);
    res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=1800${secureCookie()}`
    );
    next();
};

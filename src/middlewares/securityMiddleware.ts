import { Request, Response, NextFunction } from 'express';
import { SecurityUtils } from '../utils/security';

export const antiFraudGuard = async (req: Request, res: Response, next: NextFunction) => {
    const userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    const isVPN = await SecurityUtils.checkVPN(userIP as string);
    
    if (isVPN) {
        return res.status(403).json({
            status: 'error',
            message: 'VPN/Proxy detected! Please disable it to use RewardBrick. 🛡️'
        });
    }
    
    next(); // Anni bagunte next step ki velthundi
};
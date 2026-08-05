import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes';
import taskRoutes from './routes/taskRoutes';

// 1. Environment variables load & DB connection
dotenv.config();
import './config/db';

const app: Application = express();

// ==========================================
// 🛡️ SECURITY & UTILITY MIDDLEWARES
// ==========================================
app.use(helmet()); 
app.use(cors({ origin: "*" })); 
app.use(express.json()); 
app.use(morgan('dev')); 

// ==========================================
// 💓 SYSTEM HEARTBEAT (Health Check API)
// ==========================================
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'success',
        message: 'RewardBrick Core Engine is Online and Secure! 🚀',
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// 🚀 ROUTES
// ==========================================
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/tasks', taskRoutes);

// ==========================================
// 🏁 SERVER INITIALIZATION (Only One Listen!)
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[SERVER] RewardBrick engine is running on port ${PORT} 🧱`);
});
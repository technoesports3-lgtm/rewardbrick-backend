import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import userRoutes from './routes/userRoutes';
import taskRoutes from './routes/taskRoutes';

// 1. Environment variables load chestundi
dotenv.config();
import './config/db';

// 2. Express Server start chestunnam
const app: Application = express();
// app.listen సెక్షన్ ని ఇలా అప్డేట్ చేయ్
const PORT = process.env.PORT || 5000;

app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[SERVER] RewardBrick engine is running on port ${PORT}`);
});

// ==========================================
// 🛡️ SECURITY & UTILITY MIDDLEWARES
// ==========================================
app.use(helmet()); // Mana tech-stack ni hide chesi secure headers isthundi
app.use(cors({ origin: "*" })); // అన్ని రిక్వెస్ట్ లని ఒప్పుకో అని అర్థం // Vere websites (Frontend) nunchi mana backend ni access cheyadaniki
app.use(express.json()); // JSON data ni read cheyadaniki
app.use(morgan('dev')); // Terminal lo API requests ni log chestundi

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
// User Routes ni link chestunnam
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/tasks', taskRoutes);

// ==========================================
// 🚀 SERVER INITIALIZATION
// ==========================================
app.listen(PORT, () => {
    console.log(`[SERVER] RewardBrick engine is running on http://localhost:${PORT}`);
});
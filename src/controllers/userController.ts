import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../models/userModel';

export const UserController = {
    // 1. SIGNUP: పేరు, ఈమెయిల్, పాస్‌వర్డ్ అన్నీ ఉంటేనే ఒప్పుకుంటాం
    registerUser: async (req: Request, res: Response) => {
        try {
            const { email, full_name, device_id, password } = req.body;

            // 🛡️ STRICT VALIDATION
            if (!email || !full_name || !password || !device_id) {
                return res.status(400).json({ status: 'error', message: 'All fields are required!' });
            }
            if (password.length < 6) {
                return res.status(400).json({ status: 'error', message: 'Password must be 6+ characters!' });
            }

            const existingUser = await UserModel.findByEmailOrDevice(email, device_id);
            if (existingUser) {
                return res.status(400).json({ status: 'error', message: 'User already exists with this Email or Device!' });
            }

            // Secure Hashing
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const referralCode = 'RB' + Math.floor(100000 + Math.random() * 900000);

            const newUser = await UserModel.createUser(email, full_name, device_id, referralCode, hashedPassword);
            return res.status(201).json({ status: 'success', user: newUser });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    },

    // 2. LOGIN: ఈమెయిల్ & పాస్‌వర్డ్ వెరిఫికేషన్
    loginUser: async (req: Request, res: Response) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ status: 'error', message: 'Email and Password are required!' });
            }

            const user = await UserModel.findByEmailOrDevice(email, "");
            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found!' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ status: 'error', message: 'Invalid Credentials!' });
            }

            return res.status(200).json({ status: 'success', user });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: 'Server Login Error' });
        }
    },
    getUserProfile: async (req: Request, res: Response) => {
        try {
            // ఇక్కడ 'as string' అని చెప్పాలి, అప్పుడే TypeScript కి అర్థం అవుతుంది
            const userId = req.params.userId as string; 
            const user = await UserModel.findById(userId);
            
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }
            res.status(200).json({ status: 'success', user });
        } catch (e: any) { 
            res.status(500).json({ error: e.message }); 
        }
    },
};
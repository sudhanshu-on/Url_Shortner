import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel, initDatabase } from '../db';
import { AuthUserPayload } from '../types';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-jwt-secret-for-dev-only-do-not-use-in-prod';

/**
 * POST /api/v1/auth/register
 * Register a new user with hashed password (bcrypt)
 */
router.post('/register', async (req: Request, res: Response): Promise<any> => {
    try {
        await initDatabase();
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            return res.status(400).json({ error: "Email, username, and password are required." });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters long." });
        }

        const emailLower = email.toLowerCase().trim();
        const usernameTrimmed = username.trim();

        // Check if user already exists
        const existingUser = await UserModel.findOne({
            $or: [{ email: emailLower }, { username: usernameTrimmed }]
        });

        if (existingUser) {
            return res.status(409).json({ error: "Email or username is already registered." });
        }

        // Hash password securely with bcrypt salt rounds = 10
        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = new UserModel({
            email: emailLower,
            username: usernameTrimmed,
            passwordHash,
            role: 'USER',
            createdAt: new Date().toISOString()
        });

        await newUser.save();

        const payload: AuthUserPayload = {
            id: newUser._id.toString(),
            email: newUser.email,
            username: newUser.username,
            role: newUser.role
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        // Set HTTP-only cookie for secure Vercel session handling
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.status(201).json({
            message: "Registration successful",
            user: payload,
            token
        });

    } catch (err: any) {
        console.error("Registration error:", err);
        return res.status(500).json({ error: "Failed to register user." });
    }
});

/**
 * POST /api/v1/auth/login
 * Authenticate user and issue JWT token / HTTP-only cookie
 */
router.post('/login', async (req: Request, res: Response): Promise<any> => {
    try {
        await initDatabase();
        const { identifier, password } = req.body; // identifier can be email or username

        if (!identifier || !password) {
            return res.status(400).json({ error: "Username/Email and password are required." });
        }

        const input = identifier.toLowerCase().trim();
        const user = await UserModel.findOne({
            $or: [{ email: input }, { username: identifier.trim() }]
        });

        if (!user) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        const payload: AuthUserPayload = {
            id: user._id.toString(),
            email: user.email,
            username: user.username,
            role: user.role
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            message: "Login successful",
            user: payload,
            token
        });

    } catch (err: any) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Failed to authenticate." });
    }
});

/**
 * GET /api/v1/auth/me
 * Get currently authenticated user details
 */
router.get('/me', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
    return res.json({ user: req.user });
});

/**
 * POST /api/v1/auth/logout
 * Clear authentication cookie
 */
router.post('/logout', (_req: Request, res: Response) => {
    res.clearCookie('auth_token');
    return res.json({ message: "Logged out successfully." });
});

export default router;

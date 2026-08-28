import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUserPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-jwt-secret-for-dev-only-do-not-use-in-prod';

// Extend Express Request interface to carry authenticated user
export interface AuthenticatedRequest extends Request {
    user?: AuthUserPayload;
}

/**
 * Authentication Middleware
 * Verifies JWT token from Authorization header or HTTP-only cookie
 */
export function authenticateUser(req: AuthenticatedRequest, res: Response, next: NextFunction): any {
    let token: string | undefined;

    // Check Authorization Header (Bearer token)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } 
    // Check HTTP-only Cookies
    else if (req.cookies && req.cookies.auth_token) {
        token = req.cookies.auth_token;
    }

    if (!token) {
        return res.status(401).json({ error: "Unauthorized. Authentication token required." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUserPayload;
        req.user = decoded;
        return next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired authentication token." });
    }
}

/**
 * Role-Based Authorization Middleware for Admin Access
 * Rejects non-ADMIN users with 403 Forbidden
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): any {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized. Please log in." });
    }

    if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: "Forbidden. Admin privileges required." });
    }

    return next();
}

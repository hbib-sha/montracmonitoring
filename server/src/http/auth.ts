import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { userRepo } from '../db/repositories/userRepo';

// Extend express-session to include user field
declare module 'express-session' {
  interface SessionData {
    username?: string;
  }
}

export const loginHandler: RequestHandler = (req, res) => {
  const { username, password } = req.body as { username: string; password: string };
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Missing credentials' });
    return;
  }
  if (!userRepo.verify(username, password)) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }
  req.session.username = username;
  res.json({ success: true, username });
};

export const logoutHandler: RequestHandler = (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
};

export const meHandler: RequestHandler = (req, res) => {
  if (!req.session.username) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, username: req.session.username });
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session.username) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
};

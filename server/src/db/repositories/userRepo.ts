import { db } from '../index';
import bcrypt from 'bcryptjs';

type UserRow = { id: number; username: string; password_hash: string };

export const userRepo = {
  findByUsername(username: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  },

  verify(username: string, password: string): boolean {
    const user = userRepo.findByUsername(username);
    if (!user) return false;
    return bcrypt.compareSync(password, user.password_hash);
  },

  changePassword(username: string, newPassword: string): void {
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  },
};

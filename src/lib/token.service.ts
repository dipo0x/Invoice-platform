import jwt from "jsonwebtoken";
import { config } from "../config/index.config.js";
import { redis } from "../config/redis.config.js";

interface AccessTokenPayload {
  id: string;
  email: string;
}

interface RefreshTokenPayload {
  id: string;
}

export class TokenService {
  private static readonly ACCESS_TOKEN_EXPIRY = "15m";
  private static readonly REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days
  private static readonly REFRESH_KEY_PREFIX = "refresh";

  static generateAccessToken(userId: string, email: string): string {
    return jwt.sign({ id: userId, email }, config.JWT_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });
  }

  static generateRefreshToken(userId: string): string {
    return jwt.sign(
      { id: userId, jti: crypto.randomUUID() },
      config.JWT_REFRESH_SECRET,
      { expiresIn: this.REFRESH_TOKEN_EXPIRY_SECONDS },
    );
  }

  static verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
  }

  static verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, config.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  }

  static async storeRefreshToken(userId: string, token: string): Promise<void> {
    const key = `${this.REFRESH_KEY_PREFIX}:${userId}:${token}`;
    await redis.set(key, "1", this.REFRESH_TOKEN_EXPIRY_SECONDS);
  }

  static async isRefreshTokenValid(userId: string, token: string): Promise<boolean> {
    const key = `${this.REFRESH_KEY_PREFIX}:${userId}:${token}`;
    return redis.exists(key);
  }

  static async revokeRefreshToken(userId: string, token: string): Promise<void> {
    const key = `${this.REFRESH_KEY_PREFIX}:${userId}:${token}`;
    await redis.del(key);
  }
}

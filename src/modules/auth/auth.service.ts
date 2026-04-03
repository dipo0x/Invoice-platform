import argon2 from "argon2";
import { TokenService } from "../../lib/token.service.js";
import { User } from "./auth.model.js";
import type { RegisterBody, LoginBody } from "./auth.schema.js";

export class AuthService {
  static async register(input: RegisterBody) {
    const existing = await User.findOne({ email: input.email });
    if (existing) {
      return { error: "Email already registered", status: 409 };
    }

    const hashedPassword = await argon2.hash(input.password);
    const user = await User.create({
      email: input.email,
      password: hashedPassword,
      name: input.name,
    });

    return { data: user.toSafeJSON(), status: 201 };
  }

  static async login(input: LoginBody) {
    const user = await User.findOne({ email: input.email });
    if (!user) {
      return { error: "Invalid email or password", status: 401 };
    }

    const validPassword = await argon2.verify(user.password, input.password);
    if (!validPassword) {
      return { error: "Invalid email or password", status: 401 };
    }

    const userId = user.id as string;
    const accessToken = TokenService.generateAccessToken(userId, user.email);
    const refreshToken = TokenService.generateRefreshToken(userId);
    await TokenService.storeRefreshToken(userId, refreshToken);

    return {
      data: {
        user: user.toSafeJSON(),
        accessToken,
        refreshToken,
      },
      status: 200,
    };
  }

  static async refresh(refreshToken: string) {
    let payload: { id: string };
    try {
      payload = TokenService.verifyRefreshToken(refreshToken);
    } catch {
      return { error: "Invalid or expired refresh token", status: 401 };
    }

    const valid = await TokenService.isRefreshTokenValid(payload.id, refreshToken);
    if (!valid) {
      return { error: "Refresh token has been revoked", status: 401 };
    }

    // Rotate: revoke old, issue new
    await TokenService.revokeRefreshToken(payload.id, refreshToken);

    const user = await User.findById(payload.id);
    if (!user) {
      return { error: "User not found", status: 401 };
    }

    const userId = user.id as string;
    const newAccessToken = TokenService.generateAccessToken(userId, user.email);
    const newRefreshToken = TokenService.generateRefreshToken(userId);
    await TokenService.storeRefreshToken(userId, newRefreshToken);

    return {
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
      status: 200,
    };
  }
}

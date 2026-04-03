import pino from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  redact: {
    paths: [
      "password",
      "req.headers.authorization",
      "req.headers.cookie",
      "token",
      "refreshToken",
      "accessToken",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
});

export const fastifyLoggerConfig = {
  logger: {
    level: process.env["LOG_LEVEL"] ?? "info",
    redact: {
      paths: [
        "password",
        "req.headers.authorization",
        "req.headers.cookie",
        "token",
        "refreshToken",
        "accessToken",
      ],
      censor: "[REDACTED]",
    },
    ...(isProduction
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        }),
  },
};

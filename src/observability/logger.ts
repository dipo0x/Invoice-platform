import { createRequire } from "node:module";
import pino from "pino";

function hasPinoPretty(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

const usePretty =
  process.env["NODE_ENV"] !== "production" && hasPinoPretty();

const prettyTransport = usePretty
  ? {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    }
  : {};

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
  ...prettyTransport,
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
    ...prettyTransport,
  },
};

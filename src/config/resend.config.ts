import { Resend } from "resend";
import { config } from "./index.config.js";

export const resend = config.EMAIL_API_KEY
  ? new Resend(config.EMAIL_API_KEY)
  : null;

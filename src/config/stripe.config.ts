import Stripe from "stripe";
import { config } from "./index.config.js";

export const stripe = config.STRIPE_SECRET_KEY
  ? new Stripe(config.STRIPE_SECRET_KEY)
  : null;

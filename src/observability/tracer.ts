import { trace } from "@opentelemetry/api";

// Single tracer instance for the entire app.
// All custom spans created in business logic use this tracer.
export const tracer = trace.getTracer("invoice-platform");

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const loginDuration = new Trend("login_duration", true);
const registerDuration = new Trend("register_duration", true);

export const options = {
  scenarios: {
    auth_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    errors: ["rate<0.05"],
    login_duration: ["p(95)<300"],
    register_duration: ["p(95)<500"],
  },
};

export default function () {
  const uniqueId = `${__VU}-${__ITER}-${Date.now()}`;
  const email = `loadtest-${uniqueId}@test.com`;
  const password = "TestPass123!";

  // Register
  const registerRes = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email, password, name: `User ${uniqueId}` }),
    { headers: { "Content-Type": "application/json" } },
  );

  registerDuration.add(registerRes.timings.duration);
  const registered = check(registerRes, {
    "register status 201": (r) => r.status === 201,
  });
  errorRate.add(!registered);

  if (!registered) {
    return;
  }

  // Login
  const loginRes = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  loginDuration.add(loginRes.timings.duration);
  const loggedIn = check(loginRes, {
    "login status 200": (r) => r.status === 200,
    "has access token": (r) => JSON.parse(r.body).accessToken !== undefined,
  });
  errorRate.add(!loggedIn);

  if (!loggedIn) {
    return;
  }

  const { accessToken, refreshToken } = JSON.parse(loginRes.body);

  // Token refresh
  const refreshRes = http.post(
    `${BASE_URL}/v1/auth/refresh`,
    JSON.stringify({ refreshToken }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  check(refreshRes, {
    "refresh status 200": (r) => r.status === 200,
  });

  sleep(0.5);
}

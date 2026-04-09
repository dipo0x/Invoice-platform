import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const createInvoiceDuration = new Trend("create_invoice_duration", true);
const listInvoiceDuration = new Trend("list_invoice_duration", true);
const getInvoiceDuration = new Trend("get_invoice_duration", true);

export const options = {
  scenarios: {
    invoice_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 200 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1000", "p(99)<2000"],
    errors: ["rate<0.05"],
    create_invoice_duration: ["p(95)<800"],
    list_invoice_duration: ["p(95)<500"],
    get_invoice_duration: ["p(95)<300"],
  },
};

// Each VU sets up its own auth context
function setupAuth(vuId) {
  const email = `invoice-vu-${vuId}-${Date.now()}@test.com`;
  const password = "TestPass123!";

  const registerRes = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email, password, name: `Invoice VU ${vuId}` }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (registerRes.status !== 201) return null;

  const loginRes = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (loginRes.status !== 200) return null;

  const { accessToken } = JSON.parse(loginRes.body);

  // Create org
  const orgRes = http.post(
    `${BASE_URL}/v1/organizations`,
    JSON.stringify({ name: `Org VU ${vuId}`, slug: `org-vu-${vuId}-${Date.now()}` }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (orgRes.status !== 201) return null;

  const org = JSON.parse(orgRes.body);
  const orgId = org.organization._id;

  // Create client
  const clientRes = http.post(
    `${BASE_URL}/v1/clients`,
    JSON.stringify({ name: `Client VU ${vuId}`, email: `client-${vuId}@test.com` }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    },
  );

  if (clientRes.status !== 201) return null;

  const client = JSON.parse(clientRes.body);

  return { accessToken, orgId, clientId: client._id };
}

let authContext = null;

export default function () {
  if (!authContext) {
    authContext = setupAuth(__VU);
    if (!authContext) {
      errorRate.add(1);
      return;
    }
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authContext.accessToken}`,
    "x-org-id": authContext.orgId,
  };

  group("create invoice", () => {
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const res = http.post(
      `${BASE_URL}/v1/invoices`,
      JSON.stringify({
        clientId: authContext.clientId,
        lineItems: [
          { description: `Service ${__ITER}`, quantity: 1, unitPrice: 100 },
          { description: "Support", quantity: 2, unitPrice: 50 },
        ],
        dueDate,
        taxRate: 10,
      }),
      { headers },
    );

    createInvoiceDuration.add(res.timings.duration);
    const ok = check(res, {
      "create invoice 201": (r) => r.status === 201,
    });
    errorRate.add(!ok);
  });

  group("list invoices", () => {
    const res = http.get(`${BASE_URL}/v1/invoices?limit=20`, { headers });

    listInvoiceDuration.add(res.timings.duration);
    const ok = check(res, {
      "list invoices 200": (r) => r.status === 200,
      "has invoices array": (r) => JSON.parse(r.body).invoices !== undefined,
    });
    errorRate.add(!ok);

    // Paginate if there's a next cursor
    const body = JSON.parse(res.body);
    if (body.nextCursor) {
      const pageRes = http.get(
        `${BASE_URL}/v1/invoices?limit=20&cursor=${body.nextCursor}`,
        { headers },
      );
      check(pageRes, { "pagination 200": (r) => r.status === 200 });
    }
  });

  group("get single invoice", () => {
    // List first, then fetch one
    const listRes = http.get(`${BASE_URL}/v1/invoices?limit=1`, { headers });
    if (listRes.status === 200) {
      const invoices = JSON.parse(listRes.body).invoices;
      if (invoices && invoices.length > 0) {
        const res = http.get(`${BASE_URL}/v1/invoices/${invoices[0]._id}`, { headers });

        getInvoiceDuration.add(res.timings.duration);
        const ok = check(res, {
          "get invoice 200": (r) => r.status === 200,
        });
        errorRate.add(!ok);
      }
    }
  });

  sleep(0.5);
}

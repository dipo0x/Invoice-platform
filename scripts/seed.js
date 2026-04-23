/**
 * Seed script — creates real data and floods the API with traffic
 * to populate Grafana dashboards with meaningful metrics.
 *
 * Usage:
 *   node scripts/seed.js
 *   BASE_URL=http://localhost:3000 node scripts/seed.js
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const INVOICE_COUNT = 60;
const CLIENT_COUNT = 10;
const CONCURRENT = 5; // keep under rate limit (200 req/min per orgId)

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ─── helpers ────────────────────────────────────────────────────────────────

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function authHeaders(token, orgId) {
  return { Authorization: `Bearer ${token}`, "x-org-id": orgId };
}

// run tasks in batches with a small delay to stay under the rate limit
async function batch(tasks, size = CONCURRENT) {
  const results = [];
  for (let i = 0; i < tasks.length; i += size) {
    const chunk = tasks.slice(i, i + size);
    const chunkResults = await Promise.all(chunk.map((fn) => fn()));
    results.push(...chunkResults);
    if (i + size < tasks.length) await new Promise((r) => setTimeout(r, 350));
  }
  return results;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function futureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// ─── setup ──────────────────────────────────────────────────────────────────

async function setup() {
  const id = Date.now();
  const email = `seed-${id}@test.com`;
  const password = "SeedPass123!";

  log("Registering user...");
  const reg = await req("POST", "/v1/auth/register", {
    email,
    password,
    name: "Seed User",
  });
  if (reg.status !== 201) throw new Error(`Register failed: ${JSON.stringify(reg.body)}`);

  log("Logging in...");
  const login = await req("POST", "/v1/auth/login", { email, password });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);
  const { accessToken } = login.body;

  log("Creating organization...");
  const orgRes = await req(
    "POST",
    "/v1/organizations",
    { name: "Seed Corp", slug: `seed-corp-${id}` },
    { Authorization: `Bearer ${accessToken}` },
  );
  if (orgRes.status !== 201) throw new Error(`Org create failed: ${JSON.stringify(orgRes.body)}`);
  const orgId = orgRes.body.organization._id;

  log(`Setup complete. orgId=${orgId}`);
  return { accessToken, orgId };
}

// ─── clients ────────────────────────────────────────────────────────────────

async function createClients(token, orgId) {
  log(`Creating ${CLIENT_COUNT} clients...`);
  const headers = authHeaders(token, orgId);

  const names = [
    "Acme Ltd", "Bright Solutions", "Cape Tech", "Delta Systems",
    "Echo Partners", "Frontier Labs", "Global Edge", "Horizon Group",
    "Indigo Works", "Jetstream Inc",
  ];

  const results = await batch(
    names.slice(0, CLIENT_COUNT).map((name, i) => async () => {
      const res = await req(
        "POST",
        "/v1/clients",
        { name, email: `client-${i}-${Date.now()}@company.com`, phone: "+1234567890" },
        headers,
      );
      return res.status === 201 ? res.body._id : null;
    }),
  );

  const ids = results.filter(Boolean);
  log(`Created ${ids.length} clients`);
  return ids;
}

// ─── invoices ───────────────────────────────────────────────────────────────

const services = [
  { description: "Backend Development", unitPrice: 150 },
  { description: "Frontend Development", unitPrice: 120 },
  { description: "API Integration", unitPrice: 200 },
  { description: "Database Design", unitPrice: 180 },
  { description: "DevOps Setup", unitPrice: 250 },
  { description: "Code Review", unitPrice: 100 },
  { description: "Technical Consulting", unitPrice: 300 },
  { description: "UI/UX Design", unitPrice: 130 },
];

async function createInvoices(token, orgId, clientIds) {
  log(`Creating ${INVOICE_COUNT} invoices...`);
  const headers = authHeaders(token, orgId);

  const results = await batch(
    Array.from({ length: INVOICE_COUNT }, (_, i) => async () => {
      const item1 = randomItem(services);
      const item2 = randomItem(services);
      const res = await req(
        "POST",
        "/v1/invoices",
        {
          clientId: randomItem(clientIds),
          lineItems: [
            { description: item1.description, quantity: Math.ceil(Math.random() * 20), unitPrice: item1.unitPrice },
            { description: item2.description, quantity: Math.ceil(Math.random() * 10), unitPrice: item2.unitPrice },
          ],
          taxRate: randomItem([0, 5, 7.5, 10, 15]),
          currency: randomItem(["USD", "EUR", "GBP"]),
          dueDate: futureDate(Math.ceil(Math.random() * 60)),
          notes: i % 3 === 0 ? "Net 30 payment terms apply." : undefined,
        },
        headers,
      );
      if (res.status !== 201) process.stdout.write(` [invoice ${i} failed: ${res.status}]`);
      return res.status === 201 ? res.body._id : null;
    }),
  );

  const ids = results.filter(Boolean);
  log(`Created ${ids.length} invoices`);
  return ids;
}

// ─── send invoices ───────────────────────────────────────────────────────────

async function sendInvoices(token, orgId, invoiceIds) {
  // send 70% of invoices so we get a mix of draft/sent statuses
  const toSend = invoiceIds.slice(0, Math.floor(invoiceIds.length * 0.7));
  log(`Sending ${toSend.length} invoices...`);
  const headers = authHeaders(token, orgId);

  const results = await batch(
    toSend.map((id) => async () => {
      const res = await req("POST", `/v1/invoices/${id}/send`, null, headers);
      return res.status === 200 ? id : null;
    }),
  );

  const sent = results.filter(Boolean);
  log(`Sent ${sent.length} invoices`);
  return sent;
}

// ─── payments ────────────────────────────────────────────────────────────────

async function initiatePayments(token, orgId, sentInvoiceIds) {
  // attempt payment on 50% of sent invoices
  const toPay = sentInvoiceIds.slice(0, Math.floor(sentInvoiceIds.length * 0.5));
  log(`Initiating payments for ${toPay.length} invoices...`);
  const headers = authHeaders(token, orgId);

  const results = await batch(
    toPay.map((id) => async () => {
      const res = await req("POST", `/v1/invoices/${id}/pay`, null, {
        ...headers,
        "Idempotency-Key": `seed-pay-${id}`,
      });
      return res.status === 201 || res.status === 200 ? "ok" : null;
    }),
  );

  log(`Payment attempts: ${results.filter(Boolean).length} initiated`);
}

// ─── read traffic ────────────────────────────────────────────────────────────
// fires many GET requests to populate http_request_duration_seconds histogram

async function generateReadTraffic(token, orgId, invoiceIds, clientIds) {
  log("Generating read traffic for HTTP metrics...");
  const headers = authHeaders(token, orgId);
  const rounds = 5;

  for (let r = 0; r < rounds; r++) {
    await batch([
      // list endpoints
      ...Array.from({ length: 8 }, () => async () =>
        req("GET", "/v1/invoices?limit=20", null, headers)),
      ...Array.from({ length: 5 }, () => async () =>
        req("GET", "/v1/clients?limit=20", null, headers)),
      ...Array.from({ length: 3 }, () => async () =>
        req("GET", "/v1/invoices?limit=20&status=draft", null, headers)),
      ...Array.from({ length: 3 }, () => async () =>
        req("GET", "/v1/invoices?limit=20&status=sent", null, headers)),
      // individual resource reads
      ...invoiceIds.slice(0, 6).map((id) => async () =>
        req("GET", `/v1/invoices/${id}`, null, headers)),
      ...clientIds.slice(0, 4).map((id) => async () =>
        req("GET", `/v1/clients/${id}`, null, headers)),
    ]);

    process.stdout.write(`  read round ${r + 1}/${rounds}\r`);
  }
  console.log();
  log("Read traffic done");
}

// ─── analytics traffic ────────────────────────────────────────────────────────

async function generateAnalyticsTraffic(token, orgId) {
  log("Hitting analytics endpoints...");
  const headers = authHeaders(token, orgId);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date().toISOString();

  await Promise.all([
    req("GET", `/v1/analytics/revenue?from=${from}&to=${to}&groupBy=day`, null, headers),
    req("GET", `/v1/analytics/revenue?from=${from}&to=${to}&groupBy=week`, null, headers),
    req("GET", `/v1/analytics/revenue?from=${from}&to=${to}&groupBy=month`, null, headers),
  ]);
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  log(`Seeding against ${BASE_URL}`);

  // sanity check — is the server up?
  try {
    const health = await fetch(`${BASE_URL}/metrics`);
    if (!health.ok) throw new Error(`/metrics returned ${health.status}`);
  } catch (err) {
    console.error(`Server not reachable at ${BASE_URL}. Is docker compose running?`);
    console.error(`Run: docker compose up -d`);
    process.exit(1);
  }

  const { accessToken, orgId } = await setup();
  const clientIds = await createClients(accessToken, orgId);
  const invoiceIds = await createInvoices(accessToken, orgId, clientIds);
  const sentIds = await sendInvoices(accessToken, orgId, invoiceIds);
  await initiatePayments(accessToken, orgId, sentIds);
  await generateReadTraffic(accessToken, orgId, invoiceIds, clientIds);
  await generateAnalyticsTraffic(accessToken, orgId);

  log("Done. Open Grafana at http://localhost:3001");
  log("Open Jaeger at http://localhost:16686");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

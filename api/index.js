const express = require("express");
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");
const { MongoClient, ObjectId } = require("mongodb");
const { simpleParser } = require("mailparser");

const app = express();

const PORT = process.env.API_PORT || 4000;
const MONGO_URI = process.env.MONGO_URL || "mongodb://mongo:27017";
const DB_NAME = process.env.MONGO_DB || "tempmail";
const COLLECTION = process.env.MONGO_COLLECTION || "emails";

const staticDir = path.join(__dirname, "public");
app.use(express.static(staticDir, { extensions: ["html"] }));
app.use(cors());
app.use(express.json());

let collection;
let savedCollection;

// connect to Mongo and start server
async function start() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection(COLLECTION);
    savedCollection = db.collection(process.env.SAVED_COLLECTION || "saved_emails");
    console.log("Mongo connected");

    app.listen(PORT, () => {
      console.log("API running on port", PORT);
    });
  } catch (err) {
    console.error("Mongo connect error", err.message);
    process.exit(1);
  }
}

start();

// health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

function toAbuDhabi(date) {
  return new Date(date).toLocaleString("en-US", {
    timeZone: "Asia/Dubai"
  });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidEmail(value) {
  return EMAIL_REGEX.test(value);
}

function getBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}`;
}

function formatExpiryPayload(date) {
  const expiresAt = new Date(date);
  return {
    expires_at: expiresAt.toISOString(),
    expires_at_formatted: expiresAt.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    })
  };
}

function buildAccessPayload(doc, baseUrl) {
  const expiresAt = new Date(doc.expires_at);
  const formatted = formatExpiryPayload(expiresAt);
  return {
    access_token: doc.token,
    access_url: `${baseUrl}/saved/${doc.token}`,
    ...formatted
  };
}

async function fetchInbox(address) {
  const normalized = address.toLowerCase();

  const docs = await collection
    .find({ rcpt_to: normalized })
    .sort({ receivedAt: -1 })
    .limit(50)
    .toArray();

  const parsedDocs = [];

  for (const doc of docs) {
    let textBody = null;
    let htmlBody = null;

    if (doc.body) {
      try {
        const parsed = await simpleParser(doc.body);
        textBody = parsed.text || null;
        htmlBody = parsed.html || null;
      } catch (err) {
        console.log("Parse error", err.message);
      }
    }

    parsedDocs.push({
      id: doc._id.toString(),
      from_email: doc.mail_from,
      to_email: Array.isArray(doc.rcpt_to) ? doc.rcpt_to[0] : doc.rcpt_to,
      subject: doc.subject,
      body_text: textBody,
      body_html: htmlBody,
      bucket: null,
      object_key: null,
      created_at: toAbuDhabi(doc.receivedAt),
      updated_at: toAbuDhabi(doc.receivedAt)
    });
  }

  return parsedDocs;
}

// inbox list with parsed text and html body
app.get("/inbox/:address", async (req, res) => {
  try {
    const parsedDocs = await fetchInbox(req.params.address);
    res.json(parsedDocs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/fakeemails", async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res
      .status(400)
      .json({ ok: false, error: "The email query parameter is required" });
  }

  try {
    const parsedDocs = await fetchInbox(email);
    res.json(parsedDocs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/save-email", async (req, res) => {
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const email = emailRaw.toLowerCase();

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "A valid email is required" });
  }

  const now = new Date();
  try {
    const existing = await savedCollection.findOne({
      email,
      status: "active",
      expires_at: { $gt: now }
    });

    const baseUrl = getBaseUrl(req);

    if (existing) {
      return res.json(buildAccessPayload(existing, baseUrl));
    }

    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const token = crypto.randomBytes(16).toString("hex");
    const newEntry = {
      email,
      token,
      expires_at: expiresAt,
      email_count: 0,
      status: "active",
      created_at: now,
      updated_at: now
    };

    await savedCollection.insertOne(newEntry);

    res.json(buildAccessPayload(newEntry, baseUrl));
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.get("api//saved/:token", async (req, res) => {
  const { token } = req.params;
  const now = new Date();

  try {
    const doc = await savedCollection.findOne({
      token,
      status: "active"
    });

    if (!doc) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const expiresAt = new Date(doc.expires_at);
    if (expiresAt <= now) {
      await savedCollection.updateOne(
        { _id: doc._id },
        { $set: { status: "expired", updated_at: now } }
      );
      return res.status(410).json({ ok: false, error: "Token expired" });
    }

    const formatted = formatExpiryPayload(expiresAt);
    const daysRemaining = Math.max(
      0,
      Math.ceil((expiresAt - now) / MS_PER_DAY)
    );

    res.json({
      email: doc.email,
      expires_at: formatted.expires_at,
      expires_at_formatted: formatted.expires_at_formatted,
      days_remaining: daysRemaining
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

app.post("/api/check-saved", async (req, res) => {
  const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const email = emailRaw.toLowerCase();

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "A valid email is required" });
  }

  const now = new Date();
  try {
    const doc = await savedCollection.findOne({
      email,
      status: "active",
      expires_at: { $gt: now }
    });

    if (!doc) {
      return res.json({ is_saved: false, data: null });
    }

    const baseUrl = getBaseUrl(req);
    res.json({ is_saved: true, data: buildAccessPayload(doc, baseUrl) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});

// get one message with parsed body
app.get("/message/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const doc = await collection.findOne({ _id: new ObjectId(id) });
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    let textBody = null;
    let htmlBody = null;

    if (doc.body) {
      try {
        const parsed = await simpleParser(doc.body);
        textBody = parsed.text || null;
        htmlBody = parsed.html || null;
      } catch (err) {
        console.log("Parse error", err.message);
      }
    }

    res.json({
      id: doc._id.toString(),
      from_email: doc.mail_from,
      to_email: Array.isArray(doc.rcpt_to) ? doc.rcpt_to[0] : doc.rcpt_to,
      subject: doc.subject,
      body_text: textBody,
      body_html: htmlBody,
      bucket: null,
      object_key: null,
      created_at: doc.receivedAt,
      updated_at: doc.receivedAt
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// simple email count by date plus top sender
// GET /email-count?date=2025-11-17
app.get("/email-count", async (req, res) => {
  try {
    const dateStr = req.query.date;
    if (!dateStr) {
      return res.status(400).json({ ok: false, error: "date is required" });
    }

    const [year, month, day] = dateStr.split("-").map(Number);
    if (!year || !month || !day) {
      return res.status(400).json({ ok: false, error: "invalid date" });
    }

    // Abu Dhabi local day start
    const localStartMs = Date.UTC(year, month - 1, day, 0, 0, 0);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const offsetMs = 4 * 60 * 60 * 1000; // UTC+4

    // convert Abu Dhabi local start and end to UTC
    const startUtc = new Date(localStartMs - offsetMs);
    const endUtc = new Date(localStartMs + oneDayMs - offsetMs);

    const matchStage = {
      receivedAt: { $gte: startUtc, $lt: endUtc }
    };

    const countPromise = collection.countDocuments(matchStage);

    const sendersAggPromise = collection
      .aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$mail_from",
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ])
      .toArray();

    const [count, sendersAgg] = await Promise.all([
      countPromise,
      sendersAggPromise
    ]);

    const senders = sendersAgg
      .filter((s) => s._id && s.count > 2) // more than 2 emails for that day
      .map((s) => ({
        email: s._id,
        count: s.count
      }));

    res.json({
      ok: true,
      date: dateStr,
      count,
      senders
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "server error" });
  }
});


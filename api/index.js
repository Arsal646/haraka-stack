const express = require("express");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");
const { simpleParser } = require("mailparser");

const app = express();

const PORT = process.env.API_PORT || 4000;
const MONGO_URI = process.env.MONGO_URL || "mongodb://mongo:27017";
const DB_NAME = process.env.MONGO_DB || "tempmail";
const COLLECTION = process.env.MONGO_COLLECTION || "emails";

const staticDir = path.join(__dirname, "public");
app.use(express.static(staticDir, { extensions: ["html"] }));

let collection;

// connect to Mongo and start server
async function start() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection(COLLECTION);
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

// inbox list with parsed text and html body
app.get("/inbox/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();

    const docs = await collection
      .find({ rcpt_to: address })
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

    res.json(parsedDocs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
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


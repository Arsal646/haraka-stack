const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { simpleParser } = require("mailparser");
const path = require("path");

const app = express();

const PORT = process.env.API_PORT || 4000;
const MONGO_URI = process.env.MONGO_URL || "mongodb://mongo:27017";
const DB_NAME = process.env.MONGO_DB || "tempmail";
const COLLECTION = process.env.MONGO_COLLECTION || "emails";

let collection;
const dashboardPath = path.join(__dirname, "public", "dashboard.html");

function utcStartOfDay(date) {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

function utcEndOfDay(date) {
  const end = utcStartOfDay(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function utcStartOfWeek(date) {
  const week = utcStartOfDay(date);
  const day = week.getUTCDay();
  week.setUTCDate(week.getUTCDate() - day);
  return week;
}

function utcStartOfMonth(date) {
  const month = utcStartOfDay(date);
  month.setUTCDate(1);
  return month;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error("Invalid date");
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDashboardRange(query = {}) {
  const rangeFilter = {};
  let start = null;
  let end = null;

  if (query.startDate) {
    start = parseIsoDate(query.startDate);
    if (Number.isNaN(start.getTime())) {
      throw new Error("Invalid startDate");
    }
    start = utcStartOfDay(start);
    rangeFilter.$gte = start;
  }

  if (query.endDate) {
    end = new Date(query.endDate);
    if (Number.isNaN(end.getTime())) {
      throw new Error("Invalid endDate");
    }
    end = utcEndOfDay(end);
    rangeFilter.$lte = end;
  }

  return { rangeFilter, start, end };
}

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
        created_at: doc.receivedAt,
        updated_at: doc.receivedAt
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

app.get("/dashboard", (req, res) => {
  res.sendFile(dashboardPath);
});

app.get("/dashboard-data", async (req, res) => {
  try {
    const now = new Date();
    const todayFilter = { receivedAt: { $gte: utcStartOfDay(now) } };
    const weekFilter = { receivedAt: { $gte: utcStartOfWeek(now) } };
    const monthFilter = { receivedAt: { $gte: utcStartOfMonth(now) } };

    const [todayCount, weekCount, monthCount] = await Promise.all([
      collection.countDocuments(todayFilter),
      collection.countDocuments(weekFilter),
      collection.countDocuments(monthFilter)
    ]);

    let filteredCount = null;
    let start = null;
    let end = null;
    let rangeFilter = {};

    try {
      ({ rangeFilter, start, end } = parseDashboardRange(req.query));
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    if (Object.keys(rangeFilter).length) {
      filteredCount = await collection.countDocuments({ receivedAt: rangeFilter });
    }

    const topDomainsPipeline = [
      { $match: { mail_from: { $type: "string" } } },
      {
        $project: {
          domain: {
            $arrayElemAt: [
              { $split: [{ $toLower: "$mail_from" }, "@"] },
              -1
            ]
          }
        }
      },
      { $match: { domain: { $nin: [null, ""] } } },
      { $group: { _id: "$domain", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { domain: "$_id", count: 1, _id: 0 } }
    ];

    const repeatedRecipientsPipeline = [
      { $match: { rcpt_to: { $exists: true } } },
      {
        $project: {
          recipients: {
            $cond: [
              { $isArray: "$rcpt_to" },
              "$rcpt_to",
              ["$rcpt_to"]
            ]
          }
        }
      },
      { $unwind: "$recipients" },
      { $group: { _id: "$recipients", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { recipient: "$_id", count: 1, _id: 0 } }
    ];

    const [topDomains, repeatedRecipients] = await Promise.all([
      collection.aggregate(topDomainsPipeline, { allowDiskUse: true }).toArray(),
      collection.aggregate(
        repeatedRecipientsPipeline,
        { allowDiskUse: true }
      ).toArray()
    ]);

    res.json({
      today: todayCount,
      week: weekCount,
      month: monthCount,
      filtered: filteredCount,
      filter: {
        start: start ? start.toISOString().split("T")[0] : null,
        end: end ? end.toISOString().split("T")[0] : null
      },
      topDomains,
      repeatedRecipients
    });
  } catch (err) {
    console.error("Dashboard data error", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/dashboard-emails", async (req, res) => {
  try {
    const { rangeFilter } = parseDashboardRange(req.query);
    const filter = Object.keys(rangeFilter).length ? { receivedAt: rangeFilter } : {};

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(req.query.pageSize, 10) || 15));
    const skip = (page - 1) * pageSize;

    const total = await collection.countDocuments(filter);

    const docs = await collection
      .find(filter)
      .sort({ receivedAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .toArray();

    const response = {
      total,
      page,
      pageSize,
      emails: docs.map((doc) => ({
        id: doc._id.toString(),
        from_email: doc.mail_from,
        to_email: Array.isArray(doc.rcpt_to) ? doc.rcpt_to[0] : doc.rcpt_to,
        subject: doc.subject,
        created_at: doc.receivedAt
      }))
    };

    res.json(response);
  } catch (err) {
    console.error("Dashboard email error", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

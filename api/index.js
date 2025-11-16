const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { simpleParser } = require("mailparser");

const app = express();

const PORT = process.env.API_PORT || 4000;
const MONGO_URI = process.env.MONGO_URL || "mongodb://mongo:27017";
const DB_NAME = process.env.MONGO_DB || "tempmail";
const COLLECTION = process.env.MONGO_COLLECTION || "emails";

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
        _id: doc._id,
        mail_from: doc.mail_from,
        rcpt_to: doc.rcpt_to,
        subject: doc.subject,
        receivedAt: doc.receivedAt,
        textBody,
        htmlBody
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
      _id: doc._id,
      mail_from: doc.mail_from,
      rcpt_to: doc.rcpt_to,
      subject: doc.subject,
      receivedAt: doc.receivedAt,
      textBody,
      htmlBody
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

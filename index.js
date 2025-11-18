import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import { simpleParser } from "mailparser";

const app = express();

const mongoUrl = process.env.MONGO_URL || "mongodb://mongo:27017";
const dbName = process.env.MONGO_DB || "tempmail";
const collName = process.env.MONGO_COLLECTION || "emails";
const port = process.env.API_PORT || 4000;

let collection;

// connect to Mongo
async function initMongo() {
  const client = await MongoClient.connect(mongoUrl);
  const db = client.db(dbName);
  collection = db.collection(collName);
  console.log("API connected to Mongo", mongoUrl, dbName, collName);
}


app.use(express.static("public"));

// health check
app.get("/health", (req, res) => {
  res.json({ ok: true, helo: "tempmail-mongo-api" });
});

// inbox list with parsed text and html
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

      try {
        if (doc.body) {
          const parsed = await simpleParser(doc.body);
          textBody = parsed.text || null;
          htmlBody = parsed.html || null;
        }
      } catch (err) {
        console.error("Parse error:", err.message);
      }

      parsedDocs.push({
        id: doc._id.toString(),
        from_email: doc.mail_from,
        to_email: Array.isArray(doc.rcpt_to)
          ? doc.rcpt_to[0]
          : doc.rcpt_to,
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

// single message with parsed body
app.get("/message/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await collection.findOne({ _id: new ObjectId(id) });

    if (!doc) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    let textBody = null;
    let htmlBody = null;

    try {
      if (doc.body) {
        const parsed = await simpleParser(doc.body);
        textBody = parsed.text || null;
        htmlBody = parsed.html || null;
      }
    } catch (err) {
      console.error("Parse error:", err.message);
    }

    res.json({
      id: doc._id.toString(),
      from_email: doc.mail_from,
      to_email: Array.isArray(doc.rcpt_to)
        ? doc.rcpt_to[0]
        : doc.rcpt_to,
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

initMongo()
  .then(() => {
    app.listen(port, () => {
      console.log("API listening on port", port);
    });
  })
  .catch((err) => {
    console.error("Mongo init error", err);
    process.exit(1);
  });

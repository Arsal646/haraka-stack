const { simpleParser } = require("mailparser");

function toAbuDhabi(date) {
  return new Date(date).toLocaleString("en-US", {
    timeZone: "Asia/Dubai"
  });
}

async function fetchInbox(collection, address) {
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

module.exports = function registerInboxRoutes(app, collection) {
  app.get("/inbox/:address", async (req, res) => {
    try {
      const parsedDocs = await fetchInbox(collection, req.params.address);
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
      const parsedDocs = await fetchInbox(collection, email);
      res.json(parsedDocs);
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};

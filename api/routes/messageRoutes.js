const { ObjectId } = require("mongodb");
const { simpleParser } = require("mailparser");

module.exports = function registerMessageRoutes(app, collection) {
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
};

const crypto = require("crypto");

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

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function formatExpiryPayload(dateValue) {
  const expiresAt = toDate(dateValue);
  const datePart = expiresAt.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
  const timePart = expiresAt.toLocaleString("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    timeZone: "UTC"
  });

  return {
    expires_at: expiresAt.toISOString(),
    expires_at_formatted: `${datePart} at ${timePart}`
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

module.exports = function registerSavedEmailRoutes(app, savedCollection) {
  app.post("api/save-email", async (req, res) => {
    const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const email = emailRaw.toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
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
        return res.json({
          success: true,
          message: "Email already saved",
          data: buildAccessPayload(existing, baseUrl)
        });
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

      res.json({
        success: true,
        message: "Email saved successfully",
        data: buildAccessPayload(newEntry, baseUrl)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "server error" });
    }
  });

  app.get("api/saved/:token", async (req, res) => {
    const { token } = req.params;
    const now = new Date();

    try {
      const doc = await savedCollection.findOne({
        token,
        status: "active"
      });

      if (!doc) {
        return res.status(404).json({
          success: false,
          message: "Saved email not found"
        });
      }

      const expiresAt = new Date(doc.expires_at);
      if (expiresAt <= now) {
        await savedCollection.updateOne(
          { _id: doc._id },
          { $set: { status: "expired", updated_at: now } }
        );
        return res.status(410).json({
          success: false,
          message: "Saved email has expired"
        });
      }

      const formatted = formatExpiryPayload(expiresAt);
      const daysRemaining = Math.max(0, Math.floor((expiresAt - now) / MS_PER_DAY));

      res.json({
        success: true,
        data: {
          email_address: doc.email,
          expires_at: formatted.expires_at,
          expires_at_formatted: formatted.expires_at_formatted,
          days_remaining: daysRemaining
        }
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "server error" });
    }
  });

  app.post("api/check-saved", async (req, res) => {
    const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const email = emailRaw.toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid email is required" });
    }

    const now = new Date();
    try {
      const doc = await savedCollection.findOne({
        email,
        status: "active",
        expires_at: { $gt: now }
      });

      if (!doc) {
        return res.json({
          success: true,
          is_saved: false,
          data: null
        });
      }

      const baseUrl = getBaseUrl(req);
      res.json({
        success: true,
        is_saved: true,
        data: buildAccessPayload(doc, baseUrl)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "server error" });
    }
  });
};

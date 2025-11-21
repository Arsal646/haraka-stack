const MS_PER_DAY = 24 * 60 * 60 * 1000;

module.exports = function registerEmailCountRoutes(app, collection) {
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

      const localStartMs = Date.UTC(year, month - 1, day, 0, 0, 0);
      const oneDayMs = 24 * 60 * 60 * 1000;
      const offsetMs = 4 * 60 * 60 * 1000; // UTC+4

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
        .filter((s) => s._id && s.count > 2)
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
};

const { MongoClient } = require("mongodb");

let collection = null;

exports.register = function () {
  const plugin = this;

  const url = process.env.MONGO_URL || "mongodb://mongo:27017";
  const dbName = process.env.MONGO_DB || "tempmail";
  const collName = process.env.MONGO_COLLECTION || "emails";

  MongoClient.connect(url)
    .then((client) => {
      const db = client.db(dbName);
      collection = db.collection(collName);
      plugin.loginfo(`Mongo connected to ${url}, db ${dbName}, collection ${collName}`);
    })
    .catch((err) => {
      plugin.logerror("Mongo connection error: " + err.message);
    });

  this.register_hook("data_post", "save_to_mongo");
};

exports.save_to_mongo = function (next, connection) {
  const plugin = this;

  if (!collection) {
    plugin.logerror("Mongo not ready, skipping save");
    return next();
  }

  const txn = connection.transaction;

  const mail_from = txn.mail_from && txn.mail_from.address();
  const rcpt_to = txn.rcpt_to && txn.rcpt_to.map((addr) => addr.address());
  const subject = txn.header ? txn.header.get("subject") || "" : "";
  const headers = txn.header ? txn.header.headers_decoded : {};

  // Haraka message_stream.get_data gives only "data", no error param
  txn.message_stream.get_data((data) => {
    try {
      const body = data.toString("utf8");

      const doc = {
        mail_from,
        rcpt_to,
        subject,
        headers,
        body,
        receivedAt: new Date(),
      };

      collection
        .insertOne(doc)
        .then(() => {
          plugin.loginfo("Saved email for " + rcpt_to);
          next();
        })
        .catch((e) => {
          plugin.logerror("Mongo insert error: " + e.message);
          next();
        });
    } catch (e) {
      plugin.logerror("Exception reading message stream: " + e.message);
      next();
    }
  });
};

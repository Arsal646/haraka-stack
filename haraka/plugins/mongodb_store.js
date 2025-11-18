const { MongoClient } = require("mongodb");

let collection = null;

exports.register = function () {
  const plugin = this;

  const url = process.env.MONGO_URL || "mongodb://mongo:27017";
  const dbName = process.env.MONGO_DB || "tempmail";
  const collName = process.env.MONGO_COLLECTION || "emails";

  plugin.loginfo("PLUGIN REGISTER STARTED");

  MongoClient.connect(url)
    .then((client) => {
      const db = client.db(dbName);
      collection = db.collection(collName);
      plugin.loginfo(`Mongo connected to ${url}, db ${dbName}, collection ${collName}`);
    })
    .catch((err) => {
      plugin.logerror("Mongo connection error: " + err.message);
    });

  // Add more logs here
  plugin.loginfo("Registering hook: data_post");

  this.register_hook("data_post", "save_to_mongo");
};

exports.save_to_mongo = function (next, connection) {
  const plugin = this;

  plugin.loginfo("---- DATA_POST HOOK TRIGGERED ----");

  if (!collection) {
    plugin.logerror("Mongo not ready, skipping save");
    return next();
  }

  const txn = connection.transaction;

  plugin.loginfo("Transaction UUID: " + txn.uuid);

  const mail_from = txn.mail_from && txn.mail_from.address();
  const rcpt_to = txn.rcpt_to && txn.rcpt_to.map((addr) => addr.address());

  plugin.loginfo("Mail From: " + mail_from);
  plugin.loginfo("RCPT TO: " + JSON.stringify(rcpt_to));

  const subject = txn.header ? txn.header.get("subject") || "" : "";
  plugin.loginfo("Subject: " + subject);

  // Log how many times get_data fires
  let getDataCount = 0;

  plugin.loginfo("Calling message_stream.get_data...");

  txn.message_stream.get_data((data) => {
    getDataCount++;
    plugin.loginfo("get_data fired: " + getDataCount + " time(s)");

    try {
      const body = data.toString("utf8");

      plugin.loginfo("Body length: " + body.length);

      const doc = {
        mail_from,
        rcpt_to,
        subject,
        headers: txn.header ? txn.header.headers_decoded : {},
        body,
        receivedAt: new Date(),
        debug_uuid: txn.uuid,
        debug_get_data_call: getDataCount
      };

      plugin.loginfo("Attempting Mongo insertOne...");

      collection
        .insertOne(doc)
        .then(() => {
          plugin.loginfo("Inserted email for " + rcpt_to + " with UUID " + txn.uuid);
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

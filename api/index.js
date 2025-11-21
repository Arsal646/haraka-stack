const express = require("express");
const path = require("path");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const registerSavedEmailRoutes = require("./routes/savedEmailRoutes");
const registerInboxRoutes = require("./routes/inboxRoutes");
const registerMessageRoutes = require("./routes/messageRoutes");
const registerEmailCountRoutes = require("./routes/emailCountRoutes");

const app = express();

const PORT = process.env.API_PORT || 4000;
const MONGO_URI = process.env.MONGO_URL || "mongodb://mongo:27017";
const DB_NAME = process.env.MONGO_DB || "tempmail";
const COLLECTION = process.env.MONGO_COLLECTION || "emails";

const staticDir = path.join(__dirname, "public");
app.use(express.static(staticDir, { extensions: ["html"] }));
app.use(cors());
app.use(express.json());

let collection;
let savedCollection;

// connect to Mongo and start server
async function start() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    collection = db.collection(COLLECTION);
    savedCollection = db.collection(process.env.SAVED_COLLECTION || "saved_emails");
    console.log("Mongo connected");
    registerSavedEmailRoutes(app, savedCollection);
    registerInboxRoutes(app, collection);
    registerMessageRoutes(app, collection);
    registerEmailCountRoutes(app, collection);

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

const ex = require("ex" + "press");
const cr = require("co" + "rs");
const jw = require("json" + "webtoken");
const { MongoClient, ObjectId, ServerApiVersion } = require("mongo" + "db");
require("do" + "tenv").config();

const app = ex();
const port = process.env.PORT || 5000;

app.use(cr({ origin: [process.env.CLIENT_URL, "http://localhost:3000"], credentials: true }));
app.use(ex.json());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).send({ message: "Unauthorized - Please login again" });
  const token = auth.split(" ")[1];
  jw.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden - Token expired, login again" });
    req.decoded = decoded;
    next();
  });
}

// Date present + future kina check
function isPastDate(dateStr) {
  if (!dateStr) return true;
  const today = new Date().toISOString().split("T")[0];
  return new Date(dateStr) < new Date(today);
}

function isValidId(id) {
  return ObjectId.isValid(id);
}

async function run() {
  try {
    await client.connect();
    const db = client.db("manobshebaDB");
    const eventsCol = db.collection("events");
    const joinedCol = db.collection("joined");

    app.post("/api/auth/token", (req, res) => {
      const user = req.body;
      const token = jw.sign(user, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.send({ token });
    });

    app.get("/api/events", async (req, res) => {
      const { search = "", type = "" } = req.query;
      let query = {};
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ];
      }
      if (type) {
        query.eventType = { $regex: type, $options: "i" };
      }
      const result = await eventsCol.find(query).sort({ eventDate: 1 }).toArray();
      res.send(result);
    });

    app.get("/api/events/recent", async (req, res) => {
      const result = await eventsCol.find({}).sort({ eventDate: 1 }).limit(6).toArray();
      res.send(result);
    });

    app.get("/api/events/:id", async (req, res) => {
      if (!isValidId(req.params.id)) return res.status(400).send({ message: "Invalid event id" });
      const result = await eventsCol.findOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    app.get("/api/events/my/:email", verifyToken, async (req, res) => {
      if (req.decoded.email !== req.params.email) return res.status(403).send({ message: "Forbidden" });
      const result = await eventsCol.find({ creatorEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.post("/api/events", verifyToken, async (req, res) => {
      try {
        const { title, description, location, eventType, eventDate, thumbnail, creatorEmail } = req.body;
        // Assignment: sob field lagbe
        if (!title || !description || !location || !eventType || !eventDate || !thumbnail) {
          return res.status(400).send({ message: "All fields are required" });
        }
        // Assignment: date present + future hote hobe
        if (isPastDate(eventDate)) {
          return res.status(400).send({ message: "Event date must be present and future" });
        }
        // Creator token er email diyei hote hobe
        if (creatorEmail && creatorEmail !== req.decoded.email) {
          return res.status(403).send({ message: "Not authorized" });
        }
        const doc = { ...req.body, creatorEmail: req.decoded.email };
        delete doc._id;
        const result = await eventsCol.insertOne(doc);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.put("/api/events/:id", verifyToken, async (req, res) => {
      try {
        if (!isValidId(req.params.id)) return res.status(400).send({ message: "Invalid event id" });
        const { title, description, location, eventType, eventDate, thumbnail } = req.body;

        if (!title || !description || !location || !eventType || !eventDate || !thumbnail) {
          return res.status(400).send({ message: "All fields are required" });
        }
        if (isPastDate(eventDate)) {
          return res.status(400).send({ message: "Event date must be present and future" });
        }

        const event = await eventsCol.findOne({ _id: new ObjectId(req.params.id) });
        if (!event) return res.status(404).send({ message: "Event not found" });
        if (event.creatorEmail !== req.decoded.email) {
          return res.status(403).send({ message: "Not authorized - only creator can edit" });
        }

        // FIX: _id ke $set theke bad dao, nahole 【entity-MongoDB¦canonical_name=MongoDB】 error dey
        const { _id, ...updateData } = req.body;
        const result = await eventsCol.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { title, description, location, eventType, eventDate, thumbnail, ...updateData, title, description, location, eventType, eventDate, thumbnail } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.delete("/api/events/:id", verifyToken, async (req, res) => {
      try {
        if (!isValidId(req.params.id)) return res.status(400).send({ message: "Invalid event id" });
        const event = await eventsCol.findOne({ _id: new ObjectId(req.params.id) });
        if (!event) return res.status(404).send({ message: "Event not found" });
        if (event.creatorEmail !== req.decoded.email) {
          return res.status(403).send({ message: "Not authorized - only creator can delete" });
        }
        const result = await eventsCol.deleteOne({ _id: new ObjectId(req.params.id) });
        // Ei event e jara join korsilo tader record o delete
        await joinedCol.deleteMany({ eventId: req.params.id });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.post("/api/joined", verifyToken, async (req, res) => {
      const data = req.body;
      const exists = await joinedCol.findOne({ eventId: data.eventId, userEmail: data.userEmail });
      if (exists) return res.send({ message: "Already joined" });
      const result = await joinedCol.insertOne(data);
      res.send(result);
    });

    app.get("/api/joined/:email", verifyToken, async (req, res) => {
      if (req.decoded.email !== req.params.email) return res.status(403).send({ message: "Forbidden" });
      const result = await joinedCol.find({ userEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.get("/api/joined/count/:eventId", async (req, res) => {
      const count = await joinedCol.countDocuments({ eventId: req.params.eventId });
      res.send({ count });
    });

    app.delete("/api/joined/:eventId", verifyToken, async (req, res) => {
      // FIX: age sudhu query.email khujto, ekhon token er email o use korbe
      const email = req.query.email || req.decoded.email;
      const result = await joinedCol.deleteOne({ eventId: req.params.eventId, userEmail: email });
      res.send(result);
    });

    console.log("ManobSheba DB Connected");
  } finally {}
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("ManobSheba Server is Running..."));

app.listen(port, () => console.log(`ManobSheba Server on port ${port}`));
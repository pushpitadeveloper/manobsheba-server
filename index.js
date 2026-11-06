require("do"+"tenv").config();
const ex = require("ex"+"press");
const co = require("co"+"rs");
const jwt = require("json"+"webtoken");
const { MongoClient, ObjectId } = require("mongo"+"db");

const app = ex();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(co({
  origin: [CLIENT_URL, "http://localhost:3000", "https://manobsheba-client.vercel.app"],
  credentials: true,
}));
app.use(ex.json());

const client = new MongoClient(process.env.MONGODB_URI);
let eventsCollection, joinedCollection;

function isValidId(id) {
  return ObjectId.isValid(id);
}
function isPastDate(dateStr) {
  if (!dateStr) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d < today;
}

// FIX 1: Token problem hole 401, Forbidden er jonno 403 alada
function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token" });
  }
  const token = auth.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.decoded = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Unauthorized: Token expired or invalid" });
  }
}

app.get("/", (req, res) => {
  res.send("ManobSheba Server is Running...");
});

app.post("/api/auth/token", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required" });
  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token });
});

app.get("/api/events", async (req, res) => {
  try {
    const { search, type } = req.query;
    const query = {};
    if (search) query.title = { $regex: search, $options: "i" };
    if (type && type !== "All") query.eventType = { $regex: type, $options: "i" };
    const events = await eventsCollection.find(query).sort({ eventDate: 1 }).toArray();
    res.json({ events });
  } catch {
    res.status(500).json({ message: "Failed to fetch events" });
  }
});

app.get("/api/events/recent", async (req, res) => {
  try {
    const events = await eventsCollection.find({}).sort({ _id: -1 }).limit(6).toArray();
    res.json({ events });
  } catch {
    res.status(500).json({ message: "Failed to fetch recent events" });
  }
});

app.get("/api/events/my/:email", verifyToken, async (req, res) => {
  try {
    if (req.decoded.email !== req.params.email) {
      return res.status(403).json({ message: "Forbidden: not your events" });
    }
    const events = await eventsCollection.find({ creatorEmail: req.params.email }).sort({ eventDate: 1 }).toArray();
    res.json({ events });
  } catch {
    res.status(500).json({ message: "Failed to fetch my events" });
  }
});

app.get("/api/events/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid id" });
    const event = await eventsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!event) return res.status(404).json({ message: "Event not found" });
    res.json({ event });
  } catch {
    res.status(500).json({ message: "Failed to fetch event" });
  }
});

app.post("/api/events", verifyToken, async (req, res) => {
  try {
    const { title, description, location, eventType, eventDate, thumbnail } = req.body;
    if (!title || !description || !location || !eventType || !eventDate || !thumbnail) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (isPastDate(eventDate)) {
      return res.status(400).json({ message: "Event date must be present and future" });
    }
    // FIX 2: creatorEmail client theke na niye token theke nao - tahole Delete e ar mismatch hobe na
    const newEvent = {
      title, description, location, eventType, eventDate, thumbnail,
      creatorEmail: req.decoded.email,
      creatorName: req.body.creatorName || "",
      createdAt: new Date(),
    };
    const result = await eventsCollection.insertOne(newEvent);
    res.json(result);
  } catch {
    res.status(500).json({ message: "Failed to create event" });
  }
});

app.put("/api/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid id" });
    const { title, description, location, eventType, eventDate, thumbnail } = req.body;
    if (!title || !description || !location || !eventType || !eventDate || !thumbnail) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (isPastDate(eventDate)) {
      return res.status(400).json({ message: "Event date must be present and future" });
    }
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.creatorEmail !== req.decoded.email) {
      return res.status(403).json({ message: "Forbidden: not your event" });
    }
    // FIX: $set: req.body dile _id chole ase, tai explicit field
    await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { title, description, location, eventType, eventDate, thumbnail } }
    );
    res.json({ message: "Updated" });
  } catch {
    res.status(500).json({ message: "Failed to update event" });
  }
});

app.delete("/api/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid id" });
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.creatorEmail !== req.decoded.email) {
      return res.status(403).json({ message: "Forbidden: not your event" });
    }
    await eventsCollection.deleteOne({ _id: new ObjectId(id) });
    await joinedCollection.deleteMany({ eventId: id });
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ message: "Failed to delete event" });
  }
});

app.post("/api/joined", verifyToken, async (req, res) => {
  try {
    const { eventId, eventTitle, thumbnail } = req.body;
    if (!eventId) return res.status(400).json({ message: "Event id required" });
    const exists = await joinedCollection.findOne({ eventId, userEmail: req.decoded.email });
    if (exists) return res.status(400).json({ message: "Already joined" });
    const result = await joinedCollection.insertOne({
      eventId, eventTitle: eventTitle || "", thumbnail: thumbnail || "",
      userEmail: req.decoded.email,
      joinedAt: new Date(),
    });
    res.json(result);
  } catch {
    res.status(500).json({ message: "Failed to join event" });
  }
});

app.get("/api/joined/:email", verifyToken, async (req, res) => {
  try {
    if (req.decoded.email !== req.params.email) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const joined = await joinedCollection.find({ userEmail: req.params.email }).sort({ joinedAt: -1 }).toArray();
    res.json({ joined });
  } catch {
    res.status(500).json({ message: "Failed to fetch joined events" });
  }
});

app.get("/api/joined/count/:eventId", async (req, res) => {
  try {
    const count = await joinedCollection.countDocuments({ eventId: req.params.eventId });
    res.json({ count });
  } catch {
    res.json({ count: 0 });
  }
});

app.delete("/api/joined/:eventId", verifyToken, async (req, res) => {
  try {
    await joinedCollection.deleteOne({ eventId: req.params.eventId, userEmail: req.decoded.email });
    res.json({ message: "Left" });
  } catch {
    res.status(500).json({ message: "Failed to leave event" });
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db("manobshebaDB");
    eventsCollection = db.collection("events");
    joinedCollection = db.collection("joined");
    console.log("ManobSheba DB Connected");
    app.listen(PORT, () => console.log(`ManobSheba Server on port ${PORT}`));
  } catch (err) {
    console.error(err);
  }
}
run();
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
  if (!auth) return res.status(401).send({ message: "Unauthorized" });
  const token = auth.split(" ")[1];
  jw.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden" });
    req.decoded = decoded;
    next();
  });
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
      const result = await eventsCol.findOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    app.get("/api/events/my/:email", verifyToken, async (req, res) => {
      if (req.decoded.email !== req.params.email) return res.status(403).send({ message: "Forbidden" });
      const result = await eventsCol.find({ creatorEmail: req.params.email }).toArray();
      res.send(result);
    });

    app.post("/api/events", verifyToken, async (req, res) => {
      const result = await eventsCol.insertOne(req.body);
      res.send(result);
    });

    app.put("/api/events/:id", verifyToken, async (req, res) => {
      const result = await eventsCol.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body }
      );
      res.send(result);
    });

    app.delete("/api/events/:id", verifyToken, async (req, res) => {
      const result = await eventsCol.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
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
      const result = await joinedCol.deleteOne({ eventId: req.params.eventId, userEmail: req.query.email });
      res.send(result);
    });

    console.log("ManobSheba DB Connected");
  } finally {}
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("ManobSheba Server is Running..."));

app.listen(port, () => console.log(`ManobSheba Server on port ${port}`));
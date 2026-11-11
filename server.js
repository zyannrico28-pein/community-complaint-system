require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const complaintRoutes = require("./routes/complaints");
const app = express();
const server = http.createServer(app);

const io = new Server(server);

// Make Socket.IO available to API routes.
app.set("io", io);

app.use(express.json());
app.use(express.static("public"));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/complaints", complaintRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    message: "An unexpected server error occurred."
  });
});

const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error("Missing JWT_SECRET. Configure your .env file.");
  process.exit(1);
}

mongoose.connect(
  process.env.MONGODB_URI ||
  "mongodb://127.0.0.1:27017/community_complaint_system"
)
  .then(() => {
    console.log("Connected to MongoDB");

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });

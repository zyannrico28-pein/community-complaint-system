
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const User = require("./models/User");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from your .env file.");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const name = (await ask("Admin name: ")).trim();
    const email = (await ask("Admin email: ")).trim().toLowerCase();
    const password = await ask("New admin password (hidden input not enabled): ");

    if (!name || !email || password.length < 8) {
      throw new Error("Name and email are required; password must be at least 8 characters.");
    }

    const existing = await User.findOne({ email });

    if (existing) {
      throw new Error(
        "That email already exists. No account was changed. Use a different email or promote the existing account securely."
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await User.create({
      name,
      email,
      passwordHash,
      role: "admin"
    });

    console.log(`Admin account created for ${email}.`);
  } catch (err) {
    console.error("Admin setup failed:", err.message);
    process.exitCode = 1;
  } finally {
    rl.close();
    await mongoose.disconnect().catch(() => {});
  }
}

main();

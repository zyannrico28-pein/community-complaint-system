
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: false
  },
  googleId: {
    type: String,
    sparse: true
  },
  facebookId: {
    type: String,
    sparse: true
  },
  role: {
    type: String,
    enum: ["resident", "admin"],
    default: "resident"
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);

const { OAuth2Client } = require("google-auth-library");
const https = require("https");

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

function getJsonFromUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = "";

      response.on("data", (chunk) => {
        body += chunk;
      });

      response.on("end", () => {
        try {
          const data = JSON.parse(body);

          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(
              new Error(data.error?.message || "Authentication provider request failed.")
            );
          }

          resolve(data);
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function createSocialSession(user, res) {
  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  return res.json({
    message: "Social login successful.",
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    }
  });
}

const router = express.Router();

router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters." });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ message: "That email is already registered." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name: String(name).trim(), email: normalizedEmail, passwordHash });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.status(201).json({
      message: "Account created.",
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "That email is already registered." });
    next(err);
  }
});

router.post("/google", async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential || !process.env.GOOGLE_CLIENT_ID) {
      return res.status(400).json({
        message: "Google authentication is not configured."
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({
        message: "Google account email could not be verified."
      });
    }

    const email = payload.email.toLowerCase().trim();

    let user = await User.findOne({
      $or: [
        { googleId: payload.sub },
        { email }
      ]
    });

    if (user) {
      if (user.googleId && user.googleId !== payload.sub) {
        return res.status(409).json({
          message: "This email is already linked to another Google account."
        });
      }

      user.googleId = payload.sub;

      if (!user.name) {
        user.name = payload.name || email.split("@")[0];
      }

      await user.save();
    } else {
      user = await User.create({
        name: payload.name || email.split("@")[0],
        email,
        googleId: payload.sub
      });
    }

    return createSocialSession(user, res);
  } catch (err) {
    next(err);
  }
});


router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const user = await User.findOne({ email });

    if (
      !user ||
      !user.passwordHash ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return res.status(401).json({
        message: "Incorrect email or password."
      });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (err) {
    next(err);
  }
});


router.post("/facebook", async (req, res, next) => {
  try {
    const { accessToken } = req.body;

    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;

    if (!accessToken || !appId || !appSecret) {
      return res.status(400).json({
        message: "Facebook authentication is not configured."
      });
    }

    const appAccessToken = `${appId}|${appSecret}`;

    const debugUrl = new URL(
      "https://graph.facebook.com/debug_token"
    );

    debugUrl.searchParams.set("input_token", accessToken);
    debugUrl.searchParams.set("access_token", appAccessToken);

    const debugResult = await getJsonFromUrl(debugUrl);

    if (
      !debugResult.data?.is_valid ||
      debugResult.data.app_id !== appId
    ) {
      return res.status(401).json({
        message: "Invalid Facebook access token."
      });
    }

    const profileUrl = new URL(
      "https://graph.facebook.com/me"
    );

    profileUrl.searchParams.set("fields", "id,name,email");
    profileUrl.searchParams.set("access_token", accessToken);

    const profile = await getJsonFromUrl(profileUrl);

    if (
      !profile.id ||
      profile.id !== debugResult.data.user_id ||
      !profile.email
    ) {
      return res.status(400).json({
        message: "Facebook did not provide a valid email address. Please allow email permission."
      });
    }

    const email = profile.email.toLowerCase().trim();

    let user = await User.findOne({
      $or: [
        { facebookId: profile.id },
        { email }
      ]
    });

    if (user) {
      if (user.facebookId && user.facebookId !== profile.id) {
        return res.status(409).json({
          message: "This email is already linked to another Facebook account."
        });
      }

      user.facebookId = profile.id;

      if (!user.name) {
        user.name = profile.name || email.split("@")[0];
      }

      await user.save();
    } else {
      user = await User.create({
        name: profile.name || email.split("@")[0],
        email,
        facebookId: profile.id
      });
    }

    return createSocialSession(user, res);
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role } });
});

module.exports = router;


const express = require("express");
const multer = require("multer");
const Complaint = require("../models/Complaint");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { isInsidePoblacion } = require("../utils/geofence");
const { assessComplaint } = require("../utils/riskAssessment");

const router = express.Router();


const categories = [
  "Road and Infrastructure",
  "Garbage",
  "Noise",
  "Water Supply",
  "Streetlights",
  "Public Safety",
  "Other"
];


const statuses = [
  "Pending",
  "Under Review",
  "In Progress",
  "Resolved",
  "Rejected"
];

const verificationStatuses = ["Verified", "Rejected"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        new Error("Only JPEG, PNG, and WebP images are allowed.")
      );
    }

    cb(null, true);
  }
});

// Validate the actual file signature, not just the claimed MIME type.
function getVerifiedImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  // JPEG
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // PNG
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

// Avoid returning the base64 image data in JSON responses.
function sanitizeComplaint(complaint) {
  const result = complaint.toObject
    ? complaint.toObject()
    : { ...complaint };

  if (result.evidence) {
    delete result.evidence.imageData;
  }

  return result;
}

function emitComplaintUpdate(req) {
  const io = req.app.get("io");
  if (io) io.emit("complaints:updated");
}

router.use(requireAuth);

// List complaints: residents see their own; admins see all.
router.get("/", async (req, res, next) => {
  try {
    const filter = req.user.role === "admin"
      ? {}
      : { submittedBy: req.user._id };

    const complaints = await Complaint.find(filter)
      .populate("submittedBy", "name email")
      .populate("statusHistory.changedBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      complaints: complaints.map(complaint => {
        if (complaint.evidence) {
          delete complaint.evidence.imageData;
        }
        return complaint;
      })
    });
  } catch (err) {
    next(err);
  }
});

// Retrieve evidence securely: only the complainant or an admin can view it.
router.get("/:id/evidence", async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .select("+evidence.imageData");

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found."
      });
    }

    const isOwner =
      String(complaint.submittedBy) === String(req.user._id);

    if (req.user.role !== "admin" && !isOwner) {
      return res.status(403).json({
        message: "You are not allowed to view this photo."
      });
    }

    const evidence = complaint.evidence;

    if (!evidence?.imageData || !evidence?.mimeType) {
      return res.status(404).json({
        message: "No photo evidence was uploaded for this complaint."
      });
    }

    const buffer = Buffer.from(evidence.imageData, "base64");
    const verifiedType = getVerifiedImageType(buffer);

    if (!verifiedType || verifiedType !== evidence.mimeType) {
      return res.status(500).json({
        message: "The stored evidence image is invalid."
      });
    }

    res.set("Content-Type", verifiedType);
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "private, no-store");

    return res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// Submit a complaint with required photo evidence and GPS validation.
router.post(
  "/",
  (req, res, next) => {
    upload.single("evidencePhoto")(req, res, err => {
      if (err) {
        const status = err instanceof multer.MulterError ? 400 : 400;
        return res.status(status).json({
          message: err.message || "Photo upload failed."
        });
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const {
        title,
        description,
        category,
        location,
        capturedAt
      } = req.body;

      if (
        typeof title !== "string" || !title.trim() ||
        typeof description !== "string" || !description.trim() ||
        typeof category !== "string" || !categories.includes(category) ||
        typeof location !== "string" || !location.trim()
      ) {
        return res.status(400).json({
          message:
            "Valid title, description, category, and location are required."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "A photo taken with the camera is required."
        });
      }

      const verifiedType = getVerifiedImageType(req.file.buffer);

      if (!verifiedType || verifiedType !== req.file.mimetype) {
        return res.status(400).json({
          message:
            "The uploaded file is not a valid JPEG, PNG, or WebP image."
        });
      }

      let coordinates;

      try {
        coordinates = typeof req.body.coordinates === "string"
          ? JSON.parse(req.body.coordinates)
          : req.body.coordinates;
      } catch {
        return res.status(400).json({
          message: "Invalid GPS coordinates format."
        });
      }

      const { latitude, longitude } = coordinates || {};

      if (
        typeof latitude !== "number" ||
        typeof longitude !== "number" ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180
      ) {
        return res.status(400).json({
          message: "Valid GPS latitude and longitude are required."
        });
      }

      if (!isInsidePoblacion(longitude, latitude)) {
        return res.status(403).json({
          message:
            "This complaint location is outside Poblacion, Cajidiocan."
        });
      }

      if (
        typeof capturedAt !== "string" ||
        !capturedAt.trim()
      ) {
        return res.status(400).json({
          message: "A valid photo capture time is required."
        });
      }

      const captureDate = new Date(capturedAt);

      if (Number.isNaN(captureDate.getTime())) {
        return res.status(400).json({
          message: "A valid photo capture time is required."
        });
      }

      const riskAssessment = assessComplaint({
        title: title.trim(),
        description: description.trim(),
        category,
        location: location.trim()
      });

      const complaint = await Complaint.create({
        title: title.trim(),
        description: description.trim(),
        category,
        location: location.trim(),
        coordinates: { latitude, longitude },
        submittedBy: req.user._id,

        riskLevel: riskAssessment.riskLevel,
        riskScore: riskAssessment.riskScore,
        riskReason: riskAssessment.riskReason,
        riskAssessedAt: riskAssessment.riskAssessedAt,

        evidence: {
          imageData: req.file.buffer.toString("base64"),
          mimeType: verifiedType,
          capturedAt: captureDate,
          verifiedLatitude: latitude,
          verifiedLongitude: longitude,
          verificationStatus: "Pending Review"
        },

        statusHistory: [{
          status: "Pending",
          note: "Complaint submitted with photo evidence.",
          changedBy: req.user._id
        }]
      });

      emitComplaintUpdate(req);

      return res.status(201).json({
        message: "Complaint submitted with photo evidence.",
        complaint: sanitizeComplaint(complaint)
      });
    } catch (err) {
      next(err);
    }
  }
);

// Review photo evidence: admins only.
router.patch(
  "/:id/evidence/verification",
  requireAdmin,
  async (req, res, next) => {
    try {
      const { verificationStatus } = req.body;

      if (!verificationStatuses.includes(verificationStatus)) {
        return res.status(400).json({
          message:
            "Verification status must be Verified or Rejected."
        });
      }

      const complaint = await Complaint.findById(req.params.id)
  .select("+evidence.imageData");

      if (!complaint) {
        return res.status(404).json({
          message: "Complaint not found."
        });
      }

      if (
        !complaint.evidence ||
        !complaint.evidence.imageData ||
        !complaint.evidence.mimeType
      ) {
        return res.status(400).json({
          message: "This complaint has no photo evidence to review."
        });
      }

      complaint.evidence.verificationStatus = verificationStatus;

      await complaint.save();

      emitComplaintUpdate(req);

      return res.json({
        message: `Photo evidence marked ${verificationStatus}.`,
        complaint: sanitizeComplaint(complaint)
      });
    } catch (err) {
      next(err);
    }
  }
);

// Update complaint status (admins only).
router.patch("/:id/status", requireAdmin, async (req, res, next) => {
  try {
    const { status, adminNote = "" } = req.body;

    if (!statuses.includes(status)) {
      return res.status(400).json({
        message: "Invalid complaint status."
      });
    }

    if (typeof adminNote !== "string") {
      return res.status(400).json({
        message: "Admin note must be text."
      });
    }

    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found."
      });
    }

    complaint.status = status;
    complaint.adminNote = adminNote.slice(0, 2000);

    complaint.statusHistory.push({
      status,
      note: complaint.adminNote,
      changedBy: req.user._id,
      changedAt: new Date()
    });

    await complaint.save();

    await complaint.populate("submittedBy", "name email");
    await complaint.populate("statusHistory.changedBy", "name");

    emitComplaintUpdate(req);

    return res.json({
      message: "Complaint updated.",
      complaint: sanitizeComplaint(complaint)
    });
  } catch (err) {
    next(err);
  }
});

// Delete a resolved complaint (admins only).

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        message: "Complaint not found."
      });
    }

    if (complaint.status !== "Resolved") {
      return res.status(400).json({
        message: "Only resolved complaints can be deleted."
      });
    }

    await Complaint.findByIdAndDelete(complaint._id);

    const io = req.app.get("io");
    if (io) {
      io.emit("complaints:updated");
    }

    return res.json({
      message: "Resolved complaint deleted successfully.",
      id: complaint._id
    });
  } catch (error) {
    console.error("Delete complaint error:", error);

    return res.status(500).json({
      message: "Failed to delete complaint."
    });
  }
});
module.exports = router;
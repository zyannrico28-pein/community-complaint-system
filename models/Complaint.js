
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const complaintSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      unique: true,
      default: () => `CCMS-${randomUUID().split("-")[0].toUpperCase()}`
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },

    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000
    },

    category: {
  type: String,
  required: true,
  enum: [
    "Road and Infrastructure",
    "Garbage",
    "Noise",
    "Water Supply",
    "Streetlights",
    "Public Safety",
    "Other"
  ]
    },

    location: {
      type: String,
      required: true,
      trim: true,
      maxlength: 250
    },

    // Complaint photo evidence
    evidence: {
      imageData: {
        type: String,
        default: null,
        select: false
      },

      mimeType: {
        type: String,
        enum: ["image/jpeg", "image/png", "image/webp", null],
        default: null
      },

      capturedAt: {
        type: Date,
        default: null
      },

      verifiedLatitude: {
        type: Number,
        min: -90,
        max: 90,
        default: null
      },

      verifiedLongitude: {
        type: Number,
        min: -180,
        max: 180,
        default: null
      },

      verificationStatus: {
        type: String,
        enum: ["Pending Review", "Verified", "Rejected"],
        default: "Pending Review"
      }
    },

    // GPS coordinates submitted with the complaint
    coordinates: {
      latitude: {
        type: Number,
        min: -90,
        max: 90,
        default: null
      },

      longitude: {
        type: Number,
        min: -180,
        max: 180,
        default: null
      }
    },

    // Automatic complaint risk assessment
    riskLevel: {
      type: String,
      enum: ["Critical", "High", "Medium", "Low"],
      default: "Low"
    },

    riskScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 10
    },

    riskReason: {
      type: String,
      default: "",
      maxlength: 1000
    },

    riskAssessedAt: {
      type: Date,
      default: null
    },

    // Complaint workflow
    status: {
      type: String,
      enum: [
        "Pending",
        "Under Review",
        "In Progress",
        "Resolved",
        "Rejected"
      ],
      default: "Pending"
    },

    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    adminNote: {
      type: String,
      default: "",
      maxlength: 2000
    },

    // Complaint activity and status history
    statusHistory: [
      {
        status: {
          type: String,
          enum: [
            "Pending",
            "Under Review",
            "In Progress",
            "Resolved",
            "Rejected"
          ],
          required: true
        },

        note: {
          type: String,
          default: "",
          maxlength: 2000
        },

        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null
        },

        changedAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Complaint", complaintSchema);


const multer = require("multer");

const storage = multer.memoryStorage();

const uploadEvidence = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return callback(
        new Error("Only JPEG, PNG, and WebP evidence photos are allowed.")
      );
    }

    callback(null, true);
  }
});

module.exports = uploadEvidence;

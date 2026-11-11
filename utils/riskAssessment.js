
function assessComplaint(complaint) {
  const text = [
    complaint.title || "",
    complaint.description || "",
    complaint.category || "",
    complaint.location || ""
  ].join(" ").toLowerCase();

  const rules = [
    {
      level: "Critical",
      score: 100,
      keywords: [
        "fire", "explosion", "someone is dying",
        "life threatening", "collapsed building",
        "electrocution", "gas leak", "trapped",
        "active violence"
      ]
    },
    {
      level: "High",
      score: 75,
      keywords: [
        "dangerous", "exposed wires", "broken power line",
        "flooding", "structural damage", "threat",
        "injured", "contaminated water", "sewage leak"
      ]
    },
    {
      level: "Medium",
      score: 45,
      keywords: [
        "broken streetlight", "garbage pile",
        "drainage", "pothole", "noise",
        "illegal dumping", "stray animals"
      ]
    }
  ];

  for (const rule of rules) {
    const matched = rule.keywords.filter(word =>
      text.includes(word)
    );

    if (matched.length > 0) {
      return {
        riskLevel: rule.level,
        riskScore: rule.score,
        riskReason:
          "Matched keywords: " + matched.join(", "),
        riskAssessedAt: new Date()
      };
    }
  }

  return {
    riskLevel: "Low",
    riskScore: 10,
    riskReason: "No high-risk keywords detected. Manual review may still be needed.",
    riskAssessedAt: new Date()
  };
}

module.exports = { assessComplaint };

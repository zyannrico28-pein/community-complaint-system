"use strict";

/* =========================================================
   CCMS - PUBLIC/APP.JS
   Features:
   - Login and registration
   - Resident and administrator dashboards
   - GPS location and complaint submission
   - Camera photo capture and upload
   - Complaint evidence display
   - Admin evidence verification
   - Risk assessment display
   - Complaint status updates and deletion
   - Search, filtering, and live updates
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

let token = localStorage.getItem("ccms_token") || "";
let currentUser = null;
let liveSocket = null;
let allComplaints = [];
let complaintsRequestId = 0;

let evidenceStream = null;
let evidenceBlob = null;
let evidenceCapturedAt = null;
let evidenceObjectUrls = [];

const STATUSES = [
  "Pending",
  "Under Review",
  "In Progress",
  "Resolved",
  "Rejected"
];

const RISK_LEVELS = ["Critical", "High", "Medium", "Low"];

const EVIDENCE_STATUSES = [
  "Pending Review",
  "Verified",
  "Rejected"
];

const EVIDENCE_REVIEW_OPTIONS = [
  "Verified",
  "Rejected"
];

/* =========================
   GENERAL HELPERS
   ========================= */

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();
}

function getStatusClass(status) {
  return String(status || "Pending")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isAdmin() {
  return String(currentUser?.role || "").toLowerCase() === "admin";
}

function showMessage(message, type = "success") {
  const element = $("#message");
  if (!element) return;

  element.textContent = message;
  element.className = `message ${type}`;
  element.hidden = false;
}

function clearMessage() {
  const element = $("#message");
  if (!element) return;

  element.textContent = "";
  element.className = "";
  element.hidden = true;
}

/* =========================
   API HELPER
   Supports JSON and FormData
   ========================= */

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData = options.body instanceof FormData;

  if (options.body && !isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }

  return data;
}

/* =========================
   CAMERA AND PHOTO CAPTURE
   ========================= */

function stopEvidenceCamera() {
  if (evidenceStream) {
    evidenceStream.getTracks().forEach((track) => track.stop());
    evidenceStream = null;
  }

  const video = $("#evidenceCamera");

  if (video) {
    video.srcObject = null;
    video.hidden = true;
  }

  const captureButton = $("#capturePhotoBtn");
  if (captureButton) captureButton.disabled = true;
}

function clearCapturedEvidence() {
  const preview = $("#evidencePreview");

  if (preview?.src?.startsWith("blob:")) {
    URL.revokeObjectURL(preview.src);
  }

  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }

  evidenceBlob = null;
  evidenceCapturedAt = null;

  const retakeButton = $("#retakePhotoBtn");
  if (retakeButton) retakeButton.hidden = true;
}

$("#startCameraBtn")?.addEventListener("click", async () => {
  const message = $("#cameraMessage");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access requires HTTPS or localhost and a supported browser."
      );
    }

    stopEvidenceCamera();

    evidenceStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const video = $("#evidenceCamera");

    if (!video) {
      throw new Error("Camera preview element was not found in index.html.");
    }

    video.srcObject = evidenceStream;
    video.hidden = false;

    await video.play();

    const captureButton = $("#capturePhotoBtn");
    if (captureButton) captureButton.disabled = false;

    if (message) {
      message.textContent =
        "Camera ready. Point it at the reported problem and take a photo.";
    }
  } catch (error) {
    stopEvidenceCamera();

    if (message) {
      message.textContent =
        error.message || "Unable to open the camera.";
    }
  }
});

$("#capturePhotoBtn")?.addEventListener("click", () => {
  const video = $("#evidenceCamera");
  const canvas = $("#evidenceCanvas");
  const message = $("#cameraMessage");

  if (!evidenceStream || !video?.videoWidth || !canvas) {
    if (message) {
      message.textContent = "Open the camera before taking a photo.";
    }
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    if (message) message.textContent = "Unable to prepare the photo.";
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) {
      if (message) {
        message.textContent = "Could not capture the photo. Try again.";
      }
      return;
    }

    clearCapturedEvidence();

    evidenceBlob = blob;
    evidenceCapturedAt = new Date().toISOString();

    const preview = $("#evidencePreview");

    if (preview) {
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
    }

    const retakeButton = $("#retakePhotoBtn");
    if (retakeButton) retakeButton.hidden = false;

    if (message) {
      message.textContent =
        "Photo captured. Review the image before submitting.";
    }

    stopEvidenceCamera();
  }, "image/jpeg", 0.8);
});

$("#retakePhotoBtn")?.addEventListener("click", () => {
  clearCapturedEvidence();

  const message = $("#cameraMessage");

  if (message) {
    message.textContent =
      "Take a new photo before submitting the complaint.";
  }
});

/* =========================
   RISK ASSESSMENT DISPLAY
   ========================= */

function renderRiskAssessment(complaint) {
  const risk = RISK_LEVELS.includes(complaint.riskLevel)
    ? complaint.riskLevel
    : null;

  if (!risk) {
    return `
      <div class="complaint-risk risk-not-assessed">
        <span class="risk-badge">Not assessed</span>
        <p class="risk-reason">
          Risk information is unavailable. Please review this complaint.
        </p>
      </div>
    `;
  }

  const score = Number(complaint.riskScore);
  const scoreHTML = Number.isFinite(score)
    ? `<span class="risk-score">Risk score: ${escapeHTML(score)}/100</span>`
    : "";

  return `
    <div class="complaint-risk">
      <span class="risk-badge risk-${risk.toLowerCase()}">
        ${escapeHTML(risk)} Risk
      </span>
      <p class="risk-reason">
        ${escapeHTML(
          complaint.riskReason || "No assessment explanation is available."
        )}
      </p>
      ${scoreHTML}
    </div>
  `;
}

/* =========================
   EVIDENCE DISPLAY
   ========================= */

function renderEvidence(complaint, id) {
  const evidence = complaint.evidence || {};
  const verificationStatus = EVIDENCE_STATUSES.includes(
    evidence.verificationStatus
  )
    ? evidence.verificationStatus
    : "Pending Review";

  const statusClass = getStatusClass(verificationStatus);

  const adminControls = isAdmin()
    ? `
      <div class="evidence-admin-controls">
        <label for="evidence-status-${id}">
          Evidence verification
        </label>

        <select id="evidence-status-${id}">
          ${EVIDENCE_REVIEW_OPTIONS.map((status) => `
            <option
              value="${status}"
              ${verificationStatus === status ? "selected" : ""}
            >${status}</option>
          `).join("")}
        </select>

        <button
          type="button"
          class="button button-primary"
          data-verify-evidence-id="${id}"
        >Save verification</button>
      </div>
    `
    : "";

  return `
    <div class="complaint-evidence">
      <h4>Photo evidence</h4>

      <div class="evidence-image-container" id="evidence-image-${id}">
        <p class="muted">Loading photo evidence...</p>
      </div>

      <p class="evidence-status">
        Verification:
        <strong class="status-${statusClass}">
          ${escapeHTML(verificationStatus)}
        </strong>
      </p>

      ${
        evidence.capturedAt
          ? `<p class="muted">Capture time: ${escapeHTML(formatDate(evidence.capturedAt))}</p>`
          : ""
      }

      ${adminControls}
    </div>
  `;
}

function revokeEvidenceObjectUrls() {
  evidenceObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  evidenceObjectUrls = [];
}

async function loadEvidenceImage(complaintId) {
  const container = document.getElementById(
    `evidence-image-${complaintId}`
  );

  if (!container || !token) return;

  try {
    const response = await fetch(
      `/api/complaints/${encodeURIComponent(complaintId)}/evidence`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "No photo evidence is available."
          : "Unable to load photo evidence."
      );
    }

    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error("The server did not return a valid image.");
    }

    const objectUrl = URL.createObjectURL(blob);
    evidenceObjectUrls.push(objectUrl);

    // The card may have been redrawn while the image was loading.
    const currentContainer = document.getElementById(
      `evidence-image-${complaintId}`
    );

    if (!currentContainer) {
      URL.revokeObjectURL(objectUrl);
      evidenceObjectUrls = evidenceObjectUrls.filter(
        (url) => url !== objectUrl
      );
      return;
    }

    currentContainer.innerHTML = `
      <img
        src="${objectUrl}"
        alt="Complaint photo evidence"
        class="evidence-image"
        loading="lazy"
      >
    `;
  } catch (error) {
    const currentContainer = document.getElementById(
      `evidence-image-${complaintId}`
    );

    if (currentContainer) {
      currentContainer.innerHTML = `
        <p class="muted">${escapeHTML(error.message)}</p>
      `;
    }
  }
}

/* =========================
   DASHBOARD AND SESSION
   ========================= */

function updateDashboardStats(complaints) {
  const total = complaints.length;

  const resolved = complaints.filter(
    (complaint) => complaint.status === "Resolved"
  ).length;

  const inProgress = complaints.filter(
    (complaint) => complaint.status === "In Progress"
  ).length;

  const open = complaints.filter(
    (complaint) => !["Resolved", "Rejected"].includes(complaint.status)
  ).length;

  if ($("#openCount")) $("#openCount").textContent = open;
  if ($("#progressCount")) $("#progressCount").textContent = inProgress;
  if ($("#resolvedCount")) $("#resolvedCount").textContent = resolved;
  if ($("#totalCount")) $("#totalCount").textContent = total;
}

function setSession(data) {
  if (!data?.token || !data?.user) {
    throw new Error("The server did not return a valid login session.");
  }

  token = data.token;
  currentUser = data.user;

  localStorage.setItem("ccms_token", token);

  renderShell();
  connectLiveUpdates();
  loadComplaints();
}


function renderShell() {
  const signedIn = Boolean(token && currentUser);
  const admin = isAdmin();

  if ($("#authPanel")) {
    $("#authPanel").hidden = signedIn;
  }

  if ($("#appPanel")) {
    $("#appPanel").hidden = !signedIn;
  }

  if (!signedIn) {
    document.querySelectorAll("[data-role]").forEach((element) => {
      element.hidden = true;
    });

    return;
  }

  if ($("#session")) {
    $("#session").textContent = admin
      ? "Administrator"
      : "Resident";
  }

  if ($("#sidebarUserName")) {
    $("#sidebarUserName").textContent =
      currentUser.name || "Account";
  }

  if ($("#welcomeTitle")) {
    $("#welcomeTitle").textContent = admin
      ? "Administrator Dashboard"
      : `Welcome, ${currentUser.name || "Resident"}`;
  }

  if ($("#listTitle")) {
    $("#listTitle").textContent = admin
      ? "All Community Complaints"
      : "My Complaints";
  }

  document.querySelectorAll("[data-role]").forEach((element) => {
    const roles = element.dataset.role
      .split(",")
      .map((role) => role.trim().toLowerCase());

    element.hidden = !roles.includes(
      admin ? "admin" : "resident"
    );
  });

  if ($("#newComplaintBtn")) {
    $("#newComplaintBtn").hidden = admin;
  }

  if ($("#submitPanel")) {
    $("#submitPanel").hidden = admin;
  }

  const eyebrow = document.querySelector(".topbar-heading .eyebrow");

  if (eyebrow) {
    eyebrow.textContent = admin
      ? "ADMINISTRATION / COMPLAINT MANAGEMENT"
      : "COMMUNITY SERVICES / MY DASHBOARD";
  }

  const description = document.querySelector(
    ".topbar-heading > .muted"
  );

  if (description) {
    description.textContent = admin
      ? "Review community complaints, verify evidence, and manage resolutions."
      : "Submit complaints, track progress, and view administrator updates.";
  }
}


/* =========================
   COMPLAINT CARD RENDERING
   ========================= */

function renderComplaints(complaints) {
  const list = $("#complaintList");
  if (!list) return;

  revokeEvidenceObjectUrls();

  if (!complaints.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">▤</div>
        <h3>No complaints found</h3>
        <p>Try changing your search or filter.</p>
      </div>
    `;
    return;
  }

  const admin = isAdmin();

  list.innerHTML = complaints.map((complaint) => {
    const id = escapeHTML(complaint._id);
    const title = escapeHTML(complaint.title || "Untitled complaint");
    const rawStatus = complaint.status || "Pending";
    const status = escapeHTML(rawStatus);
    const statusClass = getStatusClass(rawStatus);
    const category = escapeHTML(complaint.category || "Other");
    const location = escapeHTML(
      complaint.location || "Location not provided"
    );
    const description = escapeHTML(
      complaint.description || "No description provided."
    );

    const ticket = complaint.ticketNumber
      ? `
        <div class="complaint-ticket">
          <span class="ticket-label">Ticket ID</span>
          <strong>${escapeHTML(complaint.ticketNumber)}</strong>
        </div>
      `
      : "";

    const submitter = admin && complaint.submittedBy?.name
      ? `
        <div class="complaint-detail">
          <span class="detail-label">Submitted by</span>
          <span>${escapeHTML(complaint.submittedBy.name)}</span>
        </div>
      `
      : "";

    const history = Array.isArray(complaint.statusHistory) &&
      complaint.statusHistory.length
      ? `
        <details class="activity-history">
          <summary>
            <span>Activity history</span>
            <span class="history-count">
              ${complaint.statusHistory.length}
            </span>
          </summary>

          <ul class="history-list">
            ${complaint.statusHistory.map((entry) => `
              <li class="history-item">
                <span class="history-dot"></span>
                <div>
                  <strong>${escapeHTML(entry.status || "Status updated")}</strong>
                  <div class="meta">
                    ${escapeHTML(formatDate(entry.changedAt))}
                  </div>
                  ${entry.note
                    ? `<p>${escapeHTML(entry.note)}</p>`
                    : ""}
                </div>
              </li>
            `).join("")}
          </ul>
        </details>
      `
      : "";

    let adminTools = "";

    if (admin) {
      adminTools = `
        <div class="admin-tools">
          <h4>Manage complaint</h4>

          <div class="admin-form-row">
            <div class="admin-field">
              <label for="status-${id}">Complaint status</label>
              <select id="status-${id}">
                ${STATUSES.map((option) => `
                  <option
                    value="${option}"
                    ${rawStatus === option ? "selected" : ""}
                  >${option}</option>
                `).join("")}
              </select>
            </div>

            <div class="admin-field admin-note-field">
              <label for="note-${id}">Note for resident</label>
              <input
                id="note-${id}"
                maxlength="2000"
                value="${escapeHTML(complaint.adminNote || "")}"
                placeholder="Add an optional update"
              >
            </div>
          </div>

          <div class="admin-actions">
            <button
              type="button"
              class="button button-primary"
              data-update-id="${id}"
            >Save changes</button>

            ${rawStatus === "Resolved" ? `
              <button
                type="button"
                class="button button-danger"
                data-delete-id="${id}"
              >Delete resolved complaint</button>
            ` : ""}
          </div>
        </div>
      `;
    } else if (complaint.adminNote) {
      adminTools = `
        <div class="administrator-note">
          <strong>Administrator update</strong>
          <p>${escapeHTML(complaint.adminNote)}</p>
        </div>
      `;
    }

    return `
      <article class="complaint-card">
        <div class="complaint-card-header">
          <div class="complaint-title-group">
            <span class="complaint-category">${category}</span>
            <h3>${title}</h3>
          </div>

          <span class="status-badge status-${statusClass}">
            <span class="status-dot"></span>
            ${status}
          </span>
        </div>

        ${ticket}
        ${renderRiskAssessment(complaint)}

        <div class="complaint-details">
          <div class="complaint-detail">
            <span class="detail-icon">⌖</span>
            <span>${location}</span>
          </div>

          <div class="complaint-detail">
            <span class="detail-icon">◷</span>
            <span>${escapeHTML(formatDate(complaint.createdAt))}</span>
          </div>

          ${submitter}
        </div>

        <div class="complaint-description">
          <p>${description}</p>
        </div>

        ${renderEvidence(complaint, id)}
        ${history}
        ${adminTools}
      </article>
    `;
  }).join("");

  // Load each complaint's protected image after its card is rendered.
  complaints.forEach((complaint) => {
    if (complaint._id) loadEvidenceImage(complaint._id);
  });
}


/* =========================
   DASHBOARD STAT CARDS
   ========================= */

let dashboardCardFilter = "";

document.querySelectorAll(".stat-card").forEach((card) => {
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");

  card.addEventListener("click", () => {
    const label = card.querySelector(".stat-label")
      ?.textContent.trim();

    const filters = {
      "Open Complaints": "open",
      "In Progress": "progress",
      "Resolved": "resolved",
      "Total Complaints": "all"
    };

    dashboardCardFilter = filters[label] || "";

    // Reset ang search at status dropdown.
    if ($("#complaintSearch")) {
      $("#complaintSearch").value = "";
    }

    if ($("#statusFilter")) {
      $("#statusFilter").value = "";
    }

    // Pumunta sa complaints section.
    const section = $("#complaints");

    if (section) {
      section.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }

    // I-update ang navigation highlight.
    document.querySelectorAll(".nav-link").forEach((link) => {
      link.classList.toggle(
        "active",
        ["complaints", "trackingSection"].includes(
          link.dataset.target
        )
      );
    });

    filterComplaints();
  });

  // Suportahan din ang Enter at Space sa keyboard.
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });
});

/* =========================
   SEARCH AND FILTER
   ========================= */


function filterComplaints() {
  const search = ($("#complaintSearch")?.value || "")
    .trim()
    .toLowerCase();

  const status = $("#statusFilter")?.value || "";

  const filtered = allComplaints.filter((complaint) => {
    const matchesSearch = [
      complaint.title,
      complaint.location,
      complaint.category,
      complaint.description,
      complaint.ticketNumber,
      complaint.submittedBy?.name
    ].some((value) =>
      String(value || "").toLowerCase().includes(search)
    );

    const matchesStatus =
      !status || complaint.status === status;

    let matchesDashboardCard = true;

    if (dashboardCardFilter === "open") {
      matchesDashboardCard = ![
        "Resolved",
        "Rejected"
      ].includes(complaint.status);
    } else if (dashboardCardFilter === "progress") {
      matchesDashboardCard =
        complaint.status === "In Progress";
    } else if (dashboardCardFilter === "resolved") {
      matchesDashboardCard =
        complaint.status === "Resolved";
    }

    return (
      matchesSearch &&
      matchesStatus &&
      matchesDashboardCard
    );
  });

  renderComplaints(filtered);
}

/* =========================
   LOAD COMPLAINTS
   ========================= */

async function loadComplaints() {
  if (!token || !currentUser) return;

  const requestId = ++complaintsRequestId;
  const list = $("#complaintList");

  if (list) {
    list.innerHTML = `
      <div class="loading-state">
        <span class="loading-spinner"></span>
        <p>Loading complaints...</p>
      </div>
    `;
  }

  try {
    const data = await api("/api/complaints");

    if (requestId !== complaintsRequestId) return;

    allComplaints = Array.isArray(data.complaints)
      ? data.complaints
      : [];

    updateDashboardStats(allComplaints);
    filterComplaints();
  } catch (error) {
    if (requestId !== complaintsRequestId) return;

    if (list) {
      list.innerHTML = `
        <div class="empty-state">
          <h3>Unable to load complaints</h3>
          <p>${escapeHTML(error.message)}</p>
          <button
            type="button"
            class="button button-secondary"
            id="retryComplaintsBtn"
          >Try again</button>
        </div>
      `;
    }

    allComplaints = [];
    updateDashboardStats([]);

    if (/session|invalid token|unauthorized/i.test(error.message)) {
      logout(false);
      showMessage("Your session has expired. Please sign in again.", "error");
    }
  }
}

/* =========================
   ADMIN: UPDATE STATUS
   ========================= */


async function updateComplaint(id) {
  clearMessage();

  if (!isAdmin()) {
    showMessage("Only administrators can update complaint status.", "error");
    return;
  }

  const statusElement = document.getElementById(`status-${id}`);
  const noteElement = document.getElementById(`note-${id}`);

  if (!statusElement || !noteElement) {
    showMessage("Could not find the complaint controls.", "error");
    return;
  }

  const newStatus = statusElement.value;
  const adminNote = noteElement.value.trim();

  if (!STATUSES.includes(newStatus)) {
    showMessage("Please select a valid complaint status.", "error");
    return;
  }

  try {
    await api(`/api/complaints/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status: newStatus,
        adminNote
      })
    });

    showMessage(`Complaint status updated to ${newStatus}.`);
    await loadComplaints();
  } catch (error) {
    showMessage(error.message || "Failed to update complaint status.", "error");
  }
}


/* =========================
   ADMIN: VERIFY EVIDENCE
   ========================= */

async function updateEvidenceVerification(id) {
  if (!isAdmin()) {
    showMessage("Only administrators can verify evidence.", "error");
    return;
  }

  const select = document.getElementById(`evidence-status-${id}`);

  if (!select) {
    showMessage("Could not find the evidence verification control.", "error");
    return;
  }

  if (!EVIDENCE_STATUSES.includes(select.value)) {
    showMessage("Please select a valid verification status.", "error");
    return;
  }

  try {
    await api(
      `/api/complaints/${encodeURIComponent(id)}/evidence/verification`,
      {
        method: "PATCH",
        body: JSON.stringify({
          verificationStatus: select.value
        })
      }
    );

    showMessage("Evidence verification updated successfully.");
    await loadComplaints();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

/* =========================
   ADMIN: DELETE COMPLAINT
   ========================= */

async function deleteComplaint(id) {
  if (!window.confirm(
    "Permanently delete this resolved complaint? This cannot be undone."
  )) {
    return;
  }

  try {
    await api(`/api/complaints/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    showMessage("Resolved complaint deleted successfully.");
    await loadComplaints();
  } catch (error) {
    showMessage(error.message, "error");
  }
}

/* =========================
   COMPLAINT CARD BUTTONS
   ========================= */

$("#complaintList")?.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const retryButton = target.closest("#retryComplaintsBtn");

  if (retryButton) {
    loadComplaints();
    return;
  }

  const verifyButton = target.closest("[data-verify-evidence-id]");

  if (verifyButton) {
    updateEvidenceVerification(verifyButton.dataset.verifyEvidenceId);
    return;
  }

  const updateButton = target.closest("[data-update-id]");

  if (updateButton) {
    updateComplaint(updateButton.dataset.updateId);
    return;
  }

  const deleteButton = target.closest("[data-delete-id]");

  if (deleteButton) {
    deleteComplaint(deleteButton.dataset.deleteId);
  }
});

/* =========================
   LIVE UPDATES
   ========================= */

function connectLiveUpdates() {
  if (!token || !currentUser || typeof io !== "function") return;

  if (liveSocket) {
    liveSocket.disconnect();
    liveSocket = null;
  }

  liveSocket = io();

  liveSocket.on("complaints:updated", () => {
    loadComplaints();
  });

  liveSocket.on("connect_error", () => {
    console.warn(
      "Live updates unavailable. Use Refresh to reload complaints."
    );
  });
}

/* =========================
   REGISTER
   ========================= */

$("#registerForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const formElement = event.currentTarget;
  const form = Object.fromEntries(new FormData(formElement));

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(form)
    });

    setSession(data);
    formElement.reset();
    showMessage("Account created successfully.");
  } catch (error) {
    showMessage(error.message, "error");
  }
});


/* =========================
   GOOGLE AND FACEBOOK LOGIN
   ========================= */

async function socialLoginRequest(provider, credentials) {
  clearMessage();

  try {
    const data = await api(`/api/auth/${provider}`, {
      method: "POST",
      body: JSON.stringify(credentials)
    });

    setSession(data);
    showMessage(
      `${provider === "google" ? "Google" : "Facebook"} login successful!`
    );
  } catch (error) {
    showMessage(error.message || "Social login failed.", "error");
  }
}

// GOOGLE LOGIN
function initializeGoogleLogin() {
  const googleButton = $("#googleLoginBtn");

  if (!googleButton) return;

  googleButton.addEventListener("click", () => {
    if (!window.google?.accounts?.id) {
      showMessage("Google sign-in is still loading. Please try again.", "error");
      return;
    }

    window.google.accounts.id.initialize({
      client_id: "1039365318812-le2n0k8293jnmsbvjc6ihuj70qlar76k.apps.googleusercontent.com",
      callback: (response) => {
        if (!response.credential) {
          showMessage("Google did not return a login credential.", "error");
          return;
        }

        socialLoginRequest("google", {
          credential: response.credential
        });
      }
    });

    window.google.accounts.id.prompt();
  });
}

// FACEBOOK LOGIN
window.fbAsyncInit = function () {
  window.FB.init({
    appId: "1627130165811191",
    cookie: true,
    xfbml: false,
    version: "v23.0"
  });
};
function initializeFacebookLogin() {
  const facebookButton = $("#facebookLoginBtn");

  if (!facebookButton) return;

  facebookButton.addEventListener("click", () => {
    if (!window.FB) {
      showMessage("Facebook sign-in is still loading. Please try again.", "error");
      return;
    }

    window.FB.login((result) => {
      const accessToken = result.authResponse?.accessToken;

      if (!accessToken) {
        showMessage("Facebook login was cancelled or unsuccessful.", "error");
        return;
      }

      socialLoginRequest("facebook", { accessToken });
    }, { scope: "email" });
  });
}

initializeGoogleLogin();
initializeFacebookLogin();


/* =========================
   LOGIN
   ========================= */

$("#loginForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const formElement = event.currentTarget;

  const email =
    formElement.querySelector('[name="email"]')?.value.trim() || "";

  const password =
    formElement.querySelector('[name="password"]')?.value || "";

  if (!email || !password) {
    showMessage("Please enter your email and password.", "error");
    return;
  }

  const submitButton =
    formElement.querySelector('button[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";
  }

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        username: email,
        password
      })
    });

    setSession(data);
    formElement.reset();
    showMessage("Login successful!");
  } catch (error) {
    showMessage(error.message || "Login failed. Please try again.", "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Login";
    }
  }
});

/* =========================
   SUBMIT COMPLAINT
   GPS + PHOTO + FORM DATA
   ========================= */

$("#complaintForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const formElement = event.currentTarget;

  if (!token || !currentUser) {
    showMessage("Please sign in before submitting a complaint.", "error");
    return;
  }

  if (isAdmin()) {
    showMessage("Administrator accounts cannot submit complaints here.", "error");
    return;
  }

  if (!evidenceBlob || !evidenceCapturedAt) {
    showMessage(
      "Please take a photo using the camera before submitting.",
      "error"
    );
    return;
  }

  if (!navigator.geolocation) {
    showMessage("Your browser does not support GPS location.", "error");
    return;
  }

  const submitButton =
    formElement.querySelector('button[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Getting location...";
  }

  showMessage("Getting your GPS location...", "info");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        const formData = new FormData(formElement);

        // Remove any existing values for these API fields.
        formData.delete("coordinates");
        formData.delete("capturedAt");
        formData.delete("evidencePhoto");

        formData.append(
          "coordinates",
          JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          })
        );

        formData.append("capturedAt", evidenceCapturedAt);
        formData.append("evidencePhoto", evidenceBlob, "evidence.jpg");

        showMessage("Submitting complaint and photo evidence...", "info");

        await api("/api/complaints", {
          method: "POST",
          body: formData
        });

        formElement.reset();
        clearCapturedEvidence();
        stopEvidenceCamera();

        if ($("#cameraMessage")) {
          $("#cameraMessage").textContent =
            "Your photo was submitted successfully.";
        }

        showMessage("Complaint and photo evidence submitted successfully.");

        await loadComplaints();
      } catch (error) {
        showMessage(error.message, "error");
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Submit Complaint";
        }
      }
    },
    (error) => {
      let message = "Unable to get your location.";

      if (error.code === error.PERMISSION_DENIED) {
        message =
          "Please allow location access in your browser to submit a complaint.";
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        message = "Your GPS location is unavailable. Please try again.";
      } else if (error.code === error.TIMEOUT) {
        message = "Getting your location took too long. Please try again.";
      }

      showMessage(message, "error");

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Submit Complaint";
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
});

/* =========================
   LOGOUT
   ========================= */

function logout(showNotice = true) {
  if (liveSocket) {
    liveSocket.disconnect();
    liveSocket = null;
  }

  stopEvidenceCamera();
  clearCapturedEvidence();
  revokeEvidenceObjectUrls();

  complaintsRequestId++;
  token = "";
  currentUser = null;
  allComplaints = [];

  localStorage.removeItem("ccms_token");

  renderShell();

  if ($("#complaintList")) {
    $("#complaintList").innerHTML = "";
  }

  updateDashboardStats([]);

  if (showNotice) {
    showMessage("You have signed out.");
  }
}

$("#logoutBtn")?.addEventListener("click", () => logout());

/* =========================
   REFRESH / SEARCH / FILTER
   ========================= */

$("#refreshBtn")?.addEventListener("click", () => loadComplaints());

$("#complaintSearch")?.addEventListener("input", filterComplaints);

$("#statusFilter")?.addEventListener("change", filterComplaints);

/* =========================
   NEW COMPLAINT BUTTON
   ========================= */

$("#newComplaintBtn")?.addEventListener("click", () => {
  if (!token || !currentUser) {
    showMessage("Please sign in first.", "info");
    return;
  }

  const panel = $("#submitPanel");

  if (!panel || panel.hidden) {
    showMessage(
      "The complaint form is not available for this account.",
      "info"
    );
    return;
  }

  panel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  history.replaceState(null, "", "#submitPanel");
  $("#complaintTitle")?.focus({ preventScroll: true });
});

/* =========================
   NAVIGATION LINKS
   ========================= */

document.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof Element)) return;

  const link = target.closest(".nav-link");
  if (!link) return;

  event.preventDefault();

  const navTarget = link.dataset.target;

  let sectionId = "complaints";

  if (
    navTarget === "dashboard" ||
    navTarget === "dashboardSection"
  ) {
    sectionId = "dashboard";
  }

  if (navTarget === "submitPanel") {
    if (isAdmin()) return;

    $("#newComplaintBtn")?.click();
    return;
  }

  const section = document.getElementById(sectionId);
  if (!section) return;

  document.querySelectorAll(".nav-link").forEach((item) => {
    item.classList.remove("active");
  });

  link.classList.add("active");

  section.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  history.replaceState(null, "", `#${sectionId}`);

  if (
    navTarget === "trackingSection" ||
    navTarget === "complaints"
  ) {
    if ($("#complaintSearch")) $("#complaintSearch").value = "";
    if ($("#statusFilter")) $("#statusFilter").value = "";

    filterComplaints();
  }

  if (navTarget === "activitySection") {
    const histories = document.querySelectorAll(".activity-history");

    histories.forEach((item) => {
      item.open = true;
    });

    showMessage(
      histories.length
        ? "Activity history opened."
        : "No activity history is available yet.",
      "info"
    );
  }
});

/* =========================
   INITIALIZE APPLICATION
   ========================= */

async function init() {
  renderShell();
  updateDashboardStats([]);

  if (!token) return;

  try {
    const data = await api("/api/auth/me");

    if (!data.user) {
      throw new Error("Invalid session.");
    }

    currentUser = data.user;

    renderShell();
    connectLiveUpdates();

    await loadComplaints();
  } catch (error) {
    token = "";
    currentUser = null;
    allComplaints = [];

    localStorage.removeItem("ccms_token");

    renderShell();
    updateDashboardStats([]);

    showMessage("Please sign in to continue.", "error");
  }
}

init();
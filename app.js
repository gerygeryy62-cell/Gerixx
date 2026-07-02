// ============================================================
// REEL DECK — frontend logic
// Talks to the real /api/convert + /api/status + /api/download
// pipeline, and to the intentionally-stubbed /api/fetch-url.
// ============================================================

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const fileNameEl = document.getElementById("fileName");
const formatSwitches = document.getElementById("formatSwitches");
const convertBtn = document.getElementById("convertBtn");
const vuBlock = document.getElementById("vuBlock");
const vuFill = document.getElementById("vuFill");
const vuStatus = document.getElementById("vuStatus");
const vuPercent = document.getElementById("vuPercent");
const outputList = document.getElementById("outputList");
const urlInput = document.getElementById("urlInput");
const urlSubmit = document.getElementById("urlSubmit");

let selectedFile = null;
let selectedFormat = "mp4";

// ---------- format switches ----------

formatSwitches.addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle-switch");
  if (!btn) return;
  formatSwitches.querySelectorAll(".toggle-switch").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  selectedFormat = btn.dataset.format;
});

// ---------- drop zone / file picking ----------

browseBtn.addEventListener("click", () => fileInput.click());

dropZone.addEventListener("click", (e) => {
  if (e.target === browseBtn) return;
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setSelectedFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
  })
);

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

function setSelectedFile(file) {
  selectedFile = file;
  fileNameEl.textContent = `Loaded: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  convertBtn.disabled = false;
}

// ---------- conversion flow ----------

convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  convertBtn.disabled = true;
  vuBlock.hidden = false;
  vuFill.style.width = "0%";
  vuPercent.textContent = "0%";
  vuStatus.textContent = "UPLOADING";
  vuStatus.className = "running";

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("format", selectedFormat);

  try {
    const res = await fetch("/api/convert", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Upload failed.");
    }

    vuStatus.textContent = "CONVERTING";
    pollStatus(data.jobId, selectedFile.name);
  } catch (err) {
    vuStatus.textContent = "ERROR";
    vuStatus.className = "error";
    vuPercent.textContent = err.message;
    convertBtn.disabled = false;
  }
});

function pollStatus(jobId, sourceName) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();

      if (data.status === "processing") {
        vuFill.style.width = `${data.progress}%`;
        vuPercent.textContent = `${data.progress}%`;
      } else if (data.status === "done") {
        clearInterval(interval);
        vuFill.style.width = "100%";
        vuPercent.textContent = "100%";
        vuStatus.textContent = "COMPLETE";
        vuStatus.className = "done";
        addReelToTray(sourceName, data.downloadUrl);
        convertBtn.disabled = false;
      } else if (data.status === "error") {
        clearInterval(interval);
        vuStatus.textContent = "ERROR";
        vuStatus.className = "error";
        vuPercent.textContent = data.error || "Conversion failed.";
        convertBtn.disabled = false;
      }
    } catch {
      clearInterval(interval);
      vuStatus.textContent = "ERROR";
      vuStatus.className = "error";
      vuPercent.textContent = "Lost connection to server.";
      convertBtn.disabled = false;
    }
  }, 700);
}

function addReelToTray(sourceName, downloadUrl) {
  const emptyRow = outputList.querySelector(".empty-row");
  if (emptyRow) emptyRow.remove();

  const li = document.createElement("li");
  li.className = "reel-row";
  li.innerHTML = `
    <span class="reel-name">${escapeHtml(sourceName)} → ${selectedFormat.toUpperCase()}</span>
    <a href="${downloadUrl}" download>DOWNLOAD</a>
  `;
  outputList.prepend(li);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- URL intake (stub, by design — see server.js) ----------

urlSubmit.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  const noteEl = document.getElementById("urlNote");
  noteEl.textContent = "Checking...";

  try {
    const res = await fetch("/api/fetch-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    noteEl.textContent = data.error;
  } catch {
    noteEl.textContent = "Couldn't reach the server.";
  }
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") urlSubmit.click();
});


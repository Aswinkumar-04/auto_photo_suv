// Host Dashboard Client
document.addEventListener("DOMContentLoaded", () => {
    // Elements
    const qrImg = document.getElementById("qr-img");
    const guestUrlInput = document.getElementById("guest-url-input");
    const copyUrlBtn = document.getElementById("copy-url-btn");
    const driveUrlInput = document.getElementById("drive-url");
    const syncBtn = document.getElementById("sync-btn");
    const resyncBtn = document.getElementById("resync-btn");
    const syncStatusBadge = document.getElementById("sync-status-badge");
    const syncMessage = document.getElementById("sync-message");
    const syncProgressBarWrap = document.getElementById("sync-progress-bar-wrap");
    const syncProgressBar = document.getElementById("sync-progress-bar");
    const lastSyncedTime = document.getElementById("last-synced-time");
    const alertBox = document.getElementById("dashboard-alert");
    const logoutBtn = document.getElementById("logout-btn");
    const refreshGalleryBtn = document.getElementById("refresh-gallery-btn");
    const photosGallery = document.getElementById("photos-gallery");
    const galleryEmpty = document.getElementById("gallery-empty");

    // Stats
    const statTotalPhotos = document.getElementById("stat-total-photos");
    const statTotalFaces = document.getElementById("stat-total-faces");
    const statMultiFaces = document.getElementById("stat-multi-faces");
    const statZeroFaces = document.getElementById("stat-zero-faces");

    // Settings
    const settingEventName = document.getElementById("setting-event-name");
    const settingGuestUrl = document.getElementById("setting-guest-url");
    const settingThreshold = document.getElementById("setting-threshold");
    const thresholdValBadge = document.getElementById("threshold-val-badge");
    const settingsForm = document.getElementById("settings-form");
    const navEventName = document.getElementById("nav-event-name");

    // Dropzone
    const dropzone = document.getElementById("dropzone");
    const directUploadInput = document.getElementById("direct-upload-input");
    const uploadStatus = document.getElementById("upload-status");

    // Lightbox
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const lightboxDownload = document.getElementById("lightbox-download");
    const lightboxClose = document.getElementById("lightbox-close");

    let syncPollTimer = null;
    let lastPhotosCount = null;
    let liveStatsInterval = null;

    // Initialize Dashboard
    initDashboard();

    async function initDashboard() {
        await loadStats();
        lastPhotosCount = parseInt(statTotalPhotos.textContent) || 0;
        await loadQR();
        await loadPhotos();
        startLiveAutoSyncObserver();
    }

    function startLiveAutoSyncObserver() {
        if (liveStatsInterval) clearInterval(liveStatsInterval);
        liveStatsInterval = setInterval(async () => {
            try {
                const res = await fetch("/api/dashboard/stats");
                if (res.status === 200) {
                    const data = await res.json();
                    statTotalPhotos.textContent = data.total_photos;
                    statTotalFaces.textContent = data.total_faces;
                    statMultiFaces.textContent = data.multi_face_photos;
                    statZeroFaces.textContent = data.zero_face_photos;

                    if (data.sync_status === "syncing") {
                        updateSyncUI(data.sync_status, data.sync_message, data.last_synced_at);
                    }

                    if (lastPhotosCount !== null && data.total_photos > lastPhotosCount) {
                        const diff = data.total_photos - lastPhotosCount;
                        showAlert(`⚡ Auto-Sync: ${diff} new photo(s) added & indexed from Drive!`, "success");
                        await loadPhotos();
                    }
                    lastPhotosCount = data.total_photos;
                }
            } catch (e) {
                // silent background tick
            }
        }, 6000);
    }

    async function loadStats() {
        try {
            const res = await fetch("/api/dashboard/stats");
            if (res.status === 401) {
                window.location.href = "/login";
                return;
            }
            const data = await res.json();

            statTotalPhotos.textContent = data.total_photos;
            statTotalFaces.textContent = data.total_faces;
            statMultiFaces.textContent = data.multi_face_photos;
            statZeroFaces.textContent = data.zero_face_photos;

            if (data.event_name) {
                settingEventName.value = data.event_name;
                navEventName.textContent = data.event_name;
            }

            if (data.drive_folder_url) {
                driveUrlInput.value = data.drive_folder_url;
            }

            if (data.guest_base_url) {
                settingGuestUrl.value = data.guest_base_url;
            }

            if (data.match_threshold) {
                settingThreshold.value = data.match_threshold;
                thresholdValBadge.textContent = data.match_threshold;
            }

            updateSyncUI(data.sync_status, data.sync_message, data.last_synced_at);

            if (data.sync_status === "syncing") {
                startSyncPolling();
            }
        } catch (err) {
            console.error("Failed to load dashboard stats:", err);
        }
    }

    async function loadQR() {
        try {
            const res = await fetch("/api/dashboard/qr");
            const data = await res.json();
            qrImg.src = data.qr_base64;
            qrImg.style.opacity = "1";
            guestUrlInput.value = data.guest_url;
        } catch (err) {
            console.error("Failed to load QR code:", err);
        }
    }

    copyUrlBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(guestUrlInput.value).then(() => {
            const orig = copyUrlBtn.textContent;
            copyUrlBtn.textContent = "✓ Copied!";
            setTimeout(() => (copyUrlBtn.textContent = orig), 2000);
        });
    });

    // Face match threshold slider sync
    settingThreshold.addEventListener("input", (e) => {
        thresholdValBadge.textContent = e.target.value;
    });

    // Save Settings
    settingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            event_name: settingEventName.value,
            match_threshold: parseFloat(settingThreshold.value),
            guest_base_url: settingGuestUrl.value,
        };

        try {
            const res = await fetch("/api/dashboard/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (res.ok) {
                showAlert("Settings saved successfully!", "success");
                navEventName.textContent = settingEventName.value;
                await loadQR();
            } else {
                showAlert(data.detail || "Failed to save settings.", "danger");
            }
        } catch (err) {
            showAlert("Network error while saving settings.", "danger");
        }
    });

    // Trigger Google Drive Sync
    syncBtn.addEventListener("click", () => triggerDriveSync());
    resyncBtn.addEventListener("click", () => triggerDriveSync());

    async function triggerDriveSync() {
        const driveUrl = driveUrlInput.value.trim();
        if (!driveUrl) {
            showAlert("Please paste a valid Google Drive folder link.", "warning");
            return;
        }

        syncBtn.disabled = true;
        resyncBtn.disabled = true;
        updateSyncUI("syncing", "Connecting to Google Drive...");

        try {
            const res = await fetch("/api/dashboard/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ drive_url: driveUrl }),
            });

            const data = await res.json();
            if (res.ok) {
                showAlert("Sync started in background.", "info");
                startSyncPolling();
            } else {
                updateSyncUI("error", data.detail || "Failed to start sync.");
                showAlert(data.detail || "Sync failed.", "danger");
                syncBtn.disabled = false;
                resyncBtn.disabled = false;
            }
        } catch (err) {
            updateSyncUI("error", "Network error starting sync.");
            syncBtn.disabled = false;
            resyncBtn.disabled = false;
        }
    }

    function startSyncPolling() {
        if (syncPollTimer) clearInterval(syncPollTimer);
        syncProgressBarWrap.style.display = "block";

        syncPollTimer = setInterval(async () => {
            try {
                const res = await fetch("/api/dashboard/sync-status");
                const status = await res.json();

                let progressPct = 10;
                if (status.total_files > 0) {
                    progressPct = Math.min(100, Math.round((status.processed_files / status.total_files) * 100));
                }
                syncProgressBar.style.width = `${progressPct}%`;

                updateSyncUI(status.status, status.message);

                if (status.status !== "syncing") {
                    clearInterval(syncPollTimer);
                    syncPollTimer = null;
                    syncBtn.disabled = false;
                    resyncBtn.disabled = false;
                    setTimeout(() => {
                        syncProgressBarWrap.style.display = "none";
                    }, 1500);
                    await loadStats();
                    await loadPhotos();
                }
            } catch (err) {
                console.warn("Poll error:", err);
            }
        }, 1500);
    }

    function updateSyncUI(status, message, timestamp) {
        syncStatusBadge.textContent = (status || "IDLE").toUpperCase();
        syncMessage.textContent = message || "Ready to sync.";

        if (status === "syncing") {
            syncStatusBadge.style.background = "rgba(200, 164, 90, 0.2)";
            syncStatusBadge.style.color = "#785a20";
        } else if (status === "completed") {
            syncStatusBadge.style.background = "#f0f7f3";
            syncStatusBadge.style.color = "#1b5e39";
        } else if (status === "error") {
            syncStatusBadge.style.background = "#fbf0f0";
            syncStatusBadge.style.color = "#8c1e28";
        } else {
            syncStatusBadge.style.background = "#ebe7e0";
            syncStatusBadge.style.color = "#4a1521";
        }

        if (timestamp) {
            const date = new Date(timestamp);
            lastSyncedTime.textContent = `Last synced: ${date.toLocaleString()}`;
        }
    }

    // Direct Upload Handlers
    directUploadInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleDirectUpload(e.target.files);
        }
    });

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleDirectUpload(e.dataTransfer.files);
        }
    });

    async function handleDirectUpload(files) {
        uploadStatus.style.display = "block";
        uploadStatus.innerHTML = `<span class="spinner spinner-dark" style="width:16px;height:16px;"></span> Uploading & processing ${files.length} photo(s)...`;

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append("files", files[i]);
        }

        try {
            const res = await fetch("/api/dashboard/upload", {
                method: "POST",
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                uploadStatus.innerHTML = `✓ Successfully uploaded and indexed ${data.processed} photo(s)!`;
                await loadStats();
                await loadPhotos();
            } else {
                uploadStatus.textContent = "Upload failed. Please try again.";
            }
        } catch (e) {
            uploadStatus.textContent = "Error uploading files.";
        }
    }

    // Gallery & Photos List
    refreshGalleryBtn.addEventListener("click", () => loadPhotos());

    async function loadPhotos() {
        try {
            const res = await fetch("/api/dashboard/photos?page=1&per_page=60");
            const data = await res.json();

            photosGallery.innerHTML = "";
            if (!data.photos || data.photos.length === 0) {
                galleryEmpty.style.display = "block";
                return;
            }

            galleryEmpty.style.display = "none";
            data.photos.forEach((photo) => {
                const card = document.createElement("div");
                card.className = "photo-card";

                const faceTag =
                    photo.faces_count === 1
                        ? "👤 1 face"
                        : photo.faces_count > 1
                            ? `👥 ${photo.faces_count} faces`
                            : "⚪ 0 faces";

                card.innerHTML = `
                    <img src="${photo.thumbnail_url}" alt="${photo.original_name}" loading="lazy">
                    <span class="photo-badge">${faceTag}</span>
                    <div class="photo-actions">
                        <button class="btn-photo-action delete-photo-btn" title="Delete Photo" data-id="${photo.id}">
                            🗑️
                        </button>
                    </div>
                `;

                card.addEventListener("click", () => {
                    openLightbox(photo.photo_url, photo.download_url);
                });

                const deleteBtn = card.querySelector(".delete-photo-btn");
                deleteBtn.addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    if (confirm("Delete this photo and its face embeddings?")) {
                        await deletePhoto(photo.id);
                    }
                });

                photosGallery.appendChild(card);
            });
        } catch (err) {
            console.error("Failed to load gallery photos:", err);
        }
    }

    async function deletePhoto(photoId) {
        try {
            const res = await fetch(`/api/dashboard/photos/${photoId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                await loadStats();
                await loadPhotos();
            }
        } catch (err) {
            showAlert("Could not delete photo.", "danger");
        }
    }

    // Lightbox handlers
    function openLightbox(photoUrl, downloadUrl) {
        lightboxImg.src = photoUrl;
        lightboxDownload.href = downloadUrl;
        lightbox.classList.add("active");
    }

    lightboxClose.addEventListener("click", () => {
        lightbox.classList.remove("active");
    });

    lightbox.addEventListener("click", (e) => {
        if (e.target === lightbox) {
            lightbox.classList.remove("active");
        }
    });

    // Reset / Clear all photos button
    const resetPhotosBtn = document.getElementById("reset-photos-btn");
    if (resetPhotosBtn) {
        resetPhotosBtn.addEventListener("click", async () => {
            if (!confirm("Are you sure you want to clear all synced photos and face records? This cannot be undone.")) {
                return;
            }
            try {
                resetPhotosBtn.disabled = true;
                const res = await fetch("/api/dashboard/photos/reset", { method: "POST" });
                const data = await res.json();
                if (res.ok) {
                    showAlert(data.message || "All photos cleared.", "success");
                    await loadStats();
                    await loadPhotos();
                } else {
                    showAlert(data.detail || "Could not clear photos.", "danger");
                }
            } catch (err) {
                showAlert("Network error trying to clear photos.", "danger");
            } finally {
                resetPhotosBtn.disabled = false;
            }
        });
    }

    // Logout
    logoutBtn.addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
    });

    function showAlert(msg, type = "info") {
        alertBox.textContent = msg;
        alertBox.className = `alert alert-${type}`;
        alertBox.style.display = "flex";
        setTimeout(() => {
            alertBox.style.display = "none";
        }, 5000);
    }
});


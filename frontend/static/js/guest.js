// Guest Photo Discovery Client
document.addEventListener("DOMContentLoaded", () => {
    const video = document.getElementById("guest-video");
    const canvas = document.getElementById("guest-canvas");
    const previewImg = document.getElementById("guest-preview-img");
    const faceGuide = document.getElementById("face-guide");
    const scanRadar = document.getElementById("scan-radar");
    const liveControls = document.getElementById("live-controls");
    const previewControls = document.getElementById("preview-controls");
    const snapBtn = document.getElementById("snap-btn");
    const retakeBtn = document.getElementById("retake-btn");
    const searchBtn = document.getElementById("search-btn");
    const switchCameraBtn = document.getElementById("switch-camera-btn");
    const fileUploadInput = document.getElementById("file-upload-input");
    const statusText = document.getElementById("camera-status");
    const guestAlert = document.getElementById("guest-alert");
    const resultsSection = document.getElementById("results-section");
    const noMatchesCard = document.getElementById("no-matches-card");
    const tryAgainBtn = document.getElementById("try-again-btn");
    const matchCountText = document.getElementById("match-count-text");
    const photoGrid = document.getElementById("guest-photo-grid");
    const downloadZipBtn = document.getElementById("download-zip-btn");
    const eventNameDisplay = document.getElementById("event-name-display");

    // Lightbox elements
    const lightbox = document.getElementById("guest-lightbox");
    const lightboxImg = document.getElementById("guest-lightbox-img");
    const lightboxDownload = document.getElementById("guest-lightbox-download");
    const lightboxClose = document.getElementById("guest-lightbox-close");

    let currentStream = null;
    let currentFacingMode = "user"; // "user" (front) or "environment" (rear)
    let capturedBlob = null;
    let matchedPhotoIds = [];

    // Load event info
    fetchEventInfo();

    // Start live camera
    startCamera();

    async function fetchEventInfo() {
        try {
            const res = await fetch("/api/event-info");
            const data = await res.json();
            if (data.event_name) {
                eventNameDisplay.textContent = data.event_name;
            }
        } catch (e) {
            console.warn("Could not load event info:", e);
        }
    }

    async function startCamera() {
        stopCamera();
        hideAlert();

        const constraints = {
            audio: false,
            video: {
                facingMode: currentFacingMode,
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        };

        try {
            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = currentStream;
            video.style.display = "block";
            previewImg.style.display = "none";
            faceGuide.style.display = "block";
            liveControls.style.display = "flex";
            previewControls.style.display = "none";

            if (currentFacingMode === "environment") {
                video.classList.add("environment");
            } else {
                video.classList.remove("environment");
            }

            statusText.textContent = "Position your face inside the circle and tap to snap a selfie.";
        } catch (err) {
            console.warn("Camera access error:", err);
            statusText.textContent = "Camera access not available. Tap the folder icon below to upload a photo.";
            showAlert("Could not open camera. You can still upload a photo directly using the folder icon below.");
        }
    }

    function stopCamera() {
        if (currentStream) {
            currentStream.getTracks().forEach((track) => track.stop());
            currentStream = null;
        }
    }

    // Camera Switch (Front / Back)
    switchCameraBtn.addEventListener("click", () => {
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
        startCamera();
    });

    // Take Selfie Snapshot
    snapBtn.addEventListener("click", () => {
        if (!video.videoWidth) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");

        // If front camera, flip horizontally for natural selfie orientation
        if (currentFacingMode === "user") {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
            (blob) => {
                capturedBlob = blob;
                const dataUrl = URL.createObjectURL(blob);
                previewImg.src = dataUrl;
                previewImg.style.display = "block";
                video.style.display = "none";
                faceGuide.style.display = "none";
                liveControls.style.display = "none";
                previewControls.style.display = "flex";
                statusText.textContent = "Great shot! Tap 'Find My Photos' to search the event.";

                stopCamera();
            },
            "image/jpeg",
            0.92
        );
    });

    // Retake Button
    retakeBtn.addEventListener("click", () => {
        capturedBlob = null;
        startCamera();
    });

    // File Upload Fallback
    fileUploadInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        capturedBlob = file;
        const reader = new FileReader();
        reader.onload = (evt) => {
            previewImg.src = evt.target.result;
            previewImg.style.display = "block";
            video.style.display = "none";
            faceGuide.style.display = "none";
            liveControls.style.display = "none";
            previewControls.style.display = "flex";
            statusText.textContent = "Photo selected! Tap 'Find My Photos' to search.";
            stopCamera();
        };
        reader.readAsDataURL(file);
    });

    // Search Photos
    searchBtn.addEventListener("click", () => {
        if (!capturedBlob) return;
        runFaceMatch(capturedBlob);
    });

    tryAgainBtn.addEventListener("click", () => {
        noMatchesCard.style.display = "none";
        resultsSection.style.display = "none";
        startCamera();
    });

    async function runFaceMatch(blob) {
        hideAlert();
        noMatchesCard.style.display = "none";
        resultsSection.style.display = "none";

        // Show scanning radar
        scanRadar.style.display = "block";
        searchBtn.disabled = true;
        searchBtn.innerHTML = '<span class="spinner"></span> Scanning...';
        statusText.textContent = "Analyzing face embeddings and scanning event gallery...";

        const formData = new FormData();
        formData.append("selfie", blob, "selfie.jpg");

        try {
            const res = await fetch("/api/match-face", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            scanRadar.style.display = "none";
            searchBtn.disabled = false;
            searchBtn.innerHTML = "🔍 Find My Photos";

            if (!res.ok || !data.success) {
                showAlert(data.detail || "Could not analyze face. Please make sure your face is clearly visible.");
                statusText.textContent = "Face detection error. Please try taking another selfie.";
                return;
            }

            matchedPhotoIds = data.photos.map((p) => p.id);

            if (data.matched_count > 0) {
                renderMatchedPhotos(data.photos);
                statusText.textContent = `Found ${data.matched_count} matching photos!`;
            } else {
                noMatchesCard.style.display = "block";
                statusText.textContent = "No matching photos found in this event gallery.";
            }
        } catch (err) {
            scanRadar.style.display = "none";
            searchBtn.disabled = false;
            searchBtn.innerHTML = "🔍 Find My Photos";
            showAlert("Connection error while searching photos. Please try again.");
            statusText.textContent = "Network error. Please try again.";
        }
    }

    function renderMatchedPhotos(photos) {
        photoGrid.innerHTML = "";
        matchCountText.textContent = `Found ${photos.length} photo${photos.length === 1 ? "" : "s"} of you! 🎉`;
        resultsSection.style.display = "block";

        photos.forEach((photo) => {
            const card = document.createElement("div");
            card.className = "photo-card";

            card.innerHTML = `
                <img src="${photo.thumbnail_url}" alt="${photo.original_name}" loading="lazy">
                <span class="photo-badge">${photo.confidence_percent}% Match</span>
                <div class="photo-actions">
                    <a href="${photo.download_url}" class="btn-photo-action" title="Download High-Res" download onclick="event.stopPropagation();">
                        ⬇️
                    </a>
                </div>
            `;

            card.addEventListener("click", () => {
                openLightbox(photo.photo_url, photo.download_url);
            });

            photoGrid.appendChild(card);
        });

        // Scroll smoothly to results
        resultsSection.scrollIntoView({ behavior: "smooth" });
    }

    // Download All ZIP
    downloadZipBtn.addEventListener("click", async () => {
        if (!matchedPhotoIds.length) return;

        downloadZipBtn.disabled = true;
        downloadZipBtn.innerHTML = '<span class="spinner"></span> Packaging ZIP...';

        try {
            const res = await fetch("/api/download-zip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ photo_ids: matchedPhotoIds }),
            });

            if (!res.ok) {
                throw new Error("Failed to generate zip");
            }

            const blob = await res.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = downloadUrl;
            a.download = "my_event_photos.zip";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            a.remove();
        } catch (e) {
            showAlert("Could not download ZIP archive. You can still download individual photos below.");
        } finally {
            downloadZipBtn.disabled = false;
            downloadZipBtn.innerHTML = "⬇️ Download All (ZIP)";
        }
    });

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

    function showAlert(msg) {
        guestAlert.textContent = msg;
        guestAlert.style.display = "block";
    }

    function hideAlert() {
        guestAlert.style.display = "none";
    }
});


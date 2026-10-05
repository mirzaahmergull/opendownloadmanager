# Long-running video batches · version 1.3.0

## Browser session

Pair the Chrome/Edge extension using **Browser**, then open **Settings → Video & batches → Browser session → Share from browser**. The browser helper opens the extension's session page. Click **Share YouTube session** and grant its optional cookie permission. You can also share directly from the extension popup after opening YouTube in that browser.

Only YouTube cookies are saved for this shared session. Windows DPAPI or macOS Keychain encrypts the credential vault; the renderer, exports, cloud metadata and status endpoint omit cookie values. Cookie jars passed to yt-dlp are temporary and removed after the operation; jars left by a forced exit are cleaned at startup. Sharing fails when OS encryption is unavailable.

**Refresh every 30 minutes** is optional and requires this browser and the desktop app to be running. Forget in either interface clears the desktop session; the extension stops refreshing a forgotten/replaced session. Forget also replaces the credential backup so it cannot restore that deleted session. A running yt-dlp process keeps the session it started with; new operations use the latest shared session.

Cookies can expire or trigger account checks. They do not guarantee access or prevent YouTube restrictions. Downloads must use content your session can access. No CAPTCHA solver, account rotation or DRM decryption is provided.

## Queue multiple playlists

Open **Video batches → New batch**, or **Playlist / video → Multiple playlists / long-running batch**. Paste one playlist, channel or video URL per line (up to 100). Choose a batch name, optional folder, quality/subtitles, cloud destination and whether to start now or keep the batch paused.

Each playlist gets a numbered, sanitized folder with a unique suffix, even when titles match. Identical videos within a playlist are deduplicated; the same video in two playlists is kept in both folders. A batch supports up to 50,000 videos, inspecting at most 10,000 entries per playlist. The console reports an entry limit when a collection is truncated. Imports are serialized and persistent; failed inspections can be retried or skipped.

The default YouTube policy allows one active video, a randomized **15–30 second gap** after completion, a **five-minute rest every 50 starts**, a one-second request gap and two fragment workers. Edit these values per batch under **Pacing & rest**, or set defaults in Settings. A batch keeps its saved policy when defaults change. Global download concurrency also limits the number running.

Smart control shares a cooldown across YouTube queues: a recognized rate limit waits 30 minutes, then 60 minutes on the next strike. A third strike or a recognized session/bot challenge pauses YouTube downloads for review. These responses are heuristic, not a guarantee that every site message is detected. **Resume YouTube after review** explicitly clears this gate; **Resume** on a batch retries its failed jobs/imports. Upload-only retries can proceed without requesting YouTube again.

**Resume when the app reopens** restores a running batch after a normal exit, including its pending imports, cooldown and cloud upload state. Explicitly paused batches stay paused. The app must remain running and the computer awake for progress; it does not operate while powered off.

## Cloud storage

Open **Settings → Developer tools → Manage cloud destinations**. Add an S3 bucket (region, optional compatible endpoint/path style), a Cloudflare R2 bucket (account ID, optional EU/FedRAMP jurisdiction) or a GCS bucket (optional project). Choose the official SDK's default credential chain, or save an encrypted S3/R2 access key or service-account JSON key. Existing secrets are never displayed. Test connection reads bucket metadata; it does not prove all upload permissions.

Select the profile when creating a batch. Object keys preserve batch/playlist organization and add the complete download UUID to avoid overwriting a different download. An unfinished batch's bucket/prefix cannot be changed in place; create another profile for a different destination.

The pipeline downloads and assembles one video locally, uploads its video and sidecars, verifies the remote metadata/checksums, durably records that verification, and only then removes local files if **Delete local files after all remote copies are verified** is enabled. S3 single PUT uses SHA-256; multipart uses per-part and composite SHA-256 checksums. R2 does not implement S3 checksum headers, so R2 writes send `Content-MD5` for each object and multipart part (R2 rejects mismatched bytes), and verification compares size, SHA-256 metadata and the ETag R2 returned. GCS uses expected MD5 plus size and SHA-256 metadata. Retries reuse existing matching objects and resume multipart/chunked uploads. Altered local files, mismatched remote checksums or unavailable state storage stop cleanup.

Generic S3-compatible endpoints must support checksum headers, conditional writes and multipart operations; unsupported endpoints fail safely. Choose the **Cloudflare R2** provider for R2 rather than an S3 profile with an R2 endpoint. Upload permissions include PutObject, GetObject/metadata, ListMultipartUploadParts and the KMS permissions needed by an encrypted bucket. GCS needs object creation and metadata reads. Configure credentials with the permissions required by your bucket policy. Default SDK authentication may require separately installed/configured cloud tooling.

Uploading occupies its batch slot until verification finishes. An upload failure or low-space condition holds the batch so downloads cannot accumulate behind a failed upload. The local-space reserve defaults to 2 GiB, plus twice the largest video already seen in that batch. A previously unseen large video may still exceed available space; disk-full errors hold the batch. The system is **not direct-to-cloud streaming** and needs working space for the current video, its streams/sidecars and assembly.

Pause retains partial cloud uploads for resume. Removing a batch keeps completed cloud objects and completed local files, and removes its download entries/partial download data. Configure an S3 lifecycle rule to expire abandoned incomplete multipart uploads; ODM does not delete arbitrary remote objects. GCS upload session URLs are encrypted in the vault. A lost/expired session starts a fresh upload after checking for an existing verified object.

### Cloudflare R2 setup and deployment notes

1. In the Cloudflare dashboard, create the bucket under **R2 → Overview**. R2 bucket names use lowercase letters, digits and hyphens (3–63 characters). Copy the 32-character **Account ID** from the R2 overview.
2. Under **R2 → Manage API tokens**, create a token with **Object Read & Write**, scoped to that bucket. Copy the **Access Key ID** and **Secret Access Key**; Cloudflare shows the secret once.
3. In ODM, add a destination with provider **Cloudflare R2**, the account ID and bucket. Pick **EU** or **FedRAMP** only if the bucket was created in that jurisdiction; the endpoint becomes `https://<account>.eu.r2.cloudflarestorage.com` or `https://<account>.fedramp.r2.cloudflarestorage.com`. ODM uses region `auto` and path-style requests.
4. Either store the key encrypted (**Store an encrypted key**) or choose **Default SDK credentials** and set `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (optionally `R2_SESSION_TOKEN`) in the environment that launches ODM. When those variables are absent, R2 falls back to the AWS SDK default chain (`AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, …), so set the R2 variables explicitly if AWS credentials are also present. See [.env.example](.env.example); ODM does not load `.env` files itself.
5. Add an R2 object lifecycle rule that aborts incomplete multipart uploads (for example after 7 days). ODM keeps an interrupted multipart session for resume and does not delete it on batch removal.
6. Use **Test connection** before a large batch. It checks bucket access only.

Google Cloud Storage default authentication reads `GOOGLE_APPLICATION_CREDENTIALS` or gcloud application-default credentials. Amazon S3 default authentication uses the standard AWS chain.

Real AWS and GCS account permissions, billing, quotas, KMS settings and service-account OAuth have **not** been exercised with user credentials, and the R2 provider has not been run against a live Cloudflare account. Tests use the actual SDKs with local protocol fixtures, including interruption/restart, byte integrity, checksum failures and cleanup ordering.

## Engine updates and notifications

**Settings → Developer tools** enables a daily check of official yt-dlp stable releases (default) or nightly releases. Downloads are bounded, checked against official SHA-256 sums, checked as native executables, and run with `--version` before activation. Updates wait until media downloads/inspections finish. The bundled engine remains available, with a previous-version restore button. This updates yt-dlp, not Electron, FFmpeg, the extension or the whole application.

**Settings → Video & batches → Notify me about** offers **Errors and blockages only** (default), **Completed downloads and errors**, or **Nothing**. Repeated identical attention events are coalesced for five minutes. Batch completion progress remains visible in the app even with notifications disabled. Browser context handoff completion notifications are also quiet by default.

## Research and implementation placement

- [yt-dlp extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors): session cookies, request sleeps and evolving YouTube limitations → `media-policy.cjs`, browser helper and batch pacing. Delays reduce bursts; they cannot ensure a site will never block a user.
- [Official yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases): release metadata/checksums → immutable version directories and idle activation in `updater.cjs`.
- [S3 integrity verification](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html), [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html): explicit checksums/metadata/conditional creation → `cloud.cjs`.
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/): region `auto`, `Content-MD5` on PutObject/UploadPart, no checksum-algorithm headers, conditional PutObject → R2 path in `cloud.cjs`.
- [GCS resumable uploads](https://docs.cloud.google.com/storage/docs/performing-resumable-uploads), [data validation](https://docs.cloud.google.com/storage/docs/data-validation): acknowledged chunk offsets, expected checksum and readback → resumable GCS uploader.

`batches.cjs` owns persistent import/group state and holds; `vault.cjs` owns encrypted secrets; `notifications.cjs` owns notification policy; `batch-renderer.js` adds console/settings dialogs; the existing engine coordinates download/upload slots and restart recovery.

import { SignJWT, importPKCS8 } from "jose";

// Google Drive uploads via a service account — no new dependencies, the JWT
// assertion is signed with jose (already used for sessions).
//
// Setup (one-time):
//   1. Google Cloud console → create a service account, add a JSON key.
//   2. Enable the "Google Drive API" for that project.
//   3. Share the target Drive folder with the service-account e-mail
//      (…@…iam.gserviceaccount.com) as Editor.
//   4. Env: GDRIVE_SA_EMAIL, GDRIVE_SA_PRIVATE_KEY (the PEM; \n-escaped is
//      fine), optionally GDRIVE_BACKUP_FOLDER_ID to override the default.

export const DEFAULT_BACKUP_FOLDER_ID = "1TDy_VDTQrkjyv1ib0ACZa7pweH7CZIBo";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";

export function driveConfigured(): boolean {
  return !!(process.env.GDRIVE_SA_EMAIL && process.env.GDRIVE_SA_PRIVATE_KEY);
}

export function backupFolderId(): string {
  return process.env.GDRIVE_BACKUP_FOLDER_ID || DEFAULT_BACKUP_FOLDER_ID;
}

async function accessToken(): Promise<string> {
  const email = process.env.GDRIVE_SA_EMAIL;
  const pem = process.env.GDRIVE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !pem) throw new Error("Google Drive backup not configured: set GDRIVE_SA_EMAIL and GDRIVE_SA_PRIVATE_KEY");

  const key = await importPKCS8(pem, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token exchange returned no access_token");
  return json.access_token;
}

// Multipart upload into the backup folder. Returns the created file id.
export async function uploadToDrive(fileName: string, bytes: Buffer, mimeType = "application/gzip"): Promise<string> {
  const token = await accessToken();
  const folderId = backupFolderId();

  const boundary = `-------fuelbackup${Date.now()}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw new Error(`Drive upload failed: HTTP ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Drive upload returned no file id");
  return json.id;
}

// Deletes fuel-backup-* files in the folder older than keepDays. Returns the
// number removed. Never throws on individual deletes — a stuck old file must
// not fail the day's backup.
export async function pruneOldBackups(keepDays = 30): Promise<number> {
  const token = await accessToken();
  const folderId = backupFolderId();
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();

  const q = encodeURIComponent(
    `'${folderId}' in parents and name contains 'fuel-backup-' and createdTime < '${cutoff}' and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return 0;
  const json = (await res.json()) as { files?: { id: string; name: string }[] };
  let removed = 0;
  for (const f of json.files ?? []) {
    const del = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.ok) removed++;
  }
  return removed;
}

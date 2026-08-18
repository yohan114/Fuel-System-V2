// Extracts an optional uploaded file from a FormData field into a Uint8Array,
// suitable for storing inline as a Prisma `Bytes` BLOB (mirrors the
// correction-document pattern so attachments travel with DB backups). Returns
// null when no file was provided. The type is left to inference so it resolves
// to Uint8Array<ArrayBuffer>, matching the Prisma Bytes input type.
export async function extractFileField(formData: FormData, field: string) {
  const f = formData.get(field);
  if (!f || typeof f === "string") return null;
  const file = f as File;
  if (!file.size) return null;
  const data = new Uint8Array(await file.arrayBuffer());
  return { data, name: file.name || "upload", mime: file.type || "application/octet-stream" };
}

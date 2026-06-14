import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  // 1. Verify user session and permissions
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Unauthorized. Administrative privileges required.", { status: 401 });
  }

  // 2. Extract and sanitize file parameter
  const filename = request.nextUrl.searchParams.get("file");
  if (!filename || !filename.startsWith("app-") || !filename.endsWith(".db")) {
    return new NextResponse("Invalid filename format requested.", { status: 400 });
  }

  // 3. Resolve path and verify file exists
  const filePath = path.join(process.cwd(), "backups", filename);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Requested backup file not found on server.", { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("Backup download streaming error:", err);
    return new NextResponse("Failed to stream requested database backup.", { status: 500 });
  }
}

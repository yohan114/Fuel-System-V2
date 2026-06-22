import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeReorder } from "@/lib/service/reorder";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const coverMonths = Math.min(24, Math.max(1, parseInt(searchParams.get("cover") || "3", 10) || 3));
  const leadMonths = Math.min(12, Math.max(0, parseInt(searchParams.get("lead") || "1", 10) || 0));

  try {
    const data = await computeReorder({ coverMonths, leadMonths });
    const money = (c: number | null) => (c == null ? "" : Math.round(c) / 100);

    const header = [
      ["EDWARD & CHRISTIE — FILTER PURCHASE LIST"],
      [`Coverage: ${coverMonths} months demand + ${leadMonths} months lead = ${data.totalCover} months`],
      [`Generated: ${new Date().toLocaleString("en-GB")}`],
      [],
      ["Filter No.", "Category", "Demand/mo", "On hand", "Target", "Order Qty", "Unit (LKR)", "Line Cost (LKR)", "Priced?"],
    ];
    const rows = data.rows.map((r) => [
      r.filterNo || "(no part no.)",
      r.category,
      Number(r.monthlyQty.toFixed(2)),
      r.onHand,
      r.targetQty,
      r.orderQty,
      money(r.avgUnitCents),
      money(r.orderCostCents),
      r.unpriced ? "NO" : "yes",
    ]);
    const totalRow = ["", "", "", "", "", "", "TOTAL", money(data.totalCostCents), ""];

    const ws = XLSX.utils.aoa_to_sheet([...header, ...rows, [], totalRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase List");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="purchase_list_${coverMonths}plus${leadMonths}mo.xlsx"`,
      },
    });
  } catch (err) {
    console.error("Reorder xlsx error:", err);
    return new NextResponse("Failed to compile purchase list.", { status: 500 });
  }
}

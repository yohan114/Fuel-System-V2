// Quick check of the cross-reference engine against the imported catalog.
// Run: DATABASE_URL="file:./data/app.db" npx tsx scripts/verify_xref.ts
import { search, indexStats } from "../src/lib/service/xref";

async function main() {
  console.log("index stats:", await indexStats());
  for (const q of ["FF5045", "ff-5045", "P550410", "31N8-01360", "BF7535"]) {
    const r = await search(q, 5);
    const top = r.results[0];
    console.log(
      `q="${q}" → normalized=${r.normalized} matches=${r.count}` +
        (top
          ? ` | top: [${top.category}] ${top.description ?? ""} · OEM ${top.oem ?? "—"} · equiv brands: ${Object.keys(top.equivalents).join(", ")} · price ${top.price ? "Rs " + (top.price.unitCents / 100).toLocaleString("en-LK") : "—"} · machines ${top.vehicleCount}`
          : " | no match")
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

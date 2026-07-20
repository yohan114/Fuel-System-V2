import { prisma } from "../src/lib/db";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const rs=(c:number)=>(c/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
// client-approved fuel-only targets
const TARGET:Record<string,number>={"D4D-01":3938132,"D4D-02":18706127,"D4D-03":9845330};
async function main(){
  for(const code of ["D4D-01","D4D-02","D4D-03"]){
    const a=await prisma.asset.findFirst({where:{code}});
    const b=await prisma.bill.findUnique({where:{assetId_year_month:{assetId:a!.id,year:2026,month:6}}});
    const inv=b!.invoiceNumber, issued=b!.issuedDate, due=b!.dueDate;
    // back to fuel-only, no guaranteed minimum artifact
    await prisma.asset.update({where:{id:a!.id},data:{billFuelOnly:true}});
    await prisma.bill.update({where:{id:b!.id},data:{status:"DRAFT"}});
    await generateBillForAsset(a!.id, resolvePeriod(2026,6), { regenerate:true, actorId:null });
    const nb=await prisma.bill.findUnique({where:{assetId_year_month:{assetId:a!.id,year:2026,month:6}}});
    // reissue keeping original number/dates
    await prisma.bill.update({where:{id:nb!.id},data:{status:"ISSUED",invoiceNumber:inv,issuedDate:issued,dueDate:due}});
    await prisma.auditLog.create({data:{actorId:ADMIN,action:"UPDATE",entity:"Bill",entityId:nb!.id,summary:`Reverted ${code} (${nb!.periodKey}) WET → fuel-only per client-approved Galagedara bill; reissued ${inv} at ${rs(nb!.grandTotalCents)}`}});
    const t=TARGET[code];
    console.log(`${code}: ${inv} rental=${rs(nb!.rentalAmountCents)} fuel=${nb!.fuelLitres}L grand=${rs(nb!.grandTotalCents)}  target=${rs(t)}  ${nb!.grandTotalCents===t?"✓":"✗ diff "+rs(nb!.grandTotalCents-t)}`);
  }
  const hdr=await prisma.bill.aggregate({where:{projectCode:"CEP-03F",year:2026,month:6},_sum:{grandTotalCents:true},_count:true});
  console.log(`\nCEP-03F header: ${hdr._count} vehicles, Rs ${rs(hdr._sum.grandTotalCents||0)}  (+ MG-07 share 141,293.79 = exploded 11-veh total)`);
  await prisma.$disconnect();
}
main().catch(async(e)=>{console.error(e);await prisma.$disconnect();process.exit(1);});

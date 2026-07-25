import { prisma } from "./src/lib/db";
const rs=(c:number)=>"Rs "+(c/100).toLocaleString(undefined,{maximumFractionDigits:2});
const APPLY=process.argv.includes("--apply");
const KEEP="CEP-03F";
async function main(){
  const del=await prisma.bill.findMany({where:{year:2026,month:6,projectCode:{not:KEEP}},select:{id:true,grandTotalCents:true}});
  const keep=await prisma.bill.count({where:{year:2026,month:6,projectCode:KEEP}});
  const total=del.reduce((s,b)=>s+b.grandTotalCents,0);
  console.log(`June 2026: ${del.length} bills to DELETE (${rs(total)}), ${keep} Galagedara bills to KEEP.`);
  if(!APPLY){console.log("DRY-RUN. pass --apply");return;}
  const ids=del.map(b=>b.id);
  await prisma.$transaction(async(tx)=>{
    const li=await tx.billLineItem.deleteMany({where:{billId:{in:ids}}});
    const rev=await tx.billRevision.deleteMany({where:{billId:{in:ids}}});
    const pay=await tx.payment.deleteMany({where:{billId:{in:ids}}});
    const cn=await tx.creditNote.deleteMany({where:{billId:{in:ids}}});
    const b=await tx.bill.deleteMany({where:{id:{in:ids}}});
    console.log(`Deleted: bills=${b.count} lineItems=${li.count} revisions=${rev.count} payments=${pay.count} creditNotes=${cn.count}`);
  });
  // verify
  const remain=await prisma.bill.findMany({where:{year:2026,month:6},select:{projectCode:true}});
  const byP:Record<string,number>={};for(const r of remain)byP[r.projectCode||"(none)"]=(byP[r.projectCode||"(none)"]||0)+1;
  console.log(`\nRemaining June 2026 bills: ${remain.length}`);
  for(const k of Object.keys(byP))console.log(`   ${k}: ${byP[k]}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});

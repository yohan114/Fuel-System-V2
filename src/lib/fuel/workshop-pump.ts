// Which bulk tank is the central workshop pump.
//
// The Badalgama main workshop pump is the one pump allowed to fuel any vehicle
// on any site; every other tank is a site pump whose operator may only fuel
// vehicles allocated to that site (enforced in workshopIssueFuelAction via
// canUserAccessAsset). The distinction is a property of the *operator's role*
// — WORKSHOP is unscoped, SITE_PUMP is scoped — so this helper exists purely to
// label and group the tank in admin views, not to grant any permission.

const WORKSHOP_TANK_NAME = /badalgama.*workshop|workshop.*badalgama/i;

export function isWorkshopTank(tank: { name: string }): boolean {
  return WORKSHOP_TANK_NAME.test(tank.name);
}

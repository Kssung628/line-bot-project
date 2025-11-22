
export function calcIRR(cashValues, annualPremium) {
  if (!cashValues || cashValues.length === 0 || !annualPremium) {
    return null;
  }

  const periods = cashValues.length;
  const flows = [];
  for (let t = 0; t < periods; t++) {
    flows.push(-annualPremium);
  }
  flows[flows.length - 1] += cashValues[flows.length - 1].cash;

  let irr = 0.03;
  for (let i = 0; i < 200; i++) {
    let npv = 0;
    let d = 0;
    for (let t = 0; t < flows.length; t++) {
      npv += flows[t] / Math.pow(1 + irr, t);
      if (t > 0) {
        d -= t * flows[t] / Math.pow(1 + irr, t + 1);
      }
    }
    if (Math.abs(npv) < 1e-4) break;
    if (d === 0) break;
    irr = irr - npv / d;
  }
  return irr;
}

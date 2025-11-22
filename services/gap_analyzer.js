
export function analyzeGap(profile, coverage) {
  const lifeCoverage = findAmount(coverage, ["壽險", "身故", "死亡"]);
  const criticalCoverage = findAmount(coverage, ["重大", "重疾"]);
  const accidentCoverage = findAmount(coverage, ["意外"]);
  const medicalCoverage = findAmount(coverage, ["醫療", "住院"]);

  const income = profile.income || 0;
  const debt = profile.debt || 0;
  const childCost = profile.childCost || 0;

  const lifeNeed = income * 5 + debt + childCost;
  const criticalNeed = 1000000;
  const accidentNeed = income * 3;
  const medicalNeed = 500000;

  return {
    life: { need: lifeNeed, have: lifeCoverage, gap: Math.max(lifeNeed - lifeCoverage, 0) },
    critical: { need: criticalNeed, have: criticalCoverage, gap: Math.max(criticalNeed - criticalCoverage, 0) },
    accident: { need: accidentNeed, have: accidentCoverage, gap: Math.max(accidentNeed - accidentCoverage, 0) },
    medical: { need: medicalNeed, have: medicalCoverage, gap: Math.max(medicalNeed - medicalCoverage, 0) }
  };
}

function findAmount(coverage, keywords) {
  if (!coverage || coverage.length === 0) return 0;
  for (const c of coverage) {
    const label = (c.item || "") + (c.amount || "");
    if (keywords.some(k => label.includes(k))) {
      const m = (c.amount || "").replace(/[,元]/g, "");
      const v = parseInt(m, 10);
      if (!isNaN(v)) return v;
    }
  }
  return 0;
}

export function analyzeGap(profile, coverage) {
  const lifeCoverage = findAmount(coverage, ["壽險", "身故", "死亡"]);
  const criticalCoverage = findAmount(coverage, ["重大", "重疾"]);
  const accidentCoverage = findAmount(coverage, ["意外"]);
  const medicalCoverage = findAmount(coverage, ["醫療", "住院"]);

  const income = profile.income || 0;
  const debt = profile.debt || 0;
  const childCost = profile.childCost || 0;

  // 很粗略的試算模型，你可以之後再調整
  const lifeNeed = income * 5 + debt + childCost; // 5 年收入 + 負債 + 小孩教育
  const criticalNeed = 1000000;                   // 重大疾病一筆金
  const accidentNeed = income * 3;                // 意外 3 年收入
  const medicalNeed = 500000;                     // 醫療預備金

  const result = {
    life: {
      need: lifeNeed,
      have: lifeCoverage,
      gap: lifeNeed - lifeCoverage,
    },
    critical: {
      need: criticalNeed,
      have: criticalCoverage,
      gap: criticalNeed - criticalCoverage,
    },
    accident: {
      need: accidentNeed,
      have: accidentCoverage,
      gap: accidentNeed - accidentCoverage,
    },
    medical: {
      need: medicalNeed,
      have: medicalCoverage,
      gap: medicalNeed - medicalCoverage,
    },
  };

  const suggestions = [];

  if (result.life.gap > 0) {
    suggestions.push(
      `壽險/身故保障約缺口 ${formatMoney(result.life.gap)}，可考慮調整壽險或增額壽險。`
    );
  }
  if (result.critical.gap > 0) {
    suggestions.push(
      `重大傷病保障不足（缺口約 ${formatMoney(
        result.critical.gap
      )}），可考慮補強重大傷病險。`
    );
  }
  if (result.accident.gap > 0) {
    suggestions.push(
      `意外身故/失能保障偏低（缺口約 ${formatMoney(
        result.accident.gap
      )}），可搭配意外險或傷害險。`
    );
  }
  if (result.medical.gap > 0) {
    suggestions.push(
      `醫療實支/住院保障不足（缺口約 ${formatMoney(
        result.medical.gap
      )}），可考慮實支實付醫療或住院日額。`
    );
  }

  const summary =
    suggestions.length > 0
      ? "依照目前收入與負債，建議優先關注的保障缺口：\n- " +
        suggestions.join("\n- ")
      : "目前看起來主要保障大致到位，不過仍建議逐一檢視條款細節與除外責任。";

  return {
    ...result,
    summary,
    suggestions,
  };
}

function findAmount(coverage, keywords) {
  if (!coverage || coverage.length === 0) return 0;
  for (const c of coverage) {
    const label = (c.item || "") + (c.amount || "");
    if (keywords.some((k) => label.includes(k))) {
      const m = (c.amount || "").replace(/[,元]/g, "");
      const v = parseInt(m, 10);
      if (!isNaN(v)) return v;
    }
  }
  return 0;
}

function formatMoney(v) {
  if (!v || isNaN(v)) return "0 元";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  return (
    sign +
    abs
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    " 元"
  );
}

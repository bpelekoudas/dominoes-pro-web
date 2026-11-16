import { describe, expect, it } from "vitest";
import { AUDIT_FELTS, AUDIT_SEEDS, auditAll, type AuditSizeReport } from "./felt-audit.js";

function failures(report: AuditSizeReport): number {
  return report.settledCut
    + report.glideCut
    + report.settledOverlap
    + report.glideOverlap
    + report.uiOverlap
    + report.tiny
    + report.zoomIn
    + report.jump
    + report.ghostCut;
}

describe("felt stress audit", () => {
  it(
    "keeps every tile inside the copper, clear of the other tiles and the chrome, at phone size, across 200 hands",
    () => {
      const reports = auditAll(AUDIT_SEEDS);
      expect(reports.map((report) => report.name)).toEqual(AUDIT_FELTS.map((felt) => felt.name));
      for (const report of reports) {
        expect(report.plays, report.name).toBeGreaterThan(1000);
        expect(report.longChains, report.name).toBeGreaterThan(20);
        expect(failures(report), `${report.name} ${JSON.stringify(report.worst)}`).toBe(0);
      }
    },
    180_000,
  );
});

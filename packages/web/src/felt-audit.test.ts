import { describe, expect, it } from "vitest";
import { AUDIT_FELTS, AUDIT_SEEDS, auditSize, type AuditSizeReport } from "./felt-audit.js";

function failures(report: AuditSizeReport): number {
  return report.settledCut
    + report.glideCut
    + report.settledOverlap
    + report.glideOverlap
    + report.uiOverlap
    + report.zoomIn
    + report.jump
    + report.ghostCut
    + report.connectGap
    + report.handEndSnap
    + report.refold;
}

describe("felt stress audit", () => {
  it(
    "keeps every tile inside the copper, clear of the other tiles and the chrome, at phone size, across 200 hands",
    async () => {
      const before: AuditSizeReport[] = [];
      const reports: AuditSizeReport[] = [];
      for (const felt of AUDIT_FELTS) {
        before.push(auditSize(felt, AUDIT_SEEDS, "TBL-013", false));
        reports.push(auditSize(felt, AUDIT_SEEDS, "TBL-013", true));
        await new Promise((resolve) => setImmediate(resolve));
      }
      const row = (report: AuditSizeReport) => ({
        refold: report.refold,
        cut: report.settledCut,
        glide: report.glideCut,
        overlap: report.settledOverlap + report.glideOverlap,
        connect: report.connectGap,
        under18: report.tiny,
        zoomIn: report.zoomIn,
        handEnd: report.handEndSnap,
      });
      console.log("before", Object.fromEntries(before.map((report) => [report.name, row(report)])));
      console.log("after", Object.fromEntries(reports.map((report) => [report.name, row(report)])));
      expect(reports.map((report) => report.name)).toEqual(AUDIT_FELTS.map((felt) => felt.name));
      for (const report of reports) {
        expect(report.plays, report.name).toBeGreaterThan(1000);
        expect(report.longChains, report.name).toBeGreaterThan(20);
        expect(report.refold, report.name).toBe(0);
        expect(failures(report), `${report.name} ${JSON.stringify(report.worst)}`).toBe(0);
      }
    },
    300_000,
  );
});

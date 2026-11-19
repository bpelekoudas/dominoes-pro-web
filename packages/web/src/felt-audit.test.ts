import { describe, expect, it } from "vitest";
import { AUDIT_FELTS, AUDIT_SEEDS, auditSize, percentile, type AuditSizeReport } from "./felt-audit.js";

function failures(report: AuditSizeReport): number {
  return report.settledCut
    + report.glideCut
    + report.settledOverlap
    + report.glideOverlap
    + report.uiOverlap
    + report.zoomIn
    + report.jump
    + report.ghostCut
    + report.unjoinedGap
    + report.spinnerBlind
    + report.connectGap
    + report.handEndSnap
    + report.refold
    + report.g1 + report.g2 + report.g3 + report.g7 + report.g8 + report.g9
    + report.g10 + report.g11 + report.g12 + report.g13 + report.g14 + report.g15
    + report.renderClose + report.renderSkew;
}

function merge(left: AuditSizeReport | null, right: AuditSizeReport): AuditSizeReport {
  if (!left) return right;
  const sum = { ...left, endPx: [...left.endPx, ...right.endPx], endLong: [...left.endLong, ...right.endLong], endFill: [...left.endFill, ...right.endFill], worst: [...left.worst, ...right.worst].slice(0, 8) };
  for (const key of ["hands", "plays", "longChains", "doubleHeavy", "settledCut", "glideCut", "exposedCut", "connectGap", "handEndSnap", "refold", "tinyPlays", "longUnder18", "settledOverlap", "glideOverlap", "uiOverlap", "tiny", "zoomIn", "jump", "ghostCut", "unjoinedGap", "spinnerBlind", "g1", "g2", "g3", "g7", "g8", "g9", "g10", "g11", "g12", "g13", "g14", "g15", "renderClose", "renderSkew"] as const) {
    sum[key] += right[key];
  }
  return sum;
}

async function auditChunked(felt: (typeof AUDIT_FELTS)[number], lockChain: boolean, seats = 4): Promise<AuditSizeReport> {
  let acc: AuditSizeReport | null = null;
  for (let start = 1; start <= AUDIT_SEEDS; start += 20) {
    acc = merge(acc, auditSize(felt, Math.min(20, AUDIT_SEEDS - start + 1), "TBL-013", lockChain, start, seats));
    await new Promise((resolve) => setImmediate(resolve));
  }
  return acc!;
}

describe("felt stress audit", () => {
  it(
    "keeps every tile inside the copper, clear of the other tiles and the chrome, at phone size, across 200 hands",
    async () => {
      const before: AuditSizeReport[] = [];
      const reports: AuditSizeReport[] = [];
      for (const felt of AUDIT_FELTS) {
        before.push(await auditChunked(felt, false));
        reports.push(await auditChunked(felt, true));
      }
      const row = (report: AuditSizeReport) => ({
        refold: report.refold,
        cut: report.settledCut,
        glide: report.glideCut,
        overlap: report.settledOverlap + report.glideOverlap,
        connect: report.connectGap,
        under18: report.tinyPlays,
        zoomIn: report.zoomIn,
        handEnd: report.handEndSnap,
        px: {
          min: +percentile(report.endPx, 0).toFixed(1),
          p10: +percentile(report.endPx, 0.1).toFixed(1),
          median: +percentile(report.endPx, 0.5).toFixed(1),
        },
        fill: {
          min: +((percentile(report.endFill, 0)) * 100).toFixed(1),
          p10: +((percentile(report.endFill, 0.1)) * 100).toFixed(1),
          median: +((percentile(report.endFill, 0.5)) * 100).toFixed(1),
        },
      });
      console.log("before", Object.fromEntries(before.map((report) => [report.name, row(report)])));
      console.log("after", Object.fromEntries(reports.map((report) => [report.name, row(report)])));
      expect(reports.map((report) => report.name)).toEqual(AUDIT_FELTS.map((felt) => felt.name));
      const gates = (report: AuditSizeReport) => ({
        g1: report.g1, g2: report.g2, g3: report.g3, g7: report.g7, g8: report.g8, g9: report.g9,
        g10: report.g10, g11: report.g11, g12: report.g12, g13: report.g13, g14: report.g14, g15: report.g15,
        cut: report.settledCut, overlap: report.settledOverlap, blind: report.spinnerBlind, refold: report.refold,
        long: {
          min: +percentile(report.endLong, 0).toFixed(1),
          median: +percentile(report.endLong, 0.5).toFixed(1),
        },
        under18: report.longUnder18,
      });
      const two: AuditSizeReport[] = [];
      for (const felt of AUDIT_FELTS) two.push(await auditChunked(felt, true, 2));
      console.log("gates 4p", Object.fromEntries(reports.map((report) => [report.name, gates(report)])));
      console.log("gates 2p", Object.fromEntries(two.map((report) => [report.name, gates(report)])));
      for (const report of reports) {
        expect(report.plays, report.name).toBeGreaterThan(1000);
        expect(report.longChains, report.name).toBeGreaterThan(20);
        expect(report.refold, report.name).toBe(0);
        expect(failures(report), `${report.name} ${JSON.stringify(report.worst)}`).toBe(0);
      }
      for (const report of two) {
        expect(report.refold, `2p ${report.name}`).toBe(0);
        expect(failures(report), `2p ${report.name} ${JSON.stringify(report.worst)}`).toBe(0);
      }
    },
    300_000,
  );
});

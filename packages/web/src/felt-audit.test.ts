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
    + report.renderedTight
    + report.unreadChain
    + report.connectGap
    + report.handEndSnap
    + report.refold;
}

function merge(left: AuditSizeReport | null, right: AuditSizeReport): AuditSizeReport {
  if (!left) return right;
  const sum = { ...left, endPx: [...left.endPx, ...right.endPx], endFill: [...left.endFill, ...right.endFill], worst: [...left.worst, ...right.worst].slice(0, 8) };
  for (const key of ["hands", "plays", "longChains", "doubleHeavy", "settledCut", "glideCut", "exposedCut", "connectGap", "handEndSnap", "refold", "tinyPlays", "settledOverlap", "glideOverlap", "uiOverlap", "tiny", "zoomIn", "jump", "ghostCut", "unjoinedGap", "spinnerBlind", "prematureTurn", "spiral", "parallelRun", "renderedTight", "unreadChain"] as const) {
    sum[key] += right[key];
  }
  sum.minGapPx = Math.min(left.minGapPx, right.minGapPx);
  return sum;
}

async function auditChunked(felt: (typeof AUDIT_FELTS)[number], lockChain: boolean): Promise<AuditSizeReport> {
  let acc: AuditSizeReport | null = null;
  for (let start = 1; start <= AUDIT_SEEDS; start += 20) {
    acc = merge(acc, auditSize(felt, Math.min(20, AUDIT_SEEDS - start + 1), "TBL-013", lockChain, start));
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
        premature: report.prematureTurn,
        spiral: report.spiral,
        parallel: report.parallelRun,
        tight: report.renderedTight,
        unread: report.unreadChain,
        minGap: Number.isFinite(report.minGapPx) ? +report.minGapPx.toFixed(1) : null,
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
      for (const report of reports) {
        expect(report.plays, report.name).toBeGreaterThan(1000);
        expect(report.longChains, report.name).toBeGreaterThan(20);
        expect(report.refold, report.name).toBe(0);
        expect(failures(report), `${report.name} ${JSON.stringify(report.worst)}`).toBe(0);
      }
      const duoFelts = AUDIT_FELTS.filter((felt) => felt.name === "390x844" || felt.name === "430x932");
      for (const felt of duoFelts) {
        let duo: AuditSizeReport | null = null;
        for (let start = 1; start <= AUDIT_SEEDS; start += 20) {
          duo = merge(duo, auditSize(felt, Math.min(20, AUDIT_SEEDS - start + 1), "TBL-003", true, start, 2));
          await new Promise((resolve) => setImmediate(resolve));
        }
        console.log("duo", felt.name, row(duo!));
        expect(duo!.plays, felt.name).toBeGreaterThan(400);
        expect(failures(duo!), `2p ${felt.name} ${JSON.stringify(duo!.worst)}`).toBe(0);
      }
    },
    480_000,
  );
});

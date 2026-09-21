/**
 * The register, seen through other frameworks' domains.
 *
 * The platform's own families group controls by what they do. A reviewer
 * who works in NIST terms wants the same controls under the domains their
 * matrix uses, so each control is placed in a NIST SP 800-53 family, a NIST
 * CSF 2.0 function and an ISO/IEC 27001:2022 theme. A control can sit in one
 * domain per framework; the placement is the family whose intent it serves,
 * not every family it touches.
 */

export interface Domain { id: string; name: string; note?: string }

export interface Grouping {
  id: string;
  label: string;
  short: string;
  domains: Domain[];
  of: Record<string, string>;
}

const NIST_53: Domain[] = [
  { id: "AC", name: "AC · Access Control" },
  { id: "IA", name: "IA · Identification and Authentication" },
  { id: "AU", name: "AU · Audit and Accountability" },
  { id: "SC", name: "SC · System and Communications Protection" },
  { id: "SI", name: "SI · System and Information Integrity" },
  { id: "CM", name: "CM · Configuration Management" },
  { id: "SA", name: "SA · System and Services Acquisition" },
  { id: "IR", name: "IR · Incident Response" },
  { id: "PL", name: "PL · Planning" },
];

const CSF: Domain[] = [
  { id: "GV", name: "Govern", note: "policy, roles, oversight" },
  { id: "ID", name: "Identify", note: "assets, risks, supply chain" },
  { id: "PR", name: "Protect", note: "access, awareness, data, platform, resilience" },
  { id: "DE", name: "Detect", note: "continuous monitoring, adverse event analysis" },
  { id: "RS", name: "Respond", note: "management, analysis, mitigation" },
  { id: "RC", name: "Recover", note: "recovery plan execution" },
];

const ISO_27001: Domain[] = [
  { id: "ORG", name: "A.5 · Organisational controls" },
  { id: "PEO", name: "A.6 · People controls" },
  { id: "TEC", name: "A.8 · Technological controls" },
];

export const GROUPINGS: Grouping[] = [
  {
    id: "nist53",
    label: "NIST SP 800-53 Rev 5 family",
    short: "NIST 800-53",
    domains: NIST_53,
    of: {
      "AF-AC-01": "AC", "AF-AC-02": "AC", "AF-AC-03": "AC", "AF-AC-04": "SC",
      "AF-DP-01": "SI", "AF-DP-02": "AC", "AF-DP-03": "SC", "AF-DP-04": "SI", "AF-DP-05": "AC",
      "AF-HO-01": "AC", "AF-HO-02": "AU", "AF-HO-03": "CM",
      "AF-ID-01": "IA", "AF-ID-02": "IA", "AF-ID-03": "IA",
      "AF-IN-01": "SI", "AF-IN-02": "SA", "AF-IN-03": "CM", "AF-IN-04": "SC",
      "AF-RS-01": "SC", "AF-RS-02": "SC", "AF-RS-03": "IR",
      "AF-AU-01": "AU", "AF-AU-02": "AU", "AF-AU-03": "IA",
    },
  },
  {
    id: "csf",
    label: "NIST CSF 2.0 function",
    short: "NIST CSF 2.0",
    domains: CSF,
    of: {
      "AF-AC-01": "PR", "AF-AC-02": "PR", "AF-AC-03": "GV", "AF-AC-04": "PR",
      "AF-DP-01": "PR", "AF-DP-02": "PR", "AF-DP-03": "PR", "AF-DP-04": "DE", "AF-DP-05": "PR",
      "AF-HO-01": "GV", "AF-HO-02": "GV", "AF-HO-03": "GV",
      "AF-ID-01": "PR", "AF-ID-02": "PR", "AF-ID-03": "PR",
      "AF-IN-01": "PR", "AF-IN-02": "ID", "AF-IN-03": "PR", "AF-IN-04": "PR",
      "AF-RS-01": "PR", "AF-RS-02": "PR", "AF-RS-03": "RS",
      "AF-AU-01": "DE", "AF-AU-02": "DE", "AF-AU-03": "PR",
    },
  },
  {
    id: "iso27001",
    label: "ISO/IEC 27001:2022 Annex A theme",
    short: "ISO 27001",
    domains: ISO_27001,
    of: {
      "AF-AC-01": "TEC", "AF-AC-02": "TEC", "AF-AC-03": "ORG", "AF-AC-04": "TEC",
      "AF-DP-01": "TEC", "AF-DP-02": "TEC", "AF-DP-03": "TEC", "AF-DP-04": "TEC", "AF-DP-05": "TEC",
      "AF-HO-01": "ORG", "AF-HO-02": "PEO", "AF-HO-03": "ORG",
      "AF-ID-01": "TEC", "AF-ID-02": "TEC", "AF-ID-03": "TEC",
      "AF-IN-01": "TEC", "AF-IN-02": "TEC", "AF-IN-03": "TEC", "AF-IN-04": "TEC",
      "AF-RS-01": "TEC", "AF-RS-02": "TEC", "AF-RS-03": "ORG",
      "AF-AU-01": "TEC", "AF-AU-02": "TEC", "AF-AU-03": "TEC",
    },
  },
];

export const GROUPING_BY_ID = new Map(GROUPINGS.map((g) => [g.id, g]));

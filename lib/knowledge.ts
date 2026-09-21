/**
 * The curated corpus.
 *
 * What agents built here are allowed to retrieve from, chosen rather than
 * crawled. Curation is the point: an agent that can reach the open web will
 * eventually cite something it should not, and a GRC answer is only as good as
 * the authority under it.
 *
 * Every entry carries its licence, because that governs what we may actually
 * hold. Three states, and the distinction is not cosmetic:
 *
 *   open         redistributable — the text can be chunked, embedded and cited
 *   registration free but behind an account — held only where the client's own
 *                licence covers it, so it ships listed and not ingested
 *   licensed     paid or restricted — cited by reference, never stored. ISO,
 *                Gartner and Forrester sit here. An agent can say "ISO/IEC
 *                42001 A.9 applies" without us holding a word of the standard.
 *
 * Nothing here is ingested by being listed. A source becomes retrievable only
 * after a person admits it, which is the whole shape of the page over this.
 */

export type Licence = "open" | "registration" | "licensed";

export interface Source {
  id: string;
  name: string;
  publisher: string;
  family: string;
  licence: Licence;
  /** What an agent uses it for. */
  use: string;
  /** Where it is fetched from; several URLs, space separated, are one document. */
  url: string;
  /** How often the publisher changes it. */
  cadence: string;
}

/**
 * Internal sources are the client's own corpus, not ours. They are listed as
 * placeholders because the names differ per engagement, and because a register
 * that pretends to have ingested a client's intranet before the engagement
 * starts is the first thing they will test.
 */
export const INTERNAL_PLACEHOLDERS: Source[] = [
  { id: "int-policies", name: "Corporate policies and procedures", publisher: "Client", family: "internal", licence: "registration", use: "The client's own standards, which outrank an external framework where they conflict", url: "", cadence: "On revision" },
  { id: "int-intranet", name: "Intranet and knowledge portal", publisher: "Client", family: "internal", licence: "registration", use: "Operating procedures and internal guidance", url: "", cadence: "Continuous" },
  { id: "int-product", name: "Product and service library", publisher: "Client", family: "internal", licence: "registration", use: "What the organisation builds, for context on its own exposure", url: "", cadence: "On release" },
  { id: "int-site", name: "Public website", publisher: "Client", family: "internal", licence: "open", use: "External claims the organisation has made, for consistency checks", url: "", cadence: "Continuous" },
  { id: "int-registers", name: "Risk and exception registers", publisher: "Client", family: "internal", licence: "registration", use: "Accepted risks and live exceptions, which change a disposition", url: "", cadence: "Continuous" },
];

export const FAMILIES = [
  { id: "internal", name: "Internal sources", note: "The client's own corpus. Named per engagement and connected on deployment." },
  { id: "ai", name: "AI and agentic security", note: "The standards written for systems that reason and act." },
  { id: "frameworks", name: "Security frameworks and controls", note: "The control catalogues an assessment is written against." },
  { id: "threat", name: "Threat and vulnerability intelligence", note: "What is being exploited, and how badly it scores." },
  { id: "cloud", name: "Cloud and platform baselines", note: "What good looks like on each provider." },
  { id: "identity", name: "Identity and access", note: "Assurance levels and authentication guidance." },
  { id: "regulation", name: "Regulation and privacy", note: "What the law requires, by jurisdiction." },
  { id: "market", name: "Market and analyst research", note: "Vendor landscapes and practitioner data." },
];

export const EXTERNAL: Source[] = [
  /* ── AI and agentic security ── */
  { id: "owasp-agentic", name: "OWASP Top 10 for Agentic Applications 2026", publisher: "OWASP GenAI Security Project", family: "ai", licence: "open", use: "Agentic threat classes and their mitigations", url: "https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/", cadence: "Annual" },
  { id: "owasp-llm", name: "OWASP Top 10 for LLM Applications 2026", publisher: "OWASP GenAI Security Project", family: "ai", licence: "open", use: "Model-layer risks and testing guidance", url: "https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM01_PromptInjection.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM02_SensitiveInformationDisclosure.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM03_SupplyChain.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM04_DataModelPoisoning.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM05_ImproperOutputHandling.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM06_ExcessiveAgency.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM07_SystemPromptLeakage.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM08_VectorAndEmbeddingWeaknesses.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM09_Misinformation.md https://raw.githubusercontent.com/OWASP/www-project-top-10-for-large-language-model-applications/main/2_0_vulns/LLM10_UnboundedConsumption.md", cadence: "Annual" },
  { id: "nist-ai-rmf", name: "NIST AI Risk Management Framework (AI 100-1)", publisher: "NIST", family: "ai", licence: "open", use: "Govern, map, measure and manage functions", url: "https://airc.nist.gov/airmf-resources/playbook/", cadence: "Major revisions" },
  { id: "nist-ai-600", name: "NIST Generative AI Profile (AI 600-1)", publisher: "NIST", family: "ai", licence: "open", use: "Generative-AI-specific risks against the framework", url: "https://airc.nist.gov/generative_ai_wg/", cadence: "Major revisions" },
  { id: "mitre-atlas", name: "MITRE ATLAS", publisher: "MITRE", family: "ai", licence: "open", use: "Adversarial tactics and techniques against AI systems", url: "https://raw.githubusercontent.com/mitre-atlas/atlas-navigator-data/main/dist/stix-atlas.json", cadence: "Quarterly" },
  { id: "csa-aicm", name: "CSA AI Controls Matrix", publisher: "Cloud Security Alliance", family: "ai", licence: "open", use: "AI control objectives mapped to cloud controls", url: "https://cloudsecurityalliance.org/artifacts/ai-controls-matrix", cadence: "Periodic" },
  { id: "eu-ai-act", name: "EU AI Act, Regulation (EU) 2024/1689", publisher: "European Union", family: "ai", licence: "open", use: "Obligations by risk tier, oversight and record-keeping", url: "https://publications.europa.eu/resource/celex/32024R1689", cadence: "On amendment" },
  { id: "iso-42001", name: "ISO/IEC 42001 AI management systems", publisher: "ISO", family: "ai", licence: "licensed", use: "Annex A control objectives, cited by clause", url: "https://www.iso.org", cadence: "Major revisions" },

  /* ── Security frameworks and controls ── */
  { id: "nist-csf", name: "NIST Cybersecurity Framework 2.0", publisher: "NIST", family: "frameworks", licence: "open", use: "Function, category and subcategory mapping", url: "https://csrc.nist.gov/pubs/cswp/29/the-nist-cybersecurity-framework-csf-20/final", cadence: "Major revisions" },
  { id: "nist-800-53", name: "NIST SP 800-53 Rev. 5", publisher: "NIST", family: "frameworks", licence: "open", use: "Control statements and enhancements for assessments", url: "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog-min.json", cadence: "Revisions and errata" },
  { id: "nist-800-171", name: "NIST SP 800-171 Rev. 3", publisher: "NIST", family: "frameworks", licence: "open", use: "Controlled unclassified information requirements", url: "https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog-min.json", cadence: "Revisions" },
  { id: "cis-controls", name: "CIS Critical Security Controls v8.1", publisher: "Center for Internet Security", family: "frameworks", licence: "registration", use: "Safeguards by implementation group", url: "https://www.cisecurity.org/controls/cis-controls-list", cadence: "Periodic" },
  { id: "cis-benchmarks", name: "CIS Benchmarks", publisher: "Center for Internet Security", family: "frameworks", licence: "registration", use: "Hardening baselines per platform", url: "https://www.cisecurity.org/cis-benchmarks", cadence: "Monthly" },
  { id: "iso-27001", name: "ISO/IEC 27001 and 27002", publisher: "ISO", family: "frameworks", licence: "licensed", use: "Annex A controls, cited by clause", url: "https://www.iso.org", cadence: "Major revisions" },
  { id: "owasp-top10", name: "OWASP Top 10 (Web) 2025", publisher: "OWASP", family: "frameworks", licence: "open", use: "Application risk categories", url: "https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/0x00_2025-Introduction.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A01_2025-Broken_Access_Control.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A02_2025-Security_Misconfiguration.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A03_2025-Software_Supply_Chain_Failures.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A04_2025-Cryptographic_Failures.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A05_2025-Injection.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A06_2025-Insecure_Design.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A07_2025-Authentication_Failures.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A08_2025-Software_or_Data_Integrity_Failures.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A09_2025-Security_Logging_and_Alerting_Failures.md https://raw.githubusercontent.com/OWASP/Top10/master/2025/docs/en/A10_2025-Mishandling_of_Exceptional_Conditions.md", cadence: "Every few years" },
  { id: "owasp-asvs", name: "OWASP Application Security Verification Standard", publisher: "OWASP", family: "frameworks", licence: "open", use: "Verification requirements by assurance level", url: "https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x10-V1-Encoding-and-Sanitization.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x11-V2-Validation-and-Business-Logic.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x12-V3-Web-Frontend-Security.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x13-V4-API-and-Web-Service.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x14-V5-File-Handling.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x15-V6-Authentication.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x16-V7-Session-Management.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x17-V8-Authorization.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x18-V9-Self-contained-Tokens.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x19-V10-OAuth-and-OIDC.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x20-V11-Cryptography.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x21-V12-Secure-Communication.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x22-V13-Configuration.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x23-V14-Data-Protection.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x24-V15-Secure-Coding-and-Architecture.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x26-V17-WebRTC.md", cadence: "Major revisions" },
  { id: "owasp-samm", name: "OWASP SAMM", publisher: "OWASP", family: "frameworks", licence: "open", use: "Software assurance maturity assessment", url: "https://owaspsamm.org/model/", cadence: "Periodic" },

  /* ── Threat and vulnerability intelligence ── */
  { id: "mitre-attack", name: "MITRE ATT&CK Enterprise", publisher: "MITRE", family: "threat", licence: "open", use: "Adversary tactics and techniques for mapping detections", url: "https://attack.mitre.org/techniques/enterprise/", cadence: "Twice a year" },
  { id: "cisa-kev", name: "CISA Known Exploited Vulnerabilities", publisher: "CISA", family: "threat", licence: "open", use: "What is exploited in the wild, with due dates", url: "https://www.cisa.gov/sites/default/files/csv/known_exploited_vulnerabilities.csv", cadence: "Continuous" },
  { id: "nvd", name: "National Vulnerability Database", publisher: "NIST", family: "threat", licence: "open", use: "CVE records, CVSS vectors and CWE mappings", url: "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=40", cadence: "Continuous" },
  { id: "first-epss", name: "FIRST EPSS", publisher: "FIRST.org", family: "threat", licence: "open", use: "Exploit prediction scores and percentiles", url: "https://www.first.org/epss/faq", cadence: "Daily" },
  { id: "cvss", name: "CVSS v4.0 specification", publisher: "FIRST.org", family: "threat", licence: "open", use: "Scoring method and vector interpretation", url: "https://www.first.org/cvss/v4.0/specification-document", cadence: "Major revisions" },
  { id: "cwe", name: "CWE and the CWE Top 25", publisher: "MITRE", family: "threat", licence: "open", use: "Weakness taxonomy for root-cause analysis", url: "https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html", cadence: "Annual" },
  { id: "dbir", name: "Verizon Data Breach Investigations Report", publisher: "Verizon", family: "threat", licence: "registration", use: "Incident patterns and breach statistics", url: "https://www.verizon.com/business/resources/reports/dbir/", cadence: "Annual" },
  { id: "mtrends", name: "Mandiant M-Trends", publisher: "Mandiant, Google Cloud", family: "threat", licence: "registration", use: "Attacker dwell time and intrusion trends", url: "https://cloud.google.com/security/resources/m-trends", cadence: "Annual" },

  /* ── Cloud and platform baselines ── */
  { id: "csa-ccm", name: "CSA Cloud Controls Matrix v4", publisher: "Cloud Security Alliance", family: "cloud", licence: "open", use: "Cloud control objectives and shared responsibility", url: "https://cloudsecurityalliance.org/research/cloud-controls-matrix", cadence: "Periodic" },
  { id: "mcsb", name: "Microsoft Cloud Security Benchmark", publisher: "Microsoft", family: "cloud", licence: "open", use: "Azure control baselines mapped to CIS and NIST", url: "https://learn.microsoft.com/en-us/security/benchmark/azure/overview", cadence: "Continuous" },
  { id: "aws-war", name: "AWS Well-Architected, Security Pillar", publisher: "Amazon Web Services", family: "cloud", licence: "open", use: "Design principles and questions for AWS estates", url: "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/security.html", cadence: "Continuous" },
  { id: "gcp-foundations", name: "Google Cloud security foundations", publisher: "Google Cloud", family: "cloud", licence: "open", use: "Landing-zone and control guidance for GCP", url: "https://cloud.google.com/architecture/security-foundations", cadence: "Continuous" },

  /* ── Identity ── */
  { id: "nist-800-63", name: "NIST SP 800-63 Digital Identity Guidelines", publisher: "NIST", family: "identity", licence: "open", use: "Assurance levels for identity, authentication and federation", url: "https://pages.nist.gov/800-63-4/sp800-63.html", cadence: "Major revisions" },

  /* ── Regulation and privacy ── */
  { id: "gdpr", name: "General Data Protection Regulation", publisher: "European Union", family: "regulation", licence: "open", use: "Lawful basis, rights and breach obligations", url: "https://publications.europa.eu/resource/celex/32016R0679", cadence: "On amendment" },
  { id: "dpdp", name: "Digital Personal Data Protection Act 2023", publisher: "Government of India", family: "regulation", licence: "open", use: "Indian data protection obligations and consent", url: "https://www.meity.gov.in/data-protection-framework", cadence: "On amendment" },
  { id: "dora", name: "Digital Operational Resilience Act", publisher: "European Union", family: "regulation", licence: "open", use: "ICT risk, incident reporting and third-party oversight", url: "https://publications.europa.eu/resource/celex/32022R2554", cadence: "On amendment" },
  { id: "nis2", name: "NIS2 Directive", publisher: "European Union", family: "regulation", licence: "open", use: "Sectoral security and reporting duties", url: "https://publications.europa.eu/resource/celex/32022L2555", cadence: "On amendment" },
  { id: "pci-dss", name: "PCI DSS v4.0", publisher: "PCI Security Standards Council", family: "regulation", licence: "registration", use: "Cardholder data environment requirements", url: "https://www.pcisecuritystandards.org/standards/pci-dss/", cadence: "Major revisions" },
  { id: "hipaa", name: "HIPAA Security Rule", publisher: "US Department of Health and Human Services", family: "regulation", licence: "open", use: "Safeguards for protected health information", url: "https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C", cadence: "On amendment" },
  { id: "rbi-csf", name: "RBI Cyber Security Framework", publisher: "Reserve Bank of India", family: "regulation", licence: "open", use: "Controls and reporting for Indian banks", url: "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=10435", cadence: "On circular" },
  { id: "sebi-cscrf", name: "SEBI Cybersecurity and Cyber Resilience Framework", publisher: "SEBI", family: "regulation", licence: "open", use: "Obligations for Indian regulated entities", url: "https://www.sebi.gov.in/legal/circulars/aug-2024/cybersecurity-and-cyber-resilience-framework-cscrf-for-sebi-regulated-entities-res_85964.html", cadence: "On circular" },
  { id: "mas-trm", name: "MAS Technology Risk Management Guidelines", publisher: "Monetary Authority of Singapore", family: "regulation", licence: "open", use: "Technology risk expectations for financial institutions", url: "https://www.mas.gov.sg/regulation/guidelines/technology-risk-management-guidelines", cadence: "Periodic" },

  /* ── Market and analyst research ── */
  { id: "gartner", name: "Gartner research", publisher: "Gartner", family: "market", licence: "licensed", use: "Market definitions and vendor positioning, cited by reference", url: "https://www.gartner.com", cadence: "Continuous" },
  { id: "forrester", name: "Forrester research", publisher: "Forrester", family: "market", licence: "licensed", use: "Wave evaluations and practitioner surveys, cited by reference", url: "https://www.forrester.com", cadence: "Continuous" },
  { id: "idc", name: "IDC research", publisher: "IDC", family: "market", licence: "licensed", use: "Market sizing and spending forecasts, cited by reference", url: "https://www.idc.com", cadence: "Continuous" },
];

export const SOURCES: Source[] = [...INTERNAL_PLACEHOLDERS, ...EXTERNAL];

export const LICENCE_NOTE: Record<Licence, string> = {
  open: "Redistributable. Held in the index and quoted in full.",
  registration: "Free but account-bound. Held only where the client's licence covers it.",
  licensed: "Paid or restricted. Cited by reference; no text is stored.",
};

export const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));

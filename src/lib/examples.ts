export type Example = {
  id: 'legal' | 'sales' | 'healthcare';
  label: string;
  spec: string;
};

export const EXAMPLES: Example[] = [
  {
    id: 'legal',
    label: 'Legal',
    spec: 'AI reads a signed contract PDF and extracts all obligation clauses — payment terms, delivery deadlines, termination notice windows, auto-renewal triggers, SLA commitments. Output: structured table with clause text, obligation type, responsible party, due date, page/section reference.',
  },
  {
    id: 'sales',
    label: 'Sales',
    spec: "AI drafts a personalized cold email to a B2B prospect. Input: prospect's LinkedIn profile and company website. Email must reference one specific detail from their profile, be under 150 words, include one relevant case study, and avoid unverifiable claims about the prospect's company.",
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    spec: "AI reads a physician's clinical note and flags missing elements required for CPT/ICD-10 billing compliance. Must identify: missing diagnosis codes, insufficient time documentation, absent medical necessity justification, procedures mentioned but not coded.",
  },
];

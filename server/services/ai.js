const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const EDUCATION_KEYWORDS = [
  { level: 'PhD', patterns: [/\bph\.?\s?d\b/i, /\bdoctorate\b/i] },
  { level: 'Masters', patterns: [/\bm\.?tech\b/i, /\bm\.?e\b/i, /\bm\.?s\b/i, /\bmba\b/i, /\bmasters?\b/i, /\bpost[- ]?graduate\b/i] },
  { level: 'Bachelors', patterns: [/\bb\.?tech\b/i, /\bb\.?e\b/i, /\bb\.?sc\b/i, /\bbca\b/i, /\bbcom\b/i, /\bbba\b/i, /\bbachelors?\b/i, /\bgraduate\b/i] },
  { level: 'Diploma', patterns: [/\bdiploma\b/i, /\bpolytechnic\b/i, /\biti\b/i] },
  { level: '12th', patterns: [/\b12th\b/i, /\bhigher secondary\b/i, /\bintermediate\b/i] },
  { level: '10th', patterns: [/\b10th\b/i, /\bssc\b/i, /\bsecondary school\b/i] },
];
const DOMAIN_HINTS = [
  { label: 'solar cell manufacturing', patterns: [/\bsolar cell\b/i, /\bphotovoltaic cell\b/i, /\bcell line\b/i] },
  { label: 'solar module manufacturing', patterns: [/\bsolar module\b/i, /\bmodule line\b/i, /\blamination\b/i, /\bstringer\b/i] },
  { label: 'production operations', patterns: [/\bproduction\b/i, /\bshift\b/i, /\bline\b/i, /\bthroughput\b/i] },
  { label: 'process engineering', patterns: [/\bprocess\b/i, /\byield\b/i, /\bcycle time\b/i, /\bspc\b/i, /\broot cause\b/i] },
  { label: 'quality assurance', patterns: [/\bquality\b/i, /\bcapa\b/i, /\b8d\b/i, /\bfmea\b/i, /\bppap\b/i] },
  { label: 'maintenance engineering', patterns: [/\bmaintenance\b/i, /\bpreventive\b/i, /\bbreakdown\b/i, /\bplc\b/i, /\bautomation\b/i] },
  { label: 'supply chain and planning', patterns: [/\bsupply chain\b/i, /\bprocurement\b/i, /\bplanning\b/i, /\bwarehouse\b/i, /\blogistics\b/i] },
  { label: 'EHS and compliance', patterns: [/\behs\b/i, /\bsafety\b/i, /\biosh\b/i, /\bincident\b/i, /\biso 14001\b/i] },
];
const SKILL_KEYWORDS = [
  'Solar cell manufacturing',
  'Solar module manufacturing',
  'Photovoltaics',
  'Production planning',
  'Production operations',
  'Process engineering',
  'Yield improvement',
  'Quality assurance',
  'CAPA',
  'RCA',
  '8D',
  'FMEA',
  'PPAP',
  'SPC',
  'Lean manufacturing',
  'Six Sigma',
  '5S',
  'Kaizen',
  'TPM',
  'SAP',
  'MES',
  'ERP',
  'PLC',
  'SCADA',
  'Automation',
  'Maintenance',
  'Preventive maintenance',
  'Supply chain',
  'Procurement',
  'Warehouse operations',
  'EHS',
  'ISO 9001',
  'ISO 14001',
  'OHSAS',
  'Team handling',
  'Shift operations',
  'Project management',
  'Electrical engineering',
  'Mechanical engineering',
  'Electronics',
  'Semiconductor manufacturing',
];
let hasLoggedOllamaFallback = false;
let lastOllamaError = null;

async function queryOllama(prompt, options = {}) {
  try {
    const model = process.env.OLLAMA_MODEL || OLLAMA_MODEL;
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 2000, ...options },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status}`);
    }
    const data = await res.json();
    return data.response;
  } catch (err) {
    lastOllamaError = err?.message || 'Unable to reach Ollama';
    if (!hasLoggedOllamaFallback) {
      hasLoggedOllamaFallback = true;
      console.warn(`Ollama unavailable at ${OLLAMA_BASE_URL}; using built-in fallback content.`);
    }
    return null;
  }
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  const numeric = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!numeric) return null;
  const parsed = Number(numeric[0]);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function normalizeGender(value) {
  const normalized = normalizeNullableString(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('male') && !normalized.includes('female')) return 'Male';
  if (normalized.includes('female')) return 'Female';
  if (normalized.includes('other') || normalized.includes('non-binary') || normalized.includes('nonbinary')) return 'Other';
  if (normalized.includes('prefer')) return 'Prefer not to say';
  return null;
}

function normalizePhone(value) {
  const raw = normalizeNullableString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return raw;
}

function normalizeBooleanOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', 'willing', 'open'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'not willing', 'not open'].includes(normalized)) return false;
  return null;
}

function normalizeEducationLevel(level, educationOther = null) {
  const normalized = normalizeNullableString(level);
  if (!normalized) return { education_level: null, education_other: normalizeNullableString(educationOther) };
  const lowered = normalized.toLowerCase();
  if (lowered.includes('phd') || lowered.includes('doctorate')) {
    return { education_level: 'PhD', education_other: normalizeNullableString(educationOther) || normalized };
  }
  if (lowered.includes('master') || lowered.includes('mba') || lowered.includes('m.tech') || lowered.includes('mtech') || lowered.includes('m.e') || lowered === 'ms' || lowered.includes('post graduate')) {
    return { education_level: 'Masters', education_other: normalizeNullableString(educationOther) || normalized };
  }
  if (lowered.includes('bachelor') || lowered.includes('b.tech') || lowered.includes('btech') || lowered.includes('b.e') || lowered === 'be' || lowered.includes('graduate')) {
    return { education_level: 'Bachelors', education_other: normalizeNullableString(educationOther) || normalized };
  }
  if (lowered.includes('diploma') || lowered.includes('polytechnic') || lowered.includes('iti')) {
    return { education_level: 'Diploma', education_other: normalizeNullableString(educationOther) || normalized };
  }
  if (lowered.includes('12th') || lowered.includes('higher secondary') || lowered.includes('intermediate')) {
    return { education_level: '12th', education_other: normalizeNullableString(educationOther) || normalized };
  }
  if (lowered.includes('10th') || lowered.includes('ssc') || lowered.includes('secondary')) {
    return { education_level: '10th', education_other: normalizeNullableString(educationOther) || normalized };
  }
  return {
    education_level: 'Other',
    education_other: normalizeNullableString(educationOther) || normalized,
  };
}

function normalizeSkills(skills) {
  const incoming = Array.isArray(skills)
    ? skills
    : normalizeNullableString(skills)?.split(/[,|/]\s*/g) || [];
  const seen = new Set();
  const normalized = [];
  for (const skill of incoming) {
    const value = normalizeNullableString(skill);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized.slice(0, 20);
}

function extractBalancedJson(text) {
  const source = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const startCandidates = ['{', '[']
    .map((char) => ({ char, index: source.indexOf(char) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index);

  for (const candidate of startCandidates) {
    const open = candidate.char;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = candidate.index; i < source.length; i += 1) {
      const current = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (current === '\\') {
          escaped = true;
        } else if (current === '"') {
          inString = false;
        }
        continue;
      }

      if (current === '"') {
        inString = true;
        continue;
      }
      if (current === open) depth += 1;
      if (current === close) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(candidate.index, i + 1);
        }
      }
    }
  }

  return null;
}

function parseJsonResponse(text, fallback) {
  const payload = extractBalancedJson(text);
  if (!payload) return fallback;
  try {
    return JSON.parse(payload);
  } catch {
    return fallback;
  }
}

function extractLabelValue(text, labels) {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n|]{2,120})`, 'i');
    const match = text.match(regex);
    if (match?.[1]) return normalizeNullableString(match[1]);
  }
  return null;
}

function extractName(text) {
  const lines = normalizeWhitespace(text).split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length < 3 || line.length > 60) continue;
    if (/@|https?:|www\.|\d{5,}/i.test(line)) continue;
    if (/^(resume|curriculum vitae|cv|profile|contact|email|mobile|phone|address)$/i.test(line)) continue;
    if (!/^[A-Za-z .'-]+$/.test(line)) continue;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 5) {
      return line;
    }
  }
  return null;
}

function extractHeadlineRole(text) {
  const lines = normalizeWhitespace(text).split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(1, 8)) {
    if (line.length < 3 || line.length > 80) continue;
    if (/@|https?:|www\.|\d{5,}/i.test(line)) continue;
    if (/^(email|mobile|phone|address|location|skills|experience|education|summary)$/i.test(line)) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    return line;
  }
  return null;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractPhone(text) {
  const matches = text.match(/(?:\+91[-\s]?)?(?:0[-\s]?)?[6-9]\d(?:[-\s]?\d){8}/g) || [];
  for (const match of matches) {
    const normalized = normalizePhone(match);
    if (normalized) return normalized;
  }
  return null;
}

function extractPan(text) {
  const match = text.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractAadhar(text) {
  const match = text.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, '') : null;
}

function extractYearsOfExperience(text) {
  const patterns = [
    /(?:total|overall|relevant)\s+experience[^0-9]{0,20}(\d{1,2}(?:\.\d+)?)/i,
    /experience[^0-9]{0,15}(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/i,
    /\b(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\s+of\s+experience\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 45) {
        return Number(value.toFixed(1));
      }
    }
  }

  const allMatches = Array.from(text.matchAll(/\b(\d{1,2}(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/gi))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 45);
  if (allMatches.length > 0) {
    return Math.max(...allMatches);
  }
  return null;
}

function extractCurrentCtc(text) {
  const labeled = text.match(/(?:current\s+ctc|ctc|current\s+compensation)[^\n\d]{0,20}(\d+(?:\.\d+)?)\s*(lpa|lakhs?|lac|lacs|crore|cr)?/i);
  if (labeled?.[1]) {
    const amount = Number(labeled[1]);
    const unit = labeled[2]?.toLowerCase() || null;
    if (unit?.includes('cr') || unit?.includes('crore')) return Number((amount * 100).toFixed(2));
    if (unit?.includes('l')) return Number(amount.toFixed(2));
    if (amount >= 100000) return Number((amount / 100000).toFixed(2));
    return Number(amount.toFixed(2));
  }
  return null;
}

function extractLocation(text) {
  return extractLabelValue(text, ['current location', 'location', 'present location', 'address']);
}

function extractCurrentOrganization(text) {
  return extractLabelValue(text, ['current company', 'current organization', 'current organisation', 'employer', 'company']);
}

function extractCurrentDesignation(text) {
  return extractLabelValue(text, ['current designation', 'designation', 'current role', 'role', 'title'])
    || extractHeadlineRole(text);
}

function extractGender(text) {
  const labeled = extractLabelValue(text, ['gender', 'sex']);
  return normalizeGender(labeled);
}

function extractRelocationFlag(text) {
  if (/\b(willing|open)\s+to\s+relocat/i.test(text)) return true;
  if (/\bnot\s+willing\s+to\s+relocat/i.test(text)) return false;
  return null;
}

function extractEducationLevel(text) {
  for (const candidate of EDUCATION_KEYWORDS) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) {
      return candidate.level;
    }
  }
  return null;
}

function extractSkills(text) {
  const lowerText = text.toLowerCase();
  const collected = [];
  for (const keyword of SKILL_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      collected.push(keyword);
    }
  }

  const sectionMatch = text.match(/(?:technical\s+skills|skills|key skills|competencies)\s*[:\-]?\s*([\s\S]{0,500})/i);
  if (sectionMatch?.[1]) {
    const sectionSlice = sectionMatch[1]
      .split(/\n{2,}/)[0]
      .split(/(?:experience|education|projects|certifications|pan|aadhaar|aadhar|email|mobile|phone|location|willing)/i)[0];
    const sectionSkills = sectionSlice
      .split(/[,|\n•\-]+/)
      .map((item) => normalizeNullableString(item))
      .filter((item) => item && item.length <= 40 && !/:/.test(item));
    collected.push(...sectionSkills);
  }

  return normalizeSkills(collected);
}

function inferDomainExperience(text) {
  const matches = DOMAIN_HINTS
    .filter((hint) => hint.patterns.some((pattern) => pattern.test(text)))
    .map((hint) => hint.label);
  return normalizeSkills(matches);
}

function buildHeuristicResume(text) {
  return {
    candidate_name: extractName(text),
    candidate_email: extractEmail(text),
    candidate_phone: extractPhone(text),
    candidate_age: normalizeNumber(extractLabelValue(text, ['age'])),
    candidate_gender: extractGender(text),
    candidate_years_of_experience: extractYearsOfExperience(text),
    current_organization: extractCurrentOrganization(text),
    current_designation: extractCurrentDesignation(text),
    current_ctc: extractCurrentCtc(text),
    current_location: extractLocation(text),
    willing_to_relocate_flag: extractRelocationFlag(text),
    education_level: extractEducationLevel(text),
    education_other: extractLabelValue(text, ['highest qualification', 'education', 'qualification']),
    candidate_aadhar: extractAadhar(text),
    candidate_pan: extractPan(text),
    skills: extractSkills(text),
    inferred_domain_experience: inferDomainExperience(text),
  };
}

function buildFallbackResumeSummary(parsed) {
  const fragments = [];
  if (parsed.current_designation) {
    fragments.push(`${parsed.current_designation}`);
  } else if (parsed.current_organization) {
    fragments.push('Experienced professional');
  } else {
    fragments.push('Candidate profile');
  }
  if (parsed.candidate_years_of_experience !== null) {
    fragments.push(`with ${parsed.candidate_years_of_experience} years of experience`);
  }
  if (parsed.current_organization) {
    fragments.push(`currently associated with ${parsed.current_organization}`);
  }
  if (parsed.current_location) {
    fragments.push(`based in ${parsed.current_location}`);
  }

  const domainLine = parsed.inferred_domain_experience?.length
    ? `Exposure includes ${parsed.inferred_domain_experience.slice(0, 3).join(', ')}.`
    : '';
  const skillsLine = parsed.skills?.length
    ? `Core skills include ${parsed.skills.slice(0, 6).join(', ')}.`
    : '';

  return normalizeWhitespace(`${fragments.join(' ')}. ${domainLine} ${skillsLine}`) || null;
}

function mergeResumeData(aiParsed, heuristics) {
  const education = normalizeEducationLevel(
    aiParsed.education_level ?? heuristics.education_level,
    aiParsed.education_other ?? heuristics.education_other
  );

  const merged = {
    candidate_name: normalizeNullableString(heuristics.candidate_name || aiParsed.candidate_name),
    candidate_email: normalizeNullableString(heuristics.candidate_email || aiParsed.candidate_email)?.toLowerCase() || null,
    candidate_phone: normalizePhone(heuristics.candidate_phone || aiParsed.candidate_phone),
    candidate_age: normalizeNumber(aiParsed.candidate_age ?? heuristics.candidate_age),
    candidate_gender: normalizeGender(aiParsed.candidate_gender ?? heuristics.candidate_gender),
    candidate_years_of_experience: normalizeNumber(
      aiParsed.candidate_years_of_experience ?? heuristics.candidate_years_of_experience
    ),
    current_organization: normalizeNullableString(aiParsed.current_organization || heuristics.current_organization),
    current_designation: normalizeNullableString(aiParsed.current_designation || heuristics.current_designation),
    current_ctc: normalizeNumber(aiParsed.current_ctc ?? heuristics.current_ctc),
    current_location: normalizeNullableString(aiParsed.current_location || heuristics.current_location),
    willing_to_relocate_flag: normalizeBooleanOrNull(
      aiParsed.willing_to_relocate_flag ?? heuristics.willing_to_relocate_flag
    ),
    education_level: education.education_level,
    education_other: education.education_other,
    candidate_aadhar: normalizeNullableString(heuristics.candidate_aadhar || aiParsed.candidate_aadhar),
    candidate_pan: normalizeNullableString(heuristics.candidate_pan || aiParsed.candidate_pan)?.toUpperCase() || null,
    skills: normalizeSkills([...(heuristics.skills || []), ...(aiParsed.skills || [])]),
    inferred_domain_experience: normalizeSkills([
      ...(heuristics.inferred_domain_experience || []),
      ...(aiParsed.inferred_domain_experience || []),
    ]),
    resume_summary: normalizeNullableString(aiParsed.resume_summary),
  };

  if (!merged.resume_summary) {
    merged.resume_summary = buildFallbackResumeSummary(merged);
  }

  const coreFields = [
    merged.candidate_name,
    merged.candidate_email,
    merged.candidate_phone,
    merged.candidate_years_of_experience,
    merged.current_organization,
    merged.current_location,
    merged.education_level,
  ];
  const completeness = coreFields.filter((value) => value !== null && value !== '').length;
  merged.parse_quality = completeness >= 6 ? 'high' : completeness >= 4 ? 'medium' : 'low';
  merged.missing_fields = [
    ['candidate_name', merged.candidate_name],
    ['candidate_email', merged.candidate_email],
    ['candidate_phone', merged.candidate_phone],
    ['candidate_years_of_experience', merged.candidate_years_of_experience],
    ['current_organization', merged.current_organization],
    ['current_location', merged.current_location],
    ['education_level', merged.education_level],
  ]
    .filter(([, value]) => value === null || value === '')
    .map(([field]) => field);

  return merged;
}

function buildResumePrompt(text, heuristics) {
  return `You are an expert resume parser for Premier Energies, a solar cell and solar module manufacturer.

Task
- Read the resume text and extract candidate data with high precision.
- Prefer explicit evidence from the resume.
- Infer only when the evidence is very strong.
- Return ONLY valid JSON with no markdown or commentary.
- Use null for unknown scalar fields and [] for unknown arrays.
- candidate_years_of_experience and current_ctc must be numbers when present.
- willing_to_relocate_flag must be true, false, or null.
- Keep skills specific and useful for recruiting.
- Make the resume_summary concise, factual, and suitable for recruiter screening.

JSON schema
{
  "candidate_name": "string or null",
  "candidate_email": "string or null",
  "candidate_phone": "string or null",
  "candidate_age": "number or null",
  "candidate_gender": "Male | Female | Other | Prefer not to say | null",
  "candidate_years_of_experience": "number or null",
  "current_organization": "string or null",
  "current_designation": "string or null",
  "current_ctc": "number or null",
  "current_location": "string or null",
  "willing_to_relocate_flag": "boolean or null",
  "education_level": "10th | 12th | Diploma | Bachelors | Masters | PhD | Other | null",
  "education_other": "string or null",
  "candidate_aadhar": "string or null",
  "candidate_pan": "string or null",
  "skills": ["skill1", "skill2"],
  "resume_summary": "2-4 sentence recruiter summary",
  "inferred_domain_experience": ["solar module manufacturing", "quality assurance"]
}

Deterministic hints from pre-parsing
${JSON.stringify(heuristics, null, 2)}

Resume text
${text.slice(0, 14000)}`;
}

export async function parseResume(text) {
  const normalizedText = normalizeWhitespace(text);
  if (!normalizedText) return null;

  const heuristics = buildHeuristicResume(normalizedText);
  const prompt = buildResumePrompt(normalizedText, heuristics);
  const response = await queryOllama(prompt, { temperature: 0.1, num_predict: 2600 });
  const aiParsed = response ? parseJsonResponse(response, {}) : {};
  return mergeResumeData(aiParsed || {}, heuristics);
}

function buildFallbackJobDescription({ designation, department, subDepartment, jdTemplate, additionalContext }) {
  const functionHint = subDepartment || department;
  const templateSection = jdTemplate
    ? `Template Reference\n${jdTemplate}\n\n`
    : '';
  const contextSection = additionalContext
    ? `Additional Context\n${additionalContext}\n\n`
    : '';

  return `${templateSection}${contextSection}Role Summary
Premier Energies is hiring a ${designation} for the ${functionHint} team to support safe, high-volume solar cell and module manufacturing. The role is responsible for delivering output, maintaining process discipline, and improving yield, quality, and traceability across production operations.

Key Responsibilities
- Drive daily execution for the ${functionHint.toLowerCase()} function while meeting production, quality, and safety targets.
- Monitor process adherence, line performance, downtime, and rework drivers across solar manufacturing operations.
- Coordinate with maintenance, quality, planning, warehouse, and EHS teams to keep the line production-ready.
- Support yield improvement, defect reduction, root cause analysis, and corrective-action closure.
- Maintain production logs, shift handovers, and material traceability required for audited manufacturing environments.
- Escalate bottlenecks quickly and support stable ramp-up of output without compromising workmanship standards.

Required Qualifications
- Diploma or degree in electrical, electronics, mechanical, industrial, or production engineering.
- Experience relevant to ${department.toLowerCase()} operations in a structured manufacturing setup.
- Working knowledge of SOP compliance, process checks, and shift-level coordination.

Preferred Skills
- Exposure to solar cell, solar module, electronics, semiconductor, or high-volume discrete manufacturing.
- Familiarity with lean manufacturing, 5S, CAPA, and continuous improvement practices.
- Ability to work with cross-functional teams in a target-driven plant environment.

Why Join Premier Energies
- Opportunity to contribute to India-focused renewable energy manufacturing at scale.
- Work on operational excellence across solar cell and module production lines.
- Strong exposure to process improvement, quality systems, and plant transformation initiatives.`;
}

export async function generateJobDescription({
  designation,
  department,
  subDepartment = null,
  jdTemplate = null,
  additionalContext = null,
}) {
  const prompt = `Write a job description for Premier Energies, a solar cell and solar module manufacturer.

Role
- Designation: ${designation}
- Department: ${department}
- Sub-department: ${subDepartment || 'Not specified'}

Instructions
- Keep the content specific to solar manufacturing, plant operations, quality, process engineering, supply chain, EHS, or related industrial contexts as appropriate to the role.
- Return plain text only, not HTML.
- Use these sections exactly: Role Summary, Key Responsibilities, Required Qualifications, Preferred Skills, Why Join Premier Energies.
- Keep the tone enterprise-grade, practical, and relevant for an Indian manufacturing organization.
${jdTemplate ? `- Use this designation template as guidance where helpful:\n${jdTemplate}\n` : ''}
${additionalContext ? `- Blend in this optional additional context:\n${additionalContext}\n` : ''}`;

  const response = await queryOllama(prompt, { num_predict: 2200 });
  return response || buildFallbackJobDescription({ designation, department, subDepartment, jdTemplate, additionalContext });
}

function buildFallbackAnalyticsAnswer(question, snapshot) {
  const headline = snapshot?.headline || {};
  const funnel = Array.isArray(snapshot?.funnel) ? snapshot.funnel : [];
  const recruiterMomentum = Array.isArray(snapshot?.recruiter_momentum) ? snapshot.recruiter_momentum : [];
  const sourceMix = Array.isArray(snapshot?.source_mix) ? snapshot.source_mix : [];
  const topFunnel = funnel.slice().sort((left, right) => Number(right.count || 0) - Number(left.count || 0))[0];
  const topRecruiter = recruiterMomentum[0];
  const topSource = sourceMix[0];

  return {
    answer: normalizeWhitespace(
      `For "${question}", the current ATS snapshot shows ${headline.active_candidates || 0} active candidates, ${headline.offers_in_flight || 0} candidates in offer-stage flow, and ${headline.joined_candidates || 0} joined candidates. ${
        topFunnel ? `The largest funnel bucket is ${topFunnel.stage} with ${topFunnel.count} candidates.` : ''
      } ${
        topRecruiter ? `${topRecruiter.recruiter} is the current top recruiter by closures.` : ''
      } ${
        topSource ? `${topSource.source} is the strongest visible sourcing channel.` : ''
      }`
    ),
    key_findings: [
      `${headline.open_jobs || 0} open jobs and ${headline.open_requisitions || 0} open requisitions are currently in motion.`,
      topFunnel ? `${topFunnel.stage} is the heaviest stage right now with ${topFunnel.count} candidates.` : 'Funnel distribution is currently limited.',
      topRecruiter ? `${topRecruiter.recruiter} has ${topRecruiter.closures || 0} closures and ${topRecruiter.offers || 0} offers in the visible dataset.` : 'Recruiter closure data is limited right now.',
    ].filter(Boolean),
    suggested_follow_ups: [
      'Which department has the slowest time to fill right now?',
      'Which sourcing channel is converting best into offers?',
      'Show me the recruiter workload versus closures trend.',
    ],
    confidence_note: 'Fallback analytics response generated because Ollama was unavailable.',
  };
}

export async function answerAnalyticsQuestion({ question, snapshot, history = [] }) {
  const trimmedQuestion = normalizeNullableString(question);
  if (!trimmedQuestion) {
    return {
      answer: 'Ask a question about hiring trends, recruiter performance, applicant flow, or sourcing quality.',
      key_findings: [],
      suggested_follow_ups: [
        'What are the biggest bottlenecks in our hiring funnel?',
        'Which recruiter has the strongest closure rate?',
        'Which business unit has the most open demand?',
      ],
      confidence_note: null,
    };
  }

  const prompt = `You are the analytics copilot for Premier Energies ATS.

Rules
- Answer ONLY from the provided ATS snapshot.
- Do not invent fields, metrics, or events.
- If the data is insufficient, say so clearly.
- Prefer concise, high-signal operational insights for recruiters, HR admins, and HODs.
- Mention relevant counts, trends, or segments when available.
- Return ONLY valid JSON.

JSON schema
{
  "answer": "short paragraph",
  "key_findings": ["finding 1", "finding 2", "finding 3"],
  "suggested_follow_ups": ["question 1", "question 2", "question 3"],
  "confidence_note": "string or null"
}

Conversation history
${JSON.stringify(history.slice(-6), null, 2)}

ATS snapshot
${JSON.stringify(snapshot, null, 2).slice(0, 18000)}

User question
${trimmedQuestion}`;

  const response = await queryOllama(prompt, { temperature: 0.15, num_predict: 1800 });
  if (!response) return buildFallbackAnalyticsAnswer(trimmedQuestion, snapshot);

  const parsed = parseJsonResponse(response, null);
  if (!parsed || typeof parsed !== 'object') {
    return buildFallbackAnalyticsAnswer(trimmedQuestion, snapshot);
  }

  return {
    answer: normalizeNullableString(parsed.answer) || buildFallbackAnalyticsAnswer(trimmedQuestion, snapshot).answer,
    key_findings: Array.isArray(parsed.key_findings)
      ? parsed.key_findings.map((item) => normalizeNullableString(item)).filter(Boolean).slice(0, 6)
      : [],
    suggested_follow_ups: Array.isArray(parsed.suggested_follow_ups)
      ? parsed.suggested_follow_ups.map((item) => normalizeNullableString(item)).filter(Boolean).slice(0, 6)
      : [],
    confidence_note: normalizeNullableString(parsed.confidence_note),
  };
}

function buildEmailDraftFallback({ purpose, prompt, context = {}, recipients = [] }) {
  const audience = recipients.length ? recipients.join(', ') : 'the intended recipients';
  const subjectPrefix = {
    reminder: 'Premier Energies ATS Reminder',
    interview: 'Premier Energies Interview Update',
    documents: 'Premier Energies Document Action Required',
    approval: 'Premier Energies Approval Update',
  }[String(purpose || '').toLowerCase()] || 'Premier Energies ATS Update';

  const roleLabel = context.role || context.job_title || context.document_name || context.candidate_name || 'the current workflow item';
  const promptLine = normalizeNullableString(prompt) || `Please review the latest update regarding ${roleLabel}.`;

  return {
    subject: `${subjectPrefix}: ${roleLabel}`,
    html_body: `
      <p style="margin:0 0 14px;color:#475569;line-height:1.7;">Hello,</p>
      <p style="margin:0 0 14px;color:#475569;line-height:1.7;">${promptLine}</p>
      <div style="margin:18px 0;border:1px solid #dbeafe;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);padding:18px 20px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#1d4ed8;">Context</p>
        <p style="margin:0;color:#1e293b;line-height:1.7;">
          Candidate: <strong>${context.candidate_name || 'Not specified'}</strong><br />
          Job / Role: <strong>${context.job_title || context.role || 'Not specified'}</strong><br />
          Requested by: <strong>${context.requested_by || context.recruiter_email || 'Premier Energies ATS'}</strong>
        </p>
      </div>
      <p style="margin:0 0 14px;color:#475569;line-height:1.7;">Recipients in scope: ${audience}.</p>
      <p style="margin:0;color:#475569;line-height:1.7;">Please use the ATS link or the next agreed channel to complete the pending action.</p>
    `,
    preview: promptLine,
  };
}

export async function generateEmailDraft({ purpose, prompt, context = {}, recipients = [] }) {
  const fallback = buildEmailDraftFallback({ purpose, prompt, context, recipients });
  const groundedContext = JSON.stringify({
    purpose,
    prompt,
    recipients,
    context,
  }, null, 2);

  const response = await queryOllama(`
You write concise, premium, enterprise-grade HTML emails for Premier Energies ATS.
The company is a solar cell and solar module manufacturer. Use a professional, polished, action-oriented tone.
Draft a JSON object with keys: subject, html_body, preview.
Requirements:
- The email must be specific to the provided workflow context.
- The html_body should contain only the inner HTML content, not a full HTML document.
- Keep the body rich but concise.
- Use short sections, highlight the required action, and sound clear and credible.
- Do not include markdown.
- Mention Premier Energies where appropriate.
- If the context is incomplete, still produce a useful draft.

Context:
${groundedContext}
  `, { temperature: 0.35, num_predict: 1400 });

  if (!response) return fallback;

  try {
    const parsed = JSON.parse(extractBalancedJson(response));
    return {
      subject: normalizeNullableString(parsed?.subject) || fallback.subject,
      html_body: normalizeNullableString(parsed?.html_body) || fallback.html_body,
      preview: normalizeNullableString(parsed?.preview) || fallback.preview,
    };
  } catch {
    return fallback;
  }
}

export async function matchCandidateToJobs(candidateText, jobDescriptions) {
  const prompt = `Given this candidate's resume summary and the list of open jobs, rank the top 5 best matching jobs by relevance. Return ONLY a JSON array of objects with job_id and match_score (0-100) and brief reason.

Candidate: ${candidateText.substring(0, 2000)}

Jobs:
${jobDescriptions.map((job) => `ID: ${job.job_id}, Title: ${job.job_title}, Dept: ${job.department}, Exp: ${job.experience_years}yrs`).join('\n')}

Return ONLY valid JSON array.`;

  const response = await queryOllama(prompt);
  if (!response) return [];
  const parsed = parseJsonResponse(response, []);
  return Array.isArray(parsed) ? parsed : [];
}

export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getAiServiceStatus() {
  const available = await isOllamaAvailable();
  return {
    provider: 'ollama',
    base_url: OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL || OLLAMA_MODEL,
    available,
    fallback_active: !available,
    last_error: available ? null : lastOllamaError || 'Ollama is unreachable from the server process.',
  };
}

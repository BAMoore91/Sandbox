/**
 * AAMVA DL/ID Card Design Standard Parser
 * Supports AAMVA versions 1–10 (the majority of US/Canada driver's licenses).
 *
 * Reference: https://www.aamva.org/DL-ID-Card-Design-Standard
 *
 * A PDF417 barcode from a US driver's license encodes an ASCII string that
 * starts with '@\n\x1e\rANSI ' followed by jurisdiction + version info and
 * then a series of subfiles. Each data element is identified by a 3-character
 * code (e.g., "DAA", "DBB") followed by its value and terminated by '\n'.
 */

export interface AAMVAData {
  // Identifiers
  dlNumber: string;
  dlState: string;
  dlCountry: string;
  documentDiscriminator?: string;
  inventoryControl?: string;

  // Name
  lastName: string;
  firstName: string;
  middleName?: string;
  nameSuffix?: string;

  // Dates (ISO yyyy-MM-dd)
  dateOfBirth: string;
  expirationDate?: string;
  issueDate?: string;

  // Address
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;

  // Physical descriptors
  sex?: 'M' | 'F' | 'U';
  height?: string;
  weight?: string;
  eyeColor?: string;
  hairColor?: string;

  // Computed
  age: number;
  isExpired: boolean;
  isOfAge: boolean;   // 21+
}

export interface ParseResult {
  success: boolean;
  data?: AAMVAData;
  error?: string;
}

// ─── Field code → property mapping ──────────────────────────────────────────

/** AAMVA element IDs from the DL subfile */
const FIELD_MAP: Record<string, string> = {
  DAA: 'fullName',
  DAB: 'lastNameLegacy',
  DAC: 'firstName',
  DAD: 'middleName',
  DCS: 'lastName',
  DCT: 'firstNameAlt',
  DAE: 'nameSuffix',
  DCU: 'nameSuffix',
  DAF: 'namePrefix',
  DAG: 'street1',
  DAH: 'street2',
  DAI: 'city',
  DAJ: 'state',
  DAK: 'postalCode',
  DCG: 'country',
  DAQ: 'dlNumber',
  DAR: 'licenseClass',
  DAS: 'restrictions',
  DAT: 'endorsements',
  DAU: 'height',
  DAV: 'weightRange',
  DAW: 'weight',
  DAX: 'weightKg',
  DAY: 'eyeColor',
  DAZ: 'hairColor',
  DBA: 'expirationDate',
  DBB: 'dateOfBirth',
  DBC: 'sex',
  DBD: 'issueDate',
  DBE: 'issueTimestamp',
  DBF: 'numberOfDuplicates',
  DBG: 'medicalIndicatorCodes',
  DBH: 'organDonor',
  DBI: 'nonResident',
  DBJ: 'uniqueCustomerId',
  DBK: 'socialSecurityNumber', // rarely included; treat as sensitive
  DBL: 'dateOfBirth',   // alternate field in some states
  DCB: 'restrictions',
  DCD: 'endorsements',
  DCE: 'weightRange',
  DCF: 'documentDiscriminator',
  DCK: 'inventoryControl',
  DCL: 'raceEthnicity',
  DCM: 'standardVehicleClass',
  DCN: 'standardEndorsementCode',
  DCO: 'standardRestrictionCode',
  DCP: 'jurisdictionVehicleClassDesc',
  DCQ: 'jurisdictionEndorsementCodeDesc',
  DCR: 'jurisdictionRestrictionCodeDesc',
  DDA: 'complianceType',
  DDB: 'cardRevisionDate',
  DDC: 'hazmatExpiryDate',
  DDD: 'limitedDurationIndicator',
  DDE: 'familyNameTruncation',
  DDF: 'firstNameTruncation',
  DDG: 'middleNameTruncation',
  DDH: 'under18Until',
  DDI: 'under19Until',
  DDJ: 'under21Until',
  DDK: 'organDonorIndicator',
  DDL: 'veteran',
};

// ─── Date parsing ─────────────────────────────────────────────────────────────

/**
 * Parse an AAMVA date field which can be in:
 *  - MMDDYYYY  (most common in the US)
 *  - YYYYMMDD  (Canada and some newer formats)
 *
 * Returns ISO "yyyy-MM-dd" or null.
 */
function parseAAMVADate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\D/g, '');
  if (s.length !== 8) return null;

  let month: string, day: string, year: string;

  // YYYYMMDD if first 4 digits look like a year (1900–2099)
  const y4 = parseInt(s.slice(0, 4), 10);
  if (y4 >= 1900 && y4 <= 2099) {
    year = s.slice(0, 4);
    month = s.slice(4, 6);
    day = s.slice(6, 8);
  } else {
    // MMDDYYYY
    month = s.slice(0, 2);
    day = s.slice(2, 4);
    year = s.slice(4, 8);
  }

  const m = parseInt(month, 10);
  const d = parseInt(day, 10);
  const yr = parseInt(year, 10);
  if (m < 1 || m > 12 || d < 1 || d > 31 || yr < 1900) return null;

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function calcAge(dobISO: string): number {
  const dob = new Date(dobISO);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function isExpiredDate(expirationISO: string | undefined): boolean {
  if (!expirationISO) return false;
  return new Date(expirationISO) < new Date();
}

// ─── Name parsing ─────────────────────────────────────────────────────────────

/**
 * Some states encode the full name in DAA as "LAST,FIRST MIDDLE" or
 * "LAST$FIRST$MIDDLE".  Split accordingly.
 */
function splitFullName(fullName: string): {
  lastName: string;
  firstName: string;
  middleName?: string;
} {
  // Try comma separator first  "SMITH,JOHN ROBERT"
  if (fullName.includes(',')) {
    const [last, rest] = fullName.split(',', 2);
    const parts = rest.trim().split(/\s+/);
    return {
      lastName: last.trim(),
      firstName: parts[0] ?? '',
      middleName: parts.slice(1).join(' ') || undefined,
    };
  }
  // Try $ separator  "SMITH$JOHN$ROBERT"
  if (fullName.includes('$')) {
    const parts = fullName.split('$');
    return {
      lastName: parts[0] ?? '',
      firstName: parts[1] ?? '',
      middleName: parts[2] || undefined,
    };
  }
  // Fallback – treat everything as last name
  return { lastName: fullName, firstName: '' };
}

// ─── Subfile / field extraction ───────────────────────────────────────────────

function extractFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Split on newlines; each line is like "DAA  SMITH,JOHN" or "DBA01012025"
  const lines = raw.split(/[\r\n]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;
    const code = trimmed.slice(0, 3);
    const value = trimmed.slice(3).trim();
    if (/^[A-Z]{3}$/.test(code) && value) {
      fields[code] = value;
    }
  }
  return fields;
}

function extractIssuerIdFromHeader(raw: string): string {
  // The ANSI header: "@\n\x1e\rANSI 636014040002DL..."
  // IIN (Issuer Identification Number) is the 6 digits after "ANSI "
  const match = raw.match(/ANSI\s+(\d{6})/);
  return match ? match[1] : '';
}

const IIN_TO_STATE: Record<string, string> = {
  '636000': 'AA', '636001': 'AL', '636002': 'AK', '636003': 'AS',
  '636004': 'AZ', '636005': 'AR', '636006': 'CA', '636007': 'CO',
  '636008': 'CT', '636009': 'DC', '636010': 'DE', '636011': 'FL',
  '636012': 'GU', '636013': 'GA', '636014': 'HI', '636015': 'ID',
  '636016': 'IL', '636017': 'IN', '636018': 'IA', '636019': 'KS',
  '636020': 'KY', '636021': 'LA', '636022': 'ME', '636023': 'MD',
  '636024': 'MA', '636025': 'MI', '636026': 'MN', '636027': 'MS',
  '636028': 'MO', '636029': 'MT', '636030': 'NE', '636031': 'NV',
  '636032': 'NH', '636033': 'NJ', '636034': 'NM', '636035': 'NY',
  '636036': 'NC', '636037': 'ND', '636038': 'OH', '636039': 'OK',
  '636040': 'OR', '636041': 'PA', '636042': 'PR', '636043': 'RI',
  '636044': 'SC', '636045': 'SD', '636046': 'TN', '636047': 'TX',
  '636048': 'UT', '636049': 'VT', '636050': 'VI', '636051': 'VA',
  '636052': 'WA', '636053': 'WV', '636054': 'WI', '636055': 'WY',
  '636056': 'MP', '636057': 'FM', '636058': 'MH', '636059': 'PW',
  // Canada
  '604426': 'AB', '604427': 'BC', '604428': 'MB', '604429': 'NB',
  '604430': 'NL', '604431': 'NS', '604432': 'ON', '604433': 'PE',
  '604434': 'QC', '604435': 'SK', '604436': 'NT', '604437': 'NU',
  '604438': 'YT',
};

// ─── Public parse function ────────────────────────────────────────────────────

export function parseAAMVA(raw: string): ParseResult {
  if (!raw || typeof raw !== 'string') {
    return { success: false, error: 'Empty or invalid input' };
  }

  // Validate AAMVA header
  if (!raw.includes('@') || !raw.toUpperCase().includes('ANSI')) {
    return { success: false, error: 'Not a valid AAMVA PDF417 barcode' };
  }

  const fields = extractFields(raw);
  const iin = extractIssuerIdFromHeader(raw);

  // Extract license number
  const dlNumber = fields['DAQ'] || '';
  if (!dlNumber) {
    return { success: false, error: 'Could not read license number' };
  }

  // Determine issuing state: prefer DAJ (address state) or derive from IIN
  const dlState =
    fields['DAJ'] || IIN_TO_STATE[iin] || fields['DCG'] || 'UNK';

  const dlCountry = fields['DCG'] || (iin.startsWith('604') ? 'CAN' : 'USA');

  // Date of birth
  const rawDob = fields['DBB'] || fields['DBL'] || '';
  const dateOfBirth = parseAAMVADate(rawDob);
  if (!dateOfBirth) {
    return { success: false, error: 'Could not parse date of birth' };
  }

  const expirationDate = parseAAMVADate(fields['DBA'] || '') ?? undefined;
  const issueDate = parseAAMVADate(fields['DBD'] || '') ?? undefined;

  // Name – prefer explicit DCS/DAC over combined DAA
  let lastName: string;
  let firstName: string;
  let middleName: string | undefined;
  let nameSuffix: string | undefined;

  if (fields['DCS'] || fields['DAC']) {
    lastName = (fields['DCS'] || fields['DAB'] || '').trim();
    firstName = (fields['DAC'] || fields['DCT'] || '').trim();
    middleName = (fields['DAD'] || '').trim() || undefined;
    nameSuffix = (fields['DCU'] || fields['DAE'] || '').trim() || undefined;
  } else if (fields['DAA']) {
    const parsed = splitFullName(fields['DAA']);
    lastName = parsed.lastName;
    firstName = parsed.firstName;
    middleName = parsed.middleName;
  } else {
    return { success: false, error: 'Could not parse name fields' };
  }

  // Sex
  const sexCode = fields['DBC'];
  const sex: AAMVAData['sex'] =
    sexCode === '1' ? 'M' : sexCode === '2' ? 'F' : 'U';

  const age = calcAge(dateOfBirth);

  return {
    success: true,
    data: {
      dlNumber,
      dlState,
      dlCountry,
      documentDiscriminator: fields['DCF'] || undefined,
      inventoryControl: fields['DCK'] || undefined,

      lastName,
      firstName,
      middleName,
      nameSuffix,

      dateOfBirth,
      expirationDate,
      issueDate,

      street1: fields['DAG'] || undefined,
      street2: fields['DAH'] || undefined,
      city: fields['DAI'] || undefined,
      state: fields['DAJ'] || undefined,
      postalCode: (fields['DAK'] || '').slice(0, 5) || undefined,
      country: dlCountry,

      sex,
      height: fields['DAU'] || undefined,
      weight: fields['DAW'] || undefined,
      eyeColor: fields['DAY'] || undefined,
      hairColor: fields['DAZ'] || undefined,

      age,
      isExpired: isExpiredDate(expirationDate),
      isOfAge: age >= 21,
    },
  };
}

/** Redact sensitive fields before storing / logging */
export function redactForStorage(data: AAMVAData): Partial<AAMVAData> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { street1, street2, city, postalCode, documentDiscriminator, inventoryControl, ...safe } =
    data;
  return safe;
}

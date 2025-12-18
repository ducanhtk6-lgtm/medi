// services/comparatorGuard.ts

interface RepairReport {
  repairedText: string;
  repairs: Array<{ label: string; count: number }>;
  unknownPUA: Array<{ char: string; code: string; count: number; samples: string[] }>;
}

/**
 * Sửa chữa các ký tự Private Use Area (PUA) bị lỗi trong quá trình trích xuất PDF.
 * Chỉ sửa trong ngữ cảnh so sánh số để tránh lỗi thứ phát.
 * @param text Văn bản thô từ PDF.js.
 * @returns Một đối tượng chứa văn bản đã sửa và báo cáo chi tiết.
 */
export const repairPdfExtractionArtifacts = (text: string): RepairReport => {
  if (!text) return { repairedText: '', repairs: [], unknownPUA: [] };

  let repairedText = text;
  const repairs: Array<{ label: string; count: number }> = [];

  const repairMap: { [key: string]: { char: string; replacement: string; label: string } } = {
    // FEV1 thay đổi > 12% ->  12%
    greaterThan: { char: '\uE098', replacement: '>', label: '>' },
    // Eosinophil >= 4% ->  4%
    greaterOrEqual: { char: '\uE09A', replacement: '>=', label: '>=' },
    // Không <= 2 lần/tuần ->   2 lần/tuần
    lessOrEqualPair: { char: '\uE081\\s*\\uE099', replacement: '<=', label: '<=' },
  };
  
  for (const key in repairMap) {
    const { char, replacement, label } = repairMap[key];
    const regex = new RegExp(char + '(?=\\s*[-+]?\\d)', 'g');
    let count = 0;
    repairedText = repairedText.replace(regex, () => {
      count++;
      return replacement;
    });
    if (count > 0) {
      repairs.push({ label, count });
    }
  }

  // Find any remaining unknown PUA characters
  const unknownPUAMap = new Map<string, { code: string; count: number; samples: string[] }>();
  const puaRegex = /[\uE000-\uF8FF]/g;
  let match;
  while ((match = puaRegex.exec(repairedText)) !== null) {
    const char = match[0];
    const code = `U+${char.charCodeAt(0).toString(16).toUpperCase()}`;
    
    if (!unknownPUAMap.has(char)) {
      unknownPUAMap.set(char, { code, count: 0, samples: [] });
    }
    
    const entry = unknownPUAMap.get(char)!;
    entry.count++;
    
    if (entry.samples.length < 5) { // Collect up to 5 samples
      const contextStart = Math.max(0, match.index - 20);
      const contextEnd = Math.min(repairedText.length, match.index + 21);
      const sample = repairedText.substring(contextStart, contextEnd).replace(/\n/g, ' ');
      entry.samples.push(sample);
    }
  }

  const unknownPUA = Array.from(unknownPUAMap.entries()).map(([char, data]) => ({ char, ...data }));
  
  // Final spacing normalization around comparators
  repairedText = repairedText
    .replace(/\s*(>=|<=|>|<)\s*/g, ' $1 ');

  return { repairedText: repairedText.trim(), repairs, unknownPUA };
};


/**
 * Chuẩn hóa các biến thể của dấu so sánh về dạng ASCII tiêu chuẩn, và "chữa" các dạng hỏng.
 * - Hợp nhất các biến thể có khoảng trắng: "> =" -> ">="
 * - Chuẩn hóa Unicode: "≥" -> ">="
 * - Chữa lỗi OCR/LLM: ">/" -> ">=", "</" -> "<=" (chỉ khi theo sau là số)
 * @param text Văn bản đầu vào.
 * @returns Văn bản đã được chuẩn hóa.
 */
export const normalizeComparators = (text: string): string => {
  if (!text) return '';
  return text
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/>\s*=/g, '>=')
    .replace(/<\s*=/g, '<=')
    // Heal corrupted comparators only when followed by a digit to avoid touching HTML tags
    .replace(/>\s*[\/∕／]\s*(?=\d)/g, '>=')
    .replace(/<\s*[\/∕／]\s*(?=\d)/g, '<=');
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Khóa các dấu so sánh trong văn bản bằng các token duy nhất, an toàn với LLM.
 * Trả về văn bản đã khóa, một hàm để mở khóa và danh sách các token đã tạo.
 * @param text Văn bản đã được chuẩn hóa.
 * @returns Một đối tượng chứa lockedText, hàm unlock, và danh sách tokens.
 */
export const lockComparators = (text: string): { lockedText: string; unlock: (s: string) => string; tokens: string[] } => {
  if (!text) return { lockedText: '', unlock: s => s, tokens: [] };

  const replacements = new Map<string, string>();
  let counter = 0;

  const pad = (num: number) => num.toString().padStart(4, '0');

  // Ưu tiên cao: khóa ">=" và "<=" trước, trên toàn cục.
  let lockedText = text.replace(/(>=|<=)/g, (match) => {
    counter++;
    const type = match === '>=' ? 'GE' : 'LE';
    const token = `@@CMP_${type}_${pad(counter)}@@`;
    replacements.set(token, match);
    return token;
  });

  // Ưu tiên thấp: khóa ">" và "<" chỉ trong ngữ cảnh so sánh với số.
  // Regex: tìm một ký tự không phải chữ/số/./%/@ (hoặc đầu dòng), khoảng trắng, toán tử, khoảng trắng, và một chữ số.
  lockedText = lockedText.replace(/(^|[^A-Za-z0-9@.%])(\s*)(>|<)(\s*)(?=[0-9])/gm, (_, prefix, ws1, operator, ws2) => {
    counter++;
    const type = operator === '>' ? 'GT' : 'LT';
    const token = `@@CMP_${type}_${pad(counter)}@@`;
    replacements.set(token, operator);
    return `${prefix}${ws1}${token}${ws2}`;
  });
  
  const tokens = Array.from(replacements.keys());

  const unlock = (s: string): string => {
    if (!s) return '';
    let unlocked = s;
    // Sắp xếp token theo độ dài giảm dần để tránh thay thế token con (ít khả năng xảy ra nhưng an toàn hơn)
    const sortedTokens = Array.from(replacements.keys()).sort((a, b) => b.length - a.length);
    for (const token of sortedTokens) {
        const original = replacements.get(token)!;
        // Dùng regex global để thay thế mọi lần xuất hiện
        unlocked = unlocked.replace(new RegExp(escapeRegExp(token), 'g'), original);
    }
    return unlocked;
  };

  return { lockedText, unlock, tokens };
};

/**
 * Xác minh rằng tất cả các token đã khóa đều có mặt trong văn bản đầu ra từ AI.
 * @param output Văn bản từ Gemini.
 * @param tokens Danh sách các token đã được tạo ra lúc khóa.
 * @returns Một đối tượng cho biết kết quả và danh sách các token bị thiếu.
 */
export const verifyAllTokensPresent = (output: string, tokens: string[]): { ok: boolean; missing: string[] } => {
  if (tokens.length === 0) return { ok: true, missing: [] };
  const missing = tokens.filter(token => !output.includes(token));
  return { ok: missing.length === 0, missing };
};

/**
 * Ghi lại một dòng audit về số lượng các dấu so sánh.
 * @param label Nhãn cho dòng audit (ví dụ: 'PDF_RAW').
 * @param text Văn bản cần phân tích.
 * @returns Một chuỗi audit.
 */
export const comparatorAuditLine = (label: string, text: string) => {
     const raw = text || '';
     const counts = {
       ge: (raw.match(/>=/g) || []).length,
       le: (raw.match(/<=/g) || []).length,
       gteU: (raw.match(/≥/g) || []).length,
       lteU: (raw.match(/≤/g) || []).length,
       gt: (raw.match(/>/g) || []).length - (raw.match(/>=/g) || []).length,
       lt: (raw.match(/</g) || []).length - (raw.match(/<=/g) || []).length,
       corruptG: (raw.match(/>\s*[\/∕／]\s*(?=\d)/g) || []).length,
       corruptL: (raw.match(/<\s*[\/∕／]\s*(?=\d)/g) || []).length,
       htmlLike: (raw.match(/<\/?[A-Za-z][^>]*>/g) || []).length
     };
     return `[ComparatorAudit:${label}] >=:${counts.ge} <=:${counts.le} ≥:${counts.gteU} ≤:${counts.lteU} >:${counts.gt} <:${counts.lt} >/:${counts.corruptG} </:${counts.corruptL} htmlTags:${counts.htmlLike}`;
   };

/**
 * Chuyển đổi các dấu so sánh sang định dạng Unicode để hiển thị và chữa lỗi.
 * @param text Văn bản đầu vào.
 * @returns Văn bản đã được định dạng.
 */
export const formatComparatorsForOutput = (text: string | undefined): string => {
    if (!text) return '';
    return text
      // First, heal corrupted forms, ensuring a space for readability
      .replace(/>\s*[\/∕／]\s*(?=\d)/g, '≥ ')
      .replace(/<\s*[\/∕／]\s*(?=\d)/g, '≤ ')
      // Then, handle standard forms
      .replace(/>\s*=/g, '≥')
      .replace(/<\s*=/g, '≤')
      // (optional safety) handle if it was already HTML-entitized
      .replace(/&gt;\s*=/g, '≥')
      .replace(/&lt;\s*=/g, '≤');
};

/**
 * Escape HTML special characters to prevent them from being interpreted as tags.
 * @param s The string to escape.
 * @returns The escaped string.
 */
export const escapeHtml = (s: string): string => {
    if (!s) return '';
    return s
     .replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');
};

// --- Verification V2 for Subset Semantics (Cloze Generation Step) ---

const TOKEN_REGEX = /@@CMP_(?:GE|LE|GT|LT)_[0-9]{4}@@/g;
const SUSPICIOUS_FRAGMENT_REGEX = /@?@CMP_[A-Z0-9_]{1,10}@?@/g;

/**
 * Trích xuất tất cả các token comparator có định dạng đúng từ một chuỗi.
 * @param output Chuỗi đầu ra từ AI.
 * @returns Một mảng các token duy nhất được tìm thấy.
 */
export const extractComparatorTokens = (output: string): string[] => {
  if (!output) return [];
  const matches = output.match(TOKEN_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
};

/**
 * Xác minh các token comparator trong output theo ngữ nghĩa "tập con".
 * Chỉ báo lỗi nếu có token không xác định hoặc token bị hỏng.
 * @param output Chuỗi đầu ra từ AI.
 * @param expectedTokens Một Set chứa tất cả các token hợp lệ được tạo từ input.
 * @returns Một đối tượng chứa kết quả xác minh.
 */
export const verifyComparatorTokensSubset = (output: string, expectedTokens: Set<string>): { ok: boolean; usedTokens: string[]; unknownTokens: string[]; suspiciousFragments: string[] } => {
    const usedTokens = extractComparatorTokens(output);
    const unknownTokens = usedTokens.filter(t => !expectedTokens.has(t));

    const allFragments = output.match(SUSPICIOUS_FRAGMENT_REGEX) || [];
    const suspiciousFragments = allFragments.filter(f => !/@@CMP_(?:GE|LE|GT|LT)_[0-9]{4}@@/.test(f));
    
    const ok = unknownTokens.length === 0 && suspiciousFragments.length === 0;

    return { ok, usedTokens, unknownTokens, suspiciousFragments };
};

/**
 * "Cứu" các chuỗi giống token bị hỏng bằng cách chuyển chúng thành comparator ASCII.
 * Đây là một cơ chế an toàn để ngăn chặn token rác hiển thị ra UI.
 * @param output Chuỗi đầu ra từ AI, có thể chứa token hỏng.
 * @returns Một đối tượng chứa văn bản đã được "cứu" và số lượng thay thế.
 */
export const salvageComparatorTokenLike = (output: string): { text: string; replaced: number } => {
    if (!output || !output.includes('CMP_')) return { text: output, replaced: 0 };
    
    let replaced = 0;
    const salvager = (match: string): string => {
        replaced++;
        if (match.includes('GE')) return '>=';
        if (match.includes('LE')) return '<=';
        if (match.includes('GT')) return '>';
        if (match.includes('LT')) return '<';
        return ''; // Should not happen with the regex
    };
    
    // Regex này rộng, tìm bất cứ thứ gì trông giống một phần của token.
    const text = output.replace(/@?@CMP_(GE|LE|GT|LT)[A-Z0-9_]*@?@/g, salvager);

    return { text, replaced };
};

/**
 * Chuẩn hóa các biến thể của token comparator (ví dụ: có thêm khoảng trắng, dùng ký tự full-width)
 * về dạng canonical `@@CMP_TYPE_DDDD@@` mà không thay đổi ý nghĩa của chúng.
 * @param text Chuỗi có thể chứa token bị biến dạng.
 * @returns Một đối tượng chứa chuỗi đã được chuẩn hóa và số lượng thay đổi đã thực hiện.
 */
export const canonicalizeComparatorTokens = (text: string): { text: string; changed: number } => {
    if (!text) return { text: '', changed: 0 };

    let changed = 0;
    let canonicalText = text;

    // Bước 1: Đổi full-width @ sang standard @
    const originalText = canonicalText;
    canonicalText = canonicalText.replace(/＠/g, '@');
    if (canonicalText !== originalText) changed++;

    // Bước 2: Bỏ các ký tự zero-width space
    const textBeforeZWSP = canonicalText;
    canonicalText = canonicalText.replace(/[\u200B-\u200D\uFEFF]/g, '');
    if (canonicalText !== textBeforeZWSP) changed++;

    // Bước 3: Canonicalize cấu trúc token bằng regex
    const regex = /@+\s*CMP[\s_]*?(GE|LE|GT|LT)[\s_]*?(\d{4})\s*@+/g;
    let matches = 0;
    canonicalText = canonicalText.replace(regex, (match, type, digits) => {
        matches++;
        const canonicalToken = `@@CMP_${type}_${digits}@@`;
        if (match !== canonicalToken) {
            changed++;
        }
        return canonicalToken;
    });

    return { text: canonicalText, changed };
};

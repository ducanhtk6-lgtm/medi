import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { lockComparators, verifyAllTokensPresent, normalizeComparators, comparatorAuditLine, formatComparatorsForOutput, verifyComparatorTokensSubset, salvageComparatorTokenLike, canonicalizeComparatorTokens } from './comparatorGuard';
import type { FlashcardData, Specialty, GenerationResult, CleaningResult, RelatedContextItem, EssayGraderResult, ConversationTurn, ModelConfig, ModelName, ClozeType } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({apiKey: API_KEY});

// Define comprehensive safety settings to allow medical content
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const comparatorTokenInstruction = `
####<Ràng buộc về Token Dấu So Sánh>
- VĂN BẢN ĐẦU VÀO CÓ THỂ CHỨA CÁC TOKEN DẠNG \`@@CMP_*_####@@\`.
- ĐÂY LÀ CÁC DẤU SO SÁNH (>, <, >=, <=) ĐÃ ĐƯỢC "KHÓA" CÓ CHỦ ĐÍCH.
- **YÊU CẦU TUYỆT ĐỐI:** BẠN PHẢI GIỮ NGUYÊN Y HỆT CÁC TOKEN NÀY. KHÔNG ĐƯỢỢC THAY ĐỔI, XÓA, THÊM KHOẢNG TRẮNG, HAY CHUYỂN ĐỔI CHÚNG. Chúng phải xuất hiện y hệt trong đầu ra của bạn.
####`;

const relatedContextSchema = {
    type: Type.OBJECT,
    properties: {
        quote: {
            type: Type.STRING,
            description: "Trích dẫn NGUYÊN VĂN 100% đoạn văn bản liên quan."
        },
        category: {
            type: Type.STRING,
            description: "Phân loại của đoạn trích dẫn liên quan này, theo cùng quy tắc với 'questionCategory'."
        }
    },
    required: ["quote", "category"]
};


const flashcardSchema = {
    type: Type.OBJECT,
    properties: {
        cardId: {
            type: Type.STRING,
            description: "Một ID chuỗi duy nhất và ngắn gọn cho thẻ này (ví dụ: 'card_01'). ID phải là duy nhất trong toàn bộ phản hồi. Bắt buộc cho chuyên khoa Nhi."
        },
        parentId: {
            type: Type.STRING,
            description: "ID của thẻ cha trực tiếp trong cấu trúc phân cấp mindmap. Nếu đây là thẻ gốc cấp cao nhất, giá trị phải là null. Bắt buộc cho chuyên khoa Nhi."
        },
        clozeText: {
            type: Type.STRING,
            description: "Câu hoàn chỉnh chứa một hoặc nhiều từ khoá đã được ẩn đi theo định dạng Anki cloze. Định dạng BẮT BUỘC là `{{c1::answer::hint}}`."
        },
        originalQuote: {
            type: Type.STRING,
            description: "ĐOẠN TRÍCH CHÍNH (CORE_EXCERPT): Trích dẫn NGUYÊN VĂN 100% không chỉ đoạn văn bản cốt lõi chứa câu trả lời mà cả các ý xung quanh có liên quan chặt chẽ để giữ bối cảnh. Phần đáp án phải được **in đậm** bằng Markdown."
        },
        relatedContext: {
            type: Type.ARRAY,
            items: relatedContextSchema,
            description: "NGỮ CẢNH LIÊN QUAN (RELATED_EXCERPTS): Một mảng chứa 1-3 đối tượng, mỗi đối tượng gồm đoạn trích NGUYÊN VĂN 100% và phân loại của nó."
        },
        sourceHeading: {
            type: Type.STRING,
            description: "Đề mục cụ thể của phần kiến thức này, được người dùng cung cấp."
        },
        sourceLesson: {
            type: Type.STRING,
            description: "Tên bài học hoặc nguồn tài liệu, được người dùng cung cấp."
        },
        questionCategory: {
            type: Type.STRING,
            description: "Phân loại câu hỏi. Ví dụ: 'Số liệu', 'Chẩn đoán', 'Điều trị', 'Biến chứng', 'Phòng ngừa', 'Sinh lý bệnh', hoặc đề mục nhỏ cụ thể nếu có yêu cầu."
        },
        extraInfo: {
            type: Type.STRING,
            description: "Thông tin bổ sung để củng cố kiến thức, hiển thị ở mặt sau thẻ. Có thể bao gồm giải thích sâu hơn, chẩn đoán phân biệt, hoặc mẹo ghi nhớ."
        }
    },
    required: ["clozeText", "originalQuote", "sourceHeading", "sourceLesson", "questionCategory"]
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        flashcards: {
            type: Type.ARRAY,
            items: flashcardSchema
        },
        report: {
            type: Type.STRING,
            description: "Một báo cáo văn bản chi tiết từ Bước 6, tóm tắt các nội dung đã bỏ qua và xác minh tính chính xác của các thẻ được tạo."
        }
    },
    required: ["flashcards", "report"]
};

const cleaningResponseSchema = {
    type: Type.OBJECT,
    properties: {
        cleanedText: {
            type: Type.STRING,
            description: "Toàn bộ văn bản đã được tái cấu trúc bằng Markdown."
        },
        tableOfContents: {
            type: Type.STRING,
            description: "Mục lục của bài học được tạo từ các tiêu đề (##, ###, ####), định dạng bằng Markdown."
        }
    },
    required: ["cleanedText", "tableOfContents"]
}

const essayGraderResponseSchema = {
    type: Type.OBJECT,
    properties: {
        gradingReport: {
            type: Type.STRING,
            description: "Báo cáo chi tiết về việc chấm điểm bài làm của học viên, bao gồm so sánh, điểm số và gợi ý. Sử dụng Markdown (gạch đầu dòng, in đậm) để định dạng."
        },
        srsRating: {
            type: Type.NUMBER,
            description: "Một con số từ 0 đến 3 đại diện cho đánh giá Spaced Repetition (0: quên sạch, 1: nhớ mơ hồ, 2: nhớ được, 3: nhớ chắc)."
        }
    },
    required: ["gradingReport", "srsRating"]
}

// Helper to clean JSON string from markdown code blocks or preambles
const cleanJsonString = (text: string): string => {
    if (!text) return "";
    let cleaned = text.trim();
    
    // Attempt to extract JSON object by finding the outer-most braces.
    // This makes the parser robust against "Here is the JSON:" preambles.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1);
    }

    // Fallback: Remove wrapping markdown code blocks if standard extraction fails
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return cleaned.trim();
};

export const cleanAndRestructureText = async (rawText: string, modelName: ModelName, thinkMore: boolean): Promise<CleaningResult> => {
    if (!rawText || rawText.trim() === '') {
        throw new Error("Văn bản đầu vào trống. Vui lòng cung cấp nội dung.");
    }
    
    const normalizedInput = normalizeComparators(rawText);
    const { lockedText, unlock, tokens } = lockComparators(normalizedInput);

    const prompt = `
####<VAI TRÒ VÀ MỤC TIÊU>
Bạn là một "Document & Knowledge Structuring Engine" chạy trong Google AI Studio (Gemini). Nhiệm vụ của bạn là thực hiện hai việc theo trình tự:
1. Đọc văn bản thô, vốn có thể bị lỗi định dạng do trích xuất từ file PDF/Word, và khôi phục nó thành một văn bản có cấu trúc rõ ràng, mạch lạc bằng Markdown.
2. Dựa trên văn bản đã cấu trúc, tạo ra một mục lục (Table of Contents) ở định dạng Markdown.

**Đầu ra cuối cùng của bạn BẮT BUỘC phải là một đối tượng JSON hợp lệ.**

${comparatorTokenInstruction}
---
**NGỮ CẢNH DỮ LIỆU**
- Văn bản có thể được trích từ PDF/Word có thể qua OCR nên thường:
  - Ngắt dòng giữa câu mà không có dấu chấm 
  - Số thứ tự/heading bị xuống dòng kỳ lạ
  - Kí tự bullet như "-", "•", "*", "+", "·", "→"…
  - Mã/biểu thức/kí hiệu đặc biệt (toán học, y khoa, công thức…)
  - Các cột/bảng bị “dàn” ngang thành text thường
  - Văn bản đầu vào là tài liệu **Y KHOA CHUYÊN NGÀNH**.
    - Nó chứa các thuật ngữ về giải phẫu, sinh lý, bệnh học, bộ phận sinh dục, máu, phẫu thuật, v.v.
    - **TUYỆT ĐỐI KHÔNG ĐƯỢC KIỂM DUYỆT (CENSOR)** hoặc từ chối xử lý các nội dung này vì lý do "nhạy cảm
- Bạn phải cố gắng:
  - GIỮ NGUYÊN thứ tự ý và nội dung
  - KHÔNG tự ý tóm tắt hay bỏ bớt thông tin
  - KHÔNG bịa thêm kiến thức không có trong tài liệu
  - Không dùng kiến thức ngoài tài liệu để “chữa cháy” cho chỗ không rõ

---
**QUY TRÌNH THỰC HIỆN**

**BƯỚC 1: KHÔI PHỤC CẤU TRÚC (ÁP DỤNG LẦN LƯỢT)**

1.  **Ghép dòng thành câu/đoạn:**
    -   Nếu dòng trên KHÔNG kết thúc bằng dấu câu (. ? ! … :) VÀ dòng dưới bắt đầu bằng chữ thường hoặc rõ ràng là phần tiếp nối của câu trước ⇒ GHÉP lại thành một dòng/đoạn duy nhất.
    -   Nếu có dấu kết câu rõ ràng ở cuối dòng trên, hoặc dòng dưới trông như tiêu đề/mục/bullet mới ⇒ GIỮ nguyên ngắt dòng.
    -   Mục tiêu: loại bỏ gãy dòng kỹ thuật, giữ ranh giới ý nghĩa.

2.  **Bảo toàn mã LaTeX:**
    -   Nhận diện các khối mã LaTeX được bao quanh bởi \`$ ... $\` (inline), \`$$ ... $$\` (display), \`\\( ... \\)\` (inline), và \`\\[ ... \\]\` (display).
    -   XEM các khối này là một đơn vị không thể tách rời. KHÔNG được thay đổi nội dung bên trong chúng.
    -   Khi ghép dòng, nếu một ngắt dòng nằm giữa một khối LaTeX, hãy loại bỏ nó để nối lại khối đó. VÍ DỤ: \`$E = mc\` và dòng tiếp theo là \`^2$\` phải được ghép lại thành \`$E = mc^2$\`.
    -   Đảm bảo mã LaTeX được giữ nguyên trong văn bản cuối cùng.

3.  **Nhận diện và chuẩn hóa tiêu đề (dùng Markdown):**
    -   Xem là TIÊU ĐỀ nếu dòng có các đặc điểm: Toàn chữ HOA, bắt đầu bằng "I.", "1.", "A.", "Chương", "Phần", v.v.
    -   Ánh xạ sang Markdown: Cấp cao nhất dùng \`#\`, cấp tiếp theo dùng \`##\`, rồi \`###\`, \`####\`. Ưu tiên \`##\` cho mục, \`###\` cho tiểu mục.
    -   KHÔNG tự tạo thêm tiêu đề mới nếu tài liệu gốc không gợi ý rõ ràng.

4.  **Nhận diện danh sách (list) (dùng Markdown):**
    -   Nếu dòng bắt đầu bằng "-", "•", "*", "1)", "a)"… ⇒ Chuyển thành danh sách Markdown: \`- nội dung\`.
    -   Nếu là mức danh sách con (thụt vào) ⇒ Dùng: \`  - mục con\`.
    -   GIỮ nguyên thứ tự các mục như bản gốc.

5.  **Nhận diện và Tái cấu trúc Bảng (dùng Markdown):**
    -   Tìm kiếm các vùng văn bản có dấu hiệu của một bảng bị "làm phẳng" (flattened), ví dụ: các dòng có cùng số lượng cột từ, các cột được phân tách bằng nhiều dấu cách, hoặc có các dòng tiêu đề.
    -   Nếu xác định được một bảng, hãy tái cấu trúc nó về đúng định dạng bảng của Markdown.
    -   Ví dụ:
        | Tiêu đề 1 | Tiêu đề 2 |
        |---|---|
        | Dòng 1, Cột 1 | Dòng 1, Cột 2 |
    -   Hãy cẩn trọng: chỉ tái cấu trúc thành bảng khi bạn rất chắc chắn. Nếu không, hãy giữ nguyên dưới dạng văn bản có cấu trúc.

6.  **Không được thay đổi nội dung khoa học:**
    -   KHÔNG sửa: các con số, thuật ngữ chuyên môn, tên bệnh, tên thuốc, công thức.
    -   CHỈ ĐƯỢỢC: Ghép/tách dòng, thêm dấu câu hiển nhiên bị thiếu, chuẩn hóa trình bày.
    
7.  **BẢO TOÀN DẤU TOÁN HỌC (QUAN TRỌNG):**
    - **CẢNH BÁO:** AI thường mắc lỗi nghiêm trọng là tự ý sửa dấu so sánh. Đây là sai sót y khoa không thể chấp nhận.
    - **QUY TẮC ĐỐI XỨNG (BẮT BUỘC):**
        - Nếu input chứa \`>=\` (hoặc các biến thể như \`≥\`, \`> =\`), output BẮT BUỘC phải là \`>=\`. **KHÔNG** được tự ý bỏ dấu "=".
        - Nếu input chỉ chứa \`>\`, output BẮT BUỘC phải là \`>\`. **KHÔNG** được tự ý thêm dấu "=".
        - Tương tự cho \`<=\` và \`<\`.
        - Luôn ưu tiên dùng ký tự ASCII (\`>=\`, \`<=\`, \`>\`, \`<\`) trong output để đảm bảo tính tương thích.


**BƯỚC 2: TẠO MỤC LỤC TỪ VĂN BẢN ĐÃ CẤU TRÚC**
Sau khi đã có văn bản sạch ở Bước 1, hãy đọc lại nó và trích xuất tất cả các dòng tiêu đề (bắt đầu bằng \`##\`, \`###\`, \`####\`) để tạo ra một mục lục.
-   Định dạng mục lục bằng Markdown list.
-   Thụt đầu dòng cho các tiểu mục để thể hiện cấu trúc phân cấp.
    -   \`## Tiêu đề cấp 1\` -> \`- Tiêu đề cấp 1\`
    -   \`### Tiêu đề cấp 2\` -> \`  - Tiêu đề cấp 2\`
    -   \`#### Tiêu đề cấp 3\` -> \`    - Tiêu đề cấp 3\`
-   Mục lục phải phản ánh đúng cấu trúc và thứ tự của các tiêu đề trong văn bản.
-   **YÊU CẦU BỔ SUNG:** Mục lục phải thấy rõ đâu là các phần lớn của bài học y khoa như: **Định nghĩa / Sinh lý bệnh / Dịch tễ / Lâm sàng / Cận lâm sàng / Điều trị / Tiên lượng** (nếu bài có). Bạn có thể làm nổi bật chúng bằng cách thêm **dấu sao** hoặc viết hoa.

---
**VĂN BẢN THÔ CẦN XỬ LÝ:**
\`\`\`
${lockedText}
\`\`\`
`;
    
    let lastVerificationError: { missing: string[], unknown: string[], suspicious: string[] } | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            let currentPrompt = prompt;
            const config: any = {
                temperature: 0.1,
                responseMimeType: "application/json",
                responseSchema: cleaningResponseSchema,
            };

            if (thinkMore && (modelName === 'gemini-3-pro-preview' || modelName === 'gemini-2.5-pro')) {
                 config.thinkingConfig = { thinkingBudget: 32768 };
            }

            if (attempt === 2 && lastVerificationError) {
                config.temperature = 0;
                const missingTokensSample = lastVerificationError.missing.slice(0, 5).join(', ');
                const failsafePrompt = `
####<FAILSAFE TOKEN INSTRUCTIONS - ATTEMPT 2>
**CẢNH BÁO:** Lần gọi trước đã thất bại trong việc bảo toàn các token dấu so sánh. Lần này, bạn phải tuân thủ TUYỆT ĐỐI các quy tắc sau:
1.  **BẢO TOÀN TOÀN BỘ VĂN BẢN:** \`cleanedText\` phải chứa 100% nội dung gốc từ đầu vào, chỉ được phép sửa đổi định dạng Markdown.
2.  **BẢO TOÀN TẤT CẢ TOKEN:** Mọi token dạng \`@@CMP_*_####@@\` trong input PHẢI xuất hiện y hệt trong \`cleanedText\` của output JSON.
3.  **TỰ KIỂM TRA TRƯỚC KHI TRẢ VỀ:** Trước khi hoàn thành, hãy rà soát lại output của bạn để đảm bảo không thiếu bất kỳ token nào. Ví dụ, các token sau đã bị thiếu ở lần trước: ${missingTokensSample}.
####
`;
                currentPrompt = failsafePrompt + prompt;
            }


            const response = await ai.models.generateContent({
                model: modelName,
                contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
                config: { ...config, safetySettings },
            });

            const rawResponseText = response.text ?? '';
            
            const jsonText = cleanJsonString(rawResponseText);
            const parsedResult = JSON.parse(jsonText);

            if (!parsedResult || typeof parsedResult.cleanedText !== 'string' || typeof parsedResult.tableOfContents !== 'string') {
                 throw new Error("AI did not return a valid CleaningResult object.");
            }
            
            // Canonicalize tokens before verification
            const canonicalCleanedResult = canonicalizeComparatorTokens(parsedResult.cleanedText);
            const canonicalTocResult = canonicalizeComparatorTokens(parsedResult.tableOfContents);
            const verifiableText = canonicalCleanedResult.text + "\n" + canonicalTocResult.text;

            // Verify tokens on parsed and canonicalized content
            const expectedSet = new Set(tokens);
            const allPresentCheck = verifyAllTokensPresent(verifiableText, tokens);
            const subsetCheck = verifyComparatorTokensSubset(verifiableText, expectedSet);

            if (!allPresentCheck.ok || !subsetCheck.ok) {
                lastVerificationError = {
                    missing: allPresentCheck.missing,
                    unknown: subsetCheck.unknownTokens,
                    suspicious: subsetCheck.suspiciousFragments,
                };

                if (attempt === 2) {
                     const missingStr = lastVerificationError.missing.join(', ');
                     const corruptStr = [...lastVerificationError.unknown, ...lastVerificationError.suspicious].join(', ');
                     throw new Error(`Comparator Integrity Error after 2 attempts. Missing: ${missingStr || 'none'}. Unknown/Corrupt: ${corruptStr || 'none'}. Nội dung có thể quá dài, hãy thử rút gọn.`);
                }
                continue; // Go to next attempt
            }
            
            // Success! Unlock and return.
            parsedResult.cleanedText = normalizeComparators(unlock(canonicalCleanedResult.text));
            parsedResult.tableOfContents = normalizeComparators(unlock(canonicalTocResult.text));
            return parsedResult;

        } catch (error) {
            console.error(`Error calling Gemini API for cleaning (Attempt ${attempt}):`, error);
             if (attempt === 2) {
                 if (error instanceof Error && error.message.includes('Comparator Integrity Error')) {
                    throw error; // Re-throw our specific integrity error
                 }
                throw new Error(`AI không thể tái cấu trúc văn bản sau 2 lần thử. Lỗi: ${error instanceof Error ? error.message : String(error)}`);
             }
             // On first attempt, ensure lastVerificationError is set so retry logic can trigger with a failsafe prompt
             if (!lastVerificationError) {
                lastVerificationError = { missing: tokens, unknown: [], suspicious: [] };
             }
        }
    }

    // This should not be reachable, but as a fallback
    throw new Error("AI không thể tái cấu trúc văn bản. Đã xảy ra lỗi không xác định sau tất cả các lần thử.");
}

export const getClozeTypeRecommendations = async (
    specialty: Specialty,
    focusSection: string,
    cleanedText: string,
    customInstructions: string,
    modelName: ModelName,
    thinkMore: boolean
): Promise<string> => {
    
    const lockCleaned = lockComparators(cleanedText);
    const lockCustom = lockComparators(customInstructions);

    const prompt = `
[CLOZE TYPE ADVISOR MODULE — “Khuyến nghị chọn dạng thẻ Cloze” | v3 (Nâng cấp Disambiguation) | READ-ONLY]
Vị trí chèn:
- Chèn NGAY SAU giai đoạn “Tái cấu trúc & làm sạch văn bản”, và TRƯỚC khi bước “Tạo thẻ Cloze” bắt đầu.
Mục tiêu:
- Chỉ đưa ra LỜI KHUYÊN chọn loại thẻ Cloze phù hợp với cleanedText.
- Đây là bước “read-only”: KHÔNG tạo thẻ, KHÔNG chỉnh sửa quy trình.
- Đặc biệt, phân tích sâu để tìm kiếm các "confusion sets" và đề xuất thẻ "Cloze Phân Biệt" (disambiguation) một cách chính xác.

${comparatorTokenInstruction}

Đầu vào:
- specialty: ${specialty}
- focusSection: ${focusSection}
- (optional) customInstructions: ${lockCustom.lockedText}
- cleanedText:
\`\`\`
${lockCleaned.lockedText}
\`\`\`

Nguyên tắc nền:
- Chỉ dùng thông tin trong cleanedText. Không dùng kiến thức ngoài.
- Tránh “overfitting”: không khuyên chọn loại thẻ phức tạp nếu tín hiệu không đủ mạnh.
- Khi không chắc → khuyên AUTO hoặc basic/hierarchical (tùy cấu trúc).

---
### I) CATALOG DẠNG THẺ + KHI NÊN DÙNG / KHÔNG NÊN DÙNG
Bạn chỉ được khuyến nghị trong 7 ID:
1) basic
   - Khi dùng tốt: nội dung là “1 fact rõ ràng” (định nghĩa ngắn, 1 con số, 1 thuốc, 1 thuật ngữ) và đủ ngữ cảnh tự thân.
   - Điểm mạnh: ít lỗi, dễ ôn, bám “Minimum Information”.
   - Điểm yếu: không tối ưu cho danh sách bắt buộc nhớ đủ, chuỗi thứ tự, cấu trúc tầng, hoặc cặp dễ nhầm.
   - Tránh khuyên basic nếu: văn bản có danh sách dài cần nhớ đủ theo cấu trúc hoặc có nhiều phụ thuộc.
2) cluster
   - Khi dùng tốt: danh sách NGẮN (2–4 mục) và phải nhớ “đầy đủ như một khối”.
   - Tín hiệu mạnh: cụm từ kiểu “tam chứng/tứ chứng/tiêu chuẩn gồm…”, “bao gồm: (a)(b)(c)”.
   - Điểm mạnh: đảm bảo không học sót.
   - Điểm yếu: nếu list dài → tăng gánh nhớ, dễ quá tải.
   - Tránh khuyên cluster nếu: danh sách >4–5 mục mà không có “bắt buộc nhớ đủ” hoặc không quá gắn kết.
3) overlapping
   - Khi dùng tốt: quy trình/chuỗi có THỨ TỰ bắt buộc (steps, stages, sequence).
   - Tín hiệu mạnh: “Bước 1… Bước 2…”, “giai đoạn I/II/III”, “trình tự”.
   - Điểm mạnh: học thứ tự tốt.
   - Điểm yếu: nếu chuỗi không bắt buộc thứ tự → tạo quá nhiều thẻ, lãng phí.
   - Tránh khuyên overlapping nếu: văn bản chỉ liệt kê không có thứ tự hoặc thứ tự không quan trọng.
4) hierarchical
   - Khi dùng tốt: văn bản có nhiều tầng mục/tiểu mục rõ ràng (phân loại → nhóm → tiêu chí).
   - Tín hiệu mạnh: tiêu đề lồng nhau, “phân loại… gồm nhóm A/B; trong A gồm…”.
   - Điểm mạnh: giữ ngữ cảnh, học từ tổng quan → chi tiết.
   - Điểm yếu: nếu không có cấu trúc tầng, khuyên hierarchical sẽ làm rối.
   - Tránh khuyên hierarchical nếu: chỉ là facts rời hoặc một danh sách phẳng.
5) bidirectional
   - Khi dùng tốt: cặp 1–1 thật sự, nói rõ tính đặc hiệu/duy nhất trong text.
   - Tín hiệu mạnh: “đặc hiệu cho/duy nhất/only/characteristic marker”.
   - Điểm mạnh: nhớ 2 chiều vững.
   - Điểm yếu: dễ tạo sai nếu quan hệ không thật 1–1.
   - Tránh khuyên bidirectional nếu: text không khẳng định 1–1 hoặc có nhiều ngoại lệ.
6) disambiguation
   - Mục tiêu: Chuyên trị các cặp/nhóm kiến thức dễ nhầm lẫn.
   - Khi nào dùng: Khi văn bản chứa một "confusion set" hợp lệ (có phần trùng lặp và có điểm phân biệt rõ ràng).
   - **QUY TRÌNH CHI TIẾT:** Bạn phải tuân thủ nghiêm ngặt theo **[DISAMBIGUATION ADVISOR EXTENSION]** dưới đây để xác định và báo cáo các confusion set.
7) pedi_mindmap (CHỈ NHI)
   - Khi dùng tốt: bài Nhi yêu cầu học thuộc cấu trúc sách; văn bản có mục lớn–mục con–ý nhỏ.
   - Điểm mạnh: tái tạo mindmap, đảm bảo “nguyên tắc đầy đủ”.
   - Điểm yếu: nặng, tạo thẻ lớn; không phù hợp nếu nội dung không theo cấu trúc cây.
   - Tránh khuyên pedi_mindmap nếu specialty không phải Nhi.

---
### II) [DISAMBIGUATION ADVISOR EXTENSION — “Nâng cấp khuyến nghị Cloze Phân Biệt” | v3]
Phạm vi áp dụng:
- Chỉ dùng trong phần “Cố vấn AI: khuyến nghị dạng thẻ”.
- Mục tiêu là KHỐNG CHẾ NHẦM LẪN bằng cách tìm và đề xuất “confusion sets” từ cleanedText.
- Không tạo flashcard ở bước này. Không sửa quy trình khác. Chỉ khuyến nghị + liệt kê phát hiện.

Ràng buộc:
- Chỉ được dùng dữ liệu trong cleanedText (và Mermaid sau khi đọc hiểu). Không dùng kiến thức ngoài.
- Không paraphrase nội dung y khoa khi trích dẫn dấu hiệu; chỉ mô tả tín hiệu + chỉ ra vị trí/tiêu đề liên quan.
- Nếu một confusion set thiếu “điểm phân biệt” rõ ràng trong text → không khuyến nghị disambiguation cho set đó.

Mục tiêu chất lượng (đặc biệt quan trọng):
- Tìm TỐI ĐA các chi tiết “dễ lẫn” chứ không chỉ liều/đơn vị/ngưỡng.
- Ưu tiên những nhầm lẫn hay gặp trong học và thi: giống tên, giống cấu trúc, giống triệu chứng/lab, khác nhau ở “một chi tiết nhỏ”.

**II.A) ĐỊNH NGHIÁ “CONFUSION SET” (điều kiện cần & đủ)**
Một confusion set hợp lệ phải thỏa đồng thời:
A) Có ít nhất 2 mục khác nhau (A và B, tối đa 3) xuất hiện trong cleanedText.
B) Có “phần trùng” hoặc “hình thái tương tự” khiến dễ nhầm (shared surface features).
C) Có ít nhất 1–3 “điểm phân biệt” (discriminators) xuất hiện TRỰC TIẾP trong text (con số, điều kiện, dấu hiệu, tiêu chí, bước xử trí, chống chỉ định…).
D) Có giá trị học/thi (không phải trivia).

**II.B) BẢN ĐỒ NHẦM LẪN (Confusion Taxonomy) — PHẢI QUÉT ĐỦ**
Khi rà soát cleanedText, bạn phải chủ động tìm confusion sets theo các nhóm sau (không giới hạn):
1) Số học/Ngưỡng/So sánh: > vs ≥ ; < vs ≤ ; “tăng/giảm”; “mild/mod/severe” theo ngưỡng; Khoảng giá trị (x–y) dễ đảo nhầm; “mỗi 1–3h” vs “3–6h”…
2) Đơn vị/Chuẩn đo lường: mmol/L vs mEq/L; mg vs mcg; mg/kg vs mg/m²; mL/kg; IU; %; g/L; mOsm…; “per dose” vs “per day”; “q6h” vs “q8h”; tốc độ truyền (mL/kg/h) vs tổng liều.
3) Thời gian & điều kiện: Mốc theo dõi, thời điểm xét nghiệm, thời gian điều trị, thời gian đáp ứng, thời gian ngừng thuốc; “trước/sau” can thiệp; “trong 24h đầu” vs “sau 48h”.
4) Triệu chứng trùng nhưng bối cảnh khác: Cùng 1 biểu hiện (co giật, rối loạn tri giác, nôn…) ở nhiều tình trạng. Điểm phân biệt nằm ở bối cảnh/đi kèm/tiền sử/khám/khác.
5) Tiêu chuẩn/Chẩn đoán/differential: Hai bộ tiêu chuẩn gần giống; khác nhau ở 1–2 tiêu chí hoặc điều kiện loại trừ; Chẩn đoán phân biệt trình bày dạng bảng hoặc “phân biệt với…”.
6) Phân loại/Stage/Grade/Score: Stage I/II/III; độ I/II/III; nhóm A/B/C; risk categories. Dễ nhầm do tên giống hoặc tiêu chí chồng lấn.
7) Điều trị/Thuật toán xử trí: Hai phác đồ giống nhau nhưng khác “điểm rẽ nhánh” (nếu/ thì); Chính xác thứ tự ưu tiên: làm gì trước/sau; chỉ định khi nào; ngừng khi nào.
8) Chống chỉ định/Cảnh báo/Thận trọng: Hai thuốc/can thiệp gần giống; khác ở chống chỉ định, điều kiện giảm liều, theo dõi.
9) Thuật ngữ gần âm/gần chữ (look-alike / sound-alike): Tên viết tắt trùng (SIADH/DI; ARDS/RDS;… chỉ khi text có); Tên thuốc/thuật ngữ tương tự ký tự, dễ đảo (chỉ khi xuất hiện trong text).
10) Thực thể “cùng họ” nhưng khác vai trò: Ví dụ dạng “A causes…, B causes…” hoặc “A indicates…, B indicates…”. Nhiều item cùng cấu trúc câu, chỉ đổi một cụm quan trọng.

**II.C) HEURISTICS — CÁCH TỰ ĐỘNG “SĂN” CONFUSION SETS TRONG TEXT**
Bạn phải dùng đồng thời 4 lớp tín hiệu:
(1) Tín hiệu ngôn ngữ: “so sánh”, “phân biệt”, “khác với”, “tương tự”, “trong khi”, “ngược lại”, “vs”, “whereas”, “contrast”, “however”; Cấu trúc song song: “A: …; B: …” hoặc “A gồm…; B gồm…”.
(2) Tín hiệu định dạng: Bảng (tables), mục “TÓM TẮT / SO SÁNH”, bullet list song song, heading gần nhau; Các cụm “Nhẹ/Trung bình/Nặng”, “Có/Không”, “Trước/Sau”, “Type 1/Type 2”.
(3) Tín hiệu số liệu: Cùng một đại lượng lặp lại nhiều lần với các ngưỡng khác nhau; Xuất hiện nhiều đơn vị khác nhau trong vùng gần nhau; Dấu so sánh, khoảng, tốc độ, tần suất.
(4) Tín hiệu “trùng bề mặt”: Lặp lại từ khóa giống nhau ở hai mục khác nhau (cùng triệu chứng/nhóm); Tên gần giống (Levenshtein-like) hoặc chung prefix/suffix (chỉ dựa vào text).

**II.D) CHẤM ĐIỂM “RỦI RO NHẦM” VÀ “ĐỦ ĐIỂM PHÂN BIỆT”**
Với mỗi confusion set ứng viên, chấm nhanh 2 điểm (0–3) để quyết định có khuyến nghị hay không:
1) ConfusionRisk (0–3): 3: rất giống + chỉ khác 1–2 chi tiết nhỏ / xuất hiện trong bảng so sánh / nhiều con số gần nhau; 2: giống vừa + có vài khác biệt; 1: hơi giống; 0: không giống → loại.
2) DiscriminatorStrength (0–3): 3: có 2–3 discriminator “cứng” (ngưỡng, đơn vị, điều kiện bắt buộc, tiêu chí); 2: có 1–2 discriminator rõ; 1: discriminator mờ; 0: không có → KHÔNG được khuyến nghị disambiguation.
Quy tắc ra quyết định:
- Chỉ khuyến nghị disambiguation cho những set có: ConfusionRisk ≥ 2 VÀ DiscriminatorStrength ≥ 2.
- Những set còn lại: liệt kê ở “Possible but weak” (để người dùng biết), nhưng không khuyến nghị mạnh.

---
### III) QUY TRÌNH QUÉT TÍN HIỆU (SIGNALS) TỪ cleanedText
Bạn phải quét và ghi nhận các signals sau (chỉ mô tả ngắn, không trích dài):
S1. Short Tightly-Coupled List (2–4 mục) → ứng viên cluster
S2. Ordered Steps / Stages → ứng viên overlapping
S3. Multi-level headings / nesting / “phân loại” → ứng viên hierarchical (hoặc mindmap nếu Nhi)
S4. True 1–1 Pairing (explicit uniqueness) → ứng viên bidirectional
S5. Confusion Set (A vs B; gần nhau; khác nhỏ) → ứng viên disambiguation (Sử dụng module II để phân tích sâu)
S6. Standalone atomic facts → ứng viên basic
S7. Mermaid structural cues (nếu có) → map sang S2/S3/S5

---
### IV) CHẤM ĐIỂM KHỚP (FIT SCORE) — CỤ THỂ HÓA QUYẾT ĐỊNH
Tính điểm 0–5 cho mỗi ID theo luật sau (không cần xuất điểm chi tiết, chỉ dùng để quyết định):
- +2 nếu tín hiệu mạnh tương ứng xuất hiện rõ ràng (S1–S7).
- +1 nếu tín hiệu vừa (gợi ý nhẹ).
- -2 nếu có “lý do tránh” nêu trong phần CATALOG.
- Ưu tiên “độ an toàn”: nếu điểm ngang nhau, chọn loại đơn giản hơn (basic/hierarchical) trừ khi có signal rất mạnh cho loại nâng cao.
- Nếu specialty = Nhi và thấy S3 rõ: cộng +2 cho pedi_mindmap.

---
### V) ĐẦU RA: CHỈ KHỐI KHUYẾN CÁO (READ-ONLY)
Chỉ xuất đúng cấu trúc sau, không thêm thứ khác:

[Cloze Type Recommendation]
1) Suggested selection (IDs)
- Option 1 (strong): <id>
- Option 2 (optional): <id>
- Option 3 (optional): <id>
- Nếu tín hiệu yếu/không rõ: AUTO

Legend (VN): <Dòng chú thích tiếng Việt cho các ID đã đề xuất>

2) Decision rationale (signals → types)
- Signal: <mô tả ngắn> → Recommend: <id> → Reason: <1 câu>
(lặp 2–6 dòng, mỗi dòng 1 signal quan trọng nhất)

**<PHẦN BỔ SUNG NẾU KHUYẾN NGHỊ 'disambiguation'>**
Nếu 'disambiguation' được chọn trong 'Suggested selection', bạn BẮT BUỘC phải thêm khối sau:

[Disambiguation Targets (Confusion Sets Found)]
A) Strong candidates (use disambiguation)
- Set #1: A vs B (tối đa 3 item)
  - Why confusing: <1 câu mô tả phần trùng>
  - Discriminators in text: <liệt kê 1–3 discriminator ngắn>
  - Where found: <heading/section hoặc mô tả vị trí>
- (liệt kê 2–8 set, ưu tiên chất lượng, không spam)

B) Possible but weak (do not force)
- Set #…: …
  - Missing discriminator / too vague / low exam value

Design hints:
- Ưu tiên che discriminator, không che phần chung.
- Mỗi bên 1–3 discriminator; nếu hơn → tách thẻ.
- Hint phải định vị A/B (ví dụ: ::điểm phân biệt của A / ::điểm phân biệt của B).
- Nếu discriminator là số/đơn vị, hint phải nêu loại đại lượng (ví dụ: ::ngưỡng / ::tần suất / ::đơn vị), không nêu đáp án.
**</KẾT THÚC PHẦN BỔ SUNG>**

3) Best-use warning (pitfalls to avoid)
- <id>: <1 câu cảnh báo ngắn đúng điểm yếu>
(lặp cho các id đã khuyến nghị)

4) UI helper (descriptions for selection UI)
- basic: 1 thẻ–1 ý, tối ưu tối thiểu thông tin.
- cluster: học 1 cụm 2–4 ý như một khối.
- overlapping: học chuỗi có thứ tự bằng nhiều thẻ.
- hierarchical: học theo tầng, thẻ con nhắc lại ngữ cảnh thẻ cha.
- bidirectional: học 2 chiều cho quan hệ 1–1 thật sự.
- disambiguation: đặt 2 mục dễ nhầm vào cùng 1 thẻ để phân biệt điểm khác.
- pedi_mindmap: (Nhi) học theo mindmap + nguyên tắc đầy đủ + cardId/parentId.
`;

    try {
        const config: any = {
            temperature: 0.1,
        };

        if (thinkMore && (modelName === 'gemini-3-pro-preview' || modelName === 'gemini-2.5-pro')) {
             config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { ...config, safetySettings },
        });

        const responseText = response.text ?? '';
        
        let unlockedText = lockCleaned.unlock(responseText);
        unlockedText = lockCustom.unlock(unlockedText);
        
        return unlockedText;
    } catch (error) {
        console.error("Error calling Gemini API for recommendations:", error);
        if (error instanceof Error && error.message.includes('SAFETY')) {
            throw new Error("Không thể lấy khuyến nghị do bộ lọc an toàn của AI.");
        }
        if (error instanceof Error && error.message.includes('Comparator Integrity Error')) {
            throw error;
        }
        throw new Error("AI không thể đưa ra khuyến nghị. Đã xảy ra lỗi mạng hoặc hệ thống.");
    }
};

export const generateClozeFlashcards = async (
    lessonText: string,
    specialty: Specialty,
    focusSection: string,
    lessonSource: string,
    customInstructions: string,
    preferredClozeTypes: ClozeType[],
    modelName: ModelName,
    thinkMore: boolean,
    extraDisambiguationContext: string
): Promise<GenerationResult> => {

    const normLesson = normalizeComparators(lessonText);
    const normCustom = normalizeComparators(customInstructions);
    const normExtra = normalizeComparators(extraDisambiguationContext);

    const lockLesson = lockComparators(normLesson);
    const lockCustom = lockComparators(normCustom);
    const lockExtra = lockComparators(normExtra);

    const customInstructionsSection = customInstructions && customInstructions.trim() !== ''
    ? `####<Yêu cầu tùy chỉnh>
Ngoài các chỉ thị trên, hãy đặc biệt tuân thủ yêu cầu bổ sung sau đây từ tôi khi làm việc với đề mục "${focusSection}":
"${lockCustom.lockedText}"
####
`
    : '';

    const extraDisambiguationContextSection = extraDisambiguationContext && extraDisambiguationContext.trim() !== ''
    ? `####<Ngữ cảnh bổ sung cho thẻ Phân Biệt (ExtraContextText)>
Người dùng đã cung cấp một đoạn văn bản bổ sung dưới đây.
**QUY TẮC SỬ DỤNG (BẮT BUỘC):**
1.  Bạn **CHỈ ĐƯỢỢC PHÉP** sử dụng đoạn văn bản này để tìm kiếm các "cặp dễ nhầm lẫn" (confusion sets) khi tạo thẻ **Cloze Phân Biệt (disambiguation)**.
2.  Bạn **TUYỆT ĐỐI KHÔNG** được sử dụng đoạn văn bản này để tạo bất kỳ loại thẻ nào khác (basic, cluster, overlapping, hierarchical, bidirectional, pedi_mindmap). Đối với các loại thẻ đó, nguồn duy nhất là văn bản trong đề mục chính (FocusText).
3.  Khi tạo thẻ Phân Biệt, bạn được phép kết hợp thông tin, ví dụ: mục A từ FocusText và mục B từ ExtraContextText.

**NỘI DUNG NGỮ CẢNH BỔ SUNG:**
\`\`\`
${lockExtra.lockedText}
\`\`\`
####
` : '';

    const isExclusiveMode = preferredClozeTypes && preferredClozeTypes.length > 0;
    const modeString = isExclusiveMode ? 'EXCLUSIVE' : 'AUTO';
    const typesString = isExclusiveMode ? preferredClozeTypes.join(',') : '';

    const clozePrioritySelectorModule = `
[CLOZE PRIORITY SELECTOR MODULE — “Bộ chọn ưu tiên dạng thẻ Cloze” | v4 (CHẾ ĐỘ EXCLUSIVE - ĐÃ SỬA LỖI)]
Mục tiêu:
Cho phép người dùng chọn 1 hoặc nhiều “dạng thẻ Cloze” để bạn CHỈ tạo DUY NHẤT các dạng đó.

[ĐẦU VÀO BỔ SUNG]
Hệ thống đã xác định chế độ hoạt động và danh sách các loại thẻ ưu tiên:
- mode: ${modeString}
- preferredClozeTypes: ${typesString}

[CÁCH ÁP DỤNG CHẾ ĐỘ]
A) Nếu mode là "AUTO":
   - Hoạt động đúng quy trình mặc định (có thể dùng mọi dạng thẻ như hiện tại).
   - Nếu specialty là Nhi, chế độ mindmap sẽ được kích hoạt theo mặc định.
   - Bỏ qua giá trị của preferredClozeTypes.

B) Nếu mode là "EXCLUSIVE":
   - Đây là chế độ ĐỘC QUYỀN. Bạn phải phân tích chuỗi trong preferredClozeTypes.
   - Chỉ tạo thẻ thuộc các type nằm trong AllowedSet, là tập các ID hợp lệ được trích xuất từ preferredClozeTypes (theo CATALOG và specialty).
   - Với mỗi đơn vị kiến thức:
       1) Xác định tập các dạng thẻ có thể áp dụng hợp lệ cho đơn vị kiến thức này (dựa trên Gating Rules).
       2) Tìm giao của tập đó với AllowedSet.
       3) Nếu giao nhau rỗng (không có type nào được phép phù hợp): BỎ QUA đơn vị kiến thức đó. KHÔNG tạo thẻ. Ghi nhận lý do vào báo cáo.
       4) Nếu giao nhau không rỗng: chọn 1 dạng thẻ từ tập giao nhau đó, ưu tiên dạng xuất hiện sớm hơn trong chuỗi preferredClozeTypes của người dùng (trái → phải), và tạo thẻ.
   - TUYỆT ĐỐI không được “fallback” sang dạng khác ngoài AllowedSet trong mọi trường hợp.

[CÁCH CHUẨN HÓA preferredClozeTypes (KHI Ở CHẾ ĐỘ EXCLUSIVE)]
- Parse chuỗi theo dấu phẩy; trim khoảng trắng; lower-case; loại phần tử rỗng; loại trùng.
- Chỉ chấp nhận ID trong “CATALOG” bên dưới; ID không hợp lệ → bỏ qua và ghi nhận để báo cáo ở Bước 6.
- Không tự chế ID mới.

[CATALOG DẠNG THẺ — ID + mô tả ngắn (dùng để hiển thị lựa chọn)]
Bạn phải nhận diện 7 ID sau (đúng chính tả):
1) basic             = Cloze Cơ bản: 1 thẻ–1 ý; ưu tiên nguyên tử; thường chỉ 1 vùng ẩn (c1), theo Minimum Information.
2) cluster           = Cloze Nhóm: học thuộc 1 cụm (2–4 mục) như một khối; cùng số cloze cho cả cụm.
3) overlapping       = Cloze Chồng lấn: học chuỗi có thứ tự bằng nhiều thẻ; mỗi thẻ che 1 bước.
4) hierarchical      = Cloze Phân cấp: kiến thức nhiều tầng; thẻ tầng dưới luôn nhắc lại ngữ cảnh tầng trên.
5) bidirectional     = Cloze Đảo chiều: CHỈ cho quan hệ 1–1 thực sự; tạo 2 thẻ hỏi xuôi và ngược.
6) disambiguation    = Cloze Phân biệt: đặt 2 (tối đa 3) mục dễ nhầm trong CÙNG 1 thẻ; che “điểm phân biệt”.
7) pedi_mindmap      = Chế độ Mindmap Nhi khoa: chỉ áp dụng khi specialty là Nhi; tạo cây cardId/parentId + “nguyên tắc đầy đủ”.

[QUY TẮC THEO CHUYÊN KHOA (EXCLUSIVE) — GHI ĐÈ MẶC ĐỊNH]
**QUY TẮC GHI ĐÈ:** Lựa chọn của người dùng trong chế độ EXCLUSIVE luôn có quyền ưu tiên cao hơn mọi mặc định của chuyên khoa.

- Nếu ${specialty} KHÔNG phải Nhi:
   - Nếu người dùng chọn 'pedi_mindmap', hãy bỏ qua nó khỏi AllowedSet và ghi nhận trong báo cáo. 'pedi_mindmap' chỉ hợp lệ cho Nhi khoa.

- Nếu ${specialty} là Nhi:
   - Chế độ 'pedi_mindmap' bây giờ là **TÙY CHỌN (OPTIONAL)**, không còn là bắt buộc.
   - **TRƯỜNG HỢP 1: Người dùng CHỌN 'pedi_mindmap' trong preferredClozeTypes.**
     - Bạn sẽ hoạt động ở chế độ mindmap. Tuân thủ nghiêm ngặt các quy tắc về cardId/parentId và "Nguyên tắc Đầy đủ".
     - Các dạng thẻ khác trong AllowedSet có thể được dùng bổ sung nếu không phá vỡ cấu trúc mindmap.
   - **TRƯỜNG HỢP 2: Người dùng KHÔNG CHỌN 'pedi_mindmap' trong preferredClozeTypes.**
     - **HÀNH ĐỘNG BẮT BUỘC:** Bạn phải **TẮT HOÀN TOÀN** chế độ mindmap.
     - **KHÔNG** được tạo thẻ theo cấu trúc cây.
     - **KHÔNG** được điền các trường \`cardId\` và \`parentId\`.
     - Bạn chỉ được tạo thẻ theo các dạng nằm trong \`AllowedSet\` của người dùng (ví dụ: 'basic', 'cluster', 'disambiguation'...).
     - Lựa chọn của người dùng đã ghi đè lên mặc định mindmap của chuyên khoa Nhi.

[GATING RULES VÀ HỆ QUẢ TRONG EXCLUSIVE MODE]
- Các điều kiện bắt buộc (gating rules) vẫn được giữ nguyên:
  - bidirectional: chỉ khi quan hệ 1–1 rõ ràng.
  - disambiguation: chỉ khi có confusion set thật sự.
  - overlapping: chỉ khi chuỗi có thứ tự cố định và quan trọng.
  - cluster: chỉ khi danh sách ngắn và cần nhớ như khối.
  - hierarchical: chỉ khi có cấu trúc tầng lớp.
  - basic: chỉ khi có thể làm thẻ nguyên tử.
- HỆ QUẢ: Trong chế độ EXCLUSIVE, nếu người dùng chọn một type (ví dụ: 'bidirectional') nhưng đơn vị kiến thức không thỏa mãn gating rule (không phải quan hệ 1-1), thì đơn vị kiến thức đó BẮT BUỘC phải bị BỎ QUA.

[ĐIỂM CHÈN VÀO QUY TRÌNH (KHÔNG PHÁ OUTPUT)]
- Ở đầu Bước 2 (trong suy nghĩ nội bộ), bạn phải:
  a) Tuân thủ \`mode\` đã được cung cấp.
  b) Nếu \`mode\` là EXCLUSIVE, chuẩn hoá \`preferredClozeTypes\` → danh sách ID hợp lệ theo CATALOG để tạo \`AllowedSet\`.
  c) Ghi nhớ thứ tự ưu tiên (trái → phải).
- Ở Bước 6 (Báo cáo thanh tra), thêm 1 mục ngắn:
  “Cloze Priority Audit” gồm:
   - mode: "EXCLUSIVE" hoặc "AUTO" (phải khớp với giá trị \`mode\` đã nhận)
   - preferredClozeTypes (chuỗi gốc người dùng nhập)
   - allowedSet (sau lọc theo specialty, phản ánh đúng lựa chọn của người dùng trong EXCLUSIVE mode)
   - pediMindmapActive: (boolean) true nếu chế độ mindmap được kích hoạt, false nếu không.
   - pediMindmapActivationReason: (string) Giải thích lý do. Ví dụ: "User selected in EXCLUSIVE mode", "Specialty default in AUTO mode", "Disabled by user in EXCLUSIVE mode".
   - extraDisambiguationContext: ${extraDisambiguationContext.trim() ? 'provided' : 'empty'}
   - disambiguationSearchScope: ${extraDisambiguationContext.trim() ? 'FocusText + ExtraContextText' : 'FocusText only'}
   - preFlightReviewUsed: true
   - skippedUnitsCount (số lượng đơn vị kiến thức bị bỏ qua) và danh sách ngắn các lý do.
   - thống kê số thẻ theo từng type trong AllowedSet.

[RÀNG BUỘC GIỮ NGUYÊN]
- Không thay đổi ràng buộc trung thực, không làm biến dạng cấu trúc JSON output.
`;

    let categoryInstruction = `- \`questionCategory\`: Phân loại câu hỏi (ví dụ: 'Chẩn đoán', 'Điều trị', 'Sinh lý bệnh').`;

    if (specialty === 'Nhi khoa') {
        categoryInstruction = `- \`questionCategory\`: **QUY TẮC ĐẶC BIỆT CHO CHUYÊN KHOA NHI:** Phân loại câu hỏi bằng cách lấy tên của **đề mục nhỏ, cụ thể nhất** mà nội dung đó thuộc về. 
    - **Ví dụ 1:** Nếu nội dung nằm dưới đề mục "#### Thời kì ủ bệnh", thì phân loại phải là "Thời kỳ ủ bệnh".
    - **Ví dụ 2:** Nếu nội dung nằm trong phần "Triệu chứng toàn phát" và dưới tiểu mục "**Dấu hiệu sang thương da và miệng:**", thì phân loại chính là "Dấu hiệu sang thương da và miệng:".
    - **Mục tiêu:** Sử dụng các tiêu đề phụ trong văn bản làm danh mục để tăng độ chi tiết cho thẻ.`;
    }

    const pediatricsStep3Prompt = `
###<Bước 3> Bước 3: Thiết kế thẻ Cloze theo cấu trúc Mindmap phân cấp (QUAN TRỌNG NHẤT).
Đây là quy trình cốt lõi dành riêng cho chuyên khoa Nhi. Bạn phải tuân thủ nghiêm ngặt để tạo thẻ giúp ghi nhớ y hệt giáo trình.

---

### <Bối cảnh>

Tôi là sinh viên Y6, chuẩn bị cho kỳ thi nội trú, trong đó có môn Nhi khoa.
Đề thi Nhi khoa là thi tự luận, thường yêu cầu **viết nguyên si (y hệt)** một phần lớn trong bài trong giáo trình Nhi khoa.
Ví dụ: một bài có các phần *dịch tễ – lâm sàng – cận lâm sàng – điều trị* → đề thi có thể ra một trong các phần này.
Tóm lại: **tôi phải nhớ y hệt nội dung trong bài**.

---

### <Mục tiêu>

Để thuận tiện cho việc ghi nhớ, tôi nhờ bạn thiết kế **câu hỏi Anki dạng thẻ cloze**, với **cách tổ chức theo kiểu mindmap phân cấp**:

* Ở **phần lớn** → tạo câu hỏi để nhớ các **mục nhỏ chính**.
* Ở **mục nhỏ chính** → tạo câu hỏi để nhớ các **mục nhỏ hơn**.
* Cứ như vậy **xuống tới các phân cấp cuối cùng**.
* Mỗi ý nhỏ **luôn kèm một “HINT ĐẢM BẢO CHẤT LƯỢNG”** để dễ thuộc hơn.

---

### <QUY TẮC VÀNG: NGUYÊN TẮC ĐẦY ĐỦ (QUAN TRỌNG NHẤT)>

**BỐI CẢNH:** Khi bạn tạo một thẻ cloze để hỏi về các ý nhỏ thuộc một ý lớn (ví dụ: hỏi về các triệu chứng trong phần "Lâm sàng", hoặc các nguyên tắc trong "Điều trị"), bạn **BẮT BUỘC** phải liệt kê **TẤT CẢ** các ý nhỏ đó trong cùng một thẻ cloze.

**LỖI SAI NGHIÊM TRỌNG CẦN TRÁNH:** Không được tạo thẻ chỉ hỏi một vài ý rồi bỏ qua các ý còn lại trong cùng một danh sách. Điều này làm tôi học thiếu và hổng kiến thức.

**VÍ DỤ CỤ THỂ VỀ LỖI CẦN TRÁNH:**

Giả sử nội dung sách là:
"Chỉ định sinh thiết thận cho bệnh hội chứng thận hư là:
- Trẻ <1 tuổi hoặc >10 tuổi
- Hội chứng thận hư kèm tăng huyết áp
- C3 C4 giảm
- Tiểu máu
- Suy thận
- Trước điều trị cyclosproin
- Hội chứng thận hư kháng corticoid"

**CÁCH LÀM SAI (KHÔNG CHẤP NẬN):**
Tạo thẻ chỉ hỏi 3/7 chỉ định:
\`Chỉ định sinh thiết thận của hội chứng thận hư là: {{c1::C3 C4 giảm}}, {{c1::suy thận}}, {{c1::tiểu máu}}...\`
=> **SAI** vì đã bỏ sót 4 chỉ định còn lại.

**CÁCH LÀM ĐÚNG (BẮT BUỘC):**
Tạo một thẻ duy nhất bao gồm **TOÀN BỘ 7/7** chỉ định:
\`Các chỉ định sinh thiết thận của hội chứng thận hư bao gồm:
{{c1::Trẻ <1 tuổi hoặc >10 tuổi}}
{{c1::Hội chứng thận hư kèm tăng huyết áp}}
{{c1::C3 C4 giảm}}
{{c1::Tiểu máu}}
{{c1::Suy thận}}
{{c1::Trước điều trị cyclosproin}}
{{c1::Hội chứng thận hư kháng corticoid}}
\`
(Tất cả các mục đều là \`c1\` để chúng được hiển thị cùng nhau).

**KẾT LUẬN:** Mọi danh sách, mọi phân loại phải được hỏi **ĐẦY ĐỦ, TRỌN VẸN** trong một thẻ cloze duy nhất. Đây là yêu cầu quan trọng nhất của phương pháp này.

---

### <Cấu trúc kiến thức dạng cây (mindmap) – Ví dụ khung>

Giả sử một khung kiến thức tổng quát:

\`\`\`text
A -> B, C, D, E
B -> 1, 2, 3
C -> 4, 5, 6
D -> 7, 8, 9
E -> 10, 11, 12
1 -> J, Q, K
\`\`\`

---

### <Mẫu thiết kế thẻ cloze từ khung tổng quát>

#### Thẻ cloze 1

**Câu hỏi:** A bao gồm?

\`\`\`text
{{c1::B::<gợi ý (hint) cho ý B> }}
{{c1::C::<gợi ý (hint) cho ý C> }}
{{c1::D::<gợi ý (hint) cho ý D> }}
{{c1::E::<gợi ý (hint) cho ý E> }}
\`\`\`

---

#### Thẻ cloze 2

**Câu hỏi:** <Lời dẫn liên kết từ ý A tới ý B>, B bao gồm?

\`\`\`text
{{c1::1::<gợi ý (hint) cho ý 1>}}
{{c1::2::<gợi ý (hint) cho ý 2>}}
{{c1::3::<gợi ý (hint) cho ý 3>}}
\`\`\`

---

#### Thẻ cloze 3, 4, 5

Tương tự đối với C, D, E:

* Thẻ cloze 3: <Lời dẫn liên kết từ A tới C>, C bao gồm 4, 5, 6.
* Thẻ cloze 4: <Lời dẫn liên kết từ A tới D>, D bao gồm 7, 8, 9.
* Thẻ cloze 5: <Lời dẫn liên kết từ A tới E>, E bao gồm 10, 11, 12.

**Nguyên tắc:**
→ Khi hỏi câu hỏi của các ý nhỏ, **luôn đưa lời dẫn từ ý lớn tới ý nhỏ** (mục đích: giúp tôi liên kết theo kiểu mindmap).

---

#### Thẻ cloze 6

**Câu hỏi:** <Lời dẫn liên kết từ ý A tới ý B, từ ý B tới ý 1>, 1 bao gồm?

\`\`\`text
{{c1::J::<gợi ý (hint) cho ý J>}}
{{c1::Q::<gợi ý (hint) cho ý Q>}}
{{c1::K::<gợi ý (hint) cho ý K>}}
\`\`\`

---

### <Ví dụ cụ thể – Phác đồ Điều trị tiêu chảy cấp>

Giả sử nội dung gốc trong sách:

\`\`\`text
Phác đồ Điều trị tiêu chảy cấp bao gồm:

A. Phác đồ A – Điều trị tiêu chảy tại nhà  
   Khuyên bảo bà mẹ bốn nguyên tắc điều trị tiêu chảy tại nhà  

   • Nguyên tắc chung là cho trẻ uống tùy theo trẻ muốn cho tới khi ngừng tiêu chảy.  
     o Trẻ dưới 2 tuổi: khoảng 50 – 100 mL sau mỗi lần đi ngoài  
     o Trẻ 2 – 10 tuổi: khoảng 100 – 200 mL sau mỗi lần đi ngoài  
     o Trẻ lớn: uống theo nhu cầu.  

   • Nguyên tắc 2: Tiếp tục cho trẻ ăn để phòng suy dinh dưỡng  

   • Nguyên tắc 3: Cho trẻ uống bổ sung kẽm (10 mg; 20 mg) hàng ngày trong 10 – 14 ngày  
     o Cho trẻ uống càng sớm càng tốt ngay khi tiêu chảy bắt đầu.  
     o Kẽm sẽ làm rút ngắn thời gian và mức độ trầm trọng của tiêu chảy.  
     o Kẽm rất quan trọng cho hệ thống miễn dịch của trẻ và giúp ngăn chặn những đợt tiêu chảy mới trong vòng 2 – 3 tháng sau điều trị. Kẽm giúp cải thiện sự ngon miệng và tăng trưởng.  
     o Trẻ < 6 tháng tuổi: 10 mg/ngày, trong vòng 10 – 14 ngày  
     o Trẻ ≥ 6 tháng tuổi: 20 mg/ngày, trong vòng 10 – 14 ngày. Nên cho trẻ uống kẽm lúc đói.  

   • Nguyên tắc 4: Đưa trẻ đến khám ngay khi trẻ có một trong những biểu hiện sau  
   …

B. Phác đồ B – Điều trị có mất nước  
   ……

C. Phác đồ C – Điều trị cho bệnh nhân mất nước nặng  
   ………
\`\`\`

---

### <Thiết kế thẻ cloze từ ví dụ tiêu chảy cấp>

#### Thẻ cloze 1

**Câu hỏi:**
Trong điều trị tiêu chảy cấp, có những loại phác đồ nào? Nhóm đối tượng điều trị của từng loại phác đồ là gì?

\`\`\`text
{{c1::Phác đồ A – Điều trị tiêu chảy tại nhà::<gợi ý (hint) cho Phác đồ A>}}
{{c1::Phác đồ B – Điều trị có mất nước::<gợi ý (hint) cho Phác đồ B>}}
{{c1::Phác đồ C – Điều trị cho bệnh nhân mất nước nặng::<gợi ý (hint) cho Phác đồ C>}}
\`\`\`

---

#### Thẻ cloze 2

**Câu hỏi:**
Trong các phác đồ điều trị tiêu chảy A, B, C, phác đồ A là phác đồ điều trị tiêu chảy tại nhà, khuyên bảo bà mẹ có 4 nguyên tắc điều trị tiêu chảy tại nhà.
**Bốn nguyên tắc điều trị đó bao gồm những nguyên tắc nào?**

> Lời dẫn liên kết:
> “Trong các phác đồ điều trị tiêu chảy A, B, C, phác đồ A là phác đồ điều trị tiêu chảy tại nhà, khuyên bảo bà mẹ có 4 nguyên tắc điều trị tiêu chảy tại nhà,…”

\`\`\`text
{{c1::Nguyên tắc chung là cho trẻ uống tùy theo trẻ muốn cho tới khi ngừng tiêu chảy::<gợi ý (hint) cho Nguyên tắc chung>}}
{{c1::Nguyên tắc 2: Tiếp tục cho trẻ ăn để phòng suy dinh dưỡng::<gợi ý (hint) cho Nguyên tắc 2>}}
{{c1::Nguyên tắc 3: Cho trẻ uống bổ sung kẽm (10 mg; 20 mg) hàng ngày trong 10 – 14 ngày::<gợi ý (hint) cho Nguyên tắc 3>}}
{{c1::Nguyên tắc 4: Đưa trẻ đến khám ngay khi trẻ có một trong những biểu hiện sau::<gợi ý (hint) cho Nguyên tắc 4>}}
\`\`\`

---

#### Thẻ cloze 3

**Câu hỏi:**
Trong các phác đồ điều trị tiêu chảy A, B, C, phác đồ A là phác đồ điều trị tiêu chảy tại nhà, khuyên bảo bà mẹ có 4 nguyên tắc điều trị tiêu chảy tại nhà, và **nguyên tắc chung là cho trẻ uống tùy theo trẻ muốn cho tới khi ngừng tiêu chảy**. Cụ thể nguyên tắc chung này là gì?

> Thành phần lời dẫn (theo chuỗi mindmap):
>
> * Từ điều trị tiêu chảy cấp có phác đồ A, B, C:
>   “Trong các phác đồ điều trị tiêu chảy A, B, C…”
> * Từ phác đồ A, B, C tới phác đồ A:
>   “Trong các phác đồ điều trị tiêu chảy A, B, C, phác đồ A là phác đồ điều trị tiêu chảy tại nhà…”
> * Từ phác đồ A tới 4 nguyên tắc điều trị:
>   “Phác đồ A là phác đồ điều trị tiêu chảy tại nhà, khuyên bảo bà mẹ có 4 nguyên tắc điều trị tiêu chảy tại nhà…”
> * Từ 4 nguyên tắc tới nguyên tắc chung:
>   “Phác đồ tiêu chảy tại nhà khuyên bảo bà mẹ có 4 nguyên tắc điều trị tiêu chảy tại nhà, và nguyên tắc chung là cho trẻ uống tùy theo trẻ muốn cho tới khi ngừng tiêu chảy…”

→ Mục đích: cung cấp bối cảnh, liên kết câu hỏi với toàn bộ cấu trúc bài.

\`\`\`text
{{c1::Trẻ dưới 2 tuổi: khoảng 50 – 100 mL sau mỗi lần đi ngoài::<gợi ý (hint) cho “Trẻ dưới 2 tuổi: khoảng 50 – 100 mL sau mỗi lần đi ngoài”>}}
{{c1::Trẻ 2 – 10 tuổi: khoảng 100 – 200 mL sau mỗi lần đi ngoài::<gợi ý (hint) cho “Trẻ 2 – 10 tuổi: khoảng 100 – 200 mL sau mỗi lần đi ngoài”>}}
{{c1::Trẻ lớn: uống theo nhu cầu::<gợi ý (hint) cho “Trẻ lớn: uống theo nhu cầu”>}}
\`\`\`

---

### <Tóm tắt cấu trúc phác đồ dùng làm gốc>

\`\`\`text
Phác đồ A – Điều trị tiêu chảy tại nhà  
Phác đồ B – Điều trị có mất nước  
Phác đồ C – Điều trị cho bệnh nhân mất nước nặng
\`\`\`

---

### <Các yêu cầu bắt buộc đối với AI>

*   **Nội dung câu trả lời (phần bên trong cloze)** phải **y hệt với trong sách**.
    *   Không được tự ý sửa, tóm tắt hay diễn giải lại.
*   Nội dung **câu hỏi** có thể **linh hoạt hơn một chút** để:
    *   Dẫn dắt hợp lý,
    *   Giúp hình dung được **cấu trúc mindmap** của bài.
*   Tuyệt đối **không được tạo hallucination** trong câu trả lời.
*   **Hint** phải:
    *   Tuân thủ **cấu trúc chuẩn chất lượng** đã được mô tả,
    *   Gợi ý **vừa đủ**, để câu hỏi **không quá khó cũng không quá dễ**.
*   **Tích hợp Cloze Phân Biệt:** Trong quá trình tạo thẻ mindmap, nếu bạn phát hiện hai nhánh, hai khái niệm, hoặc hai liều lượng dễ gây nhầm lẫn, bạn có thể tạo thêm một thẻ **Cloze Phân Biệt** để đối chiếu chúng. Thẻ này là thẻ BỔ SUNG và không thay thế các thẻ mindmap chính.
*   **Gán ID và Quan hệ Cha-Con (BẮT BUỘC):**
    *   **\`cardId\`**: Với MỖI thẻ bạn tạo, hãy gán cho nó một \`cardId\` duy nhất, ngắn gọn (ví dụ: \`pedia_1\`, \`pedia_1_1\`).
    *   **\`parentId\`**: Khi bạn tạo một thẻ con (ví dụ: hỏi về các nguyên tắc của Phác đồ A), \`parentId\` của nó phải là \`cardId\` của thẻ cha (thẻ hỏi về Phác đồ A, B, C). Thẻ gốc ở cấp cao nhất của hệ thống phân cấp phải có \`parentId\` là \`null\`.
    *   Việc này là bắt buộc để tái tạo lại cấu trúc mindmap một cách chính xác.
`;
    
    const defaultStep3Prompt = `
###<Bước 3> Bước 3: Tạo và TINH CHỈNH từng thẻ Cloze.
Đây là bước sáng tạo cốt lõi, bao gồm việc tạo bản nháp và sau đó cải tiến nó để đạt chất lượng cao.

**ƯU TIÊN HÀNG ĐẦU:** Nếu bạn đã xác định được các "confusion sets" ở Bước 2, hãy ưu tiên tạo thẻ **Cloze Phân Biệt** cho chúng trước khi tiến hành tạo các thẻ khác.

## QUY TẮC CHUNG KHI TẠO THẺ CLOZE

- Luôn **khai thác nội dung tối đa** trong một \`<đề mục>\`:
  - Xác định tất cả các ý/đơn vị kiến thức quan trọng.
  - Thiết kế đủ bộ thẻ cloze để bao phủ tối đa các điểm đó (tránh bỏ sót ý quan trọng).
- Một \`<đề mục>\` **có thể và nên** được áp dụng **nhiều trường phái thẻ cloze khác nhau**, nếu phù hợp.
- Một nội dung **không bị giới hạn** chỉ dùng đúng 1 trường phái. Có thể:
  - Vừa có thẻ **cluster** tổng quát.
  - Vừa có chuỗi **overlapping** chi tiết.
  - Vừa có một số cặp **bi-directional** quan trọng.
  - Hoặc thêm cấu trúc **hierarchical** nếu nội dung mang tính phân cấp.

---

**3.1. Tạo bản nháp thẻ:**
Với mỗi đơn vị kiến thức đã sàng lọc ở Bước 2, hãy áp dụng **<HƯỚNG DẪN TẠO THẺ CLOZE VÀ GỢI Ý (HINT)>** và **<5 TRƯỜNG PHÁI THẺ CLOZE NÂNG CAO>** để tạo ra một hoặc một chuỗi **bản nháp** thẻ cloze.

**3.2. Tinh chỉnh và Cải thiện chất lượng (QUAN TRỌNG):**
Trước khi hoàn thiện thẻ, hãy **dừng lại và đối chiếu bản nháp** với các lỗi thường gặp dưới đây. **Nếu phát hiện lỗi, đừng hủy thẻ. Thay vào đó, hãy áp dụng chiến lược sửa chữa tương ứng để tạo ra một phiên bản thẻ chất lượng cao hơn.**

**CÁC LỖI THƯỜNG GẶP VÀ CÁCH SỬA CHỮA:**

*   **LỖI 1: Thiếu Ngữ Cảnh (Câu hỏi không tự đứng vững).**
    *   *Sửa chữa:* Thêm chủ đề chính (tên bệnh, hội chứng...) vào đầu câu.

*   **LỖI 2: Quá Mơ Hồ (Nhiều đáp án đúng).**
    *   *Sửa chữa:* Làm rõ khía cạnh câu hỏi, thêm "điểm neo" để định hướng.

*   **LỖI 3: Chọn Sai Vùng Cloze (Ẩn thông tin không quan trọng).**
    *   *Sửa chữa:* Xác định "từ khóa" hoặc nội dung cốt lõi nhất và chỉ cloze phần đó.

*   **LỖI 4: Cloze Quá Nhiều Từ hoặc Thẻ Quá Dài (Vi phạm Thông tin tối thiểu).**
    *   *Sửa chữa:* **"Chia để trị".** Tách một thẻ phức tạp thành một chuỗi các thẻ đơn giản.

*   **LỖI 5: Lạm dụng Thẻ Đảo Chiều (Bi-directional Misuse).**
    *   *Phát hiện:* Thẻ đảo chiều được tạo cho mối quan hệ không phải 1-đối-1.
    *   *Sửa chữa:* Hủy bỏ chiều ngược lại. Chỉ tạo thẻ một chiều cho quan hệ 1-nhiều. Chỉ giữ lại thẻ đảo chiều khi chắc chắn 100% là 1-đối-1.

*   **LỖI 6: Lạm dụng Thẻ Nhóm (Cluster Overload).**
    *   *Phát hiện:* Thẻ nhóm (cluster) chứa quá nhiều mục (trên 4-5 mục).
    *   *Sửa chữa:* Giới hạn thẻ nhóm ở 2-4 mục. Nếu danh sách dài hơn, hãy chia thành nhiều thẻ nhóm nhỏ hơn, hoặc cân nhắc dùng thẻ Chồng lấn (Overlapping) nếu có thứ tự.

*   **LỖI 7: Sai Logic Thẻ Chồng Lấn/Phân Cấp (Sequential/Hierarchical Logic Error).**
    *   *Phát hiện:* Dùng thẻ chồng lấn cho danh sách không có thứ tự, hoặc thẻ phân cấp không giữ ngữ cảnh cấp trên.
    *   *Sửa chữa:* Chỉ dùng thẻ chồng lấn cho quy trình, chuỗi có thứ tự. Với thẻ phân cấp, luôn đảm bảo thẻ con nhắc lại ngữ cảnh của thẻ cha (ví dụ: "Trong [nhóm A], triệu chứng X là...").

*   **LỖI 8: Gợi ý (Hint) Kém Chất Lượng.**
    *   *Phát hiện:* Một chỗ trống thiếu gợi ý (đặc biệt trong thẻ nhiều cloze), gợi ý quá lộ liễu, hoặc các gợi ý trong cùng một thẻ không giúp phân biệt các chỗ trống với nhau (ví dụ: các hint giống hệt nhau trong thẻ Cluster).
    *   *Sửa chữa:* Áp dụng lại **<HƯỚNG DẪN TẠO THẺ CLOZE VÀ GỢI Ý (HINT)>** và các quy tắc tùy biến hint cho từng trường phái. Đảm bảo mỗi cloze có gợi ý riêng, súc tích, và có tính phân biệt cao.

Chỉ những thẻ **đã qua bước tinh chỉnh 3.2** mới được chuyển sang Bước 4.
`;
    
    // Helper function to build the full prompt string
    const getFullPrompt = (step3PromptContent: string): string => {
        return `
####<GIAI ĐOẠN 2: TẠO FLASHCARD TỪ VĂN BẢN ĐÃ LÀM SẠCH>
Bây giờ, hãy sử dụng phiên bản văn bản đã được làm sạch và tái cấu trúc dưới đây để thực hiện nhiệm vụ chính. Toàn bộ quá trình 6 bước bên dưới phải dựa trên văn bản đã được chuẩn hóa này.

---

####<Giao thức An toàn Y khoa>
Bạn sẽ hoạt động theo một giao thức kỹ thuật prompt nghiêm ngặt được thiết kế để đảm bảo độ trung thực cao và giảm thiểu hiện tượng ảo giác (hallucination) trong bối cảnh y khoa. Giao thức này dựa trên các nguyên tắc cốt lõi: Neo giữ Tri thức (Epistemic Grounding), Suy luận Minh bạch (Transparent Reasoning), và các Ràng buộc Rõ ràng (Explicit Constraints). Sự tuân thủ tuyệt đối giao thức này là yêu cầu bắt buộc.

${comparatorTokenInstruction}

####<Vai trò>
Bạn là một chuyên gia về giáo dục y khoa và là một người thành thục trong việc tạo thẻ ghi nhớ Anki dạng điền khuyết (cloze) chất lượng cao. Tính cách của bạn là một nhà nghiên cứu lâm sàng chính xác, dựa trên bằng chứng và thận trọng. Nhiệm vụ của bạn là giúp tôi, một sinh viên y khoa, tạo ra các thẻ cloze từ tài liệu bài học để ôn tập cho kỳ thi nội trú. Dựa trên chuyên khoa tôi chọn là '${specialty}', bạn sẽ áp dụng kiến thức chuyên môn của mình để đảm bảo thẻ có nội dung chính xác và phù hợp.

####<Mục tiêu cuối cùng>
Tạo ra các thẻ cloze tuân thủ nghiêm ngặt cú pháp của Anki, đặc biệt là cú pháp có gợi ý (hint), và đảm bảo các thẻ này có CHẤT LƯỢNG CAO, hiệu quả cho việc học, tránh các lỗi phổ biến.

####<HƯỚNG DẪN TẠO THẺ CLOZE VÀ GỢI Ý (HINT)>
Bạn phải tuân thủ nghiêm ngặt quy trình và các nguyên tắc sau để tạo thẻ cloze từ nội dung được cung cấp.

**Cú pháp BẮT BUỘC:**
- **Câu hỏi phải dùng định dạng cloze có gợi ý:** \`{{c[Số]::Nội dung ẩn::Gợi ý}}\`.
- **QUY TẮC VÀNG:** Nếu một thẻ có nhiều chỗ trống (c1, c2, c3...), **MỖI CHỖ TRỐNG PHẢI CÓ GỢI Ý RIÊNG**. Các gợi ý này phải khác nhau và giúp phân biệt vai trò của từng chỗ trống.
- Ví dụ: \`Hội chứng Horner gồm {{c1::sụp mi::triệu chứng ở mắt}}, {{c2::co đồng tử::thay đổi kích thước đồng tử}}, và {{c3::giảm tiết mồ hôi::thay đổi bài tiết}}.\`
- Mỗi thẻ cloze phải được chứa trong trường \`clozeText\` của JSON.

**Nguyên tắc tạo Gợi ý (Hint) chất lượng cao:**
-   **Mục tiêu:** Gợi ý là "mồi nhử truy xuất", không phải "cứu cánh". Nó giúp kích hoạt trí nhớ, không phải nhắc bài.
-   **Đặc điểm:** Ngắn gọn, súc tích, liên quan logic đến đáp án, và quan trọng nhất là giúp **phân biệt** với các khái niệm tương tự.
-   **4 Kiểu Gợi ý hiệu quả:**
    1.  **Gợi nhóm / hệ thống:** Cung cấp danh mục cấp cao hơn (ví dụ: \`::hệ giao cảm\`, \`::thuốc ức chế men chuyển\`).
    2.  **Gợi chức năng / cơ chế:** Mô tả vai trò hoặc cơ chế bệnh sinh (ví dụ: \`::hormon hạ đường huyết\`, \`::cơ chế miễn dịch\`).
    3.  **Gợi ngữ cảnh lâm sàng:** Nêu một manh mối bệnh cảnh liên quan (ví dụ: \`::triệu chứng 3 nhiều\`).
    4.  **Gợi từ khóa phân biệt:** Dùng một từ khóa đặc trưng giúp phân biệt với các chẩn đoán khác (ví dụ: \`::không phải suy gan (như các SU)\`).

####<5 TRƯỜNG PHÁI THẺ CLOZE NÂNG CAO>
Ngoài cú pháp cơ bản, bạn phải nhận diện và áp dụng 5 trường phái thẻ cloze nâng cao sau đây khi thích hợp để xử lý các loại kiến thức phức tạp. Gợi ý cho từng trường phái cũng phải được tùy biến cho phù hợp.

**1. Thẻ Cloze Nhóm (Cluster Cloze):**
-   **Khi nào dùng:** Dùng để ẩn một "bộ dữ liệu liên quan" cần được ghi nhớ như một khối thống nhất. Lý tưởng cho các tam chứng, tứ chứng, bộ tiêu chuẩn chẩn đoán, hoặc một danh sách ngắn (2-4 mục) tạo thành một đơn vị kiến thức duy nhất.
-   **Cách làm:** Dùng **cùng một số cloze** (ví dụ: c1, c1, c1) cho tất cả các mục trong nhóm. Anki sẽ tạo một thẻ duy nhất che tất cả các phần này cùng lúc.
-   *Ví dụ:* \`Tam chứng Beck trong chèn ép tim cấp gồm: {{c1::tụt huyết áp::huyết động}}, {{c1::tĩnh mạch cổ nổi::áp lực tĩnh mạch}}, và {{c1::tiếng tim mờ::âm thanh tim}}.\`
-   **Quy tắc Gợi ý:** Gợi ý cho mỗi mục phải giúp **phân biệt các phần tử trong cùng cluster**. Tránh các gợi ý chung chung như "triệu chứng".

**2. Thẻ Cloze Chồng lấn (Overlapping Cloze):**
-   **Khi nào dùng:** Dùng cho các chuỗi hoặc danh sách có **thứ tự cố định và quan trọng**, chẳng hạn như các bước trong một quy trình (ví dụ: xử trí cấp cứu ABCDE), trình tự dẫn truyền điện tim, các giai đoạn phát triển.
-   **Cách làm:** Tạo ra một **loạt các đối tượng flashcard riêng biệt**, mỗi thẻ che một mục khác nhau trong chuỗi.
-   *Ví dụ:* Với chuỗi "SA node → AV node → Bó His", bạn sẽ tạo 3 thẻ (3 đối tượng JSON riêng biệt):
    1.  Thẻ 1: \`Trình tự dẫn truyền điện tim: {{c1::Nút xoang nhĩ (SA node)::nơi khởi phát xung động}} → Nút nhĩ thất (AV node) → Bó His.\`
    2.  Thẻ 2: \`Trình tự dẫn truyền điện tim: Nút xoang nhĩ (SA node) → {{c1::Nút nhĩ thất (AV node)::trạm trung chuyển}} → Bó His.\`
    3.  Thẻ 3: \`Trình tự dẫn truyền điện tim: Nút xoang nhĩ (SA node) → Nút nhĩ thất (AV node) → {{c1::Bó His::đường dẫn truyền xuống thất}}.\`
-   **Quy tắc Gợi ý:** Mỗi gợi ý phải là một **"mốc neo" riêng cho mỗi chỗ trống** (ví dụ: gợi ý về thời điểm, vị trí, hoặc vai trò của bước đó trong chuỗi), tránh lặp lại gợi ý giữa các thẻ kế cận.

**3. Thẻ Cloze Phân cấp (Hierarchical Cloze):**
-   **Khi nào dùng:** Dùng cho kiến thức có cấu trúc nhiều tầng (phân loại, hệ thống, sơ đồ cây). Mục tiêu là học từ tổng quát đến chi tiết.
-   **Cách làm:** Tạo các thẻ riêng biệt cho từng cấp. Thẻ ở cấp thấp hơn (chi tiết) **BẮT BUỘC** phải nhắc lại ngữ cảnh của cấp cao hơn.
-   *Ví dụ:*
    1.  **Thẻ cấp 1 (Tổng quát):** \`Phân loại sốc gồm 4 nhóm chính: {{c1::sốc giảm thể tích::do mất dịch}}, {{c1::sốc tim::do suy bơm}}, {{c1::sốc phân bố::do giãn mạch}}, và {{c1::sốc tắc nghẽn::do tắc nghẽn cơ học}}.\` (Dùng kiểu Cluster)
    2.  **Thẻ cấp 2 (Chi tiết):** \`Trong sốc giảm thể tích, các nguyên nhân chính bao gồm {{c2::mất máu::ví dụ: chấn thương}} và {{c2::mất dịch không phải máu::ví dụ: tiêu chảy}}.\` (Dùng cloze số khác)
-   **Quy tắc Gợi ý:** Gợi ý nên chỉ ra **"tầng" và "vai trò"** của kiến thức trong hệ thống phân cấp (ví dụ: \`::nhóm chính\`, \`::phân nhóm theo nguyên nhân\`).

**4. Thẻ Cloze Đảo chiều (Bi-directional Cloze):**
-   **Khi nào dùng:** Chỉ dùng cho các mối quan hệ **1-đối-1 thực sự và rõ ràng**, nơi cả hai chiều đều quan trọng cần nhớ. Ví dụ: thuật ngữ - định nghĩa đặc hiệu, bệnh - nguyên nhân đặc hiệu, thuốc - thuốc giải độc đặc hiệu.
-   **Cách làm:** Tạo **hai đối tượng flashcard riêng biệt** cho mỗi cặp.
-   *Ví dụ:* Với cặp "Lupus ban đỏ hệ thống" và "Kháng thể Anti-Smith".
    1.  **Thẻ 1 (Xuôi):** \`Kháng thể đặc hiệu nhất cho Lupus ban đỏ hệ thống là {{c1::Anti-Smith::tên kháng thể}}.\`
    2.  **Thẻ 2 (Ngược):** \`Kháng thể Anti-Smith là dấu ấn đặc hiệu nhất cho bệnh {{c1::Lupus ban đỏ hệ thống::tên bệnh tự miễn}}.\`
-   **Quy tắc Gợi ý:** Gợi ý nên hướng người học về **"chiều còn lại" một cách trừu tượng** (ví dụ: \`::tên bệnh liên quan\`, \`::yếu tố gây ra\`) mà không bật mí trực tiếp đáp án.

**5. Thẻ Cloze Phân Biệt (Disambiguation / Contrastive Cloze):**
-   **Mục tiêu:** Tạo thẻ cloze chuyên trị “dễ nhầm lẫn” bằng cách đặt 2 (tối đa 3) khái niệm/tình trạng/đối tượng rất giống nhau vào CÙNG MỘT THẺ để buộc người học phân biệt các điểm khác nhau nhỏ nhưng quan trọng (liều, đơn vị, mốc thời gian, ngưỡng, tiêu chuẩn, triệu chứng trùng nhau nhưng bối cảnh khác).
-   **Khi nào BẮT BUỘC dùng:** Khi có ít nhất 2 mục có tính tương đồng cao và dễ nhầm (overlap cao) + có các “điểm phân biệt” quan trọng để thi. Ví dụ các nhóm dễ nhầm:
    - (a) Liều/đơn vị/mốc thời gian gần nhau (1–3 giờ vs 3–6 giờ; mg/kg vs mcg/kg; mmol/L vs mEq/L).
    - (b) Cùng triệu chứng lõi nhưng bệnh khác (cùng “co giật”, cùng “rối loạn tri giác”…).
    - (c) Hai tiêu chuẩn/định nghĩa có ngưỡng lệch nhẹ (>, ≥, <, ≤; ngày thứ X vs ngày thứ Y).
-   **Cách làm (QUY TẮC THIẾT KẾ):**
    1.  Cùng một thẻ phải chứa song song 2 danh mục (A và B) và thể hiện rõ “A” và “B” là hai đối tượng khác nhau.
    2.  Cloze phải nhắm vào “điểm phân biệt” (discriminators), không tập trung vào phần trùng lặp (shared features), trừ khi cần để giữ ngữ cảnh.
    3.  Giữ thẻ gọn: ưu tiên 2 đối tượng; mỗi đối tượng 1–3 điểm phân biệt. Nếu dài → tách thành nhiều thẻ Cloze Phân Biệt nhỏ.
    4.  Gợi ý (hint) phải mang tính phân biệt cao và KHÁC NHAU giữa A và B.
        -   Nếu che “điểm phân biệt của A” thì hint phải định vị A (vd: ::điểm phân biệt của Hạ natri).
        -   Nếu che “điểm phân biệt của B” thì hint phải định vị B (vd: ::điểm phân biệt của Tăng natri).
    5.  **ĐỊNH DẠNG KHUYẾN NGHỊ:** Dạng 2 khối (A: ... {{c1::...}} ..., B: ... {{c2::...}} ...) hoặc dạng đối chiếu 1 dòng với dấu phân cách “ | ” hoặc “ || ”.
    6.  **Ràng buộc tuyệt đối về trung thực:** Nội dung dùng trong clozeText PHẢI là các mảnh NGUYÊN VĂN 100% từ tài liệu. Được phép “ghép” 2 đoạn nguyên văn từ 2 vị trí khác nhau để đặt cạnh nhau, nhưng CẤM paraphrase, CẤM đổi dấu so sánh, CẤM đổi đơn vị.
    7.  **Trích dẫn:** \`originalQuote\` phải chứa NGUYÊN VĂN phần cốt lõi của cả A và B, và in đậm đáp án.
    8.  **Tương thích:** Có thể kết hợp Cluster. Đối với Nhi khoa, Cloze Phân Biệt là thẻ BỔ SUNG, không thay thế thẻ mindmap chính và phải tuân thủ nguyên tắc "Đầy đủ" cho nhánh của nó.
-   **QUY TẮC NGUỒN DỮ LIỆU (MỚI):**
    -   Nếu có "Ngữ cảnh bổ sung" (ExtraContextText), bạn phải tìm kiếm các cặp dễ nhầm lẫn bằng cách kết hợp thông tin từ cả văn bản chính (FocusText) và ExtraContextText.
    -   Khi trích dẫn trong \`originalQuote\`, bạn phải lấy nguyên văn từ cả hai nguồn nếu cần.
    -   **BẮT BUỘC GHI NGUỒN GỐC:** Trong trường \`extraInfo\`, bạn phải thêm một dòng ghi rõ nguồn gốc. Ví dụ: "SourceSpan: A từ FocusText; B từ ExtraContextText" hoặc "SourceSpan: Cả hai từ ExtraContextText".

[MERMAID READER MODULE — apply in “Tạo thẻ Anki Cloze”]

Nếu trong input có khối mã:

\`\`\`mermaid
...
\`\`\`

thì bạn BẮT BUỘC phải “đọc hiểu” nó như một biểu diễn cấu trúc/quan hệ, và chuyển thành ngữ nghĩa rõ ràng để dùng khi tạo thẻ cloze.

Quy tắc xử lý Mermaid:

1. Nhận diện loại sơ đồ (ưu tiên nhận biết): flowchart/graph, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, pie, mindmap.
2. Trích xuất các thực thể (nodes/participants/classes/states/entities) và chuẩn hóa tên:

   * Giữ nguyên nhãn hiển thị nếu có (text trong node), tách khỏi ID kỹ thuật.
3. Trích xuất quan hệ:

   * Với flowchart/graph: mỗi cạnh A --> B / A -->|label| B là một quan hệ có hướng; label (nếu có) là điều kiện/ý nghĩa.
   * Với sequenceDiagram: actor/participant + mũi tên + message + điều kiện/loop/alt/opt (nếu có).
   * Với classDiagram/erDiagram/stateDiagram: thuộc tính, quan hệ, bội số (cardinality), chuyển trạng thái và điều kiện.
4. Xử lý cụm/nhánh:

   * subgraph, sections, grouping: giữ thông tin “nhóm” (cluster) và quan hệ cha–con.
5. Nếu Mermaid có cú pháp lỗi/khuyết: không tự bịa. Chỉ suy luận tối thiểu từ phần chắc chắn đọc được và báo “Mermaid có thể lỗi cú pháp”.
6. Đầu ra ngữ nghĩa (internal) phải gồm:

   * (a) Danh sách thực thể
   * (b) Danh sách quan hệ (dạng bộ 3: nguồn —[quan hệ/nhãn]→ đích)
   * (c) (nếu có) điều kiện/nhánh (alt/opt/decision)
7. Khi tạo cloze: được phép dùng thông tin từ Mermaid như nguồn ngữ cảnh/quan hệ để đặt câu hỏi, nhưng KHÔNG được thay đổi nội dung/ý nghĩa của Mermaid.
8. Tuyệt đối không xuất lại toàn bộ Mermaid trong đáp án, trừ khi người dùng yêu cầu. Chỉ dùng Mermaid để hiểu và tạo thẻ.

Kết thúc module.

####<TIÊU CHUẨN CHẤT LƯỢNG THẺ CLOZE BẮT BUỘC>
Đây là các tiêu chuẩn dùng để đánh giá cuối cùng ở Bước 4. Bất kỳ thẻ nào vi phạm các tiêu chuẩn này đều bị coi là "kém chất lượng" và phải bị hủy bỏ.

1.  **NỘI DUNG KHÔNG PHÙ HỢP:** Thẻ nhắm vào thông tin quá tầm thường (ai cũng biết) hoặc không "high-yield" (không quan trọng cho kỳ thi). Thẻ phải kiểm tra kiến thức chuyên sâu.
2.  **QUÁ DỄ HOẶC QUÁ RÕ RÀNG (LỘ BÀI):** Ngữ cảnh còn lại của câu vô tình tiết lộ đáp án. Người học có thể đoán ra đáp án mà không cần hồi tưởng kiến thức.
3.  **THIẾU NGỮ CẢNH HOẶC MƠ HỒ:** Câu hỏi quá ngắn hoặc không đủ thông tin khiến người học không hiểu đang được hỏi về cái gì. Có thể có nhiều đáp án hợp lý khác nhau cho cùng một chỗ trống.
4.  **QUÁ NHIỀU THÔNG TIN:** Thẻ yêu cầu nhớ nhiều chi tiết cùng lúc (ví dụ: một danh sách dài), vi phạm nguyên tắc "Thông tin tối thiểu".
    - **MIỄN TRỪ TUYỆT ĐỐI:** Quy tắc này được **BỎ QUA HOÀN TOÀN** cho ba trường hợp sau:
        1. **Thẻ Cloze Nhóm (Cluster Cloze):** Vì mục tiêu là học một khối kiến thức thống nhất.
        2. **Thẻ Cloze Phân cấp (Hierarchical Cloze):** Vì việc lồng ghép nhiều mục con là cần thiết.
        3. **Thẻ theo "cấu trúc Mindmap phân cấp" của Nhi khoa:** Vì yêu cầu là phải học thuộc lòng toàn bộ một cấp độ phân loại.
    - **Lý do:** Bản chất của các thẻ này là kiểm tra một "đơn vị kiến thức" hoặc một "cấp độ" hoàn chỉnh, do đó việc chứa nhiều thông tin là mục đích cốt lõi, không phải là lỗi.
5.  **DIỄN ĐẠT KÉM:** Câu hỏi diễn đạt lủng củng, sai ngữ pháp hoặc dùng từ ngữ không rõ ràng.

####<Bối cảnh>
Tôi là sinh viên y khoa năm cuối, đang chuẩn bị cho kỳ thi nội trú. Tôi cần tạo thẻ Anki cloze từ bài học để ghi nhớ các chi tiết quan trọng.

####<Chỉ thị>
Tôi sẽ gửi cho bạn nội dung một bài học. Bạn chỉ tập trung vào đề mục: "${focusSection}".
${customInstructionsSection}
${extraDisambiguationContextSection}
${clozePrioritySelectorModule}
####<TRIẾT LÝ LÀM VIỆC CỐT LÕI: SUY NGHĨ SÂU SẮC>
Đây là một chỉ thị meta mới và quan trọng nhất, định hình toàn bộ cách bạn làm việc. Ở mỗi bước của quy trình dưới đây, bạn phải áp dụng triết lý "Suy nghĩ sâu sắc và cẩn thận".

**"Suy nghĩ sâu sắc" có nghĩa là:**

1.  **Tự Phản Biện (Self-Critique):** Trước khi đưa ra quyết định cuối cùng (ví dụ: chọn loại thẻ, cách diễn đạt câu hỏi), hãy dừng lại một giây và tự hỏi:
    *   "Đây có phải là cách tốt nhất không?"
    *   "Có phương án nào khác hiệu quả hơn không?"
    *   "Lựa chọn này có thực sự phục vụ mục tiêu ghi nhớ sâu và lâu dài của người học không?"
    *   "Liệu có cách nào làm cho thẻ này thông minh hơn, sâu sắc hơn không?"

2.  **Thấu hiểu Người học (Learner Empathy):** Đừng chỉ xử lý văn bản một cách máy móc. Hãy đặt mình vào vị trí của một sinh viên y khoa đang ôn thi nội trú.
    *   "Điểm kiến thức nào dễ gây nhầm lẫn nhất?"
    *   "Làm thế nào để thẻ này có thể giúp làm rõ sự nhầm lẫn đó?"
    *   "Thông tin \`extraInfo\` nào sẽ thực sự 'à há' và giúp kết nối các khái niệm?"

3.  **Kết nối Chéo (Cross-Contextual Linking):** Chủ động tìm kiếm các mối liên hệ ngầm giữa các phần khác nhau của tài liệu, ngay cả khi chúng không nằm cạnh nhau. Việc này sẽ tạo ra các thẻ có giá trị cao hơn, giúp người học xây dựng một mạng lưới kiến thức, chứ không phải các mảnh ghép rời rạc.

4.  **Lập luận Rõ ràng (Clear Justification):** Với mọi quyết định quan trọng, đặc biệt là khi quyết định bỏ qua một phần nội dung, hãy chuẩn bị sẵn một lý do vững chắc và logic để trình bày trong báo cáo cuối cùng.

Hãy để triết lý này dẫn dắt mọi hành động của bạn. Chất lượng đầu ra phụ thuộc vào chiều sâu tư duy của bạn.

####<Quy trình tổng thể>
**Hãy suy nghĩ từng bước:**

###<Bước 1> Bước 1: Phân tích và Khu trú Nội dung Yêu cầu.
- **1.1. Thẩm định đề mục:** Tìm kiếm và xác định chính xác phần nội dung của đề mục "${focusSection}". Nếu không tìm thấy, dừng lại và báo cáo.
- **1.2. Khu trú nội dung:** Giới hạn phạm vi làm việc CHỈ trong phần nội dung thuộc đề mục đó.
- **1.3. Đánh giá khả năng xử lý:** Đánh giá nhanh xem lượng kiến thức có đủ để xử lý không.

###<Bước 2> Bước 2: Sàng lọc kiến thức để tạo thẻ.
Trong phần nội dung đã xác định, **đọc hiểu và chủ động tìm kiếm** các đơn vị kiến thức quan trọng. Hãy đặc biệt chú ý đến các cơ hội áp dụng **5 TRƯỜNG PHÁI THẺ CLOZE NÂNG CAO**:
- **(QUAN TRỌNG NHẤT) Tìm kiếm các cặp/nhóm dễ nhầm lẫn (confusion sets)** để áp dụng thẻ **Cloze Phân Biệt**.
- **Tìm kiếm quan hệ 1-đối-1** để áp dụng thẻ **Đảo chiều**.
- **Tìm kiếm các bộ/nhóm ngắn (2-4 mục)** như tam chứng, tiêu chuẩn để áp dụng thẻ **Nhóm**.
- **Tìm kiếm các quy trình/chuỗi có thứ tự** để áp dụng thẻ **Chồng lấn**.
- **Tìm kiếm các cấu trúc phân loại** để áp dụng thẻ **Phân cấp**.

${step3PromptContent}

###<Bước 4> Bước 4: Kiểm tra chất lượng và Sàng lọc cuối cùng.
Với MỖI thẻ bạn vừa tạo và tinh chỉnh ở Bước 3, hãy **dừng lại và tự đánh giá lần cuối** một cách nghiêm ngặt dựa trên **<TIÊU CHUẨN CHẤT LƯỢNG THẺ CLOZE BẮT BUỘC>**.
-   **Nếu thẻ vẫn còn dính vào bất kỳ tiêu chuẩn nào của một thẻ kém chất lượng → HỦY BỎ thẻ đó ngay lập tức.** Không đưa nó vào kết quả cuối cùng.
-   **Nếu thẻ vượt qua tất cả các tiêu chuẩn → GIỮ LẠI** và chuyển sang Bước 5.

###<Bước 5> Bước 5: Điền thông tin Metadata và Trích dẫn.
Với mỗi thẻ đã qua kiểm tra, hãy thực hiện vai trò "Exact Span Extractor".
1.  **Trích dẫn chính (originalQuote):** Tìm và sao chép **NGUYÊN VĂN 100%** không chỉ đoạn văn bản cốt lõi chứa câu trả lời mà cả **các ý xung quanh có liên quan chặt chẽ**. Mục tiêu là giúp giữ được bối cảnh, làm rõ mối liên kết giữa các ý. **In đậm** phần đáp án trong trích dẫn này bằng Markdown.
2.  **Trích dẫn ngữ cảnh (relatedContext):** Tìm và sao chép **NGUYÊN VĂN 100%** 1-3 đối tượng, mỗi đối tượng gồm (1) đoạn văn bản khác có liên quan trực tiếp và (2) **phân loại** của đoạn đó theo cùng quy tắc của 'questionCategory'.
3.  **Điền các Metadata còn lại:**
    - \`sourceHeading\`: Đề mục đã cho: "${focusSection}".
    - \`sourceLesson\`: Nguồn bài học đã cho: "${lessonSource}".
    ${categoryInstruction}
    - \`extraInfo\`: (Không bắt buộc) Thêm thông tin mở rộng nếu thấy cần thiết.
**QUY TẮC TRÍCH DẪN NGHIÊM NGẶT:** CẤM SÁNG TÁC, CẤM TÓM TẮT. Mọi trích dẫn phải có thể tìm lại bằng Ctrl+F trong tài liệu gốc. **CẤM THAY ĐỔI DẤU SO SÁNH (ví dụ: \`>\` thành \`≥\`).**

###<Bước 6> Bước 6: Viết Báo cáo Thanh tra & Xác minh chi tiết.
Sau khi tạo xong tất cả các thẻ, với vai trò là một thanh tra độc lập, hãy viết một báo cáo chi tiết và minh bạch. Báo cáo này hoàn toàn tách biệt với quá trình tạo thẻ. Báo cáo phải bao gồm:

1.  **Tuyên bố Xác minh:** Bắt đầu bằng một câu xác nhận rằng bạn đã hoàn thành quá trình thanh tra và các thẻ được tạo ra tuân thủ nghiêm ngặt chỉ thị, cú pháp cloze, và các tiêu chuẩn chất lượng.
2.  **Tóm tắt Kết quả:** Nêu ngắn gọn số lượng thẻ chất lượng cao đã được tạo từ đề mục được yêu cầu.
3.  **Phân tích Nội dung đã Bỏ qua (Quan trọng nhất):**
    -   Liệt kê CỤ THỂ và chi tiết những câu, đoạn văn, hoặc ý tưởng trong đề mục "${focusSection}" đã bị bỏ qua.
    -   Với mỗi mục bị bỏ qua, hãy giải thích rõ ràng và chuyên môn lý do tại sao nó không được chọn (ví dụ: "Nội dung mang tính giới thiệu, không chứa kiến thức cốt lõi", "Thông tin quá chung chung, không thể tạo thẻ cloze chất lượng theo tiêu chuẩn", "Câu chuyển tiếp, không có giá trị học thuật", "Vi phạm nguyên tắc 'Thông tin tối thiểu' vì chứa danh sách dài").
4.  **Kiểm tra Chéo và Đối chiếu:**
    -   **Độ chính xác Nội dung:** Xác nhận rằng nội dung trong mỗi thẻ anki cloze (cả phần ẩn và phần hiện) là hoàn toàn chính xác và trung thành với tài liệu gốc.
    -   **Tuân thủ Nguyên tắc:** Xác nhận rằng mỗi thẻ được tạo ra đã tuân thủ nghiêm ngặt các hướng dẫn và không vi phạm bất kỳ mục nào trong <TIÊU CHUẨN CHẤT LƯỢNG THẺ CLOZE BẮT BUỘC>.
    -   **Độ chính xác Trích dẫn:** Xác nhận rằng tất cả các trường metadata ('originalQuote', 'relatedContext', 'sourceLesson', 'sourceHeading') đều chính xác và khớp với thông tin được cung cấp và tài liệu gốc.
5.  **(Mục mới) Báo cáo Ưu tiên Cloze (Cloze Priority Audit):**
    -   Liệt kê các \`preferredClozeTypes\` đã được chuẩn hóa mà bạn nhận được.
    -   Liệt kê các lựa chọn đã bị bỏ qua do không hợp lệ với chuyên khoa (nếu có).
    -   Cung cấp một thống kê ngắn gọn về số lượng thẻ đã tạo theo từng dạng (cluster, overlapping, hierarchical, bidirectional, disambiguation, và mindmap nếu có).

Map toàn bộ báo cáo này vào trường 'report'.
####

####<Ràng buộc>
Đây là nguyên tắc quan trọng nhất: Bạn TUYỆT ĐỐI chỉ được sử dụng thông tin từ tài liệu tôi cung cấp dưới đây. KHÔNG được phép tham khảo, bổ sung, hoặc suy diễn từ bất kỳ nguồn kiến thức bên ngoài nào (internet, dữ liệu huấn luyện trước đó, sách vở khác). Mọi câu trả lời, giải thích đều phải bắt nguồn và có thể truy xuất được từ văn bản tôi đưa ra. Đây là yêu cầu bắt buộc để đảm bảo tính chính xác và an toàn trong y khoa. Tuyệt đối tránh hiện tượng ảo giác (hallucination).
**GHI ĐÈ QUAN TRỌNG:** Nếu preferredClozeTypes ở chế độ EXCLUSIVE, lựa chọn của người dùng có quyền ghi đè mọi mặc định theo chuyên khoa; với Nhi khoa, KHÔNG được tự động ép pedi_mindmap trừ khi người dùng chọn pedi_mindmap hoặc đang ở AUTO.
####

HƯỚNG DẪN CUỐI CÙNG:
Trả về kết quả LÀ MỘT ĐỐI TƯỢNG JSON HỢP LỆ chứa các trường 'flashcards' và 'report'.

DỮ LIỆU ĐẦU VÀO:
- Chuyên khoa: ${specialty}
- Đề mục cần tập trung: "${focusSection}"
- Nguồn bài học: "${lessonSource}"
- NỘI DUNG BÀI HỌC (ĐÃ ĐƯỢỢC LÀM SẠCH):
\`\`\`
${lockLesson.lockedText}
\`\`\`
`;
    };

    const step3Prompt = specialty === 'Nhi khoa' ? pediatricsStep3Prompt : defaultStep3Prompt;
    const prompt = getFullPrompt(step3Prompt);

    try {
        const config: any = {
            temperature: 0.2, 
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        };
        
        if (thinkMore && (modelName === 'gemini-3-pro-preview' || modelName === 'gemini-2.5-pro')) {
             config.thinkingConfig = { thinkingBudget: 32768 };
        }
        
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { ...config, safetySettings },
        });
        
        const rawResponseText = response.text ?? '';
        let responseTextForParsing = rawResponseText;
        let salvageWarning = '';

        const allExpectedTokens = new Set([...lockLesson.tokens, ...lockCustom.tokens, ...lockExtra.tokens]);
        const verification = verifyComparatorTokensSubset(rawResponseText, allExpectedTokens);

        if (!verification.ok) {
            const salvageResult = salvageComparatorTokenLike(rawResponseText);
            responseTextForParsing = salvageResult.text;
            if (salvageResult.replaced > 0) {
                salvageWarning = "\n[ComparatorGuard Warning] Output contained corrupted/unknown comparator tokens; salvaged to ASCII comparators before post-processing.";
            }
        }

        const auditRawOut = comparatorAuditLine('GEN_RAW_RESPONSE', responseTextForParsing);
        
        const jsonText = cleanJsonString(responseTextForParsing);
        const parsedResult = JSON.parse(jsonText) as GenerationResult;

        if (!parsedResult || !Array.isArray(parsedResult.flashcards) || typeof parsedResult.report !== 'string') {
             throw new Error("AI did not return a valid GenerationResult object.");
        }

        const unlockAll = (text: string | undefined): string => {
            if (!text) return '';
            let unlocked = lockLesson.unlock(text);
            unlocked = lockCustom.unlock(unlocked);
            unlocked = lockExtra.unlock(unlocked);
            return unlocked;
        }
        
        const postHeal = (s: string|undefined) => s ? normalizeComparators(unlockAll(s)) : s;
        const toStep2 = (s: string|undefined) => s ? formatComparatorsForOutput(postHeal(s)) : '';
        
        const finalReportText = toStep2(parsedResult.report) + salvageWarning;
        
        const auditLessonIn = comparatorAuditLine('GEN_IN_LESSON', lessonText);
        const auditLessonNorm = comparatorAuditLine('GEN_NORM_LESSON', normLesson);
        const auditFinalReport = comparatorAuditLine('GEN_FINAL_REPORT', finalReportText);

        parsedResult.report = finalReportText + `\n\n---\n${auditLessonIn}\n${auditLessonNorm}\n${auditRawOut}\n${auditFinalReport}\n`;

        parsedResult.flashcards.forEach((card: FlashcardData) => {
            card.clozeText = toStep2(card.clozeText);
            card.originalQuote = toStep2(card.originalQuote);
            card.extraInfo = toStep2(card.extraInfo);
            if (card.relatedContext) {
                card.relatedContext.forEach(ctx => {
                    ctx.quote = toStep2(ctx.quote);
                });
            }
        });

        return parsedResult;

    } catch (error) {
        console.error("Error calling Gemini API for flashcard generation:", error);
        if (error instanceof Error && error.message.includes('SAFETY')) {
            throw new Error("Không thể tạo thẻ do bộ lọc an toàn của AI. Vui lòng kiểm tra lại nội dung.");
        }
        if (error instanceof Error && error.message.includes('Comparator Integrity Error')) {
            throw error;
        }
        throw new Error("AI không thể tạo thẻ. Nội dung có thể quá phức tạp hoặc đã xảy ra lỗi mạng.");
    }
};

export const getEssayGraderResponse = async (
    mode: 'check' | 'hint' | 'hint++' | 'grade',
    documentText: string,
    section: string,
    userAnswer: string,
    history: ConversationTurn[],
    modelName: ModelName,
    thinkMore: boolean
): Promise<string | EssayGraderResult> => {

    const normDoc = normalizeComparators(documentText);
    const normAnswer = normalizeComparators(userAnswer);

    const lockDoc = lockComparators(normDoc);
    const lockAnswer = lockComparators(normAnswer);
    
    const historyString = history.map(turn => `${turn.role === 'user' ? 'Học viên' : 'Giáo sư AI'}:\n${turn.content}`).join('\n\n');

    const prompt = `### [CARD] MODULE CHẤM ĐIỂM BÀI THI TỰ LUẬN NHI KHOA

#### <Vai trò>
Bạn là **giáo sư giáo dục y khoa** trong lĩnh vực **Nhi khoa**, quen với kiểu thi tự luận nội trú (viết lại gần như nguyên văn sách giáo khoa chuẩn).
Nhiệm vụ:
1. Hỗ trợ tôi **ôn thi tự luận** dựa trên **một bài học Nhi** đã được xử lý sạch và tạo mục lục.
2. **Theo dõi và góp ý theo thời gian thực** khi tôi đang viết câu trả lời.
3. **Cung cấp gợi ý (hint)** khi tôi cần.
4. **Chấm điểm và phản hồi chi tiết** sau khi tôi “nộp bài”.

${comparatorTokenInstruction}

#### <Bối cảnh bài thi>
- Môn: **Nhi khoa – thi tự luận nội trú**.
- Cấu trúc bài học thường gồm các phần lớn: **Định nghĩa – Sinh lý bệnh – Dịch tễ – Lâm sàng (triệu chứng lâm sàng) – Cận lâm sàng – Điều trị – Tiên lượng** (có thể thay đổi chút tùy bài).
- Đề thi thường hỏi **một trong các phần lớn** ở trên, và yêu cầu thí sinh **ghi lại đầy đủ, gần sát với sách chuẩn**.

---
### DỮ LIệu NỀN TẢNG (GROUND TRUTH)
Đây là tài liệu gốc đã được làm sạch. Mọi so sánh và chấm điểm đều phải dựa vào đây.

\`\`\`xml
<NOI_DUNG_SACH_DA_LAM_SACH>
${lockDoc.lockedText}
</NOI_DUNG_SACH_DA_LAM_SACH>
\`\`\`

---
### BỐI CẢNH HIỆN TẠI
- **Phần được chọn để luyện tập:** \`<<PHAN_DUOC_CHON>>\` = "${section}"
- **Bài làm hiện tại của học viên:**
\`\`\`xml
<BAI_LAM_CUA_HOC_VIEN>
${lockAnswer.lockedText}
</BAI_LAM_CUA_HOC_VIEN>
\`\`\`
- **Lịch sử tương tác trước đó (nếu có):**
${historyString ? `\`\`\`xml\n<LICH_SU_TUONG_TAC>\n${historyString}\n</LICH_SU_TUONG_TAC>\n\`\`\`` : 'Chưa có tương tác nào.'}

---
### YÊU CẦU NHIỆM VỤ
**Chế độ yêu cầu hiện tại: \`<<CHE_DO_YEU_CAU>>\` = ${mode}**

Dựa vào chế độ này, hãy thực hiện một trong các nhiệm vụ sau. **CHỈ TRẢ VỀ NỘI DUNG PHẢN HỒI, KHÔNG LẶP LẠI PROMPT.**

#### (1) Nút **Check** – Kiểm tra đoạn trả lời hiện tại
- Khi tôi bấm **Check**, bạn:
  1. Đọc **toàn bộ nội dung tôi đã viết cho câu hỏi hiện tại** (tính tới thời điểm bấm nút).
  2. Không viết lại bài giúp tôi.
  3. Thực hiện:
     - Nhận xét xem tôi đã **đúng phạm vi** chưa (có lạc sang phần khác không).
     - Liệt kê **các nhóm ý / tiểu mục còn thiếu** ở mức độ khái quát (dạng bullet, keyword), không “xả full đáp án”.
     - Báo lỗi **nhầm vị trí nội dung** (VD: ý thuộc Điều trị nhưng tôi lại nói trong phần Lâm sàng).
     - Nhắc lại những **keyword quan trọng** mà phần này bắt buộc phải có (dựa trên \`<<NOI_DUNG_SACH_DA_LAM_SACH>>\`).

#### (2) Nút **Hint** hoặc **Hint++** – Xin gợi ý để tiếp tục viết
- Khi tôi bấm **Hint**, hiểu là:
  - Tôi đang cảm thấy **bí** hoặc **thiếu ý**, cần gợi ý để tiếp tục.
- Bạn áp dụng **triết lý tạo hint của thẻ Anki Cloze**:
  - Hint phải:
    - Định hướng lại **cấu trúc** cho đúng (VD: “Ở phần Lâm sàng nên chia: triệu chứng toàn thân – cơ năng – thực thể – biến chứng…”).
    - Gợi nhắc **keyword / cụm từ mấu chốt**, nhưng **không chép nguyên văn toàn đoạn sách**.
    - Có thể thêm chút logic / cơ chế để khơi gợi trí nhớ.
  - Không được:
    - Viết trọn vẹn **đáp án mẫu đầy đủ**.
    - Chép gần như nguyên văn toàn phần nội dung cần viết.
- Nếu là \`hint++\`, bạn có thể:
  - Cho gợi ý **cụ thể hơn**, nhưng vẫn tránh biến thành “bài mẫu”.

#### (3.0) Nút **Nộp bài** – Kết thúc, chấm điểm và nhận xét
- Khi tôi bấm **Nộp bài**, xem như tôi đã hoàn thành câu trả lời cho phần đã chọn.
- **Đầu ra:** Bắt buộc phải là một đối tượng JSON hợp lệ có hai trường: \`gradingReport\` (string) và \`srsRating\` (number).
- Bạn sẽ thực hiện quy trình sau để tạo nội dung cho các trường đó.

##### VAI TRÒ
Bạn là **Giáo sư Nhi khoa + Giáo dục y khoa** cực kỳ khó tính và dễ thất vọng. Phong cách của bạn là chuẩn mực chấm thi nội trú khắc nghiệt nhất:
- Tuyệt đối ưu tiên **đúng – đủ – sát sách**. Không có chỗ cho sự sáng tạo lan man.
- Sai là gõ thẳng, thiếu là quát thẳng. Thái độ phải phản ánh sự bực bội của một người thầy khi thấy học trò lười biếng, cẩu thả.
- Bài kém điểm thấp thì **mắng một cách thẳng thừng, không thương tiếc, thể hiện sự thất vọng ra mặt**, nhưng:
  - **Chỉ chửi vào bài làm**, không công kích phẩm giá người học.
  - Không dùng miệt thị cá nhân, không văng tục.
- Sau phần mắng bắt buộc có **phần lời khuyên từ tấm lòng** (rất thực dụng, giúp tiến bộ).

##### BỐI CẢNH
Đây là bài thi tự luận Nhi khoa nội trú. Người học phải viết lại gần sát sách chuẩn.

##### NGUỒN CHUẨN ĐỂ CHẤM (BẮT BUỘC)
Bạn chỉ được chấm dựa trên các nguồn người học cung cấp:
- \`<<NOI_DUNG_SACH_DA_LAM_SACH>>\`
- Phạm vi \`<<PHAN_DUOC_CHON>>\`

Tuyệt đối:
- **Không tự thêm guideline/kiến thức ngoài**, trừ khi được yêu cầu rõ.
- Nếu thấy có chỗ bạn không chắc trong sách gốc, **phải nói rõ mức độ không chắc**, không được bịa.

##### ĐẦU VÀO
- \`<<BAI_LAM>>\`: toàn bộ bài trả lời.
- \`<<PHAN_DUOC_CHON>>\`: phần đang được hỏi.

---
## CÁCH CHẤM (QUY TRÌNH BẮT BUỘC, KHÔNG ĐƯỢỢC BỎ BƯỚC)
Bạn sẽ thực hiện các bước sau để tạo ra nội dung cho trường \`gradingReport\`.

### Bước 1 — Dựng “khung đáp án chuẩn” từ sách
Từ \`<<NOI_DUNG_SACH_DA_LAM_SACH>>\` + phạm vi \`<<PHAN_DUOC_CHON>>\`, hãy liệt kê **các ý bắt buộc phải có** dưới dạng dàn ý, sử dụng gạch đầu dòng và thụt lề để thể hiện cấu trúc phân cấp.
> Đây là “xương sống chấm điểm”. Không có bước này coi như bạn chấm bừa.

### Bước 2 — So khớp bài làm với khung chuẩn
Đối chiếu \`<<BAI_LAM>>\` với từng ý bắt buộc:
- Mỗi ý bắt buộc phải có trạng thái:
  - ✅ **ĐÃ CÓ & ĐÚNG**
  - ⚠️ **CÓ NHƯNG SAI / MƠ HỒ / THIẾU TRỌNG TÂM**
  - ❌ **THIẾU HOÀN TOÀN**
- Với ý sai hoặc thiếu, **trích nguyên cụm từ của bài làm người học** để chỉ ra sai ở đâu.
- Nếu sai do lệch phạm vi (lạc sang phần khác), ghi rõ: “ý này thuộc phần ___ chứ không thuộc ___”.

### Bước 3 — Chấm điểm theo rubric
Chấm theo thang 0–10 cho từng tiêu chí:
1. **Độ đầy đủ so với sách** (0–10)
2. **Độ chính xác so với sách** (0–10)
3. **Bố cục – logic – phân tầng ý** (0–10)
4. **Mức độ sát văn phong sách / keyword bắt buộc** (0–10)

Tính **điểm tổng** = trung bình cộng 4 tiêu chí.
Xếp loại:
- ≥ 8.5: “Đủ sức vào phòng thi”
- 7.0–8.4: “Tạm ổn nhưng còn hở sườn”
- 5.0–6.9: “Thi là toang, phải sửa gấp”
- < 5.0: “Rớt chắc, viết như không học”

### Bước 4 — Phản hồi kiểu “giáo sư khó tính”
Phần này phải có 2 lớp:

#### 4A. **Đập thẳng vào mặt sự thật (mắng nghiêm khắc)**
- Giọng văn phải toát ra sự thất vọng và khó chịu. Viết ngắn, sắc, không nịnh.
- Dùng những câu hỏi tu từ để nhấn mạnh sự vô lý của lỗi sai.
- Nếu điểm thấp, phải nói thẳng mức độ nguy hiểm của lỗi:
  - Thiếu ý lớn = “mất điểm thô bạo, không thể chấp nhận”
  - Sai kiến thức = “rớt vì sai bản chất, không có cơ hội cứu vãn”
  - Văn lan man = “viết như thế này là thiếu tôn trọng người đọc”
- Dùng giọng tough-love: gắt, chua, đau, nhưng **nhắm vào bài làm**.

Ví dụ giọng điệu được phép:
- “Nhìn bài làm này tôi thực sự không hiểu em đã học hành kiểu gì. Kiến thức cơ bản như thế này mà cũng sai được thì tôi chịu.”
- “Em bỏ sót nguyên cả một mảng lớn là tự tay vứt điểm. Thi nội trú mà cẩu thả thế này thì ở nhà cho sớm.”
- “Bố cục lộn xộn, viết không có khung sườn. Em nghĩ giám khảo có thời gian ngồi luận xem em đang muốn nói gì à?”

- **YÊU CẦU ĐẶC BIỆT:** Nếu **điểm tổng < 7.0**, phần mắng này **BẮT BUỘC** phải bao gồm đoạn văn sau, không thêm không bớt:
  \`\`\`
  🙂Học thì dốt , làm việc thì lười biếng
  Mà lúc nào cũng muốn làm người tài giỏi
  Ngoài đời không có chuyện vô lý như vậy đâu”
  BẠN ĐỪNG CÓ MÀ MƠ👇
  \`\`\`

#### 4B. **Lời khuyên từ tấm lòng (thực dụng, tử tế)**
Sau khi mắng xong, bắt buộc chuyển giọng:
- Chỉ ra **3–5 hành động cụ thể nhất** để nâng điểm ngay.
- Nếu cần, đưa **dàn ý chuẩn rút gọn** (heading + keyword), KHÔNG viết bài mẫu full.
- Gợi ý cách luyện.

---
## ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC CHO \`gradingReport\`)

Bạn phải trả lời theo đúng 5 mục sau, không thêm mục khác, và nội dung này sẽ được đặt vào trường \`gradingReport\`:
1. **Khung đáp án chuẩn từ sách** (dàn ý)
2. **So khớp bài làm với khung chuẩn** (✅/⚠️/❌ kèm trích dẫn bài làm)
3. **Bảng chấm điểm + điểm tổng + xếp loại**
4. **Đập thẳng vào mặt sự thật (mắng nghiêm khắc)**
5. **Lời khuyên từ tấm lòng (kế hoạch sửa bài)**

---
## BƯỚC CUỐI CÙNG — Gán Rating cho Spaced Repetition (SRS)
Sau khi đã hoàn thành các bước trên, hãy thực hiện bước cuối cùng này để tạo ra giá trị cho trường \`srsRating\`.
- **QUY TẮC GÁN RATING:** Dựa vào **điểm tổng** đã tính ở Bước 3:
    - **Rating 3 (Nhớ chắc):** Nếu Điểm tổng >= 9.0.
    - **Rating 2 (Nhớ được):** Nếu 7.0 <= Điểm tổng < 9.0.
    - **Rating 1 (Nhớ mơ hồ):** Nếu 5.0 <= Điểm tổng < 7.0.
    - **Rating 0 (Quên sạch):** Nếu Điểm tổng < 5.0.
- Kết quả là một con số (0, 1, 2, hoặc 3).
`;

    const isGrading = mode === 'grade';
    const config: any = {
        temperature: isGrading ? 0.3 : 0.1,
    };
    
    if (isGrading) {
        config.responseMimeType = "application/json";
        config.responseSchema = essayGraderResponseSchema;
    }
    
    if (thinkMore && (modelName === 'gemini-3-pro-preview' || modelName === 'gemini-2.5-pro')) {
         config.thinkingConfig = { thinkingBudget: 32768 };
    }

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { ...config, safetySettings },
        });

        const rawResponseText = response.text ?? '';
        
        // Comparator Guard (Essay Grader) - OUTPUT-ONLY integrity check
        const expectedTokens = [...lockDoc.tokens, ...lockAnswer.tokens];
        const expectedSet = new Set(expectedTokens);

        const tokenRegex = /@@CMP_(?:GE|LE|GT|LT)_[0-9]{4}@@/g;
        const presentTokens = Array.from(new Set(rawResponseText.match(tokenRegex) ?? []));
        const unknownTokens = presentTokens.filter(t => !expectedSet.has(t));

        const fragmentRegex = /@{1,3}CMP_(?:GE|LE|GT|LT)_[0-9]{1,6}@{0,3}/g;
        const fragments = (rawResponseText.match(fragmentRegex) ?? []);
        const corruptedFragments = fragments.filter(f => !/^@@CMP_(?:GE|LE|GT|LT)_[0-9]{4}@@$/.test(f));

        if (unknownTokens.length > 0 || corruptedFragments.length > 0) {
          throw new Error(
            `Comparator Integrity Error (Essay Grader): Output chứa token dấu so sánh không hợp lệ.\n` +
            `- Unknown tokens: ${unknownTokens.join(', ') || '(none)'}\n` +
            `- Corrupted fragments: ${corruptedFragments.join(', ') || '(none)'}`
          );
        }

        const unlockAll = (s: string) => {
            let unlocked = lockDoc.unlock(s);
            unlocked = lockAnswer.unlock(unlocked);
            return unlocked;
        };
        
        if (isGrading) {
            const jsonText = cleanJsonString(rawResponseText);
            const parsedResult = JSON.parse(jsonText);
            if (!parsedResult || typeof parsedResult.gradingReport !== 'string' || typeof parsedResult.srsRating !== 'number') {
                throw new Error("AI did not return a valid EssayGraderResult object.");
            }
            parsedResult.gradingReport = normalizeComparators(unlockAll(String(parsedResult.gradingReport)));
            return parsedResult as EssayGraderResult;
        } else {
            return normalizeComparators(unlockAll(rawResponseText));
        }

    } catch (error) {
        console.error(`Error calling Gemini API for essay interaction (mode: ${mode}):`, error);
        if (error instanceof Error && error.message.includes('SAFETY')) {
            throw new Error("Không thể xử lý yêu cầu do bộ lọc an toàn của AI.");
        }
        if (error instanceof Error && error.message.includes('Comparator Integrity Error')) {
            throw error;
        }
        throw new Error("AI không thể phản hồi. Đã xảy ra lỗi mạng hoặc hệ thống.");
    }
};
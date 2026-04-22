const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function buildPrompt(text) {
  return `請分析以下化學品 SDS（文字或圖片內容），完成任務：
1. 危害圖式：請嚴格只從以下英文代碼挑選對應的陣列 (explos, flamme, rondflam, bottle, acid, skull, exclam, silhouete, pollu)。切勿回傳 GHS01~GHS09 等代碼。
2. 名稱, 危害成分：掃描第3節所有危害成分，格式務必為：名稱 (CAS NO.: x, 成分百分比: y%)。例如：甲醇 (CAS NO.: 67-56-1, 成分百分比: 100%)。
3. 警示語, 危害警告, 防範措施。
4. 台灣法規全成分判定 (regulatoryMatches)：針對「每一個」成分的 CAS NO. 嚴格對照以下法規，遵守顯示邏輯：
   - 「勞工作業環境空氣中有害物容許濃度標準 (PEL)」：必須顯示。有則說明濃度，無則顯示「未列入」。
   - 「勞工作業環境監測實施辦法 (強制環測)」：採「嚴格顯示」機制。只有符合附表一/二之強制監測項目才顯示。若「不符合」或「不在清單內」，則 reason 回傳 "NO_SHOW"，前端會將其完全隱藏。
   - 「特定化學物質危害預防標準」：必須顯示。有則註明類別，無則顯示「不列管」。
   - 「毒性及關注化學物質管理法」：必須顯示。有則註明類別，無則顯示「不列管」。
   - 「優先管理化學品」：必須顯示。有則說明，無則顯示「不列管」。
文字如下：${text}`;
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    pictograms: { type: "ARRAY", items: { type: "STRING" } },
    productName: { type: "STRING" },
    ingredients: { type: "ARRAY", items: { type: "STRING" } },
    signalWord: { type: "STRING" },
    hazardStatements: { type: "ARRAY", items: { type: "STRING" } },
    precautionaryStatements: { type: "ARRAY", items: { type: "STRING" } },
    supplierName: { type: "STRING" },
    supplierAddress: { type: "STRING" },
    supplierPhone: { type: "STRING" },
    compliance: {
      type: "OBJECT",
      properties: {
        isCompliant: { type: "BOOLEAN" },
        analysis: { type: "STRING" }
      }
    },
    regulatoryMatches: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ingredientName: { type: "STRING" },
          casNo: { type: "STRING" },
          regulations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                reason: { type: "STRING" }
              }
            }
          }
        }
      }
    }
  }
};

async function callGemini({ text, scannedImages }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Vercel 尚未設定 GEMINI_API_KEY');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildPrompt(text) },
              ...(Array.isArray(scannedImages) ? scannedImages : [])
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const detail =
      result?.error?.message ||
      result?.error ||
      `Gemini API 失敗 (${response.status})`;
    throw new Error(detail);
  }

  const textResult = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResult) {
    throw new Error('Gemini 沒有回傳可解析內容');
  }

  return JSON.parse(textResult);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { text = '', scannedImages = [] } = req.body || {};

    if (!text && (!Array.isArray(scannedImages) || scannedImages.length === 0)) {
      return res.status(400).json({ error: '請提供 SDS 文字或 PDF 轉出的影像內容' });
    }

    const data = await callGemini({ text, scannedImages });
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: '分析失敗',
      detail: error.message || 'Unknown server error'
    });
  }
}

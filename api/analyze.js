const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function buildPrompt(text) {
  return `請分析以下化學品 SDS（文字或圖片內容），完成任務：
1. 危害圖式：請嚴格只從以下英文代碼挑選對應的陣列 (explos, flamme, rondflam, bottle, acid, skull, exclam, silhouete, pollu)。切勿回傳 GHS01~GHS09 等代碼。
2. 名稱, 危害成分：掃描第3節所有危害成分，格式務必為：名稱 (CAS NO.: x, 成分百分比: y%)。例如：甲醇 (CAS NO.: 67-56-1, 成分百分比: 100%)。
3. 警示語, 危害警告, 防範措施。
4. 台灣法規全成分判定 (regulatoryMatches)：針對每一個成分的 CAS NO. 嚴格對照以下法規：
- 勞工作業環境空氣中有害物容許濃度標準 (PEL)：必須顯示。有則說明濃度，無則顯示「未列入」。
- 勞工作業環境監測實施辦法 (強制環測)：只有符合附表一/二之強制監測項目才顯示。若不符合，reason 回傳 "NO_SHOW"。
- 特定化學物質危害預防標準：必須顯示。有則註明類別，無則顯示「不列管」。
- 毒性及關注化學物質管理法：必須顯示。有則註明類別，無則顯示「不列管」。
- 優先管理化學品：必須顯示。有則說明，無則顯示「不列管」。

請只輸出 JSON，不要輸出任何說明文字。

文字如下：
${text}`;
}

const responseSchema = {
  type: "object",
  properties: {
    pictograms: { type: "array", items: { type: "string" } },
    productName: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    signalWord: { type: "string" },
    hazardStatements: { type: "array", items: { type: "string" } },
    precautionaryStatements: { type: "array", items: { type: "string" } },
    supplierName: { type: "string" },
    supplierAddress: { type: "string" },
    supplierPhone: { type: "string" },
    compliance: {
      type: "object",
      properties: {
        isCompliant: { type: "boolean" },
        analysis: { type: "string" }
      }
    },
    regulatoryMatches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ingredientName: { type: "string" },
          casNo: { type: "string" },
          regulations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                reason: { type: "string" }
              }
            }
          }
        }
      }
    }
  },
  required: [
    "pictograms",
    "productName",
    "ingredients",
    "signalWord",
    "hazardStatements",
    "precautionaryStatements",
    "supplierName",
    "supplierAddress",
    "supplierPhone",
    "compliance",
    "regulatoryMatches"
  ]
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
        },
        safetySettings: [
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      })
    }
  );

  const result = await response.json();

  console.log('Gemini raw result:', JSON.stringify({
    promptFeedback: result?.promptFeedback,
    candidate: result?.candidates?.[0],
    usageMetadata: result?.usageMetadata,
    modelVersion: result?.modelVersion
  }, null, 2));

  if (!response.ok) {
    const detail =
      result?.error?.message ||
      result?.error ||
      `Gemini API 失敗 (${response.status})`;
    throw new Error(detail);
  }

  if (result?.promptFeedback?.blockReason) {
    throw new Error(`Gemini 擋下了輸入：${result.promptFeedback.blockReason}`);
  }

  const candidate = result?.candidates?.[0];

  if (!candidate) {
    throw new Error('Gemini 沒有回傳 candidate');
  }

  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(
      `Gemini 結束原因：${candidate.finishReason}` +
      (candidate.finishMessage ? `（${candidate.finishMessage}）` : '')
    );
  }

  const textResult = candidate?.content?.parts?.find(
    p => typeof p?.text === 'string' && p.text.trim()
  )?.text;

  if (!textResult) {
    throw new Error('Gemini 有回應，但內容是空的。請到 Vercel Logs 查看 finishReason / promptFeedback。');
  }

  try {
    return JSON.parse(textResult);
  } catch (e) {
    console.error('JSON parse failed. Raw text:', textResult);
    throw new Error('Gemini 有回文字，但不是合法 JSON');
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      route: '/api/analyze',
      message: 'API route is alive. Use POST to analyze SDS.'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method Not Allowed',
      detail: 'Use POST /api/analyze'
    });
  }

  try {
    const { text = '', scannedImages = [] } = req.body || {};

    if (!text && (!Array.isArray(scannedImages) || scannedImages.length === 0)) {
      return res.status(400).json({
        error: '請提供 SDS 文字或 PDF 轉出的影像內容'
      });
    }

    const data = await callGemini({ text, scannedImages });
    return res.status(200).json(data);
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(500).json({
      error: '分析失敗',
      detail: error.message || 'Unknown server error'
    });
  }
}

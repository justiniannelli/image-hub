// Model providers. Each returns { mime, buffer, model }.
// refs: [{ mime, data: Buffer }]

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function config() {
  return {
    gemini: {
      enabled: !!process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    },
    openai: {
      enabled: !!process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    },
  };
}

// fetch with a time limit, so a request the AI never answers fails with a clear message instead of hanging.
async function timedFetch(url, options, ms = 120000) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`The AI didn't answer within ${ms / 1000} seconds. It may be busy; try again in a minute.`);
    }
    throw new Error(`Couldn't reach the AI service (${e.cause?.code || e.message}). Check the internet connection.`);
  }
}

async function readError(res) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j.error?.message || text;
  } catch {
    return text.slice(0, 500);
  }
}

async function geminiGenerate({ prompt, refs, aspect }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  const model = config().gemini.model;

  const parts = [{ text: prompt }];
  for (const r of refs) parts.push({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } });

  const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
  if (aspect && aspect !== 'auto') generationConfig.imageConfig = { aspectRatio: aspect };

  const res = await timedFetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  });
  if (!res.ok) throw new Error(`Gemini error (${res.status}): ${await readError(res)}`);

  const json = await res.json();
  const outParts = json.candidates?.[0]?.content?.parts || [];
  const img = outParts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!img) {
    const said = outParts.map((p) => p.text).filter(Boolean).join(' ');
    const why = json.promptFeedback?.blockReason || json.candidates?.[0]?.finishReason || '';
    throw new Error(`Gemini returned no image. ${why} ${said}`.trim());
  }
  const d = img.inlineData || img.inline_data;
  return { mime: d.mimeType || d.mime_type || 'image/png', buffer: Buffer.from(d.data, 'base64'), model };
}

function openaiSize(aspect) {
  if (['16:9', '4:3', '3:2', '21:9'].includes(aspect)) return '1536x1024';
  if (['9:16', '3:4', '2:3'].includes(aspect)) return '1024x1536';
  if (aspect === '1:1') return '1024x1024';
  return 'auto';
}

async function openaiGenerate({ prompt, refs, aspect }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const model = config().openai.model;
  const size = openaiSize(aspect);

  let res;
  if (refs.length) {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('size', size);
    refs.slice(0, 16).forEach((r, i) => {
      const ext = r.mime.split('/')[1] || 'png';
      fd.append('image[]', new Blob([r.data], { type: r.mime }), `ref${i}.${ext}`);
    });
    res = await timedFetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
  } else {
    res = await timedFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    });
  }
  if (!res.ok) throw new Error(`OpenAI error (${res.status}): ${await readError(res)}`);

  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return { mime: 'image/png', buffer: Buffer.from(b64, 'base64'), model };
}

export async function generateImage(provider, args) {
  if (provider === 'gemini') return geminiGenerate(args);
  if (provider === 'openai') return openaiGenerate(args);
  throw new Error(`Unknown provider: ${provider}`);
}

const ASSIST_SYSTEM =
  'You are an image generation prompt assistant for an architecture and design studio. ' +
  'Help the user write clear, specific prompts for AI image models: subject, composition, camera or view, ' +
  'materials, lighting, color (use hex codes when given), and medium. Keep replies short. ' +
  'When you propose a prompt, put the final prompt alone in a fenced block so it can be copied.';

const IMPROVE_SYSTEM =
  'Rewrite the user\'s image request into one detailed prompt for an AI image model. ' +
  'Keep their intent and every specific detail (colors, hex codes, materials, names, text to render). ' +
  'Add only what helps: composition and camera, materials, lighting, and medium. ' +
  'If reference images are mentioned, say how to use them (e.g. keep the exact layout and camera). ' +
  'Avoid long lists of things not to do. Reply with the prompt only, no preamble or quotes.';

// "Auto-improve": returns a richer prompt, or the original if Gemini isn't configured or fails.
export async function improvePrompt(prompt) {
  if (!process.env.GEMINI_API_KEY) return prompt;
  try {
    const out = await assist([{ role: 'user', content: prompt }], '', IMPROVE_SYSTEM);
    return out.trim() || prompt;
  } catch (e) {
    console.warn('Auto-improve failed, using the original prompt:', e.message);
    return prompt;
  }
}

export async function assist(messages, styleNotes, systemOverride) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Prompt assistant needs GEMINI_API_KEY');
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
  const system = (systemOverride || ASSIST_SYSTEM) + (styleNotes ? `\n\nAvailable saved styles the user can cite with @name:\n${styleNotes}` : '');
  const res = await timedFetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content) }],
      })),
    }),
  });
  if (!res.ok) throw new Error(`Assistant error (${res.status}): ${await readError(res)}`);
  const json = await res.json();
  return (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).filter(Boolean).join('\n');
}

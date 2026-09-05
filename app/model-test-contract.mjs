// Shared display/request contract: a diagnostic only, never a Shot acceptance rule.
export const MODEL_TEST_CASE_ID = 'connectivity-json-v1';
export const MODEL_TEST_EXPECTED = '{"ok":true}';
export const MODEL_TEST_RULES = '只返回一个 JSON 对象；仅允许 ok 字段，值必须为布尔值 true（不是字符串）。禁止额外字段、说明文字、Markdown 代码块及 Q1/Q2/Q3 等问答。允许 JSON 内合法空白与换行。';
export const MODEL_TEST_PROMPT = `测试编号：${MODEL_TEST_CASE_ID}。这是独立 API 连通性与输出格式测试，不是项目或 Shot 创作任务。无须读取文件、联网或调用外部工具。\n${MODEL_TEST_RULES}\n唯一目标 JSON：${MODEL_TEST_EXPECTED}\n若接口提供指定的结构化返回工具，只用该工具提交同一个对象；不要另加解释。`;
export const MODEL_TEST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: { ok: { type: 'boolean', const: true, description: 'Must be boolean true, not the string "true".' } },
};

export function modelTestFormatMatches(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) && value.ok === true && Object.keys(value).length === 1;
  } catch { return false; }
}

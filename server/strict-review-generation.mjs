export const REVIEW_CHECKS = ['sourceBoundary', 'characterContinuity', 'timingFeasible', 'dialogueFeasible', 'cameraAndActionCoherent', 'soundAndNegativeComplete'];

// The provider's identity is server-owned routing metadata, not a model judgment.
// Fill only an omitted ID; a conflicting ID must still fail normal validation.
export function bindReviewerIdentity(candidate, reviewerId) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  if (Object.hasOwn(candidate, 'reviewerId')) return candidate;
  if (typeof reviewerId !== 'string' || !reviewerId.trim()) throw new Error('缺少服务端 Reviewer 身份');
  return { ...candidate, reviewerId };
}

// These are request budgets, not a claim about a model's maximum capability.
export function strictReviewTokenBudget(provider, configured) {
  const floor = provider === 'glm' || provider === 'jiekou-anthropic' ? 65_536 : 32_768;
  return Math.min(65_536, Math.max(floor, Number(configured) || floor));
}

export async function generateStrictReview({ prompt, schema, generate, validate, onProgress = () => {} }) {
  try {
    const result = await generate(prompt, schema, 'full');
    validate(result);
    return result;
  } catch (error) {
    // Only a confirmed terminal length stop permits another model call.
    // Network failures have unknown outcomes and must not auto-resubmit.
    if (error?.code !== 'output_limit') throw error;
    onProgress('review-recovery', '输出预算已用尽，开始分项补审（保留整个 Shot 和全部证据）');
  }
  const groups = [REVIEW_CHECKS.slice(0, 2).concat(REVIEW_CHECKS[4]), [REVIEW_CHECKS[2], REVIEW_CHECKS[3], REVIEW_CHECKS[5]]];
  const results = [];
  for (let i = 0; i < groups.length; i++) {
    const keys = groups[i];
    const partialSchema = structuredClone(schema);
    const checks = partialSchema.properties.report.properties.checks;
    checks.required = keys;
    checks.properties = Object.fromEntries(keys.map(key => [key, { type: 'boolean' }]));
    partialSchema.properties.report.properties.findings.maxItems = 6;
    onProgress('review-recovery', `分项补审 ${i + 1}/2：${i ? '时长、对白与声音禁止项' : '剧情边界、人物连续性与镜头动作'}`);
    const result = await generate(`${prompt}\n\n系统审核分项调度（非素材）：本次只负责 ${keys.join('、')}。全部画格和整份提示词仍是证据；不改变 Shot。checks 只返回这三个键，问题只列本阶段负责的检查项，合并重复问题，每项 detail 与 suggestion 简洁明确，不复述整份提示词。其他检查项由另一个阶段完成，本阶段不得替其下结论。`, partialSchema, `part-${i + 1}`);
    const actual = Object.keys(result?.report?.checks || {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) throw new Error('分项审核检查项不完整');
    // Validate identity, evidence coverage and findings with the normal validator.
    // Placeholder checks exist only in this validation copy, never in final data.
    validate({ ...result, report: { ...result.report, checks: { ...Object.fromEntries(REVIEW_CHECKS.map(k => [k, true])), ...result.report.checks } } });
    results.push(result);
  }
  const findings = results.flatMap((result, index) => result.report.findings.map(f => ({ ...f, id: `part-${index + 1}-${f.id}` })));
  const merged = {
    ...results[0],
    report: {
      verdict: results.some(r => r.report.verdict === 'needs-revision') ? 'needs-revision' : 'discussion-ready',
      summary: results.map(r => r.report.summary).join('\n'),
      strengths: [...new Set(results.flatMap(r => r.report.strengths))].slice(0, 6),
      checks: Object.assign({}, ...results.map(r => r.report.checks)),
      findings,
    },
  };
  validate(merged);
  return merged;
}

export function modelTestStatusLabel(result, available) {
  if (!result) return available ? '未测试' : '未配置';
  if (result.status === 'succeeded') return '接口正常　格式正常✅';
  if (result.status === 'format_warning') return '接口正常　格式错误⚠️';
  // This exact legacy error was emitted only after a successful provider return.
  if (result.status === 'failed' && result.error === '返回内容未通过测试格式校验') return '接口正常　格式错误⚠️';
  if (result.status === 'failed') return '接口错误　格式错误❌';
  return ({ queued: '排队中', running: '测试中', skipped: '未配置／跳过', interrupted: '已中断，结果未知' })[result.status] || '结果未知';
}

/**
 * /api/image —— AI 生图占位端点（阶段 B 预留，未接入真实模型）
 *
 * 与 /api/grade 同款策略：**永远不发起任何外部请求**，返回明确的 not_implemented，
 * 前端据此显示 SVG 占位（心魔/灵兽形态）。等真实接入时，本文件与前端开关
 * `AI_IMAGE_ENABLED`（当前 false）一起打开即可。
 *
 * 返回示例：
 *   200 { "status": "not_implemented", "message": "AI 生图接口预留，未接入真实模型" }
 */
export async function onRequestPost() {
  return new Response(
    JSON.stringify({
      status: 'not_implemented',
      message: 'AI 生图接口预留，未接入真实模型',
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
}
/** Client-side prompts (docs/SPEC.md 11.8). Server-side prompts live in server/app/prompts. */

const TARGET_NAME: Record<"zh" | "en", string> = { zh: "简体中文", en: "English" };

export function translateSystemPrompt(target: "zh" | "en", pageText?: string, contextKind: "page" | "transcript" = "page"): string {
  let p = `你是学术文本翻译助手。把用户给出的文本翻译成${TARGET_NAME[target]}，保留术语的原文（用括号附在译文后），保留公式和代码原样，不要添加解释。只输出译文。`;
  if (pageText) p += contextKind === "transcript"
    ? `\n下面是同一段录音中当前句之前的少量上下文，只用于理解术语和指代。不要翻译、复述或补写上下文，只输出用户消息中当前句的译文：\n${pageText.slice(-800)}`
    : `\n这段文字来自下面这页课件：\n${pageText.slice(0, 800)}`;
  return p;
}

export function explainSystemPrompt(target: "zh" | "en", pageText?: string): string {
  let p = `你是帮助大学生理解课件的助教。用户给出课件里的一段文字，用${TARGET_NAME[target]}解释它在说什么，≤ 4 句，术语保留原文。如果文字本身是个定义或公式，先用一句话说明它的直观含义，再说明关键项。只输出解释。`;
  if (pageText) p += `\n这段文字来自下面这页课件：\n${pageText.slice(0, 800)}`;
  return p;
}

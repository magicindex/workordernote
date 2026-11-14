import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * AI 回复里的 Markdown 渲染。
 *
 * 模型经常按 Markdown 作答（`**加粗**`、`1. 列表`、代码块、表格），而聊天气泡原来
 * 是纯文本（`{{ msg.content }}`），用户看到的是原始星号。这里用 marked 转成 HTML，
 * 再交给 DOMPurify 清洗：模型输出属于外部内容，绝不能直接 `v-html`。
 *
 * 只放行聊天里常见的结构（段落 / 加粗 / 斜体 / 列表 / 标题 / 引用 / 代码 / 表格 / 链接），
 * 不放行图片、内联样式、事件属性；链接统一加 `target=_blank` 与 `rel=noopener noreferrer`。
 */
marked.setOptions({ gfm: true, breaks: true })

if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre',
  'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'class']

/** 把一段 Markdown 变成可安全放进气泡的 HTML。空文本返回空串。 */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  // marked 默认同步解析；显式 async:false 保证返回字符串（类型上仍可能是 Promise）。
  const html = marked.parse(text, { async: false, gfm: true, breaks: true })
  return DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })
}

import React from 'react';

/** 将行内 **加粗** 转为 <strong>，并清除多余的残留星号，保证绝不显示原始 ** 符号。 */
function renderInline(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index).replace(/\*\*/g, ''));
    }
    parts.push(<strong key={key++}>{match[1].trim()}</strong>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex).replace(/\*\*/g, ''));
  }
  return parts.length ? parts : line.replace(/\*\*/g, '');
}

/** 轻量级 AI 正文排版组件：将标题、列表与加粗渲染为清爽卡片排版，无原始 ** / ### 杂字符。 */
export default function RichAiText({ text }: { text: string }) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-*_]{3,}$/.test(line));

  if (!lines.length) return null;

  return (
    <div className="ai-rich-text">
      {lines.map((rawLine, index) => {
        // 1) Markdown 标题（### 标题）或【短标题】或整行加粗标题（**游览顺序**）
        const mdHeading = rawLine.match(/^#{1,6}\s+(.+)$/);
        if (mdHeading) {
          return (
            <h4 className="ai-rich-heading" key={index}>
              {mdHeading[1].replace(/\*\*/g, '').replace(/^【|】$/g, '').trim()}
            </h4>
          );
        }
        const bracketHeading = rawLine.match(/^【([^】]{1,24})】[:：]?$/);
        if (bracketHeading) {
          return (
            <h4 className="ai-rich-heading" key={index}>
              {bracketHeading[1].trim()}
            </h4>
          );
        }
        const boldOnlyHeading = rawLine.match(/^\*\*([^*]{2,26})\*\*[:：]?$/);
        if (boldOnlyHeading) {
          return (
            <h4 className="ai-rich-heading" key={index}>
              {boldOnlyHeading[1].trim()}
            </h4>
          );
        }

        // 2) 有序列表（1. / 1、）
        const ordered = rawLine.match(/^(\d+)[.、)）]\s*(.+)$/);
        if (ordered) {
          return (
            <div className="ai-rich-item" key={index}>
              <span className="ai-rich-bullet">{ordered[1]}.</span>
              <span>{renderInline(ordered[2])}</span>
            </div>
          );
        }

        // 3) 无序列表（- / * / •）
        const bullet = rawLine.match(/^[-*•·]\s+(.+)$/);
        if (bullet) {
          return (
            <div className="ai-rich-item" key={index}>
              <span className="ai-rich-bullet">•</span>
              <span>{renderInline(bullet[1])}</span>
            </div>
          );
        }

        // 4) 普通段落
        return (
          <p className="ai-rich-para" key={index}>
            {renderInline(rawLine)}
          </p>
        );
      })}
    </div>
  );
}

import { useState, useCallback, useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';

interface MarkdownEditorProps {
  content: string;
  editable: boolean;
  onSave?: (content: string) => Promise<void>;
}

export default function MarkdownEditor({ content, editable, onSave }: MarkdownEditorProps) {
  const [text, setText] = useState(content);
  const [mode, setMode] = useState<'edit' | 'preview'>(editable ? 'edit' : 'preview');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== content;

  // Sync content when file reloads after save
  useEffect(() => {
    if (!dirty) setText(content);
  }, [content]);

  const handleSave = useCallback(async () => {
    if (!onSave || !dirty) return;
    setSaving(true);
    try {
      await onSave(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [text, onSave, dirty]);

  // Cmd/Ctrl+S to save
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && mode === 'edit') {
      ta.style.height = 'auto';
      ta.style.height = Math.max(400, ta.scrollHeight) + 'px';
    }
  }, [text, mode]);

  // Tab key inserts spaces
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newText = text.substring(0, start) + '  ' + text.substring(end);
      setText(newText);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex bg-zinc-900 rounded-lg border border-zinc-800 p-0.5">
          {editable && (
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'edit' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Edit
            </button>
          )}
          <button
            onClick={() => setMode('preview')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === 'preview' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Preview
          </button>
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-emerald-400 animate-in">Saved</span>
          )}
          {editable && onSave && dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3.5 py-1.5 bg-emerald-500 text-black text-xs font-medium rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="editor-textarea w-full bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-5 text-sm text-zinc-200 resize-none focus:outline-none focus:border-zinc-700 transition-colors"
          placeholder="Start writing markdown..."
          spellCheck={false}
        />
      ) : (
        <div
          className="prose prose-sm prose-agentdrive max-w-none bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-5"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdownToHtml(text)) }}
        />
      )}

      {editable && mode === 'edit' && (
        <p className="text-[11px] text-zinc-700 mt-2 text-right">
          {dirty ? 'Unsaved changes' : 'Up to date'} · ⌘S to save
        </p>
      )}
    </div>
  );
}

function markdownToHtml(md: string): string {
  let html = md;

  // Fenced code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists: collect consecutive list items
  html = html.replace(/((?:^- .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li>${line.replace(/^- /, '')}</li>`
    ).join('');
    return `<ul>${items}</ul>`;
  });

  html = html.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(line =>
      `<li>${line.replace(/^\d+\. /, '')}</li>`
    ).join('');
    return `<ol>${items}</ol>`;
  });

  // Paragraphs: wrap remaining text lines
  html = html.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|div|table|thead|tbody|tr|th|td)/.test(trimmed)) {
      return trimmed;
    }
    return `<p>${trimmed}</p>`;
  }).join('\n');

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

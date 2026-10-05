import React, { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, ChevronUp, Italic, PlusCircle, Strikethrough, Trash2 } from 'lucide-react';
import { createEditor, Editor } from 'slate';
import { Slate, Editable, withReact, useSlate } from 'slate-react';
import { withHistory } from 'slate-history';
import type { RenderLeafProps } from 'slate-react';
import type { BlockNode, ContentStyle, RichTextDocument, RichTextLeaf, RichTextValue } from '../../types';
import {
  COLOR_SWATCHES,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  SPACING_OPTIONS,
  hasRichFormatting,
  leafClassName,
  leafInlineStyle,
  normalizeBlocks,
  normalizeContentStyle,
  normalizeHexColor,
  normalizeRichText,
  richTextToPlainText,
} from './contentSchema';

function withInlineParagraphs(editor: Editor) {
  editor.insertBreak = () => {};
  return editor;
}

function ToolbarButton({
  active,
  children,
  onClick,
  disabled,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition-colors ${
        active ? 'border-un-blue bg-un-light text-un-blue' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function ToolbarField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-[5.1rem] flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function ModeToggle({
  mode,
  onSimple,
  onFull,
}: {
  mode: 'simple' | 'full';
  onSimple: () => void;
  onFull: () => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
      <button
        type="button"
        onClick={onSimple}
        className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === 'simple' ? 'bg-un-blue text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        Simple Editor
      </button>
      <button
        type="button"
        onClick={onFull}
        className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === 'full' ? 'bg-un-blue text-white' : 'text-gray-600 hover:bg-gray-50'}`}
      >
        Full Editor
      </button>
    </div>
  );
}

const NEW_BLOCKS: Array<{ type: BlockNode['type']; label: string }> = [
  { type: 'paragraph', label: 'Paragraph' },
  { type: 'heading', label: 'Heading' },
  { type: 'bulleted_list', label: 'Bulleted List' },
  { type: 'numbered_list', label: 'Numbered List' },
  { type: 'quote', label: 'Quote' },
  { type: 'callout', label: 'Callout' },
  { type: 'image', label: 'Image' },
  { type: 'cta_group', label: 'CTA Group' },
];

function createEmptyDocument(text = ''): RichTextDocument {
  return [{ type: 'paragraph', children: [{ text }] }];
}

function createBlock(type: BlockNode['type']): BlockNode {
  const style = normalizeContentStyle({});
  switch (type) {
    case 'heading': return { type, content: createEmptyDocument(), level: 2, style };
    case 'bulleted_list': return { type, items: [createEmptyDocument()], style };
    case 'numbered_list': return { type, items: [createEmptyDocument()], style };
    case 'quote': return { type, content: createEmptyDocument(), style };
    case 'callout': return { type, content: createEmptyDocument(), tone: 'info', style };
    case 'image': return { type, url: '', alt: '', caption: '', style };
    case 'cta_group': return { type, ctas: [{ label: '', href: '', variant: 'primary' }], style };
    default: return { type: 'paragraph', content: createEmptyDocument(), style };
  }
}

function toggleMark(editor: Editor, key: 'bold' | 'italic' | 'strike') {
  const marks = Editor.marks(editor) as Partial<RichTextLeaf> | null;
  const active = Boolean(marks?.[key]);
  if (active) Editor.removeMark(editor, key);
  else Editor.addMark(editor, key, true);
}

function setLeafMark<T extends 'color' | 'font_family_token' | 'font_size_token'>(editor: Editor, key: T, value?: RichTextLeaf[T]) {
  if (!value) {
    Editor.removeMark(editor, key);
    return;
  }
  Editor.addMark(editor, key, value);
}

function RichLeaf({ attributes, children, leaf }: { attributes: RenderLeafProps['attributes']; children: React.ReactNode; leaf: RichTextLeaf }) {
  return (
    <span {...attributes} className={leafClassName(leaf)} style={leafInlineStyle(leaf)}>
      {children}
    </span>
  );
}

function FullEditorToolbar({
  style,
  onStyleChange,
  disabled,
}: {
  style?: ContentStyle;
  onStyleChange: (style: ContentStyle) => void;
  disabled?: boolean;
}) {
  const editor = useSlate();
  const marks = (Editor.marks(editor) as Partial<RichTextLeaf> | null) || {};
  const normalizedStyle = normalizeContentStyle(style);
  const currentColor = normalizeHexColor(marks.color) || '#111827';

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white px-2 py-2">
      <ToolbarField label="Font">
        <select
          value={marks.font_family_token || 'inter'}
          onChange={(event) => setLeafMark(editor, 'font_family_token', event.target.value as RichTextLeaf['font_family_token'])}
          disabled={disabled}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          {FONT_FAMILY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </ToolbarField>
      <ToolbarField label="Size">
        <select
          value={marks.font_size_token || '16'}
          onChange={(event) => setLeafMark(editor, 'font_size_token', event.target.value as RichTextLeaf['font_size_token'])}
          disabled={disabled}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          {FONT_SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </ToolbarField>
      <ToolbarField label="Color">
        <div className="flex items-center gap-1">
          <input
            type="color"
            value={currentColor}
            onChange={(event) => setLeafMark(editor, 'color', event.target.value)}
            disabled={disabled}
            className="h-8 w-10 rounded-md border border-gray-300 bg-white p-1"
          />
          <div className="flex items-center gap-1">
            {COLOR_SWATCHES.slice(0, 4).map((swatch) => (
              <button
                key={swatch}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setLeafMark(editor, 'color', swatch);
                }}
                className={`h-6 w-6 rounded-full border ${currentColor === swatch ? 'border-un-blue ring-2 ring-un-blue/25' : 'border-gray-200'}`}
                style={{ backgroundColor: swatch }}
                title={swatch}
              />
            ))}
          </div>
        </div>
      </ToolbarField>
      <ToolbarField label="Spacing">
        <select
          value={normalizedStyle.spacing_token}
          onChange={(event) => onStyleChange({ ...normalizedStyle, spacing_token: event.target.value as ContentStyle['spacing_token'] })}
          disabled={disabled}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          {SPACING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </ToolbarField>
      <ToolbarField label="Align">
        <div className="flex items-center gap-1">
          <ToolbarButton active={normalizedStyle.text_align === 'left'} onClick={() => onStyleChange({ ...normalizedStyle, text_align: 'left' })} disabled={disabled} title="Align left">
            <AlignLeft size={14} />
          </ToolbarButton>
          <ToolbarButton active={normalizedStyle.text_align === 'center'} onClick={() => onStyleChange({ ...normalizedStyle, text_align: 'center' })} disabled={disabled} title="Align center">
            <AlignCenter size={14} />
          </ToolbarButton>
          <ToolbarButton active={normalizedStyle.text_align === 'right'} onClick={() => onStyleChange({ ...normalizedStyle, text_align: 'right' })} disabled={disabled} title="Align right">
            <AlignRight size={14} />
          </ToolbarButton>
        </div>
      </ToolbarField>
      <ToolbarField label="Style">
        <div className="flex items-center gap-1">
          <ToolbarButton active={Boolean(marks.bold)} onClick={() => toggleMark(editor, 'bold')} disabled={disabled} title="Bold">
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton active={Boolean(marks.italic)} onClick={() => toggleMark(editor, 'italic')} disabled={disabled} title="Italic">
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton active={Boolean(marks.strike)} onClick={() => toggleMark(editor, 'strike')} disabled={disabled} title="Strike">
            <Strikethrough size={14} />
          </ToolbarButton>
        </div>
      </ToolbarField>
    </div>
  );
}

function SlateRichTextEditor({
  value,
  onChange,
  style,
  onStyleChange,
  disabled,
  placeholder,
}: {
  value?: RichTextValue | null;
  onChange: (next: RichTextDocument) => void;
  style?: ContentStyle;
  onStyleChange: (style: ContentStyle) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [editor] = useState(() => withInlineParagraphs(withHistory(withReact(createEditor()))));
  const document = normalizeRichText(value);
  const serializedExternal = JSON.stringify(document);
  const [editorValue, setEditorValue] = useState<RichTextDocument>(document);
  const [editorInstanceKey, setEditorInstanceKey] = useState(0);
  const lastSyncedValueRef = useRef(serializedExternal);

  useEffect(() => {
    if (lastSyncedValueRef.current === serializedExternal) return;
    lastSyncedValueRef.current = serializedExternal;
    setEditorValue(document);
    setEditorInstanceKey((current) => current + 1);
  }, [document, serializedExternal]);

  return (
    <Slate
      key={editorInstanceKey}
      editor={editor}
      initialValue={editorValue}
      onChange={(nextValue) => {
        const normalizedNext = nextValue as RichTextDocument;
        setEditorValue(normalizedNext);
        lastSyncedValueRef.current = JSON.stringify(normalizedNext);
        onChange(normalizedNext);
      }}
    >
      <div className="space-y-2">
        <FullEditorToolbar style={style} onStyleChange={onStyleChange} disabled={disabled} />
        <div className="rounded-xl border border-gray-300 bg-white px-3 py-2">
          <Editable
            readOnly={disabled}
            placeholder={placeholder}
            renderLeaf={(props) => <RichLeaf {...props} />}
            className="min-h-[5rem] text-sm outline-none"
            onKeyDown={(event) => {
              if (!(event.ctrlKey || event.metaKey)) return;
              const key = event.key.toLowerCase();
              if (key === 'b') {
                event.preventDefault();
                toggleMark(editor, 'bold');
              }
              if (key === 'i') {
                event.preventDefault();
                toggleMark(editor, 'italic');
              }
            }}
          />
        </div>
      </div>
    </Slate>
  );
}

export default function BlockEditor({ blocks, onChange, disabled = false }: { blocks: BlockNode[]; onChange: (blocks: BlockNode[]) => void; disabled?: boolean }) {
  const normalizedBlocks = normalizeBlocks(blocks);
  const [editorModes, setEditorModes] = useState<Record<string, 'simple' | 'full'>>({});

  function update(index: number, next: BlockNode) {
    const updated = [...normalizedBlocks];
    updated[index] = next;
    onChange(updated);
  }

  function updateListItem(index: number, itemIndex: number, nextValue: RichTextDocument) {
    const block = normalizedBlocks[index];
    if (block.type !== 'bulleted_list' && block.type !== 'numbered_list') return;
    const items = [...block.items];
    items[itemIndex] = nextValue;
    update(index, { ...block, items });
  }

  function getMode(key: string, value?: RichTextValue | null) {
    if (editorModes[key]) return editorModes[key];
    return hasRichFormatting(value) ? 'full' : 'simple';
  }

  function setMode(key: string, mode: 'simple' | 'full') {
    setEditorModes((current) => ({ ...current, [key]: mode }));
  }

  function collapseToSimple(value?: RichTextValue | null) {
    return createEmptyDocument(richTextToPlainText(value));
  }

  return (
    <div className="space-y-3">
      {normalizedBlocks.map((block, index) => (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{block.type.replace('_', ' ')}</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => index > 0 && onChange(normalizedBlocks.map((item, idx) => idx === index ? normalizedBlocks[index - 1] : idx === index - 1 ? normalizedBlocks[index] : item))} disabled={disabled || index === 0} className="rounded-lg p-1 text-gray-400 hover:bg-white disabled:opacity-30"><ChevronUp size={14} /></button>
              <button type="button" onClick={() => index < normalizedBlocks.length - 1 && onChange(normalizedBlocks.map((item, idx) => idx === index ? normalizedBlocks[index + 1] : idx === index + 1 ? normalizedBlocks[index] : item))} disabled={disabled || index === normalizedBlocks.length - 1} className="rounded-lg p-1 text-gray-400 hover:bg-white disabled:opacity-30"><ChevronDown size={14} /></button>
              <button type="button" onClick={() => onChange(normalizedBlocks.filter((_, idx) => idx !== index))} disabled={disabled} className="rounded-lg p-1 text-red-400 hover:bg-red-50 disabled:opacity-30"><Trash2 size={14} /></button>
            </div>
          </div>

          {(block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'callout') && (
            <div className="space-y-3">
              <ModeToggle
                mode={getMode(`block-${index}`, block.content || block.text || '')}
                onSimple={() => {
                  setMode(`block-${index}`, 'simple');
                  update(index, { ...block, content: collapseToSimple(block.content || block.text || '') });
                }}
                onFull={() => setMode(`block-${index}`, 'full')}
              />
              {block.type === 'heading' && (
                <select value={block.level || 2} onChange={(event) => update(index, { ...block, level: Number(event.target.value) })} disabled={disabled} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value={2}>Heading 2</option>
                  <option value={3}>Heading 3</option>
                  <option value={4}>Heading 4</option>
                </select>
              )}
              {block.type === 'callout' && (
                <select value={block.tone || 'info'} onChange={(event) => update(index, { ...block, tone: event.target.value as 'info' | 'warning' | 'success' })} disabled={disabled} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="success">Success</option>
                </select>
              )}
              {getMode(`block-${index}`, block.content || block.text || '') === 'simple' ? (
                <textarea
                  value={richTextToPlainText(block.content || block.text || '')}
                  onChange={(event) => update(index, { ...block, content: createEmptyDocument(event.target.value) })}
                  disabled={disabled}
                  rows={block.type === 'heading' ? 2 : 3}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                />
              ) : (
                <SlateRichTextEditor
                  value={block.content || block.text || ''}
                  onChange={(content) => update(index, { ...block, content })}
                  style={block.style}
                  onStyleChange={(style) => update(index, { ...block, style })}
                  disabled={disabled}
                  placeholder="Write here..."
                />
              )}
            </div>
          )}

          {(block.type === 'bulleted_list' || block.type === 'numbered_list') && (
            <div className="space-y-3">
              {(block.items || []).map((item, itemIndex) => (
                <div key={itemIndex} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <ModeToggle
                      mode={getMode(`list-${index}-${itemIndex}`, item)}
                      onSimple={() => {
                        setMode(`list-${index}-${itemIndex}`, 'simple');
                        updateListItem(index, itemIndex, collapseToSimple(item));
                      }}
                      onFull={() => setMode(`list-${index}-${itemIndex}`, 'full')}
                    />
                    <button type="button" onClick={() => update(index, { ...block, items: (block.items || []).filter((_, currentIndex) => currentIndex !== itemIndex) })} disabled={disabled || (block.items || []).length <= 1} className="rounded-lg p-2 text-red-400 hover:bg-red-50 disabled:opacity-30">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {getMode(`list-${index}-${itemIndex}`, item) === 'simple' ? (
                    <input
                      value={richTextToPlainText(item)}
                      onChange={(event) => updateListItem(index, itemIndex, createEmptyDocument(event.target.value))}
                      disabled={disabled}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                    />
                  ) : (
                    <SlateRichTextEditor
                      value={item}
                      onChange={(next) => updateListItem(index, itemIndex, next)}
                      style={block.style}
                      onStyleChange={(style) => update(index, { ...block, style })}
                      disabled={disabled}
                      placeholder="List item..."
                    />
                  )}
                </div>
              ))}
              <button type="button" onClick={() => update(index, { ...block, items: [...(block.items || []), createEmptyDocument()] })} disabled={disabled} className="inline-flex items-center gap-1 text-xs font-medium text-un-blue hover:underline">
                <PlusCircle size={12} /> Add item
              </button>
            </div>
          )}

          {block.type === 'image' && (
            <div className="space-y-2">
              <input value={block.url || ''} onChange={(event) => update(index, { ...block, url: event.target.value })} disabled={disabled} placeholder="Image URL" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <input value={block.alt || ''} onChange={(event) => update(index, { ...block, alt: event.target.value })} disabled={disabled} placeholder="Alt text" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
              <input value={block.caption || ''} onChange={(event) => update(index, { ...block, caption: event.target.value })} disabled={disabled} placeholder="Caption" className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            </div>
          )}

          {block.type === 'cta_group' && (
            <div className="space-y-2">
              {(block.ctas || []).map((cta, ctaIndex) => (
                <div key={ctaIndex} className="grid gap-2 rounded-xl border border-gray-200 bg-white p-3 md:grid-cols-[1fr_1fr_auto]">
                  <input value={cta.label} onChange={(event) => update(index, { ...block, ctas: (block.ctas || []).map((item, itemIndex) => itemIndex === ctaIndex ? { ...item, label: event.target.value } : item) })} disabled={disabled} placeholder="Label" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <input value={cta.href} onChange={(event) => update(index, { ...block, ctas: (block.ctas || []).map((item, itemIndex) => itemIndex === ctaIndex ? { ...item, href: event.target.value } : item) })} disabled={disabled} placeholder="/news" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <select value={cta.variant || 'primary'} onChange={(event) => update(index, { ...block, ctas: (block.ctas || []).map((item, itemIndex) => itemIndex === ctaIndex ? { ...item, variant: event.target.value } : item) })} disabled={disabled} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                  </select>
                </div>
              ))}
              <button type="button" onClick={() => update(index, { ...block, ctas: [...(block.ctas || []), { label: '', href: '', variant: 'secondary' }] })} disabled={disabled} className="inline-flex items-center gap-1 text-xs font-medium text-un-blue hover:underline">
                <PlusCircle size={12} /> Add CTA
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {NEW_BLOCKS.map((item) => (
          <button key={item.type} type="button" onClick={() => onChange([...normalizedBlocks, createBlock(item.type)])} disabled={disabled} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

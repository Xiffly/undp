import type { CSSProperties } from 'react';
import type {
  BlockNode,
  ContentFontFamilyToken,
  ContentFontSizeToken,
  ContentSpacingToken,
  ContentStyle,
  ContentTextAlign,
  LegacyRichTextNode,
  RichTextDocument,
  RichTextElement,
  RichTextLeaf,
  RichTextValue,
  SectionPresentation,
} from '../../types';

export const FONT_FAMILY_OPTIONS: Array<{ value: ContentFontFamilyToken; label: string; family: string }> = [
  { value: 'inter', label: 'Inter', family: '"Inter", "Segoe UI", sans-serif' },
  { value: 'source-serif', label: 'Source Serif 4', family: '"Source Serif 4", Georgia, serif' },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', family: '"IBM Plex Sans", "Segoe UI", sans-serif' },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', family: '"IBM Plex Mono", "SFMono-Regular", monospace' },
  { value: 'merriweather', label: 'Merriweather', family: '"Merriweather", Georgia, serif' },
  { value: 'lora', label: 'Lora', family: '"Lora", Georgia, serif' },
];

export const FONT_SIZE_OPTIONS: Array<{ value: ContentFontSizeToken; label: string; className: string }> = [
  { value: '12', label: '12', className: 'text-xs' },
  { value: '14', label: '14', className: 'text-sm' },
  { value: '16', label: '16', className: 'text-base' },
  { value: '18', label: '18', className: 'text-lg' },
  { value: '24', label: '24', className: 'text-2xl' },
  { value: '32', label: '32', className: 'text-3xl' },
];

export const TEXT_ALIGN_OPTIONS: Array<{ value: ContentTextAlign; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

export const SPACING_OPTIONS: Array<{ value: ContentSpacingToken; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
];

export const COLOR_SWATCHES = [
  '#111827',
  '#475569',
  '#0f766e',
  '#0f62fe',
  '#b91c1c',
  '#f97316',
  '#7c3aed',
  '#ffffff',
] as const;

const FONT_FAMILY_CLASS_MAP: Record<ContentFontFamilyToken, string> = {
  sans: 'font-sans',
  serif: 'font-serif',
  display: 'font-[Georgia]',
  mono: 'font-mono',
  inter: 'font-sans',
  'source-serif': 'font-serif',
  'ibm-plex-sans': 'font-sans',
  'ibm-plex-mono': 'font-mono',
  merriweather: 'font-serif',
  lora: 'font-serif',
};

const FONT_FAMILY_STYLE_MAP: Record<ContentFontFamilyToken, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, serif',
  display: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, monospace',
  inter: '"Inter", "Segoe UI", sans-serif',
  'source-serif': '"Source Serif 4", Georgia, serif',
  'ibm-plex-sans': '"IBM Plex Sans", "Segoe UI", sans-serif',
  'ibm-plex-mono': '"IBM Plex Mono", "SFMono-Regular", monospace',
  merriweather: '"Merriweather", Georgia, serif',
  lora: '"Lora", Georgia, serif',
};

const FONT_SIZE_CLASS_MAP: Record<ContentFontSizeToken, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '12': 'text-xs',
  '14': 'text-sm',
  '16': 'text-base',
  '18': 'text-lg',
  '24': 'text-2xl',
  '32': 'text-3xl',
};

export function isSlateDocument(input: unknown): input is RichTextDocument {
  return Array.isArray(input) && input.every((item) => item && typeof item === 'object' && 'type' in item && 'children' in item);
}

function normalizeLeaf(input?: Partial<RichTextLeaf> | LegacyRichTextNode | null): RichTextLeaf {
  return {
    text: String(input?.text || ''),
    bold: Boolean(input?.bold),
    italic: Boolean(input?.italic),
    strike: Boolean((input as RichTextLeaf | undefined)?.strike),
    color: normalizeHexColor((input as RichTextLeaf | undefined)?.color),
    font_family_token: normalizeFontFamilyToken((input as RichTextLeaf | undefined)?.font_family_token),
    font_size_token: normalizeFontSizeToken((input as RichTextLeaf | undefined)?.font_size_token),
    href: input?.href ? String(input.href) : undefined,
  };
}

function normalizeElement(input?: Partial<RichTextElement> | null): RichTextElement {
  const children = Array.isArray(input?.children) ? input.children.map((item) => normalizeLeaf(item)) : [{ text: '' }];
  return {
    type: 'paragraph',
    children: children.length ? children : [{ text: '' }],
  };
}

export function normalizeFontFamilyToken(value?: string | null): ContentFontFamilyToken | undefined {
  if (!value) return undefined;
  if (value in FONT_FAMILY_CLASS_MAP) return value as ContentFontFamilyToken;
  return undefined;
}

export function normalizeFontSizeToken(value?: string | null): ContentFontSizeToken | undefined {
  if (!value) return undefined;
  if (value in FONT_SIZE_CLASS_MAP) return value as ContentFontSizeToken;
  return undefined;
}

export function normalizeHexColor(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = String(value).trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/;
  const longHex = /^#([0-9a-fA-F]{6})$/;
  if (shortHex.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  if (longHex.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

export function normalizeRichText(input?: RichTextValue | null): RichTextDocument {
  if (isSlateDocument(input)) {
    return input.map((item) => normalizeElement(item));
  }
  if (Array.isArray(input)) {
    const legacyNodes = input as LegacyRichTextNode[];
    const children = legacyNodes.map((item) => normalizeLeaf(item));
    return [{ type: 'paragraph', children: children.length ? children : [{ text: '' }] }];
  }
  const text = String(input || '');
  return [{ type: 'paragraph', children: [{ text }] }];
}

export function richTextToPlainText(input?: RichTextValue | null): string {
  return normalizeRichText(input).map((node) => node.children.map((leaf) => leaf.text).join('')).join('\n');
}

function normalizeItems(items: RichTextValue[] = []): RichTextDocument[] {
  return items.map((item) => normalizeRichText(item));
}

export function hasRichFormatting(input?: RichTextValue | null): boolean {
  return normalizeRichText(input).some((node) =>
    node.children.some((leaf) =>
      Boolean(leaf.bold || leaf.italic || leaf.strike || leaf.color || leaf.font_family_token || leaf.font_size_token)
    )
  );
}

export function normalizeContentStyle(style?: ContentStyle | null): ContentStyle {
  return {
    font_family_token: normalizeFontFamilyToken(style?.font_family_token) || 'inter',
    font_size_token: normalizeFontSizeToken(style?.font_size_token) || '16',
    font_weight: style?.font_weight || 'regular',
    italic: Boolean(style?.italic),
    text_align: style?.text_align || 'left',
    text_color_token: normalizeHexColor(style?.text_color_token) || undefined,
    spacing_token: style?.spacing_token || 'normal',
  };
}

export function normalizePresentation(raw?: Record<string, unknown> | null): SectionPresentation {
  const presentation = (raw?.presentation as SectionPresentation | undefined) || {};
  return {
    section_label: presentation.section_label || undefined,
    eyebrow: presentation.eyebrow || undefined,
    subheading: presentation.subheading || undefined,
    container_width_token: presentation.container_width_token || 'default',
    background_variant_token: presentation.background_variant_token || 'default',
    padding_token: presentation.padding_token || 'normal',
  };
}

export function normalizeBlock(block: BlockNode): BlockNode {
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'callout') {
    return {
      ...block,
      content: normalizeRichText(block.content || block.text || ''),
      style: normalizeContentStyle(block.style),
    };
  }
  if (block.type === 'bulleted_list' || block.type === 'numbered_list') {
    return {
      ...block,
      items: normalizeItems(block.items || []),
      style: normalizeContentStyle(block.style),
    };
  }
  if (block.type === 'image' || block.type === 'cta_group') {
    return {
      ...block,
      style: normalizeContentStyle(block.style),
    };
  }
  return block;
}

export function normalizeBlocks(blocks?: BlockNode[] | null): BlockNode[] {
  return Array.isArray(blocks) ? blocks.map(normalizeBlock) : [];
}

export function blockTextClassName(style?: ContentStyle | null): string {
  const normalized = normalizeContentStyle(style);
  return [
    normalized.font_family_token ? FONT_FAMILY_CLASS_MAP[normalized.font_family_token] : '',
    normalized.font_size_token ? FONT_SIZE_CLASS_MAP[normalized.font_size_token] : '',
    normalized.font_weight === 'medium' ? 'font-medium' : normalized.font_weight === 'semibold' ? 'font-semibold' : normalized.font_weight === 'bold' ? 'font-bold' : 'font-normal',
    normalized.italic ? 'italic' : '',
    normalized.text_align === 'center' ? 'text-center' : normalized.text_align === 'right' ? 'text-right' : 'text-left',
    normalized.spacing_token === 'compact' ? 'leading-6' : normalized.spacing_token === 'relaxed' ? 'leading-8' : 'leading-7',
  ].join(' ');
}

export function leafClassName(leaf: RichTextLeaf): string {
  const classes = [
    leaf.bold ? 'font-bold' : '',
    leaf.italic ? 'italic' : '',
    leaf.strike ? 'line-through' : '',
    leaf.font_family_token ? FONT_FAMILY_CLASS_MAP[leaf.font_family_token] : '',
    leaf.font_size_token ? FONT_SIZE_CLASS_MAP[leaf.font_size_token] : '',
  ];

  return classes.filter(Boolean).join(' ');
}

export function leafInlineStyle(leaf: RichTextLeaf): CSSProperties {
  return {
    color: normalizeHexColor(leaf.color),
    fontFamily: leaf.font_family_token ? FONT_FAMILY_STYLE_MAP[leaf.font_family_token] : undefined,
  };
}

export function contentStyleClassName(style?: ContentStyle | null): string {
  return blockTextClassName(style);
}

export function sectionPresentationClassName(presentation?: SectionPresentation | null): string {
  const normalized = normalizePresentation({ presentation });
  return [
    normalized.background_variant_token === 'hero'
      ? 'bg-gradient-to-b from-un-dark via-un-blue to-blue-400 text-white'
      : normalized.background_variant_token === 'subtle'
        ? 'bg-blue-50'
        : normalized.background_variant_token === 'accent'
          ? 'bg-un-dark text-white'
          : 'bg-white',
    normalized.padding_token === 'compact'
      ? 'p-4'
      : normalized.padding_token === 'spacious'
        ? 'p-8'
        : 'p-6',
    normalized.container_width_token === 'narrow'
      ? 'max-w-2xl'
      : normalized.container_width_token === 'wide'
        ? 'max-w-6xl'
        : 'max-w-4xl',
  ].join(' ');
}

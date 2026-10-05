import React from 'react';
import { Link } from 'react-router-dom';
import type { BlockNode, RichTextLeaf, RichTextValue } from '../../types';
import {
  blockTextClassName,
  contentStyleClassName,
  leafClassName,
  leafInlineStyle,
  normalizeBlocks,
  normalizeRichText,
} from './contentSchema';

function isExternalHref(href: string) {
  return /^(https?:)?\/\//i.test(href) || /^(mailto|tel):/i.test(href);
}

function normalizeHref(rawHref?: string | null) {
  const href = String(rawHref || '').trim();
  if (!href) return '';
  if (isExternalHref(href) || href.startsWith('/') || href.startsWith('#')) return href;
  return `/${href.replace(/^\.?\//, '')}`;
}

function renderLeaf(leaf: RichTextLeaf, key: string) {
  const href = normalizeHref(leaf.href);
  const content = (
    <span key={key} className={leafClassName(leaf)} style={leafInlineStyle(leaf)}>
      {leaf.text}
    </span>
  );

  if (!href) return content;
  return (
    <a
      key={key}
      href={href}
      className="underline decoration-current/40 underline-offset-4"
      target={isExternalHref(href) ? '_blank' : undefined}
      rel={isExternalHref(href) ? 'noreferrer' : undefined}
    >
      {content}
    </a>
  );
}

function renderInlineDocument(document?: RichTextValue | null) {
  const normalized = normalizeRichText(document);
  return normalized.map((node, nodeIndex) => (
    <React.Fragment key={nodeIndex}>
      {node.children.map((leaf, leafIndex) => renderLeaf(leaf, `${nodeIndex}-${leafIndex}`))}
      {nodeIndex < normalized.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
}

export default function BlockRenderer({ blocks, className = '' }: { blocks: BlockNode[]; className?: string }) {
  return (
    <div className={`space-y-4 ${className}`}>
      {normalizeBlocks(blocks).map((block, index) => {
        if (block.type === 'paragraph') {
          return <p key={index} className={contentStyleClassName(block.style)}>{renderInlineDocument(block.content)}</p>;
        }
        if (block.type === 'heading') {
          const Tag = block.level === 3 ? 'h3' : block.level === 4 ? 'h4' : 'h2';
          return <Tag key={index} className={contentStyleClassName(block.style)}>{renderInlineDocument(block.content)}</Tag>;
        }
        if (block.type === 'quote') {
          return <blockquote key={index} className={`border-l-4 border-un-blue/50 pl-4 italic ${contentStyleClassName(block.style)}`}>{renderInlineDocument(block.content)}</blockquote>;
        }
        if (block.type === 'callout') {
          const tone = block.tone === 'warning'
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : block.tone === 'success'
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-blue-200 bg-blue-50 text-blue-900';
          return <div key={index} className={`rounded-xl border px-4 py-3 ${tone} ${contentStyleClassName(block.style)}`}>{renderInlineDocument(block.content)}</div>;
        }
        if (block.type === 'bulleted_list' || block.type === 'numbered_list') {
          const ListTag = block.type === 'numbered_list' ? 'ol' : 'ul';
          return (
            <ListTag key={index} className={`space-y-2 pl-5 ${block.type === 'numbered_list' ? 'list-decimal' : 'list-disc'} ${blockTextClassName(block.style)}`}>
              {(block.items || []).map((item, itemIndex) => <li key={itemIndex}>{renderInlineDocument(item)}</li>)}
            </ListTag>
          );
        }
        if (block.type === 'image') {
          return (
            <figure key={index} className="space-y-2">
              <img src={block.url} alt={block.alt || ''} className="w-full rounded-2xl border border-gray-200 object-cover" />
              {block.caption && <figcaption className="text-xs text-gray-500">{block.caption}</figcaption>}
            </figure>
          );
        }
        if (block.type === 'cta_group') {
          return (
            <div key={index} className="flex flex-wrap gap-3">
              {(block.ctas || []).map((cta, ctaIndex) => {
                const href = normalizeHref(cta.href);
                if (!href) return null;
                const className = `rounded-xl px-4 py-2 text-sm font-semibold ${cta.variant === 'primary' ? 'bg-un-blue text-white' : 'bg-white/20 text-inherit ring-1 ring-current/10'}`;

                if (isExternalHref(href)) {
                  return (
                    <a key={cta.id || ctaIndex} href={href} target="_blank" rel="noreferrer" className={className}>
                      {cta.label}
                    </a>
                  );
                }

                return (
                  <Link key={cta.id || ctaIndex} to={href} className={className}>
                    {cta.label}
                  </Link>
                );
              })}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

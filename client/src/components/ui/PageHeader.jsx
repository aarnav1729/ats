import { Fragment, isValidElement } from 'react';
import { Link } from 'react-router-dom';

const META_BADGE_CLASS = {
  success: 'badge-green',
  info: 'badge-blue',
  warning: 'badge-yellow',
  danger: 'badge-red',
  purple: 'badge-purple',
  neutral: 'badge-gray',
};

function renderMetaItem(item, index) {
  if (item == null || item === false) return null;

  if (isValidElement(item)) {
    return <Fragment key={index}>{item}</Fragment>;
  }

  if (typeof item === 'string' || typeof item === 'number') {
    return <span key={index} className="badge badge-gray">{item}</span>;
  }

  if (typeof item === 'object' && 'label' in item) {
    const toneClass = META_BADGE_CLASS[item.tone] || META_BADGE_CLASS.neutral;
    return (
      <span key={index} className={`badge ${toneClass}`}>
        {item.label}
      </span>
    );
  }

  return <span key={index} className="badge badge-gray">{String(item)}</span>;
}

function renderMeta(meta) {
  const items = Array.isArray(meta) ? meta : [meta];
  return items.map(renderMetaItem);
}

export function Breadcrumbs({ items = [] }) {
  if (!items.length) return null;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={idx} className="inline-flex items-center gap-1.5">
            {item.to && !isLast ? (
              <Link to={item.to} className="hover:underline">{item.label}</Link>
            ) : (
              <span className={isLast ? 'current' : ''}>{item.label}</span>
            )}
            {!isLast && <span className="sep">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

export default function PageHeader({ title, subtitle, breadcrumbs, actions, meta, icon }) {
  return (
    <div className="page-header pb-5 border-b border-line">
      <div className="min-w-0 flex-1">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <div className="mt-1.5 flex items-start gap-3">
          {icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-800 text-white shadow-sm">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="page-subtitle">{subtitle}</p>}
            {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{renderMeta(meta)}</div>}
          </div>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

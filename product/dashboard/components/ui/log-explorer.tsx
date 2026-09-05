"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { FormEvent, ReactNode, RefObject } from "react";
import { useMemo, useState } from "react";

import { InterfaceIcons } from "./iconography";
import { StatusBadge } from "./status-badge";
import { severityTone } from "./status-tone-policy";

export type LogExplorerEntry = {
  identity: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  service: string;
  message: string;
  sequence?: string;
  trailing?: string;
  tags?: readonly string[];
  details?: readonly { label: string; value: string; mono?: boolean }[];
};

export type LogExplorerFilterGroup = {
  id: string;
  label: string;
  value: string;
  countsAsFilter?: boolean;
  options: readonly { value: string; label: string }[];
  onSelect: (value: string) => void;
};

export function LogExplorer({
  title = "Logs",
  countLabel,
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  filters,
  onClearFilters,
  entries,
  pending = false,
  emptyMessage,
  actions,
  footer,
  viewportRef,
}: {
  title?: string;
  countLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  filters: readonly LogExplorerFilterGroup[];
  onClearFilters: () => void;
  entries: readonly LogExplorerEntry[];
  pending?: boolean;
  emptyMessage: string;
  actions?: ReactNode;
  footer?: ReactNode;
  viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const [expandedIdentity, setExpandedIdentity] = useState<string | null>(null);
  const activeFilterCount = useMemo(
    () => filters.reduce((count, group) => (
      count + (group.countsAsFilter !== false && group.value !== "all" ? 1 : 0)
    ), 0),
    [filters],
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onSearchSubmit?.();
  }

  return (
    <section className="log-explorer" aria-label={title}>
      <header className="log-explorer-header">
        <div className="log-explorer-heading">
          <h3>{title}</h3>
          <p>{countLabel}</p>
        </div>
        <div className="log-explorer-controls">
          <div className="log-explorer-filter-row" role="group" aria-label={`${title} filters`}>
            {filters.map((group) => (
              <motion.label className="log-explorer-filter-select" key={group.id}
                whileTap={{ scale: 0.985 }} transition={{ duration: 0.12 }}>
                <span className="sr-only">{group.label}</span>
                <select aria-label={group.label} value={group.value}
                  onChange={(event) => group.onSelect(event.target.value)}>
                  {group.options.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
                <InterfaceIcons.expand aria-hidden="true" size={13} />
              </motion.label>
            ))}
            {activeFilterCount ? (
              <motion.button className="log-explorer-clear-filters" type="button"
                whileTap={{ scale: 0.96 }} transition={{ duration: 0.12 }} onClick={onClearFilters}>
                Clear
              </motion.button>
            ) : null}
          </div>
          <form className="log-explorer-search" role="search" onSubmit={submitSearch}>
            <InterfaceIcons.search aria-hidden="true" size={15} />
            <span className="sr-only">{searchLabel}</span>
            <input value={searchValue} onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder} />
          </form>
          {actions ? <div className="log-explorer-actions">{actions}</div> : null}
        </div>
      </header>

      <div className="log-explorer-workspace">
        <div className="log-explorer-viewport" ref={viewportRef}>
          <AnimatePresence mode="popLayout" initial={false}>
            {entries.length ? entries.map((entry, index) => {
              const expanded = expandedIdentity === entry.identity;
              return (
                <motion.article className="log-explorer-entry" key={entry.identity} layout="position"
                  initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.015 }}>
                  <button className="log-explorer-row" type="button" aria-expanded={expanded}
                    onClick={() => setExpandedIdentity((current) => current === entry.identity ? null : entry.identity)}>
                    <motion.span className="log-explorer-chevron" animate={{ rotate: expanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}>
                      <InterfaceIcons.expand aria-hidden="true" size={15} />
                    </motion.span>
                    <StatusBadge tone={severityTone(entry.level)}>{entry.level}</StatusBadge>
                    <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                    <strong title={entry.service}>{entry.service}</strong>
                    <code title={entry.message}>{entry.message}</code>
                    {entry.sequence ? <span className="log-explorer-sequence">{entry.sequence}</span> : null}
                    {entry.trailing ? <span className="log-explorer-trailing">{entry.trailing}</span> : null}
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded ? (
                      <motion.div className="log-explorer-detail" key="detail"
                        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <div className="log-explorer-detail-inner">
                          <div className="log-explorer-message">
                            <span>Event</span><code>{entry.message}</code>
                          </div>
                          <dl>
                            <div><dt>Timestamp</dt><dd><code>{entry.timestamp}</code></dd></div>
                            {entry.details?.map((detail) => (
                              <div key={detail.label}><dt>{detail.label}</dt>
                                <dd>{detail.mono ? <code>{detail.value}</code> : detail.value}</dd></div>
                            ))}
                          </dl>
                          {entry.tags?.length ? <div className="log-explorer-tags">
                            <span>Tags</span><div>{entry.tags.map((tag) => <small key={tag}>{tag}</small>)}</div>
                          </div> : null}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </motion.article>
              );
            }) : (
              <motion.div className="log-explorer-empty" key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <InterfaceIcons.filter aria-hidden="true" size={17} />
                <p>{pending ? "Reading operational logs…" : emptyMessage}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      {footer ? <footer className="log-explorer-footer">{footer}</footer> : null}
    </section>
  );
}

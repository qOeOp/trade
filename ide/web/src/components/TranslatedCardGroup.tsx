import { useEffect, useRef, useState, type ReactNode } from "react";
import { CardGroup, Section } from "./Section";
import { IconButton } from "./IconButton";
import { Prose } from "./Prose";
import { TextButton } from "./TextButton";
import { translateToChinese } from "../lib/translation";
import type { TranslationResult } from "../lib/translation.worker";

type ProseSection = { title: string; text?: string | null };

/** One independent translation action for a group of prose cards, sharing the page's local model. */
export function TranslatedCardGroup({ title, sections, children, className }: {
  title: string; sections: readonly ProseSection[]; children?: ReactNode; className?: string;
}) {
  const [result, setResult] = useState<TranslationResult>();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const sourceKey = JSON.stringify(sections.map((section) => section.text ?? ""));
  useEffect(() => {
    generation.current++;
    setResult(undefined); setVisible(false); setBusy(false); setStatus(""); setError("");
    return () => { generation.current++; request.current?.abort(); };
  }, [sourceKey]);

  async function run() {
    setError(""); setVisible(true);
    if (result) return;
    const current = ++generation.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const translated = await translateToChinese(sections.map((section) => section.text ?? ""), (message) => {
        if (generation.current === current) setStatus(message);
      }, controller.signal);
      if (generation.current === current) setResult(translated);
    } catch (cause) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : "翻译失败，请重试。");
    } finally {
      if (generation.current === current) { setBusy(false); setStatus(""); }
    }
  }
  const duration = result && (result.elapsedMs < 1000 ? `${Math.round(result.elapsedMs)} 毫秒` : `${(result.elapsedMs / 1000).toFixed(1)} 秒`);
  return <CardGroup title={title} className={className} actions={
    <IconButton icon={busy ? "loading" : "translate"} label={busy ? "正在本地翻译" : visible ? "隐藏中文翻译" : result ? "显示中文翻译" : "翻译为中文（首次需下载约 3.1 GB 模型）"}
      glyph={12} active={visible && !busy} spinning={busy} disabled={busy || !sections.some((section) => section.text?.trim())}
      onClick={() => { if (visible) setVisible(false); else void run(); }} />
  }>
    {visible && <div className="space-y-1 px-1">
      {busy && <p role="status" className="text-small text-fg-muted leading-zh">{status}
        <TextButton onClick={() => request.current?.abort()} className="ml-1">取消</TextButton>
      </p>}
      {error && <p role="alert" className="text-small text-fail leading-zh">{error} <TextButton onClick={() => void run()}>重试</TextButton></p>}
      {result && <p role="status" className="text-small text-fg-faint leading-zh">本地翻译 · {duration}（不含模型准备）</p>}
    </div>}
    {sections.map(({ title, text }, index) =>
      <Section key={title} title={title}>
        <Prose text={text} />
        {visible && result && text && <div lang="zh-CN" className="mt-3 space-y-1 border-t border-line pt-3">
          <p className="text-small text-fg-faint">中文 · 本地机器翻译</p>
          <Prose text={result.texts[index]} />
        </div>}
      </Section>)}
    {children}
  </CardGroup>;
}

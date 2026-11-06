import { useEffect, useRef, useState, type ReactNode } from "react";
import { askSetup, namesRepository, question, readSetup, refusesKey, refusesRepository, stepLine, type Setup, type SetupRefusal } from "../lib/setupApi";
import { useAtom } from "../state/atom";
import { paperService } from "../state/paper";
import { FormButton, TextField } from "./chat/Field";
import { Typing } from "./Typing";

const POLL_MS = 1000;
const PAPER_GRACE_MS = 60_000;  // compose starts paper once ledger reports healthy, which takes a while
const UP = "docker compose -f deploy/compose.yaml up -d";
const LINK = "text-fg underline decoration-line-strong underline-offset-3 hover:decoration-current";

const External = ({ href, children }: { href: string; children: ReactNode }) =>
  <a className={LINK} href={href} target="_blank" rel="noreferrer">{children} ↗</a>;

function Failure({ refusal }: { refusal: SetupRefusal }) {
  return (
    <div role="alert" className="grid gap-0.5 border-l-2 border-fail pl-2.5">
      <p className="break-words">{refusal.message}</p>
      <p className="text-fg-faint">{refusal.code}</p>
    </div>
  );
}

/** Asks in one sentence that types itself once, then shows what answers it. `seen`, when it opens: it was asked
 *  before, so it shows whole. */
function Asked({ text, seen, onTyped, children }: { text: string; seen: boolean; onTyped?: () => void; children: ReactNode }) {
  const [typed, setTyped] = useState(seen);
  const [once] = useState(!seen);
  return (
    <>
      <Typing text={text} busy={false} once={once} onTyped={() => { setTyped(true); onTyped?.(); }} className="text-h2" />
      {typed && <div className="mt-3.5 grid gap-3.5">{children}</div>}
    </>
  );
}

function Answers({ repository, keyAdded, onChange }: { repository: string | null; keyAdded: boolean; onChange?: () => void }) {
  if (!repository && !keyAdded) return null;
  const row = "grid grid-cols-[96px_minmax(0,1fr)_auto] items-baseline gap-2";
  return (
    <dl className="mb-6 grid gap-1">
      {repository && (
        <div className={row}>
          <dt className="text-fg-faint">Repository</dt><dd className="break-words text-fg">{repository}</dd>
          {onChange ? <button type="button" onClick={onChange} className="min-h-6 rounded-control px-1.5 text-fg-muted hover:bg-hover hover:text-fg">Change</button> : <span />}
        </div>
      )}
      {keyAdded && <div className={row}><dt className="text-fg-faint">Key</dt><dd className="text-fg">added to DoltHub</dd><span /></div>}
    </dl>
  );
}

function CopyKey({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-control border border-line-strong bg-island py-2 pl-2.5 pr-2">
      <code className="select-all break-all font-mono">{text}</code>
      <FormButton onClick={copy}>{copied ? "Copied" : "Copy"}</FormButton>
    </div>
  );
}

/** The ledger is up. Compose starts paper on its own unless `up -d` was interrupted, so only a lasting absence is news. */
function Ready({ repository, onOpen }: { repository: string | null; onOpen: () => void }) {
  const paper = useAtom(paperService);
  const [waited, setWaited] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setWaited(true), PAPER_GRACE_MS); return () => window.clearTimeout(timer); }, []);
  return (
    <>
      <Answers repository={repository} keyAdded />
      <Asked key="ready" text="Your ledger is ready." seen={false}>
        {waited && paper === "offline" && (
          <div role="alert" className="border-l-2 border-fail pl-2.5">Paper trading is not running. Run <code className="font-mono">{UP}</code> again.</div>
        )}
        <p className="text-fg-muted">To start research, open your Agent at the repository root and say “start research”.</p>
        <div><FormButton primary onClick={onOpen}>Open the IDE</FormButton></div>
      </Asked>
    </>
  );
}

/** The page of a deployment's first start: one column in the middle that asks what the ledger service lacks,
 *  each question typed once, until the ledger is up. The service decides everything; this only asks and shows. */
export function FirstRun({ setup: initial, onReady, onOpen }: { setup: Setup; onReady: () => void; onOpen: () => void }) {
  const [setup, setSetup] = useState(initial);
  const [repository, setRepository] = useState(initial.repository ?? "");
  const [chosen, setChosen] = useState<string | null>(null);  // answered here, not yet sent
  const [changing, setChanging] = useState(false);
  const [pressed, setPressed] = useState(false);  // the operator said the key is added
  const [local, setLocal] = useState<SetupRefusal | null>(null);  // a refusal of the last request itself
  const [silent, setSilent] = useState(false);  // the service stopped answering while it was working
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (setup.state !== "running") return;
    let misses = 0;
    const timer = window.setInterval(() => void readSetup().then((next) => {
      if (typeof next === "object") { misses = 0; setSilent(false); setSetup(next); }
      else if (++misses >= 5) setSilent(true);
    }), POLL_MS);
    return () => window.clearInterval(timer);
  }, [setup.state]);

  useEffect(() => { if (setup.state === "done") onReady(); }, [setup.state, onReady]);

  const refusal = local ?? setup.refusal;
  const start = async (value: string) => {
    setLocal(null);
    setChanging(false);
    setChosen(null);
    setPressed(true);
    setSetup({ ...setup, state: "running", repository: value.trim() || setup.repository, step: null, refusal: null });
    const answer = await askSetup(value);
    if ("state" in answer) setSetup(answer);
    else { setSetup({ ...setup, refusal: null }); setLocal(answer); }
  };
  const page = (children: ReactNode) => (
    <div className="grid h-full place-items-center overflow-auto bg-frame px-4 pb-16 pt-8 text-ui text-fg">
      <div className="w-full max-w-[560px]">{children}</div>
    </div>
  );
  const shown = chosen ?? setup.repository;

  if (setup.state === "done") return page(<Ready repository={setup.repository} onOpen={onOpen} />);
  if (setup.state === "blocked") return page(
    <Asked key="blocked" text="The ledger cannot start here." seen={false}>
      {setup.refusal && <Failure refusal={setup.refusal} />}
      <p className="text-fg-muted">Nothing was changed. <code className="font-mono">deploy/README.md</code>, First start, says what to do; then restart the ledger service and reload this page.</p>
    </Asked>,
  );
  if (setup.state === "running") return page(
    <>
      <Answers repository={setup.repository} keyAdded={pressed} />
      <Typing text={stepLine(setup.step)} busy className="text-value text-fg-muted" />
      {silent && <p className="mt-3.5 text-fg-muted">The ledger service is not answering. This page keeps asking; <code className="font-mono">docker compose -f deploy/compose.yaml logs ledger</code> says why.</p>}
    </>,
  );

  const ask = question(setup, refusal, chosen, changing);
  const text = ask === "repository" ? "Which DoltHub repository keeps your research?" : "Add this key to your DoltHub account.";
  const seen = asked.current.has(text) || refusal !== null;
  const remember = () => { asked.current.add(text); };
  if (ask === "repository") {
    // With the key already accepted or not in question, nothing is left to ask after this.
    const again = refusesRepository(setup.refusal) || (pressed && !refusesKey(setup.refusal));
    const failure = local ?? (refusesRepository(setup.refusal) ? setup.refusal : null);
    const go = () => { if (again) void start(repository); else { setChosen(repository.trim()); setChanging(false); setLocal(null); } };
    return page(
      <>
        <Answers repository={null} keyAdded={again} />
        <Asked key={text} text={text} seen={seen} onTyped={remember}>
          <form className="contents" onSubmit={(e) => { e.preventDefault(); if (namesRepository(repository)) go(); }}>
            <p className="border-l-2 border-misses pl-2.5">Everything this ledger records is public on DoltHub: complete strategy source, results and judgments. Its history cannot be taken back.</p>
            <TextField label="Repository" hint="owner/repository, or the address of its DoltHub page." value={repository} onValue={setRepository}
              placeholder="owner/repository" spellCheck={false} autoFocus aria-invalid={failure !== null} />
            {failure && <Failure refusal={failure} />}
            <p className="text-fg-muted">An empty repository starts a new ledger; one that already holds a ledger continues it. <External href="https://www.dolthub.com/profile/new-repository">Create a repository on DoltHub</External></p>
            <div><FormButton primary type="submit" disabled={!namesRepository(repository)}>{again ? "Set up public ledger" : "Continue"}</FormButton></div>
          </form>
        </Asked>
      </>,
    );
  }
  return page(
    <>
      <Answers repository={shown} keyAdded={false} onChange={() => { setRepository(shown ?? ""); setChanging(true); setLocal(null); }} />
      <Asked key={text} text={text} seen={seen} onTyped={remember}>
        <p className="text-fg-muted">The ledger made this key on this machine to publish with. Add its public half to your DoltHub account; the private half stays in the service.</p>
        {setup.public_key && <CopyKey text={setup.public_key} />}
        {refusal && <Failure refusal={refusal} />}
        <div className="flex flex-wrap items-center gap-3">
          <External href="https://www.dolthub.com/settings/credentials">Open DoltHub credentials</External>
          <FormButton primary onClick={() => void start(shown ?? "")}>Set up public ledger</FormButton>
        </div>
      </Asked>
    </>,
  );
}

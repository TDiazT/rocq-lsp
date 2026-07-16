import { WebviewApi } from "vscode-webview";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import "./media/App.css";

const vscode: WebviewApi<unknown> = acquireVsCodeApi();

// Closed whitelist, mirrors queryAdapter.ts's QueryKeyword (see ADR-0006).
type QueryKeyword = "About" | "Check" | "Locate" | "Print";
const queryKeywords: QueryKeyword[] = ["About", "Check", "Locate", "Print"];

// Messages the extension host sends to this webview.
type HostMessage =
  | { method: "prefill"; params: { term: string; keyword: QueryKeyword } }
  | { method: "result"; params: { messages: string[] } }
  | { method: "error"; params: { message: string } };

function App() {
  const [keyword, setKeyword] = useState<QueryKeyword>("About");
  const [term, setTerm] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A throw in here would silently freeze the panel on its last state (no
    // visible error). Phase C hit exactly this, so guard it (see CLAUDE.md).
    function onMessage(event: MessageEvent<HostMessage>) {
      try {
        const { method, params } = event.data;
        switch (method) {
          case "prefill":
            setKeyword(params.keyword);
            setTerm(params.term);
            inputRef.current?.focus();
            inputRef.current?.select();
            break;
          case "result":
            setLoading(false);
            setError(null);
            setMessages(params.messages);
            break;
          case "error":
            setLoading(false);
            setMessages([]);
            setError(params.message);
            break;
          default:
            console.log("rocq query panel: unknown method", event.data);
        }
      } catch (e) {
        console.error("rocq query panel: failed handling message", e);
      }
    }
    window.addEventListener("message", onMessage);
    // Tell the host the listener is attached, so a reveal() that raced ahead
    // of this mount (webviews reload their JS each time they're shown) can
    // resend its prefill instead of losing it.
    vscode.postMessage({ method: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function submit() {
    if (term.trim() === "") return;
    setLoading(true);
    setError(null);
    vscode.postMessage({ method: "runQuery", params: { keyword, term } });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") submit();
  }

  return (
    <main className="query-panel">
      <div className="query-bar">
        <select
          className="query-keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value as QueryKeyword)}
        >
          {queryKeywords.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="text"
          className="query-input"
          placeholder={`${keyword} ...`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="query-submit" onClick={submit} disabled={loading}>
          {keyword}
        </button>
      </div>
      {loading && <p className="query-status">Running…</p>}
      {error !== null && <pre className="query-error">{error}</pre>}
      {!loading &&
        error === null &&
        messages.map((message, i) => (
          <pre key={i} className="query-message">
            {message}
          </pre>
        ))}
    </main>
  );
}

export default App;

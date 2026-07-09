import { useCallback, useEffect, useState } from "react";
import "./goal-view-ui/App.css";
import "./goals.css";

import ProofViewPage from "./goal-view-ui/components/templates/ProofViewPage";
// ProofViewGoalsKey is a plain string enum (no PpString involved), so it is
// taken from the copied goal-view-ui/types directly — it is exactly what
// ProofViewPage's props expect. ProofViewGoals/ProofViewMessage stay on
// goalAdapter's local mirrors (see the comment there for why); the two
// aliases below name goal-view-ui's versions only for the cast at the
// ProofViewPage boundary just below.
import {
  ProofViewGoalsKey,
  ProofViewGoals as GoalViewProofViewGoals,
  ProofViewMessage as GoalViewProofViewMessage,
} from "./goal-view-ui/types";
import { PpDisplay } from "./pp-display/main";
import ppClasses from "./goal-view-ui/components/atoms/PpString.module.css";

import {
  adaptGoalAnswer,
  ProofViewGoals,
  ProofViewMessage,
} from "./goalAdapter";
import { FileInfo } from "../info/FileInfo";
import { Program } from "../info/Program";
import type {
  GoalAnswer,
  GoalRequest,
  ErrorData,
  ProgramInfo,
  CoqMessageEvent,
} from "../../lib/types";
import type { PpString } from "./pp-display/types";

// Message passing back to the extension host.
const vscode =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;

const MAX_DEPTH = 10; // VsRocq's default goal nesting depth

export default function App() {
  const [goals, setGoals] = useState<ProofViewGoals>(null);
  const [messages, setMessages] = useState<ProofViewMessage[]>([]);
  const [error, setError] = useState<PpString | undefined>();
  const [reqError, setReqError] = useState<ErrorData | null>(null);
  const [program, setProgram] = useState<ProgramInfo | undefined>();
  const [fileInfo, setFileInfo] = useState<GoalRequest | null>(null);
  const [helpMessage, setHelpMessage] = useState<string>("");

  const handleMessage = useCallback((event: CoqMessageEvent) => {
    switch (event.data.method) {
      case "renderGoals": {
        const answer = event.data.params as GoalAnswer<unknown, any>;
        // A throw inside this listener silently freezes the panel on its
        // previous state; degrade loudly instead.
        let adapted;
        try {
          adapted = adaptGoalAnswer(answer);
        } catch (err) {
          console.error("rocq goals view: failed to adapt GoalAnswer", err);
          setReqError({
            textDocument: answer.textDocument,
            position: answer.position,
            message: `Goal view failed to render this answer: ${err}`,
          });
          break;
        }
        setReqError(null);
        setGoals(adapted.goals);
        setMessages(adapted.messages);
        // adapted.error is goalAdapter's VsRocqPp; setError's state is
        // pp-display's PpString. Same cross-boundary nominal-enum mismatch
        // as the ProofViewPage cast below (see that comment): identical
        // runtime shape, but TS treats the two Box-mode string enums as
        // distinct types, so the cast is required and safe at runtime.
        setError(adapted.error as PpString | undefined);
        setProgram(answer.program);
        setFileInfo({
          textDocument: answer.textDocument,
          position: answer.position,
        });
        break;
      }
      case "waitingForInfo":
        // Keep the last state on screen; a spinner here flickers on fast
        // servers. Revisit if latency warrants it.
        break;
      case "infoError":
        setReqError(event.data.params as ErrorData);
        break;
      case "configChanged":
        // No goal-display config field exists yet to bind to; display
        // settings are a planned follow-up.
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const collapseGoalHandler = (id: string, key: ProofViewGoalsKey) => {
    if (!goals) return;
    setGoals({
      ...goals,
      [key]: goals[key].map((g) =>
        g.id === id ? { ...g, isOpen: !g.isOpen } : g
      ),
    });
  };

  const toggleContext = (id: string, key: ProofViewGoalsKey) => {
    if (!goals) return;
    setGoals({
      ...goals,
      [key]: goals[key].map((g) =>
        g.id === id ? { ...g, isContextHidden: !g.isContextHidden } : g
      ),
    });
  };

  if (reqError) {
    return (
      <main>
        <FileInfo
          textDocument={reqError.textDocument}
          position={reqError.position}
        >
          <p>
            <b>{reqError.message}</b>
          </p>
        </FileInfo>
      </main>
    );
  }

  return (
    <main>
      {fileInfo && (
        <FileInfo
          textDocument={fileInfo.textDocument}
          position={fileInfo.position}
        >
          <></>
        </FileInfo>
      )}
      {/* goals/messages carry ppNormalize's VsRocqPp, which pp-display's
          PpString does not structurally accept (see the comment on
          goalAdapter's CollapsibleGoal: same runtime shape, but PpString's
          Box variant is typed against the PpMode string *enum* while
          VsRocqPp uses the plain-string WireBlockType, and TS treats
          string-enum members as nominal). The cast is safe at runtime. */}
      <ProofViewPage
        goals={goals as unknown as GoalViewProofViewGoals}
        messages={messages as unknown as GoalViewProofViewMessage[]}
        collapseGoalHandler={collapseGoalHandler}
        toggleContextHandler={toggleContext}
        displaySetting={"List"}
        maxDepth={MAX_DEPTH}
        settingsClickHandler={() =>
          vscode?.postMessage({ command: "openGoalSettings" })
        }
        helpMessage={helpMessage}
        helpMessageHandler={setHelpMessage}
      />
      <Program program={program} />
      {error && (
        <div className="error-browser">
          <PpDisplay pp={error} rocqCss={ppClasses} maxDepth={MAX_DEPTH} />
        </div>
      )}
    </main>
  );
}
